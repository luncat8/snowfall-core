/* snowfall-games.js — 0.6 minigame runtime: the registry plus the session
   runner that turns one Snowfall.ask slot into a playable game.

   A game is a plain descriptor table, not a class — {id, css, run, result}.
   That is the shape the engine's own extension point already has
   (Snowfall.use({measure, frame, off})), so a game file stays a flat table
   with one behaviour: no base class of empty hooks to inherit, no `new`, no
   parent global that must load first, and the file still require()s under
   node for the gates. Inheritance would buy nothing here — there is exactly
   one implementation per game, and the state that matters (the store key, the
   skip branch, teardown) belongs to the runner, not to a base class.

   The runner owns everything a game must not: the store key, the skip/replay
   branch, teardown when the reader leaves, the mount's class list. A game
   paints into g.el and calls g.answer(value); it never sees Snowfall.ask or
   Snowfall.answer, so every game inherits the engine's resolution rules —
   live, saved, default — for free.

   Load order in a story page (all classic <script>):
   snowfall.js → snowfall-games.js → games/<id>.js */
(function(global) {
'use strict';
const hasDOM = typeof document !== 'undefined';
const NULL_OPTS = Object.freeze({});
const games = {};
const order = [];
const live = [];          /* sessions waiting for the reader, in mount order */
let subscribed = false, grewWarned = false;

function engine() {
	const S = global.Snowfall;
	return S && typeof S.ask === 'function' && typeof S.answer === 'function' ? S : null;
}

/* A game's stylesheet is injected at registration, while the document is
   still parsing, so it is in place before the engine measures its first
   anchors. `css` resolves against the page, not against the game file —
   classic scripts have no module URL. */
function injectCSS(spec) {
	if (!hasDOM || spec.cssNode || !document.head) return;
	let node = null;
	if (spec.cssText) {
		node = document.createElement('style');
		node.textContent = spec.cssText;
	} else if (spec.css) {
		node = document.createElement('link');
		node.rel = 'stylesheet';
		node.href = spec.css;
		/* a sheet that lands after the first measure moves every anchor the
		   engine measured: re-measure once it is really there */
		node.addEventListener('load', function() {
			if (global.Snowfall && global.Snowfall.default) global.Snowfall.refresh();
		});
	}
	if (!node) return;
	node.setAttribute('data-snow-game', spec.id);
	document.head.appendChild(node);
	spec.cssNode = node;
}

/* run() may return a cleanup function; it runs exactly once, on resolution or
   on the drop below, and it is where a timed game cancels its own ticker. */
function teardown(g) {
	if (typeof g.undo === 'function') {
		try { g.undo(); }
		catch (e) { console.error('SnowfallGames: ' + g.id + ' cleanup threw', e); }
	}
	g.undo = null;
	if (g.el.classList) g.el.classList.remove('snow-game-live');
}

function defaultResult(g, value, mode) {
	const spec = games[g.id];
	const label = spec && spec.title ? spec.title : g.id;
	g.el.innerHTML = '<p class="snow-game-out">' + label
		+ ' · <b>' + value + '</b> <small>(' + mode + ')</small></p>';
}

/* Snowfall.refresh() discards pending asks without resolving them, so a live
   session must not outlive the measure that dropped its slot: stop its timers
   and put the idle markup back. An anchor still on screen re-fires its own
   snippet on the next frame and remounts; anything else rests idle. */
function dropAll() {
	for (let i = live.length - 1; i >= 0; i--) {
		const g = live[i];
		live.splice(i, 1);
		g.live = false;
		teardown(g);
		g.el.innerHTML = g.idle;
	}
}

function subscribe(S) {
	if (subscribed || !S.default || typeof S.use !== 'function') return;
	subscribed = true;
	S.use({ measure: dropAll });
}

function add(spec) {
	if (!spec || typeof spec !== 'object') {
		console.warn('SnowfallGames.add: expected a game table');
		return false;
	}
	const id = typeof spec.id === 'string' ? spec.id.trim() : '';
	if (!id) {
		console.warn('SnowfallGames.add: a game needs an id');
		return false;
	}
	if (typeof spec.run !== 'function') {
		console.warn('SnowfallGames.add: ' + id + ' has no run()');
		return false;
	}
	if (games[id]) {
		console.warn('SnowfallGames.add: ' + id + ' is already registered');
		return false;
	}
	spec.id = id;
	games[id] = spec;
	order.push(id);
	injectCSS(spec);
	return true;
}

/* play(id, o) — o: {el, key, fallback, opts, done}. Returns true while the
   game is on screen waiting for the reader, false when it resolved inside the
   call (a skip or a replay) or could not run at all. `done(value, mode)` runs
   exactly once per resolution, in every mode, which is the page's only hook
   into the outcome — the same contract as Snowfall.ask's continuation.
   `fallback` is what a skipped or abandoned slot pays: the page's if given,
   else the game's own, because walking away is part of a game's rules. */
function play(id, o) {
	const spec = games[id];
	o = o || {};
	if (!spec) {
		console.warn('SnowfallGames.play: no such game: ' + id);
		return false;
	}
	const el = o.el;
	if (!el || !el.appendChild) {
		console.warn('SnowfallGames.play: ' + id + ' needs a mount element');
		return false;
	}
	const fallback = o.fallback !== undefined ? o.fallback : spec.fallback;
	if (fallback === undefined) {
		console.warn('SnowfallGames.play: ' + id + ' declares no fallback for the skip path');
		return false;
	}
	const S = engine();
	if (!S || !o.key) return false;            /* no engine, no key: stay idle */
	subscribe(S);
	if (el.classList) el.classList.add('snow-game');

	const g = {
		id: id, el: el, key: o.key, opts: o.opts || NULL_OPTS,
		live: true, value: undefined, mode: '', undo: null, idle: ''
	};
	let mounted = false;

	function resolve(value, mode) {
		const i = live.indexOf(g);
		if (i >= 0) live.splice(i, 1);
		g.live = false;
		g.value = value;
		g.mode = mode;
		if (mounted) teardown(g);
		if (el.classList) {
			el.classList.remove('snow-game-live');
			el.classList.add('snow-game-done');
		}
		if (typeof spec.result === 'function') {
			try { spec.result(g, value, mode); }
			catch (e) { console.error('SnowfallGames: ' + id + ' result threw', e); }
		} else defaultResult(g, value, mode);
		if (typeof o.done === 'function') {
			try { o.done(value, mode); }
			catch (e) { console.error('SnowfallGames: ' + id + ' done threw for key ' + g.key, e); }
		}
	}

	g.answer = function(value) {
		if (!g.live) {
			console.warn('SnowfallGames: ' + id + ' answered twice for ' + g.key);
			return;
		}
		S.answer(g.key, value);                /* → resolve(value, 'live') */
	};

	S.ask(g.key, fallback, null, resolve);
	if (!g.live) return false;                 /* resolved in ask: never paint a UI */

	/* the reader can act, so this is the only branch that paints one */
	g.idle = el.innerHTML || '';
	if (el.classList) {
		el.classList.remove('snow-game-done');
		el.classList.add('snow-game-live');
	}
	const h0 = el.offsetHeight || 0;
	el.innerHTML = '';
	mounted = true;
	try {
		const undo = spec.run(g);
		if (typeof undo === 'function') g.undo = undo;
	} catch (e) {
		console.error('SnowfallGames: ' + id + ' run threw', e);
	}
	if (!g.live) return false;                 /* run() answered itself; already torn down */
	live.push(g);
	if ((el.offsetHeight || 0) !== h0) warnGrew(id);
	return true;
}

function warnGrew(id) {
	if (grewWarned) return;
	grewWarned = true;
	console.warn('SnowfallGames: ' + id + ' changed its mount\'s flow height — reserve it in CSS'
		+ ' (min-height) or call Snowfall.refresh() outside the fire, or every anchor below shifts');
}

const api = {
	version: '0.6.0',
	add: add,
	play: play,
	get: function(id) { return games[id]; },
	ids: function() { return order.slice(); }
};
Object.defineProperty(api, 'live', { get: function() { return live.length; } });

global.SnowfallGames = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
