#!/usr/bin/env node
/* test/region.js — 0.5.5 gates: HDRegion invariant fuzz (200k random
/layouts), the fake-DOM engine viewport-contract integration, and static
/ source checks for the adapter. `node test/region.js`. */
'use strict';
const fs = require('fs');
const path = require('path');
const HD = require('../hdregion.js');

let checks = 0, fails = 0;
function ok(cond, name) {
	checks++;
	if (cond) return;
	fails++;
	console.error('FAIL ' + name);
}
function near0(v, win) { const t = 1e-6; return Math.abs(v - (win === undefined ? 0 : win)) <= t; }
function rng32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0; a = a + 0x6D2B79F5 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}

/* ---------------- finalLayout fuzz: I1 / I2 / I4 / idempotence ----------------
   I4 is the fit itself. The region sets the scale — the crop fills the window
   on its limiting axis — and only a region that IS the base takes the cover
   fit. A scale capped by "cover the window with the base" shrinks the art to a
   patch on the filler, which is the one thing this feature must never do, so
   I4 is its regression gate. */
{
	const rnd = rng32(0xC0FFEE);
	const N = 200000;
	const T = 1e-9;
	let clx = 0, cly = 0, skipped = 0, wholes = 0;
	for (let t = 0; t < N; t++) {
		const vw = 320 + rnd() * 2280;
		const vh = 560 + rnd() * 1140;
		const bw = 1 + rnd() * 4000;
		const bh = 1 + rnd() * 4000;
		let rw = 1 + rnd() * bw, rh = 1 + rnd() * bh;
		/* every fifth row is the plain-background shape: no entry, or a rect
		   that covers the picture — then there is no art to protect */
		if (t % 5 === 4) { rw = bw; rh = bh; }
		const rx = rnd() * (bw - rw), ry = rnd() * (bh - rh);
		const region = { x: rx, y: ry, w: rw, h: rh };
		if (t % 4 === 0) region.maxZoom = 1 + rnd() * 5;
		const view = { zoom: 0.2 + rnd() * 8, panX: (rnd() - 0.5) * 2e6, panY: (rnd() - 0.5) * 2e6 };
		const out = {};
		HD.finalLayout(vw, vh, bw, bh, region, view, out);
		if (!out.ok) { skipped++; ok(false, 't' + t + ' valid input rejected'); continue; }
		/* all finite */
		ok(isFinite(out.s) && isFinite(out.x) && isFinite(out.y) && isFinite(out.w) && isFinite(out.h) &&
			isFinite(out.hx) && isFinite(out.hy) && isFinite(out.hw) && isFinite(out.hh), 't' + t + ' finite');
		/* zoom clamped into [1, maxZoom] */
		const mz = region.maxZoom >= 1 ? region.maxZoom : 4;
		ok(view.zoom >= 1 - T && view.zoom <= mz + T, 't' + t + ' zoom clamped');
		/* base box equals bw/bh × s */
		ok(Math.abs(out.w - bw * out.s) <= 1e-6 * out.w + T, 't' + t + ' w = bw·s');
		ok(Math.abs(out.h - bh * out.s) <= 1e-6 * out.h + T, 't' + t + ' h = bh·s');
		/* I4: the zoom-1 scale, recovered by undoing the clamped zoom, IS the
		   region fit — one rule for every rect, whole base included. No cover
		   cap (main's min(cover, room) shrank the art to a patch) and no cover
		   exception either (a whole-base rect blown up to cover crops the
		   picture instead of fitting it, which is the other way to fail). */
		const fw = out.hw / out.s, fh = out.hh / out.s;
		const fit = out.s / view.zoom;
		const room = vw / fw < vh / fh ? vw / fw : vh / fh;
		ok(Math.abs(fit - room) <= 1e-9 * fit + T, 't' + t + ' I4 the crop sets the scale');
		ok(fit + T >= room, 't' + t + ' I4 art never smaller than its fit');
		if (fw >= bw - 1e-9 && fh >= bh - 1e-9) {
			wholes++;
			ok(bw * fit <= vw + T && bh * fit <= vh + T, 't' + t + ' I4 whole base is contained');
			if (out.w <= vw + T) ok(Math.abs(out.x - (vw - out.w) / 2) <= T, 't' + t + ' I4 under-size base centred on x');
			if (out.h <= vh + T) ok(Math.abs(out.y - (vh - out.h) / 2) <= T, 't' + t + ' I4 under-size base centred on y');
		}
		/* I2: covers every axis the box is big enough for; centers the rest */
		if (out.w >= vw - T) ok(out.x <= T && out.x + out.w >= vw - T, 't' + t + ' I2 x');
		else ok(Math.abs(out.x - (vw - out.w) / 2) <= T, 't' + t + ' I2 x centered');
		if (out.h >= vh - T) ok(out.y <= T && out.y + out.h >= vh - T, 't' + t + ' I2 y');
		else ok(Math.abs(out.y - (vh - out.h) / 2) <= T, 't' + t + ' I2 y centered');
		/* The clamp is PURE coverage: it may pin a box edge, and it must do
		   nothing else. A region-visibility sub-interval here (what this repo
		   shipped before) reads as "the crop can never leave the frame", and
		   because the fit makes the crop exactly as tall (or wide) as the
		   window, it also makes that axis undraggable at zoom 1 — a clamp on
		   the reader, not on the art. So: 10 more px of pan moves the box
		   10 px, unless a box edge is what stopped it, or the axis centres an
		   under-size box (where a pan has nothing to act on by definition). */
		const p2 = { zoom: view.zoom, panX: view.panX + 10, panY: view.panY + 10 };
		const o2x = HD.finalLayout(vw, vh, bw, bh, region, p2, {});
		if (o2x.ok) {
			if (Math.abs(o2x.x - out.x - 10) > 1e-6)
				ok(o2x.w <= vw + T || near0(o2x.x) || near0(o2x.x + o2x.w - vw)
					|| near0(out.x) || near0(out.x + out.w - vw), 't' + t + ' I5 pan resisted for no coverage reason (x)');
			if (Math.abs(o2x.y - out.y - 10) > 1e-6)
				ok(o2x.h <= vh + T || near0(o2x.y) || near0(o2x.y + o2x.h - vh) || near0(out.y)
					|| near0(out.y + out.h - vh), 't' + t + ' I5 pan resisted for no coverage reason (y)');
		}
		/* the HD box is the region box on the base box */
		ok(out.hx >= out.x - T && out.hx + out.hw <= out.x + out.w + T, 't' + t + ' hd inside base x');
		ok(out.hy >= out.y - T && out.hy + out.hh <= out.y + out.h + T, 't' + t + ' hd inside base y');
		/* clamped `view` is persisted, and a re-run is a no-op (one authority) */
		const v2 = { zoom: view.zoom, panX: view.panX, panY: view.panY };
		const o2 = {};
		HD.finalLayout(vw, vh, bw, bh, region, v2, o2);
		ok(Math.abs(o2.x - out.x) <= 1e-6 && Math.abs(o2.y - out.y) <= 1e-6 && Math.abs(o2.s - out.s) <= 1e-12,
			't' + t + ' idempotent');
		clx += out.clx; cly += out.cly;
	}
	console.log('fuzz: ' + N + ' layouts, clamped-x ' + clx + ', clamped-y ' + cly +
		', whole-base ' + wholes + ', degenerate-skip ' + skipped);
	/* the edge clamp must actually engage (huge random pans guarantee it) */
	ok(clx > N / 100, 'edge clamp engages');
	ok(wholes > N / 10, 'whole-base rows sampled');
}

