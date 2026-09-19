/* snowfall-region.js — 0.5.5 region backgrounds adapter. Keeps the two <img>
	children of a `.snow-hd` wagon pinned over the viewport-sized picture the
	engine laid out (sharp HD crop over compressed outpainted base), and
	arbitrates zoom/pan/pinch gestures while a wagon is parked.

	Pure fourth subscriber: one measure, one frame, one off. No scroll
	listener, no rAF, no wagon-element write, no layout read in frame()
	(beyond decode metadata). All fit/pivot/clamp math is HDRegion's — this
	file never re-derives a layout.

	Load order in a story page (all classic <script>):
	regions.js → hdregion.js → snowfall.js → snowfall-region.js */
(function(global) {
'use strict';
const HD = global.HDRegion;
const hasDOM = typeof document !== 'undefined' && typeof window !== 'undefined';

/* per-wagon state: typed arrays grown only when the count increases,
   module-level scratch mutated in place — nothing allocates in frame() */
const R = {
	n: 0, cap: 0, els: [], base: [], hd: [],
	wi: new Int32Array(0),
	rx: new Float64Array(0), ry: new Float64Array(0),
	rw: new Float64Array(0), rh: new Float64Array(0), mz: new Float64Array(0),
	nb: new Float64Array(0), nbh: new Float64Array(0),
	nh: new Float64Array(0), nhh: new Float64Array(0),
	zoom: new Float64Array(0), vx: new Float64Array(0), vy: new Float64Array(0),
	lwb: new Float64Array(0), lhb: new Float64Array(0),
	lxb: new Float64Array(0), lyb: new Float64Array(0),
	lwh: new Float64Array(0), lhh: new Float64Array(0),
	lhx: new Float64Array(0), lhy: new Float64Array(0),
	ready: new Uint8Array(0), hdOK: new Uint8Array(0), disp: new Int8Array(0)
};
const region = { x: 0, y: 0, w: 0, h: 0, maxZoom: 0 };
const view = { zoom: 1, vx: 0, vy: 0 };
const L = {};
/* zoom/pan survives refreshes per element: a resize re-fits, it never resets */
const VIEWS = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
let warned = false, inspectOn = false, hudEl = null, hudCb = null;

const REGION_CSS =
	'html.snow-ready .snow-hd-live{min-height:0}' +
	'html.snow-ready .snow-hd-live>img{position:absolute;top:0;left:0;transform-origin:0 0;' +
	'pointer-events:none;max-width:none;max-height:none;object-fit:fill;width:auto;height:auto}' +
	'html.snow-ready .snow-hd-live>img+img{z-index:2}' +
	'html.snow-inspect body{cursor:grab}' +
	'.snow-region-hud{position:fixed;right:8px;bottom:8px;z-index:120;display:flex;gap:8px;' +
	'align-items:center;padding:6px 9px;border:1px solid #374151;border-radius:6px;' +
	'background:#0b1220d9;color:#eef2f7;font:11px/1.4 ui-monospace,monospace;white-space:nowrap}' +
	'.snow-region-hud[hidden]{display:none}';
function injectCSS() {
	if (document.getElementById('snowfall-region-css')) return;
	const st = document.createElement('style');
	st.id = 'snowfall-region-css';
	st.textContent = REGION_CSS;
	document.head.appendChild(st);
}
function warnExcluded(el) {
	if (warned) return;
	warned = true;
	console.warn('snowfall-region: .snow-hd wagon must not use data-mode="' + el.dataset.mode +
		'" (it needs the page-span box); left unmanaged — base paints, no zoom');
}

function grow(n) {
	if (R.cap >= n) return;
	R.cap = n;
	R.wi = new Int32Array(n);
	R.rx = new Float64Array(n); R.ry = new Float64Array(n);
	R.rw = new Float64Array(n); R.rh = new Float64Array(n); R.mz = new Float64Array(n);
	R.nb = new Float64Array(n); R.nbh = new Float64Array(n);
	R.nh = new Float64Array(n); R.nhh = new Float64Array(n);
	R.zoom = new Float64Array(n); R.vx = new Float64Array(n); R.vy = new Float64Array(n);
	R.lwb = new Float64Array(n); R.lhb = new Float64Array(n);
	R.lxb = new Float64Array(n); R.lyb = new Float64Array(n);
	R.lwh = new Float64Array(n); R.lhh = new Float64Array(n);
	R.lhx = new Float64Array(n); R.lhy = new Float64Array(n);
	R.ready = new Uint8Array(n); R.hdOK = new Uint8Array(n); R.disp = new Int8Array(n);
}
function num(v) { return v > 0 && isFinite(v) ? v : 0; }

function onBaseLoad(ev) {
	/* sizes are re-read in frame() from decode metadata; the load event only
	   schedules a manual frame so a late-decoded base is positioned now */
	if (R.base.indexOf(ev.currentTarget) >= 0 && global.Snowfall) global.Snowfall.step();
}
function onHdLoad(ev) {
	const i = R.hd.indexOf(ev.currentTarget);
	if (i < 0) return;
	/* the HD path reads nothing in frame(): cache here, at load */
	R.nh[i] = ev.currentTarget.naturalWidth || 0;
	R.nhh[i] = ev.currentTarget.naturalHeight || 0;
	R.ready[i] = 1;
	if (global.Snowfall) global.Snowfall.step();
}

function measure() {
	if (!hasDOM || !HD) { R.n = 0; return; }
	const scope = document.getElementById('app') || document;
	const found = scope.querySelectorAll('.snow-bg.snow-hd');
	const els = [], bases = [], hds = [];
	for (let k = 0; k < found.length; k++) {
		const el = found[k];
		const mode = el.dataset.mode;
		if (mode === 'fixed' || mode === 'auto') { warnExcluded(el); continue; }
		if (el.hasAttribute('data-static')) continue;
		let a = null, b = null;
		for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
			if (c.tagName !== 'IMG') continue;
			if (!a) a = c;
			else { b = c; break; }
		}
		if (!a) continue;
		els.push(el); bases.push(a); hds.push(b);
	}
	/* snapshot zoom/pan of surviving elements BEFORE the arrays are resized */
	if (VIEWS) for (let i = 0; i < R.n; i++) {
		const el = R.els[i];
		if (!el || els.indexOf(el) < 0) continue;
		let v = VIEWS.get(el);
		if (!v) { v = { zoom: 1, vx: 0, vy: 0 }; VIEWS.set(el, v); }
		v.zoom = R.zoom[i]; v.vx = R.vx[i]; v.vy = R.vy[i];
	}
	const n = els.length;
	grow(n);
	const table = global.REGIONS || null;
	const wgs = global.Snowfall && global.Snowfall.wagons;
	for (let i = 0; i < n; i++) {
		const el = els[i], b = bases[i], hd = hds[i];
		el.classList.add('snow-hd-live');
		const entry = table ? table[HD.normKey(b.getAttribute('src') || '')] : null;
		R.rx[i] = entry ? num(entry.x) : 0;
		R.ry[i] = entry ? num(entry.y) : 0;
		R.rw[i] = entry ? num(entry.w) : 0;
		R.rh[i] = entry ? num(entry.h) : 0;
		const mz = entry ? +entry.maxZoom : 0;
		R.mz[i] = mz >= 1 && isFinite(mz) ? mz : 0;
		R.hdOK[i] = entry && entry.hd && hd ? 1 : 0;
		R.wi[i] = wgs ? wgs.els.indexOf(el) : -1;
		/* seed from `complete && naturalWidth` so a cached image is sized on
		   the first frame — it never fires load again */
		R.nb[i] = b.naturalWidth || 0;
		R.nbh[i] = b.naturalHeight || 0;
		R.nh[i] = hd ? hd.naturalWidth || 0 : 0;
		R.nhh[i] = hd ? hd.naturalHeight || 0 : 0;
		R.ready[i] = R.hdOK[i] && R.nh[i] > 0 ? 1 : 0;
		if (!b.__snowHdBound) { b.addEventListener('load', onBaseLoad); b.__snowHdBound = 1; }
		if (hd && !hd.__snowHdBound) { hd.addEventListener('load', onHdLoad); hd.__snowHdBound = 1; }
		const v = VIEWS && VIEWS.get(el);
		if (v) { R.zoom[i] = v.zoom; R.vx[i] = v.vx; R.vy[i] = v.vy; }
		else { R.zoom[i] = 1; R.vx[i] = 0; R.vy[i] = 0; }
		/* force the next frame to write everything: the element may be new or
		   the fallback CSS may still constrain it */
		R.lwb[i] = NaN; R.lhb[i] = NaN; R.lxb[i] = NaN; R.lyb[i] = NaN;
		R.lwh[i] = NaN; R.lhh[i] = NaN; R.lhx[i] = NaN; R.lhy[i] = NaN;
		R.disp[i] = -1;
	}
	R.els = els; R.base = bases; R.hd = hds; R.n = n;
	const root = document.documentElement;
	if (n) root.classList.add('snow-ready');
	else root.classList.remove('snow-ready');
	if (hudEl) hudEl.hidden = !n;
}

/* frame(sY, vh, vw) — children only, in wagon-local space: at park that IS
   the viewport (engine parks at 0,0 with a clientWidth×innerHeight box), and
   any other wagon transform composes rigidly with the child translate. */
function frame(sY, vh, vw) {
	const n = R.n;
	if (!n || !HD) return;
	for (let i = 0; i < n; i++) {
		const b = R.base[i], hd = R.hd[i];
		/* the one legal DOM read here: naturalWidth/Height are decode
		   metadata, not layout; a change invalidates the size cache */
		const nb = b.naturalWidth, nbh = b.naturalHeight;
		if (nb !== R.nb[i] || nbh !== R.nbh[i]) { R.nb[i] = nb; R.nbh[i] = nbh; }
		const bw = R.nb[i], bh = R.nbh[i];
		if (!(bw > 0 && bh > 0)) continue;
		region.x = R.rx[i]; region.y = R.ry[i];
		region.w = R.rw[i]; region.h = R.rh[i]; region.maxZoom = R.mz[i];
		view.zoom = R.zoom[i]; view.vx = R.vx[i]; view.vy = R.vy[i];
		HD.finalLayout(vw, vh, bw, bh, region, view, L);
		if (!L.ok) continue;
		/* finalLayout canonicalized `view` in place — persist it, so the
		   clamp has one authority and re-running the frame is a no-op */
		R.zoom[i] = view.zoom; R.vx[i] = view.vx; R.vy[i] = view.vy;
		if (L.w !== R.lwb[i] || L.h !== R.lhb[i] || L.x !== R.lxb[i] || L.y !== R.lyb[i]) {
			const st = b.style;
			st.width = L.w + 'px';
			st.height = L.h + 'px';
			st.transform = 'translate(' + L.x + 'px,' + L.y + 'px)';
			R.lwb[i] = L.w; R.lhb[i] = L.h; R.lxb[i] = L.x; R.lyb[i] = L.y;
		}
		if (!hd) continue;
		if (!(R.hdOK[i] && R.ready[i])) {
			if (R.disp[i] !== 0) { hd.style.display = 'none'; R.disp[i] = 0; }
			continue;
		}
		if (L.hw !== R.lwh[i] || L.hh !== R.lhh[i] || L.hx !== R.lhx[i] || L.hy !== R.lhy[i]) {
			const st = hd.style;
			st.width = L.hw + 'px';
			st.height = L.hh + 'px';
			st.transform = 'translate(' + L.hx + 'px,' + L.hy + 'px)';
			R.lwh[i] = L.hw; R.lhh[i] = L.hh; R.lhx[i] = L.hx; R.lhy[i] = L.hy;
		}
		if (R.disp[i] !== 1) { hd.style.display = ''; R.disp[i] = 1; }
	}
}

function clearImg(el) {
	if (!el) return;
	const st = el.style;
	st.width = ''; st.height = ''; st.transform = ''; st.display = '';
}
function off() {
	if (!hasDOM) return;
	for (let i = 0; i < R.n; i++) {
		R.els[i].classList.remove('snow-hd-live');
		clearImg(R.base[i]); clearImg(R.hd[i]);
		R.disp[i] = -1;
	}
	document.documentElement.classList.remove('snow-ready');
}

/* ---------------- gestures ----------------
	Read mode (default — the page is for reading): plain wheel scrolls the
	page, shift+wheel zooms the parked wagon around the cursor, with
	preventDefault (browsers otherwise map shift+wheel to horizontal scroll).
	Inspect mode (`i` key or the HUD checkbox): wheel = zoom, drag = pan,
	pinch = zoom around the midpoint; touchmove is preventDefault'ed so the
	page never scrolls under the pan — never an ancestor `overflow` trick: any
	non-visible overflow on a wagon ancestor traps sticky and kills parking.
	Handlers mutate raw zoom/vx/vy and call Snowfall.step(); zero layout
	reads, zero second rAF, the wagon itself keeps moving 1:1 with its text. */
function overForm(t) { return !!(t && t.closest && t.closest('input,textarea,select,button,label')); }
function step() { if (global.Snowfall && global.Snowfall.step) global.Snowfall.step(); }

/* gesture target: the parked wagon, else the last one entering or exiting */
function pickTarget() {
	const wgs = global.Snowfall && global.Snowfall.wagons;
	if (!R.n || !wgs || !wgs.n) return -1;
	const vp = global.Snowfall.viewport;
	const vh = vp ? vp.height : 0;
	let last = -1;
	for (let i = 0; i < R.n; i++) {
		const wi = R.wi[i];
		if (wi < 0) continue;
		const fr = wgs.free[wi];
		if (wgs.pos[wi] === 0 && fr <= 0) return i;
		if (fr <= vh) last = i;
	}
	return last;
}

function remember(i) {
	if (!VIEWS || !R.els[i]) return;
	let v = VIEWS.get(R.els[i]);
	if (!v) { v = { zoom: 1, vx: 0, vy: 0 }; VIEWS.set(R.els[i], v); }
	v.zoom = R.zoom[i]; v.vx = R.vx[i]; v.vy = R.vy[i];
}
function zoomAt(i, px, py, k) {
	if (i < 0 || i >= R.n || !HD || !(k > 0) || !isFinite(k)) return;
	region.maxZoom = R.mz[i];
	view.zoom = R.zoom[i]; view.vx = R.vx[i]; view.vy = R.vy[i];
	HD.zoomAround(view, px, py, k, region);
	R.zoom[i] = view.zoom; R.vx[i] = view.vx; R.vy[i] = view.vy;
	remember(i);
	step();
}
function setView(i, zoom, vx, vy) {
	if (i < 0 || i >= R.n) return;
	R.zoom[i] = zoom; R.vx[i] = vx; R.vy[i] = vy;
	remember(i);
	step();
}

function onWheel(e) {
	if (!R.n || !HD || e.ctrlKey || e.metaKey || e.altKey || overForm(e.target)) return;
	if (!(inspectOn || e.shiftKey)) return;
	const i = pickTarget();
	if (i < 0) return;
	const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
	if (!raw) return;
	const d = raw * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 300 : 1);
	e.preventDefault();
	zoomAt(i, e.clientX, e.clientY, Math.exp(-d * 0.0015));
}

