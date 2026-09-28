#!/usr/bin/env node
/* test/paged.js — 0.6.0 paged-controller gate. Runs the real
   snowfall-paged.js over the shared fake DOM, so the stop walk, the merge
   rules, the clamp arithmetic and the input gating are all checked without a
   browser. Line geometry (the <br> midpoint, sticky parking) belongs to
   test/browser/paged.js.

     the stop walk   — every depth, a heading is not a stop, <br> in a wagon,
                       a game, a [data-nopage] box or a script never counts
     the merges      — empty <p>, <br><br>, a trailing <br>, a <section>
                       opening into its first <p>, the blank opening page
     the clamp       — the padding box lands on the boundary for both
                       box-sizings, two style writes, the inline axis untouched
     stepping        — one portion a tap, the stepMax cap, hurry, prev's
                       deferred shrink, the end of the story
     re-measure      — the page is kept by element, not by index; a story that
                       changes its own height (a minigame seating itself) is
                       re-measured on the next tick and the reader re-anchored
                       onto the page that moved
     input           — a tap on prose turns the page; on a button, a link or
                       the host's own UI it does not
     no engine       — quiet false, no throw, no style write
     the source      — no scroll listener, no rAF, no overflow shorthand

   `node test/paged.js`, or via `node test/run.js`. */
'use strict';
const fs = require('fs'), path = require('path');
const FD = require('./lib/fakedom.js');
const ROOT = path.join(__dirname, '..');
const VH = 800;
const LINE = 26, PMARGIN = 12;

let checks = 0, fails = 0;
function ok(cond, name, detail) {
	checks++;
	if (cond) return;
	fails++;
	console.error('FAIL ' + name + (detail ? ' — ' + detail : ''));
}
function fmt(v) {
	if (v === null || v === undefined) return String(v);
	if (typeof v === 'object') return (v.tagName || 'obj') + (v.id ? '#' + v.id : '');
	return JSON.stringify(v);
}
function eq(a, b, name) { ok(a === b, name, '(' + fmt(a) + ' vs ' + fmt(b) + ')'); }

/* ---------------- layout: heights mirror the page's CSS ---------------- */
function lines(s) { return Math.max(1, Math.ceil(s.trim().length / 60)); }
function breaks(node) { let n = 0; for (const k of node.kids) n += k.tag === 'br' ? 1 : breaks(k); return n; }
function measure(node, vh, inner) {
	const cls = (node.attrs.class || '').split(/\s+/).filter(Boolean);
	if (node.tag === 'section') return 20 + inner + 20;
	if (node.tag === 'p') return 2 * PMARGIN + (lines(FD.nodeText(node)) + breaks(node)) * LINE;
	if (node.tag === 'br') return LINE;
	if (node.tag === 'h1') return 40;
	if (node.tag === 'h2') return 34;
	if (node.tag === 'hr') return 2;
	if (cls.indexOf('cover') >= 0) return 120;
	if (cls.indexOf('seat') >= 0) return Math.max(200, inner);
	return inner;
}
function para(text) { return '<p>' + text + '</p>'; }
function prose(n) {
	let out = '', i;
	for (i = 0; i < n; i++) out += para(new Array(30).join('word ' + i + ' '));
	return out;
}
const PAGE = '<!doctype html><html data-story="gate-paged"><head></head><body>' +
	'<div id="hud"></div><div id="app">@BODY@</div>' +
	'<script src="snowfall.js"></script><script src="snowfall-paged.js"></script>' +
	'</body></html>';

function openPage(body, opts) {
	opts = opts || {};
	const p = FD.buildPage(PAGE.replace('@BODY@', body), VH, { measure: measure, engine: opts.engine, dir: ROOT });
	p.SP = p.win.SnowfallPaged;
	/* the fake window has no style engine of its own worth trusting: a page
	   that wants real box numbers installs them here */
	if (opts.box) {
		const style = function(el) {
			const on = el === p.el('app');
			return {
				paddingTop: (on ? opts.pad || 0 : 0) + 'px', paddingBottom: (on ? opts.pad || 0 : 0) + 'px',
				borderTopWidth: (on ? opts.border || 0 : 0) + 'px', borderBottomWidth: (on ? opts.border || 0 : 0) + 'px',
				boxSizing: on ? opts.box : 'content-box', fontSize: '16px'
			};
		};
		p.win.getComputedStyle = style;
		global.getComputedStyle = style;
		p.win.Snowfall.refresh(true);
	}
	return p;
}
function list(p) {
	const out = [];
	for (let i = 0; i < p.SP.count; i++) {
		const el = p.SP.at(i);
		out.push((el === p.el('app') ? 'ROOT' : el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className : '')) + '@' + p.SP.y[i]);
	}
	return out;
}
function tags(p) { return list(p).map(s => s.split('@')[0]); }
/* the fake page is laid out once, at build time: a source edit has to push
   everything below it down by hand, the way a browser reflow would */
