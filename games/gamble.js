/* games/gamble.js — example minigame: the coin that doubles or halves the
   purse. Two buttons, ×0.5 and ×2, and a declared default of ×2 — a reader
   who scrolls past without playing is paid the generous outcome, because the
   fallback is the engine's to resolve and this game is the one that declares
   what walking away is worth.

   One file, one table, two functions. run() paints the live UI and answers;
   result() paints whatever the engine resolved — the reader's click, their own
   earlier play, or the default. The store key, the purse and the HUD stay with
   the page: this game only ever reports a factor.

   Loads after snowfall.js and snowfall-games.js; require()-able under node,
   where it exports the same table it registered. */
(function(global) {
'use strict';
const G = global.SnowfallGames;
if (!G || typeof G.add !== 'function') {
	console.error('games/gamble.js needs snowfall-games.js loaded before it');
	return;
}
const HALF = 0.5, DOUBLE = 2;

function chooser(g) {
	return function(ev) {
		const t = ev.target;
		const v = t && t.getAttribute ? +t.getAttribute('data-v') : NaN;
		if (v === HALF || v === DOUBLE) g.answer(v);
	};
}

function verdict(value, mode) {
	if (mode === 'default') return 'you walked away — the house pays';
	if (mode === 'saved') return 'your earlier call stands';
	return value >= 1 ? 'the coin lands your way' : 'the coin lands against you';
}

const spec = {
	id: 'gamble',
	title: 'double or halve',
	fallback: DOUBLE,
	css: 'games/gamble.css',

	run: function(g) {
		const ask = g.opts.ask || 'The coin is in the air. Call it.';
		/* one wrapper with a reserved height: the mount never changes flow
		   height between idle, live and resolved, so no anchor below shifts */
		g.el.innerHTML = '<div class="gamble">'
			+ '<p class="gamble-ask">' + ask + '</p>'
			+ '<p class="gamble-row">'
			+ '<button type="button" class="gamble-bust" data-v="' + HALF + '">lose half · ×' + HALF + '</button>'
			+ '<button type="button" class="gamble-win" data-v="' + DOUBLE + '">double it · ×' + DOUBLE + '</button>'
			+ '</p></div>';
		const click = chooser(g);
		const btns = g.el.querySelectorAll('button[data-v]');
		for (let i = 0; i < btns.length; i++) btns[i].addEventListener('click', click);
	},

	result: function(g, value, mode) {
		g.el.innerHTML = '<div class="gamble">'
			+ '<p class="gamble-out ' + (value >= 1 ? 'is-win' : 'is-bust') + '">'
			+ verdict(value, mode) + ' · purse <b>×' + value + '</b> <small>(' + mode + ')</small></p></div>';
	}
};

G.add(spec);
if (typeof module !== 'undefined' && module.exports) module.exports = spec;
})(typeof window !== 'undefined' ? window : globalThis);
