/* test/region-parity.js — hdregion.js must agree with the reference implementation
	to the last decimal on real scene data. This is the gate that catches "the math
	drifted while it looked plausible": containment invariants (I1/I2/I4) bound
	where a box may be, not which box it is, and every policy argument in the plan
	produced a *defensible* but wrong number until it was measured side by side.

	The oracle is the pinned copy in test/vendor/hdregion-ref.js
	(HD-region@1a89bb7). Scenes are that repo's own regions.js, so a rect that
	only ever appears in a synthetic generator can never pass here.

	Run: node test/region-parity.js   (exit 0 = parity)
	   or: node test/run.js          (the pre-commit gate) */
'use strict';
const path = require('path');
const REF = require(path.join(__dirname, 'vendor/hdregion-ref.js'));
const MINE = require(path.join(__dirname, '../hdregion.js'));
const scenes = require(path.join(__dirname, 'vendor/regions-ref.js'));

let checks = 0, fails = 0;
const TOL = 1e-6;
function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? TOL : tol); }
function ok(cond, msg) { checks++; if (cond) return true; if (fails < 12) console.error('FAIL ' + msg); fails++; return false; }

/* the two states, same numbers in different words: the reference pans by
   `view.x/view.y` added to its centred rest position, this repo by
   `panX/panY` away from the rest framing — identical by construction */
function refLayout(vw, vh, bw, bh, r, zoom, x, y, maxZoom) {
	const out = {};
	REF.finalLayout(vw, vh, bw, bh, r, { zoom: zoom, x: x, y: y, maxZoom: maxZoom }, out);
	return out;
}
function mineLayout(vw, vh, bw, bh, r, zoom, x, y, maxZoom) {
	const view = { zoom: zoom, panX: x, panY: y };
	const out = MINE.finalLayout(vw, vh, bw, bh, { x: r.x, y: r.y, w: r.w, h: r.h, maxZoom: maxZoom }, view, {});
	out.zoom = view.zoom;
	out.panX = view.panX; out.panY = view.panY;
	return out;
}
function compare(tag, vw, vh, bw, bh, r, zoom, x, y, maxZoom) {
	const B = mineLayout(vw, vh, bw, bh, r, zoom, x, y, maxZoom);
	/* mine canonicalizes zoom into [1, maxZoom] inside finalLayout (the
	   reference clamps in zoomAround only) — hand the oracle that zoom, or the
	   comparison would measure a documented difference instead of a bug */
	const A2 = refLayout(vw, vh, bw, bh, r, B.zoom, x, y, maxZoom);   /* B.zoom = canonicalized */
	ok(near(A2.s, B.s), tag + ' scale');
	ok(near(A2.x, B.x, 1e-4) && near(A2.y, B.y, 1e-4), tag + ' position '
		+ A2.x.toFixed(4) + ',' + A2.y.toFixed(4) + ' vs ' + B.x.toFixed(4) + ',' + B.y.toFixed(4));
	ok(near(A2.w, B.w) && near(A2.h, B.h), tag + ' box size');
	/* the HD child box is the region box on the base box; the reference
	   computes it in its adapter (hw = rw*L.s, hx = L.x + rx*L.s), so compare
	   with the same formula instead of trusting either side's field */
	ok(near(B.hx, B.x + r.x * B.s, 1e-4) && near(B.hy, B.y + r.y * B.s, 1e-4), tag + ' child x/y = base + rect·s');
	ok(near(B.hw, r.w * B.s, 1e-4) && near(B.hh, r.h * B.s, 1e-4), tag + ' child w/h = rect·s');
	ok(near(A2.x + r.x * A2.s, B.hx, 1e-4), tag + ' child x equals the reference child x');
	return B;
}

/* ---------------- 1 · the reference's own scenes × real window shapes ---------------- */
const VPS = [[1920, 1080], [1440, 900], [1366, 768], [1280, 800], [1536, 864],
	[1080, 1920], [768, 1024], [390, 844], [360, 780], [2560, 1080], [2880, 1800], [1180, 420]];
const PANS = [[0, 0], [1, 0], [-40, 25], [400, 200], [-900, 120], [3e5, -2e5]];
let scenesN = 0;
for (const key of Object.keys(scenes)) {
	const e = scenes[key];
	scenesN++;
	for (const [vw, vh] of VPS) {
		for (const zoom of [1, 1.5, 4]) {
			for (const [x, y] of PANS) {
				compare(key + ' ' + vw + '×' + vh + ' z' + zoom + ' pan ' + x + ',' + y,
					vw, vh, e.bw, e.bh, { x: e.x, y: e.y, w: e.w, h: e.h }, zoom, x, y, e.maxZoom || 4);
			}
		}
		/* a wagon with no crop to place is the whole base, and the whole base is
		   contained + centred — the reference has no special case, so neither may we */
		for (const [vw, vh] of VPS) {
			compare(key + ' whole-base ' + vw + '×' + vh, vw, vh, e.bw, e.bh,
				{ x: 0, y: 0, w: e.bw, h: e.bh }, 1, 0, 0, 4);
		}
	}
}
/* the repo's own data file must still describe those scenes (it is generated
   material — if it drifts from the reference, QA stops proving anything) */
