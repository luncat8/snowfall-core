#!/usr/bin/env node
/* test/lib/fakedom.js — the fake DOM the page gates share: a static HTML
   parser, the selector subset the engine and the pages use, elements with just
   enough of the DOM API, and buildPage(), which lays a page out, loads its own
   <script src> files in its own order, runs its inline author script and boots
   the real engine on the result.

   Not a gate — test/run.js only runs test/*.js, so this stays a library.
   Page-specific layout heights and page-specific probes belong to the gate
   that owns the page: buildPage takes the height model as opts.measure. */
'use strict';
const path = require('path');
const VOID = { meta: 1, input: 1, br: 1, img: 1, link: 1, hr: 1 };

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
	let m, last = 0;
	/* inter-tag text becomes a #text node: measurement needs the real line
	   count and innerHTML has to read back what a page wrote */
	function text(before) {
		const s = src.slice(last, before);
		last = before;
		if (!s.trim()) return;
		const top = stack[stack.length - 1];
		top.kids.push({ tag: '#text', attrs: {}, kids: [], text: s, parent: top });
	}
	while ((m = re.exec(src))) {
		const closing = m[1] === '/', tag = m[2].toLowerCase(), raw = m[3] || '';
		if (tag === 'script' || tag === 'style') {
			text(m.index);
			const close = src.toLowerCase().indexOf('</' + tag, re.lastIndex);
			const node = { tag, attrs: parseAttrs(raw), kids: [], parent: stack[stack.length - 1], text: src.slice(re.lastIndex, close === -1 ? src.length : close) };
			node.parent.kids.push(node);
			if (close === -1) break;
			re.lastIndex = src.indexOf('>', close) + 1;
			last = re.lastIndex;
			continue;
		}
		if (closing) { text(m.index); if (stack.length > 1) stack.pop(); continue; }
		text(m.index);
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
		tagName: (tag || 'div').toUpperCase(), isText: tag === '#text', id: '', _attrs: {}, _text: '', _html: '', _cls: new Set(),
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
	/* reflects like the real IDL attribute: a <link href> set from JS is an attribute */
	Object.defineProperty(el, 'href', { get: () => el._attrs['href'] || '', set: v => el.setAttribute('href', v) });
	Object.defineProperty(el, 'textContent', {
		get: () => el._text + el.kids.map(k => k.textContent).join(''),
		set: v => { el._text = String(v); el.kids = []; el._html = ''; }
	});
	Object.defineProperty(el, 'innerHTML', {
		get: () => innerHTML(el),
		set: v => {
			el._html = String(v); el.kids = []; el._text = '';
			for (const n of parseHTML(String(v)).kids) attach(el, n);
		}
	});
	return el;
}

/* the real getter serializes, so markup built by appendChild reads back too —
   the minigame runner snapshots a mount's idle markup through innerHTML */
function outerHTML(el) {
	if (el.isText) return el._text;
	const tag = el.tagName.toLowerCase();
	let attrs = '';
	for (const k in el._attrs) attrs += ' ' + k + '="' + el._attrs[k] + '"';
	if (VOID[tag]) return '<' + tag + attrs + '>';
	return '<' + tag + attrs + '>' + innerHTML(el) + '</' + tag + '>';
}
function innerHTML(el) {
	let s = el._text;
	for (const k of el.kids) s += outerHTML(k);
	return s;
}
function attach(parent, node) {
	const el = fakeEl(node.tag);
	for (const k in node.attrs) el.setAttribute(k, node.attrs[k]);
	if (node.text) el._text = node.text;
	parent.appendChild(el);
	for (const c of node.kids) attach(el, c);
	return el;
}

/* ---------------- build a page and boot the real engine on it ---------------- */
function eachScript(node, fn) {
	if (node.tag === 'script') fn(node);
	for (const k of node.kids) eachScript(k, fn);
}

/* buildPage(source, vh, opts) — opts:
     measure(node, vh, inner)  height model mirroring the page's own CSS
     engine: false             skip the page's <script src> files (JS-off case)
     dir                       where the page lives, to resolve its src paths
   Returns {win, doc, S, byId, htmlEl, scripts, mods, vh, docHeight, bottom, el}. */
function buildPage(source, vh, opts) {
	opts = opts || {};
	scrollY = 0;
	const pageDir = opts.dir || process.cwd();
	const measure = opts.measure;
	const html = (parseHTML(source).kids.find(k => k.tag === 'html')) || { kids: [], attrs: {} };
	const bodyNode = html.kids.find(k => k.tag === 'body') || { kids: [] };
	const byId = {}, scripts = [], mods = {};
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

	/* in a browser `window.foo = 1` also creates the global `foo` the engine's
	   compiled snippets resolve — mirror the assignment for the sandbox */
	const winProxy = new Proxy(win, { set(t, k, v) { t[k] = v; if (typeof k === 'string') global[k] = v; return true; } });

	/* the page's own load order: every <script src> fresh (its own store, its
	   own boot), then the inline author script, then DOMContentLoaded — which
	   is when the engine's deferred first refresh runs, so an on-screen
	   chapter fires its view only after the page's functions exist */
	const load = [];
	eachScript(html, n => { if ((n.attrs.type || '') !== 'txt') load.push(n); });
	for (const n of load) {
		if (n.attrs.src) {
			if (opts.engine === false) continue;
			const file = path.resolve(pageDir, String(n.attrs.src).split('?')[0].split('#')[0]);
			delete require.cache[require.resolve(file)];
			/* a classic script's IIFE binds to `window` when there is one, so
			   its namespace lands on the fake window; node's global is not that
			   window, and the engine's compiled snippets resolve their callees
			   there — mirror both directions */
			const beforeWin = new Set(Object.keys(win));
			const beforeGlobal = new Set(Object.keys(globalThis));
			mods[path.basename(file)] = require(file);
			for (const k of Object.keys(win)) if (!beforeWin.has(k)) global[k] = win[k];
			for (const k of Object.keys(globalThis)) if (!beforeGlobal.has(k)) win[k] = globalThis[k];
			continue;
		}
		new Function('window', 'document', 'global', n.text)(winProxy, doc, global);
	}
	doc.readyState = 'complete';
	(docHandlers['DOMContentLoaded'] || []).forEach(fn => fn({ type: 'DOMContentLoaded' }));

	return {
		win, doc, S: win.Snowfall || null, byId, htmlEl, scripts, mods, vh, docHeight,
		bottom: () => Math.max(0, docHeight - vh),
		el: id => byId[id],
		store: () => JSON.parse(win.Snowfall ? win.Snowfall.exportJSON() : '{}')
	};
}

module.exports = { parseHTML, parseAttrs, nodeText, queryAll, fakeEl, attach, buildPage };
