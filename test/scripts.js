#!/usr/bin/env node
/* test/scripts.js — 0.4.1 script policies, choices and save slots gate.
	Tests store persistence, scalar filtering, story prefix, and the
	once / both / skip / ask state machine under synthetic scroll sequences.
	Directly executable or via `node test/run.js`. */
'use strict';
const path = require('path');

let checks = 0, fails = 0;
function ok(cond, name, detail) {
	checks++;
	if (cond) return;
	fails++;
	console.error('FAIL ' + name + (detail ? ' — ' + detail : ''));
}
function eq(a, b, name) { ok(a === b, name, '(' + a + ' vs ' + b + ')'); }

/* ====================================================================
   PART 1: Pure Store Tests (Node environment, in-memory)
   ==================================================================== */

// Clear cache and load Snowfall in Node
delete require.cache[require.resolve('../snowfall.js')];
const Snowfall = require('../snowfall.js');

ok(Snowfall, 'Snowfall loaded in node');
ok(typeof Snowfall.get === 'function', 'Snowfall.get exists');
ok(typeof Snowfall.set === 'function', 'Snowfall.set exists');
ok(typeof Snowfall.sum === 'function', 'Snowfall.sum exists');
ok(typeof Snowfall.ask === 'function', 'Snowfall.ask exists');
ok(typeof Snowfall.answer === 'function', 'Snowfall.answer exists');
ok(typeof Snowfall.save === 'function', 'Snowfall.save exists');
ok(typeof Snowfall.load === 'function', 'Snowfall.load exists');
ok(typeof Snowfall.exportJSON === 'function', 'Snowfall.exportJSON exists');
ok(typeof Snowfall.importJSON === 'function', 'Snowfall.importJSON exists');
ok(typeof Snowfall.reset === 'function', 'Snowfall.reset exists');
ok(Snowfall.store !== undefined, 'Snowfall.store exists');

// Initial reset
Snowfall.reset();
eq(Snowfall.store.counts.vars, 0, 'initial vars count 0');
eq(Snowfall.store.counts.keys, 0, 'initial keys count 0');
eq(Snowfall.store.counts.fired, 0, 'initial fired count 0');

// 1.1 Scalar filtering
{
	const origWarn = console.warn;
	let warns = [];
	console.warn = function() { warns.push(Array.from(arguments).join(' ')); };

	Snowfall.set('str', 'hello');
	eq(Snowfall.get('str'), 'hello', 'string scalar stored');

	Snowfall.set('num', 42);
	eq(Snowfall.get('num'), 42, 'integer scalar stored');

	Snowfall.set('float', 3.1415);
	eq(Snowfall.get('float'), 3.1415, 'float scalar stored');

	Snowfall.set('boolTrue', true);
	eq(Snowfall.get('boolTrue'), true, 'bool true stored');

	Snowfall.set('boolFalse', false);
	eq(Snowfall.get('boolFalse'), false, 'bool false stored');

	Snowfall.set('nullVal', null);
	eq(Snowfall.get('nullVal'), null, 'null scalar stored');

	// Fallback check
	eq(Snowfall.get('nonexistent', 'fallback123'), 'fallback123', 'fallback returned for missing key');
	eq(Snowfall.get('boolFalse', 'fallback123'), false, 'falsy value not replaced by fallback');
	eq(Snowfall.get('nullVal', 'fallback123'), null, 'null value not replaced by fallback');

	// Rejections: non-scalars
	warns.length = 0;
	Snowfall.set('obj', { a: 1 });
	eq(Snowfall.get('obj'), undefined, 'object rejected');
	ok(warns.length > 0, 'warning logged for object');

	warns.length = 0;
	Snowfall.set('arr', [1, 2, 3]);
	eq(Snowfall.get('arr'), undefined, 'array rejected');
	ok(warns.length > 0, 'warning logged for array');

	warns.length = 0;
	Snowfall.set('fn', function() {});
	eq(Snowfall.get('fn'), undefined, 'function rejected');
	ok(warns.length > 0, 'warning logged for function');

	warns.length = 0;
	Snowfall.set('undef', undefined);
	eq(Snowfall.get('undef'), undefined, 'undefined rejected');
	ok(warns.length > 0, 'warning logged for undefined');

	warns.length = 0;
	Snowfall.set('nanVal', NaN);
	eq(Snowfall.get('nanVal'), undefined, 'NaN rejected');
	ok(warns.length > 0, 'warning logged for NaN');

	warns.length = 0;
	Snowfall.set('infVal', Infinity);
	eq(Snowfall.get('infVal'), undefined, 'Infinity rejected');
	ok(warns.length > 0, 'warning logged for Infinity');

	console.warn = origWarn;
}

