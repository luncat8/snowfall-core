#!/usr/bin/env node
/* test/paged.js — 0.7.0 paged-controller gate. Runs the real
   snowfall-paged.js over the shared fake DOM, so the stop walk, the screenful
   rule, the clamp arithmetic and the input gating are all checked without a
   browser. Line geometry (the <br> midpoint, sticky parking) belongs to
   test/browser/paged.js.

     the cuts        — every stop depth, a heading is not a stop, <br> in a
                       wagon, a game, a [data-nopage] box or a script never
                       counts; empty portions merge
     the pages       — a screenful of whole portions ends at the last stop
                       that fits; a portion taller than the screen is a page
                       of its own; the end cut closes the last page
     the clamp       — the padding box lands on the page cut for both
                       box-sizings, two style writes, the inline axis untouched
     stepping        — one page a tap, a tall page walked a band at a time,
                       prev's deferred shrink, the end of the story
     padTop/padBottom — the fixed chrome is cleared by every page
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
/* a paragraph of exactly n lines: 24px margins + n·26px */
function hPara(n) { return para(new Array(n * 60 + 1).join('x')); }
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
function label(el, root) {
	if (!el) return 'null';
	if (el === root) return 'ROOT';
	return el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className : '');
}
function cuts(p) {
	const out = [], root = p.el('app');
	for (let i = 0; i < p.SP.cutN; i++) out.push(label(p.SP.cutAt(i), root) + '@' + p.SP.cutY[i]);
	return out;
}
function cutTags(p) { return cuts(p).map(s => s.split('@')[0]); }
function pages(p) {
	const out = [], root = p.el('app');
	for (let i = 0; i < p.SP.count; i++) out.push(label(p.SP.at(i), root) + '@' + p.SP.y[i]);
	return out;
}
/* the model restated for the checks: where page k opens, is done, and the
   blank paper it needs under it */
function start(p, k) { return k > 0 ? p.SP.y[k - 1] : 0; }
function open(p, k) { return Math.max(0, start(p, k) - p.SP.padTop); }
function done(p, k) { return Math.max(0, open(p, k), p.SP.y[k] - VH + p.SP.padBottom); }
function band(p, k) { return Math.max(0, done(p, k) + VH - p.SP.y[k]); }
function mono(p) {
	for (let i = 1; i < p.SP.cutN; i++) if (p.SP.cutY[i] < p.SP.cutY[i - 1]) return false;
	for (let i = 1; i < p.SP.count; i++) if (p.SP.y[i] < p.SP.y[i - 1]) return false;
	return true;
}

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

/* ---------------- 1. the stop walk: the author's cuts ---------------- */
{
	const p = openPage('<div class="cover">title block</div>' +
		'<section id="s1"><h2>one</h2>' + para('first paragraph') + para('second<br>after the break') + '</section>' +
		'<section id="s2"><div class="snow-game" data-nopage>' + para('ui<br>lines') + '</div>' + para('after the game') + '</section>' +
		'<script type="txt" event="view">void 0</script>');
	eq(cutTags(p).join(' '), 'SECTION#s1 P P BR P ROOT', 'a section, its paragraphs and its <br> are cuts');
	eq(p.SP.cutY[0], 120, 'the first cut is the section, the cover above it is the opening');
	ok(mono(p), 'the list is non-decreasing');
	eq(p.SP.cutAt(p.SP.cutN - 1), p.el('app'), 'the last cut is the story root itself');
	ok(p.SP.cutY[p.SP.cutN - 1] === p.el('app').layoutY + p.el('app')._h, 'and sits on its bottom edge');
	ok(cutTags(p).indexOf('H2') < 0, 'a heading is not a cut');
	ok(cuts(p).join(' ').indexOf('SECTION#s2') < 0, 'a section whose only content is a game box merges into the page after it');
}
{
	/* a <br> inside an excluded subtree never ends a portion */
	const p = openPage(para('one') + '<div class="snow-bg" data-mode="cover">a<br>b</div>' +
		'<p class="cut" data-nopage>cut<br>me</p>' + para('two'));
	eq(cutTags(p).join(' '), 'P ROOT', 'a <br> in a wagon and in [data-nopage] never counts');
	ok(cuts(p).join(' ').indexOf('P.cut') < 0, 'and the [data-nopage] paragraph is not a cut either');
}
{
	/* a picture is content: a section that opens with one is a portion of its own */
	const p = openPage('<div class="cover">title</div><section id="s"><div class="snow-bg" data-mode="cover">art</div>' + para('after') + '</section>');
	eq(cutTags(p).join(' '), 'SECTION#s P ROOT', 'the wagon keeps the section cut alive');
	const q = openPage('<div class="cover">title</div><section id="s">' + para('after') + '</section>');
	eq(cutTags(q).join(' '), 'P ROOT', 'without it the empty section would merge away');
}