function para_el(text) {                       /* a laid-out paragraph, built by hand */
	const el = FD.fakeEl('p'), t = FD.fakeEl('#text');
	t.nodeValue = text;
	t._h = LINE;
	el.appendChild(t);
	return el;
}
function descendants(el) {
	const out = [el];
	for (const k of el.kids) out.push.apply(out, descendants(k));
	return out;
}
function reflow(root, from, by) {
	for (const el of descendants(root)) if (el !== root && el.layoutY >= from) el.layoutY += by;
	root._h += by;
}
function mono(p) {
	for (let i = 1; i < p.SP.count; i++) if (p.SP.y[i] < p.SP.y[i - 1]) return false;
	return true;
}

/* ---------------- 1. the stop walk ---------------- */
{
	const p = openPage('<div class="cover">title block</div>' +
		'<section id="s1"><h2>one</h2>' + para('first paragraph') + para('second<br>after the break') + '</section>' +
		'<section id="s2"><div class="snow-game" data-nopage>' + para('ui<br>lines') + '</div>' + para('after the game') + '</section>' +
		'<script type="txt" event="view">void 0</script>');
	eq(tags(p).join(' '), 'SECTION#s1 P P BR P ROOT', 'a section, its paragraphs and its <br> are stops');
	eq(p.SP.y[0], 120, 'the first boundary is the section, the cover above it is page one');
	ok(mono(p), 'the list is non-decreasing');
	eq(p.SP.at(p.SP.count - 1), p.el('app'), 'the last boundary is the story root itself');
	ok(p.SP.y[p.SP.count - 1] === p.el('app').layoutY + p.el('app')._h, 'and sits on its bottom edge');
	ok(tags(p).indexOf('H2') < 0, 'a heading is not a stop');
	ok(list(p).indexOf('SECTION#s2') < 0, 'a section whose only content is a game box merges into the page after it');
}
{
	/* a <br> inside an excluded subtree never ends a portion */
	const p = openPage(para('one') + '<div class="snow-bg" data-mode="cover">a<br>b</div>' +
		'<p class="cut" data-nopage>cut<br>me</p>' + para('two'));
	eq(tags(p).join(' '), 'P ROOT', 'a <br> in a wagon and in [data-nopage] never counts');
	ok(list(p).indexOf('P.cut') < 0, 'and the [data-nopage] paragraph is not a stop either');
}
{
	/* a picture is content: a section that opens with one is a page of its own */
	const p = openPage('<div class="cover">title</div><section id="s"><div class="snow-bg" data-mode="cover">art</div>' + para('after') + '</section>');
	eq(tags(p).join(' '), 'SECTION#s P ROOT', 'the wagon keeps the section boundary alive');
	const q = openPage('<div class="cover">title</div><section id="s">' + para('after') + '</section>');
	eq(tags(q).join(' '), 'P ROOT', 'without it the empty section would merge away');
}

