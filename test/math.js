#!/usr/bin/env node
/* test/math.js — pure engine math gate (0.2–0.4 exports + the 0.5.5 clamp
	simulation). No DOM, zero deps; run directly or via `node test/run.js`. */
'use strict';
const S = require('../snowfall.js');

let checks = 0, fails = 0;
function ok(cond, name) {
	checks++;
	if (cond) return;
	fails++;
	console.error('FAIL ' + name);
}
function near(a, b, tol, name) { ok(Math.abs(a - b) <= tol, name + ' (' + a + ' vs ' + b + ')'); }
function eq(a, b, name) { ok(a === b, name + ' (' + a + ' vs ' + b + ')'); }

function rng32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0; a = a + 0x6D2B79F5 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}

/* ---------------- chain ---------------- */
{
	const p = [0, 0, 0];
	S.chain(0, [], [], p);
	ok(p[0] === 0, 'chain n=0 untouched');
	const free = new Float64Array([5, -3, -10]);
	const ext = new Float64Array([4, 6, 2]);
	const pos = new Float64Array(3);
	S.chain(3, free, ext, pos);
	eq(pos[2], 0, 'chain last parks');
	eq(pos[1], Math.min(0, -6), 'chain ceiling pushes');
	eq(pos[0], -6 - 4, 'chain propagates');
	const rnd = rng32(0x5EED);
	let broke = 0;
	for (let t = 0; t < 5000; t++) {
		const n = 1 + (t % 5);
		const f = new Float64Array(n), e = new Float64Array(n), q = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			f[i] = rnd() * 4000 - 2000;
			e[i] = 1 + rnd() * 900;
		}
		S.chain(n, f, e, q);
		for (let i = 0; i < n; i++) if (q[i] > (f[i] > 0 ? f[i] : 0) + 1e-9) broke++;
		for (let i = 0; i < n - 1; i++) if (q[i] + e[i] > q[i + 1] + 1e-9) broke++;
	}
	eq(broke, 0, 'chain: ≤ park and no-overlap over 5000 random layouts');
}

/* ---------------- stickyShown mirror ---------------- */
{
	eq(S.stickyShown(10, 900, 5000, 1000, -890), 10, 'sticky rides at flow');
	eq(S.stickyShown(-5, 900, 5000, 1000, -890), 0, 'sticky parks at 0');
	eq(S.stickyShown(-5, 900, 5, 1000, -890), 5 - 900 + 890, 'sticky caps at parent bottom');
	eq(S.stickyShown(50, 2000, 800, 300, -1900), 50, 'taller-than-parent still parks (no shortcut)');
}

/* ---------------- parse helpers ---------------- */
{
	eq(S.parseGap(undefined, 900, 16), 0, 'gap none');
	eq(S.parseGap('60vh', 900, 16), 540, 'gap vh');
	eq(S.parseGap('120px', 900, 16), 120, 'gap px');
	eq(S.parseGap('4rem', 900, 16), 64, 'gap rem');
	eq(S.parseGap('-10px', 900, 16), 0, 'gap negative clamps to 0');
	eq(S.parseGap('junk', 900, 16), 0, 'gap junk → 0');
	const a = S.parseSize({ size: '800x600' }); eq(a[0], 800, 'size w'); eq(a[1], 600, 'size h');
	const b = S.parseSize({ w: '256' }); eq(b[0], 256, 'size w attr'); eq(b[1], 256, 'size h fallback');
	const c = S.parseSize({}); eq(c[0], 512, 'size default 512 first'); eq(c[1], 512, 'size default 512 second');
	eq(S.dirCode('left'), 1, 'dir left'); eq(S.dirCode('right'), 2, 'dir right');
	eq(S.dirCode('bottom'), 3, 'dir bottom'); eq(S.dirCode('top'), 0, 'dir top'); eq(S.dirCode('x'), 0, 'dir junk');
	eq(S.eventCode('view'), 0, 'ev view'); eq(S.eventCode('center'), 1, 'ev center');
	eq(S.eventCode('parked'), 2, 'ev parked'); eq(S.eventCode('end'), 3, 'ev end');
	eq(S.eventCode('skip'), 4, 'ev skip'); eq(S.eventCode('nope'), -1, 'ev junk');
}

