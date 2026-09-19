/* test/region.js — region gate (0.5.5):
   R1  hdregion.js fuzz proof: I1 region visible at zoom 1, I2 base covers the
       viewport whenever geometrically possible, I3 zoomAround preserves the
       pivot pre-clamp (200k random layouts, ported from the asset repo's
       experiments/layout_test.js — the gate that moved upstream with the math).
   R2  the four fixed viewport shapes from the plan (portrait 360×780, tablet
       768×1024, desktop 1440×900, ultrawide 2560×1080).
   R3  engine viewport contract, headless: snowfall.js booted in a VM DOM shim —
       viewport.width === clientWidth (not innerWidth), frame()/step() agree,
       the page-span wagon box is written from the cache, and a scroll event
       re-measures (mobile URL bar).
   R4  adapter static contract on snowfall-region.js: no scroll listener, no
       wagon-element style writes, no object/array literals in frame(), no
       decodeURIComponent in the REGIONS key, snow-ready scoping present.
   node test/region.js  (or via test/run.js) — exit 0 = green. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('../hdregion.js');

const ROOT = path.join(__dirname, '..');
let fails = 0, checks = 0;
function ok(cond, msg) {
	checks++;
	if (!cond) { fails++; console.log('FAIL: ' + msg); }
}
function near(a, b, eps, msg) { ok(Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps), msg + ' (got ' + a + ', want ' + b + ')'); }

/* ---------------- geometry predicates (test-side, mirror the fuzz proof) ---- */
function regionVisible(vw, vh, r, L) {
	const e = 1e-6;
	const x0 = L.x + r.x * L.s, y0 = L.y + r.y * L.s;
	return x0 >= -e && y0 >= -e && x0 + r.w * L.s <= vw + e && y0 + r.h * L.s <= vh + e;
}
/* does ANY placement exist that covers the viewport and keeps the region visible? */
function coverPossible(vw, vh, r, L) {
	if (L.w < vw - 1e-9 || L.h < vh - 1e-9) return false;
	const loX = Math.max(vw - (r.x + r.w) * L.s, vw - L.w);
	const hiX = Math.min(-r.x * L.s, 0);
	const loY = Math.max(vh - (r.y + r.h) * L.s, vh - L.h);
	const hiY = Math.min(-r.y * L.s, 0);
	return loX <= hiX + 1e-9 && loY <= hiY + 1e-9;
}
function covers(L, vw, vh) {
	const e = 1e-6;
	return L.x <= e && L.y <= e && L.x + L.w >= vw - e && L.y + L.h >= vh - e;
}

/* ---------------- R1: 200k fuzz ---------------- */
{
	let seed = 424242;
	const rnd = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
	const N = 200000;
	let f1 = 0, f2 = 0, f3 = 0, clampShifts = 0;
	const L = {};
	const view = { x: 0, y: 0, zoom: 1, maxZoom: 4 };
	for (let i = 0; i < N; i++) {
		const bw = 100 + rnd() * 4000, bh = 100 + rnd() * 4000;
		const rx = rnd() * (bw - 10), ry = rnd() * (bh - 10);
		const r = { x: rx, y: ry, w: 10 + rnd() * (bw - rx - 10), h: 10 + rnd() * (bh - ry - 10) };
		const vw = 100 + rnd() * 4000, vh = 100 + rnd() * 4000;
		view.x = 0; view.y = 0; view.zoom = 1;
		H.finalLayout(vw, vh, bw, bh, r, view, L);
		if (!regionVisible(vw, vh, r, L)) f1++;
		if (coverPossible(vw, vh, r, L) && !covers(L, vw, vh)) f2++;
		const sx = rnd() * vw, sy = rnd() * vh;
		H.zoomAround(vw, vh, bw, bh, r, view, sx, sy, 1 + rnd() * 3, L);
		if (Math.abs(L.px - sx) > 1e-6 || Math.abs(L.py - sy) > 1e-6) f3++;
		const qx = L.x + L.ix * L.s, qy = L.y + L.iy * L.s;
		if (Math.abs(qx - sx) > 0.5 || Math.abs(qy - sy) > 0.5) clampShifts++;
	}
	ok(f1 === 0, 'R1/I1 region always visible at zoom 1 (' + f1 + ' fails of ' + N + ')');
	ok(f2 === 0, 'R1/I2 base covers the viewport whenever possible (' + f2 + ' fails)');
	ok(f3 === 0, 'R1/I3 zoom pivot preserved pre-clamp (' + f3 + ' fails)');
	ok(clampShifts > 0, 'R1 edge clamp really shifts the visible pivot sometimes (' + clampShifts + '/' + N + ') — by design, counted not failed');
}

