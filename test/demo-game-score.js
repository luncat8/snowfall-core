#!/usr/bin/env node
/* test/demo-game-score.js — gate for demo-game-score.html, the 0.4.2 page.
	Parses the page's real markup into the shared fake DOM, loads the page's
	own <script src> files, runs its author script against the real engine and
	drives Snowfall.step() through the reader paths that matter:

	  cold load + slow read     → every chapter pays its live +2
	  cold load + flick         → every skipped chapter pays the fallback 1
	  jump over one chapter     → it defaults, the others stay playable
	  a fresh visit with a save → the recorded play is replayed as `saved`
	  re-reading / re-passing   → overwrite, never add
	  save ↓ / load ↑ / clear   → round-trip and zero
	  the page's own self-test  → run through its button, no FAIL
	  engine absent             → prose, no throw, SKIP

	Needs no browser and no npm. `node test/demo-game-score.js [file.html]`
	runs the same checks against another revision of the page. Directly
	executable or via `node test/run.js`. */
'use strict';
const fs = require('fs'), path = require('path');
const FD = require('./lib/fakedom.js');
const ROOT = path.join(__dirname, '..');
const VH = 800;

let checks = 0, fails = 0;
function ok(cond, name, detail) {
	checks++;
	if (cond) return;
	fails++;
	console.error('FAIL ' + name + (detail ? ' — ' + detail : ''));
}
function eq(a, b, name) { ok(a === b, name, '(' + a + ' vs ' + b + ')'); }

/* ---------------- layout: heights mirror the page's CSS ---------------- */
const LINE = 26, PMARGIN = 16;
function lines(s) { return Math.max(1, Math.ceil(s.trim().length / 58)); }
function measure(node, vh, inner) {
	const cls = (node.attrs.class || '').split(/\s+/).filter(Boolean);
	if (cls.indexOf('spacer') >= 0) return vh;                        /* height: var(--snow-vh) */
	if (node.tag === 'section') return cls.indexOf('cover') >= 0 ? Math.max(vh, inner) : Math.max(224, 32 + inner + 32);
	if (node.tag === 'div' && cls.indexOf('game') >= 0) return Math.max(224, 16 + inner + 16);
	if (node.tag === 'h1') return 44;
	if (node.tag === 'h2') return 39;
	if (node.tag === 'p') return PMARGIN + lines(FD.nodeText(node)) * LINE + PMARGIN;
	return inner;
}

/* ---------------- the page's own probes ---------------- */
function openPage(source, withEngine) {
	const p = FD.buildPage(source, VH, { measure: measure, engine: withEngine, dir: ROOT });
	const byId = p.byId;
	p.score = () => byId['score'].textContent;
	p.breakdown = () => byId['breakdown'].textContent;
	p.summary = () => byId['breakdown'].textContent + ' | score ' + byId['score'].textContent;
	p.answer = (k, v) => {
		const b = byId['game-' + k].querySelector('button[data-v="' + v + '"]');
		if (!b) return false;
		b.click();
		return true;
	};
	p.painted = () => !!FD.queryAll(p.doc.body, '.game button').length;
	p.waiting = k => !!byId['game-' + k].querySelector('button');
	p.play = (k, v) => {
		for (let yy = p.win.scrollY; yy < Math.max(0, p.docHeight - VH); yy += 200) {
			p.win.setScroll(yy);
			if (p.answer(k, v)) return true;
		}
		p.win.setScroll(p.bottom());
		return p.answer(k, v);
	};
	p.readDown = (step, v) => {
		for (let yy = 0; yy < p.bottom(); yy += step) {
			p.win.setScroll(yy);
			if (v !== undefined) for (let k = 1; k <= 3; k++) p.answer(k, v);
		}
		p.win.setScroll(p.bottom());
		if (v !== undefined) for (let k = 1; k <= 3; k++) p.answer(k, v);
	};
	p.walkUp = step => { for (let yy = p.bottom(); yy > 0; yy -= step) p.win.setScroll(yy); p.win.setScroll(0); };
	return p;
}

/* ==================================================================== */
const file = process.argv[2] || path.join(ROOT, 'demo-game-score.html');
const source = fs.readFileSync(file, 'utf8');
console.log('demo-game-score: ' + path.relative(ROOT, file) + '  (fake DOM, vh ' + VH + ')');

/* 1. the load-time prefill must not eat chapter 1 */
{
	const p = openPage(source, true);
	ok(p.S && p.S.events, 'the engine boots on the page');
	ok(p.S.events.n >= 4, 'three chapters and the tally declare events', 'n=' + (p.S.events && p.S.events.n));
	const first = p.S.events.n ? Math.round(p.S.events.y[0]) : 0;
	if (first <= VH) ok(p.waiting(1), 'a chapter standing in the load viewport fires its view at load', 'y=' + first + ' vh=' + VH);
	ok(p.play(1, 2), 'chapter 1 is playable on a cold load (at load, or on the read down)');
	p.readDown(200, 2);
	eq(p.score(), '6', 'a slow read paying 2 at every chapter totals 6', p.summary());
	eq(p.breakdown(), 'ch1=2 live · ch2=2 live · ch3=2 live', 'and labels every chapter live');
}