let dragI = -1, dragX = 0, dragY = 0;
function onPointerDown(e) {
	if (!inspectOn || e.button !== 0 || overForm(e.target)) return;
	const i = pickTarget();
	if (i < 0) return;
	dragI = i; dragX = e.clientX; dragY = e.clientY;
	e.preventDefault();
}
function onPointerMove(e) {
	if (dragI < 0) return;
	const dx = e.clientX - dragX, dy = e.clientY - dragY;
	if (!dx && !dy) return;
	dragX = e.clientX; dragY = e.clientY;
	e.preventDefault();
	if (dragI < R.n) setView(dragI, R.zoom[dragI], R.vx[dragI] + dx, R.vy[dragI] + dy);
}
function onPointerUp() { dragI = -1; }

function onDbl(e) {
	if (!inspectOn || overForm(e.target)) return;
	const i = pickTarget();
	if (i >= 0) setView(i, 1, R.vx[i], R.vy[i]);
}

let tMode = 0, tI = -1, tX = 0, tY = 0, tVx = 0, tVy = 0, tD0 = 0, tZ0 = 1, tMX = 0, tMY = 0;
function onTouchStart(e) {
	if (!inspectOn || !R.n) return;
	const i = pickTarget();
	if (i < 0) return;
	tI = i;
	if (e.touches.length === 1) {
		tMode = 1; tX = e.touches[0].clientX; tY = e.touches[0].clientY;
		tVx = R.vx[i]; tVy = R.vy[i];
	} else {
		const dx = e.touches[1].clientX - e.touches[0].clientX;
		const dy = e.touches[1].clientY - e.touches[0].clientY;
		tMode = 2;
		tD0 = Math.sqrt(dx * dx + dy * dy) || 1;
		tMX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
		tMY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
		tZ0 = R.zoom[i]; tVx = R.vx[i]; tVy = R.vy[i];
	}
}
function onTouchMove(e) {
	if (tMode === 0 || tI < 0 || tI >= R.n) return;
	e.preventDefault();
	const t = e.touches;
	if (tMode === 1 && t.length === 1) {
		setView(tI, R.zoom[tI], tVx + t[0].clientX - tX, tVy + t[0].clientY - tY);
		return;
	}
	if (t.length < 2) return;
	const dx = t[1].clientX - t[0].clientX, dy = t[1].clientY - t[0].clientY;
	const d = Math.sqrt(dx * dx + dy * dy);
	const mx = (t[0].clientX + t[1].clientX) / 2, my = (t[0].clientY + t[1].clientY) / 2;
	setView(tI, tZ0, tVx + mx - tMX, tVy + my - tMY);
	if (d > 1) zoomAt(tI, mx, my, d / tD0);
}
function onTouchEnd(e) {
	if (e.touches.length === 0) { tMode = 0; tI = -1; }
	else onTouchStart(e);
}

