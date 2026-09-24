#!/usr/bin/env node
/* test/demo-minigame.js — gate for demo-minigame.html, the 0.6 page. Parses
	the page's real markup into the shared fake DOM, loads the page's own
	<script src> chain (engine → runtime → games/gamble.js) in its own order,
	runs its author script and drives real scroll positions through the reader
	paths that matter:

	  cold load + slow read     → both seats pay the ×0.5 the reader called
	  cold load + flick         → both pay the game's declared default ×2
	  jump over a seat          → it defaults, the other stays playable
	  a fresh visit with a save → the recorded call is replayed as `saved`
	  re-reading / re-passing   → overwrite the factor, never stack it
	  save ↓ / load ↑ / clear   → round-trip, and back to the identity
	  the page's own self-test  → run through its button, no FAIL
	  runtime absent            → prose, no throw, SKIP

	`node test/demo-minigame.js [file.html]`, or via `node test/run.js`. */
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
	if (node.tag === 'section') return Math.max(224, 32 + inner + 32);
	if (node.tag === 'div' && cls.indexOf('game') >= 0) return Math.max(208, 16 + inner + 16);
	if (node.tag === 'h1') return 44;
	if (node.tag === 'h2') return 39;
	if (node.tag === 'p') return PMARGIN + lines(FD.nodeText(node)) * LINE + PMARGIN;
	return inner;
}

/* ---------------- the page's own probes ---------------- */
function openPage(source, withEngine) {
	const p = FD.buildPage(source, VH, { measure: measure, engine: withEngine, dir: ROOT });
	const byId = p.byId;
	p.purse = () => byId['purse'].textContent;
	p.breakdown = () => byId['breakdown'].textContent;
	p.summary = () => byId['breakdown'].textContent + ' | purse ' + byId['purse'].textContent;
	p.mounts = () => p.win.demoMinigame.mounts();
	p.call = (k, v) => {
		const b = byId['game-' + k].querySelector('button[data-v="' + v + '"]');
		if (!b) return false;
		b.click();
		return true;
	};
	p.painted = () => !!FD.queryAll(p.doc.body, '.game button').length;
	p.waiting = k => !!byId['game-' + k].querySelector('button');
	p.play = (k, v) => {
		for (let yy = p.win.scrollY; yy < p.bottom(); yy += 200) {
			p.win.setScroll(yy);
			if (p.call(k, v)) return true;
		}
		p.win.setScroll(p.bottom());
		return p.call(k, v);
	};
	p.readDown = (step, v) => {
		for (let yy = 0; yy < p.bottom(); yy += step) {
			p.win.setScroll(yy);
			if (v !== undefined) for (let k = 1; k <= 2; k++) p.call(k, v);
		}
		p.win.setScroll(p.bottom());
		if (v !== undefined) for (let k = 1; k <= 2; k++) p.call(k, v);
	};
	p.walkUp = step => { for (let yy = p.bottom(); yy > 0; yy -= step) p.win.setScroll(yy); p.win.setScroll(0); };
	return p;
}

/* ==================================================================== */
const file = process.argv[2] || path.join(ROOT, 'demo-minigame.html');
const source = fs.readFileSync(file, 'utf8');
console.log('demo-minigame: ' + path.relative(ROOT, file) + '  (fake DOM, vh ' + VH + ')');

/* 1. the page loads its own chain and plays live */
{
	const p = openPage(source, true);
	ok(p.S && p.S.events, 'the engine boots on the page');
	ok(p.mods['snowfall-games.js'], 'the page loads the minigame runtime');
	ok(p.mods['gamble.js'], 'and the example game file');
	ok(p.win.SnowfallGames && p.win.SnowfallGames.get('gamble'), 'the coin registered itself');
	eq(p.S.product('mult.'), 1, 'a cold load folds nothing yet');
	eq(p.purse(), '100', 'so the purse is the starting 100');
	p.readDown(200, 0.5);
	eq(p.purse(), '25', 'a slow read calling ×0.5 twice: 100 × 0.5 × 0.5', p.summary());
	eq(p.breakdown(), 'g1=×0.5 live · g2=×0.5 live', 'and labels both seats live');
	eq(p.mounts(), 2, 'each seat painted its coin exactly once');
	eq(p.S.product('mult.'), 0.25, 'the store folds to the same number the HUD shows');
}

