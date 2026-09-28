/* snowfall-paged.js — 0.6.0 paged (VN) reading: the same story page, read one
   portion at a time.

   A page is one portion. Advancing puts the portion's own start on the window's
   top edge and cuts the story root at the portion's end, so the text that came
   before leaves the page and only the new text is on it — the VN reading the
   user asked for, not a page that grows by one paragraph at a time.

   The whole mechanism is three style properties on the story root: a height
   that ends the portion, `overflow-y: clip` so nothing past it is painted, and
   a bottom margin that gives a short portion the window's worth of room to
   sit at the top of. Because the document is exactly that tall, unrevealed
   text is not merely hidden, it is out of reach: no wheel, no scrollbar, no
   anchor below the boundary in firing range. And because the root's own box is
   what changes, nothing inside it moves — every anchor keeps its document Y,
   `position: sticky` wagons keep the viewport as their scrollport and park
   exactly as in book mode, and morph, events, prompts and minigames never
   learn that the mode changed.

   The inline axis is deliberately left alone: the engine pulls each art wagon
   out of the text column with a negative margin so it spans the page, and
   `overflow: clip` on both axes would cut a centred story column down to its
   own width. `overflow-y` clips the block axis only and never makes the root
   a scroll container, which is the one property `sticky` cannot survive.

   Load order in a story page (all classic <script>):
   snowfall.js → snowfall-paged.js (anywhere among the optional subscribers —
   built-ins are registered first, so the controller measures after wagons,
   morph and events) */