/* ---------------- colour math ---------------- */
{
	eq(S.num255('50%', false), 128, 'num255 percent rounds');
	eq(S.num255('-5', false), 0, 'num255 clamps low');
	eq(S.num255('999', false), 255, 'num255 clamps high');
	eq(S.num255('0.5', true), 128, 'num255 alpha scales');
	const h = S.parseColor('#0f1c38'); eq(h[0], 0x0f, 'hex r'); eq(h[3], 255, 'hex opaque alpha');
	const e8 = S.parseColor('rgb(1 2 3)'); eq(e8[0], 1, 'space syntax'); eq(e8[2], 3, 'space syntax b');
	const sl = S.parseColor('rgba(1, 2, 3, .5)'); eq(sl[3], Math.round(0.5 * 255), 'alpha fraction');
	eq(S.parseColor('linear-gradient(red, blue)'), null, 'token is null');
	eq(S.parseColor(''), null, 'empty is null');
	/* exact sRGB round-trip over all 256 values (findings gate) */
	let bad = 0;
	for (let v = 0; v < 256; v++) {
		const mid = S.mixLin(v, v, 0.5);
		if (mid !== v) bad++;
	}
	eq(bad, 0, 'LUT round-trip exact for all 256');
	eq(S.mixLin(0, 255, 0), 0, 'mixLin t=0 exact');
	eq(S.mixLin(0, 255, 1), 255, 'mixLin t=1 exact');
	const m = S.mixLin(0, 255, 0.5);
	ok(m > 150 && m < 200, 'mixLin is linear-light (got ' + m + ')');
	eq(S.mixA(10, 20, 0.5), 15, 'mixA mid');
	eq(S.mixA(10, 20, 2), 20, 'mixA clamps past end');
}

/* ---------------- 0.5.5 pos-clamp simulation ----------------
	Rebuilds wagonsFrame's exact math (chain + clamp + stickyShown + exit
	projections) over layouts and full scroll ranges. Proves the finite-scroll
	theorem AND that the gate fails without the clamp. */
