/* test/math.js — pure-math gate for snowfall.js: chain, stickyShown, the 0.5.5
   parent-bottom pos clamp, gap/size parsing, colour parsing and linear-light
   mixing, direction/event codes. Zero DOM, zero dependencies.
   node test/math.js  (or via test/run.js) — exit 0 = green. */
'use strict';

const SF = require('../snowfall.js');

let fails = 0, checks = 0;
function ok(cond, msg) {
	checks++;
	if (!cond) { fails++; console.log('FAIL: ' + msg); }
}
function near(a, b, eps, msg) { ok(Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps), msg + ' (got ' + a + ', want ' + b + ')'); }

/* ---------------- chain ---------------- */
{
	const free = [0, 0], ext = [900, 900], pos = [0, 0];
	SF.chain(1, [300], [900], pos);
	ok(pos[0] === 300, 'chain: single wagon rides its free offset');
	SF.chain(1, [-300], [900], pos);
	ok(pos[0] === 0, 'chain: single wagon parks at 0, never negative');
	/* last wagon clamps to >= 0, earlier wagons take min(park, pos[i+1] - ext[i]) */
	free[0] = -100; free[1] = -5000;
	SF.chain(2, free, ext, pos);
	ok(pos[1] === 0, 'chain: last wagon floors at 0 past the top');
	ok(pos[0] === -900, 'chain: push propagates one ext deep (got ' + pos[0] + ')');
	free[0] = 400; free[1] = 1200;
	SF.chain(2, free, ext, pos);
	ok(pos[1] === 1200 && pos[0] === 300, 'chain: ceiling pos[i+1]-ext[i] pulls the upper wagon down');
	free[0] = 400; free[1] = 2000;
	SF.chain(2, free, ext, pos);
	ok(pos[0] === 400, 'chain: a distant wagon below does not constrain (park wins)');
	ok(SF.chain(0, [], [], []) !== undefined, 'chain: n=0 is a no-op');
}

/* ---------------- stickyShown (CSS mirror) ---------------- */
{
	ok(SF.stickyShown(300, 900, 5000, 6000, 0) === 300, 'stickyShown: riding = free');
	ok(SF.stickyShown(-100, 900, 5000, 6000, 0) === 0, 'stickyShown: parked = 0');
	ok(SF.stickyShown(-100, 900, 800, 6000, 0) === -100, 'stickyShown: parent bottom caps to pBotC-ext-mb');
	/* gap < ext gives mb < 0: the margin box is shorter than the border box, so
	   the border box may hang ext+mb past the content bottom — cap shifts UP */
	ok(SF.stickyShown(-100, 900, 800, 6000, -900) === 0, 'stickyShown: negative marginBottom lifts a near cap out of the way');
	ok(SF.stickyShown(-100, 900, -500, 6000, -900) === -500, 'stickyShown: negative marginBottom shifts the binding cap up by |mb|');
	/* a wagon taller than its parent still parks while the parent is visible */
	ok(SF.stickyShown(-100, 2000, 3000, 1000, 0) === 0, 'stickyShown: tall wagon parks at 0 (no ext>=pH shortcut)');
	ok(SF.stickyShown(-100, 2000, 1500, 1000, 0) === -500, 'stickyShown: tall wagon releases to the cap');
}

/* ---------------- dirCode / eventCode ---------------- */
{
	ok(SF.dirCode('left') === 1 && SF.dirCode('right') === 2 && SF.dirCode('bottom') === 3 && SF.dirCode('top') === 0 && SF.dirCode('') === 0, 'dirCode map');
	ok(SF.eventCode('view') === 0 && SF.eventCode('center') === 1 && SF.eventCode('parked') === 2 && SF.eventCode('end') === 3 && SF.eventCode('skip') === 4 && SF.eventCode('nope') === -1, 'eventCode map');
}

/* ---------------- parseGap / parseSize ---------------- */
{
	ok(SF.parseGap(undefined, 900, 16) === 0, 'parseGap: missing = 0');
	ok(SF.parseGap('100vh', 900, 16) === 900, 'parseGap: vh units');
	ok(SF.parseGap('4rem', 900, 16) === 64, 'parseGap: rem units');
	ok(SF.parseGap('120px', 900, 16) === 120, 'parseGap: px units');
	ok(SF.parseGap('-30px', 900, 16) === 0, 'parseGap: negative floors at 0');
	ok(SF.parseGap('garbage', 900, 16) === 0, 'parseGap: garbage = 0');
	let s = SF.parseSize({ size: '800x600' });
	ok(s[0] === 800 && s[1] === 600, 'parseSize: WxH');
	s = SF.parseSize({ size: '512' });
	ok(s[0] === 512 && s[1] === 512, 'parseSize: square');
	s = SF.parseSize({ w: '300', h: '200' });
	ok(s[0] === 300 && s[1] === 200, 'parseSize: w/h attrs');
	s = SF.parseSize({});
	ok(s[0] === 512 && s[1] === 512, 'parseSize: default 512');
}

