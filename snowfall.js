/* snowfall.js — visual novella scroll engine: core + wagons (0.2).
	Sticky park (compositor) + JS push chain (sync scroll handler).
	Classic script, no modules; require()-able under node with zero DOM at load. */
(function(global) {
'use strict';

/* ---------------- pure math: node-testable, zero DOM ---------------- */
function chain(n, free, ext, pos) {
	if (n <= 0) return pos;
	pos[n - 1] = free[n - 1] > 0 ? free[n - 1] : 0;
	for (let i = n - 2; i >= 0; i--) {
		const park = free[i] > 0 ? free[i] : 0;
		const ceil = pos[i + 1] - ext[i];
		pos[i] = ceil < park ? ceil : park;
	}
	return pos;
}
/* what CSS position:sticky;top:0 shows without any transform.
	CSS constrains the MARGIN box within the parent CONTENT box, so the
	mirror needs content-box bottom and the (negative ok) marginBottom. */
function stickyShown(free, ext, pBotC, pH, mb) {
	if (ext >= pH) return free;
	const park = free > 0 ? free : 0;
	const cap = pBotC - ext - mb;
	return cap < park ? cap : park;
}
function dirCode(s) {
	if (s === 'left') return 1;
	if (s === 'right') return 2;
	if (s === 'bottom') return 3;
	return 0;
}
function parseGap(s, vh, rem) {
	if (s === undefined || s === null) return 0;
	const t = String(s).trim();
	if (t === '' || t === '0') return 0;
	const m = /^(-?[\d.]+)(px|rem|vh)?$/.exec(t);
	if (!m) return 0;
	const v = +m[1];
	const px = m[2] === 'vh' ? v * vh / 100 : m[2] === 'rem' ? v * rem : v;
	return px > 0 ? px : 0;
}
function parseSize(ds) {
	let w = 0, h = 0;
	if (ds.size) {
		const p = String(ds.size).toLowerCase().split('x');
		w = parseFloat(p[0]); h = p.length > 1 ? parseFloat(p[1]) : w;
	} else {
		w = parseFloat(ds.w); h = ds.h !== undefined ? parseFloat(ds.h) : w;
	}
	if (!(w > 0)) w = 512;
	if (!(h > 0)) h = w;
	return [w, h];
}

var CSS = '.snow-bg{position:sticky;top:0;z-index:-1;pointer-events:none;background-repeat:no-repeat;background-position:center}'
	+ '.snow-bg[data-mode=tiled]{background-repeat:repeat}'
	+ '.snow-bg[data-mode=cover]{background-size:cover}'
	+ '.snow-bg[data-mode=contain]{background-size:contain}'
	+ '.snow-bg[data-mode=fixed]{background-size:100% 100%}'
	+ '.snow-bg[data-mode=auto]{background-size:auto}'
	+ '.snow-stick{position:sticky;z-index:5}'
	+ '.snow-a{position:absolute;width:0;height:0;margin:0;padding:0;border:0;overflow:hidden;visibility:hidden;pointer-events:none}'
	+ 'html.snow-off .snow-bg{position:relative;transform:none !important}';
function injectCSS(doc) {
	if (doc.getElementById('snowfall-core-css')) return;
	const st = doc.createElement('style');
	st.id = 'snowfall-core-css';
	st.textContent = CSS;
	doc.head.appendChild(st);
}

/* ---------------- core factory ---------------- */
function createCore(opts) {
	opts = opts || {};
	const hasDOM = typeof document !== 'undefined' && typeof window !== 'undefined';
	const scope = opts.scope || (hasDOM ? document : null);
	const inst = {
		options: { wagons: 1, morph: 1, events: 1, hysteresis: 40, parkedAsView: 0 },
		enabled: opts.enabled !== false,
		destroyed: false,
		onFrame: typeof opts.onFrame === 'function' ? opts.onFrame : null,
		subs: [],
		stamp: 0,
		wagons: { n: 0, els: [], y: [], free: [], pos: [], ext: [], dir: [] },
		debug: { n: 0, active: -1, parked: 0, pushed: 0, writes: 0 }
	};
	if (opts.options) for (const k in opts.options) inst.options[k] = +opts.options[k] || 0;

	/* wagon subscriber state (preallocated at measure, mutated in place) */
	const W = {
		els: [], y: new Float64Array(0), free: new Float64Array(0),
		pos: new Float64Array(0), ext: new Float64Array(0),
		pBot: new Float64Array(0), pH: new Float64Array(0), mb: new Float64Array(0),
		gap: new Float64Array(0), dir: new Uint8Array(0),
		lastX: new Float64Array(0), lastY: new Float64Array(0), n: 0
	};
	let lastVh = 0, lastVw = 0;

	function ensureMarker(el) {
		if (!hasDOM) return null;
		const m = el.__snowA;
		if (m && m.parentNode && el.__snowStamp === inst.stamp) return m;
		const i = document.createElement('i');
		i.className = 'snow-a';
		i.setAttribute('aria-hidden', 'true');
		el.parentNode.insertBefore(i, el);
		el.__snowA = i;
		el.__snowStamp = inst.stamp;
		return i;
	}
	function collectSticks() {
		if (!scope || !scope.querySelectorAll) return;
		const list = scope.querySelectorAll('.snow-stick[data-park]');
		for (let k = 0; k < list.length; k++) {
			const el = list[k];
			const v = (el.dataset.park || 'top').split(':');
			const off = v[1] !== undefined && v[1] !== '' ? v[1] : '0';
			if (v[0] === 'bottom') { el.style.bottom = off; el.style.top = ''; }
			else { el.style.top = off; el.style.bottom = ''; }
		}
	}
	function wagonsMeasure() {
		if (!hasDOM || !scope || !scope.querySelectorAll) return;
		injectCSS(document);
		const vh = window.innerHeight, vw = window.innerWidth;
		if (vh !== lastVh || vw !== lastVw) {
			lastVh = vh; lastVw = vw;
			document.documentElement.style.setProperty('--snow-vh', vh + 'px');
			document.documentElement.style.setProperty('--snow-vw', vw + 'px');
		}
		collectSticks();
		const found = scope.querySelectorAll('.snow-bg');
		const els = [];
		for (let k = 0; k < found.length; k++) {
			if (found[k].hasAttribute('data-static')) continue;
			els.push(found[k]);
		}
		const n = els.length;
		if (W.y.length < n) {
			W.y = new Float64Array(n); W.free = new Float64Array(n);
			W.pos = new Float64Array(n); W.ext = new Float64Array(n);
			W.pBot = new Float64Array(n); W.pH = new Float64Array(n);
			W.mb = new Float64Array(n); W.gap = new Float64Array(n);
			W.dir = new Uint8Array(n);
			W.lastX = new Float64Array(n); W.lastY = new Float64Array(n);
		}
		W.els = els; W.n = n;
		let rem = 16;
		try { rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16; }
		catch (e) { rem = 16; }
		const sY = window.scrollY || 0;
		for (let i = 0; i < n; i++) {
			const el = els[i], ds = el.dataset;
			const mode = ds.mode || 'cover';
			if (mode === 'fixed' || mode === 'auto') {
				const s = parseSize(ds);
				el.style.width = s[0] + 'px';
				el.style.height = s[1] + 'px';
			} else {
				el.style.width = '100%';
				el.style.height = 'var(--snow-vh,100vh)';
			}
			if (el.style.willChange !== 'transform') el.style.willChange = 'transform';
			/* engine owns wagon margins: marker Y must equal border-top exactly,
			   and the sticky mirror assumes marginTop 0 (see stickyShown) */
			if (el.style.marginTop !== '0px') el.style.marginTop = '0px';
			if (el.style.marginLeft !== '0px') el.style.marginLeft = '0px';
			if (el.style.marginRight !== '0px') el.style.marginRight = '0px';
			W.dir[i] = dirCode(ds.dir);
			W.gap[i] = parseGap(ds.gap, vh, rem);
			ensureMarker(el);
		}
		/* strict phases: box writes → ext reads → margin writes → anchor reads.
		   marginBottom shifts everything below it (including shared parents),
		   so NO reads of markers/parents may interleave with margin writes. */
		for (let i = 0; i < n; i++) {
			const e = els[i].offsetHeight;
			W.ext[i] = e > 1 ? e : 1;
		}
		for (let i = 0; i < n; i++) {
			const mb = W.gap[i] - W.ext[i];
			W.mb[i] = mb;
			els[i].style.marginBottom = mb + 'px';
		}
		const pads = [];
		for (let i = 0; i < n; i++) {
			const el = els[i];
			const r = el.__snowA.getBoundingClientRect();
			W.y[i] = r.top + sY;
			const par = el.parentElement;
			let pad = null;
			for (let k = 0; k < pads.length; k++) if (pads[k].el === par) pad = pads[k];
			if (!pad) {
				const cs = getComputedStyle(par);
				pad = { el: par, t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0,
					bt: parseFloat(cs.borderTopWidth) || 0, bb: parseFloat(cs.borderBottomWidth) || 0 };
				pads.push(pad);
			}
			const pr = par.getBoundingClientRect();
			W.pBot[i] = pr.bottom + sY - pad.b - pad.bb;
			const ch = pr.height - pad.t - pad.b - pad.bt - pad.bb;
			W.pH[i] = ch > 0 ? ch : 0;
		}
		W.lastX.fill(NaN); W.lastY.fill(NaN);
		inst.wagons = { n: n, els: els, y: W.y, free: W.free, pos: W.pos, ext: W.ext, dir: W.dir };
		inst.debug.n = n;
	}
	function wagonsFrame(sY, vh, vw) {
		const n = W.n;
		if (!n || !inst.options.wagons) { inst.debug.writes = 0; return; }
		for (let i = 0; i < n; i++) W.free[i] = W.y[i] - sY;
		chain(n, W.free, W.ext, W.pos);
		let active = -1, parked = 0, pushed = 0, writes = 0;
		for (let i = 0; i < n; i++) {
			const fr = W.free[i], e = W.ext[i];
			const park = fr > 0 ? fr : 0;
			const p = W.pos[i], d = park - p;
			const sh = stickyShown(fr, e, W.pBot[i] - sY, W.pH[i], W.mb[i]);
			/* exits diverge only past the edge (pos<0): while riding, every wagon
			   respects the chain ceiling exactly like a top exit, so lateral and
			   bottom wagons stay glued to their text until they park. Both
			   branches meet at pos=0 with x=0, so no jump is possible. */
			let dx = 0, dy = p - sh;
			const dir = W.dir[i];
			if (dir === 1 || dir === 2) {
				const dp = p < 0 ? -p : 0;
				dx = (dir === 1 ? -1 : 1) * (dp / e) * vw;
				dy = (p > 0 ? p : 0) - sh;
			}
			else if (dir === 3) dy = (p > 0 ? p : -p) - sh;
			if (dx !== W.lastX[i] || dy !== W.lastY[i]) {
				W.els[i].style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0)';
				W.lastX[i] = dx; W.lastY[i] = dy; writes++;
			}
			if (fr <= 0) active = i;
			if (p === 0 && fr <= 0) parked++;
			if (d > 0) pushed++;
		}
		inst.debug.active = active;
		inst.debug.parked = parked;
		inst.debug.pushed = pushed;
		inst.debug.writes = writes;
	}
	inst.use = function(sub) { inst.subs.push(sub); return sub; };
	inst.use({ measure: wagonsMeasure, frame: wagonsFrame });

	function coreFrame(sY, vh, vw) {
		if (inst.destroyed || !inst.enabled) return;
		const subs = inst.subs;
		for (let i = 0; i < subs.length; i++) subs[i].frame(sY, vh, vw);
		if (inst.onFrame) inst.onFrame(inst);
	}
	inst.refresh = function() {
		if (inst.destroyed || !hasDOM) return;
		inst.stamp++;
		const subs = inst.subs;
		for (let i = 0; i < subs.length; i++) subs[i].measure();
		coreFrame(window.scrollY || 0, window.innerHeight, window.innerWidth);
	};
	inst.step = function(sY, vh, vw) {
		if (inst.destroyed) return;
		if (sY === undefined) sY = hasDOM ? window.scrollY || 0 : 0;
		if (vh === undefined) vh = hasDOM ? window.innerHeight : 0;
		if (vw === undefined) vw = hasDOM ? window.innerWidth : 0;
		coreFrame(sY, vh, vw);
	};
	inst.anchorY = function(el) {
		if (!hasDOM || !el || !el.__snowA || !el.__snowA.parentNode) return 0;
		return el.__snowA.getBoundingClientRect().top + (window.scrollY || 0);
	};
	inst.setEnabled = function(on) {
		inst.enabled = !!on;
		if (!hasDOM) return;
		document.documentElement.classList.toggle('snow-off', !inst.enabled);
		if (!inst.enabled) {
			for (let i = 0; i < W.n; i++) W.els[i].style.transform = '';
			W.lastX.fill(NaN); W.lastY.fill(NaN);
			inst.debug.writes = 0;
		} else inst.step();
	};
	inst.destroy = function() {
		if (inst.destroyed) return;
		inst.destroyed = true;
		if (hasDOM) {
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onResize);
			document.documentElement.classList.remove('snow-off');
			for (let i = 0; i < W.n; i++) W.els[i].style.transform = '';
		}
	};
	function onScroll() {
		coreFrame(window.scrollY || 0, window.innerHeight, window.innerWidth);
	}
	function onResize() { inst.refresh(); }
	if (hasDOM) {
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onResize);
		if (document.fonts && document.fonts.ready) document.fonts.ready.then(function() { inst.refresh(); });
		if (!inst.enabled) document.documentElement.classList.add('snow-off');
	}
	return inst;
}