/* ---------------- R2: the four plan viewport shapes ---------------- */
{
	const entry = { x: 476, y: 101, w: 1016, h: 900 };
	const bw = 1984, bh = 1152;
	const shapes = [
		['portrait 360x780', 360, 780],
		['tablet 768x1024', 768, 1024],
		['desktop 1440x900', 1440, 900],
		['ultrawide 2560x1080', 2560, 1080]
	];
	const L = {};
	const view = { x: 0, y: 0, zoom: 1, maxZoom: 4 };
	for (const s of shapes) {
		H.finalLayout(s[1], s[2], bw, bh, entry, view, L);
		ok(regionVisible(s[1], s[2], entry, L), 'R2 region visible at zoom 1 — ' + s[0]);
		ok(!coverPossible(s[1], s[2], entry, L) || covers(L, s[1], s[2]), 'R2 base covers when possible — ' + s[0]);
		/* corner-cursor zoom 2: pivot preserved pre-clamp, HD grows, cover kept */
		const s1 = L.s;
		H.zoomAround(s[1], s[2], bw, bh, entry, view, 40, 40, 2, L);
		ok(Math.abs(L.px - 40) < 1e-6 && Math.abs(L.py - 40) < 1e-6, 'R2 pivot preserved at zoom 2 corner — ' + s[0]);
		ok(L.s > s1 * 1.5, 'R2 scale grew at zoom 2 (s ' + s1.toFixed(4) + ' → ' + L.s.toFixed(4) + ') — ' + s[0]);
		ok(!coverPossible(s[1], s[2], entry, L) || covers(L, s[1], s[2]), 'R2 base still covers at zoom 2 — ' + s[0]);
		view.zoom = 1; view.x = 0; view.y = 0;
	}
	/* whole-base fallback (no entry): the region IS the base, still visible */
	const whole = { x: 0, y: 0, w: 800, h: 600 };
	H.finalLayout(1280, 720, 800, 600, whole, view, L);
	ok(regionVisible(1280, 720, whole, L), 'R2 whole-base fallback keeps the region visible');
}

