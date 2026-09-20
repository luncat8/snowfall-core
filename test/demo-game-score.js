#!/usr/bin/env node
/* test/demo-game-score.js — gate for demo-game-score.html, the 0.4.2 page.
	Parses the page's real markup into a fake DOM, runs the page's own author
	script against the real engine and drives Snowfall.step() through the
	reader paths that matter:

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
const ROOT = path.join(__dirname, '..');
const VOID = { meta: 1, input: 1, br: 1, img: 1, link: 1, hr: 1 };
const VH = 800;

let checks = 0, fails = 0;
function ok(cond, name, detail) {
	checks++;
	if (cond) return;
	fails++;
	console.error('FAIL ' + name + (detail ? ' — ' + detail : ''));
}
function eq(a, b, name) { ok(a === b, name, '(' + a + ' vs ' + b + ')'); }

/* ---------------- static page parser ---------------- */
function parseAttrs(s) {
	const out = {}, re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g;
	let m;
	while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2] === undefined ? '' : m[2];
	return out;
}
function parseHTML(src) {
	const root = { tag: '#root', attrs: {}, kids: [], text: '' }, stack = [root];
	const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|[^>"])*)>/g;
	let m;
	while ((m = re.exec(src))) {
		const closing = m[1] === '/', tag = m[2].toLowerCase(), raw = m[3] || '';
		if (tag === 'script' || tag === 'style') {
			const close = src.toLowerCase().indexOf('</' + tag, re.lastIndex);
			const node = { tag, attrs: parseAttrs(raw), kids: [], parent: stack[stack.length - 1], text: src.slice(re.lastIndex, close === -1 ? src.length : close) };
			node.parent.kids.push(node);
			if (close === -1) break;
			re.lastIndex = src.indexOf('>', close) + 1;
			continue;
		}
		if (closing) { if (stack.length > 1) stack.pop(); continue; }
		const node = { tag, attrs: parseAttrs(raw), kids: [], parent: stack[stack.length - 1], text: '' };
		node.parent.kids.push(node);
		if (!VOID[tag]) stack.push(node);
	}
	return root;
}
function nodeText(n) { let t = n.text || ''; for (const k of n.kids) t += nodeText(k); return t; }

/* ---------------- selector engine (the subset page and engine use) ---------------- */
function parseCompound(sel) {
	const out = { tag: null, id: null, classes: [], attrs: [] };
	const m = /([a-zA-Z][a-zA-Z0-9]*)?(#[\w-]+)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)/.exec(sel);
	if (!m) return out;
	if (m[1]) out.tag = m[1].toLowerCase();
	if (m[2]) out.id = m[2].slice(1);
	if (m[3]) m[3].split('.').filter(Boolean).forEach(c => out.classes.push(c));
	if (m[4]) { const are = /\[([\w-]+)(?:="([^"]*)")?\]/g; let a; while ((a = are.exec(m[4]))) out.attrs.push([a[1].toLowerCase(), a[2]]); }
	return out;
}
function matchCompound(el, c) {
	if (!el || !el.tagName || el.tagName === '#ROOT') return false;
	if (c.tag && el.tagName.toLowerCase() !== c.tag) return false;
	if (c.id && el.id !== c.id) return false;
	for (const cl of c.classes) if (!el.classList.contains(cl)) return false;
	for (const [k, v] of c.attrs) {
		if (!el.hasAttribute(k)) return false;
		if (v !== undefined && el.getAttribute(k) !== v) return false;
	}
	return true;
}
function walk(el, fn) { fn(el); for (const k of el.kids) walk(k, fn); }
function queryAll(rootEl, selector) {
	const hits = [];
	for (const part of selector.split(',')) {
		const compounds = part.trim().split(/\s+/).map(parseCompound);
		walk(rootEl, el => {
			let i = compounds.length - 1;
			if (!matchCompound(el, compounds[i])) return;
			let cur = el.parentElement;
			i--;
			while (i >= 0 && cur) { if (matchCompound(cur, compounds[i])) i--; cur = cur.parentElement; }
			if (i < 0 && hits.indexOf(el) < 0) hits.push(el);
		});
	}
	return hits;
}

/* ---------------- fake elements ---------------- */
let scrollY = 0;
function fakeEl(tag) {
	const el = {
		tagName: (tag || 'div').toUpperCase(), id: '', _attrs: {}, _text: '', _html: '', _cls: new Set(),
		kids: [], parentNode: null, dataset: {}, _listeners: {}, layoutY: 0, _h: 0, onclick: null,
		style: { setProperty: () => {}, removeProperty: () => {}, transform: '' },
		classList: {
			add: c => el._cls.add(c), remove: c => el._cls.delete(c),
			toggle: (c, on) => { if (on === undefined ? !el._cls.has(c) : on) el._cls.add(c); else el._cls.delete(c); },
			contains: c => el._cls.has(c)
		}
	};
	el.setAttribute = (k, v) => {
		el._attrs[k] = String(v);
		if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach(c => el._cls.add(c));
		if (k === 'id') el.id = String(v);
		if (k.indexOf('data-') === 0) el.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = String(v);
	};
	el.getAttribute = k => el._attrs[k] !== undefined ? el._attrs[k] : null;
	el.hasAttribute = k => el._attrs[k] !== undefined;
	el.removeAttribute = k => { delete el._attrs[k]; };
	el.appendChild = c => { el.kids.push(c); c.parentNode = el; return c; };
	el.insertBefore = (c, ref) => {
		const i = el.kids.indexOf(ref);
		if (i >= 0) el.kids.splice(i, 0, c); else el.kids.push(c);
		c.parentNode = el;
		if (ref) c.layoutY = ref.layoutY;      /* the .snow-a marker takes the script's static position */
		return c;
	};
	el.removeChild = c => { const i = el.kids.indexOf(c); if (i >= 0) el.kids.splice(i, 1); c.parentNode = null; return c; };
	el.addEventListener = (t, fn) => { (el._listeners[t] = el._listeners[t] || []).push(fn); };
	el.removeEventListener = () => {};
	el.querySelectorAll = sel => queryAll(el, sel);
	el.querySelector = sel => queryAll(el, sel)[0] || null;
	el.click = () => {
		const own = el._listeners['click'] || [];
		own.forEach(f => f({ target: el }));
		if (!own.length && el.parentNode && typeof el.parentNode.onclick === 'function') el.parentNode.onclick({ target: el });
	};
	el.getBoundingClientRect = () => ({ top: el.layoutY - scrollY, bottom: el.layoutY - scrollY, left: 0, right: 0, width: 0, height: 0 });
	Object.defineProperty(el, 'parentElement', { get: () => el.parentNode });
	Object.defineProperty(el, 'offsetHeight', { get: () => el._h });
	Object.defineProperty(el, 'offsetTop', { get: () => el.layoutY });
	Object.defineProperty(el, 'className', { get: () => el._attrs['class'] || '', set: v => el.setAttribute('class', v) });
	Object.defineProperty(el, 'textContent', {
		get: () => el._text + el.kids.map(k => k.textContent).join(''),
		set: v => { el._text = String(v); el.kids = []; el._html = ''; }
	});
	Object.defineProperty(el, 'innerHTML', {
		get: () => el._html,
		set: v => {
			el._html = String(v); el.kids = []; el._text = '';
			for (const n of parseHTML(String(v)).kids) attach(el, n);
		}
	});
	return el;
}
function attach(parent, node) {
	const el = fakeEl(node.tag);
	for (const k in node.attrs) el.setAttribute(k, node.attrs[k]);
	if (node.text) el._text = node.text;
	parent.appendChild(el);
	for (const c of node.kids) attach(el, c);
	return el;
}

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
	if (node.tag === 'p') return PMARGIN + lines(nodeText(node)) * LINE + PMARGIN;
	return inner;
}

/* ---------------- build the page, boot the engine on it ---------------- */
function buildPage(source, vh, withEngine) {
	scrollY = 0;
	const html = (parseHTML(source).kids.find(k => k.tag === 'html')) || { kids: [], attrs: {} };
	const bodyNode = html.kids.find(k => k.tag === 'body') || { kids: [] };
	const byId = {}, scripts = [];
	const htmlEl = fakeEl('html');
	htmlEl.setAttribute('data-story', html.attrs['data-story'] || '');
	htmlEl.clientWidth = 1440;
	const headEl = fakeEl('head');
	htmlEl.appendChild(headEl);
	const bodyEl = fakeEl('body');
	htmlEl.appendChild(bodyEl);

	function lay(node, parentEl, yy) {
		const el = fakeEl(node.tag);
		for (const k in node.attrs) el.setAttribute(k, node.attrs[k]);
		if (node.text) el._text = node.text;
		parentEl.appendChild(el);
		if (el.id) byId[el.id] = el;
		if (node.tag === 'script' && node.attrs.type === 'txt') scripts.push(el);
		el.layoutY = yy;
		const pad = node.tag === 'section' ? 32 : (el.classList.contains('game') ? 16 : 0);
		let cur = yy + pad;
		for (const child of node.kids) cur = lay(child, el, cur);
		el._h = measure(node, vh, cur - (yy + pad));
		return yy + el._h;
	}
	let y = 0;
	for (const child of bodyNode.kids) y = lay(child, bodyEl, y);
	const docHeight = y;

	const win = {
		innerWidth: 1440, innerHeight: vh, document: null, _listeners: {},
		get scrollY() { return scrollY; },
		set scrollY(v) { scrollY = v; },
		addEventListener: (t, fn) => { (win._listeners[t] = win._listeners[t] || []).push(fn); },
		removeEventListener: () => {},
		scrollTo: (x, yy) => { scrollY = yy; },
		setScroll(v) { scrollY = v; (win._listeners['scroll'] || []).forEach(f => f({})); }
	};
	const docHandlers = {};
	const doc = {
		documentElement: htmlEl, body: bodyEl, head: headEl, readyState: 'loading',
		getElementById: id => byId[id] || null,
		createElement: tag => fakeEl(tag),
		querySelector: sel => (sel.indexOf('meta') === 0 ? null : (queryAll(bodyEl, sel)[0] || null)),
		querySelectorAll: sel => queryAll(bodyEl, sel),
		addEventListener: (t, fn) => { (docHandlers[t] = docHandlers[t] || []).push(fn); }
	};
	win.document = doc;
	Object.defineProperty(htmlEl, 'scrollHeight', { get: () => docHeight });
	global.window = win; global.document = doc;
	global.URL = { createObjectURL: () => 'blob:x' };
	global.Blob = function () {};
	global.FileReader = function () {};

	let S = null;
	if (withEngine) {
		/* A fresh module instance per build: its own store, its own boot(). The
		   document is still 'loading' while a classic <script src> parses, so the
		   engine defers its first refresh to DOMContentLoaded and an on-screen
		   chapter fires its view after the page's own script has run. */
		delete require.cache[require.resolve(path.join(ROOT, 'snowfall.js'))];
		S = require(path.join(ROOT, 'snowfall.js'));
		global.Snowfall = S;                       /* node's global object is not window */
		win.Snowfall = S;
	}

	const code = /<script>\r?\n((?:.|\n)*?)\r?\n<\/script><\/body><\/html>/.exec(source);
	if (!code) throw new Error('author script not found');
	/* in a browser `window.foo = 1` also creates the global `foo` the engine's
	   compiled snippets resolve — mirror the assignment for the sandbox */
	const winProxy = new Proxy(win, { set(t, k, v) { t[k] = v; if (typeof k === 'string') global[k] = v; return true; } });
	new Function('window', 'document', 'global', code[1])(winProxy, doc, global);
	/* end of parse: the engine's deferred boot refresh runs here */
	doc.readyState = 'complete';
	(docHandlers['DOMContentLoaded'] || []).forEach(fn => fn({ type: 'DOMContentLoaded' }));

	const page = {
		win, doc, S, byId, htmlEl, scripts, vh, docHeight,
		bottom: () => Math.max(0, docHeight - vh),
		el: id => byId[id],
		score: () => byId['score'].textContent,
		breakdown: () => byId['breakdown'].textContent,
		store: () => JSON.parse(S ? S.exportJSON() : '{}'),
		summary: () => byId['breakdown'].textContent + ' | score ' + byId['score'].textContent,
		answer: (k, v) => {
			const b = byId['game-' + k].querySelector('button[data-v="' + v + '"]');
			if (!b) return false;
			b.click();
			return true;
		},
		painted: () => !!queryAll(bodyEl, '.game button').length,
		waiting: k => !!byId['game-' + k].querySelector('button'),
		play: (k, v) => {
			for (let yy = scrollY; yy < Math.max(0, docHeight - vh); yy += 200) {
				win.setScroll(yy);
				if (page.answer(k, v)) return true;
			}
			win.setScroll(page.bottom());
			return page.answer(k, v);
		},
		readDown: (step, v) => {
			for (let yy = 0; yy < page.bottom(); yy += step) {
				win.setScroll(yy);
				if (v !== undefined) for (let k = 1; k <= 3; k++) page.answer(k, v);
			}
			win.setScroll(page.bottom());
			if (v !== undefined) for (let k = 1; k <= 3; k++) page.answer(k, v);
		},
		walkUp: step => { for (let yy = page.bottom(); yy > 0; yy -= step) win.setScroll(yy); win.setScroll(0); }
	};
	return page;
}

/* ==================================================================== */
const file = process.argv[2] || path.join(ROOT, 'demo-game-score.html');
const source = fs.readFileSync(file, 'utf8');
console.log('demo-game-score: ' + path.relative(ROOT, file) + '  (fake DOM, vh ' + VH + ')');

/* 1. the load-time prefill must not eat chapter 1 */
{
	const p = buildPage(source, VH, true);
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
	const p = buildPage(source, VH, true);
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
	const p = buildPage(source, VH, true);
	ok(p.play(1, 2), 'chapter 1 plays live on a cold load');
	p.win.setScroll(p.el('ch3').offsetTop);
	eq(p.breakdown(), 'ch1=2 live · ch2=1 default · ch3=idle', 'the jumped-over chapter defaults, the rest hold');
	ok(p.play(3, 1), 'the landed chapter still prompts');
	eq(p.score(), '4', 'live 2 + skipped 1 + played 1', p.summary());
}

/* 4. a fresh visit replays the recorded play and never double-grants */
{
	const p = buildPage(source, VH, true);
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
	const p = buildPage(source, VH, true);
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
	const p = buildPage(source, VH, true);
	p.readDown(200, 2);
	const json = p.S.exportJSON(), sum = p.S.sum('gold.');
	p.S.reset();
	ok(p.S.importJSON(json), 'import accepts the exported save');
	eq(p.S.sum('gold.'), sum, 'export → reset → import round-trips the total');
	p.el('clearBtn').onclick();
	const cleared = p.store();
	eq(Object.keys(cleared.keys).length + Object.keys(cleared.defaults).length, 0, 'clear save drops outcomes and default marks');
	eq(p.score(), '0', 'clear save zeroes the score');
	ok(queryAll(p.doc.body, '.game .picked').length === 0, 'no resolved chapter text survives clear save');
	const fresh = [1, 2, 3].every(k => p.byId['game-' + k].querySelector('.idle') || p.waiting(k));
	ok(fresh, 'every box is idle again — or prompting, if the chapter re-armed on screen',
		[1, 2, 3].map(k => k + ':' + (p.waiting(k) ? 'prompt' : p.byId['game-' + k].querySelector('.idle') ? 'idle' : 'other')).join(' '));
}

/* 7. the page's own in-GUI self-test, run through its button */
{
	const p = buildPage(source, VH, true);
	p.el('qa').textContent = '';
	p.el('selfBtn').onclick();
	const out = p.el('qa').textContent, passes = (out.match(/PASS /g) || []).length;
	ok(out.indexOf('FAIL') < 0, 'the in-GUI self-test reports no FAIL', out.split('\n')[1]);
	ok(/all checks passed/.test(out), 'and ends with all checks passed');
	ok(passes >= 14, 'having run at least 14 checks', String(passes));
}

/* 8. engine absent: prose, no throw, SKIP */
{
	const p = buildPage(source, VH, false);
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