/* ---------------- 2. merges: an empty portion is not a cut ---------------- */
{
	const p = openPage(para('one') + '<p></p>' + para('two<br><br>three') + para('four<br>') +
		'<section id="s">' + para('five') + '</section>');
	eq(cutTags(p).join(' '), 'P BR P P ROOT', 'empty <p>, <br><br>, a trailing <br> and a section opening into a <p> all merge');
	ok(mono(p), 'the merged list is still non-decreasing');
	ok(p.SP.count > 0, 'and the story is still readable in pages');
}
{
	/* nothing above the first cut: the opening page would be blank */
	const p = openPage(para('one') + para('two'));
	eq(p.SP.cutN, 2, 'a story that opens on a cut has no blank portion in front of it');
	eq(p.SP.cutY[0], 50, 'the first cut is the first paragraph\'s end');
}
{
	/* data-stops widens the list for one page only */
	const body = para('one') + para('two') + '<hr>rule' + para('three');
	const p = openPage(body);
	eq(cuts(p).join(' '), 'P@50 P@102 ROOT@152', 'an <hr> is ordinary flow by default');
	const q = openPage(body);
	q.el('app').setAttribute('data-stops', 'p,hr');
	q.win.Snowfall.refresh(true);
	eq(cuts(q).join(' '), 'P@50 HR@100 P@102 ROOT@152', 'data-stops="p,hr" makes each <hr> with prose after it a cut');
	eq(q.SP.stops, 'p,section,br', 'the default list is unchanged on other pages');
}
{
	/* an out-of-flow cut loses to the one before it */
	const p = openPage(para('one') + para('two') + para('three'));
	const before = p.SP.cutN;
	const warns = [], warn = console.warn;
	console.warn = m => warns.push(m);
	p.el('app').querySelectorAll('p')[2].layoutY = 5;          /* pulled above its siblings */
	p.win.Snowfall.refresh(true);
	console.warn = warn;
	ok(p.SP.cutN <= before, 'a cut above its predecessor adds no backwards page');
	ok(mono(p), 'and the list stays ordered');
	eq(warns.length, 1, 'the author is told once, not once per cut');
	ok(/out-of-flow/.test(warns[0] || ''), 'and the warning says what is wrong', warns[0]);
}

/* ---------------- 3. the pages: one screenful, cut at the stops ---------------- */
{
	/* short portions merge into one screen */
	const p = openPage(hPara(1) + hPara(1) + hPara(1) + hPara(1) + hPara(1) + hPara(1));
	p.SP.set(true);
	eq(p.SP.count, 1, 'six 50px portions are one screenful');
	eq(p.SP.y[0], 300, 'the page ends at the story end');
}
{
	/* the page ends at the last stop that fits */
	const p = openPage(prose(0) + new Array(20).fill(0).map(() => hPara(1)).join(''));
	p.SP.set(true);
	eq(p.SP.count, 2, '1000px of 50px portions is two screens');
	eq(p.SP.y[0], 800, 'page one ends on the cut at the screen bottom', String(p.SP.y[0]));
	eq(p.SP.y[1], 1000, 'page two takes the rest');
	ok(band(p, 0) === 0, 'a full page needs no blank paper');
	ok(band(p, 1) > 0, 'the short tail page does');
}
{
	/* a portion taller than the screen is a page of its own, walked */
	const p = openPage(hPara(1) + hPara(1) + hPara(1) + hPara(40) + hPara(1) + hPara(1) + hPara(1));
	p.SP.set(true);
	eq(p.SP.count, 3, 'short + tall + short is three pages');
	eq(p.SP.y[0], 150, 'the shorts end their page at the last stop that fits', String(p.SP.y[0]));
	eq(p.SP.y[1] - p.SP.y[0], 24 + 40 * LINE, 'and the tall portion is the whole page after it');
	eq(p.SP.y[1], 150 + 24 + 40 * LINE, 'cut at its own end', String(p.SP.y[1]));
	ok(band(p, 0) > 0, 'the short page before it pads with blank paper, not the tall text');
	eq(p.SP.y[2], p.SP.y[1] + 150, 'and the shorts after it are the last page');
}
{
	/* the cut list is the author's units; pages group them */
	const p = openPage(hPara(1) + hPara(1) + hPara(1) + hPara(40) + hPara(1) + hPara(1) + hPara(1));
	p.SP.set(true);
	eq(p.SP.cutN, 7, 'the walk still sees every cut (6 stops + the end)');
	ok(p.SP.count < p.SP.cutN, 'and pages only group them');
}