/* ---------------- 2. merges: an empty portion is not a page ---------------- */
{
	const p = openPage(para('one') + '<p></p>' + para('two<br><br>three') + para('four<br>') +
		'<section id="s">' + para('five') + '</section>');
	eq(tags(p).join(' '), 'P BR P P ROOT', 'empty <p>, <br><br>, a trailing <br> and a section opening into a <p> all merge');
	ok(mono(p), 'the merged list is still non-decreasing');
	ok(p.SP.count > 0, 'and the story is still readable in pages');
}
{
	/* nothing above the first stop: the opening page would be blank */
	const p = openPage(para('one') + para('two'));
	eq(p.SP.count, 2, 'a story that opens on a stop has no blank page in front of it');
	eq(p.SP.y[0], 50, 'page one is the first paragraph itself');
}
{
	/* data-stops widens the list for one page only */
	const body = para('one') + para('two') + '<hr>rule' + para('three');
	const p = openPage(body);
	eq(list(p).join(' '), 'P@50 P@102 ROOT@152', 'an <hr> is ordinary flow by default');
	const q = openPage(body);
	q.el('app').setAttribute('data-stops', 'p,hr');
	q.win.Snowfall.refresh(true);
	eq(list(q).join(' '), 'P@50 HR@100 P@102 ROOT@152', 'data-stops="p,hr" makes each <hr> with prose after it a page');
	eq(q.SP.stops, 'p,section,br', 'the default list is unchanged on other pages');
}
{
	/* an out-of-flow stop loses to the one before it */
	const p = openPage(para('one') + para('two') + para('three'));
	const before = p.SP.count;
	const warns = [], warn = console.warn;
	console.warn = m => warns.push(m);
	p.el('app').querySelectorAll('p')[2].layoutY = 5;          /* pulled above its siblings */
	p.win.Snowfall.refresh(true);
	console.warn = warn;
	ok(p.SP.count <= before, 'a stop above its predecessor adds no backwards page');
	ok(mono(p), 'and the list stays ordered');
	eq(warns.length, 1, 'the author is told once, not once per boundary');
	ok(/out-of-flow/.test(warns[0] || ''), 'and the warning says what is wrong', warns[0]);
}

/* ---------------- 3. the clamp: the padding box on the boundary ---------------- */
{
	const p = openPage(para('one') + para('two') + para('three'));
	const r = p.el('app');
	ok(p.SP.set(true), 'set(true) engages');
	eq(r.style.overflowY, 'clip', 'the story root is clipped on the block axis');
	eq(r.style.overflowX, undefined, 'the inline axis is left to the author');
	ok(/\d/.test(r.style.height), 'the story root carries a height', r.style.height);
	p.SP.set(false);
	eq(r.style.height, '', 'set(false) clears the height');
	eq(r.style.overflowY, '', 'set(false) clears the clip');
}
{
	/* content-box: height = y[k] − padBoxTop − padTop − padBottom */
	const p = openPage(para('one') + para('two'), { box: 'content-box', pad: 10, border: 2 });
	const r = p.el('app'), padBoxTop = r.layoutY + 2;
	p.SP.set(true);
	for (let k = 0; k < p.SP.count; k++) {
		p.SP.set(true, k === 0);
		const want = (p.SP.y[p.SP.index] - padBoxTop) - 10 - 10;
		ok(Math.abs(parseFloat(r.style.height) - want) < 1e-6, 'content-box page ' + k + ' puts the padding box on the boundary',
			r.style.height + ' vs ' + want);
	}
}
{
	/* border-box: height = y[k] − padBoxTop + borderTop + borderBottom */
	const p = openPage(para('one') + para('two'), { box: 'border-box', pad: 10, border: 2 });
	const r = p.el('app'), padBoxTop = r.layoutY + 2;
	p.SP.set(true);
	for (let k = 0; k < p.SP.count; k++) {
		p.SP.set(true, k === 0);
		const want = (p.SP.y[p.SP.index] - padBoxTop) + 2 + 2;
		ok(Math.abs(parseFloat(r.style.height) - want) < 1e-6, 'border-box page ' + k + ' puts the padding box on the boundary',
			r.style.height + ' vs ' + want);
	}
}

