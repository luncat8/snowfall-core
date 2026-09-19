/* test/region-art.js — the harness's region MATERIAL, in node.
Placement gates can only prove that layout agrees with layout; a page whose
generated art contradicts its own data passes every one of them and still looks
wrong. So this gate reads the numbers the harness actually ships: a crop is 1:1
with its rect (the reference's material rule — the fit scale is then also the
crop's native density), the base carries the smeared hole at exactly that rect,
both are drawn from ONE picture, the REGIONS key is the src the adapter will
look up, and the three data cases produce the markup each one claims. The
vendored real scenes are checked against their own bytes, so a fixture cannot
drift from the file it describes.

	Run: node test/region-art.js   (exit 0 = the material is consistent)
	   or: node test/run.js        (the pre-commit gate) */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const HD = require(path.join(root, 'hdregion.js'));
const src = fs.readFileSync(path.join(root, 'harness.js'), 'utf8');

function grab(name) {
	const i = src.search(new RegExp('^function ' + name + '\\(', 'm'));
	if (i < 0) throw new Error('harness.js: function not found: ' + name);
	let depth = 0;
	for (let k = src.indexOf('{', i); k < src.length; k++) {
		if (src[k] === '{') depth++;
		else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
	}
	throw new Error('harness.js: unbalanced body: ' + name);
}
/* a top-level `const X = …;` declaration, however many lines the literal takes */
function grabLine(prefix) {
	const i = src.search(new RegExp('^' + prefix, 'm'));
	if (i < 0) throw new Error('harness.js: not found: ' + prefix);
	const end = src.indexOf(';\n', i);
	return src.slice(i, end + 1);
}
/* the generator runs on the harness's own source, extracted verbatim */
const code = [grab('hash32'), grab('mulberry32'), grab('artURI'), grab('regionEntryCase'),
	grab('claimRealScene'), grab('regionWagonInner'), grabLine('const REGION_BASE_W'),
	grabLine('const REAL_CLAIMED'), grabLine('const REAL_SCENES'),
	grabLine('const PALETTE =')].join('\n');
const box = {}, W = {};   /* W is the sandbox's window: the REGIONS table lands here */
const esc = t => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
new Function('escapeHTML', 'window', code
	+ '\nthis.gen = { inner: regionWagonInner, caseOf: regionEntryCase, pal: PALETTE[1], real: REAL_SCENES,'
	+ '\n	reset: () => { REAL_CLAIMED.length = 0; window.REGIONS = {}; } };'
	+ '\nthis.PAL_IS_OBJECT = !!PALETTE[1] && !!PALETTE[1].s;').call(box, esc, W);
if (!box.PAL_IS_OBJECT) throw new Error('PALETTE extraction failed');
const GEN = box.gen;

let checks = 0, fails = 0;
function ok(cond, msg) { checks++; if (cond) return true; if (fails < 10) console.error('FAIL ' + msg); fails++; return false; }
function eq(a, b, msg) { return ok(a === b, msg + ' (' + a + ' vs ' + b + ')'); }

/* decode a generated data: URI back into the SVG text it holds */
function svgOf(srcAttr) {
	const raw = srcAttr.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
	if (raw.indexOf('data:image/svg+xml,') !== 0) return null;
	return decodeURIComponent(raw.slice('data:image/svg+xml,'.length));
}
function numAttr(s, name) { const m = new RegExp(name + '="(-?[\\d.]+)"').exec(s); return m ? +m[1] : NaN; }
function table() { return W.REGIONS || {}; }   /* only exists once the generator ran */

function attrs(html) {
	const out = [];
	for (const m of html.matchAll(/<img src="([^"]+)"([^>]*)>/g)) out.push({ src: m[1], rest: m[2] });
	return out;
}

