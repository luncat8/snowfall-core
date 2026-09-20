/* snowfall.js — visual novella scroll engine: core + wagons (0.2) + style/theme morph (0.3) + script events (0.4)
	+ cached viewport & parent-bottom clamp (0.5.5).
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
	mirror needs content-box bottom and the (negative ok) marginBottom.
	No ext>=pH shortcut: measured in Chrome, a wagon taller than its parent
	still parks at top:0 while the parent is visible and releases to the cap
	once the parent's content bottom passes (the margin box is what fits, and
	with overlay flow it is tiny). The min(park,cap) clamp covers every case;
	the old shortcut returned flow and misplaced tall wagons by -free. */
function stickyShown(free, ext, pBotC, pH, mb) {
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
function eventCode(s) {
	if (s === 'view') return 0;
	if (s === 'center') return 1;
	if (s === 'parked') return 2;
	if (s === 'end') return 3;
	if (s === 'skip') return 4;
	return -1;
}
var EV_NAMES = ['view', 'center', 'parked', 'end', 'skip'];
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
/* 0..255 int or null. Components are 0-255 (never 0-1 scaled); alpha is the
   only 0-1 channel; both accept %. Out-of-range clamps (CSS behaviour). */
function num255(s, isAlpha) {
	if (s === undefined || s === null) return null;
	const t = String(s).trim();
	if (t === '') return null;
	let v;
	if (t[t.length - 1] === '%') v = parseFloat(t) * 255 / 100;
	else { v = parseFloat(t); if (isAlpha) v = v * 255; }
	if (!isFinite(v)) return null;
	v = Math.round(v);
	return v < 0 ? 0 : v > 255 ? 255 : v;
}
/* [r,g,b,a255] or null. #rgb/#rgba/#rrggbb/#rrggbbaa, rgb()/rgba() with comma
   or space+slash syntax. Anything else (gradients, named colours) is a TOKEN:
   the caller assigns it verbatim instead of lerping it. */
function parseColor(s) {
	if (s === undefined || s === null) return null;
	const t = String(s).trim();
	if (t === '') return null;
	if (t[0] === '#') {
		let h = t.slice(1);
		if (h.length === 3 || h.length === 4) {
			let e = '';
			for (let k = 0; k < h.length; k++) e += h[k] + h[k];
			h = e;
		}
		if (h.length !== 6 && h.length !== 8) return null;
		for (let k = 0; k < h.length; k++) {
			const c = h.charCodeAt(k) | 32;
			if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return null;
		}
		const n = parseInt(h, 16);
		if (h.length === 6) return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
		return [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
	}
	if (t.length < 10 || t[0] !== 'r' || t[1] !== 'g' || t[2] !== 'b') return null;
	const m = /^rgba?\(([^)]+)\)$/.exec(t);
	if (!m) return null;
	const inner = m[1];
	let a = 255, parts;
	if (inner.indexOf(',') >= 0) {
		parts = inner.split(',');
		if (parts.length === 4) { a = num255(parts[3], true); parts = parts.slice(0, 3); }
		else if (parts.length !== 3) return null;
	} else {
		const sides = inner.split('/');
		if (sides.length > 2) return null;
		parts = sides[0].trim().split(/\s+/);
		if (parts.length !== 3) return null;
		if (sides.length === 2) a = num255(sides[1], true);
	}
	const r = num255(parts[0], false), g = num255(parts[1], false), b = num255(parts[2], false);
	if (r === null || g === null || b === null || a === null) return null;
	return [r, g, b, a];
}
/* linear-light lerp: sRGB midpoints go muddy, linear ones stay clean.
   Ends are exact (t<=0 → a, t>=1 → b); the LUT only serves the interior. */
/* L2S needs 4096 entries: a 256-entry table quantises the dark end to ±6
   sRGB steps (round-trip sRGB→linear→sRGB must be exact for all 256 inputs,
   verified in node). 4 KB, built once. */
const S2L = new Float64Array(256), L2S = new Uint8Array(4097);
for (let v = 0; v < 256; v++) {
	const s = v / 255;
	S2L[v] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
for (let k = 0; k <= 4096; k++) {
	const l = k / 4096;
	const s = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
	L2S[k] = Math.round(Math.min(1, Math.max(0, s)) * 255);
}
function mixLin(a, b, t) {
	if (t <= 0) return a;
	if (t >= 1) return b;
	return L2S[Math.round((S2L[a] + (S2L[b] - S2L[a]) * t) * 4096)];
}
function mixA(a, b, t) {
	if (t <= 0) return a;
	if (t >= 1) return b;
	return Math.round(a + (b - a) * t);
}
function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
/* cached parent padding/border for the anchor phase. The horizontal fields are
	read before any margin write (see the phase comment in wagonsMeasure), so a
	wagon can be pulled out of its parent's text column without a second layout
	pass; the vertical ones stay valid because parent boxes only grow downward. */
function parentPad(par, pads) {
	for (let k = 0; k < pads.length; k++) if (pads[k].el === par) return pads[k];
	const cs = getComputedStyle(par);
	const pad = { el: par,
		pt: parseFloat(cs.paddingTop) || 0, pb: parseFloat(cs.paddingBottom) || 0,
		bt: parseFloat(cs.borderTopWidth) || 0, bb: parseFloat(cs.borderBottomWidth) || 0,
		cl: parseFloat(cs.paddingLeft) || 0, cb: parseFloat(cs.borderLeftWidth) || 0 };
	pads.push(pad);
	return pad;
}
function ease01(t) {
	t = clamp01(t);
	return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/* overflow:clip keeps a wagon's art inside its own box: the region base is
   deliberately larger than the window while parked, and unclipped it paints
   past the wagon edge — an entering wagon's outpaint then covers the
   parked wagon's HD crop before the chain starts pushing it. Clipping the
   sticky element itself never touches its stickiness (only an ANCESTOR's
   overflow could), and a plain background-image was always inside the box. */
var CSS = '.snow-bg{position:sticky;top:0;z-index:-1;pointer-events:none;overflow:clip;background-repeat:no-repeat;background-position:center}'
	+ '.snow-bg[data-mode=tiled]{background-repeat:repeat}'
	+ '.snow-bg[data-mode=cover]{background-size:cover}'
	+ '.snow-bg[data-mode=contain]{background-size:contain}'
	+ '.snow-bg[data-mode=fixed]{background-size:100% 100%}'
	+ '.snow-bg[data-mode=auto]{background-size:auto}'
	+ '.snow-stick{position:sticky;z-index:5}'
	+ '.snow-a{position:absolute;width:0;height:0;margin:0;padding:0;border:0;overflow:hidden;visibility:hidden;pointer-events:none}'
	+ 'script[type=txt]{display:none}'
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
		morph: { n: 0, els: [], ay: [], range: [], bgKind: [], fgKind: [], cls: [] },
		events: { n: 0, els: [], y: [], wagon: [], flags: [], decl: [] },
		eventCount: 0,
		debug: { n: 0, active: -1, parked: 0, pushed: 0, writes: 0,
			styleN: 0, styleBg: -1, styleFg: -1, styleT: -1, styleCls: '', eventN: 0 }
	};
	if (opts.options) for (const k in opts.options) inst.options[k] = +opts.options[k] || 0;

	/* wagon subscriber state (preallocated at measure, mutated in place) */
	const W = {
		els: [], y: new Float64Array(0), free: new Float64Array(0),
		pos: new Float64Array(0), ext: new Float64Array(0),
		pBot: new Float64Array(0), pH: new Float64Array(0), mb: new Float64Array(0),
		gap: new Float64Array(0), dir: new Uint8Array(0),
		box: new Float64Array(0), parL: new Float64Array(0), lastMl: new Float64Array(0),
		lastX: new Float64Array(0), lastY: new Float64Array(0), n: 0
	};
	const rootEl = hasDOM ? document.documentElement : null;
	/* one viewport authority (0.5.5): width is clientWidth — the page-span box
	   resolves against it, innerWidth would overshoot the classic scrollbar;
	   height is innerHeight, following the mobile URL bar. Written to
	   --snow-vw/--snow-vh and fed to frame() from the same object, so the
	   wagon box and the frame math can never disagree. */
	const vp = { width: 0, height: 0 };
	function measureViewport() {
		if (!hasDOM) return vp;
		const de = document.documentElement;
		const w = de.clientWidth || window.innerWidth;
		const h = window.innerHeight;
		if (vp.width === w && vp.height === h) return vp;
		vp.width = w; vp.height = h;
		de.style.setProperty('--snow-vw', w + 'px');
		de.style.setProperty('--snow-vh', h + 'px');
		return vp;
	}
	Object.defineProperty(inst, 'viewport', { get: function() { return vp; } });

	/* morph subscriber state (preallocated at measure, mutated in place) */
	const M = {
		els: [], n: 0, ay: new Float64Array(0), range: new Float64Array(0), rawRange: [],
		bgKind: new Uint8Array(0), fgKind: new Uint8Array(0),
		br: new Int16Array(0), bg_: new Int16Array(0), bb: new Int16Array(0), ba: new Int16Array(0),
		fr: new Int16Array(0), fg_: new Int16Array(0), fb: new Int16Array(0), fa: new Int16Array(0),
		tokBg: [], tokFg: [], cls: [],
		srcBg: new Int32Array(0), srcFg: new Int32Array(0),
		sbg: new Float64Array(0), sfg: new Float64Array(0)
	};
	let lastBgKind = -1, lastBgPack = 0, lastBgA = 0, lastTokBg = '';
	let lastFgKind = -1, lastFgPack = 0, lastFgA = 0, lastTokFg = '';
	let lastTq = -1, lastClsKey = null, lastClsArr = [];
	const chBg = { v: -1, u: -1 }, chFg = { v: -1, u: -1 };

	/* events subscriber state: anchors share flags across scripts at the same Y,
	   so a skip script sees the view its sibling fired (slow pass must not skip).
	   Scripts keep their own fn + counts for data-snow. All preallocated. */
	const E = {
		els: [], n: 0, y: new Float64Array(0), flags: new Uint8Array(0),
		wagon: new Int32Array(0), decl: new Uint8Array(0), needPrefill: false
	};
	const S = {
		els: [], n: 0, decl: new Uint8Array(0), anchor: new Int32Array(0),
		fn: [], cnt: new Uint16Array(0)
	};
	const detail = { el: null, event: '', y: 0, scrollY: 0, wagon: -1, morph: 0 };

	function ensureMarker(el) {
		if (!hasDOM) return null;
		const m = el.__snowA;
		if (m && m.parentNode) { el.__snowStamp = inst.stamp; return m; }
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
		measureViewport();
		const vh = vp.height;
		/* art wagons span the visible page, never their parent's text column:
		   vp.width is clientWidth, what the user actually sees, so the art is
		   not clipped under the classic scrollbar. */
		const spanW = vp.width;
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
			W.box = new Float64Array(n); W.parL = new Float64Array(n);
			W.lastMl = new Float64Array(n);
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
				W.box[i] = s[0];
			} else {
				el.style.width = spanW + 'px';
				el.style.height = 'var(--snow-vh,100vh)';
				W.box[i] = 0;
			}
			if (el.style.willChange !== 'transform') el.style.willChange = 'transform';
			/* engine owns wagon margins: marker Y must equal border-top exactly,
			   and the sticky mirror assumes marginTop 0 (see stickyShown). The
			   horizontal margins are the page-span offset, written in the margin
			   phase (after the parent read, before the marker read). */
			if (el.style.marginTop !== '0px') el.style.marginTop = '0px';
			W.dir[i] = dirCode(ds.dir);
			W.gap[i] = parseGap(ds.gap, vh, rem);
			ensureMarker(el);
		}
		/* strict phases: box writes → ext reads → margin writes → anchor reads.
		   marginBottom shifts everything below it (including shared parents),
		   so NO reads of markers/parents may interleave with margin writes.
		   The parent's CONTENT left is a horizontal read, immune to that shift,
		   so it is taken here and the span margin is ready before the marker. */
		const pads = [];
		for (let i = 0; i < n; i++) {
			const el = els[i], par = el.parentElement;
			const e = el.offsetHeight;
			W.ext[i] = e > 1 ? e : 1;
			const pad = parentPad(par, pads);
			W.parL[i] = par.getBoundingClientRect().left + pad.cl + pad.cb;
		}
		for (let i = 0; i < n; i++) {
			const el = els[i];
			const mb = W.gap[i] - W.ext[i];
			W.mb[i] = mb;
			el.style.marginBottom = mb + 'px';
			/* left edge of the page minus the parent's content left: the wagon
			   then starts at viewport 0 whatever column it was authored in.
			   Explicit boxes (fixed/auto) are centred in the page instead. */
			const box = W.box[i];
			const ml = (box > 0 ? (spanW - box) / 2 : 0) - W.parL[i];
			if (ml !== W.lastMl[i]) { el.style.marginLeft = ml + 'px'; W.lastMl[i] = ml; }
			if (el.style.marginRight !== '0px') el.style.marginRight = '0px';
		}
		/* the margin writes above change the page height, and a browser clamps
		   scrollY when the document shrinks under it, so the scroll offset is
		   read HERE, with the anchors: an offset captured before the writes is
		   stale and every document coordinate comes out shifted. */
		const sYNow = window.scrollY || 0;
		for (let i = 0; i < n; i++) {
			const el = els[i];
			const r = el.__snowA.getBoundingClientRect();
			W.y[i] = r.top + sYNow;
			const par = el.parentElement, pad = parentPad(par, pads);
			const pr = par.getBoundingClientRect();
			W.pBot[i] = pr.bottom + sYNow - pad.pb - pad.bb;
			const ch = pr.height - pad.pt - pad.pb - pad.bt - pad.bb;
			W.pH[i] = ch > 0 ? ch : 0;
		}
		W.lastX.fill(NaN); W.lastY.fill(NaN); W.lastMl.fill(NaN);
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
			/* clamp `pos` to the parent bottom (0.5.5): the same cap
			   `stickyShown` mirrors. Without it the chain keeps park while
			   stickyShown runs to −∞ past the parent bottom, and the delta
			   parks the wagon on-screen forever; with it `dy → 0` and the
			   wagon follows its sticky position off-screen. */
			const cap = W.pBot[i] - sY - e - W.mb[i];
			const p = W.pos[i] > cap ? cap : W.pos[i];
			W.pos[i] = p;
			const d = park - p;
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
	function styleMeasure() {
		M.n = 0;
		M.els = [];
		inst.morph = { n: 0, els: [], ay: [], range: [], bgKind: [], fgKind: [], cls: [] };
		inst.debug.styleN = 0;
		if (!hasDOM || !scope || !scope.querySelectorAll) return;
		const found = scope.querySelectorAll('[data-bg],[data-fg],[data-style]');
		const els = [];
		for (let k = 0; k < found.length; k++) els.push(found[k]);
		const n = els.length;
		if (M.ay.length < n) {
			M.ay = new Float64Array(n); M.range = new Float64Array(n);
			M.bgKind = new Uint8Array(n); M.fgKind = new Uint8Array(n);
			M.br = new Int16Array(n); M.bg_ = new Int16Array(n);
			M.bb = new Int16Array(n); M.ba = new Int16Array(n);
			M.fr = new Int16Array(n); M.fg_ = new Int16Array(n);
			M.fb = new Int16Array(n); M.fa = new Int16Array(n);
			M.srcBg = new Int32Array(n); M.srcFg = new Int32Array(n);
		}
		M.els = els; M.n = n;
		M.rawRange = new Array(n); M.tokBg = new Array(n);
		M.tokFg = new Array(n); M.cls = new Array(n);
		const vh = vp.height || window.innerHeight;
		for (let i = 0; i < n; i++) {
			const ds = els[i].dataset;
			const bRaw = ds.bg !== undefined ? String(ds.bg).trim() : '';
			if (bRaw === '') M.bgKind[i] = 0;
			else {
				const c = parseColor(bRaw);
				if (c) { M.bgKind[i] = 1; M.br[i] = c[0]; M.bg_[i] = c[1]; M.bb[i] = c[2]; M.ba[i] = c[3]; }
				else { M.bgKind[i] = 2; M.tokBg[i] = bRaw; }
			}
			const fRaw = ds.fg !== undefined ? String(ds.fg).trim() : '';
			if (fRaw === '') M.fgKind[i] = 0;
			else {
				const c = parseColor(fRaw);
				if (c) { M.fgKind[i] = 1; M.fr[i] = c[0]; M.fg_[i] = c[1]; M.fb[i] = c[2]; M.fa[i] = c[3]; }
				else { M.fgKind[i] = 2; M.tokFg[i] = fRaw; }
			}
			M.rawRange[i] = parseFloat(ds.range);
			M.cls[i] = ds.style !== undefined ? String(ds.style).trim().replace(/\s+/g, ' ') : '';
			ensureMarker(els[i]);
		}
		const sY = window.scrollY || 0;
		for (let i = 0; i < n; i++) M.ay[i] = els[i].__snowA.getBoundingClientRect().top + sY;
		for (let i = 0; i < n; i++) {
			const raw = M.rawRange[i];
			if (raw === raw) M.range[i] = raw >= 1 ? raw : 1;
			else {
				const iv = i > 0 ? M.ay[i] - M.ay[i - 1] : vh * 0.6;
				const d = Math.min(iv, vh * 0.6);
				M.range[i] = d >= 1 ? d : 1;
			}
		}
		if (M.sbg.length < n) { M.sbg = new Float64Array(n); M.sfg = new Float64Array(n); }
		let sb = -1, sf = -1;
		for (let i = 0; i < n; i++) {
			if (M.bgKind[i] !== 0) {
				M.sbg[i] = sb < 0 ? M.ay[i] - M.range[i] : Math.max(M.ay[i] - M.range[i], M.ay[sb]);
				sb = i;
			} else M.sbg[i] = M.ay[i];
			if (M.fgKind[i] !== 0) {
				M.sfg[i] = sf < 0 ? M.ay[i] - M.range[i] : Math.max(M.ay[i] - M.range[i], M.ay[sf]);
				sf = i;
			} else M.sfg[i] = M.ay[i];
			M.srcBg[i] = sb; M.srcFg[i] = sf;
		}
		inst.morph = { n: n, els: els, ay: M.ay, range: M.range,
			bgKind: M.bgKind, fgKind: M.fgKind, cls: M.cls,
			br: M.br, bg_: M.bg_, bb: M.bb, ba: M.ba, fr: M.fr, fg_: M.fg_, fb: M.fb, fa: M.fa,
			tokBg: M.tokBg, tokFg: M.tokFg, sbg: M.sbg, sfg: M.sfg };
		inst.debug.styleN = n;
	}
	/* one channel at reading-line c, i = lastLE: out.v = value anchor (-1 none),
	   out.u = morph target or -1. Target search SKIPS kind-0 anchors (they
	   carry no channel info and must not disturb a running morph); the zone
	   start S[u] is pre-clamped to the previous value anchor, so zones never
	   overlap and t always runs 0→1 exactly. Colour→colour morphs; anything
	   involving a token (or a missing source) holds, then switches at ay. */
	function chanAt(kind, src, S, c, i, out) {
		const n = M.n;
		out.u = -1;
		if (i < 0) { out.v = n ? src[0] : -1; return; }
		let v = src[i];
		let u = i + 1;
		while (u < n && kind[u] === 0) u++;
		if (u < n && c >= S[u]) {
			if (kind[u] === 1 && v >= 0 && kind[v] === 1) out.u = u;
			else if (c >= M.ay[u]) v = u;
		}
		out.v = v;
	}
	function chanT(u, S, c) {
		const d = M.ay[u] - S[u];
		if (d < 1) return c >= M.ay[u] ? 1 : 0;
		return ease01((c - S[u]) / d);
	}
	function writeRGB(isBg, r, g, b, a) {
		const p = (r << 16) | (g << 8) | b;
		if (isBg) {
			if (lastBgKind === 1 && lastBgPack === p && lastBgA === a) return;
			lastBgKind = 1; lastBgPack = p; lastBgA = a;
			rootEl.style.setProperty('--snow-bg', a >= 255
				? 'rgb(' + r + ' ' + g + ' ' + b + ')'
				: 'rgb(' + r + ' ' + g + ' ' + b + ' / ' + (a / 255).toFixed(3) + ')');
			inst.debug.styleBg = p;
		} else {
			if (lastFgKind === 1 && lastFgPack === p && lastFgA === a) return;
			lastFgKind = 1; lastFgPack = p; lastFgA = a;
			rootEl.style.setProperty('--snow-fg', a >= 255
				? 'rgb(' + r + ' ' + g + ' ' + b + ')'
				: 'rgb(' + r + ' ' + g + ' ' + b + ' / ' + (a / 255).toFixed(3) + ')');
			inst.debug.styleFg = p;
		}
	}
	function writeTok(isBg, s) {
		if (isBg) {
			if (lastBgKind === 2 && lastTokBg === s) return;
			lastBgKind = 2; lastTokBg = s;
			rootEl.style.setProperty('--snow-bg', s);
			inst.debug.styleBg = -2;
		} else {
			if (lastFgKind === 2 && lastTokFg === s) return;
			lastFgKind = 2; lastTokFg = s;
			rootEl.style.setProperty('--snow-fg', s);
			inst.debug.styleFg = -2;
		}
	}
	function styleFrame(sY, vh) {
		const n = M.n;
		if (!n || !inst.options.morph) return;
		const c = sY + vh * 0.5;
		let i = -1;
		while (i + 1 < n && M.ay[i + 1] <= c) i++;
		chanAt(M.bgKind, M.srcBg, M.sbg, c, i, chBg);
		if (chBg.v >= 0) {
			if (chBg.u >= 0) {
				const u = chBg.u;
				const t = chanT(u, M.sbg, c);
				writeRGB(1, mixLin(M.br[chBg.v], M.br[u], t), mixLin(M.bg_[chBg.v], M.bg_[u], t),
					mixLin(M.bb[chBg.v], M.bb[u], t), mixA(M.ba[chBg.v], M.ba[u], t));
			}
			else if (M.bgKind[chBg.v] === 2) writeTok(1, M.tokBg[chBg.v]);
			else writeRGB(1, M.br[chBg.v], M.bg_[chBg.v], M.bb[chBg.v], M.ba[chBg.v]);
		}
		chanAt(M.fgKind, M.srcFg, M.sfg, c, i, chFg);
		if (chFg.v >= 0) {
			if (chFg.u >= 0) {
				const u = chFg.u;
				const t = chanT(u, M.sfg, c);
				writeRGB(0, mixLin(M.fr[chFg.v], M.fr[u], t), mixLin(M.fg_[chFg.v], M.fg_[u], t),
					mixLin(M.fb[chFg.v], M.fb[u], t), mixA(M.fa[chFg.v], M.fa[u], t));
			}
			else if (M.fgKind[chFg.v] === 2) writeTok(0, M.tokFg[chFg.v]);
			else writeRGB(0, M.fr[chFg.v], M.fg_[chFg.v], M.fb[chFg.v], M.fa[chFg.v]);
		}
		const jt = i < 0 ? 0 : Math.min(i + 1, n - 1);
		const q = Math.round(ease01((c - (M.ay[jt] - M.range[jt])) / M.range[jt]) * 64);
		if (q !== lastTq) {
			lastTq = q;
			rootEl.style.setProperty('--snow-t', String(q / 64));
			inst.debug.styleT = q / 64;
		}
		const key = i < 0 ? '' : M.cls[i];
		if (key !== lastClsKey) {
			for (let k = 0; k < lastClsArr.length; k++) rootEl.classList.remove(lastClsArr[k]);
			lastClsArr = key === '' ? [] : key.split(' ');
			for (let k = 0; k < lastClsArr.length; k++) rootEl.classList.add(lastClsArr[k]);
			lastClsKey = key;
			inst.debug.styleCls = key;
		}
	}
	function eventsMeasure(replay) {
		E.n = 0; E.els = [];
		S.n = 0; S.els = []; S.fn = [];
		inst.events = { n: 0, els: [], y: [], wagon: [], flags: [], decl: [] };
		inst.eventCount = 0;
		inst.debug.eventN = 0;
		E.needPrefill = false;
		if (!hasDOM || !scope || !scope.querySelectorAll) return;
		const found = scope.querySelectorAll('script[type="txt"][event]');
		const tmpEls = [], tmpDecl = [], tmpCode = [];
		for (let k = 0; k < found.length; k++) {
			const el = found[k];
			const attr = el.getAttribute('event');
			if (!attr) continue;
			const parts = attr.split(',');
			let mask = 0;
			for (let p = 0; p < parts.length; p++) {
				const c = eventCode(parts[p].trim().toLowerCase());
				if (c >= 0) mask |= (1 << c);
			}
			if (!mask) continue;
			const code = el.textContent.trim();
			if (!code) continue;
			ensureMarker(el);
			tmpEls.push(el); tmpDecl.push(mask); tmpCode.push(code);
		}
		const m = tmpEls.length;
		if (!m) return;
		if (E.y.length < m) {
			E.y = new Float64Array(m); E.flags = new Uint8Array(m);
			E.wagon = new Int32Array(m); E.decl = new Uint8Array(m);
		}
		if (S.decl.length < m) { S.decl = new Uint8Array(m); S.anchor = new Int32Array(m); }
		S.fn = new Array(m); S.cnt = new Uint16Array(m * 5);
		/* same rule as the wagons: read the scroll with the anchors, after the
		   wagon margins have settled the document height */
		const sY0 = window.scrollY || 0;
		for (let i = 0; i < m; i++) E.y[i] = tmpEls[i].__snowA.getBoundingClientRect().top + sY0;
		for (let i = 0; i < m; i++) {
			let w = -1;
			for (let k = W.n - 1; k >= 0; k--) if (W.y[k] <= E.y[i]) { w = k; break; }
			E.wagon[i] = w; E.decl[i] = tmpDecl[i];
		}
		let j = 0, pairs = 0;
		for (let i = 0; i < m; i++) {
			let fn = null;
			try { fn = new Function('Snowfall', 'detail', tmpCode[i]); }
			catch (e) { console.error('Snowfall event script at y=' + Math.round(E.y[i]), e); continue; }
			if (j !== i) { E.y[j] = E.y[i]; E.wagon[j] = E.wagon[i]; E.decl[j] = E.decl[i]; tmpEls[j] = tmpEls[i]; }
			S.fn[j] = fn; S.decl[j] = E.decl[j];
			const mk = E.decl[j];
			for (let e = 0; e < 5; e++) if (mk & (1 << e)) pairs++;
			try { tmpEls[j].removeAttribute('data-snow'); } catch (_ignored) {}
			j++;
		}
		const nS = j;
		if (!nS) return;
		tmpEls.length = nS;
		S.els = tmpEls; S.n = nS;
		const anchorEls = new Array(nS);
		let a = 0;
		S.anchor[0] = 0; anchorEls[0] = S.els[0];
		for (let i = 1; i < nS; i++) {
			if (Math.abs(E.y[i] - E.y[a]) < 1) {
				S.anchor[i] = a;
				E.decl[a] |= S.decl[i];
			} else {
				a++;
				E.y[a] = E.y[i]; E.wagon[a] = E.wagon[i]; E.decl[a] = S.decl[i];
				S.anchor[i] = a; anchorEls[a] = S.els[i];
			}
		}
		const nA = a + 1;
		anchorEls.length = nA;
		E.els = anchorEls; E.n = nA;
		E.flags.fill(0, 0, nA);
		inst.events = { n: nA, els: E.els, y: E.y, wagon: E.wagon, flags: E.flags, decl: E.decl };
		inst.eventCount = pairs;
		inst.debug.eventN = nA;
		E.needPrefill = !replay;
	}
	function fireAnchor(a, e, sY) {
		for (let s = 0; s < S.n; s++) {
			if (S.anchor[s] !== a) continue;
			if (!(S.decl[s] & (1 << e))) continue;
			const el = S.els[s];
			detail.el = el; detail.event = EV_NAMES[e];
			detail.y = E.y[a]; detail.scrollY = sY;
			detail.wagon = E.wagon[a]; detail.morph = inst.debug.styleT;
			S.cnt[s * 5 + e]++;
			let ds = '';
			const mk = S.decl[s];
			for (let k = 0; k < 5; k++) if (mk & (1 << k)) {
				if (ds !== '') ds += ' ';
				ds += EV_NAMES[k] + ':' + S.cnt[s * 5 + k];
			}
			try { el.setAttribute('data-snow', ds); } catch (_ignored) {}
			try { S.fn[s](Snowfall, detail); }
			catch (err) { console.error('Snowfall event script at y=' + Math.round(E.y[a]), err); }
		}
	}
	function eventsFrame(sY, vh) {
		const nA = E.n;
		if (!nA || !inst.options.events) return;
		if (E.needPrefill) {
			E.needPrefill = false;
			for (let i = 0; i < nA; i++) {
				const d0 = E.y[i] - sY;
				let f0 = 0;
				if (d0 < 0) f0 = 31;
				else if (d0 < vh) {
					f0 |= 1;
					if (d0 < vh * 0.5) f0 |= 2;
					let pok0 = false;
					const w0 = E.wagon[i];
					if (inst.options.wagons && w0 >= 0) pok0 = W.pos[w0] === 0 && W.free[w0] <= 0;
					else if (inst.options.parkedAsView) pok0 = true;
					if (pok0) f0 |= 4;
				}
				E.flags[i] = f0;
			}
		}
		const hyst = inst.options.hysteresis;
		const vhH = vh + hyst, vh2H = vh * 0.5 + hyst, vh2 = vh * 0.5;
		const useW = inst.options.wagons, aliasV = inst.options.parkedAsView;
		for (let i = 0; i < nA; i++) {
			const d = E.y[i] - sY;
			let f = E.flags[i];
			const decl = E.decl[i];
			if (d > vhH) {
				f &= ~(1 | 2 | 4 | 16);
				f &= ~8;
			} else if (d >= 0) {
				if (f & 8) {
					f &= ~8;
					f |= 1 | 2 | 4 | 16;
				} else if (d > vh2H) f &= ~2;
			}
			if (d < vh && d >= 0) {
				if (!(f & 1)) { f |= 1; if (decl & 1) fireAnchor(i, 0, sY); }
				if (d < vh2 && !(f & 2)) { f |= 2; if (decl & 2) fireAnchor(i, 1, sY); }
				/* parked needs the anchor on screen too: otherwise huge chapters fire it
				   while the script is far below, view-first order breaks, and re-arm
				   plus a still-pinned wagon fires it on reverse scroll. */
				let pok = false;
				const w = E.wagon[i];
				if (useW && w >= 0) pok = W.pos[w] === 0 && W.free[w] <= 0;
				else if (aliasV) pok = true;
				if (pok && !(f & 4)) { f |= 4; if (decl & 4) fireAnchor(i, 2, sY); }
			}
			if (d < 0 && !(f & 8)) {
				f |= 8; if (decl & 8) fireAnchor(i, 3, sY);
				if (!(f & 1) && !(f & 16)) { f |= 16; if (decl & 16) fireAnchor(i, 4, sY); }
			}
			E.flags[i] = f;
		}
	}
	function wagonsOff() {
		if (!hasDOM) return;
		for (let k = 0; k < W.n; k++) W.els[k].style.transform = '';
		W.lastX.fill(NaN); W.lastY.fill(NaN);
	}
	function styleOff() {
		if (!hasDOM) return;
		for (let k = 0; k < lastClsArr.length; k++) rootEl.classList.remove(lastClsArr[k]);
		lastClsArr = []; lastClsKey = null;
		rootEl.style.removeProperty('--snow-bg');
		rootEl.style.removeProperty('--snow-fg');
		rootEl.style.removeProperty('--snow-t');
		lastBgKind = -1; lastFgKind = -1; lastTq = -1; lastTokBg = ''; lastTokFg = '';
		inst.debug.styleBg = -1; inst.debug.styleFg = -1;
		inst.debug.styleT = -1; inst.debug.styleCls = '';
	}
	inst.use = function(sub) { inst.subs.push(sub); return sub; };
	inst.use({ measure: wagonsMeasure, frame: wagonsFrame, off: wagonsOff });
	inst.use({ measure: styleMeasure, frame: styleFrame, off: styleOff });
	inst.use({ measure: eventsMeasure, frame: eventsFrame });

	function coreFrame(sY, vh, vw) {
		if (inst.destroyed || !inst.enabled) return;
		const subs = inst.subs;
		for (let i = 0; i < subs.length; i++) subs[i].frame(sY, vh, vw);
		if (inst.onFrame) inst.onFrame(inst);
	}
	inst.refresh = function(replay) {
		if (inst.destroyed || !hasDOM) return;
		measureViewport();
		inst.stamp++;
		const subs = inst.subs;
		for (let i = 0; i < subs.length; i++) subs[i].measure(replay);
		coreFrame(window.scrollY || 0, vp.height, vp.width);
	};
	/* step() defaults reuse the cached viewport, so a gesture-triggered manual
	   frame uses the same numbers as the scroll-driven one. */
	inst.step = function(sY, vh, vw) {
		if (inst.destroyed) return;
		if (sY === undefined) sY = hasDOM ? window.scrollY || 0 : 0;
		if (vh === undefined) vh = vp.height;
		if (vw === undefined) vw = vp.width;
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
			for (let s = inst.subs.length - 1; s >= 0; s--)
				if (inst.subs[s].off) inst.subs[s].off();
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
			for (let s = inst.subs.length - 1; s >= 0; s--)
				if (inst.subs[s].off) inst.subs[s].off();
		}
	};
	/* scroll, not only resize: a mobile URL-bar show/hide changes the
	   viewport without ever firing resize. */
	function onScroll() {
		measureViewport();
		coreFrame(window.scrollY || 0, vp.height, vp.width);
	}
	function onResize() { inst.refresh(); }
	if (hasDOM) {
		measureViewport();
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
	version: '0.5.5',
	chain: chain,
	stickyShown: stickyShown,
	dirCode: dirCode,
	eventCode: eventCode,
	parseGap: parseGap,
	parseSize: parseSize,
	parseColor: parseColor,
	num255: num255,
	mixLin: mixLin,
	mixA: mixA
};
Snowfall.use = function(s) { return Snowfall.default.use(s); };
Snowfall.refresh = function(replay) { if (Snowfall.default) Snowfall.default.refresh(replay); };
Snowfall.step = function(a, b, c) { if (Snowfall.default) Snowfall.default.step(a, b, c); };
Snowfall.anchorY = function(el) { return Snowfall.default ? Snowfall.default.anchorY(el) : 0; };
Snowfall.setEnabled = function(on) { if (Snowfall.default) Snowfall.default.setEnabled(on); };
Object.defineProperty(Snowfall, 'wagons', { get: function() { return Snowfall.default ? Snowfall.default.wagons : undefined; } });
Object.defineProperty(Snowfall, 'viewport', { get: function() { return Snowfall.default ? Snowfall.default.viewport : undefined; } });
Object.defineProperty(Snowfall, 'morph', { get: function() { return Snowfall.default ? Snowfall.default.morph : undefined; } });
Object.defineProperty(Snowfall, 'events', { get: function() { return Snowfall.default ? Snowfall.default.events : undefined; } });
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