/* ---------------- 4. stepping: one page is one portion ---------------- */
{
	const p = openPage('<div class="cover">title</div>' + prose(10));
	const SP = p.SP, r = p.el('app'), n = SP.count;
	SP.smooth = 0;
	SP.set(true, true);
	eq(SP.index, 0, 'set(true, true) starts at page one');
	eq(p.win.scrollY, 0, 'at the top of the document');
	eq(SP.top(), 0, 'and the first page is read at the top');
	ok(SP.next(), 'a tap advances');
	eq(SP.index, 1, 'exactly one portion a tap');
	eq(p.win.scrollY, SP.y[0], 'the new page is read at its portion start');
	ok(SP.next() && SP.index === 2, 'and again');
	/* the reader scrolled back up inside the page: the next tap hurries, it
	   does not reveal, and the old text is not pushed away twice */
	p.win.setScroll(Math.max(0, SP.y[SP.index - 1]) - 300);
	SP.next();
	eq(SP.index, 2, 'a tap above this page\'s top reveals nothing');
	ok(p.win.scrollY <= SP.y[1] + 0.9 * VH + 1e-6, 'it only scrolls, and never more than stepMax', String(p.win.scrollY));
	let guard = n * 4;
	while (guard-- > 0 && SP.next()) { }
	eq(SP.index, n - 1, 'stepping ends on the last page');
	eq(SP.next(), false, 'and the end of the story says stop');
}
{
	/* every page: its own portion at the window top, the previous one gone,
	   and the paper below the portion blank rather than earlier text */
	const p = openPage('<div class="cover">title</div>' + prose(6));
	const SP = p.SP;
	SP.smooth = 0;
	SP.set(true, true);
	let page = 0, clean = true, onPage = true, bands = 0;
	while (page < SP.count - 1 && SP.next()) {
		if (p.win.scrollY !== SP.top()) { onPage = false; }
		if (p.win.scrollY < SP.y[page]) clean = false;      /* earlier text still on the page */
		const band = 800 - (SP.y[SP.index] - SP.top());
		if (band > 0) {
			bands++;
			eq(parseFloat(p.el('app').style.marginBottom), band, 'page ' + SP.index + ' pads the paper to a full window');
		}
		page = SP.index;
	}
	ok(onPage, 'every page is read at its own portion start');
	ok(clean, 'and no page ever shows text from before its portion');
	ok(bands > 0, 'short portions get the empty band under them (' + bands + ' of ' + (SP.count - 1) + ')', String(bands));
	SP.set(false);
	eq(p.el('app').style.marginBottom, '', 'and book mode takes the band away again');
}
{
	/* a portion taller than the viewport: the page starts at its top and the
	   reader walks down through it, one stepMax at a time */
	const p = openPage(para(new Array(400).join('word ')) + para('next'));
	const SP = p.SP;
	SP.smooth = 0;
	SP.set(true, true);
	eq(SP.index, 0, 'the tall portion is page one');
	ok(SP.y[0] > VH, 'and it is taller than the window', String(SP.y[0]));
	eq(p.win.scrollY, 0, 'the page opens on its own first line');
	eq(SP.top(), SP.y[0] - VH, 'and is read at its last window');
	let guard = 20, steps = 0;
	while (p.win.scrollY < SP.top() - 1 && guard-- > 0) { SP.next(); steps++; }
	ok(steps > 0, 'it takes several taps to walk down it (' + steps + ')');
	eq(p.win.scrollY, SP.top(), 'and the reader ends on its last line');
	eq(SP.index, 0, 'with no page revealed while walking');
	SP.next();
	eq(SP.index, 1, 'the next tap reveals the page after it');
	while (p.win.scrollY < SP.top() - 1 && guard-- > 0) SP.next();
	eq(p.win.scrollY, SP.top(), 'which is read at its own last window');
}
{
	/* prev: the height and the band land only once the scroll has arrived */
	const p = openPage('<div class="cover">title</div>' + prose(6));
	const SP = p.SP, r = p.el('app');
	SP.set(true, true);
	while (SP.next()) { }
	eq(SP.index, SP.count - 1, 'at the last page');
	const full = parseFloat(r.style.height);
	ok(SP.prev(), 'prev moves back');
	eq(SP.index, SP.count - 2, 'one page back');
	ok(parseFloat(r.style.height) >= full, 'the document is still full while the scroll travels');
	p.win.setScroll(SP.top());
	ok(parseFloat(r.style.height) < full, 'and shrinks when the scroll arrives');
	eq(parseFloat(r.style.height), SP.y[SP.index], 'cutting the root at that page\'s own boundary');
	while (SP.prev()) { }
	eq(SP.index, 0, 'and back all the way to the first page');
	eq(SP.prev(), false, 'prev at page one says stop');
	SP.smooth = 0;
	SP.set(true, true);
	while (SP.next()) { }
	const whole = parseFloat(r.style.height);
	SP.prev();
	ok(parseFloat(r.style.height) < whole, 'smooth = 0 shrinks before the scroll, so nothing jumps', r.style.height);
}