/* ---------------- the rest framing: an untouched wagon frames the ART ------
   pan 0,0 means "nobody has touched this wagon", so it must be the region
   centred in the window, and only ever move when centring would uncover the
   page — a base edge pinned to a window edge is then the answer. A state that
   doubles as a raw position (a base corner in window space) decides the
   composition by accident: seeded at 0 it parks the crop against an edge and
   every reset lands there, which is exactly the bug this gate now blocks. */
function restAxis(name, boxPos, boxLen, regPos, regLen, win, counts) {
	if (regLen >= win - 1e-6) { counts.tight++; return; }         /* fills the axis */
	ok(regPos >= -1e-6 && regPos + regLen <= win + 1e-6, 'rest ' + name + ': region visible');
	if (Math.abs(regPos - (win - regLen) / 2) <= 1e-6) { counts.centred++; return; }
	/* the base cannot even reach the window edges on this axis: gaps are
	   unavoidable, so the PICTURE is centred and the crop sits where it lies */
	if (boxLen < win + 1e-6) {
		ok(Math.abs(boxPos - (win - boxLen) / 2) <= 1e-6, 'rest ' + name + ': an under-size base is centred');
		counts.small++;
		return;
	}
	/* centring would uncover the page: coverage wins and pins a base edge */
	if (Math.abs(boxPos) <= 1e-6 || Math.abs(boxPos + boxLen - win) <= 1e-6) { counts.pinned++; return; }
	ok(false, 'rest ' + name + ': neither centred, coverage-pinned, nor under-size');
}
{
	const rnd = rng32(0x5EED17);
	const N = 40000;
	const counts = { centred: 0, pinned: 0, tight: 0, small: 0 };
	for (let t = 0; t < N; t++) {
		const vw = 320 + rnd() * 2280, vh = 560 + rnd() * 1140;
		const bw = 40 + rnd() * 3000, bh = 40 + rnd() * 3000;
		/* the rect is inside the base by construction: what the reader ships
		   after the generator's sanitizing pass always is, and a rect outside
		   it would test the sanitizer here, not the framing */
		let rw = bw * (0.02 + rnd() * 0.98), rh = bh * (0.02 + rnd() * 0.98);
		if (t % 5 === 4) { rw = bw; rh = bh; }
		const region = { x: rnd() * (bw - rw), y: rnd() * (bh - rh), w: rw, h: rh };
		const view = { zoom: 1, panX: 0, panY: 0 };
		const out = HD.finalLayout(vw, vh, bw, bh, region, view, {});
		ok(out.ok, 'rest layout computed');
		restAxis('x', out.x, out.w, out.hx, out.hw, vw, counts);
		restAxis('y', out.y, out.h, out.hy, out.hh, vh, counts);
		/* the persisted state of a rest wagon reproduces the position it just
		   produced (idempotence, up to the float walk of a pan round trip) */
		const again = HD.finalLayout(vw, vh, bw, bh, region, view, {});
		ok(Math.abs(again.x - out.x) <= 1e-6 && Math.abs(again.y - out.y) <= 1e-6, 'rest state is a fixed point');
		/* a rest position the clamp left alone persists as pan 0, so an
		   untouched wagon cannot drift one ulp per frame and repaint forever */
		const restX = (vw - region.w * out.s) / 2 - region.x * out.s;
		if (out.x === restX) ok(view.panX === 0, 'rest position persists as pan 0');
		else ok(out.clx === 1, 'a moved rest position means the clamp engaged');
	}
	console.log('rest framing: ' + N + ' layouts (2 axes each) — centred ' + counts.centred +
		', coverage-pinned ' + counts.pinned + ', fills-the-axis ' + counts.tight +
		', under-size-base ' + counts.small);
	ok(counts.centred + counts.tight > N / 4, 'the rest framing centres');
}