for (const key of Object.keys(scenes)) {
	const e = scenes[key];
	ok(e.w === e.hdW && e.h === e.hdH, key + ' crop image is 1:1 with the rect (' + e.hdW + '×' + e.hdH + ' vs ' + e.w + '×' + e.h + ')');
	ok(e.bw === e.imgW && e.bh === e.imgH, key + ' entry bw/bh equals the shipped base image');
}

/* ---------------- 2 · zoomAround: pivot and resulting state ---------------- */
for (const key of Object.keys(scenes)) {
	const e = scenes[key];
	for (const [vw, vh] of VPS) {
		for (const [z0, k] of [[1, 1.7], [1, 3], [2, 0.5], [1, 1e9], [3.25, 0.01]]) {
			const r = { x: e.x, y: e.y, w: e.w, h: e.h };
			const sx = vw * 0.31, sy = vh * 0.77;
			const mState = { zoom: z0, panX: 40, panY: -90 };
			const mRegion = { x: r.x, y: r.y, w: r.w, h: r.h, maxZoom: 4 };
			MINE.zoomAround(vw, vh, e.bw, e.bh, mRegion, mState, sx, sy, k);
			const refState = { zoom: z0, x: 40, y: -90, maxZoom: 4 };
			const refOut = {};
			REF.zoomAround(vw, vh, e.bw, e.bh, r, refState, sx, sy, z0 * k, refOut);
			ok(near(refState.zoom, mState.zoom), key + ' zoom after pivot');
			ok(near(refState.x, mState.panX, 1e-3) && near(refState.y, mState.panY, 1e-3),
				key + ' pan after pivot: ref ' + refState.x.toFixed(2) + ',' + refState.y.toFixed(2)
				+ ' vs mine ' + mState.panX.toFixed(2) + ',' + mState.panY.toFixed(2));
			const A = refLayout(vw, vh, e.bw, e.bh, r, mState.zoom, mState.panX, mState.panY, 4);
			ok(near(A.x, refOut.x, 1e-3) && near(A.y, refOut.y, 1e-3), key + ' zoomed box lands where the reference lands it');
		}
	}
}

/* ---------------- 3 · fuzz parity, seeded ---------------- */
function rng32(seed) {
	let a = seed >>> 0;
	return function () {
		a = (a + 0x6D2B79F5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
{
	const rnd = rng32(0xDA7A);
	const N = 60000;
	let bad = 0;
	for (let t = 0; t < N; t++) {
		const vw = 100 + rnd() * 3000, vh = 100 + rnd() * 3000;
		const bw = 100 + rnd() * 4000, bh = 100 + rnd() * 4000;
		const rw = 10 + rnd() * (bw - 10), rh = 10 + rnd() * (bh - 10);
		const r = { x: rnd() * (bw - rw), y: rnd() * (bh - rh), w: rw, h: rh };
		const zoom = 1 + rnd() * 3;
		const x = (rnd() - 0.5) * 4000, y = (rnd() - 0.5) * 4000;
		const A = refLayout(vw, vh, bw, bh, r, zoom, x, y, 4);
		const B = mineLayout(vw, vh, bw, bh, r, zoom, x, y, 4);
		if (!(near(A.s, B.s) && near(A.x, B.x, 1e-4) && near(A.y, B.y, 1e-4)
			&& near(A.w, B.w) && near(A.h, B.h))) {
			bad++;
			if (bad < 4) {
				console.error('FAIL fuzz parity t=' + t + ' vw=' + vw + ' vh=' + vh + ' bw=' + bw + ' bh=' + bh
					+ ' r=' + JSON.stringify(r) + ' zoom=' + zoom + ' pan=' + x + ',' + y);
				console.error('  ref  s=' + A.s + ' x=' + A.x + ' y=' + A.y);
				console.error('  mine s=' + B.s + ' x=' + B.x + ' y=' + B.y);
			}
		}
		checks++;
	}
	fails += bad;
	console.log('parity: ' + scenesN + ' real scene(s) × ' + VPS.length + ' window shapes × pans/zooms, plus '
		+ N + ' fuzzed layouts, ' + bad + ' divergences');
}

console.log('region-parity: ' + (checks - fails) + '/' + checks + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