/* ---------------- 4. the clamp: the padding box on the page cut ---------------- */
{
	const p = openPage(hPara(1) + hPara(1) + hPara(1) + hPara(40) + hPara(1));
	const r = p.el('app');
	ok(p.SP.set(true), 'set(true) engages');
	eq(r.style.overflowY, 'clip', 'the story root is clipped on the block axis');
	eq(r.style.overflowX, undefined, 'the inline axis is left to the author');
	ok(/\d/.test(r.style.height), 'the story root carries a height', r.style.height);
	p.SP.set(false);
	eq(r.style.height, '', 'set(false) clears the height');
	eq(r.style.overflowY, '', 'set(false) clears the clip');
	eq(r.style.marginBottom, '', 'and the band');
}
{
	/* content-box: height = y[k] − padBoxTop − padTop − padBottom */
	const p = openPage(hPara(4) + hPara(4) + hPara(4), { box: 'content-box', pad: 10, border: 2 });
	const r = p.el('app'), padBoxTop = r.layoutY + 2;
	p.SP.set(true, true);
	const seen = {};
	let guard = 40;
	while (guard-- > 0) {
		seen[p.SP.index] = true;
		const want = (p.SP.y[p.SP.index] - padBoxTop) - 10 - 10;
		ok(Math.abs(parseFloat(r.style.height) - want) < 1e-6, 'content-box page ' + p.SP.index + ' puts the padding box on the cut',
			r.style.height + ' vs ' + want);
		if (!p.SP.next() || seen[p.SP.index]) break;
	}
}
{
	/* border-box: height = y[k] − padBoxTop + borderTop + borderBottom */
	const p = openPage(hPara(4) + hPara(4) + hPara(4), { box: 'border-box', pad: 10, border: 2 });
	const r = p.el('app'), padBoxTop = r.layoutY + 2;
	p.SP.set(true, true);
	const seen = {};
	let guard = 40;
	while (guard-- > 0) {
		seen[p.SP.index] = true;
		const want = (p.SP.y[p.SP.index] - padBoxTop) + 2 + 2;
		ok(Math.abs(parseFloat(r.style.height) - want) < 1e-6, 'border-box page ' + p.SP.index + ' puts the padding box on the cut',
			r.style.height + ' vs ' + want);
		if (!p.SP.next() || seen[p.SP.index]) break;
	}
}

