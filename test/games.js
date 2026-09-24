#!/usr/bin/env node
/* test/games.js — 0.6 minigame gate: Snowfall.product() over recorded
	outcomes, the SnowfallGames registry and session runner, and the shipped
	example game games/gamble.js.

	Part 1 runs the engine headless, the way test/scripts.js does. Part 2 boots
	the real engine on a synthetic page in the shared fake DOM and drives the
	reader paths through real scroll positions: a live play, a double answer, a
	flick that must paint no UI, a replay of the reader's own call, and the
	drop a refresh() forces. Part 3 loads the example game and clicks its
	buttons.

	`node test/games.js`, or via `node test/run.js`. */
'use strict';
const path = require('path');
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

/* capture console.warn/error without losing the text when a check fails */
let warned = [];
function quiet(fn) {
	const w = console.warn, e = console.error;
	warned = [];
	console.warn = function() { warned.push(Array.from(arguments).join(' ')); };
	console.error = console.warn;
	try { return fn(); }
	finally { console.warn = w; console.error = e; }
}

/* ====================================================================
   PART 1 — product(), headless
   ==================================================================== */
delete require.cache[require.resolve(path.join(ROOT, 'snowfall.js'))];
const S1 = require(path.join(ROOT, 'snowfall.js'));

ok(typeof S1.product === 'function', 'Snowfall.product exists');
S1.reset();
eq(S1.product('mult.'), 1, 'nothing recorded is the identity 1, not 0');
eq(S1.product(), 1, 'an empty store with no prefix is 1 too');
S1.ask('mult.a', 2, null, function() {});
S1.answer('mult.a', 2);
S1.ask('mult.b', 2, null, function() {});
S1.answer('mult.b', 0.5);
eq(S1.product('mult.'), 1, '×2 then ×0.5 folds back to 1');
eq(S1.sum('mult.'), 2.5, 'sum still adds the same keys (2 + 0.5)');
S1.set('gold.pay', 40);
eq(S1.product('mult.'), 1, 'a prefix isolates the fold from other keys');
eq(S1.product('gold.'), 40, 'product reads author vars like sum does');
S1.set('mult.label', 'double');
eq(S1.product('mult.'), 1, 'a non-numeric value is skipped, not multiplied in');
S1.ask('mult.c', 2, null, function() {});
S1.answer('mult.c', 4);
eq(S1.product('mult.'), 4, 'a third factor folds in: 2 × 0.5 × 4');
S1.ask('mult.c', 2, null, function() {});
S1.answer('mult.c', 1);
eq(S1.product('mult.'), 1, 're-answering one key overwrites its factor, never stacks');
{
	const json = S1.exportJSON(), before = S1.product('mult.');
	S1.reset();
	eq(S1.product('mult.'), 1, 'reset clears the fold');
	ok(S1.importJSON(json), 'import accepts the exported save');
	eq(S1.product('mult.'), before, 'export → reset → import round-trips the product');
}

/* ====================================================================
   PART 2 — the runtime on a real engine, in the fake DOM
   ==================================================================== */
function measure(node, vh, inner) {
	const cls = (node.attrs.class || '').split(/\s+/).filter(Boolean);
	if (cls.indexOf('spacer') >= 0) return vh;
	if (node.tag === 'section') return Math.max(224, 32 + inner + 32);
	if (node.tag === 'div' && cls.indexOf('game') >= 0) return Math.max(176, 16 + inner + 16);
	if (node.tag === 'h2') return 39;
	if (node.tag === 'p') return 16 + Math.max(1, Math.ceil(FD.nodeText(node).trim().length / 58)) * 26 + 16;
	return inner;
}

/* the page's own author script: one probe game that counts its lifecycle and
   keeps a handle on the session, plus the seat() the event snippets call */