/* ---------------- 5. set(true) at a position, and re-measure ---------------- */
{
	/* the read-only surface cannot be written through, even in sloppy code */
	const p = openPage(para('one') + para('two'));
	const SP = p.SP;
	SP.count = 99; SP.index = 42;
	eq(SP.count, 2, 'count stays the real count after an assignment');
	eq(SP.index, -1, 'and index stays the real index');
}
{
	const p = openPage('<div class="cover">title</div>' + prose(8));
	const SP = p.SP;
	for (const at of [0, 120, 400, p.bottom()]) {
		p.win.setScroll(at);
		SP.set(true);
		let want = SP.count - 1;
		for (let i = 0; i < SP.count; i++) if (SP.y[i] >= at + VH - 0.001) { want = i; break; }
		eq(SP.index, want, 'set(true) at ' + at + 'px takes the first boundary at or below the window bottom');
	}
	SP.set(false);
	SP.set(true);
	ok(SP.index >= 0, 'a round trip through book mode keeps a page');
}
{
	/* a source edit above the reader must not move the frontier */
	const p = openPage(para('one') + para('two') + para('three'));
	const SP = p.SP;
	SP.set(true, true);
	SP.next();
	eq(SP.index, 1, 'on page two');
	const keep = SP.at(SP.index), keepY = SP.y[SP.index];
	const app = p.el('app');
	const added = para_el('inserted above the reader');
	added._h = 100;
	added.layoutY = app.querySelector('p').layoutY;
	reflow(app, added.layoutY, added._h);    /* the fake page is laid out once: reflow by hand */
	app.querySelector('p').parentNode.insertBefore(added, app.querySelector('p'));
	p.win.Snowfall.refresh(true);
	eq(SP.at(SP.index), keep, 'the reader is still on the same stop after an edit above it');
	ok(SP.y[SP.index] > keepY, 'which moved down with the text', SP.y[SP.index] + ' vs ' + keepY);
}

/* ---------------- 5b. the story changes its own height ---------------- */
{
	/* A game seats itself when its anchor is looked at and unseats when the
	   reader walks away: the story grows and shrinks under the reader, and a
	   boundary list measured once turns every page after it. The seam a
	   browser provides is the subtree observer and the timer it schedules;
	   the gate owns both, so the real controller runs the real path. */
	let mo = null;
	global.MutationObserver = function(cb) { this.cb = cb; mo = this; };
	global.MutationObserver.prototype.observe = function() {};
	global.MutationObserver.prototype.disconnect = function() {};
	const p = openPage(para('one') + para('two') + para('three') + para('four'));
	const ticks = [];
	p.win.setTimeout = fn => { ticks.push(fn); return 1; };
	const SP = p.SP;
	ok(!!mo, 'the controller watches the story root for changes');
	SP.set(true, true);
	SP.next();
	SP.next();
	eq(SP.index, 2, 'on page three');
	const stop = SP.at(SP.index), wasStart = SP.y[SP.index - 1], wasY = p.win.scrollY;
	/* a minigame seats itself above the reader: 100px more story */
	const app = p.el('app');
	const seated = para_el('a game seats itself above the reader');
	seated._h = 100;
	seated.layoutY = app.querySelector('p').layoutY;
	reflow(app, seated.layoutY, seated._h);
	app.insertBefore(seated, app.querySelector('p'));
	mo.cb([], mo);
	mo.cb([], mo);
	eq(ticks.length, 1, 'a burst of mutations schedules one coalesced measure');
	ticks[0]();
	ok(SP.at(SP.index) === stop, 'the reader is still on their page, kept by element');
	eq(SP.y[SP.index - 1], wasStart + 100, 'its boundary moved down with the story');
	eq(p.win.scrollY, wasY + 100, 'and the reader moved with it: no earlier text on the page');
	ok(p.win.scrollY >= SP.y[SP.index - 1], 'never above the portion own start');

	/* the reader who wheeled up to re-read, then the story moved: the page
	   own new start, not the text before it */
	p.win.setScroll(SP.y[SP.index - 1] - 20);
	const grew = para_el('another growth above the reader');
	grew._h = 50;
	grew.layoutY = seated.layoutY;
	reflow(app, grew.layoutY, grew._h);
	app.insertBefore(grew, seated);
	mo.cb([], mo);
	ticks[ticks.length - 1]();
	eq(p.win.scrollY, SP.y[SP.index - 1], 'a reader above their page is put on its new start');

	/* a burst the tick has not run yet still cannot stale a turn */
	const more = para_el('one more paragraph above the reader');
	more._h = 30;
	more.layoutY = grew.layoutY;
	reflow(app, more.layoutY, more._h);
	app.insertBefore(more, grew);
	mo.cb([], mo);                            /* dirty, timer scheduled, not run */
	const at = SP.index;
	SP.next();
	eq(SP.index, at + 1, 'the turn came from a fresh list');
	eq(p.win.scrollY, SP.y[SP.index - 1], 'and landed on the moved page, not the stale one');
	ticks[ticks.length - 1]();                /* leave nothing pending */
	delete global.MutationObserver;
}