// 1.2 Sum calculation
{
	Snowfall.reset();
	eq(Snowfall.sum('gold.'), 0, 'sum empty prefix returns 0');

	Snowfall.set('gold.ch1', 10);
	Snowfall.set('gold.ch2', 25);
	Snowfall.set('gold.ch3', 5);
	Snowfall.set('gold.name', 'mine'); // non-numeric
	Snowfall.set('silver.ch1', 100);

	eq(Snowfall.sum('gold.'), 40, 'sum aggregates numeric prefix correctly');
	eq(Snowfall.sum('silver.'), 100, 'sum aggregates different prefix');
	eq(Snowfall.sum('nonexistent.'), 0, 'sum missing prefix is 0');
}

// 1.3 Export and Import round-trip
{
	Snowfall.reset();
	Snowfall.set('a', 1);
	Snowfall.set('b', 'test');
	Snowfall.set('c', true);

	const exported = Snowfall.exportJSON();
	ok(typeof exported === 'string', 'exportJSON returns string');
	const parsed = JSON.parse(exported);
	eq(parsed.v, 1, 'export schema v is 1');
	eq(parsed.vars.a, 1, 'export contains vars.a');
	eq(parsed.vars.b, 'test', 'export contains vars.b');

	// Clear and re-import
	Snowfall.reset();
	eq(Snowfall.get('a'), undefined, 'reset cleared vars');

	const okImp = Snowfall.importJSON(exported);
	ok(okImp, 'importJSON returned true');
	eq(Snowfall.get('a'), 1, 'imported var a restored');
	eq(Snowfall.get('b'), 'test', 'imported var b restored');
	eq(Snowfall.get('c'), true, 'imported var c restored');

	// Byte-identical round trip
	const exported2 = Snowfall.exportJSON();
	eq(exported, exported2, 'export/import round trip is byte-identical');
}

// 1.4 Reset with mask
{
	Snowfall.reset();
	Snowfall.set('v1', 10);
	// simulate a key and a fired entry via import
	const doc = {
		v: 1, story: 'test-story', slot: 0, at: 1000,
		vars: { 'v1': 10 },
		keys: { 'k1': 20 },
		fired: { 's1': 1 }
	};
	Snowfall.importJSON(JSON.stringify(doc));
	eq(Snowfall.store.counts.vars, 1, 'has 1 var');
	eq(Snowfall.store.counts.keys, 1, 'has 1 key');
	eq(Snowfall.store.counts.fired, 1, 'has 1 fired');

	// Clear only fired
	Snowfall.reset({ fired: true });
	eq(Snowfall.store.counts.vars, 1, 'vars preserved after fired reset');
	eq(Snowfall.store.counts.keys, 1, 'keys preserved after fired reset');
	eq(Snowfall.store.counts.fired, 0, 'fired cleared');

	// Clear only keys
	Snowfall.reset({ keys: true });
	eq(Snowfall.store.counts.vars, 1, 'vars preserved after keys reset');
	eq(Snowfall.store.counts.keys, 0, 'keys cleared');

	// Clear only vars
	Snowfall.reset({ vars: true });
	eq(Snowfall.store.counts.vars, 0, 'vars cleared');
}