const AUTHOR = '<script>\n'
	+ 'window.seats = { calls: 0, runs: 0, cleans: 0, live: {}, done: {}, g: null };\n'
	+ 'SnowfallGames.add({\n'
	+ '\tid: "probe", title: "probe", fallback: 2,\n'
	+ '\trun: function(g) {\n'
	+ '\t\twindow.seats.runs++; window.seats.g = g;\n'
	+ '\t\tg.el.innerHTML = \'<button type="button" data-v="0.5">half</button>\'\n'
	+ '\t\t\t+ \'<button type="button" data-v="2">double</button>\';\n'
	+ '\t\tvar b = g.el.querySelectorAll("button");\n'
	+ '\t\tfor (var i = 0; i < b.length; i++)\n'
	+ '\t\t\tb[i].addEventListener("click", function(ev) { g.answer(+ev.target.getAttribute("data-v")); });\n'
	+ '\t\treturn function() { window.seats.cleans++; };\n'
	+ '\t}\n'
	+ '});\n'
	+ 'window.seat = function(k) {\n'
	+ '\twindow.seats.calls++;\n'
	+ '\twindow.seats.live[k] = SnowfallGames.play(window.GAME || "probe", {\n'
	+ '\t\tel: document.getElementById("m" + k), key: "mult.g" + k,\n'
	+ '\t\tdone: function(v, mode) { window.seats.done[k] = v + " " + mode; }\n'
	+ '\t});\n'
	+ '};\n'
	+ '</script>';

/* the trailing spacer is load-bearing for the gate: without it the last seat's
   anchor sits at max scroll, where it is inside the viewport and fires `view`
   instead of `skip` — the flick scenario would mount a game by accident */
function pageSource(extra) {
	return '<!doctype html><html data-story="games-gate"><head></head><body>'
		+ '<div id="app">'
		+ '<section id="s1"><h2>one</h2><p>the first seat</p>'
		+ '<div class="game" id="m1"><p class="idle">idle 1</p></div>'
		+ '<script type="txt" event="view,skip">window.seat && window.seat(1)</script></section>'
		+ '<div class="spacer"></div><div class="spacer"></div>'
		+ '<section id="s2"><h2>two</h2><p>the second seat</p>'
		+ '<div class="game" id="m2"><p class="idle">idle 2</p></div>'
		+ '<script type="txt" event="view,skip">window.seat && window.seat(2)</script></section>'
		+ '<div class="spacer"></div>'
		+ '</div>'
		+ '<script src="snowfall.js"></script><script src="snowfall-games.js"></script>'
		+ (extra || '') + AUTHOR + '</body></html>';
}
function open(extra) {
	return FD.buildPage(pageSource(extra), VH, { measure: measure, dir: ROOT });
}
const G = () => global.SnowfallGames;

/* 2.1 a seat standing in the load viewport is playable on the first frame */
{
	const p = open();
	ok(p.S && p.S.events, 'the engine boots on the page');
	ok(G(), 'the runtime is on the page');
	eq(G().ids().join(), 'probe', 'the page registered its game');
	eq(p.win.seats.calls, 1, 'seat 1 fired its view at load', 'calls=' + p.win.seats.calls);
	eq(p.win.seats.live[1], true, 'play() reports a live game');
	eq(G().live, 1, 'the runner counts the waiting session');
	eq(p.byId['m1'].querySelectorAll('button').length, 2, 'the game painted its two buttons');
	ok(p.byId['m1'].classList.contains('snow-game-live'), 'the mount is marked live');
	ok(!p.byId['m1'].classList.contains('snow-game-done'), 'and not yet done');
	eq(p.win.seats.done[1], undefined, 'nothing has resolved yet');
}

/* 2.2 a click resolves through the store, exactly once, and tears down */
{
	const p = open();
	p.byId['m1'].querySelector('button[data-v="0.5"]').click();
	eq(p.win.seats.done[1], '0.5 live', 'the click resolved live with the game\'s value');
	eq(p.win.seats.cleans, 1, 'the cleanup run() returned ran exactly once');
	eq(G().live, 0, 'no session is left waiting');
	ok(p.byId['m1'].classList.contains('snow-game-done'), 'the mount is marked done');
	eq(p.byId['m1'].querySelectorAll('button').length, 0, 'the buttons are gone');
	ok(/probe/.test(p.byId['m1'].innerHTML) && /0\.5/.test(p.byId['m1'].innerHTML),
		'the runner painted its default result line', p.byId['m1'].innerHTML);
	eq(p.S.product('mult.'), 0.5, 'the outcome is in the store, so product() sees it');
	eq(p.S.store.counts.keys, 1, 'and it is the only recorded key');
	quiet(() => p.win.seats.g.answer(2));
	eq(p.win.seats.done[1], '0.5 live', 'a second answer changes nothing');
	ok(warned.join().indexOf('answered twice') >= 0, 'and warns instead: ' + warned.join('|'));
	eq(p.S.product('mult.'), 0.5, 'the store still holds one factor');
}