(function(global) {
'use strict';
const hasDOM = typeof document !== 'undefined' && typeof window !== 'undefined';
const DEFAULTS = 'p,section,br';
/* one tap moves at most one window. A page turn is never longer than that —
   the reader is at the old page's bottom, the new one starts at most a window
   below it — so a turn is always one tap, and only a page taller than the
   window is walked, a window at a time. */
const STEP_MAX = 1;
const TAP_MS = 500, TAP_PX = 8, MERGE_PX = 1, EPS = 0.001;
/* a tap on any of these is the reader's, not the page's */
const NO_TAP = 'a,button,input,select,textarea,label,summary,[contenteditable],[data-nopage],.snow-prompt,.snow-game,.snow-region-hud';
/* whole subtrees that are page furniture, never prose: a <br> in a caption or
   in a game's painted UI is a line break, not a page break */
const CUT = '.snow-bg,.snow-stick,.snow-game,.snow-prompt,script,style,[data-nopage]';

const P = {
	root: null, subs: false, touched: false, on: false,
	n: 0, k: -1, kEl: null, el: [],
	y: new Float64Array(0), tags: null, tagKey: '',
	padBoxTop: 0, padTop: 0, padBottom: 0, borderTop: 0, borderBottom: 0, borderBox: false, endY: 0, contentTop: 0,
	pendingH: -1, pendingAt: 0, band: -1, flowWarn: 0
};
const scrollOpts = { top: 0, left: 0, behavior: 'auto' };
let down = null, pointers = 0;

/* ---------------- engine plumbing ---------------- */
function engine() {
	const S = global.Snowfall;
	return S && S.default && typeof S.use === 'function' ? S : null;
}
function viewH() {
	const S = global.Snowfall;
	const vp = S && S.viewport;
	return vp && vp.height ? vp.height : (global.innerHeight || 0);
}
/* compound-only selector test, one part at a time: `closest()` is not in the
   fake DOM the node gate runs pages in, and these lists are fixed. */
function matchSel(el, part) {
	const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+|\[[^\]]+\])*)$/.exec(part);
	if (!m || !el.tagName) return false;
	if (m[1] && el.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
	const re = /([.#][\w-]+|\[[^\]]+\])/g;
	let t;
	while ((t = re.exec(m[2]))) {
		const tok = t[1];
		if (tok[0] === '.') { if (!el.classList || !el.classList.contains(tok.slice(1))) return false; }
		else if (tok[0] === '#') { if (el.id !== tok.slice(1)) return false; }
		else if (!el.hasAttribute || !el.hasAttribute(tok.slice(1, -1))) return false;
	}
	return true;
}
function hit(el, sel) {
	const parts = sel.split(',');
	for (let i = 0; i < parts.length; i++) if (matchSel(el, parts[i].trim())) return true;
	return false;
}
function isText(node) { return node.nodeType === 3; }
function isEl(node) { return node.nodeType === 1; }

/* ---------------- the walk: every stop, and where it ends its portion ---------------- */
function stopTags(root) {
	const ds = root.getAttribute ? root.getAttribute('data-stops') : null;
	const list = !ds || !ds.trim() ? api.stops : ds;
	if (list === P.tagKey && P.tags) return P.tags;
	const set = {};
	const parts = list.split(',');
	for (let i = 0; i < parts.length; i++) { const t = parts[i].trim().toLowerCase(); if (t) set[t] = 1; }
	P.tagKey = list;
	P.tags = set;
	return set;
}
function charY(node) {
	const s = node.nodeValue || '';
	const i = s.search(/\S/);
	if (i < 0) return null;
	const doc = node.ownerDocument;
	if (!doc || typeof doc.createRange !== 'function') return null;
	let rg = null;
	try {
		rg = doc.createRange();
		rg.setStart(node, i);
		rg.setEnd(node, i + 1);
	} catch (e) { return null; }
	const b = rg.getBoundingClientRect();
	if (!b || (!b.height && !b.width)) return null;      /* display:none, or an empty line */
	return b.top + (global.scrollY || 0);
}
function textYIn(node) {                                  /* this node's own text, then its subtree */
	if (isText(node)) return charY(node);
	if (!isEl(node)) return null;
	for (let c = node.firstChild; c; c = c.nextSibling) {
		const y = textYIn(c);
		if (y !== null) return y;
	}
	return null;
}
function textYAfter(node) {                                /* this node and everything after it */
	for (let n = node; n; n = n.nextSibling) {
		const y = textYIn(n);
		if (y !== null) return y;
	}
	for (let p = node.parentNode; p && p.parentNode; p = p.parentNode) {
		for (let n = p.nextSibling; n; n = n.nextSibling) {
			const y = textYIn(n);
			if (y !== null) return y;
		}
	}
	return null;
}
/* the <br> boundary is the line box edge: a browser puts a br's rect on the
   content area of the line it ends, so the midpoint with the next glyph rect
   is where one line becomes the next — the finished line stays whole, the next
   one shows nothing, and the rule is font-independent. No Range, or no text
   after it, falls back to the br's own bottom. */
function stopY(el, tags, sY) {
	const name = el.tagName.toLowerCase();
	if (!tags[name]) return null;
	if (typeof el.getClientRects === 'function' && !el.getClientRects().length) return null;
	const r = el.getBoundingClientRect();
	if (!r) return null;
	if (name !== 'br') return r.top + sY;
	const bottom = r.bottom + sY;
	const t = textYAfter(el);
	return t === null ? bottom : (bottom + t) / 2;
}
/* the boundary buffer only ever grows, and it grows with its contents: a fresh
   Float64Array over the same slots would zero the pages already measured */
function grow(need) {
	const next = new Float64Array(Math.max(need, P.y.length * 2, 8));
	next.set(P.y);
	P.y = next;
}
function walk() {
	const root = P.root, sY = global.scrollY || 0, tags = stopTags(root);
	let pending = null, pendingY = 0, n = 0;
	P.el.length = 0;
	P.n = 0;
	/* two boundaries closer than a pixel are one page; an out-of-flow stop
	   that would move the list backwards loses to the one before it */
	function commit(el, y) {
		/* nothing precedes the first stop: the opening page would be blank, so
		   the story's first real portion is page one (same rule as a merge) */
		if (n === 0 && y <= P.contentTop + MERGE_PX) return;
		if (n && y < P.y[n - 1]) {
			if (!P.flowWarn) {
				P.flowWarn = 1;
				console.warn('SnowfallPaged: a stop sits above the one before it (out-of-flow markup); the lower boundary wins');
			}
			y = P.y[n - 1];
		}
		if (n && y - P.y[n - 1] < MERGE_PX) { P.y[n - 1] = y; P.el[n - 1] = el; return; }
		if (P.y.length < n + 1) grow(n + 1);
		P.y[n] = y;
		P.el[n] = el;
		n++;
	}
	/* a stop is only kept once its portion has content: `</p>` margin then
	   `<p>`, `<br><br>`, a `<br>` before `</p>`, a `<section>` opening straight
	   into its first `<p>` all collapse into the one page they really are */
	function step(el) {
		const y = stopY(el, tags, sY);
		if (y === null) return;                 /* not a stop: ends no portion */
		pending = el;
		pendingY = y;
	}
	function descend(el) {
		for (let c = el.firstChild; c; c = c.nextSibling) {
			if (isText(c)) {
				if (pending && c.nodeValue && c.nodeValue.trim()) { commit(pending, pendingY); pending = null; }
				continue;
			}
			if (!isEl(c)) continue;
			if (hit(c, CUT)) {
				/* a picture is content: a section that opens with one is a page */
				if (pending && c.classList && c.classList.contains('snow-bg')) { commit(pending, pendingY); pending = null; }
				continue;
			}
			step(c);
			descend(c);
		}
	}
	descend(root);
	commit(root, P.endY);                /* the last page always reveals everything */
	P.n = n;
}

/* ---------------- the clamp: two style writes, nothing else ---------------- */
function readBox() {
	const root = P.root, sY = global.scrollY || 0;
	const r = root.getBoundingClientRect();
	const cs = global.getComputedStyle ? global.getComputedStyle(root) : null;
	if (!cs) {                                    /* no style engine (node gate) */
		P.padBoxTop = r.top + sY;
		P.contentTop = P.padBoxTop;
		P.endY = r.bottom + sY;
		return;
	}
	P.padTop = parseFloat(cs.paddingTop) || 0;
	P.padBottom = parseFloat(cs.paddingBottom) || 0;
	P.borderTop = parseFloat(cs.borderTopWidth) || 0;
	P.borderBottom = parseFloat(cs.borderBottomWidth) || 0;
	P.borderBox = cs.boxSizing === 'border-box';
	P.padBoxTop = r.top + sY + P.borderTop;
	P.contentTop = P.padBoxTop + P.padTop;
	/* the end boundary is the root's own bottom edge, padding included: the
	   last page is the whole story box, not its last line */
	P.endY = r.bottom + sY - P.borderBottom;
}
function apply() {
	if (P.k < 0 || P.k >= P.n || !P.root) return;
	/* the padding box's bottom edge IS the boundary: the story root's own box
	   ends exactly at the stop the reader is on, so nothing past it is painted
	   and nothing past it can be scrolled to */
	const pb = P.y[P.k] - P.padBoxTop;
	const h = P.borderBox ? pb + P.borderTop + P.borderBottom : pb - P.padTop - P.padBottom;
	P.root.style.height = (h > 0 ? h : 0) + 'px';
	P.root.style.overflowY = 'clip';
	/* One page is one portion, so the window's TOP edge is the portion's own
	   start: the text above it is behind the reader, gone from the page. A
	   portion shorter than the window cannot scroll that far on its own, so the
	   root gets a bottom margin for the missing window — margin lives outside
	   the clip, so the band is empty paper and the unrevealed text below the
	   boundary is still not painted, still not reachable. */
	const b = band(P.k);
	if (b !== P.band) {
		P.band = b;
		P.root.style.marginBottom = b > 0 ? b + 'px' : '';
	}
}
function unapply() {
	if (!P.root) return;
	P.band = -1;
	P.root.style.height = '';
	P.root.style.overflowY = '';
	P.root.style.marginBottom = '';
}
/* where page k starts: the top of its portion, so the window shows that
   portion and nothing before it */
function pageStart(k) {
	return k > 0 ? P.y[k - 1] : 0;
}
/* the empty band a short page needs under it for the reader to reach it */
function band(k) {
	const short = viewH() - (P.y[k] - pageStart(k));
	return short > 0 ? short : 0;
}
/* where page k is read: its own top when the portion fits the window, its
   last window when the portion is taller. It is also the document's maximum
   scroll, because the root ends at y[k] and the band is exactly the rest of
   the window — so a page is fully read the moment the reader is here. */
function pageSpot(k) {
	const v = P.y[k] - viewH();
	const t = pageStart(k);
	return v > t ? v : t;
}
function smooth() {
	if (!api.smooth) return false;
	if (typeof global.matchMedia !== 'function') return true;
	try { return !global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
	catch (e) { return true; }
}
function scrollTo(y) {
	scrollOpts.top = y;
	scrollOpts.behavior = smooth() ? 'smooth' : 'auto';
	global.scrollTo(scrollOpts);
}

/* ---------------- public surface ---------------- */
function ready() {
	if (P.root) return true;
	const S = engine();
	if (!S) return false;
	const root = S.scope || (document.getElementById && document.getElementById('app'));
	if (!root || !root.getBoundingClientRect) return false;
	P.root = root;
	if (!P.subs) {
		P.subs = true;
		S.use({
			measure: measure,
			frame: frame,
			off: function() { P.on = false; P.pendingH = -1; unapply(); }
		});
	}
	return true;
}
function ensure() {
	if (P.root && P.n > 0) return true;
	if (!ready()) return false;
	if (P.n === 0) measure();
	return P.n > 0;
}
function firstAt(v) {
	for (let i = 0; i < P.n; i++) if (P.y[i] >= v - EPS) return i;
	return P.n - 1;
}
function indexOf(el) {
	for (let i = 0; i < P.n; i++) if (P.el[i] === el) return i;
	return -1;
}
function set(on, fromTop) {
	P.touched = true;
	if (!on) {
		if (!ready()) return false;
		P.on = false;
		P.pendingH = -1;
		unapply();
		return true;
	}
	if (!ensure()) return false;
	P.on = true;
	if (fromTop) { P.k = 0; scrollTo(0); }
	else P.k = firstAt((global.scrollY || 0) + viewH());
	P.kEl = P.el[P.k];
	apply();
	return true;
}
function next() {
	if (!P.on || P.n === 0) return false;
	P.pendingH = -1;
	const sY = global.scrollY || 0, vh = viewH(), here = pageSpot(P.k);
	if (sY < here - 1) {          /* this page is not all read yet: hurry down, reveal nothing */
		scrollTo(Math.min(here, sY + STEP_MAX * vh));
		return true;
	}
	if (P.k >= P.n - 1) return false;
	P.k++;
	P.kEl = P.el[P.k];                        /* the page is kept by element across a re-measure */
	apply();
	scrollTo(Math.min(pageSpot(P.k), sY + STEP_MAX * vh));
	return true;
}
function prev() {
	if (!P.on || P.k <= 0) return false;
	P.pendingH = -1;
	P.k--;
	const at = pageSpot(P.k);
	if (smooth()) {
		/* shrinking first would let the browser clamp the scroll instantly and
		   the page would jump: travel up, and cut the tail once we arrive */
		P.pendingH = P.k;
		P.pendingAt = at;
	} else { P.kEl = P.el[P.k]; apply(); }
	scrollTo(at);
	return true;
}
function frame(sY) {
	if (P.pendingH < 0) return;                 /* the only per-frame work: one compare */
	if (sY > P.pendingAt + 1) return;
	const k = P.pendingH;
	P.pendingH = -1;
	P.k = k;
	P.kEl = P.el[k];
	apply();
}
function boot() {
	const de = document.documentElement;
	if (de && de.hasAttribute && de.hasAttribute('data-paged')) return de.getAttribute('data-paged') !== 'false';
	const m = document.querySelector ? document.querySelector('meta[name="paged"]') : null;
	return !!(m && m.getAttribute('content') !== '0');
}
function measure() {
	if (!ready()) return;
	/* the root's own box is the one thing the clamp changes, so it is read
	   with the clamp OFF: measuring a clamped root would feed the boundary
	   list back into itself and the story would shrink on every refresh */
	if (P.on) unapply();
	readBox();
	const keepEl = P.kEl, keepY = P.k >= 0 && P.k < P.n ? P.y[P.k] : -1;
	walk();
	if (!P.on && !P.touched && boot()) { set(true, (global.scrollY || 0) < 1); return; }
	if (!P.on) return;
	/* the page is kept by element, not by index: a source edit above the
	   reader must not move the frontier. If the stop itself is gone, the
	   nearest boundary at or after the old one takes over. */
	let k = keepEl ? indexOf(keepEl) : -1;
	if (k < 0) k = firstAt(keepY < 0 ? (global.scrollY || 0) + viewH() : keepY);
	P.k = k;
	P.kEl = P.el[k];
	apply();
}

/* ---------------- input: claimed only while paged ---------------- */
function blocked(el) {
	for (let n = el; n && n.tagName; n = n.parentNode) {
		if (hit(n, NO_TAP)) return true;
		if (api.ignore && hit(n, api.ignore)) return true;
	}
	return false;
}
function selecting() {
	if (typeof global.getSelection !== 'function') return false;
	const s = global.getSelection();
	return !!s && !s.isCollapsed;
}
function inspecting() {
	const R = global.SnowfallRegion;
	return !!(R && typeof R.getInspect === 'function' && R.getInspect());
}
function onDown(ev) {
	if (pointers === 0 && P.on && (!ev.button || ev.button === 0) && ev.isPrimary !== false)
		down = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp || 0 };
	pointers++;
}
function onUp(ev) {
	const alone = pointers <= 1;
	pointers = pointers > 0 ? pointers - 1 : 0;
	const d = down;
	down = null;
	if (!alone || !d || !P.on) return;
	if (Math.abs(ev.clientX - d.x) > TAP_PX || Math.abs(ev.clientY - d.y) > TAP_PX) return;
	if ((ev.timeStamp || 0) - d.t > TAP_MS) return;
	if (blocked(ev.target) || selecting() || inspecting()) return;
	next();
}
function onKey(ev) {
	if (!P.on || ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
	const k = ev.key;
	let go = 0;
	if (k === ' ' || k === 'Spacebar' || k === 'Enter' || k === 'PageDown' || k === 'ArrowRight') go = 1;
	else if (k === 'Backspace' || k === 'PageUp' || k === 'ArrowLeft') go = -1;
	else return;
	if (blocked(ev.target)) return;
	if (go > 0) next(); else prev();
	ev.preventDefault();
}
const api = {
	version: '0.7.0',
	set: set,
	get: function() { return P.on; },
	next: next,
	prev: prev,
	stops: DEFAULTS,                        /* default stop list; data-stops on the root wins */
	smooth: 1,                               /* 0 makes every step a jump, for QA logs */
	ignore: ''                               /* extra selector the host wants taps ignored in */
};
	Object.defineProperty(api, 'index', { get: function() { return P.k; }, set: function() { /* read-only */ } });
	Object.defineProperty(api, 'count', { get: function() { return P.n; }, set: function() { /* read-only */ } });
	Object.defineProperty(api, 'y', { get: function() { return P.y; }, set: function() { /* read-only */ } });
	Object.defineProperty(api, 'root', { get: function() { return P.root; }, set: function() { /* read-only */ } });
/* the stop element a boundary was taken from — the story root for the last
   one. `y` is the raw buffer: read it only for [0, count). */
api.at = function(i) { return i >= 0 && i < P.n ? P.el[i] : null; };
/* the scroll position the current page is read at — also its maximum scroll,
   so a host that parks the reader here has read the whole page */
api.top = function() { return P.k >= 0 && P.k < P.n ? pageSpot(P.k) : 0; };

if (hasDOM) {
	global.addEventListener('pointerdown', onDown, { passive: true });
	global.addEventListener('pointerup', onUp, { passive: true });
	global.addEventListener('pointercancel', function() { down = null; pointers = 0; }, { passive: true });
	global.addEventListener('keydown', onKey);
	/* the engine may not be on the page yet (load order): a boot refresh with
	   no subscriber would be the only frame before the next one picks it up */
	if (engine()) ready();
	else global.addEventListener('load', ready);
}
global.SnowfallPaged = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
