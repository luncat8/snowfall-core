/* snowfall-region.js — HD-region wagon controller (0.5.5): a sharp 1:1 crop over
   a compressed outpainted base, zoom/pan while the wagon is parked. All layout
   math lives in hdregion.js — this file never re-derives a fit, a clamp or a
   pivot. Subscriber only: no scroll listener of its own, no rAF, no layout read
   in frame(); it writes the two <img> children of .snow-hd wagons and never the
   wagon element (the engine owns wagon box, margins and transform).

   Coordinate contract (see 0.5.5-plan-region-backgrounds.md):
     A page-span wagon's border box is exactly Snowfall.viewport (clientWidth ×
     innerHeight) at viewport x=0, and position:sticky is a containing block for
     absolutely positioned children — so a child translate(x,y) composes rigidly
     with the engine's translate3d(dx,dy,0) in every state (entering, parked,
     pushed, exiting), and at park (wagon transform 0) wagon-local space IS
     viewport space, which is what HDRegion.finalLayout(vw, vh, ...) computes.

   Gestures: read mode = shift+wheel zoom around the cursor; inspect mode
   (HUD checkbox / key i) = wheel zoom, drag pan, pinch. Everything is also
   exposed on SnowfallRegion so a host page (the harness) can mirror and drive
   it without touching internals. */