/* 2.3 a page-supplied fallback beats the game's own — for the slot it opens */
{
	const p = open();
	p.win.seat = function(k) {
		p.win.seats.live[k] = G().play('probe', {
			el: p.byId['m' + k], key: 'mult.g' + k, fallback: 0.5,
			done: function(v, mode) { p.win.seats.done[k] = v + ' ' + mode; }
		});
	};
	p.win.setScroll(p.bottom());
	eq(p.win.seats.done[1], '2 default',
		'seat 1 was pending from the load-time view, so it pays the game default it was asked with');
	eq(p.win.seats.done[2], '0.5 default', 'seat 2, opened through the override, pays the page fallback');
}

/* 2.4 a flick paints no UI and still pays the game's own default */
{
	const p = open();
	const runs = p.win.seats.runs;                 /* seat 1 painted at load */
	p.win.setScroll(p.bottom());
	eq(p.win.seats.done[1], '2 default', 'the abandoned seat pays the game default ×2');
	eq(p.win.seats.done[2], '2 default', 'the skipped seat pays it too');
	eq(p.win.seats.runs, runs, 'the flick itself mounted no game');
	eq(FD.queryAll(p.doc.body, '.game button').length, 0, 'no coin is left waiting for a click');
	eq(G().live, 0, 'no session is left waiting');
	eq(p.S.product('mult.'), 4, 'so the purse is 2 × 2 without a single click');
	{
		const st = p.store();
		eq(st.keys['mult.g1'], 2, 'the fallback a skipped seat pays is recorded in keys');
		eq(st.defaults['mult.g1'], 1, 'and marked a default, so the label stays honest');
	}
}

/* 2.5 a later visit replays the reader's own call as saved */
{
	const p = open();
	p.byId['m1'].querySelector('button[data-v="0.5"]').click();
	eq(p.S.product('mult.'), 0.5, 'the live call is recorded');
	p.win.setScroll(p.bottom());
	p.win.scrollTo(0, 0);
	p.S.refresh(true);
	p.win.setScroll(p.bottom());
	eq(p.win.seats.done[1], '0.5 saved', 'the recorded call is replayed, labelled saved');
	eq(p.S.product('mult.g1'), 0.5, 'and the seat 1 factor is applied exactly once');
}

/* 2.6 refresh() drops a live session: cleanup runs, the idle markup returns,
   and the measure-only subscriber needs no frame() to be legal */
{
	const p = open();
	eq(G().live, 1, 'seat 1 is waiting before the refresh');
	const cleans = p.win.seats.cleans, runs = p.win.seats.runs;
	p.S.setEnabled(false);                         /* no frame, so the drop stands alone */
	p.S.refresh();
	eq(G().live, 0, 'the refresh dropped the waiting session');
	eq(p.win.seats.cleans, cleans + 1, 'its cleanup ran');
	ok(/idle 1/.test(p.byId['m1'].innerHTML), 'the idle markup is back', p.byId['m1'].innerHTML);
	ok(!p.byId['m1'].classList.contains('snow-game-live'), 'and the live mark is gone');
	p.S.setEnabled(true);
	p.S.step(0);
	eq(p.win.seats.runs, runs + 1, 'the seat still on screen re-armed and mounted again');
	eq(G().live, 1, 'one session waits again');
}

/* 2.7 misuse is diagnosed, never thrown */
{
	const p = open();
	eq(quiet(() => G().play('nope', { el: p.byId['m1'], key: 'mult.x' })), false,
		'an unknown game id returns false');
	ok(warned.join().indexOf('no such game') >= 0, 'and says which: ' + warned.join('|'));
	eq(quiet(() => G().play('probe', { key: 'mult.x' })), false, 'a missing mount returns false');
	ok(warned.join().indexOf('mount element') >= 0, 'and says why');
	G().add({ id: 'nofb', run: function() {} });
	eq(quiet(() => G().play('nofb', { el: p.byId['m1'], key: 'mult.x' })), false,
		'a game with no fallback anywhere returns false');
	ok(warned.join().indexOf('no fallback') >= 0, 'and asks for one');
	eq(quiet(() => G().add({ id: 'probe', run: function() {} })), false, 'a duplicate id is refused');
	eq(quiet(() => G().add({ id: 'norun' })), false, 'a game with no run() is refused');
	eq(G().get('probe').title, 'probe', 'get() hands back the registered table');
	eq(G().get('absent'), undefined, 'and undefined for one that is not there');
}

