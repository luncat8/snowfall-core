/* vn-proto.js — the rig shared by the VN-mode prototypes.

	Every variant answers the same question — what drives wagons, theme and
	scripts when the reader does not scroll — on the real engine, unchanged:
	snowfall.js measures and runs the story, snowfall-paged.js supplies the
	author's stops (its walk runs on every engine refresh; it is never switched
	on here). This file only adds what a variant needs around them:

	  drv      where the position lives: the window (reader locked out) or a
	           fixed stage that is the scrollport, so the window never scrolls
	  step     one engine frame; events may be fed a reading position that is
	           not the scroll position (VN.read)
	  quietly  a layout change the event machine must not witness
	  glide    an eased move that never lets an anchor leap the window
	  film     pages padded to exact screens (spacers the controller owns)
	  feed     one rest per portion, its end on the fold
	  ink      text after the cursor has no ink (CSS Custom Highlight API)
	  shell    toolbar, script log, self-test

	Prototype code: what it needed from the engine through the back door is the
	list of engine changes each variant would cost — see README.md. */
(function() {
'use strict';
const $ = id => document.getElementById(id);
const html = document.documentElement;
const app = $('app'), stage = $('stage');
const params = new URLSearchParams(location.search);
const FURNITURE = '.snow-a,.snow-bg,script,style,.vn-pad';
const NO_TAP = 'a,button,input,select,textarea,label,summary,[contenteditable],.snow-prompt,#bar,#about,#qa';
const LEAD_PX = 8;
const SPEEDS = [['0', 'instant'], ['0.5', 'fast'], ['1', 'normal'], ['4', 'slow ×4']];

const VN = window.VN = {
	speed: 1,
	gate: true,                 /* a pending Snowfall.ask holds the story */
	read: null,                 /* function(scroll) → reading position for events; null = events ride the scroll */
	alias: false,               /* reading-position frames cannot see the wagons: `parked` fires as `view` */
	ctl: null,
	marks: { seen: [], bad: 0, skips: 0 }
};
const S = () => window.Snowfall;
const inst = () => window.Snowfall.default;
VN.viewH = () => S().viewport.height || window.innerHeight;

/* ---------------- driver: where the position lives ---------------- */
const drv = VN.drv = {
	stage: (params.get('driver') || html.dataset.driver) === 'stage',
	get: () => drv.stage ? stage.scrollTop : window.scrollY,
	set: function(y) { if (drv.stage) stage.scrollTop = y; else window.scrollTo(0, y); },
	max: () => drv.stage ? stage.scrollHeight - stage.clientHeight : html.scrollHeight - window.innerHeight
};
html.classList.toggle('vn-stage', drv.stage);
VN.lock = on => html.classList.toggle('vn-lock', !!on);
/* content Y of a node: one formula for both drivers (the stage sits at 0,0) */
VN.y = node => node.getBoundingClientRect().top + drv.get();

/* ---------------- engine stepping ---------------- */
let quiet = 0, kept = null, forget = false;
VN.step = function() {
	if (quiet) return;
	const o = inst().options, s = drv.get();
	if (!VN.read) { o.events = 1; inst().step(s); return; }
	/* events first, at the reading position; then wagons and theme at the
		scroll, so what is painted is the scroll's and nothing else. Between
		steps events stay off: the engine's own scroll frame must not read the
		anchors against the scroll. */
	o.events = 1; o.wagons = VN.alias ? 0 : 1;
	inst().step(VN.read(s));
	o.events = 0; o.wagons = 1;
	inst().step(s);
};
function snapshot() {
	const E = inst().events, m = new Map();
	for (let i = 0; i < E.n; i++) m.set(E.els[i], E.flags[i]);
	return m;
}
function restore(m) {
	const E = inst().events;
	for (let i = 0; i < E.n; i++) {
		const f = m.get(E.els[i]);
		if (f !== undefined) E.flags[i] = f;
	}
}
/* A relayout (spacers in or out, a resize, a mode switch) passes through
	positions the reader never held, and every engine refresh forgets which
	anchors already fired. Events are off for the whole change and the flags
	are carried across by anchor element, so nothing fires twice and nothing
	fires for a place that was only a transient. */
VN.quietly = function(work) {
	if (quiet++ === 0) {
		/* a refresh drops a pending question: nothing is carried then, so the
			script that asked is free to ask again */
		kept = S().store.pending ? null : snapshot();
		inst().options.events = 0;
	}
	try { work(); }
	finally { if (--quiet === 0) unquiet(); }
};
function unquiet() {
	if (kept && !forget) restore(kept);
	kept = null; forget = false;
	VN.step();
}
/* a refresh that does forget: restart re-arms every script */
VN.rearm = function() { forget = true; S().refresh(); };
VN.rig = function() {
	const core = inst(), refresh0 = core.refresh;
	if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
	/* the engine measures against window.scrollY. With a stage that is always
		0, so the stage is put at 0 for the measure: content == viewport there */
	core.refresh = function(replay) {
		VN.quietly(function() {
			const s = drv.get();
			if (drv.stage) stage.scrollTop = 0;
			refresh0(replay);
			if (drv.stage) stage.scrollTop = s;
		});
	};
	if (drv.stage) stage.addEventListener('scroll', VN.step, { passive: true });
	/* the story stays quiet until the variant has laid out its first screen:
		the engine's boot refresh would otherwise fire every script the plain
		book layout happens to show at scroll 0 */
	quiet = 1;
	core.options.events = 0;
};
VN.open = function() { if (--quiet === 0) unquiet(); };
VN.startsAsBook = () => params.get('mode') === 'book';

/* ---------------- motion ---------------- */
let tw = null;
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
VN.busy = () => !!tw;
VN.settle = function() {
	if (!tw) return;
	const t = tw;
	tw = null;
	cancelAnimationFrame(t.raf);
	t.frame(1);
	if (t.done) t.done();
};
VN.tween = function(ms, frame, done, linear) {
	VN.settle();
	ms *= VN.speed;
	if (!(ms > 0)) { frame(1); if (done) done(); return; }
	const t = tw = { frame: frame, done: done, raf: 0 };
	const t0 = performance.now();
	function tick(now) {
		if (tw !== t) return;
		const u = Math.min(1, (now - t0) / ms);
		frame(u >= 1 ? 1 : linear ? u : ease(u));
		if (u < 1) { t.raf = requestAnimationFrame(tick); return; }
		tw = null;
		if (done) done();
	}
	t.raf = requestAnimationFrame(tick);
};
/* The scroll event for a programmatic move arrives a frame late, so the engine
	is stepped here, in the same task as the write. A jump is cut into steps of
	half a window: no anchor may cross the whole window inside one engine frame,
	or its `view` is lost and it is reported skipped. */
VN.moveTo = function(y) {
	const half = VN.viewH() * 0.5;
	let cur = drv.get();
	while (Math.abs(y - cur) > half) {
		cur += y > cur ? half : -half;
		drv.set(cur);
		VN.step();
	}
	drv.set(y);
	VN.step();
};
VN.glide = function(to, ms, done) {
	VN.settle();
	const from = drv.get();
	VN.tween(Math.abs(to - from) < 0.5 ? 0 : ms, t => VN.moveTo(t >= 1 ? to : from + (to - from) * t), done);
};

/* ---------------- the author's stops ---------------- */
const C = VN.cuts = { n: 0, y: [], el: [], top: 0 };
VN.readCuts = function() {
	const P = window.SnowfallPaged, cs = getComputedStyle(app);
	C.n = P.cutN;
	C.y.length = C.el.length = C.n;
	for (let i = 0; i < C.n; i++) { C.y[i] = P.cutY[i]; C.el[i] = P.cutAt(i); }
	C.top = VN.y(app) + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
};
/* portion i runs from the cut before it to its own cut */
VN.start = i => i > 0 ? C.y[i - 1] : C.top;
/* the portion being read when content Y `y` is the top of the reading area */
VN.portionAt = function(y) {
	for (let i = 0; i < C.n; i++) if (C.y[i] > y + 1) return i;
	return C.n - 1;
};
/* A reader who switches to the book and straight back has not moved: the
	portion is remembered with the scroll it was left at, because a scroll
	position alone cannot tell a heading from the line under it. */
let leftAt = -1, leftPortion = 0;
VN.left = function(portion) { leftAt = drv.get(); leftPortion = portion; };
VN.resume = guess => Math.abs(drv.get() - leftAt) < 2 ? leftPortion : guess;
/* content Y of the first glyph of portion i: the probe's ground truth */
const glyph = new Range();
VN.glyphY = function(i) {
	const nodes = VN.ink.textNodes(i);
	if (!nodes.length) return VN.start(i);
	const at = nodes[0].nodeValue.search(/\S/);
	glyph.setStart(nodes[0], at);
	glyph.setEnd(nodes[0], at + 1);
	return glyph.getBoundingClientRect().top + drv.get();
};
/* the picture that opens portion i, or -1 */
VN.lead = function(i) {
	const W = S().wagons, y0 = VN.start(i);
	for (let j = 0; j < W.n; j++) if (Math.abs(W.y[j] - y0) <= LEAD_PX) return j;
	return -1;
};
/* the DOM boundary of cut i as one end of a range (i < 0: the story's start) */
VN.bound = function(range, i, isStart) {
	const el = i < 0 ? null : C.el[i];
	if (!el || el === app) {
		const off = el ? app.childNodes.length : 0;
		if (isStart) range.setStart(app, off); else range.setEnd(app, off);
		return;
	}
	const after = el.tagName === 'BR';
	if (isStart) { if (after) range.setStartAfter(el); else range.setStartBefore(el); }
	else if (after) range.setEndAfter(el); else range.setEndBefore(el);
};
VN.portionRange = function(i) {
	const r = new Range();
	VN.bound(r, i - 1, true);
	VN.bound(r, i, false);
	return r;
};
function isFurniture(node) {
	if (node.nodeType === 3) return !/\S/.test(node.nodeValue);
	return node.nodeType !== 1 || node.matches('.snow-a,script,style');
}
/* the outermost node that opens at the same place as `node`: a spacer goes
	above it, so every anchor glued to that place (a section's own style
	marker, a script just above a line) stays with the page it belongs to */
function hoist(node) {
	for (;;) {
		let p = node.previousSibling;
		while (p && isFurniture(p)) { node = p; p = node.previousSibling; }
		if (p || node.parentNode === app) return node;
		node = node.parentNode;
	}
}
function spacer(h) {
	const i = document.createElement('i');
	i.className = 'vn-pad';
	i.setAttribute('data-nopage', '');
	i.setAttribute('aria-hidden', 'true');
	if (h) i.style.height = h + 'px';
	return i;
}
function clearSpacers() {
	const old = app.querySelectorAll('.vn-pad');
	for (let i = 0; i < old.length; i++) old[i].remove();
}

/* ---------------- film: pages padded to exact screens ---------------- */
const F = VN.film = { pages: [] };
F.clear = clearSpacers;
F.pageOf = function(portion) {
	for (let k = 0; k < F.pages.length; k++) if (portion <= F.pages[k].last) return k;
	return F.pages.length - 1;
};
/* the last rest of page k: its own start unless the page is taller than a screen */
F.endRest = k => (k + 1 < F.pages.length ? F.pages[k + 1].s : F.pages[k].s + F.pages[k].len) - VN.viewH();
/* The steps of a filmed story, into `out` as { s, k, i }: scroll, page, and the
	last portion read. perPortion: one step for every portion of a page, else
	one for the page; stride > 0: a page taller than a screen is walked. */
F.steps = function(out, perPortion, stride) {
	out.length = 0;
	for (let k = 0; k < F.pages.length; k++) {
		const pg = F.pages[k], end = F.endRest(k);
		for (let i = perPortion ? pg.first : pg.last; i <= pg.last; i++) out.push({ s: pg.s, k: k, i: i });
		if (!(stride > 0)) continue;
		for (let s = pg.s; s < end - 1;) { s = Math.min(end, s + stride); out.push({ s: s, k: k, i: pg.last }); }
	}
};
/* the first step that has read portion `portion` */
F.stepOf = function(steps, portion) {
	for (let n = 0; n < steps.length; n++) if (steps[n].i >= portion) return n;
	return steps.length - 1;
};
function padFilter(node) {
	if (node.nodeType === 3) return /\S/.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
	if (node.matches(FURNITURE)) return NodeFilter.FILTER_REJECT;
	/* a container that opens with a picture: the top margin goes under the picture */
	return node.querySelector('.snow-bg') ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT;
}
function firstContentAfter(node) {
	const w = document.createTreeWalker(app, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, padFilter);
	w.currentNode = node;
	return w.nextNode();
}
function group(opt) {
	const vh = VN.viewH(), n = C.n, pages = F.pages;
	pages.length = 0;
	for (let i = 0; i < n;) {
		const head = pages.length ? opt.top : C.top, room = vh - head - opt.bottom, y0 = VN.start(i);
		let j = i;
		while (j + 1 < n && C.y[j + 1] - y0 <= room && !(opt.pictures && VN.lead(j + 1) >= 0)) j++;
		const h = C.y[j] - y0, tall = h > room;
		pages.push({ first: i, last: j, lead: pages.length ? VN.lead(i) : -1, tall: tall,
			len: tall ? Math.ceil(head + h + opt.bottom) : vh, s: 0, pad: null });
		i = j + 1;
	}
}
/* Two spacers a page edge: the fill ends the page a whole screen after its
	start, the pad is the next page's top margin — placed under the picture
	when a picture opens the page, so the picture parks at the very top.
	Sized by measuring, never by adding up: a spacer changes which margins
	collapse around it. The fill lands the next page on an integer Y, because
	scroll positions are integers and a wagon is parked only at free <= 0. */
function place(opt) {
	const W = S().wagons, pages = F.pages;
	let s = 0;
	for (let k = 0; k < pages.length; k++) {
		const pg = pages[k], nx = pages[k + 1], fill = spacer(0);
		if (!nx) {
			app.appendChild(fill);
			fill.style.height = Math.max(0, s + pg.len - app.getBoundingClientRect().bottom - drv.get()) + 'px';
			return;
		}
		const picture = nx.lead >= 0 ? W.els[nx.lead] : null, stop = C.el[pg.last];
		if (picture) { const at = hoist(picture.__snowA); at.parentNode.insertBefore(fill, at); }
		else if (stop.tagName === 'BR') stop.parentNode.insertBefore(fill, stop.nextSibling);
		else { const at = hoist(stop); at.parentNode.insertBefore(fill, at); }
		nx.pad = spacer(opt.top);
		const content = firstContentAfter(fill);
		if (content) content.parentNode.insertBefore(nx.pad, content); else app.appendChild(nx.pad);
		s += pg.len;
		fill.style.height = Math.max(0, s - VN.y(picture ? picture.__snowA : nx.pad)) + 'px';
	}
}
/* opt: { top, bottom, pictures } — the chrome's clearances in px, and whether
	a picture always opens a page */
F.layout = function(opt) {
	VN.quietly(function() {
		F.clear();
		S().refresh();
		VN.readCuts();
		group(opt);
		place(opt);
		S().refresh();
		VN.readCuts();
		/* the rests are read back from the padded document, not assumed */
		const W = S().wagons;
		for (let k = 1; k < F.pages.length; k++) {
			const pg = F.pages[k];
			pg.s = Math.ceil((pg.lead >= 0 ? W.y[pg.lead] : VN.y(pg.pad)) - 1 / 128);
		}
	});
};

/* ---------------- feed: one rest per portion, its end on the fold ---------------- */
const D = VN.feed = { rests: [], beat: false };
D.clear = function() {
	clearSpacers();
	app.style.marginBottom = '';
	const pics = app.querySelectorAll('.snow-bg[data-vn-beat]');
	for (let i = 0; i < pics.length; i++) { pics[i].removeAttribute('data-gap'); pics[i].removeAttribute('data-vn-beat'); }
	D.beat = false;
};
D.restOf = function(portion) {
	let r = 0;
	for (let i = 0; i < D.rests.length; i++) if (D.rests[i].i <= portion) r = i;
	return r;
};
/* opt: { top, bottom, beat, walk }
	bottom  the fold sits this far above the window's bottom edge
	beat    every cover picture takes a screen of flow for itself (the engine's
	        own data-gap), so it arrives in one step instead of a line at a time
	walk    a portion taller than the fold is read in several rests */
D.layout = function(opt) {
	VN.quietly(function() {
		D.clear();
		const vh = VN.viewH();
		if (opt.beat) {
			const pics = app.querySelectorAll('.snow-bg:not([data-mode]),.snow-bg[data-mode=cover]');
			for (let i = 0; i < pics.length; i++) {
				if (pics[i].hasAttribute('data-gap')) continue;
				pics[i].setAttribute('data-gap', '100vh');
				pics[i].setAttribute('data-vn-beat', '');
			}
			D.beat = true;
		}
		/* a blank screen before the story: the first portion's end must be
			able to sit on the fold too */
		app.insertBefore(spacer(vh), app.firstChild);
		/* and room after it for the last one — a margin, outside the story's
			own box, so the story's end stays where its text ends */
		app.style.marginBottom = opt.bottom + 'px';
		S().refresh();
		VN.readCuts();
		const W = S().wagons, fold = vh - opt.bottom, room = fold - opt.top, max = drv.max(), rests = D.rests;
		rests.length = 0;
		for (let i = 0; i < C.n; i++) {
			const base = Math.min(max, Math.floor(C.y[i] - fold));
			const j = VN.lead(i), beat = j >= 0 && W.els[j].hasAttribute('data-vn-beat') ? vh : 0;
			const top = VN.start(i) + beat + (i ? 0 : vh);
			if (opt.walk && C.y[i] - top > room)
				for (let s = Math.floor(top - opt.top); s < base - 1; s += Math.floor(room * 0.85)) rests.push({ s: s, i: i });
			rests.push({ s: base, i: i });
		}
	});
};

/* ---------------- ink: unread text is in the page and has no ink ---------------- */
/* Two highlights, no DOM change: text after the cursor is transparent, text
	before it carries the readability halo — a text-shadow on the element
	itself would still be painted under transparent glyphs. Boxes that paint
	on their own (a caption, an underline) are hidden as a whole while they
	start below the cursor. */
const I = VN.ink = { unread: null, read: null, cand: [], live: false };
I.on = function() {
	I.off();
	if (!I.unread) { I.unread = new Range(); I.read = new Range(); }
	CSS.highlights.set('vn-unread', new Highlight(I.unread));
	CSS.highlights.set('vn-read', new Highlight(I.read));
	html.classList.add('vn-ink');
	I.live = true;
	html.classList.add('vn-measure');
	const all = app.querySelectorAll('*');
	I.cand.length = 0;
	for (let i = 0; i < all.length; i++) {
		const el = all[i];
		if (el.matches(FURNITURE) || el.querySelector('.snow-bg')) continue;
		I.cand.push({ el: el, y: VN.y(el), off: false });
	}
	html.classList.remove('vn-measure');
};
I.off = function() {
	if (!I.live) return;
	I.live = false;
	CSS.highlights.delete('vn-unread');
	CSS.highlights.delete('vn-read');
	html.classList.remove('vn-ink');
	for (let i = 0; i < I.cand.length; i++) I.cand[i].el.classList.remove('vn-off');
	I.cand.length = 0;
};
/* everything up to cut i is read */
I.cut = function(i) {
	VN.bound(I.unread, i, true);
	I.unread.setEnd(app, app.childNodes.length);
	I.read.setStart(app, 0);
	VN.bound(I.read, i, false);
	const y = C.y[i] - 0.5;
	for (let k = 0; k < I.cand.length; k++) {
		const c = I.cand[k], off = c.y >= y;
		if (off === c.off) continue;
		c.off = off;
		c.el.classList.toggle('vn-off', off);
	}
};
/* the ink edge inside a text node: a typewriter is the same two ranges */
I.edge = function(node, offset) {
	I.unread.setStart(node, offset);
	I.read.setEnd(node, offset);
};
I.textNodes = function(i) {
	const r = VN.portionRange(i), out = [];
	const w = document.createTreeWalker(app, NodeFilter.SHOW_TEXT);
	for (let n = w.nextNode(); n; n = w.nextNode()) {
		const side = r.comparePoint(n, 0);
		if (side > 0) break;
		if (side === 0 && n.nodeValue.trim() && !n.parentNode.closest(FURNITURE)) out.push(n);
	}
	return out;
};

/* ---------------- input ---------------- */
function nudge() {
	const p = document.querySelector('.snow-prompt');
	if (!p) return;
	p.classList.remove('nudge');
	void p.offsetWidth;
	p.classList.add('nudge');
}
/* a tap during a move finishes the move: the next tap is the next step */
VN.next = function() {
	if (VN.busy()) { VN.settle(); VN.stat(); return true; }
	if (VN.gate && S().store.pending) { nudge(); return false; }
	const moved = VN.ctl.next();
	VN.stat();
	return moved;
};
VN.prev = function() {
	if (VN.busy()) VN.settle();
	const moved = VN.ctl.prev();
	VN.stat();
	return moved;
};
VN.input = function() {
	let down = null, wheelAt = 0;
	window.addEventListener('pointerdown', function(e) {
		down = e.isPrimary !== false && !e.button ? { x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
	}, { passive: true });
	window.addEventListener('pointerup', function(e) {
		const d = down;
		down = null;
		if (!d || !VN.ctl.isVN()) return;
		if (Math.abs(e.clientX - d.x) > 8 || Math.abs(e.clientY - d.y) > 8 || e.timeStamp - d.t > 500) return;
		if ((e.target.closest && e.target.closest(NO_TAP)) || !window.getSelection().isCollapsed) return;
		VN.next();
	}, { passive: true });
	window.addEventListener('wheel', function(e) {
		if (!VN.ctl.isVN() || e.ctrlKey || (e.target.closest && e.target.closest(NO_TAP + ',#box'))) return;
		if (e.timeStamp - wheelAt < 320 || Math.abs(e.deltaY) < 12) return;
		wheelAt = e.timeStamp;
		if (e.deltaY > 0) VN.next(); else VN.prev();
	}, { passive: true });
	window.addEventListener('keydown', function(e) {
		if (!VN.ctl.isVN() || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.target.closest && e.target.closest('button,select,input,textarea,a')) return;
		const k = e.key;
		if (k === ' ' || k === 'Enter' || k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown') VN.next();
		else if (k === 'Backspace' || k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') VN.prev();
		else return;
		e.preventDefault();
	});
};

/* the variant's relayout: on a window resize, or when the toolbar changes height */
let relayout = null;
VN.relayout = function() {
	VN.settle();
	syncBar();
	if (relayout) relayout();
	VN.stat();
};
VN.onResize = function(work) {
	let timer = 0, w = window.innerWidth, h = window.innerHeight;
	relayout = work;
	window.addEventListener('resize', function() {
		clearTimeout(timer);
		timer = setTimeout(function() {
			if (window.innerWidth === w && window.innerHeight === h) return;
			w = window.innerWidth; h = window.innerHeight;
			VN.relayout();
		}, 120);
	});
};

/* ---------------- shell: toolbar, log, about ---------------- */
const lines = [];
let where = '—', statQueued = false;
function paintLog() {
	const box = $('log');
	if (!box) return;
	const M = VN.marks, total = window.VN_STORY.marks;
	let got = 0;
	for (let i = 1; i <= total; i++) if (M.seen[i]) got++;
	const bad = M.bad || M.skips;
	box.textContent = '';
	const add = (cls, text) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; box.appendChild(d); };
	add('where', where);
	add('seq' + (bad ? ' bad' : ''), 'scripts ' + got + '/' + total + (bad ? ' · ✗ ' + M.bad + ' out of order, ' + M.skips + ' skipped' : ' · in order ✓'));
	for (let i = Math.max(0, lines.length - 9); i < lines.length; i++) add(lines[i].kind, lines[i].text);
}
VN.log = function(kind, text) {
	lines.push({ kind: kind, text: text });
	if (lines.length > 300) lines.shift();
	paintLog();
};
VN.onPlace = null;
VN.place = function(text) {
	where = text;
	paintLog();
	if (VN.onPlace) VN.onPlace(text);
};
VN.clearLog = function() {
	lines.length = 0;
	VN.place('—');
	VN.marks.seen.length = 0;
	VN.marks.bad = VN.marks.skips = 0;
	paintLog();
};
VN.stat = function() {
	if (statQueued) return;
	statQueued = true;
	requestAnimationFrame(function() {
		statQueued = false;
		const on = VN.ctl.isVN(), b = $('bMode');
		b.textContent = on ? 'VN mode' : 'book mode';
		b.setAttribute('aria-pressed', on ? 'true' : 'false');
		$('stat').textContent = VN.ctl.status();
	});
};
function select(label, options, value, onchange) {
	const wrap = document.createElement('label'), sel = document.createElement('select');
	wrap.textContent = label + ' ';
	for (let i = 0; i < options.length; i++) {
		const o = document.createElement('option');
		o.value = options[i][0];
		o.textContent = options[i][1];
		sel.appendChild(o);
	}
	sel.value = value;
	sel.addEventListener('change', function() { onchange(sel.value); sel.blur(); });
	wrap.appendChild(sel);
	return wrap;
}
function button(id, text, title, onclick) {
	const b = document.createElement('button');
	b.type = 'button';
	b.id = id;
	b.textContent = text;
	b.title = title;
	b.addEventListener('click', function() { onclick(); b.blur(); });
	return b;
}
/* cfg: { title, ctl, drivers, controls: [{ label, options, value, set }] }
	ctl: { next, prev, restart, setVN, isVN, status, probe } */
VN.shell = function(cfg) {
	VN.ctl = cfg.ctl;
	const bar = document.createElement('div'), log = document.createElement('aside'), about = document.createElement('aside');
	bar.id = 'bar';
	const home = document.createElement('a');
	home.href = 'index.html';
	home.textContent = 'all variants';
	const name = document.createElement('b');
	name.textContent = cfg.title;
	const more = document.createElement('span');
	more.className = 'more';
	bar.append(home, name,
		button('bMode', 'VN mode', 'book ⇄ VN (v)', function() { cfg.ctl.setVN(!cfg.ctl.isVN()); VN.stat(); }),
		button('bPrev', 'back', 'one step back (Backspace)', VN.prev),
		button('bNext', 'next', 'one step on (Space, tap)', VN.next),
		button('bMore', 'more', 'the rest of the controls', function() { html.classList.toggle('bar-open'); VN.relayout(); }),
		more);
	more.append(button('bRestart', 'restart', 'restart the story', function() { cfg.ctl.restart(); VN.stat(); }));
	if (cfg.drivers !== false) more.append(select('scroll', [['window', 'window, locked'], ['stage', 'stage, no window scroll']],
		drv.stage ? 'stage' : 'window', function(v) { params.set('driver', v); location.search = params.toString(); }));
	more.append(select('speed', SPEEDS, String(VN.speed), function(v) { VN.speed = +v; }));
	const extra = cfg.controls || [];
	for (let i = 0; i < extra.length; i++) more.append(select(extra[i].label, extra[i].options, extra[i].value, extra[i].set));
	more.append(button('bCheck', 'self-test', 'walk the story both ways and check it', VN.check),
		button('bLog', 'log', 'script log (l)', function() { html.classList.toggle('log-flip'); }),
		button('bAbout', 'about', 'what this variant is', function() { about.hidden = !about.hidden; }));
	const stat = document.createElement('span');
	stat.id = 'stat';
	bar.append(stat);
	log.id = 'log';
	log.className = 'panel';
	about.id = 'about';
	about.className = 'panel';
	about.hidden = true;
	const src = $('about-src');
	if (src) about.append(src.content.cloneNode(true));
	const qa = document.createElement('output');
	qa.id = 'qa';
	qa.className = 'panel';
	qa.hidden = true;
	stat.textContent = '\u00a0';
	document.body.append(bar, log, about, qa);
	syncBar();
	window.addEventListener('keydown', function(e) {
		if (e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest('select,input,textarea'))) return;
		if (e.key === 'v') { cfg.ctl.setVN(!cfg.ctl.isVN()); VN.stat(); }
		else if (e.key === 'l') $('bLog').click();
	});
	paintLog();
	VN.stat();
	return bar;
};
/* The story's top padding follows the toolbar's height, so that height is
	written only where a relayout follows — never from a read. */
VN.barH = () => $('bar').offsetHeight;
function syncBar() { html.style.setProperty('--bar-h', VN.barH() + 'px'); }

/* ---------------- self-test: walk the story both ways ---------------- */
const tick = () => new Promise(r => setTimeout(r, 0));
function wagonKey() {
	const W = S().wagons;
	let key = '';
	for (let i = 0; i < W.n; i++) {
		const r = W.els[i].getBoundingClientRect();
		key += Math.round(r.left) + ',' + Math.round(r.top) + ' ';
	}
	return key;
}
/* what is painted must be what the chain computed, and two pictures that
	leave by the top never overlap */
VN.wagonFaults = wagonFaults;
function wagonFaults() {
	const W = S().wagons, vh = VN.viewH();
	let faults = 0, prevBottom = -Infinity;
	for (let i = 0; i < W.n; i++) {
		if (W.dir[i] !== 0) { prevBottom = -Infinity; continue; }
		const r = W.els[i].getBoundingClientRect();
		if (Math.abs(r.top - W.pos[i]) > 1) faults++;
		const onScreen = r.bottom > 0 && r.top < vh;
		if (onScreen && r.top < prevBottom - 1) faults++;
		prevBottom = onScreen ? r.bottom : -Infinity;
	}
	return faults;
}
function answerPrompt() {
	const b = document.querySelector('.snow-prompt button');
	if (b) b.click();
	return !!b;
}
VN.check = async function() {
	const ctl = VN.ctl, qa = $('qa'), report = [], speed = VN.speed;
	let fails = 0;
	const line = function(cls, text) {
		report.push(text);
		const d = document.createElement('div');
		d.className = cls;
		d.textContent = text;
		qa.appendChild(d);
	};
	const check = function(name, ok, detail) {
		if (!ok) fails++;
		line(ok ? 'pass' : 'fail', (ok ? 'ok    ' : 'FAIL  ') + name + (detail ? '  — ' + detail : ''));
	};
	qa.hidden = false;
	qa.textContent = '';
	line('head', document.title + ' · ' + (drv.stage ? 'stage' : 'window') + ' scroll · ' + window.innerWidth + '×' + window.innerHeight);
	if (!ctl.isVN()) ctl.setVN(true);
	VN.speed = 0;
	ctl.restart();
	await tick();
	const seen = new Map();
	let steps = 0, faults = 0, probes = '', answered = 0, guard = 3000;
	for (;;) {
		VN.settle();
		await tick();
		seen.set(Math.round(drv.get()), wagonKey());
		faults += wagonFaults();
		const p = ctl.probe ? ctl.probe() : '';
		if (p && !probes) probes = 'step ' + steps + ': ' + p;
		if (S().store.pending && answerPrompt()) { answered++; await tick(); continue; }
		if (!ctl.next() || guard-- < 0) break;
		steps++;
	}
	const M = VN.marks, total = window.VN_STORY.marks;
	let got = 0;
	for (let i = 1; i <= total; i++) if (M.seen[i]) got++;
	check('the walk reaches the end of the story', guard > 0 && drv.get() >= drv.max() - VN.viewH(), steps + ' steps, ' + answered + ' choice answered');
	check('every numbered script fired', got === total, got + '/' + total);
	check('in document order, none skipped', M.bad === 0 && M.skips === 0, M.bad + ' out of order, ' + M.skips + ' skipped');
	check('pictures are painted where the push chain puts them, and never overlap', faults === 0, faults + ' fault(s) over ' + (steps + 1) + ' rests');
	check('nothing unread is on screen, and the current portion is', !probes, probes || 'probed at every rest');
	let back = 0, drift = 0, matched = 0;
	guard = 3000;
	while (ctl.prev() && guard-- > 0) {
		VN.settle();
		await tick();
		back++;
		const was = seen.get(Math.round(drv.get()));
		if (was === undefined) continue;
		matched++;
		if (was !== wagonKey()) drift++;
	}
	check('stepping back returns to the first rest', guard > 0 && Math.round(drv.get()) === seen.keys().next().value, back + ' steps back');
	check('reversible: the same position paints the same pictures both ways', drift === 0 && matched > 0, matched + ' positions revisited, ' + drift + ' differ');
	line('head', fails ? fails + ' check(s) FAILED' : 'all checks passed');
	VN.speed = speed;
	ctl.restart();
	VN.stat();
	const save = document.createElement('button'), close = document.createElement('button');
	save.textContent = 'save report';
	save.addEventListener('click', function() {
		const text = report.join('\n') + '\n\n' + navigator.userAgent + '\n';
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
		a.download = (document.title.replace(/[^\w]+/g, '-') + '-' + (drv.stage ? 'stage' : 'window') + '.txt').toLowerCase();
		a.click();
	});
	close.textContent = 'close';
	close.addEventListener('click', function() { qa.hidden = true; });
	qa.append(save, close);
	return fails;
};
})();