/* ---------------- 6. input ---------------- */
{
	const p = openPage(para('one') + para('two') + para('three') + para('four') + para('five') + '<a href="#x" id="link">go</a>');
	const SP = p.SP;
	SP.smooth = 0;
	SP.set(true, true);
	SP.ignore = '#hud';
	function fire(el, type, extra) {
		const ev = Object.assign({ clientX: 20, clientY: 20, timeStamp: 1000, button: 0, isPrimary: true, target: el }, extra || {});
		(p.win._listeners[type] || []).forEach(f => f(ev));
	}
	function tap(el) { fire(el, 'pointerdown'); fire(el, 'pointerup'); }
	const k = SP.index;
	tap(p.el('hud'));
	eq(SP.index, k, 'a tap inside the host ignore selector does not turn the page');
	tap(p.el('link'));
	eq(SP.index, k, 'a tap on a link does not turn the page');
	tap(p.el('app').querySelector('p'));
	eq(SP.index, k + 1, 'a tap on the prose does');
	const k2 = SP.index;
	fire(p.el('app').querySelector('p'), 'pointerup');
	eq(SP.index, k2, 'a pointerup with no pointerdown does nothing');
	fire(p.el('app').querySelector('p'), 'pointerdown');
	fire(p.el('app').querySelector('p'), 'pointerup', { clientX: 400, clientY: 20 });
	eq(SP.index, k2, 'a drag is a selection, not a page turn');
	fire(p.el('app').querySelector('p'), 'pointerdown', { timeStamp: 1000 });
	fire(p.el('app').querySelector('p'), 'pointerup', { timeStamp: 2000 });
	eq(SP.index, k2, 'a slow press is a long read, not a page turn');

	/* the reader has read this page: a key turns it */
	function atPage() { p.win.setScroll(SP.top()); }
	function key(name, extra) {
		let prevented = false;
		(p.win._listeners['keydown'] || []).forEach(f => f(Object.assign({
			key: name, repeat: false, target: p.el('app'), preventDefault() { prevented = true; }
		}, extra || {})));
		return prevented;
	}
	const k3 = SP.index;
	atPage();
	ok(key(' '), 'Space is claimed, and prevented');
	eq(SP.index, k3 + 1, 'Space advances');
	ok(key('Backspace'), 'Backspace is claimed');
	eq(SP.index, k3, 'Backspace goes back');
	atPage();
	ok(key('PageDown'), 'PageDown advances');
	eq(SP.index, k3 + 1, 'one more page');
	atPage();
	ok(key('ArrowRight'), 'ArrowRight advances');
	eq(SP.index, k3 + 2, 'two more pages');
	atPage();
	ok(key('PageUp'), 'PageUp goes back');
	eq(SP.index, k3 + 1, 'one page back');
	atPage();
	ok(key('ArrowLeft'), 'ArrowLeft goes back');
	eq(SP.index, k3, 'back to where it was');
	ok(!key('ArrowDown'), 'ArrowDown stays native scrolling');
	ok(!key('a'), 'an ordinary key is not claimed');
	ok(!key(' ', { repeat: true }), 'a held key is not a page-turn machine');
	ok(!key(' ', { ctrlKey: true }), 'a shortcut is left to the browser');
	const k4 = SP.index;
	key(' ', { target: p.el('link') });
	eq(SP.index, k4, 'a key aimed at a link is left alone');
}
{
	/* handlers are inert in book mode */
	const p = openPage(para('one') + para('two'));
	const SP = p.SP;
	const before = SP.index;
	(p.win._listeners['keydown'] || []).forEach(f => f({ key: ' ', repeat: false, target: p.el('app'), preventDefault() {} }));
	(p.win._listeners['pointerup'] || []).forEach(f => f({ clientX: 5, clientY: 5, timeStamp: 10, button: 0, isPrimary: true, target: p.el('app') }));
	eq(SP.index, before, 'in book mode no key and no tap is claimed');
	ok(SP.get() === false, 'and the mode really is book');
}