/* 2.8 a game that grows its mount is told, once, because every anchor below
   the mount was measured once at load */
{
	const p = open();
	G().add({ id: 'grower', fallback: 1, run: function(g) { g.el._h = 500; } });
	quiet(() => G().play('grower', { el: p.byId['m2'], key: 'mult.grow' }));
	ok(warned.join().indexOf('flow height') >= 0, 'growing the mount warns: ' + warned.join('|'));
}

/* 2.9 the runtime alone, with no engine on the page, is inert */
{
	const p = FD.buildPage('<!doctype html><html data-story="games-noengine"><head></head><body>'
		+ '<div id="app"><div class="game" id="m1"><p class="idle">idle</p></div></div>'
		+ '<script src="snowfall-games.js"></script>' + AUTHOR + '</body></html>',
		VH, { measure: measure, dir: ROOT });
	ok(G(), 'the runtime loads without the engine');
	eq(quiet(() => G().play('probe', { el: p.byId['m1'], key: 'mult.g1', fallback: 2 })), false,
		'play() is a quiet no-op with no engine');
	eq(warned.length, 0, 'and warns about nothing: ' + warned.join('|'));
	eq(p.byId['m1'].querySelectorAll('button').length, 0, 'it paints no UI');
}

/* 2.10 stylesheets: inline and external, injected once per game */
{
	const p = FD.buildPage('<!doctype html><html data-story="games-css"><head></head><body>'
		+ '<div id="app"><div class="game" id="m1"><p class="idle">idle</p></div></div>'
		+ '<script src="snowfall.js"></script><script src="snowfall-games.js"></script>'
		+ '<script>SnowfallGames.add({ id: "inline", cssText: ".inline{color:red}", run: function(){} });\n'
		+ 'SnowfallGames.add({ id: "linked", css: "games/gamble.css", run: function(){} });</script>'
		+ '</body></html>', VH, { measure: measure, dir: ROOT });
	const st = p.doc.head.querySelectorAll('style[data-snow-game]');
	const lk = p.doc.head.querySelectorAll('link[data-snow-game]');
	eq(st.length, 1, 'cssText became one <style> in <head>');
	eq(st[0] && st[0].textContent, '.inline{color:red}', 'carrying the game\'s CSS');
	eq(lk.length, 1, 'css became one <link> in <head>');
	eq(lk[0] && lk[0].getAttribute('href'), 'games/gamble.css', 'pointing at the external sheet');
	eq(lk[0] && lk[0].getAttribute('data-snow-game'), 'linked', 'tagged with the game id');
}

/* ====================================================================
   PART 3 — the shipped example game, clicked
   ==================================================================== */
{
	const p = open('<script src="games/gamble.js"></script><script>window.GAME = "gamble";</script>');
	ok(G().get('gamble'), 'games/gamble.js registered itself');
	eq(G().get('gamble').fallback, 2, 'the coin declares its own default: ×2');
	eq(G().get('gamble').css, 'games/gamble.css', 'and its own external stylesheet');
	eq(G().ids().join(), 'gamble,probe', 'both games are in the registry, in load order');
	const btns = p.byId['m1'].querySelectorAll('button[data-v]');
	eq(btns.length, 2, 'the coin offers exactly two calls');
	eq(btns.map(b => b.getAttribute('data-v')).join(), '0.5,2', '×0.5 and ×2');
	ok(p.byId['m1'].querySelector('.gamble'), 'painted inside its own height-reserved wrapper');
	p.byId['m1'].querySelector('button[data-v="2"]').click();
	eq(p.S.product('mult.g1'), 2, 'calling ×2 records 2');
	ok(/coin lands your way/.test(p.byId['m1'].innerHTML), 'the game painted its own result',
		p.byId['m1'].innerHTML);
	p.win.setScroll(p.bottom());
	eq(p.win.seats.done[2], '2 default', 'the second seat, skipped, pays the same ×2');
	ok(/walked away/.test(p.byId['m2'].innerHTML), 'and says so', p.byId['m2'].innerHTML);
	eq(p.S.product('mult.'), 4, 'two factors fold into ×4');
}

console.log('games: ' + (checks - fails) + '/' + checks + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