/* ====================================================================
   PART 2: LocalStorage prefix & fallback tests
   ==================================================================== */
{
	const storageMap = {};
	const fakeStorage = {
		getItem: k => storageMap[k] || null,
		setItem: (k, v) => { storageMap[k] = String(v); },
		removeItem: k => { delete storageMap[k]; }
	};

	global.localStorage = fakeStorage;
	delete require.cache[require.resolve('../snowfall.js')];
	const SLocal = require('../snowfall.js');

	SLocal.set('fileKey', 'val1');
	SLocal.save();

	const keys = Object.keys(storageMap);
	ok(keys.length === 1, 'storage has 1 item');
	ok(keys[0].indexOf('snowfall:') === 0, 'key starts with snowfall: prefix');
	ok(!storageMap['fileKey'], 'key is never bare');

	// Injected localStorage throw test
	fakeStorage.setItem = () => { throw new Error('QuotaExceeded'); };
	const origWarn = console.warn;
	let quotaWarned = false;
	console.warn = function(msg) {
		if (typeof msg === 'string' && msg.indexOf('unavailable') >= 0) quotaWarned = true;
	};

	// Next set/save should gracefully degrade to in-memory
	SLocal.set('inMemKey', 999);
	SLocal.save();
	eq(SLocal.get('inMemKey'), 999, 'in-memory value retrieved despite quota error');
	eq(SLocal.store.persistent, false, 'store.persistent is false after storage error');

	console.warn = origWarn;
	delete global.localStorage;
}

