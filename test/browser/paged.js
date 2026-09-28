#!/usr/bin/env node
/* test/browser/paged.js — real-browser proof of the 0.6.0 paged mechanism,
   on demo-paged.html. The node gate (test/paged.js) proves the walk, the
   merge rules and the arithmetic over the fake DOM; what only Chromium can
   show is here:
     1  the premise — the height clamp moves no wagon and no event anchor,
        and the document becomes exactly the boundary;
     2  a wagon parks inside the clamp and paints whole under overflow: clip;
     3  a `<br>` boundary really is the gap between two lines, not a glyph
        edge and not the br's own rect bottom;
     4  every page is exactly one portion, the previous text off the page, one
        portion a tap, and no
        step scrolls more than stepMax·vh;
     5  keys turn the page; the toolbar, prompt buttons, game seats and
        links do not;
     6  the page's own self-test is green;
     7  file:// boots paged from data-paged with the first portion revealed.
   Loaded by test/browser/check.js as (page, BASE, ok). */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const VW = 1280, VH = 800, TOL = 1.5;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* helpers the page needs more than once: the text on either side of a node,
   and the painted rect of its first or last glyph */
const HELPERS = `window.__probe = {
	firstIn: function (el) { return document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode(); },
	lastIn: function (el) {
		const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let t = w.nextNode(), last = t;
		while (t) { last = t; t = w.nextNode(); }
		return last;
	},
	before: function (el) {
		for (let n = el; n; n = n.parentNode) for (let s = n.previousSibling; s; s = s.previousSibling) {
			const t = s.nodeType === 3 ? s : this.lastIn(s);
			if (t && t.nodeValue.trim()) return t;
		}
		return null;
	},
	after: function (el) {
		for (let n = el; n; n = n.parentNode) for (let s = n.nextSibling; s; s = s.nextSibling) {
			const t = s.nodeType === 3 ? s : this.firstIn(s);
			if (t && t.nodeValue.trim()) return t;
		}
		return null;
	},
	glyph: function (node, atEnd) {
		const r = document.createRange(), n = node.nodeValue.length;
		r.setStart(node, atEnd ? Math.max(0, n - 1) : 0);
		r.setEnd(node, atEnd ? n : 1);
		const list = r.getClientRects();
		for (let i = 0; i < list.length; i++) if (list[i].height > 0) {
			return { top: list[i].top + window.scrollY, bottom: list[i].bottom + window.scrollY };
		}
		return null;
	},
	stopTop: function (k) {
		const el = window.SnowfallPaged.at(k);
		return el ? el.getBoundingClientRect().top + window.scrollY : null;
	},
	settle: function () { return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); },
	docH: function () { return document.documentElement.scrollHeight; },
	/* the page model: page k is the portion [start(k), y[k]], the reader sits
	   at its bottom, and a short portion is padded to a full window of paper */
	start: function (k) { return k > 0 ? P0().y[k - 1] : 0; },
	band: function (k) { return Math.max(0, window.innerHeight - (P0().y[k] - (k > 0 ? P0().y[k - 1] : 0))); },
	spot: function (k) { return Math.max(k > 0 ? P0().y[k - 1] : 0, P0().y[k] - window.innerHeight); }
};
function P0() { return window.SnowfallPaged; }`;

