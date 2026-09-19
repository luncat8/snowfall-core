/* hdregion.js — region layout/zoom math for .snow-hd wagons (0.5.5).
	DOM-free, allocation-free, the same file is node-testable: it is the ONE
	authority for the fit scale, the edge clamp and the zoom pivot — a
	consumer that re-derives any of them is a bug.

	Coordinates are window space. At park the wagon's local frame IS the
	viewport (0,0 at top-left, vp.width × vp.height), so the base scaled by
	s and drawn at (x, y) covers the window on every axis it can and the
	region rect stays fully inside whenever it fits. Region visibility
	outranks coverage on purpose: outpainted filler is never worth framing
	at the price of the art. */
(function(global) {
'use strict';

var DEFAULT_MAX_ZOOM = 4;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/* sanitize the base-pixel crop: non-finite or non-positive w/h mean "the
   whole base"; a rect that reaches past the base is cut back to it.
   Returns 0 when the numbers cannot describe a box inside the base. */
function readRegion(region, bw, bh, out) {
	out.x = region.x >= 0 && isFinite(region.x) ? region.x : 0;
	out.y = region.y >= 0 && isFinite(region.y) ? region.y : 0;
	if (out.x >= bw) out.x = 0;
	if (out.y >= bh) out.y = 0;
	const w = region.w, h = region.h;
	out.w = w > 0 && isFinite(w) ? (w > bw - out.x ? bw - out.x : w) : bw;
	out.h = h > 0 && isFinite(h) ? (h > bh - out.y ? bh - out.y : h) : bh;
	return out.w > 0 && out.h > 0;
}

function maxZoomOf(region) {
	const m = region.maxZoom;
	return m >= 1 && isFinite(m) ? m : DEFAULT_MAX_ZOOM;
}

/* zoom-1 scale: smallest that covers the window, but never so large that
   the region stops fitting in it. */
function fitScale(vw, vh, bw, bh, rw, rh) {
	const cover = vw / bw > vh / bh ? vw / bw : vh / bh;
	const room = vw / rw < vh / rh ? vw / rw : vh / rh;
	return room < cover ? room : cover;
}

/* one axis. The intersection of [vw − W, 0] (cover) and [−p0, vw − p0 − pl]
   (region visible) is never empty: pl ≤ win is the caller's condition and
   p0 + pl ≤ W holds because the rect is inside the base. */
function clampAxis(want, win, boxLen, p0, pLen) {
	if (boxLen < win) return (win - boxLen) / 2;
	let lo = win - boxLen, hi = 0;
	if (pLen <= win) {
		const rlo = -p0, rhi = win - p0 - pLen;
		if (rlo > lo) lo = rlo;
		if (rhi < hi) hi = rhi;
	}
	return clamp(want, lo, hi);
}

/* finalLayout(vw, vh, bw, bh, region, view, out)
	region: {x, y, w, h} base pixels (optional maxZoom); bad numbers read as
	          "the whole base".
	view:   {zoom, vx, vy} — vx/vy are the base top-left in window space at
	          raw zoom. MUTATED to the canonical clamped state, so re-running
	          a frame is idempotent and no other code may clamp anything.
	out:    {ok, s, x, y, w, h, hx, hy, hw, hh, clx, cly} — base box, region
	          box (= the HD child's box), and clamped-axis flags: 1 means the
	          edge clamp moved the requested pivot, by design at the edges. */
var R = { x: 0, y: 0, w: 0, h: 0 };
function finalLayout(vw, vh, bw, bh, region, view, out) {
	out.ok = 0;
	if (!(vw > 0 && vh > 0 && bw > 0 && bh > 0)) return out;
	if (!readRegion(region, bw, bh, R)) return out;
	const z = clamp(view.zoom >= 1 ? view.zoom : 1, 1, maxZoomOf(region));
	const s = fitScale(vw, vh, bw, bh, R.w, R.h) * z;
	const boxW = bw * s, boxH = bh * s;
	const rx = R.x * s, ry = R.y * s, rw = R.w * s, rh = R.h * s;
	const x = clampAxis(view.vx, vw, boxW, rx, rw);
	const y = clampAxis(view.vy, vh, boxH, ry, rh);
	out.ok = 1;
	out.s = s;
	out.x = x; out.y = y; out.w = boxW; out.h = boxH;
	out.hx = x + rx; out.hy = y + ry; out.hw = rw; out.hh = rh;
	out.clx = x === view.vx ? 0 : 1;
	out.cly = y === view.vy ? 0 : 1;
	view.zoom = z; view.vx = x; view.vy = y;
	return out;
}

/* zoomAround(view, px, py, k, region) pivots RAW state around the window
   point (px, py): the content point under it stays fixed exactly — only a
   later finalLayout may clamp. k is a multiplicative factor. */
function zoomAround(view, px, py, k, region) {
	const mz = maxZoomOf(region);
	const z0 = clamp(view.zoom >= 1 ? view.zoom : 1, 1, mz);
	const z1 = clamp(z0 * (k > 0 && isFinite(k) ? k : 1), 1, mz);
	const r = z1 / z0;
	view.zoom = z1;
	view.vx = px - (px - view.vx) * r;
	view.vy = py - (py - view.vy) * r;
	return view;
}

/* REGIONS lookup key: strip query, hash and one leading './'. NEVER decode
  URIComponent: percent-decoding mangles the data: URIs the harness uses. */
function normKey(src) {
	let s = String(src || '');
	const q = s.indexOf('?');
	if (q >= 0) s = s.slice(0, q);
	const h = s.indexOf('#');
	if (h >= 0) s = s.slice(0, h);
	if (s.charCodeAt(0) === 46 && s.charCodeAt(1) === 47) s = s.slice(2);
	return s;
}

var HDRegion = { finalLayout: finalLayout, zoomAround: zoomAround, normKey: normKey };
global.HDRegion = HDRegion;
if (typeof module !== 'undefined' && module.exports) module.exports = HDRegion;
})(typeof window !== 'undefined' ? window : globalThis);