/* 2. a skipped chapter pays the fallback */
{
	const p = openPage(source, true);
	p.win.setScroll(0);
	p.win.setScroll(p.bottom());
	eq(p.score(), '3', 'a flick from a cold load pays 1 per skipped chapter', p.summary());
	eq(p.breakdown(), 'ch1=1 default · ch2=1 default · ch3=1 default', 'and labels them default');
	ok(!p.painted(), 'the skip path painted no prompt');
	const st = p.store();
	eq(st.keys['gold.ch1'], 1, 'the engine records the fallback the skipped chapter pays');
	eq(st.defaults['gold.ch1'], 1, 'and marks it a default, not the reader\'s own play');
	eq(Object.keys(st.vars).length, 0, 'the page keeps no score of its own — vars stay empty');
	eq(p.S.store.counts.defaults, 3, 'the store reports the marks');
	eq(p.S.sum('gold.'), 3, 'sum("gold.") is what the HUD shows');
}

/* 3. jumping over a chapter */
{
	const p = openPage(source, true);
	ok(p.play(1, 2), 'chapter 1 plays live on a cold load');
	p.win.setScroll(p.el('ch3').offsetTop);
	eq(p.breakdown(), 'ch1=2 live · ch2=1 default · ch3=idle', 'the jumped-over chapter defaults, the rest hold');
	ok(p.play(3, 1), 'the landed chapter still prompts');
	eq(p.score(), '4', 'live 2 + skipped 1 + played 1', p.summary());
}

/* 4. a fresh visit replays the recorded play and never double-grants */
{
	const p = openPage(source, true);
	ok(p.play(1, 2), 'chapter 1 is played live, the rest never read');
	eq(p.score(), '2', 'only chapter 1 is counted so far', p.summary());
	p.win.scrollTo(0, 0);
	p.S.refresh(true);                         /* same store, latches re-armed */
	p.win.setScroll(p.bottom());
	eq(p.breakdown(), 'ch1=2 saved · ch2=1 default · ch3=1 default', 'the skipped chapter replays its own play');
	eq(p.score(), '4', 'recorded 2 + two fallbacks 1', p.summary());
	const st = p.store();
	eq(st.keys['gold.ch1'], 2, 'the recorded answer is still 2');
	ok(!st.defaults || !st.defaults['gold.ch1'], 'a played chapter carries no default mark');
	eq(p.S.sum('gold.ch1'), 2, 'so the chapter is counted exactly once');
}

/* 5. re-reading overwrites, re-passing without answering keeps the record */
{
	const p = openPage(source, true);
	p.readDown(200, 2);
	eq(p.score(), '6', 'first pass 6');
	p.walkUp(200);
	p.readDown(200, 2);
	eq(p.score(), '6', 'a second answered pass is still 6 (overwrite, never add)');
	p.walkUp(200);
	p.readDown(200);
	eq(p.score(), '6', 're-passing without answering keeps the record', p.summary());
}

/* 6. save ↓ / load ↑ / clear save */
{
	const p = openPage(source, true);
	p.readDown(200, 2);
	const json = p.S.exportJSON(), sum = p.S.sum('gold.');
	p.S.reset();
	ok(p.S.importJSON(json), 'import accepts the exported save');
	eq(p.S.sum('gold.'), sum, 'export → reset → import round-trips the total');
	p.el('clearBtn').onclick();
	const cleared = p.store();
	eq(Object.keys(cleared.keys).length + Object.keys(cleared.defaults).length, 0, 'clear save drops outcomes and default marks');
	eq(p.score(), '0', 'clear save zeroes the score');
	ok(FD.queryAll(p.doc.body, '.game .picked').length === 0, 'no resolved chapter text survives clear save');
	const fresh = [1, 2, 3].every(k => p.byId['game-' + k].querySelector('.idle') || p.waiting(k));
	ok(fresh, 'every box is idle again — or prompting, if the chapter re-armed on screen',
		[1, 2, 3].map(k => k + ':' + (p.waiting(k) ? 'prompt' : p.byId['game-' + k].querySelector('.idle') ? 'idle' : 'other')).join(' '));
}

/* 7. the page's own in-GUI self-test, run through its button */
{
	const p = openPage(source, true);
	p.el('qa').textContent = '';
	p.el('selfBtn').onclick();
	const out = p.el('qa').textContent, passes = (out.match(/PASS /g) || []).length;
	ok(out.indexOf('FAIL') < 0, 'the in-GUI self-test reports no FAIL', out.split('\n')[1]);
	ok(/all checks passed/.test(out), 'and ends with all checks passed');
	ok(passes >= 14, 'having run at least 14 checks', String(passes));
}

/* 8. engine absent: prose, no throw, SKIP */
{
	const p = openPage(source, false);
	let threw = null, threw2 = null;
	try { p.el('selfBtn').onclick(); } catch (e) { threw = e; }
	try { p.win.askGame(1); } catch (e) { threw2 = e; }
	ok(!threw, 'the author script survives an absent engine', threw && threw.message);
	ok(!threw2, 'askGame is a quiet no-op without the engine', threw2 && threw2.message);
	ok(/SKIP/.test(p.el('qa').textContent), 'the self-test reports SKIP without the engine');
	ok(/<b id="score">0<\/b>/.test(source), 'the page ships a literal score 0 for that case');
}

console.log('demo-game-score: ' + (checks - fails) + '/' + checks + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