/* ---------------- namespace + autoboot + node guard ---------------- */
const Snowfall = {
	create: createCore,
	default: null,
	version: '0.2',
	chain: chain,
	stickyShown: stickyShown,
	dirCode: dirCode,
	parseGap: parseGap,
	parseSize: parseSize
};
Snowfall.use = function(s) { return Snowfall.default.use(s); };
Snowfall.refresh = function() { if (Snowfall.default) Snowfall.default.refresh(); };
Snowfall.step = function(a, b, c) { if (Snowfall.default) Snowfall.default.step(a, b, c); };
Snowfall.anchorY = function(el) { return Snowfall.default ? Snowfall.default.anchorY(el) : 0; };
Snowfall.setEnabled = function(on) { if (Snowfall.default) Snowfall.default.setEnabled(on); };
Object.defineProperty(Snowfall, 'wagons', { get: function() { return Snowfall.default ? Snowfall.default.wagons : undefined; } });
Object.defineProperty(Snowfall, 'debug', { get: function() { return Snowfall.default ? Snowfall.default.debug : undefined; } });
Object.defineProperty(Snowfall, 'options', { get: function() { return Snowfall.default ? Snowfall.default.options : undefined; } });
Object.defineProperty(Snowfall, 'eventCount', { get: function() { return Snowfall.default ? Snowfall.default.eventCount : undefined; } });
function boot() {
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	Snowfall.default = Snowfall.create({ scope: document.getElementById('app') || document });
	if (document.readyState === 'loading')
		document.addEventListener('DOMContentLoaded', function() { Snowfall.default.refresh(); });
	else Snowfall.default.refresh();
}
boot();
global.Snowfall = Snowfall;
if (typeof module !== 'undefined' && module.exports) module.exports = Snowfall;
})(typeof window !== 'undefined' ? window : globalThis);