/* ---------------- zoomAround pivot: I3 pre-clamp ---------------- */
{
	const rnd = rng32(0xBEEF);
	const N = 50000;
	let moved = 0;
	for (let t = 0; t < N; t++) {
		const vw = 320 + rnd() * 2280, vh = 560 + rnd() * 1140;
		const bw = 200 + rnd() * 3000, bh = 200 + rnd() * 3000;
		const rw = 1 + rnd() * bw, rh = 1 + rnd() * bh;
		const region = { x: rnd() * (bw - rw), y: rnd() * (bh - rh), w: rw, h: rh, maxZoom: 4 };
		const view = { zoom: 1 + rnd() * 2, panX: (rnd() - 0.5) * 4000, panY: (rnd() - 0.5) * 4000 };
		const px = rnd() * vw, py = rnd() * vh;
		const pre = {};
		HD.finalLayout(vw, vh, bw, bh, region, view, pre); /* canonicalize raw state */
		const z0 = view.zoom, s0 = pre.s;
		const cx = (px - pre.x) / s0, cy = (py - pre.y) / s0;   /* content point under cursor */
		const k = 1.2 + rnd() * 2.6;
		HD.zoomAround(vw, vh, bw, bh, region, view, px, py, k);
		ok(Math.abs(view.zoom - Math.min(4, z0 * k)) < 1e-9, 't' + t + ' zoom = clamped product');
		const post = {};
		HD.finalLayout(vw, vh, bw, bh, region, view, post); /* clamps */
		if (!post.clx) ok(Math.abs(post.x + cx * post.s - px) <= 1e-3, 't' + t + ' I3 pivot x exact');
		else moved++;
		if (!post.cly) ok(Math.abs(post.y + cy * post.s - py) <= 1e-3, 't' + t + ' I3 pivot y exact');
	}
	console.log('pivot: ' + N + ' zoom-arounds, ' + moved + ' with x-clamp shifting the visible pivot (by design)');
	ok(moved > 0, 'pivot proof counts clamped pivots');
}