/* ---------------- 5. stepping: one screenful a tap ---------------- */
{
	const p = openPage(hPara(1) + hPara(1) + hPara(1) + hPara(90) + hPara(1) + hPara(1) + hPara(1) + hPara(1));
	const SP = p.SP, r = p.el('app');
	SP.smooth = 0;
	SP.set(true, true);
	eq(SP.index, 0, 'set(true, true) starts at page one');
	eq(p.win.scrollY, 0, 'at the top of the document');
	eq(SP.top(), 0, 'and the first page is read at the top');
	ok(SP.next(), 'a tap advances');
	eq(SP.index, 1, 'exactly one page a tap');
	eq(p.win.scrollY, start(p, 1), 'the new page opens on its own first line');
	/* this page is taller than the screen: the taps walk it, a band at a time,
	   and reveal nothing while walking */
	const tallY = SP.y[1], openY = p.win.scrollY;
	eq(tallY - openY, 24 + 90 * LINE, 'page two is the tall portion');
	eq(SP.top(), tallY - VH, 'and is done at its last window');
	let guard = 20, steps = 0;
	while (p.win.scrollY < SP.top() - 1 && guard-- > 0) {
		const before = p.win.scrollY;
		SP.next();
		steps++;
		ok(p.win.scrollY - before <= VH + 1e-6, 'walk step ' + steps + ' moves at most one window', String(p.win.scrollY - before));
	}
	ok(steps > 1, 'it takes several taps to walk down it (' + steps + ')');
	eq(p.win.scrollY, SP.top(), 'and the reader ends on its last line');
	eq(SP.index, 1, 'with no page revealed while walking');
	ok(SP.next(), 'the next tap reveals the page after it');
	eq(SP.index, 2, 'which is the shorts after the tall portion');
	eq(p.win.scrollY, start(p, 2), 'opened on its own first line');
	/* a reader who wheeled back up is hurried, not turned */
	p.win.setScroll(Math.max(0, SP.top() - 300));
	const k = SP.index, sY = p.win.scrollY;
	SP.next();
	eq(SP.index, k, 'a tap above this page\'s done line reveals nothing');
	ok(p.win.scrollY <= sY + VH + 1e-6, 'it only scrolls, and never more than a window', String(p.win.scrollY - sY));
	guard = 20;
	while (guard-- > 0 && SP.next()) { }
	eq(SP.index, SP.count - 1, 'stepping ends on the last page');
	eq(SP.top(), p.win.scrollY, 'and parks the reader on its done line');
	eq(SP.next(), false, 'and the end of the story says stop');
}
{
	/* every page opens on its own first line — the text before it is behind
	   the reader — and pads the paper to a full window when it is short */
	const p = openPage('<div class="cover">title</div>' + prose(6));
	const SP = p.SP;
	SP.smooth = 0;
	SP.set(true, true);
	let clean = true, opens = true, bands = 0, last = -1;
	while (SP.next()) {
		if (SP.index === last) continue;                 /* a hurry, not a turn */
		last = SP.index;
		if (p.win.scrollY !== open(p, SP.index)) opens = false;
		if (p.win.scrollY < start(p, SP.index) - 1e-6) clean = false;
		if (band(p, SP.index) > 0) {
			bands++;
			eq(parseFloat(p.el('app').style.marginBottom), band(p, SP.index), 'page ' + SP.index + ' pads the paper to a full window');
		}
	}
	ok(opens, 'every page opens on its own first line');
	ok(clean, 'and no page ever shows text from before its portion');
	ok(bands > 0, 'short pages get the empty band under them (' + bands + ')', String(bands));
	SP.set(false);
	eq(p.el('app').style.marginBottom, '', 'and book mode takes the band away again');
}

/* ---------------- 6. padTop / padBottom: the chrome is cleared ---------------- */
{
	/* 76px portions: the last cut that fits shows exactly where the band ends */
	const p = openPage(new Array(12).fill(0).map(() => hPara(2)).join(''));
	const SP = p.SP;
	SP.smooth = 0;
	SP.padTop = 48;
	SP.set(true, true);
	eq(SP.y[0], 684, 'page one ends on the last cut that fits a 752px band', String(SP.y[0]));
	ok(SP.next(), 'a tap advances');
	eq(p.win.scrollY, start(p, 1) - 48, 'the page opens 48px below the window top, under the chrome');
	eq(SP.top(), Math.max(start(p, 1) - 48, SP.y[1] - VH), 'and is done at its last window');
	eq(parseFloat(p.el('app').style.marginBottom), band(p, 1), 'the band pads to the window bottom');
	SP.padTop = 0;
	SP.padBottom = 30;
	SP.set(false);
	SP.set(true, true);
	eq(SP.y[0], 760, 'padBottom shrinks the band the same way: the last cut that fits 770px', String(SP.y[0]));
	SP.padBottom = 0;
}

/* ---------------- 7. set(true) at a position, and re-measure ---------------- */
{
	/* the read-only surface cannot be written through, even in sloppy code */
	const p = openPage(para('one') + para('two'));
	const SP = p.SP;
	SP.count = 99; SP.index = 42; SP.cutN = 7;
	eq(SP.cutN, 2, 'cutN stays the real count after an assignment');
	eq(SP.count, 1, 'count stays the real count (two short portions are one page)');
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
		eq(SP.index, want, 'set(true) at ' + at + 'px takes the page holding the window bottom');
	}
	SP.set(false);
	SP.set(true);
	ok(SP.index >= 0, 'a round trip through book mode keeps a page');
}
{
	/* a source edit above the reader must not move the frontier */
	const p = openPage(hPara(17) + hPara(17) + hPara(17) + hPara(17));
	const SP = p.SP;
	SP.smooth = 0;
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
	eq(SP.at(SP.index), keep, 'the reader is still on the same page, kept by its cut element');
	ok(SP.y[SP.index] > keepY, 'which moved down with the text', SP.y[SP.index] + ' vs ' + keepY);
}