function setInspect(v) {
	v = !!v;
	if (v === inspectOn) return;
	inspectOn = v;
	if (hasDOM) {
		document.documentElement.classList.toggle('snow-inspect', v);
		if (v) window.addEventListener('touchmove', onTouchMove, { passive: false });
		else { window.removeEventListener('touchmove', onTouchMove); tMode = 0; tI = -1; }
		if (hudCb) hudCb.checked = v;
	}
	if (typeof api.onInspect === 'function') {
		try { api.onInspect(v); } catch (e) { console.error('snowfall-region onInspect', e); }
	}
}
function onKey(e) {
	if (e.ctrlKey || e.metaKey || e.altKey) return;
	const t = e.target;
	const tag = (t && t.tagName) || '';
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
	if (e.key === 'i') setInspect(!inspectOn);
	else if (e.key === 'Escape' && inspectOn) setInspect(false);
}

function buildHud() {
	hudEl = document.createElement('div');
	hudEl.className = 'snow-region-hud';
	hudEl.hidden = true;
	hudEl.innerHTML = '<label><input type="checkbox"> inspect bg</label>' +
		'<small>i · wheel zoom · drag pan · dblclick reset · Esc</small>';
	hudCb = hudEl.querySelector('input');
	hudCb.addEventListener('change', function() { setInspect(hudCb.checked); });
	document.body.appendChild(hudEl);
}

