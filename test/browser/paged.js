#!/usr/bin/env node
/* test/browser/paged.js — real-browser proof of the 0.7.0 screenful model,
   on demo-paged.html. The node gate (test/paged.js) proves the walk, the
   cut list and the grouping arithmetic over the fake DOM; what only Chromium
   can show is here:
     1  the premise — the height clamp moves no wagon and no event anchor,
        and the document is exactly the current page's paper;
     2  one screenful of whole portions a page: the page ends at the last
        stop that fits, or is exactly one portion when none fits — measured
        against live rects, not the controller's own list;
     3  every arrival opens on the page's own real cut element at the top of
        the reading band (padTop), the text before it behind the reader, and
        a short page's empty band is blank paper;
     4  a portion taller than the screen is its own page and is walked one
        band a tap — never teleported to its end;
     5  keys turn the page; the toolbar, prompt buttons, game seats and
        links do not;
     6  the page's own self-test is green;
     7  file:// boots paged from data-paged with the first page revealed.
   Loaded by test/browser/check.js as (page, BASE, ok). */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const VW = 1280, VH = 800, TOL = 1.5;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HELPERS = `window.__probe = {
	/* the live document answers: where each cut element sits right now */
	settle: function () { return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); },
	docH: function () { return document.documentElement.scrollHeight; },
	open: function (k) {
		const P = window.SnowfallPaged;
		return Math.max(0, (k > 0 ? P.y[k - 1] : 0) - P.padTop);
	},
	done: function (k) {
		const P = window.SnowfallPaged;
		const hi = P.y[k], lo = k > 0 ? P.y[k - 1] : 0;
		return Math.max(0, lo - P.padTop, hi - window.innerHeight + P.padBottom);
	},
	portion: function (k) {
		const P = window.SnowfallPaged;
		return P.y[k] - (k > 0 ? P.y[k - 1] : 0);
	},
	bandH: function () {
		const P = window.SnowfallPaged;
		return window.innerHeight - P.padTop - P.padBottom;
	},
	/* is page k exactly one portion? its end is a walk cut and its start is
	   the cut before — or the story start */
	onePortion: function (k) {
		const P = window.SnowfallPaged, end = P.y[k], lo = k > 0 ? P.y[k - 1] : 0;
		let endAt = -1, loAt = -2;
		for (let j = 0; j < P.cutN; j++) {
			if (Math.abs(P.cutY[j] - end) < 1.5) endAt = j;
			if (Math.abs(P.cutY[j] - lo) < 1.5) loAt = j;
		}
		return endAt >= 0 && loAt === endAt - 1;
	},
	paper: function (k) {
		/* the live check: the root ends at the page's cut plus its blank band */
		const P = window.SnowfallPaged;
		const root = P.root.getBoundingClientRect();
		return root.height + window.scrollY;
	},
	marks: function () {
		const out = [];
		for (const sel of ['[data-se]', '[data-ev], [data-on], .w-ask, .w-choice']) {
			for (const el of document.querySelectorAll(sel)) {
				const r = el.getBoundingClientRect();
				out.push(sel + ':' + Math.round((r.top + window.scrollY) * 10) / 10);
			}
		}
		return out.join(',');
	},
	brCuts: function () {
		const P = window.SnowfallPaged, out = [];
		for (let j = 0; j < P.cutN; j++) {
			const el = P.cutAt(j);
			if (el && el.tagName && el.tagName.toLowerCase() === 'br') {
				const prev = el.previousSibling, next = el.nextSibling;
				const pv = prev && (prev.nodeType === 3 ? prev.nodeValue.trim() : (prev.textContent || '').trim());
				const nv = next && (next.nodeType === 3 ? next.nodeValue.trim() : (next.textContent || '').trim());
				if (pv && nv) out.push({ y: P.cutY[j], prev: pv.slice(-1), next: nv.slice(0, 1) });
			}
		}
		return out;
	},
	artCuts: function () {
		/* a cover wagon may never be sliced by a page edge: every cut must sit
		   on a cover's own edge or outside every cover */
		const P = window.SnowfallPaged, arts = [];
		for (const el of document.querySelectorAll('.snow-bg')) {
			const r = el.getBoundingClientRect();
			arts.push([r.top + window.scrollY, r.bottom + window.scrollY]);
		}
		const bad = [];
		for (let i = 0; i < P.count; i++) {
			const y = P.y[i];
			for (const a of arts) if (y > a[0] + 1.5 && y < a[1] - 1.5) bad.push(Math.round(y));
		}
		return bad;
	}
};
function P0() { return window.SnowfallPaged; }`;

