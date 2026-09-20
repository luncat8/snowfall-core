/* Regressions for the six-chapter report, with the editor drawers open. */
'use strict';
module.exports = async function(page, base, ok) {
	await page.setViewport({ width: 1440, height: 991 });
	await page.goto(base + '/index.html#preset=mixed&n=6&bgs=1&len=mono&gap=mixed&flow=mixed'
		+ '&mode=mixed&size=mixed&dir=top&nest=both&stick=both&style=1&events=1'
		+ '&exampleGradient=1&gutter=1&hudOn=1&regions=1&realScenes=1&regionCases=0&seed=20260917');
	await page.evaluate(async () => {
		await Promise.all(Array.from(document.querySelectorAll('#app img'), img => img.decode()));
		togglePanels(true); toggleSource(true); toggleQa(true);
	});
	await page.waitForFunction(() => document.getElementById('gen').getBoundingClientRect().left >= -0.1);
	await page.evaluate(() => qaAll());
	ok(await page.$eval('#qa', el => !el.querySelector('.fail') && el.querySelectorAll('.ok').length === 8),
		'reported six-chapter configuration passes QA with source and diagnostics open',
		await page.$eval('#qa', el => el.textContent));
	ok(await page.evaluate(() => ['panels', 'src', 'qapanel'].every(c => document.body.classList.contains(c))),
		'QA leaves editor drawers open');

	const rates = await page.evaluate(() => {
		const sample = (count, elapsed) => {
			const start = performance.now() - elapsed;
			frames = count; lastFpsSample = start;
			diagTick();
			return { fps: +/fps (\d+)/.exec($('dstats').textContent)[1],
				expected: Math.round(count * 1000 / (lastFpsSample - start)) };
		};
		return [sample(18, 100), sample(30, 500)];
	});
	ok(rates.every(r => r.fps === r.expected),
		'FPS uses elapsed milliseconds, including delayed sampling intervals', JSON.stringify(rates));

	const intersections = await page.evaluate(() => {
		const box = (left, top, right, bottom) => ({ left, top, right, bottom });
		return [
			visibleOverlap(box(0, -3964, 100, -2973), box(0, -5830, 100, -4839), 100, 991),
			visibleOverlap(box(0, -900, 100, -100), box(0, -800, 100, -50), 100, 991),
			visibleOverlap(box(0, -50, 50, 100), box(60, 0, 100, 150), 100, 991),
			visibleOverlap(box(0, -50, 100, 100), box(0, 50, 100, 150), 100, 991)
		];
	});
	ok(intersections.join(',') === '0,0,0,50', 'overlap measures a clipped 2D intersection, not edge order');

	await page.evaluate(async () => {
		const style = document.createElement('style');
		style.textContent = '#app .snow-bg{position:fixed!important;top:0!important;left:0!important;'
			+ 'margin:0!important;transform:none!important}';
		document.head.appendChild(style);
		$('qa').innerHTML = '';
		try { await qOverlap(); } finally { style.remove(); }
	});
	ok(await page.$eval('#qa', el => !!el.querySelector('.fail')), 'overlap still detects genuinely overlapping visible backgrounds');

	await page.evaluate(async () => {
		const blocker = document.createElement('div');
		blocker.style.cssText = 'position:fixed;inset:0;z-index:1000;background:black';
		$('app').appendChild(blocker);
		$('qa').innerHTML = '';
		try { await qStickSlots(); } finally { blocker.remove(); }
	});
	ok(await page.$eval('#qa', el => !!el.querySelector('.fail') && el.textContent.includes('covered by')),
		'sticky QA still detects a real story element covering labels');
};