/* ---------------- normKey ---------------- */
{
	const k = HD.normKey('./img/3.avif?v=2#frag');
	ok(k === 'img/3.avif', 'normKey strips ./, query, hash — got ' + k);
	const d = HD.normKey("data:image/svg+xml,%3Csvg%20a%3D%22x%22%23y%22");
	ok(d === "data:image/svg+xml,%3Csvg%20a%3D%22x%22%23y%22", 'normKey does NOT percent-decode data URIs');
	ok(HD.normKey('img/a%20b.avif') === 'img/a%20b.avif', 'normKey leaves %20 alone');
	ok(HD.normKey(null) === '', 'normKey null → empty');
}

/* ---------------- fake-DOM engine integration: the viewport contract ----------------
	Exactly the bug 0.5.5 fixes: the box sizes to clientWidth while frame()
	used to receive innerWidth. A 15px scrollbar is faked on purpose. */
{
	const cw = 1425, iw = 1440, ih = 900;
	const props = {};
	const listeners = {};
	function fakeEl() {
		return {
			style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: () => {}, transform: '' },
			classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
			setAttribute: () => {}, getAttribute: () => null, hasAttribute: () => false,
			querySelectorAll: () => ({ length: 0 }),
			appendChild: () => {}, insertBefore: () => {}, dataset: {},
			getBoundingClientRect: () => ({ top: 500, bottom: 800, height: 300, left: 0, right: 1440 })
		};
	}
	const app = fakeEl();
	/* ONE real fake wagon in the tree: wagonsMeasure/wagonsFrame then execute
	   their full bodies under the gate — the bug class of the 0.5.5 clamp edit
	   (a counter declaration eaten by a diff, `writes is not defined` at the
	   first frame) must never pass green with n===0 again */
	const wagonPar = fakeEl();
	wagonPar.getBoundingClientRect = () => ({ top: 400, bottom: 900, height: 500, left: 0, right: 1440 });
	const wagon = fakeEl();
	wagon.parentElement = wagonPar;
	wagon.parentNode = wagonPar;
	wagon.offsetHeight = 300;
	wagon.dataset = {};
	app.querySelectorAll = sel => sel === '.snow-bg' ? { length: 1, 0: wagon } : { length: 0 };
	global.getComputedStyle = () => ({
		paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px',
		borderBottomWidth: '0px', paddingLeft: '0px', borderLeftWidth: '0px', fontSize: '16px'
	});
	const de = {
		clientWidth: cw,
		style: { setProperty: (k, v) => { props[k] = v; } },
		classList: { add: () => {}, remove: () => {}, toggle: () => {} }
	};
	const doc = {
		documentElement: de,
		readyState: 'loading',
		getElementById: id => id === 'app' ? app : null,
		createElement: fakeEl,
		head: { appendChild: () => {} },
		addEventListener: () => {}
	};
	const win = {
		innerWidth: iw, innerHeight: ih, scrollY: 137,
		addEventListener: (t, f, o) => { listeners[t] = { f, o }; },
		removeEventListener: () => {}
	};
	global.window = win;
	global.document = doc;
	delete require.cache[require.resolve('../snowfall.js')];
	const S2 = require('../snowfall.js');
	ok(S2.default, 'engine auto-booted under fake DOM');
	ok(S2.version === '0.5.5', 'version bumped');
	/* subscriber sees clientWidth, NOT innerWidth */
	let got = null, measuredWagons = false;
	S2.default.use({
		measure: () => { got = got || {}; got.measured = true; measuredWagons = !!S2.wagons; },
		frame: (sY, vh, vw) => { got = { sY, vh, vw }; }
	});
	S2.refresh();
	ok(measuredWagons, 'built-in wagons measured before the user subscriber');
	eqv(S2.wagons.n, 1, 'the fake wagon was measured');
	ok(/translate3d\(/.test(wagon.style.transform), 'wagonsFrame ran its loop on the fake wagon');
	eqv(got.vw, cw, 'frame vw = clientWidth (not innerWidth)');
	eqv(got.vh, ih, 'frame vh = innerHeight');
	eqv(got.sY, 137, 'frame sY from window.scrollY');
	eqv(S2.viewport.width, cw, 'Snowfall.viewport.width = clientWidth');
	eqv(S2.viewport.height, ih, 'Snowfall.viewport.height = innerHeight');
	eqv(props['--snow-vw'], cw + 'px', '--snow-vw written from vp');
	eqv(props['--snow-vh'], ih + 'px', '--snow-vh written from vp');
	/* read-only getter on the namespace and the instance */
	ok(!Object.getOwnPropertyDescriptor(S2, 'viewport').set, 'namespace viewport is read-only');
	ok(!Object.getOwnPropertyDescriptor(S2.default, 'viewport').set, 'instance viewport is read-only');
	/* scroll re-measures the viewport (mobile URL bar) without a resize */
	const bar = { width: 985, height: ih };
	de.clientWidth = 985;
	listeners.scroll.f();
	eqv(S2.viewport.width, 985, 'scroll event re-measures viewport');
	eqv(got.vw, 985, 'frame vw follows the viewport on scroll');
	eqv(props['--snow-vw'], '985px', '--snow-vw follows');
	/* step() defaults reuse the cache; innerWidth never leaks */
	win.innerWidth = 2000;
	S2.step(50);
	eqv(got.sY, 50, 'step(sY) passes sY');
	eqv(got.vw, 985, 'step() defaults to cached clientWidth');
	eqv(got.vh, ih, 'step() defaults to cached innerHeight');
	S2.step(50, 700, 600);
	eqv(got.vw, 600, 'explicit step args still pass through');
	ok(listeners.scroll.o && listeners.scroll.o.passive === true, 'engine scroll listener is passive');
	/* cleanup for the rest of this process */
	delete global.window;
	delete global.document;
	delete global.Snowfall;
	delete global.getComputedStyle;
}
function eqv(a, b, name) { ok(a === b, name + ' (' + a + ' vs ' + b + ')'); }

