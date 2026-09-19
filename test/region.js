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
function rng32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0; a = a + 0x6D2B79F5 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}

/* ---------------- finalLayout fuzz: I1 / I2 / idempotence ---------------- */
{
	const rnd = rng32(0xC0FFEE);
	const N = 200000;
	const T = 1e-9;
	let clx = 0, cly = 0, skipped = 0;
	for (let t = 0; t < N; t++) {
		const vw = 320 + rnd() * 2280;
		const vh = 560 + rnd() * 1140;
		const bw = 1 + rnd() * 4000;
		const bh = 1 + rnd() * 4000;
		const rw = 1 + rnd() * bw, rh = 1 + rnd() * bh;
		const rx = rnd() * (bw - rw), ry = rnd() * (bh - rh);
		const region = { x: rx, y: ry, w: rw, h: rh };
		if (t % 4 === 0) region.maxZoom = 1 + rnd() * 5;
		const view = { zoom: 0.2 + rnd() * 8, vx: (rnd() - 0.5) * 2e6, vy: (rnd() - 0.5) * 2e6 };
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
		/* I2: covers every axis the box is big enough for; centers the rest */
		if (out.w >= vw - T) ok(out.x <= T && out.x + out.w >= vw - T, 't' + t + ' I2 x');
		else ok(Math.abs(out.x - (vw - out.w) / 2) <= T, 't' + t + ' I2 x centered');
		if (out.h >= vh - T) ok(out.y <= T && out.y + out.h >= vh - T, 't' + t + ' I2 y');
		else ok(Math.abs(out.y - (vh - out.h) / 2) <= T, 't' + t + ' I2 y centered');
		/* I1: the region is fully visible whenever it fits the window. The fit
		   test uses the SAME float comparison as clampAxis (no tolerance): at
		   the exact-fit boundary "fits" is ULP-ambiguous and the layout is only
		   required to match its own predicate. */
		if (out.hw <= vw) ok(out.hx >= -T && out.hx + out.hw <= vw + T, 't' + t + ' I1 x');
		if (out.hh <= vh) ok(out.hy >= -T && out.hy + out.hh <= vh + T, 't' + t + ' I1 y');
		/* the HD box is the region box on the base box */
		ok(out.hx >= out.x - T && out.hx + out.hw <= out.x + out.w + T, 't' + t + ' hd inside base x');
		ok(out.hy >= out.y - T && out.hy + out.hh <= out.y + out.h + T, 't' + t + ' hd inside base y');
		/* clamped `view` is persisted, and a re-run is a no-op (one authority) */
		const v2 = { zoom: view.zoom, vx: view.vx, vy: view.vy };
		const o2 = {};
		HD.finalLayout(vw, vh, bw, bh, region, v2, o2);
		ok(Math.abs(o2.x - out.x) <= T && Math.abs(o2.y - out.y) <= T && Math.abs(o2.s - out.s) <= 1e-12,
			't' + t + ' idempotent');
		clx += out.clx; cly += out.cly;
	}
	console.log('fuzz: ' + N + ' layouts, clamped-x ' + clx + ', clamped-y ' + cly +
		', degenerate-skip ' + skipped);
	/* the edge clamp must actually engage (huge random pans guarantee it) */
	ok(clx > N / 100, 'edge clamp engages');
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
		const view = { zoom: 1 + rnd() * 2, vx: (rnd() - 0.5) * 4000, vy: (rnd() - 0.5) * 4000 };
		const px = rnd() * vw, py = rnd() * vh;
		const pre = {};
		HD.finalLayout(vw, vh, bw, bh, region, view, pre); /* canonicalize raw state */
		const v0 = { zoom: view.zoom, vx: view.vx, vy: view.vy };
		const s0 = pre.s;
		const cx = (px - v0.vx) / s0, cy = (py - v0.vy) / s0; /* content point under cursor */
		const k = 1.2 + rnd() * 2.6;
		HD.zoomAround(view, px, py, k, region);
		const post = {};
		HD.finalLayout(vw, vh, bw, bh, region, view, post); /* clamps */
		ok(Math.abs(view.zoom - Math.min(4, v0.zoom * k)) < 1e-9, 't' + t + ' zoom = clamped product');
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
	const wags = [
		fakeWagon([fakeImg('img/a.png', 800, 600), fakeImg('img/a_c.png', 800, 600)]),
		fakeWagon([fakeImg('img/b.png', 800, 600)]),
		fakeWagon([fakeImg('img/f.png', 800, 600), fakeImg('img/f_c.png', 1, 1)], 'fixed')
	];
	const doc = {
		readyState: 'complete',
		documentElement: Object.assign(fakeEl(), { clientWidth: cw }),
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
			'img/f.png': { x: 10, y: 10, w: 100, h: 100, hd: 'img/f_c.png' }
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
		eqv(A.count(), 2, 'adapter manages 2 of 3 (fixed excluded)');
		eqv(warns.length, 1, 'exclusion warned exactly once');
		ok(wags[0].classList.contains('snow-hd-live'), 'managed wagon gets snow-hd-live');
		ok(!wags[2].classList.contains('snow-hd-live'), 'excluded wagon stays unmanaged');
		ok(!wags[2].kids[0].style.width, 'excluded wagon children untouched');
		A.frame(0, ih, cw);
		const v = A.view(0);
		const out = HD.finalLayout(cw, ih, 800, 600, { x: 100, y: 50, w: 400, h: 300, maxZoom: 0 },
			{ zoom: v.zoom, vx: v.vx, vy: v.vy }, {});
		const npx = s => parseFloat(s) || 0;
		const b0 = wags[0].kids[0], h0 = wags[0].kids[1];
		ok(Math.abs(npx(b0.style.width) - out.w) <= 1e-6 && Math.abs(npx(b0.style.height) - out.h) <= 1e-6, 'base sized from HDRegion box');
		const t = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(b0.style.transform);
		ok(t && Math.abs(+t[1] - out.x) <= 1e-6 && Math.abs(+t[2] - out.y) <= 1e-6, 'base translated from HDRegion box');
		ok(h0.style.display !== 'none', 'HD unhidden (loaded at measure seed)');
		ok(Math.abs(npx(h0.style.width) - out.hw) <= 1e-6 && Math.abs(npx(h0.style.height) - out.hh) <= 1e-6, 'HD sized to region box');
		const th = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(h0.style.transform);
		ok(th && Math.abs(+th[1] - out.hx) <= 1e-6 && Math.abs(+th[2] - out.hy) <= 1e-6, 'HD translated to region position');
		/* I2 live shape: the base covers the fake viewport (800×600 vs 1425×900) */
		ok(out.x <= 1e-6 && out.x + out.w >= cw - 1e-6, 'I2 x at fake viewport');
		ok(out.y <= 1e-6 && out.y + out.h >= ih - 1e-6, 'I2 y at fake viewport');
		/* I1: the region is fully visible at zoom 1 */
		ok(out.hx >= -1e-6 && out.hx + out.hw <= cw + 1e-6, 'I1 x at fake viewport');
		/* missing entry: whole base is the region, sized anyway, nothing hidden */
		ok(!!wags[1].kids[0].style.width, 'missing-entry base still sized');
		A.zoomAt(0, cw * 0.25, ih * 0.3, 2);
		A.frame(0, ih, cw);
		const v2 = A.view(0);
		eqv(v2.zoom, 2, 'zoomAt applied multiplicatively');
		ok(v2.vx <= 0 && v2.vx + 800 * out.s * 2 >= cw, 'zoomed pan keeps base covering');
		A.zoomAt(0, 0, 0, 1e9);
		const v3 = A.view(0);
		eqv(v3.zoom, 4, 'zoom clamps to default maxZoom 4');
		A.reset(0);
		eqv(A.view(0).zoom, 1, 'reset returns to 1');
		A.off();
		ok(!b0.style.width && !b0.style.transform && !h0.style.transform, 'off clears managed children');
		ok(!wags[0].classList.contains('snow-hd-live'), 'off drops snow-hd-live');
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
	ok(!/document\.|window\.|getComputedStyle|fetch/.test(math.replace(/typeof window/g, '')), 'hdregion is DOM-free');
	ok(/const cap = W\.pBot\[i\] - sY - e - W\.mb\[i\];/.test(engine), 'engine has the parent-bottom clamp');
	ok(/pos\[i\] > cap \? cap : W\.pos\[i\]/.test(engine), 'clamp lowers pos, never raises');
	ok(/de\.clientWidth \|\| window\.innerWidth/.test(engine), 'viewport width is clientWidth-first');
}

console.log('region: ' + (checks - fails) + '/' + checks + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