/* ---------------- R3: engine viewport contract in a VM DOM shim ---------------- */
function mkEl(tag) {
	const el = {
		tagName: (tag || 'div').toUpperCase(),
		id: '',
		style: { setProperty: function () {}, removeProperty: function () {}, cssText: '' },
		attributes: {}, children: [], parentNode: null,
		_rect: null, _offsetH: 0, _classList: [], _dataset: {},
		setAttribute: function (k, v) { this.attributes[k] = String(v); if (k === 'id') this.id = String(v); },
		getAttribute: function (k) { return this.attributes[k] !== undefined ? this.attributes[k] : null; },
		hasAttribute: function (k) { return k in this.attributes; },
		removeAttribute: function (k) { delete this.attributes[k]; },
		appendChild: function (c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); },
		insertBefore: function (c, ref) {
			if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this;
			const i = this.children.indexOf(ref);
			if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
		},
		removeChild: function (c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; },
		querySelectorAll: function () { return []; },
		getElementsByTagName: function () { return []; },
		addEventListener: function () {}, removeEventListener: function () {},
		getBoundingClientRect: function () { return this._rect || { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; }
	};
	Object.defineProperty(el, 'parentElement', { configurable: true, get: function () { return el.parentNode; } });
	return el;
}
function makeShim() {
	/* document-space layout the rects mirror at any scrollY:
	   one page-span wagon (ext 900, gap 0 ⇒ mb −900) anchored at y 720 inside
	   a parent whose content bottom is 4860. Deep past 4860 the unclamped chain
	   would translate the wagon back onto the screen (dy grows without bound);
	   the clamp must make dy === 0 while the parked latch stays pre-clamp. */
	const state = { scrollY: 0, anchorY: 720, pBot: 4860 };
	const html = mkEl('html');
	html.clientWidth = 1425;                      /* innerWidth 1440 — one classic scrollbar of difference */
	html.style.setProperty = function (k, v) { html.style['_' + k] = v; };
	html.style.removeProperty = function (k) { delete html.style['_' + k]; };
	html.classList = { add: function () {}, remove: function () {}, toggle: function () {} };
	const head = mkEl('head'); html.appendChild(head);
	const body = mkEl('body'); html.appendChild(body);
	const app = mkEl('div'); app.id = 'app';
	app.getBoundingClientRect = function () {
		return { top: -state.scrollY, bottom: state.pBot - state.scrollY, left: 0, right: 1425,
			width: 1425, height: state.pBot };
	};
	body.appendChild(app);
	const wagon = mkEl('div');
	wagon._classList = ['snow-bg']; wagon._dataset = { mode: 'cover', gap: '0' };
	wagon._offsetH = 900;
	Object.defineProperty(wagon, 'classList', { get: function () { return { add: function () {}, remove: function () {}, contains: function (c) { return wagon._classList.indexOf(c) >= 0; } }; } });
	Object.defineProperty(wagon, 'dataset', { get: function () { return wagon._dataset; } });
	Object.defineProperty(wagon, 'offsetHeight', { get: function () { return wagon._offsetH; } });
	/* the engine collects from the SCOPE (app), not the document */
	app.querySelectorAll = function (sel) { return sel === '.snow-bg' ? [wagon] : []; };
	app.appendChild(wagon);
	const listeners = {};
	const win = {
		innerHeight: 900, innerWidth: 1440, scrollY: 0,
		addEventListener: function (t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
		removeEventListener: function () {},
		getComputedStyle: function () {
			return { paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px',
				paddingLeft: '0px', borderLeftWidth: '0px', fontSize: '16px' };
		}
	};
	const doc = {
		head: head, body: body, documentElement: html,
		getElementById: function (id) { return id === 'app' ? app : null; },
		querySelectorAll: function (sel) {
			if (sel === '.snow-bg') return [wagon];
			return [];
		},
		createElement: function (t) {
			const e = mkEl(t);
			/* zero-size anchor markers report their document Y minus the scroll */
			if (t === 'i') e.getBoundingClientRect = function () {
				const top = state.anchorY - state.scrollY;
				return { top: top, bottom: top, left: 0, right: 1425, width: 1425, height: 0 };
			};
			return e;
		},
		fonts: { ready: { then: function () {} } },
		readyState: 'complete'
	};
	function setScroll(y) { state.scrollY = y; win.scrollY = y; }
	return { window: win, document: doc, listeners: listeners, wagon: wagon, html: html, setScroll: setScroll };
}
{
	const shim = makeShim();
	const sandbox = {
		window: shim.window, document: shim.document,
		getComputedStyle: shim.window.getComputedStyle,
		setTimeout: setTimeout, clearTimeout: clearTimeout, console: console
	};
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(fs.readFileSync(path.join(ROOT, 'snowfall.js'), 'utf8'), sandbox);

	const SF = sandbox.window.Snowfall;
	ok(SF && SF.version === '0.5.5', 'R3 engine boots headless, version 0.5.5 (got ' + (SF && SF.version) + ')');
	ok(SF.viewport && SF.viewport.width === 1425 && SF.viewport.height === 900,
		'R3 Snowfall.viewport is clientWidth×innerHeight (1425×900), never innerWidth (1440)');
	ok(shim.wagon.style.width === '1425px', 'R3 page-span wagon box width === viewport.width (' + shim.wagon.style.width + ')');
	ok(shim.wagon.style.height === 'var(--snow-vh,100vh)', 'R3 wagon height from --snow-vh');
	ok(shim.html.style['_--snow-vw'] === '1425px' && shim.html.style['_--snow-vh'] === '900px', 'R3 CSS vars written from the cache');

	const got = { sY: -1, vh: 0, vw: 0 };
	SF.use({ measure: function () {}, frame: function (sY, vh, vw) { got.sY = sY; got.vh = vh; got.vw = vw; }, off: function () {} });
	SF.refresh();
	ok(got.vw === 1425 && got.vh === 900, 'R3 subscriber frame() receives the cached viewport (vw=' + got.vw + ', vh=' + got.vh + ')');
	SF.step(50);
	ok(got.sY === 50 && got.vw === 1425 && got.vh === 900, 'R3 step(sY) reuses the cache — gesture frames match scroll frames');

	/* mobile URL bar: scroll fires without resize; the handler must re-measure */
	shim.window.innerHeight = 800;
	const scrollHandlers = shim.listeners['scroll'] || [];
	ok(scrollHandlers.length === 1, 'R3 exactly one engine scroll listener');
	if (scrollHandlers.length) scrollHandlers[0]();
	ok(SF.viewport.height === 800 && got.vh === 800, 'R3 scroll event re-measures the viewport (URL-bar case): vh=' + got.vh);
	ok(shim.html.style['_--snow-vh'] === '800px', 'R3 --snow-vh follows the URL bar');

	/* deep past the parent content bottom (4860): without the clamp the chain
	   leaves pos parked while stickyShown's cap heads to −∞, and the wagon is
	   translated back ONTO the screen (dy = 10000−4860 = 5140 at sY 10000).
	   With the clamp dy === 0 and the exposed pos tracks the cap, while the
	   parked latch (debug.parked, what the events subscriber reads) stays on
	   the pre-clamp chain rest state — screen-flow chapters keep firing parked. */
	shim.window.innerHeight = 900;
	shim.setScroll(10000);
	SF.refresh();
	ok(shim.wagon.style.transform === 'translate3d(0px,0px,0)',
		'R3 pos clamp: dy === 0 deep past the parent (got ' + shim.wagon.style.transform + ', unclamped would be translate3d(0px,5140px,0))');
	near(SF.wagons.pos[0], 4860 - 10000, 1e-9, 'R3 exposed pos tracks the parent cap past the bottom');
	ok(SF.debug.parked === 1, 'R3 parked latch reads the pre-clamp chain state (debug.parked ' + SF.debug.parked + ', want 1)');
	shim.setScroll(0);
	SF.refresh();
	ok(SF.debug.parked === 0, 'R3 parked latch clears while the wagon still rides below the top');
}

/* ---------------- R5: engine + math + adapter booted together in a VM ----------------
   A one-wagon book page: .snow-hd wagon (1984×1152 base, region 476,101,1016,900,
   HD crop cached-decoded later via its load event), parked at scrollY 1700.
   Drives the real files: adapter writes must equal HDRegion output exactly,
   gestures must go through SnowfallRegion, off()/on must restore the page. */
function makeBookShim() {
	const state = { scrollY: 0, wagonY: 1600, pBot: 6000, classes: [] };
	function mkImg(w, h, complete) {
		const img = {
			tagName: 'IMG', complete: !!complete, naturalWidth: complete ? w : 0, naturalHeight: complete ? h : 0,
			style: {}, attrs: {}, listeners: {},
			getAttribute: function (k) { return img.attrs[k] !== undefined ? img.attrs[k] : null; },
			setAttribute: function (k, v) { img.attrs[k] = String(v); },
			addEventListener: function (t, fn) { (img.listeners[t] = img.listeners[t] || []).push(fn); },
			removeEventListener: function () {},
			fireLoad: function (w2, h2) {
				img.complete = true; img.naturalWidth = w2; img.naturalHeight = h2;
				(img.listeners['load'] || []).forEach(function (fn) { fn.call(img); });
			}
		};
		return img;
	}
	const baseImg = mkImg(1984, 1152, true); baseImg.attrs.src = 'img/3.avif';
	const hdImg = mkImg(1016, 900, false); hdImg.attrs.src = 'img/3_c.avif';   /* decodes later */
	const wagon = mkEl('div');
	wagon._dataset = { mode: 'cover', gap: '60vh' };
	wagon._offsetH = 900;
	wagon.getElementsByTagName = function (t) { return t === 'img' ? [baseImg, hdImg] : []; };
	Object.defineProperty(wagon, 'dataset', { get: function () { return wagon._dataset; } });
	Object.defineProperty(wagon, 'offsetHeight', { get: function () { return wagon._offsetH; } });

	const html = mkEl('html');
	html.clientWidth = 1425;
	html.style.setProperty = function (k, v) { html.style['_' + k] = v; };
	html.style.removeProperty = function (k) { delete html.style['_' + k]; };
	html.classList = {
		add: function (c) { if (state.classes.indexOf(c) < 0) state.classes.push(c); },
		remove: function (c) { const i = state.classes.indexOf(c); if (i >= 0) state.classes.splice(i, 1); },
		toggle: function (c, on) { if (on) html.classList.add(c); else html.classList.remove(c); },
		contains: function (c) { return state.classes.indexOf(c) >= 0; }
	};
	const head = mkEl('head'); html.appendChild(head);
	const body = mkEl('body'); html.appendChild(body);
	const app = mkEl('div'); app.id = 'app';
	app.getBoundingClientRect = function () {
		return { top: -state.scrollY, bottom: state.pBot - state.scrollY, left: 0, right: 1425,
			width: 1425, height: state.pBot };
	};
	app.querySelectorAll = function (sel) {
		if (sel === '.snow-bg' || sel === '.snow-hd') return [wagon];
		return [];
	};
	body.appendChild(app);
	app.appendChild(wagon);

	const winListeners = {};
	const win = {
		innerHeight: 900, innerWidth: 1440, scrollY: 0, REGIONS: {
			'img/3.avif': { x: 476, y: 101, w: 1016, h: 900, hd: 'img/3_c.avif', bw: 1984, bh: 1152 }
		},
		addEventListener: function (t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
		removeEventListener: function () {},
		getComputedStyle: function () {
			return { paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px',
				paddingLeft: '0px', borderLeftWidth: '0px', fontSize: '16px' };
		}
	};
	const warns = [], errors = [];
	const con = { log: function () {}, info: function () {},
		warn: function (m) { warns.push(String(m)); },
		error: function (m) { errors.push(String(m)); } };
	const doc = {
		head: head, body: body, documentElement: html,
		getElementById: function (id) { return id === 'app' ? app : null; },
		querySelectorAll: function () { return []; },
		createElement: function (t) {
			const e = mkEl(t);
			if (t === 'i') e.getBoundingClientRect = function () {
				const top = state.wagonY - state.scrollY;
				return { top: top, bottom: top, left: 0, right: 1425, width: 1425, height: 0 };
			};
			if (t === 'label') {
				const input = { tagName: 'INPUT', checked: false, style: {}, addEventListener: function () {} };
				e.querySelector = function (sel) { return sel === 'input' ? input : null; };
				e.contains = function () { return false; };
			}
			return e;
		},
		fonts: { ready: { then: function () {} } },
		readyState: 'complete'
	};
	function setScroll(y) { state.scrollY = y; win.scrollY = y; }
	return { window: win, document: doc, console: con, listeners: winListeners, warns: warns, errors: errors,
		wagon: wagon, baseImg: baseImg, hdImg: hdImg, html: html, setScroll: setScroll, state: state };
}
{
	const shim = makeBookShim();
	const sandbox = {
		window: shim.window, document: shim.document, console: shim.console,
		getComputedStyle: shim.window.getComputedStyle,
		setTimeout: setTimeout, clearTimeout: clearTimeout
	};
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	/* load order of a story page: regions → math → engine → adapter */
	vm.runInContext(fs.readFileSync(path.join(ROOT, 'hdregion.js'), 'utf8'), sandbox);
	vm.runInContext(fs.readFileSync(path.join(ROOT, 'snowfall.js'), 'utf8'), sandbox);
	sandbox.Snowfall = sandbox.window.Snowfall;
	sandbox.HDRegion = sandbox.window.HDRegion;
	vm.runInContext(fs.readFileSync(path.join(ROOT, 'snowfall-region.js'), 'utf8'), sandbox);
	const SF = sandbox.window.Snowfall, R = sandbox.window.SnowfallRegion, HD = sandbox.window.HDRegion;
	const px = function (s) { return parseFloat(s); };

	ok(!!R && R.version === '0.5.5', 'R5 adapter booted and exposed SnowfallRegion');
	ok(SF.default.subs.length === 4, 'R5 adapter registered as the 4th subscriber, after the built-ins');
	ok(R.count() === 1 && R.wagonIndex(0) === 0, 'R5 wagon managed and mapped into Snowfall.wagons');
	ok(shim.html.classList.contains('snow-ready'), 'R5 snow-ready added at load');

	/* park the wagon and check the writes against HDRegion itself */
	shim.setScroll(1700);
	SF.refresh();
	const rc = { x:0, y:0, w:0, h:0, has:0, hd:0, maxZoom:4, baseW:0, baseH:0, zoom:1, panX:0, panY:0 };
	R.rect(0, rc);
	ok(rc.has === 1 && rc.x === 476 && rc.w === 1016, 'R5 REGIONS entry resolved by src key (late-bound at measure)');
	const L = {};
	HD.finalLayout(1425, 900, 1984, 1152, rc, { zoom: 1, x: 0, y: 0, maxZoom: 4 }, L);
	ok(px(shim.baseImg.style.width) === L.w && px(shim.baseImg.style.height) === L.h,
		'R5 base sized to finalLayout output (' + shim.baseImg.style.width + '×' + shim.baseImg.style.height + ')');
	const bt = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(shim.baseImg.style.transform);
	ok(bt && +bt[1] === L.x && +bt[2] === L.y, 'R5 base translated to finalLayout output (' + shim.baseImg.style.transform + ')');
	ok(shim.wagon.style.transform === 'translate3d(0px,0px,0)', 'R5 wagon itself parked with the engine transform only');

	/* HD decodes late: hidden until its load event, then shown and sized */
	ok(shim.hdImg.style.display === 'none', 'R5 HD hidden while undecoded');
	shim.hdImg.fireLoad(1016, 900);
	ok(shim.hdImg.style.display === 'block', 'R5 HD shown by its load event');
	ok(px(shim.hdImg.style.width) === rc.w * L.s && px(shim.hdImg.style.height) === rc.h * L.s,
		'R5 HD sized region.w×region.h at the base scale');
	const ht = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(shim.hdImg.style.transform);
	ok(ht && Math.abs(+ht[1] - (L.x + rc.x * L.s)) < 1e-9 && Math.abs(+ht[2] - (L.y + rc.y * L.s)) < 1e-9,
		'R5 HD pinned to its rect inside the base (' + shim.hdImg.style.transform + ')');

	/* shift+wheel zooms around the cursor 2× (deltaY = −1000·ln2) and preventDefault's */
	let prevented = 0;
	const wheelHandlers = shim.listeners['wheel'] || [];
	ok(wheelHandlers.length === 1, 'R5 exactly one adapter wheel listener');
	wheelHandlers[0]({ shiftKey: true, deltaY: -693.1471805599453, clientX: 712, clientY: 450, preventDefault: function () { prevented++; } });
	ok(prevented === 1, 'R5 shift+wheel preventDefault (kills the browser h-scroll mapping)');
	R.rect(0, rc);
	ok(Math.abs(rc.zoom - 2) < 1e-6, 'R5 wheel zoom took: zoom=' + rc.zoom);
	const L2 = {};
	HD.finalLayout(1425, 900, 1984, 1152, rc, { zoom: rc.zoom, x: rc.panX, y: rc.panY, maxZoom: rc.maxZoom }, L2);
	ok(px(shim.hdImg.style.width) === rc.w * L2.s, 'R5 HD grew with the zoom (' + shim.hdImg.style.width + ')');
	const ix = (712 - L.x) / L.s, iy = (450 - L.y) / L.s;
	ok(Math.abs(L2.x + ix * L2.s - 712) < 1 && Math.abs(L2.y + iy * L2.s - 450) < 1, 'R5 cursor pivot held through the zoom');

	/* inspect mode: key i with an editable target must NOT toggle; clean target must */
	const keyHandlers = shim.listeners['keydown'] || [];
	ok(keyHandlers.length === 1, 'R5 one adapter keydown listener');
	keyHandlers[0]({ key: 'i', target: { tagName: 'TEXTAREA' } });
	ok(R.inspecting() === false, 'R5 key i ignored while typing in an editor field');
	keyHandlers[0]({ key: 'i', target: { tagName: 'DIV' } });
	ok(R.inspecting() === true, 'R5 key i toggles inspect mode');

	/* drag pan in inspect mode moves the view 1:1 and steps the engine */
	const down = (shim.listeners['pointerdown'] || [])[0], move = (shim.listeners['pointermove'] || [])[0], up = (shim.listeners['pointerup'] || [])[0];
	ok(!!down && !!move && !!up, 'R5 pointer listeners registered');
	const panX0 = rc.panX, panY0 = rc.panY;
	const ev = function (id, x, y) { return { pointerId: id, clientX: x, clientY: y, target: {}, preventDefault: function () {} }; };
	down(ev(1, 400, 400));
	move(ev(1, 430, 412));
	up(ev(1, 430, 412));
	R.rect(0, rc);
	ok(rc.panX === panX0 + 30 && rc.panY === panY0 + 12 && rc.zoom === 2, 'R5 drag pans the view 1:1, zoom preserved');
	const L3 = {};
	HD.finalLayout(1425, 900, 1984, 1152, rc, { zoom: rc.zoom, x: rc.panX, y: rc.panY, maxZoom: rc.maxZoom }, L3);
	const bt3 = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(shim.baseImg.style.transform);
	ok(bt3 && +bt3[1] === L3.x && +bt3[2] === L3.y, 'R5 pan re-rendered through finalLayout (' + shim.baseImg.style.transform + ')');

	/* touchmove is preventDefault'd in inspect mode only */
	let tmPrevented = 0;
	const tm = (shim.listeners['touchmove'] || [])[0];
	tm({ preventDefault: function () { tmPrevented++; } });
	ok(tmPrevented === 1, 'R5 touchmove owned via preventDefault while inspecting (never via overflow)');

	/* reset, then engine off/on */
	ok(R.resetActive() === true, 'R5 resetActive');
	R.rect(0, rc);
	ok(rc.zoom === 1 && rc.panX === 0 && rc.panY === 0, 'R5 reset returns to zoom 1 / pan 0');
	ok(px(shim.baseImg.style.width) === L.w, 'R5 reset rewrote the zoom-1 pixels');

	SF.setEnabled(false);
	ok(shim.baseImg.style.width === '' && shim.baseImg.style.transform === '', 'R5 off() clears the child inline styles');
	ok(shim.hdImg.style.display === '', 'R5 off() clears the HD display');
	ok(!shim.html.classList.contains('snow-ready'), 'R5 off() removes snow-ready — the no-JS containment rules apply again');
	SF.setEnabled(true);
	ok(shim.html.classList.contains('snow-ready'), 'R5 re-enable restores snow-ready from frame()');
	ok(px(shim.baseImg.style.width) === L.w && px(shim.hdImg.style.width) === rc.w * L.s, 'R5 re-enable rewrites every child');

	/* missing entry: whole base is the region, HD hidden, no errors */
	shim.window.REGIONS = {};
	SF.refresh();
	R.rect(0, rc);
	ok(rc.has === 0 && rc.w === 1984 && rc.h === 1152, 'R5 missing entry falls back to the whole base');
	ok(shim.hdImg.style.display === 'none', 'R5 missing entry hides the HD crop');
	const Lf = {};
	HD.finalLayout(1425, 900, 1984, 1152, rc, { zoom: 1, x: 0, y: 0, maxZoom: 4 }, Lf);
	ok(px(shim.baseImg.style.width) === Lf.w && px(shim.baseImg.style.height) === Lf.h,
		'R5 fallback base sized from the same math (' + shim.baseImg.style.width + '×' + shim.baseImg.style.height + ')');
	ok(regionVisible(1425, 900, rc, Lf), 'R5 fallback whole-base region visible at zoom 1');

	/* fixed mode: skipped with exactly one warning, out of the managed set */
	shim.wagon._dataset.mode = 'fixed';
	SF.refresh();
	ok(R.count() === 0, 'R5 fixed-mode .snow-hd left unmanaged');
	ok(shim.warns.length === 1, 'R5 fixed-mode warns exactly once (got ' + shim.warns.length + ')');
	shim.wagon._dataset.mode = 'cover';
	SF.refresh();
	ok(R.count() === 1 && shim.warns.length === 1, 'R5 warn stays once after the wagon is fixed up');
	ok(shim.errors.length === 0, 'R5 zero console errors through the whole lifecycle' + (shim.errors.length ? ': ' + shim.errors[0] : ''));
}

/* ---------------- R4: adapter static contract ---------------- */
{
	const raw = fs.readFileSync(path.join(ROOT, 'snowfall-region.js'), 'utf8');
	/* static checks scan CODE, not prose: comments may quote the forbidden APIs */
	const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
	ok(!/addEventListener\('scroll'/.test(src) && !/addEventListener\("scroll"/.test(src),
		'R4 adapter installs no scroll listener (the engine owns scroll)');
	ok(!/wagonEls\[[^\]]*\]\.style/.test(src) && !/\.snow-bg[^.\n]*\.style\.transform\s*=/.test(src),
		'R4 adapter never writes style on a wagon element');
	ok(!/decodeURIComponent/.test(src), 'R4 normKey never percent-decodes (data: URI keys must survive verbatim)');
	ok(/snow-ready/.test(src) && /classList\.remove\('snow-ready'\)/.test(src),
		'R4 off() removes snow-ready — a disabled engine leaves the contained no-JS page');
	ok(!/getBoundingClientRect|offsetTop|offsetHeight|getComputedStyle/.test(src),
		'R4 adapter reads no layout APIs');
	const frameMatch = /function frame\(sY, vh, vw\) \{([\s\S]*?)\n\}/.exec(src);
	ok(!!frameMatch, 'R4 frame() located for the allocation scan');
	if (frameMatch) {
		const cleaned = frameMatch[1].replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
		ok(!/=\s*\{[^}]*\}/.test(cleaned) && !/=\s*\[[^\]]*\]/.test(cleaned),
			'R4 frame() body allocates no object/array literals');
		ok(!/\bnew\b/.test(cleaned), 'R4 frame() body has no new expressions');
		const hdPath = cleaned.split('var hEl')[1] || '';
		ok(/naturalWidth/.test(cleaned) && !/naturalWidth/.test(hdPath),
			'R4 the HD path reads no naturalWidth (base-only decode read)');
	}
}

module.exports = { run: function () { return fails; }, checks: function () { return checks; } };
if (require.main === module) {
	console.log('region: ' + (fails ? fails + ' FAILURES of ' + checks : 'PASS (' + checks + ' checks)'));
	process.exit(fails ? 1 : 0);
}