(function (global) {
'use strict';

var hasDOM = typeof document !== 'undefined' && typeof window !== 'undefined';
var SF = hasDOM && typeof Snowfall !== 'undefined' ? Snowfall : null;
var H = typeof HDRegion !== 'undefined' ? HDRegion : null;
if (!hasDOM || !SF || !H) {
	if (typeof module !== 'undefined') module.exports = null;
	return;
}

var EMPTY = {};
/* resolved from window.REGIONS at every measure, NOT at script load: the data
   may legally arrive after this file (the harness builds it in memory), and a
   classic <script> regions.js loaded before it is just the normal case. */
var REGIONS = EMPTY;

var rootEl = document.documentElement;
/* JS-ready: host stylesheets drop their no-JS containment (max-height /
   object-fit) under html.snow-ready, and the adapter's own child rule below is
   keyed to the same class. off() removes the class, so a disabled engine
   leaves the clean contained no-JS page; frame() re-adds it on re-enable. */
rootEl.classList.add('snow-ready');

var CSS = 'html.snow-ready .snow-hd img{position:absolute;top:0;left:0;transform-origin:0 0;' +
	'pointer-events:none;user-select:none;-webkit-user-drag:none}' +
	'html.snow-ready .snow-hd img:nth-child(2){z-index:2}';

/* per-wagon state, reallocated only on growth at measure */
var N = 0;
var wagonEls = [], baseEls = [], hdEls = [];
var wagonIdx = new Int32Array(0);      /* index into Snowfall.wagons, -1 none */
var rx = new Float64Array(0), ry = new Float64Array(0), rw = new Float64Array(0), rh = new Float64Array(0);
var hasR = new Uint8Array(0), maxZ = new Float64Array(0);
var zoom = new Float64Array(0), vx = new Float64Array(0), vy = new Float64Array(0);
var nbW = new Float64Array(0), nbH = new Float64Array(0);
var nwH = new Float64Array(0), nhH = new Float64Array(0);
var lastWB = new Float64Array(0), lastHB = new Float64Array(0);
var lastWH = new Float64Array(0), lastHH = new Float64Array(0);
var lastSX = new Float64Array(0), lastSY = new Float64Array(0);
var lastSXH = new Float64Array(0), lastSYH = new Float64Array(0);
var hdLoaded = new Uint8Array(0), wantHd = new Uint8Array(0);

/* reused scratch objects — never allocated in frame */
var view = { zoom: 1, x: 0, y: 0, maxZoom: 4 };
var rgn = { x: 0, y: 0, w: 0, h: 0 };
var L = { x: 0, y: 0, w: 0, h: 0, s: 0, tx: 0, ty: 0, px: 0, py: 0, ix: 0, iy: 0 };
var lastVW = 0, lastVH = 0;

var inspect = false;
var warnedBoxed = false;
var hud = null;

/* input scratch, allocated once */
var pointers = new Map();
var dragging = false, lastX = 0, lastY = 0;
var pinchDist = 0, pinchZoom = 1, pinchIdA = 0, pinchIdB = 0, pinchWagon = -1;

/* strip query, hash and a leading ./. NEVER decodeURIComponent: percent-decoding
   mangles data: URIs, which are legitimate image sources (the harness generator
   paints with them) and are already in their final encoded form. */
function normKey(src) {
	if (!src) return '';
	return src.split('?')[0].split('#')[0].replace(/^\.\//, '');
}

/* fixed/auto wagons get an explicit, centred box — the region math assumes the
   page-span box. Warn once, hide the HD child (snow-ready CSS would otherwise
   bare it), and leave the wagon out of the managed set: the base paints as a
   normal picture with no zoom. */
function isBoxed(el) {
	var m = el.dataset.mode;
	return m === 'fixed' || m === 'auto';
}
function skipBoxed(el) {
	if (!warnedBoxed) {
		warnedBoxed = true;
		console.warn('snowfall-region: .snow-hd with data-mode fixed/auto is unsupported — the picture stays a plain background');
	}
	var imgs = el.getElementsByTagName('img');
	if (imgs[1] && imgs[1].style.display !== 'none') imgs[1].style.display = 'none';
}

function onImgLoad() {
	/* natural dimensions are now known; invalidate size caches and request a
	   frame. No layout read here — naturalWidth is decode metadata. */
	var el = this;
	for (var i = 0; i < N; i++) {
		if (baseEls[i] === el) { lastWB[i] = -1; break; }
		if (hdEls[i] === el) {
			if (!wantHd[i] || hdLoaded[i]) return;   /* no hd declared, or already processed */
			hdLoaded[i] = 1;
			nwH[i] = el.naturalWidth; nhH[i] = el.naturalHeight;
			lastWH[i] = -1;
			if (el.style.display === 'none') el.style.display = 'block';
			break;
		}
	}
	SF.step();
}

/* bind once per element; readiness is re-evaluated at EVERY measure because a
   cached image fires no load event (complete && naturalWidth is the only
   signal), and a refresh may swap which entry the wagon resolves to. */
function bindLoad(i, hasHd) {
	var b = baseEls[i], h = hdEls[i];
	if (b && !b.__snowBound) b.addEventListener('load', onImgLoad);
	if (h && !h.__snowBound) h.addEventListener('load', onImgLoad);
	wantHd[i] = hasHd ? 1 : 0;
	if (b && b.complete && b.naturalWidth) { nbW[i] = b.naturalWidth; nbH[i] = b.naturalHeight; }
	if (!h) { hdLoaded[i] = 0; return; }
	if (!hasHd) {
		hdLoaded[i] = 0;
		if (h.style.display !== 'none') h.style.display = 'none';
		return;
	}
	if (h.complete && h.naturalWidth) {
		hdLoaded[i] = 1;
		nwH[i] = h.naturalWidth; nhH[i] = h.naturalHeight;
		if (h.style.display === 'none') h.style.display = 'block';
	} else if (!hdLoaded[i] && h.style.display !== 'none') {
		hdLoaded[i] = 0;
		h.style.display = 'none';
	}
}

function baseKey(i) {
	return normKey(baseEls[i] ? baseEls[i].getAttribute('src') : '');
}

/* typed-array growers */
function growF64(a, n) { var b = new Float64Array(n); b.set(a); return b; }
function growI32(a, n) { var b = new Int32Array(n); b.set(a); return b; }
function growU8(a, n) { var b = new Uint8Array(n); b.set(a); return b; }

function measure() {
	var scope = document.getElementById('app') || document;
	REGIONS = window.REGIONS || EMPTY;
	var found = scope.querySelectorAll('.snow-hd');
	var m = 0;
	for (var k = 0; k < found.length; k++) if (!isBoxed(found[k])) m++;
	if (m > wagonIdx.length) {
		wagonIdx = growI32(wagonIdx, m);
		rx = growF64(rx, m); ry = growF64(ry, m);
		rw = growF64(rw, m); rh = growF64(rh, m);
		hasR = growU8(hasR, m); maxZ = growF64(maxZ, m);
		zoom = growF64(zoom, m); vx = growF64(vx, m); vy = growF64(vy, m);
		nbW = growF64(nbW, m); nbH = growF64(nbH, m);
		nwH = growF64(nwH, m); nhH = growF64(nhH, m);
		lastWB = growF64(lastWB, m); lastHB = growF64(lastHB, m);
		lastWH = growF64(lastWH, m); lastHH = growF64(lastHH, m);
		lastSX = growF64(lastSX, m); lastSY = growF64(lastSY, m);
		lastSXH = growF64(lastSXH, m); lastSYH = growF64(lastSYH, m);
		hdLoaded = growU8(hdLoaded, m); wantHd = growU8(wantHd, m);
	}
	N = m;
	wagonEls.length = m; baseEls.length = m; hdEls.length = m;
	var W = SF.wagons;
	var i = 0;
	for (k = 0; k < found.length; k++) {
		var el = found[k];
		if (isBoxed(el)) { skipBoxed(el); continue; }
		/* zoom/pan and decode caches survive a re-measure only for the SAME
		   element: a resize refresh keeps the reader's view, regenerated
		   content starts fresh (a stale hdLoaded would paint an undecoded crop
		   and its load event would be ignored). */
		if (wagonEls[i] !== el) {
			zoom[i] = 1; vx[i] = 0; vy[i] = 0;
			nbW[i] = 0; nbH[i] = 0; nwH[i] = 0; nhH[i] = 0;
			hdLoaded[i] = 0; wantHd[i] = 0;
		}
		wagonEls[i] = el;
		var imgs = el.getElementsByTagName('img');
		baseEls[i] = imgs[0] || null;
		hdEls[i] = imgs[1] || null;
		lastWB[i] = -1; lastWH[i] = -1;
		lastSX[i] = NaN; lastSY[i] = NaN; lastSXH[i] = NaN; lastSYH[i] = NaN;
		var wi = -1;
		if (W) for (var k2 = 0; k2 < W.n; k2++) if (W.els[k2] === el) { wi = k2; break; }
		wagonIdx[i] = wi;
		var e = REGIONS[baseKey(i)];
		if (e) {
			hasR[i] = 1;
			rx[i] = e.x; ry[i] = e.y; rw[i] = e.w; rh[i] = e.h;
			maxZ[i] = e.maxZoom || 4;
		} else {
			hasR[i] = 0;
			rx[i] = 0; ry[i] = 0; rw[i] = 0; rh[i] = 0;
			maxZ[i] = 4;
		}
		bindLoad(i, !!(e && e.hd));
		i++;
	}
}

function frame(sY, vh, vw) {
	lastVH = vh; lastVW = vw;
	/* re-enable path: setEnabled(true) only steps, so the class comes back here */
	if (!rootEl.classList.contains('snow-ready')) rootEl.classList.add('snow-ready');
	for (var i = 0; i < N; i++) {
		var b = baseEls[i];
		if (!b) continue;
		/* naturalWidth is decode metadata — the one legal read in frame. */
		var nw = b.naturalWidth, nh = b.naturalHeight;
		if (!nw) continue;
		if (nw !== nbW[i]) { nbW[i] = nw; lastWB[i] = -1; lastSX[i] = NaN; }
		if (nh !== nbH[i]) { nbH[i] = nh; lastWB[i] = -1; lastSY[i] = NaN; }

		/* no entry: the whole base is the region (kept fresh in rx..rh so
		   gestures and SnowfallRegion.rect read the effective values) */
		if (!hasR[i]) { rx[i] = 0; ry[i] = 0; rw[i] = nbW[i]; rh[i] = nbH[i]; }
		rgn.x = rx[i]; rgn.y = ry[i]; rgn.w = rw[i]; rgn.h = rh[i];
		view.zoom = zoom[i]; view.x = vx[i]; view.y = vy[i]; view.maxZoom = maxZ[i];
		H.finalLayout(vw, vh, nbW[i], nbH[i], rgn, view, L);

		if (L.w !== lastWB[i] || L.h !== lastHB[i]) {
			lastWB[i] = L.w; lastHB[i] = L.h;
			b.style.width = L.w + 'px';
			b.style.height = L.h + 'px';
		}
		if (L.x !== lastSX[i] || L.y !== lastSY[i]) {
			lastSX[i] = L.x; lastSY[i] = L.y;
			b.style.transform = 'translate(' + L.x + 'px,' + L.y + 'px)';
		}

		var hEl = hdEls[i];
		if (!hEl) continue;
		/* the HD path does ZERO DOM reads: hdLoaded (never style.display) and
		   the cached natural size (never naturalWidth) are the only state. */
		if (!hasR[i] || !hdLoaded[i]) continue;
		var hw = rw[i] * L.s, hh = rh[i] * L.s;
		var hx = L.x + rx[i] * L.s, hy = L.y + ry[i] * L.s;
		if (hw !== lastWH[i] || hh !== lastHH[i]) {
			lastWH[i] = hw; lastHH[i] = hh;
			hEl.style.width = hw + 'px';
			hEl.style.height = hh + 'px';
		}
		if (hx !== lastSXH[i] || hy !== lastSYH[i]) {
			lastSXH[i] = hx; lastSYH[i] = hy;
			hEl.style.transform = 'translate(' + hx + 'px,' + hy + 'px)';
		}
	}
}

function off() {
	for (var i = 0; i < N; i++) {
		if (baseEls[i]) {
			baseEls[i].style.width = '';
			baseEls[i].style.height = '';
			baseEls[i].style.transform = '';
		}
		if (hdEls[i]) {
			hdEls[i].style.width = '';
			hdEls[i].style.height = '';
			hdEls[i].style.transform = '';
			hdEls[i].style.display = '';
		}
		lastWB[i] = -1; lastWH[i] = -1;
		lastSX[i] = NaN; lastSY[i] = NaN; lastSXH[i] = NaN; lastSYH[i] = NaN;
	}
	/* the no-JS containment (host CSS + our own child rule) keys on this class */
	rootEl.classList.remove('snow-ready');
}

/* the wagon a gesture applies to: the parked one wins, else the last one that
   is on screen (entering or exiting); -1 none. Reads the engine's clamped pos,
   so a wagon the parent is already pushing out is not targeted. */
function activeWagon() {
	var W = SF.wagons;
	if (!W || !W.n) return -1;
	var best = -1;
	for (var i = 0; i < N; i++) {
		var wi = wagonIdx[i];
		if (wi < 0) continue;
		if (W.pos[wi] === 0 && W.free[wi] <= 0) return i;   /* parked wins */
		if (W.free[wi] <= lastVH) best = i;
	}
	return best;
}

function setView(i, z, x, y) {
	zoom[i] = z; vx[i] = x; vy[i] = y;
	SF.step();
}

function zoomWagon(i, sx, sy, nz) {
	/* rw/rh > 0 guard: a zero-size rect would poison the view with Infinity/NaN
	   before the first frame seeded the whole-base fallback */
	if (i < 0 || !(rw[i] > 0) || !(rh[i] > 0)) return false;
	rgn.x = rx[i]; rgn.y = ry[i]; rgn.w = rw[i]; rgn.h = rh[i];
	view.zoom = zoom[i]; view.x = vx[i]; view.y = vy[i]; view.maxZoom = maxZ[i];
	H.zoomAround(lastVW, lastVH, nbW[i], nbH[i], rgn, view, sx, sy, nz, L);
	setView(i, view.zoom, view.x, view.y);
	return true;
}

function resetWagon(i) {
	if (i < 0) return false;
	setView(i, 1, 0, 0);
	return true;
}

/* ---------------- gesture arbitration ---------------- */

function onWheel(event) {
	/* a story with the adapter loaded but zero region wagons keeps the native
	   shift+wheel behaviour (horizontal scroll) */
	if (!N) return;
	if (!inspect && !event.shiftKey) return;   /* read mode: the engine scrolls */
	event.preventDefault();                     /* also kills shift+wheel h-scroll */
	var i = activeWagon();
	if (i < 0 || !nbW[i]) return;
	zoomWagon(i, event.clientX, event.clientY, zoom[i] * Math.exp(-event.deltaY * 0.001));
}

function onPointerDown(event) {
	if (!inspect) return;
	if (hud && hud.contains(event.target)) return;
	event.preventDefault();
	pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
	if (pointers.size === 1) {
		dragging = true;
		lastX = event.clientX; lastY = event.clientY;
		pinchWagon = activeWagon();
	} else if (pointers.size === 2) {
		dragging = false;
		var ids = Array.from(pointers.keys());
		pinchIdA = ids[0]; pinchIdB = ids[1];
		var a = pointers.get(pinchIdA), b = pointers.get(pinchIdB);
		pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
		if (pinchWagon < 0) pinchWagon = activeWagon();
		pinchZoom = pinchWagon >= 0 ? zoom[pinchWagon] : 1;
	}
}

function onPointerMove(event) {
	if (!inspect) return;
	var rec = pointers.get(event.pointerId);
	if (!rec) return;
	event.preventDefault();
	rec.x = event.clientX; rec.y = event.clientY;
	if (pinchWagon < 0) return;

	if (pointers.size === 1 && dragging) {
		vx[pinchWagon] += event.clientX - lastX;
		vy[pinchWagon] += event.clientY - lastY;
		lastX = event.clientX; lastY = event.clientY;
		SF.step();
		return;
	}
	if (pointers.size === 2 && pinchDist > 0) {
		var a = pointers.get(pinchIdA), b = pointers.get(pinchIdB);
		var dist = Math.hypot(a.x - b.x, a.y - b.y);
		zoomWagon(pinchWagon, (a.x + b.x) / 2, (a.y + b.y) / 2, pinchZoom * dist / pinchDist);
	}
}

function onPointerUp(event) {
	if (!inspect) return;
	pointers.delete(event.pointerId);
	if (pointers.size === 1) {
		var p = Array.from(pointers.values())[0];
		dragging = true; lastX = p.x; lastY = p.y; pinchDist = 0;
	} else if (pointers.size === 0) {
		dragging = false; pinchDist = 0; pinchWagon = -1;
	}
}

function onTouchMove(event) {
	/* preventDefault is the only legal way to own a pan — an overflow trick on
	   any wagon ancestor would trap sticky and silently kill parking */
	if (inspect) event.preventDefault();
}

function editable(t) {
	if (!t || !t.tagName) return false;
	var tag = t.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true;
}

function setInspect(on) {
	inspect = !!on;
	if (hud) hud.querySelector('input').checked = inspect;
	if (SnowfallRegion.onInspect) SnowfallRegion.onInspect(inspect);
}

function buildHud() {
	hud = document.createElement('label');          /* appended to body, outside #app */
	hud.id = 'snow-region-hud';
	hud.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:60;' +
		'font:14px system-ui;color:#fff;background:rgba(0,0,0,.45);' +
		'padding:6px 10px;border-radius:6px;cursor:pointer;user-select:none';
	hud.innerHTML = '<input type="checkbox" style="margin-right:6px">inspect bg (i)';
	hud.querySelector('input').addEventListener('change', function (e) {
		setInspect(e.target.checked);
	});
	document.body.appendChild(hud);
	window.addEventListener('keydown', function (e) {
		/* the host page may be an editor: never hijack keys aimed at a field */
		if (editable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key === 'i' || e.key === 'I') setInspect(!inspect);
		else if (e.key === 'Escape') setInspect(false);
	});
	window.addEventListener('dblclick', function (e) {
		if (!inspect || editable(e.target)) return;
		resetWagon(activeWagon());
	});
}

/* public surface: the harness mirrors inspect mode through it and the qRegion
   probe drives zoom deterministically; managed index ≠ DOM order (boxed
   wagons are skipped), so element/rect accessors are part of the contract. */
var SnowfallRegion = {
	version: '0.5.5',
	onInspect: null,
	count: function () { return N; },
	wagonEl: function (i) { return i >= 0 && i < N ? wagonEls[i] : null; },
	wagonIndex: function (i) { return i >= 0 && i < N ? wagonIdx[i] : -1; },
	/* fills and returns out: {x,y,w,h,has,hd,maxZoom,baseW,baseH,zoom,panX,panY}
	   — the EFFECTIVE rect (whole-base fallback when no entry); hd = the entry
	   declares a crop, i.e. the second img may be visible at all */
	rect: function (i, out) {
		if (i < 0 || i >= N) return null;
		out.x = rx[i]; out.y = ry[i]; out.w = rw[i]; out.h = rh[i];
		out.has = hasR[i]; out.hd = wantHd[i]; out.maxZoom = maxZ[i];
		out.baseW = nbW[i]; out.baseH = nbH[i];
		out.zoom = zoom[i]; out.panX = vx[i]; out.panY = vy[i];
		return out;
	},
	activeWagon: activeWagon,
	zoomActive: function (sx, sy, newZoom) { return zoomWagon(activeWagon(), sx, sy, newZoom); },
	resetActive: function () { return resetWagon(activeWagon()); },
	setInspect: setInspect,
	inspecting: function () { return inspect; }
};

var st = document.createElement('style');
st.textContent = CSS;
document.head.appendChild(st);
buildHud();

SF.use({ measure: measure, frame: frame, off: off });
window.addEventListener('wheel', onWheel, { passive: false });
window.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);
window.addEventListener('touchmove', onTouchMove, { passive: false });
SF.refresh();

global.SnowfallRegion = SnowfallRegion;
if (typeof module !== 'undefined' && module.exports) module.exports = SnowfallRegion;
})(typeof window !== 'undefined' ? window : globalThis);
