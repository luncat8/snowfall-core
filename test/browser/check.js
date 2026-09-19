#!/usr/bin/env node
/* test/browser/check.js — real-browser proof of the 0.5.5 region sizing.
   Renders scene1.html (one cover wagon with an HD region), scene2.html (two,
   screen flow) and scene1-head.html (scripts loaded from <head>, where
   document.body is still null at parse time), parks each wagon at a
   1440×900 viewport and compares the PAINTED rects against:
     1. HDRegion.finalLayout computed here in node (separate process), and
     2. math-free invariants: aspect kept, max size (the crop touches the
        window on its limiting axis), region inside the window, base covers
        whenever it can, parked wagon box == viewport.
   Serves the repo itself on an ephemeral port. Needs puppeteer + a Chromium
   binary (executablePath /tmp/chromium or CHROME_PATH); when the toolchain
   is absent the gate prints SKIP and exits 0, so `node test/run.js` can
   include it unconditionally. */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');

let puppeteer = null;
try { puppeteer = require('puppeteer'); } catch (e1) {
	try { puppeteer = require('/tmp/browsertest/node_modules/puppeteer'); } catch (e2) { puppeteer = null; }
}
if (!puppeteer) { console.log('browser/check: SKIP — puppeteer not installed'); process.exit(0); }

const ROOT = path.join(__dirname, '..', '..');
const HD = require(path.join(ROOT, 'hdregion.js'));
const exe = ['/tmp/chromium', process.env.CHROME_PATH].filter(Boolean).find(p => fs.existsSync(p));
if (!exe) { console.log('browser/check: SKIP — no Chromium binary (set CHROME_PATH or extract /tmp/chromium)'); process.exit(0); }

const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', avif: 'image/avif', png: 'image/png', svg: 'image/svg+xml' };
function serve() {
	const srv = http.createServer((req, res) => {
		const p = decodeURIComponent((req.url || '/').split('?')[0]);
		const file = path.normalize(path.join(ROOT, p));
		if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
		fs.readFile(file, (e, buf) => {
			if (e) { res.writeHead(404); res.end(); return; }
			res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).slice(1)] || 'application/octet-stream' });
			res.end(buf);
		});
	});
	return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

const VW = 1440, VH = 900;
const SCENES = {
	1: [{ src: '../../img/1.avif', x: 477, y: 239, w: 804, h: 1056 }],
	2: [{ src: '../../img/1.avif', x: 477, y: 239, w: 804, h: 1056 },
	    { src: '../../img/3.avif', x: 476, y: 101, w: 1016, h: 900 }]
};

