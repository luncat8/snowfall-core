/* hdregion.js — region layout/zoom math for .snow-hd wagons (0.5.5).
	DOM-free, allocation-free, the same file is node-testable: it is the ONE
	authority for the fit scale, the rest framing, the edge clamp and the zoom
	pivot — a consumer that re-derives any of them is a bug.

	Coordinates are window space. At park the wagon's local frame IS the
	viewport (0,0 at top-left, vp.width × vp.height), so the base scaled by
	s and drawn at (x, y) is placed in the window with no second offset.

	Two rules, and they are the reference's (HD-region@1a89bb7, mirrored by
	test/vendor/hdregion-ref.js and enforced every commit by the parity gate):

	SCALE — the region is fitted into the window, `s = min(vw/rw, vh/rh)`, so
	the crop touches the window on its limiting axis and the outpainted base
	follows at the same scale. Not `min(cover, room)`: capping the art's scale
	by what the filler can cover shrinks the crop to a patch, and it is not
	`max` either — a region that IS the whole base (no entry, or a rect
	covering the picture) is contained and centred, the whole picture visible,
	letterbox bands and all. Fitting is what the wagon is for; the page
	background between the bands is the same background any `auto` image gets.

	POSITION — the rest framing centres the region in the window; the only
	clamp is coverage, `x ∈ [vw − W, 0]` when the base can cover and centring
	when it cannot. The coverage clamp never pushes the region out of view at
	rest (the fit already inscribes it) and no visibility sub-interval may be
	added to it: that is a clamp on the READER's pan, and it kills dragging on
	the axis where the crop exactly fills the window. */
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

/* zoom-1 scale: the largest that keeps the region inside the viewport. The crop
   is authored 1:1 with this rect, so that scale is also its native density. */
function fitScale(vw, vh, rw, rh) {
	return vw / rw < vh / rh ? vw / rw : vh / rh;
}

/* one axis: the box may not uncover the window; when it cannot reach both
   edges there is nothing left to choose, so the picture is centred. */
function clampAxis(want, win, boxLen) {
	if (boxLen < win) return (win - boxLen) / 2;
	return clamp(want, win - boxLen, 0);
}

/* the unpanned base position on one axis: the region centred in the frame. */
function restAxis(win, s, r0, rLen) { return (win - rLen * s) / 2 - r0 * s; }

/* a host that hands us NaN gets the rest framing, not a NaN'd style string */
function panOf(v) { return isFinite(v) ? v : 0; }

/* finalLayout(vw, vh, bw, bh, region, view, out)
	region: {x, y, w, h} base pixels (optional maxZoom); bad numbers read as
	          "the whole base".
	view:   {zoom, panX, panY}. panX/panY are the reader's pan in WINDOW
	          pixels away from the rest framing (region centred), so 0,0 is
	          "nobody has touched this wagon" and it means the same thing on a
	          phone and on an ultrawide. MUTATED to the canonical clamped pan,
	          so re-running a frame is a no-op and no other code may clamp.
	out:    {ok, s, x, y, w, h, hx, hy, hw, hh, clx, cly} — base box, region
	          box (= the HD child's box), and clamped-axis flags: 1 means
	          coverage moved the requested pan, by design at the edges. */
var R = { x: 0, y: 0, w: 0, h: 0 };
function finalLayout(vw, vh, bw, bh, region, view, out) {
	out.ok = 0;
	if (!(vw > 0 && vh > 0 && bw > 0 && bh > 0)) return out;
	if (!readRegion(region, bw, bh, R)) return out;
	const z = clamp(view.zoom >= 1 ? view.zoom : 1, 1, maxZoomOf(region));
	const s = fitScale(vw, vh, R.w, R.h) * z;
	const boxW = bw * s, boxH = bh * s;
	const rx = R.x * s, ry = R.y * s, rw = R.w * s, rh = R.h * s;
	const restX = restAxis(vw, s, R.x, R.w), restY = restAxis(vh, s, R.y, R.h);
	const wantX = restX + panOf(view.panX), wantY = restY + panOf(view.panY);
	const x = clampAxis(wantX, vw, boxW);
	const y = clampAxis(wantY, vh, boxH);
	out.ok = 1;
	out.s = s;
	out.x = x; out.y = y; out.w = boxW; out.h = boxH;
	out.hx = x + rx; out.hy = y + ry; out.hw = rw; out.hh = rh;
	out.clx = x === wantX ? 0 : 1;
	out.cly = y === wantY ? 0 : 1;
	view.zoom = z; view.panX = x - restX; view.panY = y - restY;
	return out;
}

/* zoomAround(vw, vh, bw, bh, region, view, px, py, k) pivots RAW state around
   the window point (px, py): the content point under it stays fixed exactly —
   only a later finalLayout may clamp. k is a multiplicative factor, so a
   gesture never has to know the current zoom. It needs the layout inputs
   because a pan is measured from the rest framing, which moves with the
   scale: deriving that here is what keeps it out of callers. */
function zoomAround(vw, vh, bw, bh, region, view, px, py, k) {
	if (!(vw > 0 && vh > 0 && bw > 0 && bh > 0)) return false;
	if (!readRegion(region, bw, bh, R)) return false;
	const mz = maxZoomOf(region);
	const z0 = clamp(view.zoom >= 1 ? view.zoom : 1, 1, mz);
	const z1 = clamp(z0 * (k > 0 && isFinite(k) ? k : 1), 1, mz);
	const fit = fitScale(vw, vh, R.w, R.h);
	const s0 = fit * z0, s1 = fit * z1;
	/* the content point is read off the box ON SCREEN, not off the raw state:
	   where the clamp centred the box it discarded the pan, and pretending
	   otherwise would pivot around a point nobody can see */
	const x0 = clampAxis(restAxis(vw, s0, R.x, R.w) + panOf(view.panX), vw, bw * s0);
	const y0 = clampAxis(restAxis(vh, s0, R.y, R.h) + panOf(view.panY), vh, bh * s0);
	const cx = isFinite(px) ? px : vw / 2, cy = isFinite(py) ? py : vh / 2;
	view.zoom = z1;
	view.panX = cx - (cx - x0) * (s1 / s0) - restAxis(vw, s1, R.x, R.w);
	view.panY = cy - (cy - y0) * (s1 / s0) - restAxis(vh, s1, R.y, R.h);
	return true;
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