/* ---------------- 1 · generated pairs ---------------- */
GEN.reset();
for (let k = 0; k < 24; k++) {
	for (let j = 0; j < 3; j++) {
		const html = GEN.inner(k, j, GEN.pal, { src: 'generated' }, false);
		if (!html) continue;
		const caseOf = GEN.caseOf(k);
		const imgs = attrs(html);
		const tag = 'ch' + k + '·bg' + j;
		ok(imgs.length === (caseOf === 'none' ? 1 : 2), tag + ' child count for case ' + caseOf);
		const baseSvg = svgOf(imgs[0].src);
		ok(baseSvg !== null, tag + ' base is a data: URI');
		const entry = table()[HD.normKey(imgs[0].src)];
		if (caseOf === 'none') {
			ok(!entry, tag + ' none-case registers no entry');
			ok(!/viewBox="(?!0 0 )/.test(baseSvg), tag + ' none-case base is unshifted');
			ok(!/clip-path/.test(baseSvg), tag + ' none-case base has no hole (nothing covers it)');
			continue;
		}
		ok(!!entry, tag + ' entry keyed by the base src verbatim');
		if (!entry) continue;
		/* the rect: inside the base, and the base is the whole picture */
		ok(entry.x >= 0 && entry.y >= 0 && entry.x + entry.w <= entry.bw && entry.y + entry.h <= entry.bh,
			tag + ' rect inside the base');
		/* the base: whole canvas, hole exactly at the rect, smeared not black */
		ok(/viewBox="0 0 1600 1000"/.test(baseSvg), tag + ' base shows the whole canvas, unshifted');
		const clip = /<clipPath id="hp"><rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/.exec(baseSvg);
		ok(clip && +clip[1] === entry.x && +clip[2] === entry.y && +clip[3] === entry.w && +clip[4] === entry.h,
			tag + ' hole sits exactly on the rect');
		ok(/<use href="#a" clip-path="url\(#hp\)" filter="url\(#hq\)"/.test(baseSvg),
			tag + ' hole is a copy of the art smeared, not a patch');
		ok(/feGaussianBlur/.test(baseSvg) && /id="hq"/.test(baseSvg), tag + ' smear filter present');
		/* one picture: the crop shares the base's user space and its rhythm */
		const cropSrc = imgs.length > 1 ? imgs[1].src : entry.hd;
		const cropSvg = svgOf(cropSrc);
		ok(cropSvg !== null, tag + ' crop is a data: URI');
		const vb = /viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/.exec(cropSvg);
		ok(vb && +vb[1] === entry.x && +vb[2] === entry.y, tag + ' crop viewBox is the rect offset');
		ok(vb && +vb[3] === entry.w && +vb[4] === entry.h, tag + ' crop viewBox is the rect size');
		/* MATERIAL RULE: the crop is authored 1:1 with its rect, so the layout
		   fit scale is also the crop's own density — no 2× wishful thinking */
		ok(+numAttr(cropSvg, 'width') === entry.w && +numAttr(cropSvg, 'height') === entry.h,
			tag + ' crop is 1:1 with the rect');
		ok(/width="1600" height="1000" fill="url\(#b\)"/.test(cropSvg), tag + ' crop draws the base space, then crops it');
		const pb = /<pattern id="b" width="(\d+)" height="(\d+)"/;
		const patB = pb.exec(baseSvg), patC = pb.exec(cropSvg);
		ok(patB && patC && patB[1] === patC[1] && patB[2] === patC[2], tag + ' stripes are the same picture');
		const lbl = />([^<]*)<\/text>/;
		ok(lbl.exec(baseSvg) && lbl.exec(cropSvg) && lbl.exec(baseSvg)[1] === lbl.exec(cropSvg)[1],
			tag + ' both renders carry the same label');
		if (caseOf === 'nohd') {
			ok(!entry.hd, tag + ' nohd case declares no hd');
			ok(imgs.length === 2, tag + ' nohd case still ships the crop element');
			ok(!/display:none/.test(imgs[1].rest), tag + ' crop is NOT pre-hidden in markup — hiding is the adapter\'s job');
		} else {
			eq(entry.hd, cropSrc, tag + ' full case hd is the src in the markup');
		}
		checks++;
	}
}

/* ---------------- 2 · the key contract, including "never decode" ---------------- */
{
	const key = Object.keys(table())[0];
	ok(key.indexOf('data:') === 0, 'generated key is the bare data URI');
	ok(HD.normKey('./' + key) === key, 'normKey strips a leading ./ only');
	ok(HD.normKey(decodeURIComponent(key)) !== key, 'decoding the URI would break the lookup (the rule normKey exists for)');
	for (const suffix of ['?v=2', '#x', '?a=1#b', './']) {
		const probe = (suffix === './' ? './' : '') + key + (suffix === './' ? '' : suffix);
		ok(HD.normKey(probe) === key, 'normKey drops ' + suffix);
	}
}

/* ---------------- 3 · one base src, one wagon ----------------
   REGIONS is keyed by the base src, so two wagons on the same file cannot have
   two crops: the second registration re-rects the first, and the reader sees a
   crop over the wrong part of the picture. The generator must never do it —
   and this is the check that catches it, because both markup and table look
   internally consistent on their own. */
for (const real of [false, true]) {
	GEN.reset();
	const bases = [];
	for (let k = 1; k <= 12; k++) {
		for (let j = 0; j < 3; j++) {
			const html = GEN.inner(k, j, GEN.pal, { src: 'generated' }, real);
			for (const m of html.matchAll(/<img src="([^"]+)"/g)) { bases.push(m[1]); break; }
		}
	}
	const seen = {};
	let dupes = 0;
	for (const b of bases) { if (seen[b]) dupes++; else seen[b] = 1; }
	eq(dupes, 0, (real ? 'real' : 'generated') + ' mode: every region wagon has its own base src ('
		+ bases.length + ' wagons, ' + Object.keys(seen).length + ' keys)');
	ok(Object.keys(table()).length <= bases.length, (real ? 'real' : 'generated') + ' mode: no orphan entries');
	if (real) ok(Object.keys(seen).filter(k => k.indexOf('data:') !== 0).length <= GEN.real.length,
		'real files are mounted at most once each');
}

/* ---------------- 4 · the vendored real scenes agree with their bytes ---------------- */
const scenes = require(path.join(__dirname, 'vendor/regions-ref.js'));
for (const key of Object.keys(scenes)) {
	const e = scenes[key];
	for (const [f, w, h] of [[e.hd, 'hdW', 'hdH'], [key, 'imgW', 'imgH']]) {
		const p = path.join(root, f);
		if (!fs.existsSync(p)) { ok(false, 'vendored file missing: ' + f); continue; }
		const d = fs.readFileSync(p);
		let dims = null;
		if (f.endsWith('.avif')) {
			const i = d.indexOf('ispe');
			if (i > 0) dims = [d.readUInt32BE(i + 8), d.readUInt32BE(i + 12)];
		} else if (f.endsWith('.png')) dims = [d.readUInt32BE(16), d.readUInt32BE(20)];
		ok(dims && dims[0] === e[w] && dims[1] === e[h], f + ' is ' + (dims ? dims.join('×') : 'unreadable')
			+ ', the fixture says ' + e[w] + '×' + e[h]);
	}
	ok(e.w === e.hdW && e.h === e.hdH, key + ' real crop is 1:1 with its rect');
	ok(e.x + e.w <= e.imgW && e.y + e.h <= e.imgH, key + ' rect fits the shipped base image');
}
/* and the harness must mount each vendored file at most once: a second wagon on
   the same key would read the first one's rect. The rest fall through to
   generated art, so no region wagon is left without a picture. */
{
	GEN.reset();
	for (let k = 0; k < 8; k++) GEN.inner(k, 0, GEN.pal, { src: 'generated' }, true);
	const T = table();
	const realKeys = Object.keys(T).filter(k => k.indexOf('data:') !== 0);
	eq(realKeys.length, GEN.real.length, 'each real file is claimed by exactly one wagon (' + realKeys.length + ')');
	for (const key of realKeys) {
		const e = T[key];
		ok(fs.existsSync(path.join(root, key)), 'real base exists: ' + key);
		ok(!e.hd || fs.existsSync(path.join(root, e.hd)), 'real crop exists: ' + e.hd);
		ok(scenes[key] && scenes[key].x === e.x && scenes[key].w === e.w, key + ' harness rect = the reference rect');
	}
	ok(Object.keys(T).length > realKeys.length, 'unclaimed wagons fall through to generated art');
}

console.log('region-art: ' + (checks - fails) + '/' + checks + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