/* ---------------- fake-DOM adapter integration ----------------
	measure → frame → written child styles, compared to an independent
	HDRegion recomputation; plus the fixed/auto exclusion and missing-entry
	fallback. This is the alignment proof — the GUI probe repeats it live. */
function fakeImg(src, nw, nh) {
	const img = {
		tagName: 'IMG', style: {}, _a: { src }, complete: true,
		naturalWidth: nw, naturalHeight: nh,
		getAttribute(k) { return this._a[k] === undefined ? null : this._a[k]; },
		addEventListener() {}, classList: { contains: () => false }
	};
	return img;
}
function fakeWagon(children, mode) {
	const el = {
		tagName: 'DIV', style: {}, dataset: mode ? { mode } : {}, _a: {}, kids: [],
		hasAttribute: () => false,
		getAttribute(k) { return this._a[k] === undefined ? null : this._a[k]; },
		addEventListener() {}
	};
	el.kids = children.filter(Boolean);
	for (let i = 0; i < el.kids.length; i++) {
		el.kids[i].parentNode = el;
		el.kids[i].nextElementSibling = el.kids[i + 1] || null;
	}
	el.firstElementChild = el.kids[0] || null;
	const cls = [];
	el.classList = {
		add: c => { if (cls.indexOf(c) < 0) cls.push(c); },
		remove: c => { const i = cls.indexOf(c); if (i >= 0) cls.splice(i, 1); },
		contains: c => cls.indexOf(c) >= 0
	};
	return el;
}
{
	const cw = 1425, iw = 1440, ih = 900;
	const props = {};
	const fakeEl = () => ({
		style: { setProperty: (k, v) => { props[k] = v; } },
		classList: { add: () => {}, remove: () => {}, toggle: () => {} },
		appendChild: () => {},
		setAttribute: () => {},
		querySelector: () => ({ checked: false, addEventListener: () => {} }),
		innerHTML: '', textContent: '', id: '', hidden: false
	});
	/* four wagons: a full entry, no entry at all, an entry that declares no
	   crop, and a fixed one the adapter must not touch. documentElement records
	   its classes so the snow-ready round trip is checkable — frame() has to
	   re-assert it, because Snowfall.setEnabled(true) only steps. */
	const rootCls = [];
	const trackCls = {
		add: c => { if (rootCls.indexOf(c) < 0) rootCls.push(c); },
		remove: c => { const i = rootCls.indexOf(c); if (i >= 0) rootCls.splice(i, 1); },
		toggle: () => {}, contains: c => rootCls.indexOf(c) >= 0
	};
	const wags = [
		fakeWagon([fakeImg('img/a.png', 800, 600), fakeImg('img/a_c.png', 800, 600)]),
		fakeWagon([fakeImg('img/b.png', 800, 600)]),
		fakeWagon([fakeImg('img/f.png', 800, 600), fakeImg('img/f_c.png', 1, 1)], 'fixed'),
		fakeWagon([fakeImg('img/g.png', 800, 600), fakeImg('img/g_c.png', 800, 600)])
	];
	const doc = {
		readyState: 'complete',
		documentElement: Object.assign(fakeEl(), { clientWidth: cw, classList: trackCls }),
		createElement: fakeEl,
		head: { appendChild: () => {} },
		addEventListener: () => {},
		body: { appendChild: () => {} }
	};
	doc.getElementById = id => id === 'app'
		? { querySelectorAll: sel => sel.indexOf('snow-hd') >= 0 ? wags : { length: 0 } }
		: null;
	/* the modules' `global` is the fake window itself when window exists —
	   everything they read off `global` must live on it, not globalThis */
	const win = {
		innerWidth: iw, innerHeight: ih, scrollY: 0,
		addEventListener: () => {}, removeEventListener: () => {},
		HDRegion: HD,
		REGIONS: {
			'img/a.png': { x: 100, y: 50, w: 400, h: 300, hd: 'img/a_c.png' },
			'img/f.png': { x: 10, y: 10, w: 100, h: 100, hd: 'img/f_c.png' },
			'img/g.png': { x: 100, y: 50, w: 400, h: 300 }
		},
		Snowfall: {
			default: { use: () => {} },
			use: () => {},
			refresh: () => {},
			step: () => {},
			wagons: { n: 0, els: [], y: [], free: [], pos: [] },
			viewport: { width: cw, height: ih }
		}
	};
	global.window = win;
	global.document = doc;
	delete require.cache[require.resolve('../snowfall-region.js')];
	const A = require('../snowfall-region.js');
	const warns = [];
	const origWarn = console.warn;
	console.warn = msg => warns.push(String(msg));
	try {
		A.measure();
		console.warn = origWarn;
		eqv(A.count(), 3, 'adapter manages 3 of 4 (fixed excluded)');
		eqv(warns.length, 1, 'exclusion warned exactly once');
		ok(wags[0].classList.contains('snow-hd-live'), 'managed wagon gets snow-hd-live');
		ok(!wags[2].classList.contains('snow-hd-live'), 'excluded wagon stays unmanaged');
		ok(!wags[2].kids[0].style.width, 'excluded wagon children untouched');
		ok(rootCls.indexOf('snow-ready') >= 0, 'measure turns JS sizing on');
		A.frame(0, ih, cw);
		const npx = s => parseFloat(s) || 0;
		const b0 = wags[0].kids[0], h0 = wags[0].kids[1];
		const v = A.view(0);
		const out = HD.finalLayout(cw, ih, 800, 600, { x: 100, y: 50, w: 400, h: 300, maxZoom: 0 },
			{ zoom: v.zoom, panX: v.panX, panY: v.panY }, {});
		ok(Math.abs(npx(b0.style.width) - out.w) <= 1e-6 && Math.abs(npx(b0.style.height) - out.h) <= 1e-6, 'base sized from HDRegion box');
		const t = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(b0.style.transform);
		ok(t && Math.abs(+t[1] - out.x) <= 1e-6 && Math.abs(+t[2] - out.y) <= 1e-6, 'base translated from HDRegion box');
		ok(h0.style.display !== 'none', 'HD unhidden (loaded at measure seed)');
		ok(Math.abs(npx(h0.style.width) - out.hw) <= 1e-6 && Math.abs(npx(h0.style.height) - out.hh) <= 1e-6, 'HD sized to region box');
		const th = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(h0.style.transform);
		ok(th && Math.abs(+th[1] - out.hx) <= 1e-6 && Math.abs(+th[2] - out.hy) <= 1e-6, 'HD translated to region position');
		/* I4 at a real page shape: 800×600 base, a 400×300 rect in it, a
		   1425×900 window ⇒ s = 900/300 = 3, so the crop is 1200×900 — the
		   coverage fit would have drawn it at 0.9 and called that a picture */
		ok(Math.abs(out.s - 3) < 1e-9, 'I4 the crop, not the filler, sets the scale');
		ok(Math.abs(out.hh - ih) <= 1e-6, 'I4 the crop touches the window on its limiting axis');
		ok(Math.abs(out.hx - (cw - out.hw) / 2) <= 1e-6, 'the crop is centred on the slack axis');
		ok(Math.abs(out.x - ((cw - out.hw) / 2 - 100 * out.s)) <= 1e-6, 'the base rides with the crop');
		/* I2 live shape: the base covers the fake viewport (800×600 vs 1425×900) */
		ok(out.x <= 1e-6 && out.x + out.w >= cw - 1e-6, 'I2 x at fake viewport');
		ok(out.y <= 1e-6 && out.y + out.h >= ih - 1e-6, 'I2 y at fake viewport');
		/* I1: the region is fully visible at zoom 1 */
		ok(out.hx >= -1e-6 && out.hx + out.hw <= cw + 1e-6, 'I1 x at fake viewport');
		/* no entry at all, and an entry with no crop to paint: both are plain
		   backgrounds — the whole base covers the window, nothing letterboxes,
		   and a declared-but-undecorated second <img> stays hidden */
		const outW = HD.finalLayout(cw, ih, 800, 600, { x: 0, y: 0, w: 0, h: 0 }, { zoom: 1, panX: 0, panY: 0 }, {});
		ok(outW.w <= cw + 1e-6 && outW.h <= ih + 1e-6, 'whole-base fallback is contained, never magnified');
		ok(Math.abs(outW.x - (cw - outW.w) / 2) <= 1e-6 && Math.abs(outW.y - (ih - outW.h) / 2) <= 1e-6,
			'a contained whole base is centred');
		ok(Math.abs(npx(wags[1].kids[0].style.width) - outW.w) <= 1e-6, 'missing-entry base sized from the region fit');
		ok(Math.abs(npx(wags[3].kids[0].style.width) - outW.w) <= 1e-6, 'an entry without hd frames the whole base');
		ok(wags[3].kids[1].style.display === 'none', 'no crop is painted when the entry declares none');
		A.zoomAt(0, cw * 0.25, ih * 0.3, 2);
		A.frame(0, ih, cw);
		const v2 = A.view(0);
		eqv(v2.zoom, 2, 'zoomAt applied multiplicatively');
		const out2 = HD.finalLayout(cw, ih, 800, 600, { x: 100, y: 50, w: 400, h: 300, maxZoom: 0 },
			{ zoom: v2.zoom, panX: v2.panX, panY: v2.panY }, {});
		ok(Math.abs(out2.s - out.s * 2) <= 1e-9, 'zoom doubles the fit scale');
		ok(out2.x <= 1e-6 && out2.x + out2.w >= cw - 1e-6, 'zoomed base still covers');
		const th2 = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(h0.style.transform);
		ok(th2 && Math.abs(+th2[1] - out2.hx) <= 1e-6 && Math.abs(+th2[2] - out2.hy) <= 1e-6, 'the crop follows the base it crops');
		A.zoomAt(0, 0, 0, 1e9);
		eqv(A.view(0).zoom, 4, 'zoom clamps to default maxZoom 4');
		A.reset(0);
		eqv(A.view(0).zoom, 1, 'reset returns to 1');
		eqv(A.view(0).panX, 0, 'reset drops the pan back to the rest framing');
		/* paint once at rest so the geometry across the disable cycle below is
		   IDENTICAL: the cycle must repaint from invalidated gates, and a
		   cached value that happens to differ would hide a warm-cache bug */
		A.frame(0, ih, cw);
		const paint0 = b0.style.width + '/' + b0.style.height + '/' + b0.style.transform;
		A.off();
		ok(!b0.style.width && !b0.style.transform && !h0.style.transform, 'off clears managed children');
		ok(!wags[0].classList.contains('snow-hd-live'), 'off drops snow-hd-live');
		ok(rootCls.indexOf('snow-ready') < 0, 'off drops snow-ready');
		/* the re-enable path: only a frame follows, so the write gates off()
		   invalidated must repaint the children from nothing, not stay quiet */
		A.frame(0, ih, cw);
		ok(rootCls.indexOf('snow-ready') >= 0, 'frame re-asserts snow-ready after the engine comes back');
		ok(b0.style.width && b0.style.transform && h0.style.transform, 'children repaint after a disable cycle');
		ok(paint0 === b0.style.width + '/' + b0.style.height + '/' + b0.style.transform,
			'the re-enable paints exactly what was there before');
	} finally {
		console.warn = origWarn;
		delete global.window;
		delete global.document;
	}
}