let checks = 0, fails = 0;
function ok(cond, name, detail) {
	checks++;
	if (!cond) { fails++; console.log('FAIL  ' + name + (detail ? '  — ' + detail : '')); }
	else console.log('ok    ' + name);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

async function settle(page, n) {
	await page.waitForFunction(N => {
		const S = window.Snowfall, A = window.SnowfallRegion;
		if (!S || !S.wagons || S.wagons.n !== N || !A || A.count() !== N) return false;
		const hd = A.arrays().hd;
		for (let i = 0; i < N; i++) if (!hd[i] || hd[i].style.display === 'none' || !hd[i].style.width) return false;
		return true;
	}, { timeout: 15000 }, n);
	await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
async function park(page, i) {
	const y = await page.evaluate(idx => Math.round(window.Snowfall.wagons.y[idx]) + 1, i);
	await page.evaluate(yy => window.scrollTo(0, yy), y);
	await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
	const st = await page.evaluate(idx => {
		const W = window.Snowfall.wagons;
		return { pos: W.pos[idx], free: W.free[idx] };
	}, i);
	if (!(st.pos === 0 && st.free <= 0)) throw new Error('wagon ' + i + ' did not park (pos ' + st.pos + ', free ' + st.free + ')');
}
async function snap(page, i) {
	return page.evaluate(idx => {
		const A = window.SnowfallRegion, W = window.Snowfall.wagons;
		const r = el => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
		const arr = A.arrays();
		const b = arr.base[idx], h = arr.hd[idx];
		return {
			vp: JSON.parse(JSON.stringify(window.Snowfall.viewport)),
			wagon: r(W.els[idx]), wagonTransform: W.els[idx].style.transform,
			base: r(b), baseStyle: { width: b.style.width, height: b.style.height, transform: b.style.transform },
			hd: r(h), hdStyle: { width: h.style.width, height: h.style.height, transform: h.style.transform, display: h.style.display },
			nb: { w: b.naturalWidth, h: b.naturalHeight }, nh: { w: h.naturalWidth, h: h.naturalHeight },
			view: A.view(idx)
		};
	}, i);
}
function verify(label, g, entry) {
	/* expected layout from the SAME math the page calls, computed in node */
	const exp = HD.finalLayout(g.vp.width, g.vp.height, g.nb.w, g.nb.h,
		{ x: entry.x, y: entry.y, w: entry.w, h: entry.h, maxZoom: 0 },
		{ zoom: 1, panX: 0, panY: 0 }, {});
	const fmt = r => Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.w) + 'x' + Math.round(r.h);
	/* 0 · the parked wagon box IS the viewport — premise of the whole contract */
	ok(near(g.wagon.x, 0, 2) && near(g.wagon.y, 0, 2) && near(g.wagon.w, g.vp.width, 2) && near(g.wagon.h, g.vp.height, 2),
		label + ': parked wagon box == viewport', fmt(g.wagon) + ' vs ' + g.vp.width + 'x' + g.vp.height);
	/* 1 · painted rects == HDRegion box (base ±1.5px, crop ±1.5px) */
	ok(near(g.base.w, exp.w, 1.5) && near(g.base.h, exp.h, 1.5) && near(g.base.x, exp.x, 1.5) && near(g.base.y, exp.y, 1.5),
		label + ': base rect == HDRegion.finalLayout', fmt(g.base) + ' vs ' + fmt(exp));
	const crop = { x: exp.hx, y: exp.hy, w: exp.hw, h: exp.hh };
	ok(near(g.hd.w, crop.w, 1.5) && near(g.hd.h, crop.h, 1.5) && near(g.hd.x, crop.x, 1.5) && near(g.hd.y, crop.y, 1.5),
		label + ': HD crop rect == HDRegion region box', fmt(g.hd) + ' vs ' + fmt(crop));
	/* 2 · math-free invariants */
	const wantAspect = entry.w / entry.h, gotAspect = g.hd.w / g.hd.h;
	ok(near(gotAspect, wantAspect, 1e-3), label + ': crop keeps the region aspect',
		gotAspect.toFixed(4) + ' vs ' + wantAspect.toFixed(4));
	const sFit = Math.min(g.vp.width / entry.w, g.vp.height / entry.h);
	ok(near(g.hd.w, entry.w * sFit, 1.5) && near(g.hd.h, entry.h * sFit, 1.5),
		label + ': crop at MAX size inside the window (fit scale ' + sFit.toFixed(4) + ')',
		Math.round(g.hd.w) + 'x' + Math.round(g.hd.h) + ' vs ' + Math.round(entry.w * sFit) + 'x' + Math.round(entry.h * sFit));
	ok(near(g.hd.w, g.vp.width, 1.5) || near(g.hd.h, g.vp.height, 1.5),
		label + ': crop touches the window on its limiting axis');
	ok(g.hd.x >= -1.5 && g.hd.y >= -1.5 && g.hd.x + g.hd.w <= g.vp.width + 1.5 && g.hd.y + g.hd.h <= g.vp.height + 1.5,
		label + ': region fully inside the window at rest');
	if (g.nb.w * sFit >= g.vp.width) ok(g.base.x <= 1.5 && g.base.x + g.base.w >= g.vp.width - 1.5, label + ': base covers x');
	if (g.nb.h * sFit >= g.vp.height) ok(g.base.y <= 1.5 && g.base.y + g.base.h >= g.vp.height - 1.5, label + ': base covers y');
	/* 3 · the crop is 1:1 with its rect, so the fit is its native density */
	ok(near(g.nh.w, entry.w, 1) && near(g.nh.h, entry.h, 1), label + ': crop file is 1:1 with the rect',
		g.nh.w + 'x' + g.nh.h + ' vs ' + entry.w + 'x' + entry.h);
	return { crop: fmt(g.hd), base: fmt(g.base) };
}

(async () => {
	let browser;
	try {
		browser = await puppeteer.launch({
			executablePath: exe,
			headless: 'new',
			env: Object.assign({}, process.env,
				fs.existsSync('/tmp/al2023/x/lib') ? { LD_LIBRARY_PATH: '/tmp/al2023/x/lib' + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '') } : {}),
			args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1', '--hide-scrollbars']
		});
	} catch (e) {
		console.log('browser/check: SKIP — Chromium did not launch (' + String(e.message).split('\n')[0] + ')');
		process.exit(0);
	}
	const srv = await serve();
	const BASE = 'http://127.0.0.1:' + srv.address().port;
	const page = await browser.newPage();
	await page.setViewport({ width: VW, height: VH });
	const errors = [];
	page.on('pageerror', e => errors.push(String(e)));
	page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

	/* ---- scene 1: one background ---- */
	await page.goto(BASE + '/test/browser/scene1.html', { waitUntil: 'load' });
	await settle(page, 1);
	await park(page, 0);
	const g1 = await snap(page, 0);
	console.log('--- scene 1 · single cover wagon parked (viewport ' + g1.vp.width + 'x' + g1.vp.height + ') ---');
	const r1 = verify('scene1/bg1', g1, SCENES[1][0]);

	/* ---- scene 2: two backgrounds ---- */
	await page.goto(BASE + '/test/browser/scene2.html', { waitUntil: 'load' });
	await settle(page, 2);
	await park(page, 0);
	const g2a = await snap(page, 0);
	console.log('--- scene 2 · wagon 1 parked ---');
	const r2a = verify('scene2/bg1 parked', g2a, SCENES[2][0]);
	ok(r2a.crop === r1.crop && r2a.base === r1.base,
		'scene2/bg1 identical to scene1/bg1', 'bg1 ' + r2a.crop + ' vs scene1 ' + r1.crop);

	await park(page, 1);
	const g2b0 = await snap(page, 0);
	const g2b1 = await snap(page, 1);
	console.log('--- scene 2 · wagon 2 parked (wagon 1 pushed off) ---');
	verify('scene2/bg2 parked', g2b1, SCENES[2][1]);
	ok(g2b0.baseStyle.width === g2a.baseStyle.width && g2b0.baseStyle.transform === g2a.baseStyle.transform
		&& g2b0.hdStyle.width === g2a.hdStyle.width && g2b0.hdStyle.transform === g2a.hdStyle.transform,
		'scene2/bg1 keeps its size after bg2 parks',
		'bg1 crop ' + g2b0.hdStyle.width + 'x' + g2b0.hdStyle.height + ' unchanged after bg2 parked');

	/* ---- scene 1 head-loaded: classic scripts in <head> run while
	   document.body is null — the adapter must still export its API,
	   build its HUD at DOMContentLoaded and size the wagon ---- */
	errors.length = 0;
	await page.goto(BASE + '/test/browser/scene1-head.html', { waitUntil: 'load' });
	await settle(page, 1);
	await park(page, 0);
	const g3 = await snap(page, 0);
	console.log('--- scene 1 head-loaded · wagon parked ---');
	const r3 = verify('scene1-head/bg1', g3, SCENES[1][0]);
	const hudOk = await page.evaluate(() => !!document.querySelector('.snow-region-hud'));
	ok(hudOk, 'scene1-head: HUD built at DOMContentLoaded');
	ok(r3.crop === r1.crop && r3.base === r1.base, 'scene1-head identical to scene1',
		r3.crop + ' vs ' + r1.crop);

	await require('./harness.js')(page, BASE, ok);
	await require('./diagnostics.js')(page, BASE, ok);

	if (errors.length) { for (const e of errors) { fails++; checks++; console.log('FAIL  page error — ' + e.split('\n')[0]); } }
	await browser.close();
	srv.close();
	console.log(fails ? '\n' + fails + ' of ' + checks + ' checks FAILED' : '\nall ' + checks + ' browser checks green');
	process.exit(fails ? 1 : 0);
})().catch(e => { console.error('QA run error:', e); process.exit(1); });
