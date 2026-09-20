/* Integration gate for the real editor, not just isolated region fixtures. */
'use strict';
const REF = require('../vendor/hdregion-ref.js');
const { pathToFileURL } = require('url');
const path = require('path');
const near = (a, b) => Math.abs(a - b) <= 1.5;
async function settled(page) {
	await page.evaluate(async () => {
		await document.fonts.ready;
		await Promise.all(Array.from(document.querySelectorAll('#app img'), img => img.decode()));
		Snowfall.refresh();
		await raf2();
	});
}
async function geometry(page, label, ok, canPark) {
	const n = await page.evaluate(() => SnowfallRegion.count());
	for (let i = 0; i < n; i++) {
		const g = await page.evaluate(async idx => {
			const A = SnowfallRegion.arrays(), W = Snowfall.wagons;
			setY(Math.ceil(W.y[A.wi[idx]]) + 2);
			await raf2();
			const rect = el => {
				const r = el.getBoundingClientRect();
				return { x: r.left, y: r.top, w: r.width, h: r.height };
			};
			const b = A.base[idx], h = A.hd[idx];
			return { vp: Snowfall.viewport, wagon: rect(A.els[idx]), base: rect(b), crop: h && rect(h),
				bw: b.naturalWidth, bh: b.naturalHeight, entry: REGIONS[HDRegion.normKey(b.getAttribute('src'))],
				shown: h && getComputedStyle(h).display !== 'none',
				parked: W.pos[A.wi[idx]] === 0 && W.free[A.wi[idx]] <= 0 };
		}, i);
		const e = g.entry && g.entry.hd ? g.entry : { x: 0, y: 0, w: g.bw, h: g.bh };
		const r = REF.finalLayout(g.vp.width, g.vp.height, g.bw, g.bh, e, { zoom: 1, x: 0, y: 0 }, {});
		const name = label + '/bg' + i;
		if (canPark) ok(g.parked && near(g.wagon.x, 0) && near(g.wagon.y, 0), name + ': has a park interval');
		ok(near(g.base.x - g.wagon.x, r.x) && near(g.base.y - g.wagon.y, r.y)
			&& near(g.base.w, r.w) && near(g.base.h, r.h), name + ': painted base matches pinned reference');
		if (!g.entry || !g.entry.hd) { ok(!g.shown, name + ': explicit fallback hides crop'); continue; }
		ok(g.shown && near(g.crop.x - g.wagon.x, r.x + e.x * r.s)
			&& near(g.crop.y - g.wagon.y, r.y + e.y * r.s)
			&& near(g.crop.w, e.w * r.s) && near(g.crop.h, e.h * r.s), name + ': painted crop matches pinned reference');
	}
}
module.exports = async function(page, base, ok) {
	await page.goto(base + '/index.html', { waitUntil: 'load' });
	const defaults = { preset: 'mixed', n: '3', bgs: '2', len: 'tiny', gap: 'zero', flow: 'overlay',
		mode: 'mixed', size: 'mixed', dir: 'top', nest: 'both', stick: 'both', regions: 1,
		realScenes: 0, regionCases: 0, exampleGradient: 1, seed: 42 };
	for (const [label, viewport, changes] of [
		['generated desktop', { width: 1440, height: 900 }, {}],
		['generated phone', { width: 390, height: 844 }, { flow: 'screen', seed: 73 }],
		['real without generated fallback', { width: 1920, height: 700 }, { realScenes: 1, exampleGradient: 0 }],
		['fallback fixtures', { width: 800, height: 1000 }, { regionCases: 1 }],
		['tight moving wagons', { width: 1440, height: 900 }, { preset: 'tight', regionCases: 1 }]
	]) {
		await page.setViewport(viewport);
		await page.evaluate(c => { setControls(c); build(); }, { ...defaults, ...changes });
		await settled(page);
		await geometry(page, label, ok, changes.preset !== 'tight');
	}
	await page.evaluate(c => { setControls(c); build(); }, defaults);
	await settled(page);
	ok(await page.evaluate(() => !balanceWarning($('src').value) && !/<\/img>|snow-hd-live/.test($('src').value)),
		'editor exports valid image markup without runtime classes');
	const first = await page.$eval('#src', el => el.value);
	await page.evaluate(() => build());
	ok(first === await page.$eval('#src', el => el.value), 'generate/reset is deterministic for the same seed');
	await page.evaluate(() => applySource());
	await settled(page);
	await geometry(page, 'source round trip', ok, true);
	await page.evaluate(() => { Snowfall.setEnabled(false); Snowfall.setEnabled(true); });
	await geometry(page, 'disable/enable', ok, true);
	ok(await page.evaluate(() => SnowfallRegion.arrays().base.every(b => getComputedStyle(b).position === 'absolute')),
		're-enable restores region CSS, not just inline sizes');
	await page.evaluate(() => { applyPreset('tight'); applyPreset('mixed'); });
	ok(await page.$eval('#mode', el => el.value) === 'mixed', 'mixed preset restores mixed settings');
	await page.evaluate(() => { toggleSource(true); });
	ok(await page.$eval('#controls', el => getComputedStyle(el).display) === 'none', 'source drawer hides controls');
	await page.evaluate(() => { toggleSource(false); selectedHeading = chapters()[1]; addBackground(); addChapter(); });
	await settled(page);
	ok(await page.evaluate(() => chapters().length === 4 && SnowfallRegion.count() === 9), 'add background/chapter preserves existing scenes');
	await geometry(page, 'added content', ok, true);
	await page.evaluate(() => { $('qa').innerHTML = ''; return qRegion(); });
	ok(await page.$eval('#qa', el => !el.querySelector('.fail') && !!el.querySelector('.ok')), 'GUI region QA passes');
	await page.evaluate(() => { $('qa').innerHTML = ''; return qRegion(); });
	ok(await page.$eval('#qa', el => !el.querySelector('.fail') && !!el.querySelector('.ok')), 'GUI region QA remains repeatable after re-enable');
	await page.setViewport({ width: 1280, height: 720 });
	await page.evaluate(c => { setControls(c); build(); }, { ...defaults, n: '2', bgs: '1', flow: 'screen' });
	await settled(page);
	await page.evaluate(() => qaAll());
	ok(await page.$eval('#qa', el => !el.querySelector('.fail') && el.querySelectorAll('.ok').length === 8),
		'GUI QA all passes, including isolated malformed-event fixture', await page.$eval('#qa', el => el.textContent));
	ok(await page.evaluate(() => !document.querySelector('#app').textContent.includes('let =')),
		'event QA removes its malformed fixture');

	const file = pathToFileURL(path.resolve(__dirname, '../../index.html')).href;
	await page.goto(file + '#n=2&bgs=1&realScenes=1&exampleGradient=0');
	await settled(page);
	ok(await page.evaluate(() => $('regions').checked && SnowfallRegion.count() === 2),
		'file:// real scenes enable regions and work without generated fallback');
	await geometry(page, 'file:// real scenes', ok, true);

	await page.goto(base + '/region-cover-2.html');
	await page.waitForFunction(() => window.SnowfallRegion && SnowfallRegion.count() === 2);
	await page.click('#autoBoth');
	await page.waitForFunction(() => document.querySelector('#nums').textContent.includes('snapshot base:'));
	ok(await page.$eval('#rows', el => !el.querySelector('.fail') && !!el.querySelector('.verdict.pass')),
		'unchanged region-cover-2 still passes both backgrounds and preserved-size check');

};