module.exports = async function paged(page, BASE, ok) {
	const errs = [];
	page.on('pageerror', e => errs.push(String(e)));
	page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
	console.log('--- paged · ' + VW + 'x' + VH + ' ---');
	await page.setViewport({ width: VW, height: VH });
	await page.goto(BASE + '/demo-paged.html', { waitUntil: 'load' });
	await page.waitForFunction(() => window.Snowfall && window.SnowfallPaged && window.SnowfallPaged.get(), { timeout: 15000 });
	await sleep(250);
	await page.evaluate(HELPERS);

	/* ---- boot: paged on, the first portion only ---- */
	const boot1 = await page.evaluate(() => {
		const P = window.SnowfallPaged;
		return {
			count: P.count, y0: P.y[0], stop: P.at(0).tagName + (P.at(0).id ? '#' + P.at(0).id : ''),
			version: P.version, engine: window.Snowfall.version,
			docH: window.__probe.docH(), vh: window.innerHeight,
			overflow: P.root.style.overflowY,
			firstStop: window.__probe.stopTop(0), secondStop: window.__probe.stopTop(1)
		};
	});
	ok(boot1.count > 6, 'demo boots paged with ' + boot1.count + ' portions', String(boot1.count));
	ok(boot1.engine === '0.7.0', 'on engine ' + boot1.engine, boot1.engine);
	ok(boot1.overflow === 'clip', 'the story root is clipped on the block axis', boot1.overflow);
	ok(Math.abs(boot1.docH - Math.round(boot1.y0 + boot1.vh - (boot1.y0 - 0))) <= TOL,
		'boot pads the first portion to one window of paper', boot1.docH + ' vs ' + Math.round(boot1.y0 + boot1.vh));
	ok(Math.abs(boot1.firstStop - boot1.y0) <= TOL,
		'the first boundary is the first stop itself', boot1.firstStop + ' vs ' + boot1.y0);
	ok(boot1.secondStop >= boot1.y0 - TOL,
		'and the second stop is still off the page', boot1.secondStop + ' vs ' + boot1.y0);

	/* ---- 1 · the premise: the clamp moves nothing ---- */
	const prem = await page.evaluate(() => {
		const P = window.SnowfallPaged, S = window.Snowfall, app = P.root;
		const w0 = Array.from(S.wagons.y), e0 = S.events ? Array.from(S.events.y) : [];
		P.set(false);
		const wb = Array.from(S.wagons.y), eb = S.events ? Array.from(S.events.y) : [];
		const bookH = window.__probe.docH();
		P.set(true);
		const w1 = Array.from(S.wagons.y);
		const same = a => a.length === w0.length && a.every((v, i) => Math.abs(v - w0[i]) < 1e-9);
		return {
			wagonsSame: same(wb) && same(w1),
			eventsSame: JSON.stringify(eb) === JSON.stringify(e0),
			bookH, pagedH: window.__probe.docH(), y: P.y[P.index], vh: window.innerHeight,
			band: parseFloat(P.root.style.marginBottom) || 0
		};
	});
	ok(prem.wagonsSame, 'wagon anchors are byte-identical in book and paged mode');
	ok(prem.eventsSame, 'event anchors are byte-identical too');
	ok(prem.bookH > prem.pagedH, 'and paged mode is a shorter document', prem.bookH + ' vs ' + prem.pagedH);
	ok(Math.abs(prem.pagedH - Math.round(prem.y + prem.band)) <= TOL,
		'the paged paper is this page: the root at its boundary, plus the band under it',
		prem.pagedH + ' vs ' + Math.round(prem.y + prem.band) + ' (boundary ' + prem.y.toFixed(1) + ', band ' + prem.band + ')');

	/* ---- 2 · a wagon parks inside the clamp, and the clamp moves nothing ---- */
	const park = await page.evaluate(async () => {
		const P = window.SnowfallPaged, S = window.Snowfall, pr = window.__probe;
		function rects() {
			const out = [];
			for (let i = 0; i < S.wagons.n; i++) {
				const w = S.wagons.els[i].getBoundingClientRect();
				out.push([w.left, w.top, w.width, w.height].map(v => Math.round(v * 100) / 100).join(','));
			}
			return out;
		}
		P.smooth = 0;
		P.set(true, true);
		let found = null;
		const rows = [];
		/* a wagon parks when the reader is exactly at its document Y, and a
		   page only lets the reader between its portion's start and its
		   bottom — so the first page whose window reaches a wagon's Y is
		   where parking is testable */
		for (let k = 0; k < P.count && !found; k++) {
			S.step(window.scrollY);
			await pr.settle();
			const f = pr.spot(k), dys = [];
			for (let i = 0; i < S.wagons.n; i++) {
				const dy = S.wagons.els[i].getBoundingClientRect().top + window.scrollY;
				dys.push(Math.round(dy));
				if (found || dy < pr.start(k) - 0.5 || dy > f) continue;
				found = { k, i, dy, y: P.y[k], paged: rects() };
			}
			rows.push('p' + k + ' [' + Math.round(pr.start(k)) + ',' + Math.round(f) + '] wagons=' + dys.join(','));
			if (k < P.count - 1) { P.next(); S.step(window.scrollY); }
		}
		if (!found) { P.smooth = 1; return { found: null, rows: rows }; }
		/* a wagon parks where the reader is exactly at its document Y, so park
		   there — clamped into the page's own range, which is a single point
		   for a short page and a window of scroll for a tall one. Only if the
		   browser will not sit exactly there does the whole range get scanned
		   for the closest integer. */
		const lo = pr.start(found.k), hi = pr.spot(found.k);
		const parkAt = Math.min(Math.max(found.dy, lo), hi);
		window.scrollTo(0, parkAt);
		S.step(window.scrollY);
		let best = { s: parkAt, pos: S.wagons.pos[found.i] };
		if (Math.abs(best.pos) > 1.5) {
			best = null;
			for (let s = Math.ceil(lo); s <= Math.floor(hi); s++) {
				window.scrollTo(0, s);
				S.step(window.scrollY);
				const p = S.wagons.pos[found.i];
				if (!best || Math.abs(p) < Math.abs(best.pos)) best = { s: s, pos: p };
			}
		}
		found.parkAt = best.s;
		window.scrollTo(0, best.s);
		S.step(window.scrollY);
		await pr.settle();
		const w = S.wagons.els[found.i].getBoundingClientRect();
		found.pos = S.wagons.pos[found.i];
		found.box = [w.left, w.top, w.width, w.height].map(v => Math.round(v * 100) / 100);
		found.vp = [window.innerWidth, window.innerHeight];
		found.bottom = w.bottom + window.scrollY;
		found.paged = rects();
		P.set(false);
		window.scrollTo(0, found.parkAt);
		S.step(window.scrollY);
		await pr.settle();
		found.book = rects();
		P.set(true);
		window.scrollTo(0, found.parkAt);
		S.step(window.scrollY);
		await pr.settle();
		found.round = rects();
		P.smooth = 1;
		return { found: found, rows: rows };
	});
	ok(!!park.found, 'the demo reaches a wagon the clamp lets the reader park at',
		park.found ? 'page ' + park.found.k + ', wagon ' + park.found.i : 'none found' + (park.rows ? ' — ' + park.rows.join(' | ') : ''));
	if (park.found) {
		ok(Math.abs(park.found.pos) <= 1.5 && Math.abs(park.found.box[0]) <= 1.5 && Math.abs(park.found.box[1]) <= 1.5
			&& park.found.box[2] === park.found.vp[0] && park.found.box[3] === park.found.vp[1],
			'the wagon parks at the window top and its box is the whole window',
			'pos ' + park.found.pos + ' at scroll ' + park.found.parkAt + ', box ' + park.found.box.join(',') + ' vs ' + park.found.vp.join(','));
		ok(park.found.y >= park.found.bottom - TOL,
			'the page holds the parked wagon whole, so overflow: clip cannot cut it',
			'page ends ' + Math.round(park.found.y) + ', wagon ends ' + Math.round(park.found.bottom));
		ok(park.found.paged.join('|') === park.found.book.join('|'),
			'every wagon paints the identical rect at the same scroll in both modes',
			park.found.paged.join('|') + ' vs ' + park.found.book.join('|'));
		ok(park.found.paged.join('|') === park.found.round.join('|'),
			'and the same again after a paged -> book -> paged round trip',
			park.found.book.join('|') + ' vs ' + park.found.round.join('|'));
	}

	/* ---- 3 · a <br> boundary is the gap between two lines ---- */
	const brs = await page.evaluate(() => {
		const P = window.SnowfallPaged, pr = window.__probe, out = [];
		for (let k = 0; k < P.count; k++) {
			const el = P.at(k);
			if (!el || el.tagName !== 'BR') continue;
			const a = pr.before(el), b = pr.after(el);
			if (!a || !b) continue;
			out.push({
				k, y: P.y[k],
				before: pr.glyph(a, true), after: pr.glyph(b, false),
				brBottom: el.getBoundingClientRect().bottom + window.scrollY
			});
		}
		return out;
	});
	ok(brs.length >= 3, 'the demo has ' + brs.length + ' <br> portions', String(brs.length));
	for (const b of brs) {
		const f = n => n.toFixed(1);
		ok(b.y > b.before.bottom - TOL && b.y < b.after.top + TOL,
			'br boundary ' + f(b.y) + ' lies between the lines ' + f(b.before.bottom) + ' / ' + f(b.after.top));
		ok(b.y - b.before.bottom > 2 && b.after.top - b.y > 2,
			'strictly inside the gap on page ' + b.k + ', not on a glyph edge',
			f(b.y - b.before.bottom) + ' / ' + f(b.after.top - b.y));
		ok(Math.abs(b.y - b.brBottom) > 1.5,
			'and not the br rect bottom', f(b.brBottom));
	}

	/* ---- 4 · stepping ---- */
	const step = await page.evaluate(async tol => {
		const P = window.SnowfallPaged, S = window.Snowfall, pr = window.__probe;
		/* a fresh, settled layout: a minigame seats itself the first time it is
		   looked at, and the panel it paints moves everything below it */
		P.smooth = 0;
		P.set(false);
		Snowfall.refresh(true);
		S.step(0);
		Snowfall.refresh(true);
		P.set(true, true);
		S.step(window.scrollY);
		await pr.settle();
		const over = [], rows = [], pages = [];
		let taps = 0, reveals = 0, walks = 0;
		/* what the page window is: it opens at this page's own portion, never
		   above it, so the text before it is off the page; and a wagon is
		   either whole above the window or whole inside the page's paper, never
		   cut in half by the clip */
		function row(k) {
			const start = pr.start(k), spot = pr.spot(k);
			const cut = [];
			for (let i = 0; i < S.wagons.n; i++) {
				const w = S.wagons.els[i].getBoundingClientRect();
				const end = P.y[k] - window.scrollY;
				if (w.top < end - tol && w.bottom > end + tol) cut.push(i + ':' + Math.round(w.top) + '..' + Math.round(w.bottom));
			}
			const hit = document.elementFromPoint(Math.round(window.innerWidth / 2), window.innerHeight - 4);
			pages.push({
				k: k, tall: P.y[k] - start >= window.innerHeight - tol, cut: cut.join(','),
				open: window.scrollY - start, top: spot - window.scrollY,
				blank: hit ? !P.root.contains(hit) : false,
				text: (hit && hit.textContent || '').trim().slice(0, 12)
			});
		}
		for (let i = 0; i < 120; i++) {
			const here = Math.abs(window.scrollY - pr.spot(P.index)) <= tol;
			if (P.index === P.count - 1 && here) break;
			if (here) row(P.index);
			const sY = window.scrollY, before = P.index;
			if (!P.next()) break;
			taps++;
			S.step(window.scrollY);
			await pr.settle();
			const k = P.index, spot = pr.spot(k), start = pr.start(k);
			const advanced = k > before;
			if (advanced) reveals++; else if (k < before) over.push('tap ' + taps + ' went back a page');
			if (advanced && k !== before + 1) over.push('tap ' + taps + ' moved ' + (k - before) + ' portions');
			/* the paper is this page: the root ends at the portion, plus at
			   most one window of blank underneath */
			if (Math.abs(pr.docH() - Math.round(P.y[k] + pr.band(k))) > tol)
				over.push('tap ' + taps + ': docH ' + pr.docH() + ' != ' + Math.round(P.y[k] + pr.band(k)));
			if (window.scrollY > spot + tol) over.push('tap ' + taps + ': scrolled past the page by ' + (window.scrollY - spot).toFixed(1));
			if (window.scrollY - sY > window.innerHeight + tol) over.push('tap ' + taps + ': scrolled ' + (window.scrollY - sY).toFixed(1) + 'px');
			if (window.scrollY < sY - tol) over.push('tap ' + taps + ': scrolled backwards');
			if (advanced) rows.push(P.y[k]);
			else walks++;
		}
		row(P.index);
		const atEnd = P.index === P.count - 1 && P.next() === false, count = P.count;
		let backs = 0;
		while (P.prev() && backs < 120) { backs++; S.step(window.scrollY); await pr.settle(); }
		P.smooth = 1;
		return {
			taps, reveals, walks, over, atEnd, backs, backTo: P.index, pages, count,
			monotonic: rows.every((v, i) => !i || v > rows[i - 1]),
			progress: P.smooth
		};
	}, TOL);
	ok(step.over.length === 0, 'every tap reveals one portion, and the paper is exactly that page',
		step.over.slice(0, 3).join(' | '));
	/* the promise the mode exists for: the text that came before leaves the page */
	ok(step.pages.every(p => p.open >= -TOL), 'no page ever shows text from before its own portion',
		step.pages.filter(p => p.open < -TOL).map(p => p.k + ':' + p.open.toFixed(1)).join(' '));
	ok(step.pages.filter(p => !p.tall).every(p => Math.abs(p.top) <= TOL),
		'every page shorter than the window opens on its own first line',
		'tops ' + step.pages.filter(p => !p.tall).map(p => p.top.toFixed(0)).filter((v, i, a) => a.indexOf(v) === i).join(','));
	ok(step.pages.filter(p => p.tall).every(p => Math.abs(p.top) <= TOL),
		'every page taller than the window is read at its last line',
		'tops ' + step.pages.filter(p => p.tall).map(p => p.top.toFixed(0)).filter((v, i, a) => a.indexOf(v) === i).join(','));
	ok(step.pages.every(p => !p.cut), 'no art wagon is cut in half by a page edge',
		step.pages.filter(p => p.cut).map(p => p.k + ':' + p.cut).join(' '));
	const shorts = step.pages.filter(p => !p.tall);
	ok(shorts.length > 0 && shorts.every(p => p.blank), 'a page shorter than the window has blank paper under it, not text',
		shorts.filter(p => !p.blank).map(p => p.k + ':' + p.text).join(' ') || shorts.length + ' pages checked');
	ok(step.walks > 0, 'a page taller than the window is walked, not skipped (' + step.walks + ' walking taps)',
		String(step.walks));
	ok(step.reveals === step.count - 1, 'a full pass reveals one portion a tap (' + step.reveals + ' for ' + step.count + ')',
		step.reveals + ' taps + ' + step.walks + ' walking taps');
	ok(step.atEnd, 'the end of the story stops');
	ok(step.backTo === 0 && step.backs === step.reveals, 'back taps walk the same pages in reverse',
		step.backs + ' taps, page ' + (step.backTo + 1));
	ok(step.monotonic, 'and no tap ever goes backwards');

	/* ---- 5 · keys, and what a tap must not turn ---- */
	const keys = await page.evaluate(async () => {
		const P = window.SnowfallPaged, S = window.Snowfall, pr = window.__probe, out = {};
		function key(name, extra) {
			document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: name, bubbles: true, cancelable: true }, extra || {})));
		}
		function tap(el) {
			['pointerdown', 'pointerup'].forEach(t => el.dispatchEvent(new PointerEvent(t,
				{ bubbles: true, cancelable: true, clientX: 20, clientY: 20, button: 0, isPrimary: true })));
		}
		P.smooth = 0;
		P.set(true, true);
		P.next();
		S.step(window.scrollY);
		await pr.settle();
		let k = P.index;
		key(' ');
		S.step(window.scrollY);
		await pr.settle();
		out.space = P.index === k + 1;
		k = P.index;
		key('Backspace');
		S.step(window.scrollY);
		await pr.settle();
		out.backspace = P.index === k - 1;
		k = P.index;
		key('ArrowDown');
		out.arrowDown = P.index === k;
		for (const sel of ['#bar', '#app button', '.seat', '#app a']) {
			const el = document.querySelector(sel);
			if (!el) { out[sel] = null; continue; }
			tap(el);
			out[sel] = P.index === k;
		}
		tap(document.querySelector('#app p'));
		out.prose = P.index === k + 1;
		P.smooth = 1;
		return out;
	});
	ok(keys.space, 'Space advances');
	ok(keys.backspace, 'Backspace goes back');
	ok(keys.arrowDown, 'ArrowDown stays native scrolling');
	for (const sel of ['#bar', '#app button', '.seat', '#app a']) {
		ok(keys[sel] === null || keys[sel], 'a tap on ' + sel + ' does not turn the page', String(keys[sel]));
	}
	ok(keys.prose, 'a tap on the prose does');

	/* ---- 6 · the page's own self-test ---- */
	const qa = await page.evaluate(() => {
		window.demoPaged.run();
		return document.getElementById('qa').textContent;
	});
	const bad = qa.split('\n').filter(l => /FAIL/.test(l));
	ok(bad.length === 0, 'demo-paged self-test is green', bad.join(' | '));
	ok(/all checks passed/.test(qa), 'and says so', qa.split('\n').filter(l => /passed|FAILED/.test(l)).join(' | '));

	/* ---- 7 · file:// ---- */
	const tab = await page.browser().newPage();
	await tab.setViewport({ width: VW, height: VH });
	await tab.goto('file://' + ROOT + '/demo-paged.html', { waitUntil: 'load' });
	const file = await tab.waitForFunction(() => window.Snowfall && window.SnowfallPaged && window.SnowfallPaged.count > 0
		? { on: window.SnowfallPaged.get(), count: window.SnowfallPaged.count, y0: window.SnowfallPaged.y[0],
			docH: document.documentElement.scrollHeight, vh: window.innerHeight } : null,
		{ timeout: 15000 }).then(h => h.jsonValue());
	await tab.close();
	ok(file.on, 'file:// boots paged from data-paged');
	ok(Math.abs(file.docH - Math.round(file.y0 + Math.max(0, file.vh - file.y0))) <= TOL,
		'and shows the first portion, padded to one window', file.docH + ' vs ' + Math.round(file.y0 + file.vh));

	if (errs.length) for (const e of errs) ok(false, 'paged page error', e.split('\n')[0]);
	return { errors: errs.length };
};