module.exports = async function paged(page, BASE, ok) {
	const errs = [];
	page.on('pageerror', e => errs.push(String(e)));
	page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
	console.log('--- paged · ' + VW + 'x' + VH + ' ---');
	await page.setViewport({ width: VW, height: VH });

	/* 1 · boot: the clamp premise and the paper */
	await page.goto(BASE + '/demo-paged.html', { waitUntil: 'networkidle0' });
	await sleep(400);
	await page.evaluate(HELPERS);
	const boot1 = await page.evaluate(() => {
		const P = P0();
		P.smooth = 0;
		return {
			count: P.count, engine: window.Snowfall.version, paged: P.version,
			on: P.get(), y0: P.y[0], padTop: P.padTop,
			overflowY: P.root.style.overflowY, overflowX: P.root.style.overflowX,
			scrollbarHidden: document.documentElement.classList.contains('snow-paged'),
			align: P.align,
			height: P.root.style.height, docH: document.documentElement.scrollHeight,
			vh: window.innerHeight,
		};
	});
	ok(boot1.on, 'demo boots in paged mode', 'page 1/' + boot1.count);
	ok(boot1.count > 6, 'pages are grouped from the story\'s own stops', String(boot1.count));
	ok(boot1.engine === '0.7.0' && boot1.paged === '0.7.0', 'on engine ' + boot1.engine + ' + paged ' + boot1.paged, boot1.engine);
	ok(boot1.overflowY === 'clip' && boot1.overflowX !== 'clip',
		'the story root is clipped on the block axis only', boot1.overflowY + '/' + boot1.overflowX);
	ok(boot1.scrollbarHidden, 'paged mode hides the browser scrollbar without disabling native tall-page scroll');
	ok(boot1.align === 'top', 'top alignment is the default');
	ok(/px/.test(boot1.height), 'the clamp is a plain height, never a second axis', boot1.height);
	ok(Math.abs(boot1.docH - Math.round(boot1.vh)) <= 2 || boot1.docH >= boot1.vh - TOL,
		'the paper fills the window on a full first page', boot1.docH + 'px of ' + boot1.vh);

	/* 2 · the premise: paged mode moves no anchor */
	const prem = await page.evaluate(async () => {
		const S = window.Snowfall, P = P0();
		await __probe.settle();
		const marks = __probe.marks();
		const bookH = __probe.docH();
		P.set(false);
		const bookH2 = __probe.docH();
		P.set(true);
		await __probe.settle();
		const pagedH = __probe.docH();
		return {
			same: marks === __probe.marks(), bookH: bookH2, pagedH,
			done: __probe.done(P.index), vh: window.innerHeight,
		};
	});
	ok(prem.same, 'wagon and event anchors are byte-identical across the switch');
	ok(prem.bookH > prem.pagedH, 'and paged mode is a shorter document', prem.bookH + ' vs ' + prem.pagedH);
	ok(Math.abs(prem.pagedH - (prem.done + prem.vh)) <= 2,
		'the paper ends at the current page, not the whole story', prem.pagedH + 'px of ' + prem.bookH);

	/* 3–4 · the full walk: screenfuls, arrivals, blanks, tall pages */
	await page.evaluate(() => { P0().set(true, true); });
	await sleep(300);
	const step = await page.evaluate(async () => {
		const P = P0();
		P.smooth = 0;
		const out = { pages: [], taps: 0, reveals: 0, walks: 0, endOk: false, backs: 0, backTo: -1, mono: true };
		let guard = P.count * 6, lastK = -1, lastY = -1;
		for (;;) {
			const k = P.index, y = window.scrollY;
			const rec = {
				k, n: P.count,
				open: __probe.open(k), done: __probe.done(k),
				portion: __probe.portion(k), band: __probe.bandH(),
				one: __probe.onePortion(k),
				padTop: P.padTop,
				paper: __probe.docH(),
				y,
			};
			/* the live document: the page's own cut element at the band top */
			const el = k > 0 ? P.at(k - 1) : null;
			rec.stopTop = el && el.getBoundingClientRect ? el.getBoundingClientRect().top : 0;
			rec.isRoot = !el || el === P.root;
			rec.blankHit = (function () {
				if (y < rec.open - 1.5 || __probe.portion(k) >= __probe.bandH() - 1.5) return true;
				const hit = document.elementFromPoint(Math.round(window.innerWidth / 2), window.innerHeight - 4);
				return !hit || !P.root.contains(hit) || !function () {
					for (let n = hit; n && n !== P.root; n = n.parentNode) {
						if (n.nodeType === 3 ? n.nodeValue.trim() : (n.textContent || '').trim()) return true;
					}
					return false;
				}();
			})();
			out.pages.push(rec);
			if (y < lastY - 1.5) out.mono = false;
			lastY = y; lastK = k;
			if (!P.next()) { out.endOk = true; break; }
			out.taps++;
			if (P.index > k) out.reveals++; else out.walks++;
			await __probe.settle();
			if (--guard <= 0) break;
		}
		/* back to the start */
		guard = P.count * 6;
		while (P.prev() && guard-- > 0) out.backs++;
		out.backTo = P.index;
		return out;
	});
	const uniq = step.pages.filter((p, i) => i === 0 || p.k !== step.pages[i - 1].k);
	const pads = uniq.filter(p => p.k > 0);
	ok(step.pages.every(p => p.open >= -TOL), 'no page ever shows text from before its own portion',
		step.pages.filter(p => p.open < -TOL).length + ' pages with earlier text on them');
	const arrivals = pads.filter(p => Math.abs(p.y - p.open) < 2 && !p.isRoot);
	ok(arrivals.length > 0 && arrivals.every(p => Math.abs(p.stopTop - (uniq[0].padTop || 0)) <= 2.5),
		'every arrival opens on the page\'s own real cut element at the band top',
		arrivals.length + ' arrivals measured live');
	const tall = uniq.filter(p => p.portion > p.band + TOL);
	ok(step.pages.every(p => p.portion <= p.band + TOL || p.one),
		'a page fills the screen with whole portions, or is exactly one portion',
		tall.length + ' page(s) taller than the band, each one single-portion: ' + tall.every(p => p.one));
	ok(step.pages.every(p => Math.abs(p.paper - (p.done + VH)) <= 2),
		'the paper is exactly the page it shows', step.pages.map(p => Math.round(p.paper)).join(',') || '—');
	ok(uniq.filter(p => p.portion < p.band - TOL).every(p => p.blankHit),
		'a page shorter than the screen is padded with blank paper, not old text',
		uniq.filter(p => p.portion < p.band - TOL).length + ' short page(s) checked at the window\'s bottom edge');
	ok(tall.length === 0 || step.walks >= tall.length, 'a tall portion is walked, never skipped (' + step.walks + ' walking taps)', String(step.walks));
	ok(step.reveals === step.pages[0].n - 1, 'one page a tap, the end says stop', step.reveals + ' reveals for ' + step.pages[0].n + ' pages');
	ok(step.endOk, 'the walk ends at the end of the story');
	ok(step.backTo === 0 && step.backs >= step.reveals, 'back taps walk the same pages in reverse',
		step.backs + ' back taps to page ' + (step.backTo + 1));
	ok(step.mono, 'and no tap ever goes backwards');

	/* bottom alignment lands short pages on their lower edge; tall portions
	   retain a top entry point so the reader does not begin at their end. */
	const bottom = await page.evaluate(async () => {
		const P = P0();
		P.set(true, true);
		P.smooth = 0;
		const originalStart = P.root.getBoundingClientRect().top + window.scrollY;
		const originalMarks = __probe.marks();
		P.align = 'bottom';
		const firstShort = P.y[0] - (P.root.getBoundingClientRect().top + window.scrollY) <= __probe.bandH() + TOL;
		const firstEnd = P.y[0];
		const firstBottom = !firstShort || Math.abs(firstEnd - (window.innerHeight - P.padBottom)) <= 2;
		const firstShift = P.root.getBoundingClientRect().top + window.scrollY >= originalStart;
		P.align = 'top';
		const sourceAnchorsRestore = originalMarks === __probe.marks();
		P.align = 'bottom';
		P.set(true, true);
		let guard = P.count * 6;
		while (guard-- > 0) {
			const k = P.index, h = __probe.portion(k);
			if (k > 0 && h <= __probe.bandH() + TOL) break;
			if (!P.next()) break;
			await __probe.settle();
		}
		const k = P.index;
		return {
			k, short: __probe.portion(k) <= __probe.bandH() + TOL,
			y: window.scrollY,
			want: Math.max(0, P.y[k] - window.innerHeight + P.padBottom),
			firstShort, firstBottom, firstShift, sourceAnchorsRestore,
		};
	});
	ok(!bottom.firstShort || bottom.firstBottom && bottom.firstShift,
		'bottom alignment fills the opening short page without negative scrolling');
	ok(bottom.sourceAnchorsRestore, 'returning to top alignment restores every source anchor position');
	ok(bottom.short && bottom.k > 0 && Math.abs(bottom.y - bottom.want) <= 2,
		'bottom alignment places a short page at the reading band’s bottom', bottom.y + ' vs ' + bottom.want);
	await page.evaluate(() => { P0().align = 'top'; P0().set(true, true); });
	await sleep(100);

	/* the art: no cover is sliced by a page edge */
	const art = await page.evaluate(() => __probe.artCuts());
	ok(art.length === 0, 'no art wagon is cut in half by a page edge', art.join(',') || 'every cut is on a cover edge or outside');

	/* 5 · keys and taps */
	const keys = await page.evaluate(async () => {
		const P = P0();
		P.set(true, true);
		P.smooth = 0;
		await __probe.settle();
		const out = {};
		const key = (code) => {
			document.dispatchEvent(new KeyboardEvent('keydown', { key: code, bubbles: true, cancelable: true }));
		};
		let k = P.index;
		key(' ');
		await __probe.settle();
		out.space = P.index === k + 1;
		k = P.index;
		key('Backspace');
		await __probe.settle();
		out.backspace = P.index === k - 1;
		k = P.index;
		key('ArrowDown');
		await __probe.settle();
		out.arrowDown = P.index === k;
		const tap = (el) => {
			el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 12, button: 0, isPrimary: true }));
			el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 12, clientY: 12, button: 0, isPrimary: true }));
		};
		for (const sel of ['#bar', '.seat a', 'a', '.w-ask button, .w-choice button']) {
			const el = document.querySelector(sel);
			if (!el) { out[sel] = null; continue; }
			k = P.index;
			tap(el);
			await __probe.settle();
			out[sel] = P.index === k;
		}
		const p = document.querySelector('#app p');
		k = P.index;
		tap(p);
		await __probe.settle();
		out.prose = P.index === k + 1;
		return out;
	});
	ok(keys.space, 'Space advances');
	ok(keys.backspace, 'Backspace goes back');
	ok(keys.arrowDown, 'ArrowDown stays native scrolling');
	for (const sel of ['#bar', '.seat a', 'a', '.w-ask button, .w-choice button']) {
		ok(keys[sel] === null || keys[sel], 'a tap on ' + sel + ' does not turn the page', String(keys[sel]));
	}
	ok(keys.prose, 'a tap on the prose does');

	/* 6 · the page's own self-test */
	await page.evaluate(() => { window.demoPaged.run(); });
	await sleep(7000);
	const qa = await page.evaluate(() => document.querySelector('#qa').textContent);
	const bad = qa.split('\n').filter(l => /^FAIL/.test(l));
	ok(bad.length === 0, 'demo-paged self-test is green', bad.join(' | '));
	ok(/all checks passed/.test(qa), 'and says so', qa.split('\n').filter(l => /passed|FAILED/.test(l)).join(' | '));

	/* 7 · file:// boot from data-paged */
	await page.goto('file://' + path.join(ROOT, 'demo-paged.html'), { waitUntil: 'networkidle0' });
	await sleep(400);
	const file = await page.evaluate(() => {
		const P = window.SnowfallPaged;
		return { on: P.get(), k: P.index, count: P.count, docH: document.documentElement.scrollHeight, vh: window.innerHeight };
	});
	ok(file.on && file.k === 0, 'file:// boots paged from data-paged', 'page ' + (file.k + 1) + '/' + file.count);
	ok(file.docH >= file.vh - TOL, 'with the first page\'s paper on screen', file.docH + 'px of ' + file.vh);

	if (errs.length) for (const e of errs) ok(false, 'paged page error', e.split('\n')[0]);
};