/* ---------------- colour parsing + linear-light mixing ---------------- */
{
	let c = SF.parseColor('#abc');
	ok(c && c[0] === 170 && c[1] === 187 && c[2] === 204 && c[3] === 255, 'parseColor: #rgb expands');
	c = SF.parseColor('#11223344');
	ok(c && c[0] === 17 && c[3] === 68, 'parseColor: #rrggbbaa');
	c = SF.parseColor('rgba(10, 20, 30, 0.5)');
	ok(c && c[0] === 10 && c[3] === 128, 'parseColor: rgba comma, 0-1 alpha');
	c = SF.parseColor('rgb(10 20 30 / 50%)');
	ok(c && c[3] === 128, 'parseColor: space+slash, % alpha');
	c = SF.parseColor('rgb(300, -5, 0)');
	ok(c && c[0] === 255 && c[1] === 0, 'parseColor: out-of-range clamps');
	ok(SF.parseColor('linear-gradient(red,blue)') === null, 'parseColor: gradient is a token (null)');
	ok(SF.parseColor('night') === null, 'parseColor: named colour is a token (null)');
	ok(SF.parseColor('') === null && SF.parseColor(undefined) === null, 'parseColor: empty = null');
	ok(SF.num255('50%') === 128 && SF.num255('300') === 255 && SF.num255('-4') === 0 && SF.num255('x') === null, 'num255 edges');
	/* ends exact, midpoint in linear light (NOT the sRGB mean), monotone */
	ok(SF.mixLin(10, 200, 0) === 10 && SF.mixLin(10, 200, 1) === 200, 'mixLin: ends exact');
	ok(SF.mixLin(0, 255, 0.5) > 128 && SF.mixLin(0, 255, 0.5) < 190, 'mixLin: linear-light midpoint above sRGB mean');
	let mono = true;
	for (let t = 0; t < 1; t += 0.01) if (SF.mixLin(0, 255, t + 0.01) < SF.mixLin(0, 255, t)) mono = false;
	ok(mono, 'mixLin: monotone');
	/* LUT round-trip gate: sRGB→linear→sRGB must be exact for all 256 inputs.
	   mixLin(v,v,t) runs the full S2L→L2S path, so this proves the 4096-entry
	   table (a 256-entry table quantises the dark end to ±6 steps). */
	let rt = 0;
	for (let v = 0; v < 256; v++) if (SF.mixLin(v, v, 0.5) !== v) rt++;
	ok(rt === 0, 'mixLin: round-trip exact for all 256 values (' + rt + ' bad)');
	ok(SF.mixA(0, 255, 0.5) === 128 && SF.mixA(10, 20, 0) === 10 && SF.mixA(10, 20, 1) === 20, 'mixA: ends + midpoint');
}

/* ---------------- pos clamp: the scroll range stays finite ----------------
   Two-wagon page-span layout (both direct children of one parent, content
   bottom 4860): without the clamp, once the parent scrolls past the viewport
   the chain leaves pos parked while stickyShown's cap goes to −∞, so
   dy = pos − sh grows linearly — the wagon is translated back ONTO the screen
   and the page never ends. With `pos = min(chainPos, pBot − sY − ext − mb)`
   dy converges to 0 and |dy| stays bounded by ext. Mirrors wagonsFrame. */
{
	const n = 2;
	const y = [720, 2340], ext = [900, 900], mb = [0, 0];
	const pBot = [4860, 4860], pH = [4860, 4860];
	const free = new Array(n), pos = new Array(n);
	let maxDy = -Infinity, minDy = Infinity, maxDyRaw = -Infinity, pastDy = 0;
	for (let sY = 0; sY <= 100000; sY += 10) {
		for (let i = 0; i < n; i++) free[i] = y[i] - sY;
		SF.chain(n, free, ext, pos);
		for (let i = 0; i < n; i++) {
			const sh = SF.stickyShown(free[i], ext[i], pBot[i] - sY, pH[i], mb[i]);
			maxDyRaw = Math.max(maxDyRaw, pos[i] - sh);
			const cap = pBot[i] - sY - ext[i] - mb[i];
			if (pos[i] > cap) pos[i] = cap;
			const dy = pos[i] - sh;
			if (dy > maxDy) maxDy = dy;
			if (dy < minDy) minDy = dy;
			if (sY >= 6000 && Math.abs(dy) > 1e-9) pastDy++;
		}
	}
	ok(maxDyRaw > 10000, 'clamp sim: the unclamped engine really diverges here (max dy ' + Math.round(maxDyRaw) + ') — gate can fail');
	ok(maxDy <= 1e-9, 'clamp sim: dy never positive — no pull-back onto the screen (max ' + maxDy + ')');
	ok(minDy >= -900 - 1e-9, 'clamp sim: |dy| bounded by ext (min ' + minDy + ')');
	ok(pastDy === 0, 'clamp sim: dy === 0 fully past the parent bottom');
	/* parked latch must read the PRE-clamp chain state: in a screen-flow chapter
	   (gap=100vh ⇒ ext=vh, mb=0, trigger at the section end ⇒ pBot ≈ anchor Y)
	   the cap equals d − vh, already negative while the trigger is visible — a
	   clamped `pos === 0` parked test could never fire there. */
	const vh = 900, aY = 3132, yW = 2000, pBotS = aY;
	let fired = 0, firedClamped = 0;
	for (let sY = yW; sY <= aY; sY++) {
		const d = aY - sY;
		if (d < 0 || d >= vh) continue;                 /* anchor visible */
		const raw = 0;                                  /* chain rest once sY >= yW and the wagon below is distant */
		const cap = pBotS - sY - vh - 0;                /* = d − vh, negative for every visible d < vh */
		if (raw === 0 && yW - sY <= 0) fired++;
		if (Math.min(raw, cap) === 0 && yW - sY <= 0) firedClamped++;
	}
	ok(fired > 0, 'clamp sim: pre-clamp parked latch fires while the trigger is visible');
	ok(firedClamped === 0, 'clamp sim: a clamped parked latch would be dead — events must read pre-clamp state');
}

module.exports = { run: function () { return fails; }, checks: function () { return checks; } };
if (require.main === module) {
	console.log('math: ' + (fails ? fails + ' FAILURES of ' + checks : 'PASS (' + checks + ' checks)'));
	process.exit(fails ? 1 : 0);
}