/* ---------------- 7. no engine on the page ---------------- */
{
	const bare = '<!doctype html><html data-story="gate-paged"><head></head><body><div id="app">' +
		para('one') + para('two') + '</div><script src="snowfall-paged.js"></script></body></html>';
	const p = FD.buildPage(bare, VH, { measure: measure, dir: ROOT });
	const SP = p.win.SnowfallPaged;
	ok(!!SP, 'the controller still loads and exports without an engine');
	eq(SP.count, 0, 'and has nothing to say');
	eq(SP.set(true), false, 'set(true) is a quiet false');
	eq(SP.set(false), false, 'set(false) is a quiet false');
	eq(SP.next(), false, 'next is a quiet false');
	eq(SP.prev(), false, 'prev is a quiet false');
	eq(SP.get(), false, 'get is false');
	eq(p.el('app').style.height, undefined, 'and nothing was written to the page');
	let threw = null;
	try { SP.set(true); SP.next(); SP.prev(); SP.at(0); } catch (e) { threw = e; }
	ok(!threw, 'no throw anywhere on that path', threw && threw.message);
}

/* ---------------- 8. the source keeps the engine's contracts ---------------- */
{
	const src = fs.readFileSync(path.join(ROOT, 'snowfall-paged.js'), 'utf8');
	ok(src.indexOf('MutationObserver') > 0, 'the story root is watched for story-side changes');
	ok(src.indexOf("addEventListener('scroll'") < 0, 'the controller adds no scroll listener');
	ok(src.indexOf('requestAnimationFrame') < 0, 'and runs no rAF');
	ok(src.indexOf("overflowY = 'clip'") > 0, 'the clamp writes overflow-y');
	ok(src.indexOf("overflow = 'clip'") < 0, 'never the shorthand, which would clip the inline axis too');
	ok(src.indexOf('module.exports') > 0, 'the file is require()-able under node');
	/* layout reads live in the measure-time helpers and nowhere else */
	function fn(name) {
		const at = src.indexOf('function ' + name);
		if (at < 0) return '';
		let depth = 0, i = src.indexOf('{', at);
		for (let j = i; j < src.length; j++) {
			if (src[j] === '{') depth++;
			else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1);
		}
		return src.slice(at);
	}
	const layout = /getBoundingClientRect|getComputedStyle|getClientRects|offsetHeight|offsetTop/;
	for (const name of ['charY', 'stopY', 'readBox', 'walk', 'frame', 'apply', 'next', 'prev', 'onUp', 'onKey']) {
		ok(fn(name) !== '', name + '() is there');
	}
	ok(layout.test(fn('charY')) && layout.test(fn('stopY')) && layout.test(fn('readBox')),
		'the boxes are read in charY(), stopY() and readBox()');
	ok(!layout.test(fn('walk')), 'the walk itself reads no boxes (stopY does)');
	ok(!layout.test(fn('frame')), 'frame() reads no layout at all');
	ok(!layout.test(fn('next')) && !layout.test(fn('prev')), 'next() and prev() read no layout');
	ok(!layout.test(fn('onUp')) && !layout.test(fn('onKey')), 'the input handlers read no layout');
	ok(!layout.test(fn('onMutate')) && !layout.test(fn('onTick')) && !layout.test(fn('anchor')),
		'the change watch and the re-anchor read no layout (measure does the reading)');
	ok(fn('onMutate') !== '' && fn('onTick') !== '' && fn('anchor') !== '', 'the watch, its tick and the re-anchor are there');
}

console.log('paged: ' + (checks - fails) + '/' + checks + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