function simFrame(L, sY, clampOn) {
	const n = L.y.length;
	const free = new Float64Array(n), pos = new Float64Array(n);
	for (let i = 0; i < n; i++) free[i] = L.y[i] - sY;
	S.chain(n, free, L.ext, pos);
	const out = [];
	for (let i = 0; i < n; i++) {
		const fr = free[i], e = L.ext[i];
		const park = fr > 0 ? fr : 0;
		let p = pos[i];
		if (clampOn) {
			const cap = L.pBot[i] - sY - e - L.mb[i];
			if (p > cap) p = cap;
		}
		const sh = S.stickyShown(fr, e, L.pBot[i] - sY, L.pH[i], L.mb[i]);
		const dir = L.dir[i] || 0;
		let dx = 0, dy = p - sh;
		if (dir === 1 || dir === 2) {
			const dp = p < 0 ? -p : 0;
			dx = (dir === 1 ? -1 : 1) * (dp / e) * L.vw;
			dy = (p > 0 ? p : 0) - sh;
		} else if (dir === 3) dy = (p > 0 ? p : -p) - sh;
		out.push({ p: p, dy: dy, visualY: sh + dy, visualX: dx });
	}
	return out;
}
function layout(y, ext, pBot, gap, dir) {
	return {
		y: y, ext: ext, pBot: pBot, pH: pBot.map(() => 9999),
		mb: gap.map((g, i) => g - ext[i]),
		dir: dir, vw: 1440, vh: 900
	};
}
function scan(L, name, expectClamped) {
	const n = L.y.length;
	const maxExt = L.ext.reduce((a, b) => a + b, 0);
	/* bound on any legitimate push: the whole chain depth + parent spread —
	   a constant of the layout, independent of sY */
	const spread = Math.max.apply(null, L.pBot) - Math.min.apply(null, L.y);
	const bound = maxExt + spread + maxExt + 1;
	const step = 997;
	const deepFrom = Math.max.apply(null, L.pBot);
	let prev = null, dyAt = null, dyBase = 2 * deepFrom;
	let everOut = new Uint8Array(n), reentered = 0, velBad = 0, dyMax = 0;
	for (let sY = 0; sY <= 100000; sY += step) {
		const cur = simFrame(L, sY, expectClamped);
		for (let i = 0; i < n; i++) {
			const st = cur[i], dir = L.dir[i] || 0;
			if (dir === 0) {
				dyMax = Math.max(dyMax, Math.abs(st.dy));
				ok(Math.abs(st.dy) <= bound + 1e-6, name + ' dy bounded (i' + i + ')');
			}
			if (prev) {
				const dvy = Math.abs(st.visualY - prev[i].visualY);
				const dvx = Math.abs(st.visualX - prev[i].visualX);
				if (dvy > step + 1e-6) velBad++;
				if ((dir === 1 || dir === 2) && dvx > step * (L.vw / L.ext[i]) + 1e-6) velBad++;
			}
			/* out-of-viewport lockout once every parent has passed */
			if (sY > deepFrom) {
				const vIn = st.visualY > -1e-6 && st.visualY < L.vh;
				const hIn = Math.abs(st.visualX) < L.vw - 1e-6;
				const visible = (dir === 1 || dir === 2) ? (vIn && hIn) : vIn;
				if (visible && everOut[i]) reentered++;
				everOut[i] = 1;
			}
		}
		/* deep-scroll dy convergence for top exits: constant from here on */
		if (!dyAt && sY >= dyBase) dyAt = cur.map(c => c.dy);
		else if (dyAt) for (let i = 0; i < n; i++) {
			if ((L.dir[i] || 0) === 0) eq(cur[i].dy, dyAt[i], name + ' dy constant deep (i' + i + ' @' + sY + ')');
		}
		prev = cur;
	}
	eq(velBad, 0, name + ' visual velocity ≤ scroll delta');
	eq(reentered, 0, name + ' no wagon re-enters the viewport past its parent');
	return { dyMax: dyMax };
}
{
	const flat = layout([1000, 2800], [900, 900], [3900, 3900], [0, 0], [0, 0]);
	const res = scan(flat, 'flat clamp', true);
	eq(res.dyMax <= 900 + 1e-6 ? 0 : res.dyMax, 0, 'flat top-exit |dy| ≤ one ext');
	/* the unclamped control MUST fail: dy grows linearly past every bound */
	const bad = simFrame(flat, 90000, false);
	ok(Math.abs(bad[1].dy) > 10000, 'clamp gate proves it fails (runaway dy ' + bad[1].dy + ' unclamped)');
	const good = simFrame(flat, 90000, true);
	eq(good[1].dy, 0, 'deep-scroll dy converges to 0 (clamped)');
	const nested = layout([1000, 2800], [900, 900], [1900, 3900], [0, 0], [0, 0]);
	scan(nested, 'nested clamp', true);
	const containing = layout([1000, 2800], [900, 900], [5000, 3900], [0, 0], [0, 0]);
	scan(containing, 'containing clamp', true);
	const exits = layout([1000, 2800, 4600], [900, 900, 900], [3900, 3900, 5700], [0, 0, 0], [1, 3, 2]);
	scan(exits, 'mixed-exits clamp', true);
	const gapped = layout([1000, 2800, 4600], [900, 900, 900], [3900, 3900, 5700], [540, 540, 0], [0, 0, 0]);
	scan(gapped, 'gapped clamp', true);
}

console.log('math: ' + (checks - fails) + '/' + checks + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