/* ====================================================================
   PART 3: Fake DOM State Machine Tests (Synthetic Scroll Sequences)
   ==================================================================== */
{
	const props = {};
	function fakeEl(tag) {
		const el = {
			tagName: (tag || 'DIV').toUpperCase(),
			style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: () => {}, transform: '' },
			classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
			setAttribute: (k, v) => { el._attrs[k] = String(v); },
			getAttribute: k => el._attrs[k] !== undefined ? el._attrs[k] : null,
			removeAttribute: k => { delete el._attrs[k]; },
			hasAttribute: k => el._attrs[k] !== undefined,
			querySelectorAll: () => [],
			appendChild: c => { el.kids.push(c); c.parentNode = el; return c; },
			insertBefore: (c, ref) => {
				const idx = el.kids.indexOf(ref);
				if (idx >= 0) el.kids.splice(idx, 0, c);
				else el.kids.push(c);
				c.parentNode = el;
				return c;
			},
			removeChild: c => {
				const idx = el.kids.indexOf(c);
				if (idx >= 0) el.kids.splice(idx, 1);
				c.parentNode = null;
				return c;
			},
			addEventListener: (evt, fn) => { (el._listeners[evt] = el._listeners[evt] || []).push(fn); },
			removeEventListener: () => {},
			click: () => {
				const list = el._listeners['click'] || [];
				for (const f of list) f({ target: el });
			},
			get className() { return el._attrs['class'] || ''; },
			set className(v) { el._attrs['class'] = String(v); },
			getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
			parentNode: null,
			kids: [],
			_attrs: {},
			_listeners: {},
			dataset: {},
			textContent: ''
		};
		return el;
	}

	const iw = 1440, ih = 900;
	let winScrollY = 0;
	const body = fakeEl('body');
	const de = Object.assign(fakeEl('html'), { clientWidth: iw });
	de.setAttribute('data-story', 'synthetic-test');
	const app = fakeEl('div');
	app.id = 'app';

	const doc = {
		documentElement: de,
		readyState: 'complete',
		body: body,
		getElementById: id => id === 'app' ? app : null,
		createElement: tag => fakeEl(tag),
		head: { appendChild: () => {} },
		addEventListener: () => {},
		querySelectorAll: sel => app.querySelectorAll(sel)
	};

	const win = {
		innerWidth: iw, innerHeight: ih,
		get scrollY() { return winScrollY; },
		set scrollY(v) { winScrollY = v; },
		addEventListener: () => {}, removeEventListener: () => {},
		document: doc
	};

	global.window = win;
	global.document = doc;

	delete require.cache[require.resolve('../snowfall.js')];
	const S = require('../snowfall.js');

	// Construct scripts in #app:
	// Anchor 0 at Y = 1500:
	//   Script S1: many, forward, replay (events: view, center, end, skip)
	//   Script S2: once, forward (event: center, data-id="s2-once")
	// Anchor 1 at Y = 3000:
	//   Script S3: both (events: view, center, end, data-dir="both", data-id="s3-both")
	//   Script S4: forward sibling (events: view, center, end, data-dir="forward", data-id="s4-fwd")
	// Anchor 2 at Y = 4500:
	//   Script S5: skip=none (event: skip, data-skip="none", data-id="s5-skip-none")
	//   Script S6: skip=replay (event: skip, data-skip="replay", data-id="s6-skip-replay")
	//   Script S7: once + both (event: center, data-times="once", data-dir="both", data-id="s7-once-both")

	const sLogs = [];
	function makeScript(y, event, attrs, code) {
		const s = fakeEl('script');
		s.type = 'txt';
		s.setAttribute('type', 'txt');
		s.setAttribute('event', event);
		for (const k in attrs) s.setAttribute(k, attrs[k]);
		s.textContent = code;

		// Mock marker
		const m = fakeEl('i');
		m.parentNode = app;
		m.getBoundingClientRect = () => ({ top: y - winScrollY, bottom: y - winScrollY });
		s.__snowA = m;
		return s;
	}

	const allScripts = [
		makeScript(1500, 'view,center,end,skip', { 'data-id': 's1' },
			'sLogs.push("s1 " + detail.event + " dir=" + detail.dir + " mode=" + detail.mode);'),
		makeScript(1500, 'center', { 'data-times': 'once', 'data-id': 's2-once' },
			'sLogs.push("s2 once center dir=" + detail.dir);'),
		makeScript(1500, 'center', { 'data-id': 's8-abandon' },
			'Snowfall.ask("abandon.test", 100, [["A", 1]], function(v, m) { global.abVal = v; global.abMode = m; });'),
		makeScript(3000, 'view,center,end', { 'data-dir': 'both', 'data-id': 's3-both' },
			'sLogs.push("s3 both " + detail.event + " dir=" + detail.dir);'),
		makeScript(3000, 'view,center,end', { 'data-dir': 'forward', 'data-id': 's4-fwd' },
			'sLogs.push("s4 fwd " + detail.event + " dir=" + detail.dir);'),
		makeScript(4500, 'skip', { 'data-skip': 'none', 'data-id': 's5-skip-none' },
			'sLogs.push("s5 skip none");'),
		makeScript(4500, 'skip', { 'data-skip': 'replay', 'data-id': 's6-skip-replay' },
			'sLogs.push("s6 skip replay");'),
		makeScript(4500, 'center', { 'data-times': 'once', 'data-dir': 'both', 'data-id': 's7-once-both' },
			'sLogs.push("s7 once both dir=" + detail.dir);')
	];
	allScripts.forEach(s => app.appendChild(s));

	app.querySelectorAll = sel => sel === 'script[type="txt"][event]' ? allScripts : [];
	global.sLogs = sLogs;

	S.reset();
	winScrollY = 0;
	S.refresh(true);

	eq(S.events.n, 3, '3 distinct anchors detected');

	// Sequence 1: Slow scroll down past Anchor 0 (Y=1500): sY: 0 -> 800 (view) -> 1200 (center) -> 1600 (end)
	sLogs.length = 0;
	winScrollY = 800; S.step(winScrollY, ih, iw); // d = 700 < 900 (view)
	winScrollY = 1200; S.step(winScrollY, ih, iw); // d = 300 < 450 (center)
	winScrollY = 1600; S.step(winScrollY, ih, iw); // d = -100 < 0 (end)

	ok(sLogs.includes('s1 view dir=1 mode=live'), 's1 view fired on downward leg');
	ok(sLogs.includes('s1 center dir=1 mode=live'), 's1 center fired on downward leg');
	ok(sLogs.includes('s1 end dir=1 mode=live'), 's1 end fired on downward leg');
	ok(sLogs.includes('s2 once center dir=1'), 's2 once center fired');
	ok(!sLogs.some(s => s.startsWith('s1 skip')), 's1 skip did NOT fire during slow scroll');
	eq(S.store.counts.fired, 1, 's2 once recorded in store.fired');

	// Sequence 2: Reverse scroll back up past Anchor 0: sY: 1600 -> 1200 -> 800 -> 0
	const logLenBeforeRev = sLogs.length;
	winScrollY = 1200; S.step(winScrollY, ih, iw);
	winScrollY = 800; S.step(winScrollY, ih, iw);
	winScrollY = 0; S.step(winScrollY, ih, iw);

	// Neither s1 (forward) nor s2 (forward) may fire in reverse
	const revFiresAnchor0 = sLogs.slice(logLenBeforeRev).filter(s => s.startsWith('s1') || s.startsWith('s2'));
	eq(revFiresAnchor0.length, 0, 'forward and once scripts fired 0 times in reverse');

	// Sequence 3: Second scroll down past Anchor 0:
	// s1 (many) should fire again; s2 (once) must NOT fire again!
	sLogs.length = 0;
	winScrollY = 800; S.step(winScrollY, ih, iw);
	winScrollY = 1200; S.step(winScrollY, ih, iw);
	winScrollY = 1600; S.step(winScrollY, ih, iw);

	ok(sLogs.includes('s1 view dir=1 mode=live'), 's1 view re-fired on second pass');
	ok(!sLogs.some(s => s.startsWith('s2')), 's2 once did NOT re-fire on second pass');

	// Sequence 4: Test `both` (S3) vs `forward` (S4) at Anchor 1 (Y=3000)
	sLogs.length = 0;
	// Scroll down past Y=3000: sY 2000 -> 2400 (view) -> 2800 (center) -> 3200 (end)
	winScrollY = 2400; S.step(winScrollY, ih, iw);
	winScrollY = 2800; S.step(winScrollY, ih, iw);
	winScrollY = 3200; S.step(winScrollY, ih, iw);

	ok(sLogs.includes('s3 both view dir=1'), 's3 both view fired down');
	ok(sLogs.includes('s3 both center dir=1'), 's3 both center fired down');
	ok(sLogs.includes('s3 both end dir=1'), 's3 both end fired down');
	ok(sLogs.includes('s4 fwd view dir=1'), 's4 fwd view fired down');
	ok(sLogs.includes('s4 fwd center dir=1'), 's4 fwd center fired down');
	ok(sLogs.includes('s4 fwd end dir=1'), 's4 fwd end fired down');

	// Now scroll UP past Y=3000: sY 3200 -> 2800 -> 2400 -> 2000
	sLogs.length = 0;
	winScrollY = 2800; S.step(winScrollY, ih, iw);
	winScrollY = 2400; S.step(winScrollY, ih, iw);
	winScrollY = 2000; S.step(winScrollY, ih, iw);

	ok(sLogs.includes('s3 both end dir=-1'), 's3 both end fired up with dir=-1');
	ok(sLogs.includes('s3 both center dir=-1'), 's3 both center fired up with dir=-1');
	ok(sLogs.includes('s3 both view dir=-1'), 's3 both view fired up with dir=-1');
	ok(!sLogs.some(s => s.startsWith('s4')), 's4 forward sibling fired 0 times going up');

	// Sequence 5: Test once + both (S7) at Anchor 2 (Y=4500)
	sLogs.length = 0;
	// Downward leg:
	winScrollY = 4200; S.step(winScrollY, ih, iw); // center
	winScrollY = 4600; S.step(winScrollY, ih, iw); // end
	ok(sLogs.includes('s7 once both dir=1'), 's7 once both fired going down');

	// Upward leg:
	sLogs.length = 0;
	winScrollY = 4200; S.step(winScrollY, ih, iw);
	winScrollY = 3800; S.step(winScrollY, ih, iw);
	ok(!sLogs.some(s => s.startsWith('s7')), 's7 once both did NOT fire in reverse');

	// Second downward leg:
	sLogs.length = 0;
	winScrollY = 4200; S.step(winScrollY, ih, iw);
	ok(!sLogs.some(s => s.startsWith('s7')), 's7 once both did NOT fire on second pass');

	// Sequence 6: Test data-skip="none" (S5) vs data-skip="replay" (S6) on flick
	S.reset();
	winScrollY = 0;
	S.refresh(true);
	sLogs.length = 0;

	// Jump directly past Anchor 2 (Y=4500) from 0 to 5000 in one frame
	winScrollY = 5000;
	S.step(winScrollY, ih, iw);

	ok(sLogs.includes('s6 skip replay'), 's6 skip replay fired on flick');
	ok(!sLogs.includes('s5 skip none'), 's5 skip none was filtered out on flick');

	// Sequence 7: Test live ask with options, answer, and continuation
	{
		let askedVal = null, askedMode = null;
		S.ask('dlg.hero', 'stay', [['Leave', 'leave'], ['Stay', 'stay']], function(val, mode) {
			askedVal = val;
			askedMode = mode;
		});

		ok(body.kids.length > 0, 'built-in prompt appended to body');
		const promptBox = body.kids.find(k => k.getAttribute('class') === 'snow-prompt');
		ok(promptBox, 'prompt element has .snow-prompt class');
		eq(promptBox.kids.length, 2, 'prompt has 2 option buttons');

		// Click the first button ('Leave' -> 'leave')
		promptBox.kids[0].click();

		eq(askedVal, 'leave', 'continuation received selected value');
		eq(askedMode, 'live', 'continuation mode is live');
		eq(S.sum('dlg.'), 0, 'sum on string keys is 0');
		eq(S.store.counts.keys, 1, 'keys stored 1 entry');
		ok(!body.kids.includes(promptBox), 'prompt removed from body after click');

		// Unknown answer warning
		const origWarn = console.warn;
		let ansWarned = false;
		console.warn = () => { ansWarned = true; };
		S.answer('dlg.hero', 'ignored');
		ok(ansWarned, 'second answer call warned and was ignored');
		console.warn = origWarn;
	}

	// Sequence 8: Test ask with options=null (minigame)
	{
		let gameVal = null, gameMode = null;
		S.ask('gold.chest', 1, null, function(val, mode) {
			gameVal = val;
			gameMode = mode;
		});

		eq(body.kids.filter(k => k.getAttribute('class') === 'snow-prompt').length, 0, 'no prompt rendered for options=null');

		// Author UI calls answer
		S.answer('gold.chest', 5);
		eq(gameVal, 5, 'minigame continuation received value 5');
		eq(gameMode, 'live', 'minigame continuation mode is live');
		eq(S.sum('gold.'), 5, 'sum reflects answered value');
	}

	// Sequence 9: Test ask abandon on anchor reaching end
	{
		// S8 at Y=1500 registered ask("abandon.test") on center (sY=1200)
		// When sY reached 1600 (end of Y=1500), it should have abandoned!
		eq(global.abVal, 100, 'abandon continuation received fallback value 100');
		eq(global.abMode, 'default', 'abandon mode is default');
	}

	// Sequence 10: eventsFrame source assertion (no store access, no allocation)
	{
		// Extract eventsFrame function body from snowfall.js source
		const fs = require('fs');
		const code = fs.readFileSync(path.join(__dirname, '../snowfall.js'), 'utf8');
		const m = /function eventsFrame\([^)]*\)\s*\{([\s\S]*?)\n\t\}/.exec(code);
		ok(m, 'eventsFrame extracted from source');
		const bodyText = m ? m[1] : '';

		ok(!bodyText.includes('storeData'), 'eventsFrame source contains no storeData');
		ok(!bodyText.includes('localStorage'), 'eventsFrame source contains no localStorage');
		ok(!bodyText.includes('JSON.'), 'eventsFrame source contains no JSON access');
		ok(!bodyText.includes('new Array'), 'eventsFrame source contains no new Array');
		ok(!bodyText.includes('new Object'), 'eventsFrame source contains no new Object');
		ok(!/\[\s*\]/.test(bodyText), 'eventsFrame source contains no array literals []');
	}

	// Sequence 11: load-time pre-fill latches only what is already past
	{
		// (a) an anchor standing inside the load viewport fires in that frame
		sLogs.length = 0;
		winScrollY = 1150;             // anchor 0 (Y=1500) is 350px down: inside view AND center
		S.refresh(false);
		ok(sLogs.includes('s1 view dir=1 mode=live'), 'a script in the load viewport fires view in the frame that loads it');
		eq(sLogs.filter(l => l.indexOf('s1 ') === 0).length, 2, 'its view and center fire once each, live');

		// (b) an anchor already past at load latches whole: no view, no center, no skip, ever
		sLogs.length = 0;
		winScrollY = 1600;             // anchor 0 is 100px past the top, anchor 1 still 1400px below
		S.refresh(false);
		eq(sLogs.length, 0, 'a frame that loads mid-document fires nothing for the anchors above it');
		winScrollY = 2600; S.step(winScrollY, ih, iw);
		ok(sLogs.includes('s3 both view dir=1') && sLogs.includes('s4 fwd view dir=1'), 'anchors below the load viewport fire normally');
		winScrollY = 5000; S.step(winScrollY, ih, iw);
		ok(!sLogs.some(l => l.indexOf('s1 ') === 0), 'the latched anchor never fires on a later pass, view or skip');
	}

	// Sequence 12: a skipped chapter is resolved BY THE ENGINE: the fallback becomes
	// the recorded outcome, counted once, and still labelled default on a later visit
	{
		allScripts.push(makeScript(4500, 'skip', { 'data-id': 's9-skip-ask' },
			'Snowfall.ask("late.fallback", 3, null, function(v, m) { global.lateVal = v; global.lateMode = m; });'));
		global.lateVal = null; global.lateMode = null;
		S.reset();
		winScrollY = 0; S.refresh(true);
		winScrollY = 5600; S.step(winScrollY, ih, iw);
		eq(global.lateVal, 3, 'a skipped chapter resolves with the fallback');
		eq(global.lateMode, 'default', 'and reports mode default');
		let store = JSON.parse(S.exportJSON());
		eq(store.keys['late.fallback'], 3, 'the engine records the fallback as the outcome');
		eq(store.defaults['late.fallback'], 1, 'marked default, not the reader\'s own play');
		eq(S.sum('late.'), 3, 'a derived total counts a chapter nobody played');

		global.lateVal = null; global.lateMode = null;
		winScrollY = 0; S.refresh(true);
		winScrollY = 5600; S.step(winScrollY, ih, iw);
		eq(global.lateVal, 3, 'a later visit replays the recorded outcome');
		eq(global.lateMode, 'default', 'still labelled default, never passed off as saved');
		eq(S.sum('late.'), 3, 'and stays counted exactly once');

		S.ask('late.fallback', 3, null, function() {});
		S.answer('late.fallback', 9);
		store = JSON.parse(S.exportJSON());
		eq(store.keys['late.fallback'], 9, 'a live answer overwrites the fallback');
		ok(!store.defaults || !store.defaults['late.fallback'], 'and drops the default mark');
		eq(S.sum('late.'), 9, 'the total follows the new outcome, never adds');

		const warnless = S.store.counts.keys;
		S.reset({ keys: true });
		eq(S.store.counts.keys, 0, 'reset({keys}) clears the recorded outcomes');
		eq(S.store.counts.defaults, 0, 'and their default marks with them');
		ok(warnless > 0, 'there was something to clear');
	}

	// Sequence 13: the un-latched load frame must not resurrect a `once` script,
	// and must not un-latch an anchor whose scripts have all already fired
	{
		const sOnceMany = makeScript(6200, 'view', { 'data-id': 's12-many' }, 'sLogs.push("s12 many");');
		const sOnceFired = makeScript(6200, 'view', { 'data-times': 'once', 'data-id': 's12-once' }, 'sLogs.push("s12 once");');
		const sAllOnce = makeScript(6300, 'view', { 'data-times': 'once', 'data-id': 's12-all-once' }, 'sLogs.push("s12 all once");');
		allScripts.push(sOnceMany, sOnceFired, sAllOnce);
		S.importJSON(JSON.stringify({
			v: 1, story: 'synthetic-test', slot: 0, at: 0,
			vars: {}, keys: {}, defaults: {}, fired: { 's12-once': 1, 's12-all-once': 1 }
		}));
		sLogs.length = 0;
		winScrollY = 6000;                     // 6200 (d=200) and 6300 (d=300) both on screen
		S.refresh(false);
		ok(sLogs.includes('s12 many'), 'a fresh script on an un-latched anchor fires in the load frame');
		ok(!sLogs.includes('s12 once'), 'a once-fired sibling on the same anchor stays silent');
		ok(!sLogs.includes('s12 all once'), 'an anchor whose scripts all already fired is latched whole');
	}

	// Clean up global mocks
	delete global.window;
	delete global.document;
	delete global.sLogs;
}

console.log('scripts: ' + (checks - fails) + '/' + checks + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
