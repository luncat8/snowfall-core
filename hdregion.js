/* hdregion.js — HD-region core math (0.5.5). Single source of truth for the
   region layout/zoom; the snowfall-region.js adapter and the standalone viewer
   in the asset repo both call it and never re-derive a fit, clamp or pivot.
   Proven by test/region.js (200k fuzz, invariants I1/I2/I3).
   Classic script, zero DOM at load, require()-able under node. */
(function (global) {
'use strict';

function clamp(v, lo, hi) {
	return v < lo ? lo : (v > hi ? hi : v);
}

/* base layout: the region rect contained in the viewport, centered */
function baseLayout(vw, vh, bw, bh, r, zoom, out) {
	out.s = Math.min(vw / r.w, vh / r.h) * zoom;
	out.w = bw * out.s;
	out.h = bh * out.s;
	out.tx = vw / 2 - (r.x + r.w / 2) * out.s;
	out.ty = vh / 2 - (r.y + r.h / 2) * out.s;
	return out;
}

/* final layout: user pan added, then per-axis edge clamp.
   Proven region-safe at zoom 1 and cover-when-possible (I1/I2, 200k fuzz). */
function finalLayout(vw, vh, bw, bh, r, view, out) {
	baseLayout(vw, vh, bw, bh, r, view.zoom, out);
	var x = out.tx + view.x, y = out.ty + view.y;

	if (out.w > vw) x = clamp(x, vw - out.w, 0); else x = (vw - out.w) / 2;
	if (out.h > vh) y = clamp(y, vh - out.h, 0); else y = (vh - out.h) / 2;

	out.x = x;
	out.y = y;
	return out;
}

/* pivot-preserving zoom around (sx, sy). Mutates view.
   out.px/py = pre-clamp pivot (exact, I3); out.x/y = what the user sees
   (edge clamp may shift it, by design). Scratch S1/S2: no per-call allocs. */
var S1 = {}, S2 = {};
function zoomAround(vw, vh, bw, bh, r, view, sx, sy, newZoom, out) {
	finalLayout(vw, vh, bw, bh, r, view, S1);
	var ix = (sx - S1.x) / S1.s;
	var iy = (sy - S1.y) / S1.s;

	view.zoom = clamp(newZoom, 1, view.maxZoom || 4);
	baseLayout(vw, vh, bw, bh, r, view.zoom, S2);
	view.x = sx - S2.tx - ix * S2.s;
	view.y = sy - S2.ty - iy * S2.s;

	out.px = S2.tx + view.x + ix * S2.s;
	out.py = S2.ty + view.y + iy * S2.s;
	finalLayout(vw, vh, bw, bh, r, view, out);
	out.ix = ix;
	out.iy = iy;
	return out;
}

var HDRegion = {
	version: '0.1',
	clamp: clamp,
	baseLayout: baseLayout,
	finalLayout: finalLayout,
	zoomAround: zoomAround
};
global.HDRegion = HDRegion;
if (typeof module !== 'undefined' && module.exports) module.exports = HDRegion;
})(typeof window !== 'undefined' ? window : globalThis);