/* 2. a flick pays the game's own default and paints nothing */
{
	const p = openPage(source, true);
	const atLoad = p.mounts();                 /* seat 1's anchor is in the load viewport */
	eq(atLoad, 1, 'the seat standing on the first screen mounted at load');
	p.win.setScroll(0);
	p.win.setScroll(p.bottom());
	eq(p.purse(), '400', 'a flick pays the declared ×2 at both seats', p.summary());
	eq(p.breakdown(), 'g1=×2 default · g2=×2 default', 'and labels them default');
	ok(!p.painted(), 'the flick painted no coin');
	eq(p.mounts(), atLoad, 'the flick itself mounted no game');
	eq(p.S.product('mult.'), 4, 'product("mult.") is what the purse is drawn from');
	const st = p.store();
	eq(st.keys['mult.g1'], 2, 'the engine records the fallback a skipped seat pays');
	eq(st.defaults['mult.g1'], 1, 'and marks it a default, not the reader\'s own call');
	eq(Object.keys(st.vars).length, 0, 'the page keeps no score of its own — vars stay empty');
}

/* 3. jumping to a seat leaves the one above to its default */
{
	const p = openPage(source, true);
	ok(p.play(1, 0.5), 'seat 1 is playable');
	p.win.setScroll(p.el('ch2').offsetTop);
	eq(p.breakdown(), 'g1=×0.5 live · g2=idle', 'the jumped-to seat has not resolved yet', p.summary());
	ok(p.play(2, 2), 'and still offers its coin');
	eq(p.purse(), '100', 'one ×0.5 and one ×2 leave the purse where it started', p.summary());
}

/* 4. a fresh visit replays the recorded call as saved */
{
	const p = openPage(source, true);
	ok(p.play(1, 2), 'seat 1 is played live, seat 2 never read');
	eq(p.purse(), '200', 'only seat 1 has a factor so far', p.summary());
	p.win.scrollTo(0, 0);
	p.S.refresh(true);                         /* same store, latches re-armed */
	p.win.setScroll(p.bottom());
	eq(p.breakdown(), 'g1=×2 saved · g2=×2 default', 'the skipped seat replays its own call');
	eq(p.purse(), '400', 'recorded ×2 and a default ×2', p.summary());
	ok(!p.store().defaults['mult.g1'], 'a played seat carries no default mark');
	eq(p.S.product('mult.g1'), 2, 'so its factor counts exactly once');
}

/* 5. re-reading overwrites the factor, re-passing keeps it */
{
	const p = openPage(source, true);
	p.readDown(200, 0.5);
	eq(p.purse(), '25', 'first pass 25');
	p.walkUp(200);
	p.readDown(200, 2);
	/* seat 1's anchor sits inside the load viewport, so the engine keeps it
	   latched: a re-pass re-arms only a seat that left through the bottom.
	   Whichever seat re-offers, its factor is replaced — never multiplied in
	   on top of the earlier pass. */
	eq(p.breakdown(), 'g1=×0.5 live · g2=×2 live', 'the re-armed seat took the new call, the latched one kept its own', p.summary());
	eq(p.purse(), '100', '0.5 × 2 — the passes did not stack', p.summary());
	eq(p.S.store.counts.keys, 2, 'still exactly one recorded factor per seat');
	p.walkUp(200);
	p.readDown(200);
	eq(p.purse(), '100', 're-passing without answering keeps the record', p.summary());
}

/* 6. save ↓ / load ↑ / clear save */
{
	const p = openPage(source, true);
	p.readDown(200, 0.5);
	const json = p.S.exportJSON(), purse = p.purse();
	p.S.reset();
	ok(p.S.importJSON(json), 'import accepts the exported save');
	eq(p.purse(), purse, 'export → reset → import round-trips the purse');
	p.el('clearBtn').onclick();
	const cleared = p.store();
	eq(Object.keys(cleared.keys).length + Object.keys(cleared.defaults).length, 0,
		'clear save drops outcomes and default marks');
	eq(p.purse(), '100', 'clear save folds back to the identity, not to zero');
	ok(FD.queryAll(p.doc.body, '.game .gamble-out').length === 0, 'no resolved seat text survives clear save');
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

/* 8. runtime absent: prose, no throw, SKIP */
{
	const p = openPage(source, false);
	let threw = null, threw2 = null;
	try { p.el('selfBtn').onclick(); } catch (e) { threw = e; }
	try { p.win.askGamble(1); } catch (e) { threw2 = e; }
	ok(!threw, 'the author script survives an absent runtime', threw && threw.message);
	ok(!threw2, 'askGamble is a quiet no-op without it', threw2 && threw2.message);
	ok(/SKIP/.test(p.el('qa').textContent), 'the self-test reports SKIP without the runtime');
	ok(/<b id="purse">100<\/b>/.test(source), 'the page ships a literal purse for that case');
}

console.log('demo-minigame: ' + (checks - fails) + '/' + checks + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