/* ---------------- 8. the story changes its own height ---------------- */
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
	const p = openPage(hPara(17) + hPara(17) + hPara(17) + hPara(17) + hPara(17) + hPara(17));
	const ticks = [];
	p.win.setTimeout = fn => { ticks.push(fn); return 1; };
	const SP = p.SP;
	SP.smooth = 0;
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
	eq(SP.y[SP.index - 1], wasStart + 100, 'its page moved down with the story');
	eq(p.win.scrollY, wasY + 100, 'and the reader moved with it: no earlier text on the page');
	ok(p.win.scrollY >= SP.y[SP.index - 1] - 1e-6, 'never above the page\'s own start');

	/* the reader who wheeled up to re-read, then the story moved: the page's
	   own new start, not the text before it */
	p.win.setScroll(SP.y[SP.index - 1] - 20);
	const grew = para_el('another growth above the reader');
	grew._h = 50;
	grew.layoutY = seated.layoutY;
	reflow(app, grew.layoutY, grew._h);
	app.insertBefore(grew, seated);
	mo.cb([], mo);
	ticks[ticks.length - 1]();
	eq(p.win.scrollY, open(p, SP.index), 'a reader above their page is put on its new start');

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
	eq(p.win.scrollY, open(p, SP.index), 'and landed on the moved page, not the stale one');
	ticks[ticks.length - 1]();                /* leave nothing pending */
	delete global.MutationObserver;
}

/* ---------------- 9. input ---------------- */
{
	const p = openPage(new Array(10).fill(0).map(() => hPara(17)).join('') + '<a href="#x" id="link">go</a>');
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

/* ---------------- 10. no engine on the page ---------------- */
{
	const bare = '<!doctype html><html data-story="gate-paged"><head></head><body><div id="app">' +
		para('one') + para('two') + '</div><script src="snowfall-paged.js"></script></body></html>';
	const p = FD.buildPage(bare, VH, { measure: measure, dir: ROOT });
	const SP = p.win.SnowfallPaged;
	ok(!!SP, 'the controller still loads and exports without an engine');
	eq(SP.count, 0, 'and has nothing to say');
	eq(SP.cutN, 0, 'no cuts either');
	eq(SP.set(true), false, 'set(true) is a quiet false');
	eq(SP.set(false), false, 'set(false) is a quiet false');
	eq(SP.next(), false, 'next is a quiet false');
	eq(SP.prev(), false, 'prev is a quiet false');
	eq(SP.get(), false, 'get is false');
	eq(p.el('app').style.height, undefined, 'and nothing was written to the page');
	let threw = null;
	try { SP.set(true); SP.next(); SP.prev(); SP.at(0); SP.cutAt(0); } catch (e) { threw = e; }
	ok(!threw, 'no throw anywhere on that path', threw && threw.message);
}

/* ---------------- 11. the source keeps the engine's contracts ---------------- */
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
	for (const name of ['charY', 'stopY', 'readBox', 'walk', 'groupPages', 'frame', 'apply', 'next', 'prev', 'onUp', 'onKey']) {
		ok(fn(name) !== '', name + '() is there');
	}
	ok(layout.test(fn('charY')) && layout.test(fn('stopY')) && layout.test(fn('readBox')),
		'the boxes are read in charY(), stopY() and readBox()');
	ok(!layout.test(fn('walk')), 'the walk itself reads no boxes (stopY does)');
	ok(!layout.test(fn('groupPages')), 'the screenful rule reads no boxes');
	ok(!layout.test(fn('frame')), 'frame() reads no layout at all');
	ok(!layout.test(fn('next')) && !layout.test(fn('prev')), 'next() and prev() read no layout');
	ok(!layout.test(fn('onUp')) && !layout.test(fn('onKey')), 'the input handlers read no layout');
	ok(!layout.test(fn('onMutate')) && !layout.test(fn('onTick')) && !layout.test(fn('anchor')),
		'the change watch and the re-anchor read no layout (measure does the reading)');
	ok(fn('onMutate') !== '' && fn('onTick') !== '' && fn('anchor') !== '', 'the watch, its tick and the re-anchor are there');
}

console.log('paged: ' + (checks - fails) + '/' + checks + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