/* ---------------- API: harness mirror + qRegion probe, nothing else ---------------- */
const api = {
	count: function() { return R.n; },
	/* live state for the QA probe — read-only by convention */
	arrays: function() { return { els: R.els, base: R.base, hd: R.hd, wi: R.wi }; },
	view: function(i) { return { zoom: R.zoom[i], vx: R.vx[i], vy: R.vy[i] }; },
	setView: setView,
	zoomAt: zoomAt,
	reset: function(i) { setView(i, 1, 0, 0); },
	getInspect: function() { return inspectOn; },
	setInspect: setInspect,
	onInspect: null,
	measure: measure,
	frame: frame,
	off: off
};

/* ---------------- subscribe + listener boot ---------------- */
if (hasDOM) {
	injectCSS();
	const S = global.Snowfall;
	if (S && S.default && S.use) {
		S.use({ measure: measure, frame: frame, off: off });
		/* the engine's boot refresh may have run before this file loaded
		   (readyState is not 'loading' for a script past the parser) —
		   re-refresh so the subscriber is never left unmeasured */
		if (document.readyState !== 'loading') S.refresh();
	}
	buildHud();
	window.addEventListener('wheel', onWheel, { passive: false });
	window.addEventListener('keydown', onKey);
	window.addEventListener('dblclick', onDbl);
	window.addEventListener('pointerdown', onPointerDown);
	window.addEventListener('pointermove', onPointerMove);
	window.addEventListener('pointerup', onPointerUp);
	window.addEventListener('pointercancel', onPointerUp);
	window.addEventListener('touchstart', onTouchStart, { passive: true });
	window.addEventListener('touchend', onTouchEnd, { passive: true });
}
global.SnowfallRegion = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