/* ---------------- static source scans ---------------- */
{
	const root = path.join(__dirname, '..');
	const adapter = fs.readFileSync(path.join(root, 'snowfall-region.js'), 'utf8');
	const math = fs.readFileSync(path.join(root, 'hdregion.js'), 'utf8');
	const engine = fs.readFileSync(path.join(root, 'snowfall.js'), 'utf8');
	/* brace-match the adapter's frame() body so the scan is scoped to it */
	const m = adapter.indexOf('function frame(sY, vh, vw)');
	ok(m >= 0, 'adapter has frame(sY, vh, vw)');
	const bodyEnd = (() => {
		let depth = 0, i = adapter.indexOf('{', m);
		for (; i < adapter.length; i++) {
			if (adapter[i] === '{') depth++;
			else if (adapter[i] === '}') { depth--; if (!depth) return i; }
		}
		return -1;
	})();
	const body = adapter.slice(m, bodyEnd);
	ok(!/getBoundingClientRect|getComputedStyle|offsetWidth|scrollHeight/.test(body), 'frame() reads no layout');
	ok(!/addEventListener/.test(body), 'frame() installs no listener');
	ok(!/=>|\bnew \b|= \{|\[ *\]|\.map\(|forEach|Array\.from/.test(body), 'frame() allocates no literals/closures');
	ok(/naturalWidth/.test(body) && /HD\.finalLayout/.test(body), 'frame() reads only base naturalWidth and defers to HDRegion');
	ok(!/addEventListener\('scroll'/.test(adapter), 'adapter never binds scroll');
	ok(!/innerWidth/.test(adapter), 'adapter sizes from frame args, never innerWidth');
	ok(/Snowfall\.use|S\.use\(/.test(adapter), 'adapter subscribes via Snowfall.use');
	ok(/HDRegion\.finalLayout|HD\.finalLayout/.test(adapter) && !/max\(vw/.test(adapter), 'adapter defers fit math to HDRegion');
	const mathCode = math.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
	ok(!/document\.|window\.|getComputedStyle|fetch/.test(mathCode.replace(/typeof window/g, '')),
		'hdregion is DOM-free');
	ok(/const cap = W\.pBot\[i\] - sY - e - W\.mb\[i\];/.test(engine), 'engine has the parent-bottom clamp');
	ok(/pos\[i\] > cap \? cap : W\.pos\[i\]/.test(engine), 'clamp lowers pos, never raises');
	ok(/de\.clientWidth \|\| window\.innerWidth/.test(engine), 'viewport width is clientWidth-first');
}

console.log('region: ' + (checks - fails) + '/' + checks + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
