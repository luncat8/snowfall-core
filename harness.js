/* snowfall 0.1 — content generator, diagnostics, QA probes.
	Works with the engine absent; every Snowfall touch is guarded. */
const $ = id => document.getElementById(id);
const LOG = [];
window.Snowlog = msg => { LOG.push(String(msg)); };

/* ---------------- utils ---------------- */
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function mulberry32(seed) {
	let a = seed >>> 0;
	return function() {
		a |= 0; a = a + 0x6D2B79F5 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function maxY() { return Math.max(0, document.documentElement.scrollHeight - window.innerHeight); }
function hasEng() { return !!(window.Snowfall && window.Snowfall.wagons); }
function engRefresh(replay) { if (window.Snowfall && Snowfall.refresh) Snowfall.refresh(replay); }
function wagons() { return Array.from(document.querySelectorAll('#app .snow-bg')); }
function chapters() { return Array.from(document.querySelectorAll('#app h4.n')); }
const raf2 = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
function setY(y) { window.scrollTo(0, clamp(Math.round(y), 0, maxY())); }
/* 'rgb(r, g, b)' / 'rgba(r, g, b, a)' → [r,g,b,a255] or null */
function cssRGBA(s) {
	const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(s || '');
	if (!m) return null;
	return [+m[1], +m[2], +m[3], m[4] === undefined ? 255 : Math.round(+m[4] * 255)];
}
function hex3(rgb) {
	if (!rgb) return '—';
	const h = v => ('0' + clamp(Math.round(v), 0, 255).toString(16)).slice(-2);
	return '#' + h(rgb[0]) + h(rgb[1]) + h(rgb[2]);
}
function rootCls() {
	return (document.documentElement.className || '').split(/\s+/).filter(c => c && c !== 'snow-off').join(' ');
}
/* tolerant transform parse: engines normalize translate3d spacing differently */
function parseT(el) {
	const s = el.style.transform || '';
	if (!s) return { x: 0, y: 0 };
	const m = /translate3d\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(s);
	if (!m) return { x: 0, y: 0 };
	return { x: +m[1], y: +m[2] };
}

/* ---------------- config in location.hash ---------------- */
const IDS = ['preset', 'n', 'bgs', 'len', 'gap', 'flow', 'mode', 'size', 'dir', 'nest', 'stick'];
const CHECKS = ['style', 'events', 'exampleGradient'];
let SEED = 20260917;
function getCfg() {
	const c = { seed: SEED };
	for (const id of IDS) c[id] = $(id).value;
	for (const id of CHECKS) c[id] = $(id).checked ? 1 : 0;
	return c;
}
function setControls(c) {
	for (const id of IDS) if (c[id] !== undefined && $(id)) $(id).value = c[id];
	for (const id of CHECKS) if (c[id] !== undefined && $(id)) $(id).checked = !!+c[id];
	if (c.seed !== undefined) SEED = c.seed >>> 0;
	$('nO').textContent = $('n').value;
	if ($('bgsO')) $('bgsO').textContent = $('bgs').value;
	$('spd').textContent = $('speed').value;
}
function readHash() {
	const h = location.hash.replace(/^#/, '');
	if (!h) return;
	const c = {};
	for (const kv of h.split('&')) {
		const i = kv.indexOf('=');
		if (i < 0) continue;
		c[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
	}
	if (c.seed !== undefined) c.seed = parseInt(c.seed, 10) || 0;
	setControls(c);
}
function writeHash() {
	const c = getCfg();
	const s = IDS.map(id => id + '=' + encodeURIComponent(c[id])).join('&')
		+ CHECKS.map(id => '&' + id + '=' + c[id]).join('') + '&seed=' + SEED;
	try { history.replaceState(null, '', '#' + s); }
	catch (e) { location.hash = s; }
}

/* ---------------- visuals: gradients + svg data uris, zero network ---------------- */
const PALETTE = [
	{ L: 'R', bg: '#c0392b', fg: '#fdf2e9', g: ['#7e1018', '#f44b45'] },
	{ L: 'B', bg: '#2471a3', fg: '#eaf2f8', g: ['#14213d', '#4facfe'] },
	{ L: 'G', bg: '#1e8449', fg: '#eafaf1', g: ['#0f5132', '#43e97b'] },
	{ L: 'Y', bg: '#b7950b', fg: '#1a1500', g: ['#7d6608', '#f9e04b'] },
	{ L: 'P', bg: '#6c3483', fg: '#f4ecf7', g: ['#330867', '#b388eb'] },
	{ L: 'C', bg: '#5d6d7e', fg: '#f8f9fa', g: ['#232526', '#414345'] }
];
const CAPTIONS = ['dawn breaks', 'the door opens', 'cold corridor', 'signal lost',
	'night shift', 'paper maps', 'second floor', 'quiet engine'];
/* bare data uri; call site wraps in url('…') so no quote ever closes its attribute */
function svgURI(w, h, fill, label) {
	const t = Math.min(w, h);
	let cells = '';
	for (let i = 0; i < 8; i++)
		cells += '<rect x="' + (i * t / 8) + '" y="0" width="' + (t / 8) + '" height="' + (t / 8) + '" fill="' + (i % 2 ? '#ffffff' : '#000000') + '" opacity="0.85"/>';
	const fs = Math.max(10, Math.floor(t / 12));
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">'
		+ '<rect width="' + w + '" height="' + h + '" fill="' + fill + '"/>'
		+ cells
		+ '<rect x="0.5" y="0.5" width="' + (w - 1) + '" height="' + (h - 1) + '" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.6"/>'
		+ '<text x="8" y="' + (16 + fs) + '" font-size="' + fs + '" fill="#fff" font-family="monospace">' + label + '</text>'
		+ '<text x="' + (w - 8) + '" y="' + (h - 8) + '" font-size="' + fs + '" fill="#fff" font-family="monospace" text-anchor="end">' + label + '</text>'
		+ '</svg>';
	return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
function wagonVisual(pal, mode, size, tag) {
	if (mode === 'tiled') return { img: "url('" + svgURI(128, 128, pal.bg, tag) + "')", sizeCss: '' };
	if (mode === 'fixed' || mode === 'auto')
		return { img: "url('" + svgURI(size, size, pal.bg, tag) + "')", sizeCss: '' };
	return { img: 'linear-gradient(135deg,' + pal.g[0] + ',' + pal.g[1] + ')', sizeCss: '' };
}

/* ---------------- generator ---------------- */
let WAGON_NO = 0;
function wagonHTML(rng, k, pal, cfg, free) {
	WAGON_NO++;
	const tag = 'bg' + WAGON_NO;
	const mode = cfg.mode === 'mixed' ? pick(rng, ['cover', 'tiled', 'contain', 'fixed', 'auto']) : cfg.mode;
	const size = cfg.size === 'mixed' ? pick(rng, [256, 512, 1024]) : +cfg.size;
	let dir = '';
	if (cfg.dir === 'mixed') dir = pick(rng, ['top', 'top', 'top', 'left', 'right', 'bottom']);
	else if (cfg.dir !== 'none') dir = cfg.dir;
	const gap = cfg.flow === 'mixed' ? pick(rng, ['0', '0', '120px', '50vh', '100vh'])
		: cfg.flow === 'screen' ? '100vh' : '0';
	const v = wagonVisual(pal, mode, size, tag);
	let style = "background-image:" + v.img + ";";
	if (mode === 'fixed' || mode === 'auto') style += 'width:' + size + 'px;height:' + size + 'px;';
	let at = ' class="snow-bg" data-mode="' + mode + '" data-gap="' + gap + '"';
	if (mode === 'fixed' || mode === 'auto') at += ' data-size="' + size + '"';
	if (dir && dir !== 'top') at += ' data-dir="' + dir + '"';
	/* every 3rd wagon anchor is fg-only (bg must hold previous); the choice is
	   counter-based, not rng, so layouts are identical with style on or off */
	if (cfg.style && rng() < 0.3)
		at += WAGON_NO % 3 ? ' data-bg="' + pal.bg + '"' : ' data-fg="' + pal.fg + '"';
	return '<div' + at + ' style="' + style + '"><span class="wtag">' + tag + '·' + mode
		+ (mode === 'fixed' || mode === 'auto' ? '·' + size : '') + (dir && dir !== 'top' ? '·' + dir : '')
		+ (free ? '·free' : '') + '</span></div>';
}
function linesHTML(k, from, count) {
	let s = '';
	for (let j = 0; j < count; j++) s += k + '·' + (from + j) + '<br>';
	return s;
}
function runHTML(L, count) {
	let s = '';
	for (let j = 0; j < count; j++) s += L + '<br>';
	return s;
}
function stickHTML(k, side, rng) {
	if (side === 'top')
		return '<div class="snow-stick" data-park="top" style="top:0">ch' + k + ' · ' + pick(rng, CAPTIONS) + '</div>';
	const lat = (rng() * 90).toFixed(1), lon = (rng() * 180).toFixed(1);
	return '<div class="snow-stick" data-park="bottom" style="bottom:0">ch' + k + ' · loc ' + lat + 'N ' + lon + 'E</div>';
}
function scriptsHTML(k, cfg) {
	if (!cfg.events) return '';
	let s = '<script type="txt" event="view">Snowlog("ch' + k + ' view")<\/script>'
		+ '<script type="txt" event="center">Snowlog("ch' + k + ' center")<\/script>'
		+ '<script type="txt" event="parked">Snowlog("ch' + k + ' parked")<\/script>'
		+ '<script type="txt" event="end">Snowlog("ch' + k + ' end")<\/script>'
		+ '<script type="txt" event="skip">Snowlog("ch' + k + ' skip")<\/script>';
	if (k === 1) s += '<script type="txt" event="center,parked">Snowlog("ch1 center+parked")<\/script>';
	if (k === 1) s += '<script type="txt" event="view">let =<\/script>';
	return s;
}
function chapterHTML(rng, k, cfg) {
	const pal = PALETTE[(k - 1) % PALETTE.length];
	const total = cfg.len === 'tiny' ? 18 : cfg.len === 'huge' ? 220
		: cfg.preset === 'mixed' ? pick(rng, [18, 60, 60, 120, 220]) : 60;
	const gapN = cfg.gap === 'zero' ? 0 : cfg.gap === 'same' ? 8
		: cfg.gap === 'huge' ? 120 : Math.floor(rng() * 31);
	const wantTop = cfg.stick === 'top' || cfg.stick === 'both';
	const wantBot = cfg.stick === 'bottom' || cfg.stick === 'both';
	let s = '<h4 class="n">' + k + '</h4>';
	if (wantTop) s += stickHTML(k, 'top', rng);
	s += linesHTML(k, 0, Math.min(gapN, total));
	s += wagonHTML(rng, k, pal, cfg, false);
	let rest = total - Math.min(gapN, total);
	const mid = Math.floor(rest / 2);
	s += linesHTML(k, gapN, mid);
	if (cfg.preset === 'mixed' && rng() < 0.4 && rest > 10)
		s += wagonHTML(rng, k, pal, cfg, true);
	s += runHTML(pal.L, 3 + Math.floor(rng() * 5));
	s += linesHTML(k, gapN + mid, rest - mid);
	s += scriptsHTML(k, cfg);
	if (wantBot) s += stickHTML(k, 'bottom', rng);
	const wrap = cfg.nest === 'both' ? (k % 2 ? 'section' : 'flat') : cfg.nest;
	if (wrap === 'flat') {
		/* flat chapters carry their morph anchor on a zero-size <i>;
		   same rng draws as the section branch, in the same order */
		if (!cfg.style) return s;
		let fat = ' data-bg="' + pal.bg + '" data-fg="' + pal.fg + '"';
		if (k % 3 === 0) fat += ' data-style="' + pick(rng, ['night', 'fog', 'sunset']) + '" data-range="' + pick(rng, [80, 240, 800]) + '"';
		return '<i class="snow-fg"' + fat + '></i>' + s;
	}
	let at = '';
	if (cfg.style) {
		at += ' data-bg="' + pal.bg + '" data-fg="' + pal.fg + '"';
		if (k % 3 === 0) at += ' data-style="' + pick(rng, ['night', 'fog', 'sunset']) + '" data-range="' + pick(rng, [80, 240, 800]) + '"';
	}
	return '<section' + at + '>' + s + '</section>';
}
/* draft preset: short verbatim-style snippet, fixed content modulo seed visuals */
function draftHTML(rng, cfg) {
	const p1 = PALETTE[0], p2 = PALETTE[2];
	const v1 = wagonVisual(p1, 'cover', 512, 'bg1');
	const v2 = wagonVisual(p2, 'cover', 512, 'bg2');
	return '<section><h4 class="n">1</h4>'
		+ '1<br>1<br>'
		+ '<div class="snow-bg" data-mode="cover" data-gap="0" style="background-image:' + v1.img + '"><span class="wtag">bg1·cover</span></div>'
		+ 'any text and sections combinations with free placement of background-image and scripts in anywhere<br>'
		+ '2<br>2<br>2<br>'
		+ '<div class="snow-bg" data-mode="cover" data-dir="left" data-gap="0" style="background-image:' + v2.img + '"><span class="wtag">bg2·cover·left</span></div>'
		+ '3<br>3<br>3<br>'
		+ scriptsHTML(1, cfg)
		+ '<h4 class="n">2</h4>2·0<br>2·1<br>2·2<br>'
		+ '</section>';
}
function applyPreset(name) {
	const set = (id, v) => { $(id).value = v; };
	if (name === 'mono') {
		set('len', 'mono'); set('gap', 'same'); set('flow', 'screen');
		set('mode', 'cover'); set('size', '512'); set('dir', 'none'); set('nest', 'section');
	} else if (name === 'tight') {
		set('len', 'tiny'); set('gap', 'zero'); set('flow', 'overlay');
		set('mode', 'cover'); set('size', '512'); set('dir', 'none'); set('nest', 'both');
	} else if (name === 'draft') {
		set('n', '2'); set('len', 'tiny'); set('gap', 'same'); set('flow', 'overlay');
		set('mode', 'cover'); set('size', '512'); set('dir', 'none'); set('nest', 'section');
	}
	$('nO').textContent = $('n').value;
}
/* ---------------- pasted-image example generator ---------------- */
let EXAMPLE_HTML = '';
function escapeHTML(value) {
	return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
		.replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/* Keep the URL inside a quoted CSS url() value. HTML escaping happens after this. */
function exampleURL(source) {
	return 'url("' + String(source).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
		.replace(/[\r\n]+/g, ' ') + '")';
}
function exampleMode(cfg, rng) {
	return cfg.mode === 'mixed' ? pick(rng, ['cover', 'tiled', 'contain', 'fixed', 'auto']) : cfg.mode;
}
function exampleSize(cfg, rng) {
	return cfg.size === 'mixed' ? pick(rng, [256, 512, 1024]) : +cfg.size;
}
function exampleDir(cfg, rng) {
	if (cfg.dir === 'mixed') return pick(rng, ['top', 'top', 'left', 'right', 'bottom']);
	return cfg.dir === 'none' ? '' : cfg.dir;
}
function exampleGap(cfg, rng) {
	if (cfg.flow === 'mixed') return pick(rng, ['0', '0', '120px', '50vh', '100vh']);
	return cfg.flow === 'screen' ? '100vh' : '0';
}
function exampleStickHTML(index, side) {
	if (side === 'top') return '<div class="snow-stick" data-park="top">example ' + index + ' · caption</div>';
	return '<div class="snow-stick" data-park="bottom">example ' + index + ' · location tag</div>';
}
function exampleScriptsHTML(index, cfg) {
	if (!cfg.events) return '';
	const name = 'example ' + index;
	return '<script type="txt" event="view">if (window.Snowlog) Snowlog("' + name + ' view")<\/script>'
		+ '<script type="txt" event="center">if (window.Snowlog) Snowlog("' + name + ' center")<\/script>'
		+ '<script type="txt" event="parked">if (window.Snowlog) Snowlog("' + name + ' parked")<\/script>'
		+ '<script type="txt" event="end">if (window.Snowlog) Snowlog("' + name + ' end")<\/script>'
		+ '<script type="txt" event="skip">if (window.Snowlog) Snowlog("' + name + ' skip")<\/script>';
}
function exampleSceneHTML(index, source, gradient, cfg, rng) {
	const pal = PALETTE[(index - 1) % PALETTE.length];
	const mode = exampleMode(cfg, rng), size = exampleSize(cfg, rng);
	const dir = exampleDir(cfg, rng), gap = exampleGap(cfg, rng);
	const kind = gradient ? 'gradient' : 'image';
	const label = gradient ? 'generated gradient' : 'pasted image ' + index;
	const image = gradient ? 'linear-gradient(135deg,' + pal.g[0] + ',' + pal.g[1] + ')' : exampleURL(source);
	let style = 'background-image:' + image + ';';
	if (mode === 'fixed' || mode === 'auto') style += 'width:' + size + 'px;height:' + size + 'px;';
	let attrs = ' class="snow-bg" data-example-kind="' + kind + '" data-mode="' + mode + '" data-gap="' + gap + '"';
	if (mode === 'fixed' || mode === 'auto') attrs += ' data-size="' + size + '"';
	if (dir && dir !== 'top') attrs += ' data-dir="' + dir + '"';
	if (!gradient) attrs += ' data-source="' + escapeHTML(source) + '"';
	let sceneAttrs = ' class="snow-example-scene" data-example-index="' + index + '"';
	if (cfg.style) {
		sceneAttrs += ' data-bg="' + pal.bg + '" data-fg="' + pal.fg + '"'
			+ ' data-style="' + ['night', 'fog', 'sunset'][(index - 1) % 3] + '" data-range="240"';
	}
	const top = cfg.stick === 'top' || cfg.stick === 'both';
	const bottom = cfg.stick === 'bottom' || cfg.stick === 'both';
	let body = '<h3 class="snow-example-title">' + label + '</h3>'
		+ '<p class="snow-example-copy">Write text here…</p>'
		+ '<p class="snow-example-copy snow-example-meta">' + mode + ' · ' + (dir || 'top') + ' · gap ' + gap + '</p>';
	if (top) body += exampleStickHTML(index, 'top');
	body += '<div' + attrs + ' style="' + escapeHTML(style) + '"><span class="wtag">example·' + index + '·' + kind + '</span></div>'
		+ '<p class="snow-example-copy">Write text here…</p>'
		+ exampleScriptsHTML(index, cfg);
	if (bottom) body += exampleStickHTML(index, 'bottom');
	const wrap = cfg.nest === 'both' ? (index % 2 ? 'section' : 'flat') : cfg.nest;
	return wrap === 'section' ? '<section' + sceneAttrs + '>' + body + '</section>' : body;
}
function exampleContainerHTML(cfg, sources) {
	if (!sources.length && !cfg.exampleGradient) return '';
	const rng = mulberry32((SEED ^ 0x4E584D50) >>> 0);
	let body = '<div class="snow-example-heading">Pasted examples</div>';
	for (let i = 0; i < sources.length; i++) body += exampleSceneHTML(i + 1, sources[i], false, cfg, rng);
	if (cfg.exampleGradient) body += exampleSceneHTML(sources.length + 1, '', true, cfg, rng);
	const holder = document.createElement('div');
	holder.innerHTML = '<div class="snow-example-container" data-snowfall-example="image-list">' + body + '</div>';
	return holder.firstElementChild.outerHTML;
}
function parseExampleImages(value) {
	return String(value || '').split(/\r?\n/).map(s => s.trim())
		.filter(s => s && s.charAt(0) !== '#');
}
function updateExampleOutput(html, count) {
	EXAMPLE_HTML = html;
	$('exampleOut').value = html;
	$('exampleCopy').disabled = !html;
	if (html) setExampleStatus(count + ' example(s) in preview · use QA to copy the container.', true);
	else setExampleStatus('Paste an image URL or enable the gradient.', false);
}
function setExampleStatus(text, good) {
	$('exampleStatus').className = good ? 'ok' : 'fail';
	$('exampleStatus').textContent = text;
}
function fallbackCopy(text) {
	const area = document.createElement('textarea');
	area.value = text;
	area.setAttribute('readonly', '');
	area.style.position = 'fixed';
	area.style.opacity = '0';
	document.body.appendChild(area);
	area.select();
	let ok = false;
	try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
	area.remove();
	return ok;
}
function copyExamples() {
	if (!EXAMPLE_HTML) { setExampleStatus('No example container to copy.', false); return; }
	const done = ok => setExampleStatus(
		ok ? 'Copied the example container outerHTML.' : 'Copy was blocked; select the HTML and copy it manually.', ok);
	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(EXAMPLE_HTML).then(() => done(true), () => done(fallbackCopy(EXAMPLE_HTML)));
		return;
	}
	done(fallbackCopy(EXAMPLE_HTML));
}

/* ---------------- template + source editor ---------------- */
let selectedBg = null, selectedHeading = null, sourceDirty = false, sourceTimer = 0;
let lastApplied = '', headLineCache = null, paneQuietUntil = 0, scrollDriver = '', driverUntil = 0;
const VOID_TAGS = { area:1, base:1, br:1, col:1, embed:1, hr:1, img:1, input:1, link:1, meta:1, param:1, source:1, track:1, wbr:1 };
const DROP_STYLES = { transform:1, 'will-change':1, margin:1, 'margin-top':1, 'margin-right':1, 'margin-bottom':1, 'margin-left':1, top:1, bottom:1 };
function cleanClone(node) {
	if (node.nodeType === 3) return document.createTextNode(node.nodeValue);
	if (node.nodeType !== 1 || node.classList.contains('snow-a') || node.classList.contains('wtag')) return null;
	const out = document.createElement(node.tagName.toLowerCase());
	for (const attr of Array.from(node.attributes)) {
		if (/^data-snow/i.test(attr.name)) continue;
		if (attr.name !== 'style') { out.setAttribute(attr.name, attr.value); continue; }
		const probe = document.createElement('i'); probe.setAttribute('style', attr.value);
		for (const key of Object.keys(DROP_STYLES)) probe.style.removeProperty(key);
		if (probe.getAttribute('style')) out.setAttribute('style', probe.getAttribute('style'));
	}
	for (const child of Array.from(node.childNodes)) { const copy = cleanClone(child); if (copy) out.appendChild(copy); }
	return out;
}
function serializeNode(node, depth) {
	const tag = node.tagName.toLowerCase(), pad = '\t'.repeat(depth);
	let open = '<' + tag;
	for (const a of Array.from(node.attributes)) open += ' ' + a.name + '="' + escapeHTML(a.value) + '"';
	open += '>';
	if (!node.children.length) return pad + open + escapeHTML(node.textContent) + '</' + tag + '>';
	let text = pad + open;
	for (const child of Array.from(node.childNodes)) {
		if (child.nodeType === 3 && child.nodeValue.trim()) text += escapeHTML(child.nodeValue);
		else if (child.nodeType === 1) text += '\n' + serializeNode(child, depth + 1);
	}
	return text + '\n' + pad + '</' + tag + '>';
}
function serializeTemplate() {
	const lines = [];
	for (const child of Array.from($('app').children)) {
		if (child.classList.contains('tail') || child.classList.contains('snow-a')) continue;
		const clean = cleanClone(child); if (clean) lines.push(serializeNode(clean, 0));
	}
	return lines.join('\n');
}
function sourceStatus(message, warning) {
	$('srcStatus').textContent = message;
	$('srcStatus').className = warning ? 'warn' : '';
}
function writeSource(preserveCaret) {
	const text = serializeTemplate(), src = $('src');
	const a = src.selectionStart, b = src.selectionEnd;
	src.value = text; lastApplied = text; sourceDirty = false; headLineCache = null;
	if (preserveCaret && document.activeElement === src) src.setSelectionRange(Math.min(a, text.length), Math.min(b, text.length));
	$('templateCopy').disabled = !text;
	sourceStatus('applied · ' + chapters().length + ' chapters · ' + wagons().length + ' backgrounds', false);
}
function balanceWarning(text) {
	const stack = [], re = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?([a-z][\w:-]*)\b[^>]*>/gi;
	let m;
	while ((m = re.exec(text))) {
		if (m[0].slice(0, 4) === '<!--' || m[1]) continue;
		const tag = m[2].toLowerCase(), close = m[0][1] === '/';
		if (!close && !VOID_TAGS[tag] && !/\/\s*>$/.test(m[0])) stack.push(tag);
		else if (close && stack.pop() !== tag) return m[0] + ' closes unexpectedly';
	}
	return stack.length ? '<' + stack[stack.length - 1] + '> never closed' : '';
}
function readingCapture() {
	const hs = chapters(), line = window.scrollY + window.innerHeight / 2;
	let heading = null;
	for (const h of hs) if (h.getBoundingClientRect().top + window.scrollY <= line) heading = h;
	return heading ? { key: heading.textContent.trim(), offset: window.scrollY - (heading.getBoundingClientRect().top + window.scrollY) } : null;
}
function applySource() {
	clearTimeout(sourceTimer); sourceTimer = 0;
	const text = $('src').value, warning = balanceWarning(text), pos = readingCapture();
	const box = document.createElement('div'); box.innerHTML = text;
	$('app').replaceChildren(...Array.from(box.childNodes), Object.assign(document.createElement('div'), { className:'tail' }));
	selectedBg = selectedHeading = null; lastApplied = text; sourceDirty = false; headLineCache = null;
	engRefresh();
	if (pos) requestAnimationFrame(() => { const h = chapters().find(x => x.textContent.trim() === pos.key); if (h) setY(h.getBoundingClientRect().top + window.scrollY + pos.offset); });
	$('templateCopy').disabled = !text.trim();
	sourceStatus(warning || (text.trim() ? 'applied · ' + chapters().length + ' chapters · ' + wagons().length + ' backgrounds' : 'empty source · tail only'), !!warning);
}
function flushSource() { if (sourceDirty) applySource(); }
function templateMode(cfg, rng) { return cfg.mode === 'mixed' ? pick(rng, ['cover','cover','contain','tiled','fixed','auto']) : cfg.mode; }
function templateGap(cfg, rng) { return cfg.flow === 'mixed' ? pick(rng, ['0','100vh']) : cfg.flow === 'screen' ? '100vh' : '0'; }
function sourceVisual(source, fallback, pal, mode, size, tag) {
	if (source) return { image:exampleURL(source), source:source };
	if (!fallback) return { image:'', source:'' };
	const v = wagonVisual(pal, mode, size, tag);
	return { image:v.img, source:'' };
}
function templateWagonHTML(k, j, cfg, rng, source, pal) {
	const mode = templateMode(cfg, rng), size = cfg.size === 'mixed' ? pick(rng,[256,512,1024]) : +cfg.size;
	const dir = cfg.dir === 'mixed' ? pick(rng,['top','left','right','bottom']) : cfg.dir === 'none' ? 'top' : cfg.dir;
	const visual = sourceVisual(source, !!cfg.exampleGradient, pal, mode, size, 'ch'+k+'·bg'+j);
	let at = ' class="snow-bg" data-mode="'+mode+'" data-gap="'+templateGap(cfg,rng)+'"';
	if (mode === 'fixed' || mode === 'auto') at += ' data-size="'+size+'"';
	if (dir !== 'top') at += ' data-dir="'+dir+'"';
	if (visual.source) at += ' data-source="'+escapeHTML(visual.source)+'"';
	if (visual.image) at += ' style="background-image:'+escapeHTML(visual.image)+';"';
	return '<div'+at+'></div>';
}
function stubHTML(count) { return '<p class="snow-wip">Write text here…</p>'.repeat(count); }
function templateChapterHTML(k, cfg, rng, sources, cursor) {
	const pal = PALETTE[(k-1)%PALETTE.length], stubs = cfg.len === 'tiny' ? 1 : cfg.len === 'huge' ? 6 : 3;
	const before = cfg.gap === 'zero' ? 0 : cfg.gap === 'huge' ? 2 : cfg.gap === 'mixed' ? 1 + (rng()<.5?0:1) : 1;
	let body = '<h4 class="n">'+k+'</h4>'+stubHTML(before || 1);
	if (cfg.stick === 'top' || cfg.stick === 'both') body += '<div class="snow-stick" data-park="top">chapter '+k+' · caption</div>';
	for (let j=1;j<=+cfg.bgs;j++) { body += templateWagonHTML(k,j,cfg,rng,sources[cursor.i++]||'',pal)+stubHTML(stubs); }
	if (!+cfg.bgs) body += stubHTML(stubs);
	if (cfg.stick === 'bottom' || cfg.stick === 'both') body += '<div class="snow-stick" data-park="bottom">chapter '+k+' · location</div>';
	body += scriptsHTML(k,cfg);
	let attrs = '';
	if (cfg.style) attrs = ' data-bg="'+pal.bg+'" data-fg="'+pal.fg+'" data-style="'+['night','fog','sunset'][(k-1)%3]+'" data-range="240"';
	return '<section'+attrs+'>'+body+'</section>';
}
function build() {
	flushSource(); const cfg=getCfg(), rng=mulberry32(SEED), sources=parseExampleImages($('exampleImages').value), cursor={i:0}, parts=[];
	for (let k=1;k<=clamp(+cfg.n||1,1,12);k++) parts.push(templateChapterHTML(k,cfg,rng,sources,cursor));
	$('app').innerHTML=parts.join('')+'<div class="tail"></div>'; LOG.length=0; $('qa').innerHTML=''; $('jump').max=chapters().length||1;
	window.scrollTo(0,0); writeHash(); engRefresh(); writeSource(false);
}
function mutatePreview(fn) { flushSource(); fn(); engRefresh(); writeSource(true); }
function addChapter() {
	mutatePreview(() => { const cfg=getCfg(), hs=chapters(), k=hs.length ? Math.max(...hs.map(h=>+h.textContent||0))+1 : 1; const box=document.createElement('div'); box.innerHTML=templateChapterHTML(k,cfg,mulberry32((SEED+k)>>>0),parseExampleImages($('exampleImages').value),{i:wagons().length}); $('app').insertBefore(box.firstElementChild,$('app').querySelector('.tail')); selectedHeading=chapters().slice(-1)[0]; });
}
function addBackground() {
	mutatePreview(() => { let h=selectedHeading && selectedHeading.isConnected ? selectedHeading : chapters().slice(-1)[0]; if(!h){addChapter();return;} const section=h.closest('section')||$('app'), cfg=getCfg(), pal=PALETTE[(chapters().indexOf(h))%PALETTE.length], box=document.createElement('div'); box.innerHTML=templateWagonHTML(+h.textContent||1,wagons().length+1,cfg,mulberry32(SEED+wagons().length),'',pal)+stubHTML(1); const tail=section.querySelector('.snow-stick[data-park=bottom],script[type="txt"]'); while(box.firstChild)section.insertBefore(box.firstChild,tail); selectedBg=Array.from(section.querySelectorAll('.snow-bg')).slice(-1)[0]; });
}
const BG_FIELDS=[['source','image URL'],['mode','mode'],['size','size'],['dir','exit direction'],['gap','flow gap']];
const CH_FIELDS=[['bg','page color'],['fg','text color'],['style','style class'],['range','morph range']];
function attrValue(el,key){ if(key==='source')return el.dataset.source||''; return el.getAttribute('data-'+key)||''; }
function updateInspector() {
	const hs=chapters(), line=window.scrollY+window.innerHeight/2; let h=hs[0]||null;
	for(const x of hs)if(x.getBoundingClientRect().top+window.scrollY<=line)h=x;
	let bg=null, best=Infinity; for(const x of wagons()){const r=x.getBoundingClientRect(),d=Math.abs(r.top-window.innerHeight/2);if(d<best){best=d;bg=x;}}
	if(document.activeElement && document.activeElement.closest && document.activeElement.closest('#inspectFields'))return;
	if(h===selectedHeading&&bg===selectedBg)return; selectedHeading=h;selectedBg=bg;
	$('inspectTitle').textContent=h?'chapter '+h.textContent.trim()+(bg?' · background '+(wagons().indexOf(bg)+1):' · text only'):'No chapter';
	const root=h?(h.closest('section')||h.previousElementSibling):null, fields=[];
	if(bg)for(const f of BG_FIELDS)fields.push({el:bg,key:f[0],label:'Background · '+f[1]});
	if(root)for(const f of CH_FIELDS)fields.push({el:root,key:f[0],label:'Chapter · '+f[1]});
	$('inspectFields').innerHTML=''; for(const f of fields){const label=document.createElement('label');label.textContent=f.label;const input=document.createElement('input');input.value=attrValue(f.el,f.key);input.dataset.key=f.key;input._target=f.el;label.appendChild(input);$('inspectFields').appendChild(label);}
}
function applyInspector(e){const input=e.target,el=input._target;if(!el||!el.isConnected)return;mutatePreview(()=>{const key=input.dataset.key,v=input.value.trim();if(key==='source'){if(v){el.dataset.source=v;el.style.backgroundImage=exampleURL(v);}else{delete el.dataset.source;el.style.removeProperty('background-image');}}else if(v)el.setAttribute('data-'+key,v);else el.removeAttribute('data-'+key);});}
function toggleSource(force){const on=force===undefined?!document.body.classList.contains('src'):force;document.body.classList.toggle('src',on);$('sourceToggle').setAttribute('aria-pressed',on?'true':'false');engRefresh();}
function headLines(){if(headLineCache)return headLineCache;headLineCache=[];$('src').value.split('\n').forEach((line,i)=>{if(/<h4\b[^>]*class="[^"]*\bn\b/.test(line))headLineCache.push(i);});return headLineCache;}
function syncPreviewToSource(){if(!$('syncScroll').checked||qaBusy||document.activeElement===$('src')||scrollDriver==='source'&&Date.now()<driverUntil)return;const hs=chapters();if(!selectedHeading||!hs.length)return;const i=hs.indexOf(selectedHeading),lines=headLines();if(i<0||!lines[i])return;paneQuietUntil=Date.now()+300;$('src').scrollTop=Math.max(0,lines[i]*18-$('src').clientHeight/4);}
function copyTemplate(){flushSource();writeSource(true);const text=$('src').value,done=ok=>sourceStatus(ok?'copied template HTML':'copy blocked · select source manually',!ok);if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(()=>done(true),()=>done(fallbackCopy(text)));else done(fallbackCopy(text));}

/* ---------------- diagnostics @10Hz ---------------- */
let frames = 0, worstMs = 0, lastT = 0, panelH = 0;
function fpsLoop(t) {
	if (lastT) { frames++; if (t - lastT > worstMs) worstMs = t - lastT; }
	lastT = t;
	requestAnimationFrame(fpsLoop);
}
function logCounts() {
	const c = {};
	for (const m of LOG) {
		const e = m.split(' ').pop();
		c[e] = (c[e] || 0) + 1;
	}
	return ['view', 'center', 'parked', 'end', 'skip'].map(e => e + ':' + (c[e] || 0)).join(' ');
}
function diagTick() {
	updateInspector();
	syncPreviewToSource();
	const vh = window.innerHeight, y = Math.round(window.scrollY);
	const docH = document.documentElement.scrollHeight;
	const n = wagons().length;
	let eng = 'engine: off', act = '—';
	if (hasEng() && Snowfall.debug) {
		const d = Snowfall.debug;
		eng = 'engine: on';
		act = 'active:' + (d.active === undefined ? '—' : d.active)
			+ ' parked:' + (d.parked === undefined ? '—' : d.parked)
			+ ' pushed:' + (d.pushed === undefined ? '—' : d.pushed)
			+ ' writes:' + (d.writes === undefined ? '—' : d.writes);
	}
	const fps = (frames * 10 / 10).toFixed(0);
	let theme = 'theme —';
	if (hasEng() && Snowfall.morph && Snowfall.morph.n) {
		const dd = Snowfall.debug || {};
		const cs = getComputedStyle(document.documentElement);
		theme = 'theme ' + hex3(cssRGBA(cs.backgroundColor)) + '/' + hex3(cssRGBA(cs.color))
			+ ' cls:' + (rootCls() || '—')
			+ ' t:' + (dd.styleT === undefined || dd.styleT < 0 ? '—' : (+dd.styleT).toFixed(2))
			+ ' n:' + Snowfall.morph.n;
	}
	$('dstats').textContent = 'scrollY ' + y + ' · vh ' + vh + ' · doc ' + docH
		+ '\n#bg ' + n + ' · ' + eng + ' · ' + act
		+ '\nfps ' + fps + ' · worst ' + worstMs.toFixed(1) + 'ms'
		+ '\nevents ' + logCounts() + ' · total ' + LOG.length
		+ '\n' + theme
		+ '\n#' + location.hash.replace(/^#/, '');
	frames = 0; worstMs = 0;
	const mx = maxY();
	$('mark').textContent = String(y);
	$('mark').style.top = (mx ? y / mx * (vh - 24) : 0) + 'px';
	if ($('wire').checked) paintWires();
	if ($('estate').checked) {
		$('estatePre').style.display = 'block';
		$('estatePre').textContent = hasEng() && Snowfall.debug
			? JSON.stringify(Snowfall.debug, (k, v) => v instanceof Float64Array ? Array.from(v).slice(0, 12) : v)
			: '(no engine)';
	} else $('estatePre').style.display = 'none';
	/* narrow viewports: panel growth shifts #app, so re-measure on change only */
	const h = $('gen').offsetHeight + $('diag').offsetHeight;
	if (h !== panelH) { panelH = h; engRefresh(); }
}
function paintWires() {
	const box = $('wires');
	const els = wagons();
	let s = '';
	const eng = hasEng() && Snowfall.wagons ? Snowfall.wagons : null;
	for (let i = 0; i < els.length; i++) {
		const r = els[i].getBoundingClientRect();
		const ay = eng ? eng.y[i] - window.scrollY : r.top;
		s += '<i class="a" style="left:' + r.left + 'px;top:' + ay + 'px;width:' + r.width + 'px;height:' + r.height + 'px"></i>'
			+ '<i class="r" style="left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px"></i>';
	}
	box.innerHTML = s;
}

/* ---------------- navigation + autoscroll ---------------- */
let autoId = 0;
function stopAuto() {
	if (autoId) cancelAnimationFrame(autoId);
	autoId = 0;
	$('auto').dataset.on = '0';
}
function toggleAuto() {
	if (autoId) { stopAuto(); return; }
	$('auto').dataset.on = '1';
	const step = () => {
		window.scrollTo(0, window.scrollY + (+$('speed').value || 6));
		if (window.scrollY >= maxY() - 1) { stopAuto(); return; }
		autoId = requestAnimationFrame(step);
	};
	autoId = requestAnimationFrame(step);
}
function gotoChapter(d) {
	const hs = chapters();
	if (!hs.length) return;
	const y = window.scrollY + 2;
	let idx = 0;
	for (let i = 0; i < hs.length; i++)
		if (hs[i].getBoundingClientRect().top + window.scrollY <= y) idx = i;
	idx = clamp(idx + d, 0, hs.length - 1);
	const t = hs[idx].getBoundingClientRect().top + window.scrollY;
	setY(t - 8);
	$('jump').value = idx + 1;
}
function jumpTo() {
	const hs = chapters();
	const k = clamp(+$('jump').value || 1, 1, Math.max(1, hs.length)) - 1;
	if (!hs[k]) return;
	setY(hs[k].getBoundingClientRect().top + window.scrollY - 8);
}

/* ------------- QA probes ------------- */
let qaBusy = false;
function row(name, ok, detail) {
	const div = document.createElement('div');
	div.className = 'qrow ' + (ok === 1 ? 'ok' : ok === 0 ? 'fail' : 'skip');
	div.innerHTML = '<b>' + (ok === 1 ? 'PASS' : ok === 0 ? 'FAIL' : 'SKIP') + '</b>' + name + '<small></small>';
	div.querySelector('small').textContent = detail;
	$('qa').appendChild(div);
	console.info('Snowfall QA', name, ok === 1 ? 'PASS' : ok === 0 ? 'FAIL' : 'SKIP', detail);
	return { name, ok, detail };
}
/* wagon geometry: engine record when present, else fresh rects (static baseline) */
function geom() {
	const els = wagons();
	if (hasEng() && Snowfall.wagons && Snowfall.wagons.n === els.length) {
		const w = Snowfall.wagons;
		return {
			els, live: true, Y: Array.from(w.y), ext: Array.from(w.ext),
			pos: Array.from(w.pos), free: Array.from(w.free)
		};
	}
	const y = window.scrollY;
	return {
		els, live: false,
		Y: els.map(e => e.getBoundingClientRect().top + y),
		ext: els.map(e => e.getBoundingClientRect().height)
	};
}
/* theme snapshot: computed colours on <html> + engine class set */
function snapTheme() {
	const cs = getComputedStyle(document.documentElement);
	return cs.backgroundColor + '|' + cs.color + '|' + rootCls();
}
async function qReversibility() {
	const els = wagons();
	if (!els.length) return row('reversibility', -1, 'no wagons');
	const mx = maxY(), N = 10, downs = [], ups = [], tdowns = [], tups = [];
	for (let k = 0; k < N; k++) {
		const t = Math.round(mx * k / (N - 1));
		setY(t); await raf2();
		if (Math.abs(window.scrollY - t) > 1)
			return row('reversibility', 0, 'scroll did not land: want ' + t + ' got ' + Math.round(window.scrollY));
		downs.push(els.map(e => e.style.transform || ''));
		tdowns.push(snapTheme());
	}
	for (let k = N - 1; k >= 0; k--) {
		setY(Math.round(mx * k / (N - 1))); await raf2();
		ups.unshift(els.map(e => e.style.transform || ''));
		tups.unshift(snapTheme());
	}
	let differ = 0;
	for (let k = 0; k < N; k++)
		for (let i = 0; i < els.length; i++)
			if (downs[k][i] !== ups[k][i]) differ++;
	if (differ) return row('reversibility', 0, differ + ' transform(s) differ for equal scrollY');
	let tdiffer = 0;
	for (let k = 0; k < N; k++)
		if (tdowns[k] !== tups[k]) tdiffer++;
	if (tdiffer) return row('reversibility', 0, tdiffer + ' theme snapshot(s) differ for equal scrollY');
	return row('reversibility', 1, N + '/' + N + ' identical (transforms + theme)' + (hasEng() ? '' : ' (no engine — static)'));
}
async function qOverlap() {
	const els = wagons();
	if (els.length < 2) return row('overlap', -1, 'need 2+ wagons');
	if (!hasEng()) return row('overlap', 1, 'no engine — overlap is engine-defined (fallback overlays by design)');
	const mx = maxY(), N = 10;
	let worst = 0, at = 0;
	for (let k = 0; k < N; k++) {
		setY(Math.round(mx * k / (N - 1))); await raf2();
		for (let i = 0; i < els.length - 1; i++) {
			if ((els[i].dataset.dir || 'top') !== 'top') continue;
			const a = els[i].getBoundingClientRect(), b = els[i + 1].getBoundingClientRect();
			const ov = a.bottom - b.top;
			if (ov > worst) { worst = ov; at = Math.round(window.scrollY); }
		}
	}
	if (worst > 1) return row('overlap', 0, 'overlap ' + worst.toFixed(1) + 'px at scrollY ' + at);
	return row('overlap', 1, 'no overlap at ' + N + ' positions' + (hasEng() ? '' : ' (no engine — static)'));
}
async function qAnchorAlign() {
	let g = geom();
	if (!g.els.length) return row('anchorAlign', -1, 'no wagons');
	let checked = 0, skipped = 0;
	const bad = [];
	for (let i = 0; i < g.els.length; i++) {
		const cush = i < g.els.length - 1 ? (g.Y[i + 1] - g.Y[i]) - g.ext[i] : Infinity;
		if (cush < 0) { skipped++; continue; }
		/* coupling propagates from below, so the single-gap check is not enough:
		   ask the engine whether this wagon is actually pushed right now */
		setY(g.Y[i]); await raf2();
		g = geom();
		if (g.live && g.pos[i] < Math.max(g.free[i], 0) - 1) { skipped++; continue; }
		checked++;
		const y0 = g.els[i].getBoundingClientRect().top;
		if (Math.abs(y0) > 1) bad.push('#' + i + ' free=0 → y=' + y0.toFixed(1));
		const t = g.Y[i] - 300;
		if (t < 0) continue;
		setY(t); await raf2();
		g = geom();
		if (g.live && g.pos[i] < Math.max(g.free[i], 0) - 1) { skipped++; continue; }
		const y3 = g.els[i].getBoundingClientRect().top;
		if (Math.abs(y3 - 300) > 1) bad.push('#' + i + ' free=300 → y=' + y3.toFixed(1));
	}
	if (!checked) return row('anchorAlign', -1, skipped ? 'all wagons coupled, nothing unpushed to align' : 'no uncoupled wagons');
	if (bad.length) return row('anchorAlign', 0, bad.slice(0, 4).join('; '));
	return row('anchorAlign', 1, checked + ' wagon(s) ride on their text' + (skipped ? ', ' + skipped + ' skipped (coupled)' : '') + (hasEng() ? '' : ' (no engine — static)'));
}
async function qJump() {
	const els = wagons();
	if (!els.length) return row('jump', -1, 'no wagons');
	const mx = maxY();
	const step = Math.max(40, Math.ceil(mx / 60));
	const isBot = els.map(e => (e.dataset.dir || 'top') === 'bottom');
	setY(0); await raf2();
	let prev = els.map(e => e.getBoundingClientRect().top);
	let worst = 0, at = 0;
	for (let y = step; y <= mx + 1; y += step) {
		setY(Math.min(y, mx)); await raf2();
		const cur = els.map(e => e.getBoundingClientRect().top);
		for (let i = 0; i < els.length; i++) {
			const d = cur[i] - prev[i];
			/* bottom exits travel DOWN at most scroll speed — mirrored bound */
			const hi = isBot[i] ? step + 1 : 1;
			if (d > hi || d < -step - 1) {
				const bad = Math.abs(d > hi ? d - (isBot[i] ? step : 0) : d + step);
				if (bad > worst) { worst = bad; at = Math.round(window.scrollY); }
			}
		}
		prev = cur;
		if (y >= mx) break;
	}
	if (worst > 1) return row('jump', 0, 'jump ' + worst.toFixed(1) + 'px at scrollY ' + at);
	return row('jump', 1, 'continuous, step ' + step + 'px' + (hasEng() ? '' : ' (no engine — static)'));
}
function parkOffset(el) {
	const v = (el.dataset.park || 'top').split(':');
	const side = v[0] === 'bottom' ? 'bottom' : 'top';
	let off = 0;
	if (v[1]) {
		const m = /^(-?[\d.]+)(px|rem|vh)?$/.exec(v[1].trim());
		if (m) off = +m[1] * (m[2] === 'rem' ? 16 : m[2] === 'vh' ? window.innerHeight / 100 : 1);
	}
	return { side, off };
}
async function qStickSlots() {
	const sticks = Array.from(document.querySelectorAll('#app .snow-stick[data-park]'));
	if (!sticks.length) return row('stickSlots', -1, 'no sticks (stick=off?)');
	const vh = window.innerHeight;
	let checked = 0;
	const bad = [];
	for (const el of sticks) {
		const scope = el.closest('section') || $('app');
		const sTop = scope.getBoundingClientRect().top + window.scrollY;
		const sBot = sTop + scope.getBoundingClientRect().height;
		const eTop = el.getBoundingClientRect().top + window.scrollY;
		const eH = el.getBoundingClientRect().height;
		const { side, off } = parkOffset(el);
		/* true sticky rule: ride the flow position until the viewport slot
		   engages, then hold it unless the parent's content box (margin box
		   for the stick) constrains first; clamps past maxY ride, not park */
		const scs = getComputedStyle(scope);
		const ecs = getComputedStyle(el);
		const padT = (parseFloat(scs.paddingTop) || 0) + (parseFloat(scs.borderTopWidth) || 0);
		const padB = (parseFloat(scs.paddingBottom) || 0) + (parseFloat(scs.borderBottomWidth) || 0);
		const mT = parseFloat(ecs.marginTop) || 0, mB = parseFloat(ecs.marginBottom) || 0;
		if (side === 'top') {
			if (sBot - eTop < 160) continue;
			setY(eTop + Math.min(250, (sBot - eTop) * 0.3)); await raf2();
			const r = el.getBoundingClientRect();
			checked++;
			const wantT = Math.max(eTop - window.scrollY, off, scope.getBoundingClientRect().top + padT + mT);
			if (Math.abs(r.top - wantT) > 2) { bad.push('top holds at ' + r.top.toFixed(1) + ', want ' + wantT.toFixed(1)); continue; }
			const hit = document.elementFromPoint(clamp(r.left + r.width / 2, 0, window.innerWidth - 1), clamp(r.top + r.height / 2, 0, vh - 1));
			if (!hit || !hit.closest || !hit.closest('.snow-stick')) bad.push('top covered by ' + (hit ? hit.className || hit.tagName : 'nothing'));
		} else {
			if (eTop - sTop < 160) continue;
			setY(eTop + eH - vh - Math.min(250, (eTop - sTop) * 0.3)); await raf2();
			const r = el.getBoundingClientRect();
			checked++;
			const want = Math.min(eTop + eH - window.scrollY, vh - off, scope.getBoundingClientRect().bottom - padB - mB);
			if (Math.abs(r.bottom - want) > 2) { bad.push('bottom holds at ' + r.bottom.toFixed(1) + ', want ' + want.toFixed(1)); continue; }
			const hit = document.elementFromPoint(clamp(r.left + r.width / 2, 0, window.innerWidth - 1), clamp(r.top + r.height / 2, 0, vh - 1));
			if (!hit || !hit.closest || !hit.closest('.snow-stick')) bad.push('bottom covered by ' + (hit ? hit.className || hit.tagName : 'nothing'));
		}
	}
	if (!checked) return row('stickSlots', -1, 'chapters too short to engage sticks');
	if (bad.length) return row('stickSlots', 0, bad.slice(0, 4).join('; '));
	return row('stickSlots', 1, checked + ' stick(s) hold their slots above wagons');
}
function logTable() {
	const t = {};
	for (const m of LOG) {
		const mm = /^ch(\d+) (\S+)$/.exec(m);
		if (!mm) continue;
		const k = mm[1], e = mm[2];
		t[k] = t[k] || {};
		t[k][e] = (t[k][e] || 0) + 1;
	}
	return t;
}
async function qEvents() {
	if (!hasEng()) return row('events', 1, 'no engine — scripts inert');
	if (Snowfall.eventCount === undefined) return row('events', 1, 'events land in 0.4 — engine has no event subscriber yet');
	const scripts = Array.from(document.querySelectorAll('#app script[type="txt"][event]'));
	if (!scripts.length) return row('events', -1, 'no scripts (events=off?)');
	const nCh = chapters().length;
	if (!nCh) return row('events', -1, 'no chapters');
	const expSet = {};
	for (const el of scripts) {
		const m = /ch(\d+)/.exec(el.textContent || '');
		if (m) expSet[m[1]] = 1;
	}
	const expCh = Object.keys(expSet).map(Number).sort((a, b) => a - b);
	if (!expCh.length) return row('events', -1, 'scripts log no ch numbers');
	const vh = window.innerHeight, mx = maxY();
	const hyst = (Snowfall.options && +Snowfall.options.hysteresis) || 40;
	const bad = [];
	let refreshes = 0, errCount = 0;
	const origErr = console.error;
	console.error = function() {
		const a0 = arguments[0];
		if (typeof a0 === 'string' && a0.indexOf('Snowfall event script') === 0) { errCount++; return; }
		return origErr.apply(console, arguments);
	};
	const origW = Snowfall.options.wagons, origA = Snowfall.options.parkedAsView;
	const doRefresh = replay => { refreshes++; engRefresh(replay); };
	const slowSamples = () => {
		const s = [0];
		for (let y = 200; y < mx; y += 200) s.push(y);
		if (s[s.length - 1] !== mx) s.push(mx);
		return s;
	};
	const everParkedAt = (aY, w, Wy, Ex) => {
		if (w < 0) return false;
		const n = Wy.length, free = new Array(n), pos = new Array(n);
		for (const sY of slowSamples()) {
			const d = aY - sY;
			if (d >= vh || d < 0) continue;
			for (let i = 0; i < n; i++) free[i] = Wy[i] - sY;
			Snowfall.chain(n, free, Ex, pos);
			if (pos[w] === 0 && free[w] <= 0) return true;
		}
		return false;
	};
	try {
		setY(Math.round(mx / 2)); await raf2();
		LOG.length = 0;
		doRefresh(false);
		await raf2();
		if (LOG.length) bad.push('reload mid-doc fired ' + LOG.length + '× (want 0)');
		setY(0); await raf2();
		LOG.length = 0;
		doRefresh(true);
		await raf2();
		const w0 = (Snowfall.wagons && Snowfall.wagons.n) ? Array.from(Snowfall.wagons.pos.slice(0, Snowfall.wagons.n)) : null;
		const bg0 = (Snowfall.morph && Snowfall.morph.n && Snowfall.debug) ? Snowfall.debug.styleBg : null;
		for (let y = 200; y < mx; y += 200) { setY(y); await raf2(); }
		setY(mx); await raf2();
		const w1 = (Snowfall.wagons && Snowfall.wagons.n) ? Array.from(Snowfall.wagons.pos.slice(0, Snowfall.wagons.n)) : null;
		const bg1 = (Snowfall.morph && Snowfall.morph.n && Snowfall.debug) ? Snowfall.debug.styleBg : null;
		const slow = logTable();
		const slowLog = LOG.slice();
		const Ev0 = Snowfall.events;
		const Ay0 = Ev0 && Ev0.n ? Array.from(Ev0.y.slice(0, Ev0.n)) : [];
		const Aw0 = Ev0 && Ev0.n ? Array.from(Ev0.wagon.slice(0, Ev0.n)) : [];
		const Wy0 = (Snowfall.wagons && Snowfall.wagons.n) ? Array.from(Snowfall.wagons.y.slice(0, Snowfall.wagons.n)) : [];
		const Ex0 = (Snowfall.wagons && Snowfall.wagons.n) ? Array.from(Snowfall.wagons.ext.slice(0, Snowfall.wagons.n)) : [];
		for (let j = 0; j < expCh.length; j++) {
			const k = expCh[j], c = slow[k] || {};
			for (const e of ['view', 'center', 'end']) if (c[e] !== 1) bad.push('ch' + k + ' ' + e + '×' + (c[e] || 0) + ' (slow)');
			if (c.skip) bad.push('ch' + k + ' skip×' + c.skip + ' (slow)');
			const pc = c.parked || 0;
			if (pc !== 1) {
				if (pc !== 0) bad.push('ch' + k + ' parked×' + pc + ' (slow)');
				else if (j < Ay0.length && everParkedAt(Ay0[j], Aw0[j], Wy0, Ex0)) bad.push('ch' + k + ' parked×0 but wagon pins on slow samples');
			}
		}
		if (expSet['1']) {
			if ((slow[1] || {})['center+parked'] !== 2) bad.push('ch1 center+parked×' + ((slow[1] || {})['center+parked'] || 0) + ', want 2');
			const ic = slowLog.indexOf('ch1 center'), ip = slowLog.indexOf('ch1 parked');
			if (ic < 0 || ip < 0) bad.push('ch1 center/parked missing for order check');
			else {
				if (slowLog[ic + 1] !== 'ch1 center+parked') bad.push('ch1 center order: want center+parked right after center');
				if (slowLog[ip + 1] !== 'ch1 center+parked') bad.push('ch1 parked order: want center+parked right after parked');
				if (ic + 1 === ip + 1) bad.push('ch1 center/parked share one center+parked slot');
			}
		}
		if (w0 && w1) {
			let moved = false;
			for (let i = 0; i < w0.length; i++) if (w0[i] !== w1[i]) { moved = true; break; }
			if (!moved) bad.push('wagons did not move during slow (broken snippet killed frame?)');
		}
		if (bg0 !== null && bg1 !== null && bg0 === bg1 && Snowfall.morph.n > 1) bad.push('morph did not move during slow');
		const len1 = LOG.length;
		for (let y = mx - 200; y > 0; y -= 200) { setY(y); await raf2(); }
		setY(0); await raf2();
		if (LOG.length !== len1) bad.push('reverse fired ' + (LOG.length - len1) + '× (want 0)');
		LOG.length = 0;
		for (let y = 200; y < mx; y += 200) { setY(y); await raf2(); }
		setY(mx); await raf2();
		const slow2 = logTable();
		for (let j = 0; j < expCh.length; j++) {
			const k = expCh[j], c = slow2[k] || {};
			const rearmed = j < Ay0.length ? Ay0[j] > vh + hyst : true;
			if (rearmed) {
				for (const e of ['view', 'center', 'end']) if (c[e] !== 1) bad.push('ch' + k + ' ' + e + '×' + (c[e] || 0) + ' (re-arm)');
				if (c.skip) bad.push('ch' + k + ' skip×' + c.skip + ' (re-arm)');
				const pc2 = c.parked || 0;
				if (pc2 !== 1 && (pc2 !== 0 || everParkedAt(Ay0[j], Aw0[j], Wy0, Ex0))) bad.push('ch' + k + ' parked×' + pc2 + ' (re-arm)');
			} else {
				if (c.view || c.center || c.parked || c.skip) bad.push('ch' + k + ' early re-fired view/center/parked/skip (want end-only)');
				if (c.end !== 1) bad.push('ch' + k + ' end×' + (c.end || 0) + ' (re-arm early, want 1)');
			}
		}
		if (expSet['1'] && Ay0.length && Ay0[0] > vh + hyst && (slow2[1] || {})['center+parked'] !== 2)
			bad.push('ch1 center+parked×' + ((slow2[1] || {})['center+parked'] || 0) + ' (re-arm, want 2)');
		setY(0); await raf2();
		LOG.length = 0;
		doRefresh(true);
		await raf2();
		setY(mx); await raf2(); await raf2();
		const flick = logTable();
		const lo = Math.min.apply(null, expCh), hi = Math.max.apply(null, expCh);
		const mids = expCh.filter(k => k !== lo && k !== hi);
		for (const k of mids) {
			const c = flick[k] || {};
			if (c.skip !== 1) bad.push('ch' + k + ' skip×' + (c.skip || 0) + ' (flick)');
			if (c.end !== 1) bad.push('ch' + k + ' end×' + (c.end || 0) + ' (flick)');
			if (c.view) bad.push('ch' + k + ' view×' + c.view + ' (flick)');
			if (c.center) bad.push('ch' + k + ' center×' + c.center + ' (flick)');
			if (c.parked) bad.push('ch' + k + ' parked×' + c.parked + ' (flick)');
		}
		let thChecked = 0, thSkipped = 0;
		let thAnchor = -1;
		{
			const Ev = Snowfall.events;
			if (Ev && Ev.n) for (let i = 0; i < Ev.n; i++) {
				const Y = Ev.y[i];
				if (Y > vh + 12 && Y < mx - 12) { thAnchor = i; break; }
			}
		}
		if (thAnchor < 0) thSkipped++;
		else {
			const Yt0 = Snowfall.events.y[thAnchor];
			const offs = [[0, vh, 'view'], [1, vh / 2, 'center'], [3, 0, 'end']];
			for (const t of offs) {
				const bit = t[0], off = t[1], name = t[2];
				const exp0 = Yt0 - off;
				if (exp0 < 10 || exp0 > mx - 10) { thSkipped++; continue; }
				setY(Math.round(exp0 - 10)); await raf2();
				LOG.length = 0;
				doRefresh(true);
				await raf2();
				const Ev1 = Snowfall.events;
				if (!Ev1 || thAnchor >= Ev1.n) { bad.push(name + ' anchor lost after refresh'); continue; }
				const exp1 = Ev1.y[thAnchor] - off;
				if (Ev1.flags[thAnchor] & (1 << bit)) { bad.push(name + ' threshold pre-fired at -10px'); continue; }
				let firedAt = -1;
				for (let s = Math.round(exp1 - 9); s <= Math.round(exp1 + 10); s++) {
					setY(s); await raf2();
					if (Snowfall.events.flags[thAnchor] & (1 << bit)) { firedAt = window.scrollY; break; }
				}
				if (firedAt < 0) bad.push(name + ' threshold never fired near ' + Math.round(exp1));
				else if (Math.abs(firedAt - exp1) > 2) bad.push(name + ' threshold off by ' + Math.abs(firedAt - exp1).toFixed(1) + 'px (want ±2)');
				else thChecked++;
			}
			let pa = -1, pYw = 0;
			{
				const Ev = Snowfall.events, Wg = Snowfall.wagons;
				if (Ev && Wg && Ev.n && Wg.n) {
					const Wy = Array.from(Wg.y.slice(0, Wg.n)), Ex = Array.from(Wg.ext.slice(0, Wg.n));
					for (let i = 0; i < Ev.n && pa < 0; i++) {
						const w = Ev.wagon[i];
						if (w < 0) continue;
						const Ya = Ev.y[i], Yw = Wy[w], delta = Ya - Yw;
						if (delta < 1 || delta >= vh) continue;
						if (Yw < 10 || Yw > mx - 10) continue;
						const sYt = Math.ceil(Yw);
						const free = Wy.map(v => v - sYt), pos = new Array(Wy.length).fill(0);
						Snowfall.chain(Wy.length, free, Ex, pos);
						if (pos[w] === 0 && free[w] <= 0) { pa = i; pYw = Yw; }
					}
				}
			}
			if (pa < 0) thSkipped++;
			else {
				setY(Math.round(pYw - 10)); await raf2();
				LOG.length = 0;
				doRefresh(true);
				await raf2();
				const Ev2 = Snowfall.events;
				if (!Ev2 || pa >= Ev2.n) bad.push('parked anchor lost after refresh');
				else if (Ev2.flags[pa] & 4) bad.push('parked threshold pre-fired at -10px');
				else {
					const Wg2 = Snowfall.wagons;
					const pYw1 = Wg2 && pa < Ev2.n && Ev2.wagon[pa] >= 0 ? Wg2.y[Ev2.wagon[pa]] : pYw;
					let firedAt = -1;
					for (let s = Math.round(pYw1 - 9); s <= Math.round(pYw1 + 10); s++) {
						setY(s); await raf2();
						if (Snowfall.events.flags[pa] & 4) { firedAt = window.scrollY; break; }
					}
					if (firedAt < 0) bad.push('parked threshold never fired near ' + Math.round(pYw1));
					else if (Math.abs(firedAt - pYw1) > 2) bad.push('parked threshold off by ' + Math.abs(firedAt - pYw1).toFixed(1) + 'px (want ±2)');
					else thChecked++;
				}
			}
		}
		const wTestCh = expCh.includes(2) ? 2 : expCh[0];
		const wTestIdx = expCh.indexOf(wTestCh);
		if (wTestIdx >= 0) {
			Snowfall.options.wagons = 0; Snowfall.options.parkedAsView = 0;
			setY(0); await raf2();
			LOG.length = 0;
			doRefresh(true);
			await raf2();
			{
				const Ev = Snowfall.events;
				const Yw = Ev && wTestIdx < Ev.n ? Ev.y[wTestIdx] : mx;
				const walkTo = Math.min(mx, Yw + 12);
				for (let y = 200; y < walkTo; y += 200) { setY(y); await raf2(); }
				setY(walkTo); await raf2();
			}
			const t0 = logTable()[wTestCh] || {};
			if (t0.view !== 1) bad.push('ch' + wTestCh + ' view×' + (t0.view || 0) + ' (wagons=0, want 1)');
			if (t0.parked) bad.push('ch' + wTestCh + ' parked×' + t0.parked + ' (wagons=0, want 0)');
			Snowfall.options.parkedAsView = 1;
			setY(0); await raf2();
			LOG.length = 0;
			doRefresh(true);
			await raf2();
			{
				const Ev = Snowfall.events;
				const Yw = Ev && wTestIdx < Ev.n ? Ev.y[wTestIdx] : mx;
				const walkTo = Math.min(mx, Yw + 12);
				for (let y = 200; y < walkTo; y += 200) { setY(y); await raf2(); }
				setY(walkTo); await raf2();
			}
			const t1 = logTable()[wTestCh] || {};
			if (t1.view !== 1) bad.push('ch' + wTestCh + ' view×' + (t1.view || 0) + ' (alias, want 1)');
			if (t1.parked !== 1) bad.push('ch' + wTestCh + ' parked×' + (t1.parked || 0) + ' (alias, want 1 with view)');
			else {
				const iv = LOG.indexOf('ch' + wTestCh + ' view'), ipa = LOG.indexOf('ch' + wTestCh + ' parked');
				if (iv < 0 || ipa !== iv + 1) bad.push('ch' + wTestCh + ' alias order: parked must follow view immediately');
			}
		}
		if (errCount !== refreshes) bad.push('broken snippet errors ' + errCount + '× for ' + refreshes + ' refreshes (want 1 per refresh)');
	} finally {
		if (hasEng() && Snowfall.options) { Snowfall.options.wagons = origW; Snowfall.options.parkedAsView = origA; }
		try { engRefresh(); } catch (_e) {}
		console.error = origErr;
	}
	if (bad.length) return row('events', 0, bad.slice(0, 6).join('; '));
	return row('events', 1, expCh.length + ' chapter(s): slow 1×, reverse 0, re-arm ok, flick skip+end, thresholds ±2px (' + thChecked + ' checked), wagons0+alias ok, broken isolated');
}
async function qMorph() {
	if (!hasEng() || !Snowfall.morph) return row('morph', -1, 'no engine');
	const M0 = Snowfall.morph;
	const n = M0.n;
	if (!n) return row('morph', -1, 'no anchors (style=off?)');
	const vh = window.innerHeight, mx = maxY();
	const root = document.documentElement;
	const Ay = Array.from(M0.ay), Rg = Array.from(M0.range);
	const Sbg = Array.from(M0.sbg), Sfg = Array.from(M0.sfg);
	const bad = [];
	const bgNow = () => cssRGBA(getComputedStyle(root).backgroundColor);
	const fgNow = () => cssRGBA(getComputedStyle(root).color);
	const land = async sY => {
		sY = Math.round(sY);
		if (sY < 0 || sY > mx) return false;
		setY(sY); await raf2();
		return Math.abs(window.scrollY - sY) <= 1;
	};
	/* engine must never paint or reclass anchors (wagon transforms excepted) */
	const snapAnchor = e => (e.getAttribute('style') || '').replace(/transform\s*:[^;]+;?/g, '') + '|' + (e.getAttribute('class') || '');
	const before = M0.els.map(snapAnchor);
	const srcAny = (kind, i) => { for (let k = i; k >= 0; k--) if (kind[k] !== 0) return k; return -1; };
	const nextCol = (kind, i) => { for (let k = i + 1; k < n; k++) if (kind[k] === 1) return k; return -1; };
	const chanEq = (got, ch, i) => got && got[0] === M0[ch[0]][i] && got[1] === M0[ch[1]][i] && got[2] === M0[ch[2]][i] && got[3] === M0[ch[3]][i];
	let arrivals = 0, skipped = 0;
	for (let i = 0; i < n; i++) {
		/* arrival sampled 1px PAST the anchor: integer scrollY cannot hit ay
		   exactly, and from above the value is held-exact (exact only outside
		   the next colour zone, effective starts) */
		if (i < n - 1 && Ay[i + 1] - Ay[i] <= 2) { skipped++; continue; }
		const ub = nextCol(M0.bgKind, i), uf = nextCol(M0.fgKind, i);
		const okB = ub < 0 || Ay[i] + 1 < Sbg[ub];
		const okF = uf < 0 || Ay[i] + 1 < Sfg[uf];
		if (!okB && !okF) { skipped++; continue; }
		if (!(await land(Ay[i] + 1 - vh / 2))) { skipped++; continue; }
		if (okB) {
			const s = srcAny(M0.bgKind, i);
			if (s < 0) skipped++;
			else if (M0.bgKind[s] === 2) {
				arrivals++;
				if (root.style.getPropertyValue('--snow-bg') !== M0.tokBg[s])
					bad.push('bg token switch at #' + i);
			} else if (!chanEq(bgNow(), ['br', 'bg_', 'bb', 'ba'], s)) {
				const g = bgNow();
				bad.push('bg arrival #' + i + ': got ' + hex3(g) + ' want ' + hex3([M0.br[s], M0.bg_[s], M0.bb[s]]));
			} else arrivals++;
		}
		if (okF) {
			const s = srcAny(M0.fgKind, i);
			if (s < 0) skipped++;
			else if (M0.fgKind[s] === 2) {
				arrivals++;
				if (root.style.getPropertyValue('--snow-fg') !== M0.tokFg[s])
					bad.push('fg token switch at #' + i);
			} else if (!chanEq(fgNow(), ['fr', 'fg_', 'fb', 'fa'], s)) {
				const g = fgNow();
				bad.push('fg arrival #' + i + ': got ' + hex3(g) + ' want ' + hex3([M0.fr[s], M0.fg_[s], M0.fb[s]]));
			} else arrivals++;
		}
	}
	/* no-snap: 1px step into the anchor moves ≤ 2×mean slope + quantisation */
	let snaps = 0;
	for (let j = 0; j < n; j++) {
		if (M0.bgKind[j] !== 1) continue;
		const s = srcAny(M0.bgKind, j - 1);
		if (s < 0 || M0.bgKind[s] !== 1) continue;
		if (j > 0 && Ay[j] - Ay[j - 1] < 2) continue;
		if (Ay[j] - Sbg[j] < 2) continue;
		if (!(await land(Ay[j] - 1 - vh / 2))) continue;
		const g0 = bgNow();
		if (!(await land(Ay[j] - vh / 2))) continue;
		const g1 = bgNow();
		if (!g0 || !g1) { bad.push('snap #' + j + ': unreadable colour'); continue; }
		snaps++;
		/* ±0.5px landing on each sample → true Δc ≤ 2; ease slope ≤ 2/D */
		const Deff = Math.max(2, Ay[j] - Sbg[j]);
		const D = [Math.abs(M0.br[j] - M0.br[s]), Math.abs(M0.bg_[j] - M0.bg_[s]), Math.abs(M0.bb[j] - M0.bb[s])];
		for (let ch = 0; ch < 3; ch++) {
			const allow = Math.ceil(4 * D[ch] / Deff) + 1;
			if (Math.abs(g1[ch] - g0[ch]) > allow)
				bad.push('snap #' + j + ' ch' + ch + ': ' + Math.abs(g1[ch] - g0[ch]) + 'px-step > ' + allow);
		}
	}
	/* class swap at c >= ay[j], ±2px; foreign classes untouched */
	const uni = {};
	for (let i = 0; i < n; i++)
		for (const t of (M0.cls[i] || '').split(' ').filter(Boolean)) uni[t] = 1;
	const le = c => { let k = -1; for (let i = 0; i < n; i++) if (Ay[i] <= c) k = i; return k; };
	const wantCls = c => { const k = le(c); return k < 0 ? [] : (M0.cls[k] || '').split(' ').filter(Boolean); };
	const clsOk = (c, tag) => {
		const want = wantCls(c), have = rootCls().split(' ').filter(Boolean);
		for (const t of want) if (have.indexOf(t) < 0) { bad.push('class ' + tag + ': missing .' + t); return; }
		for (const t of have) if (uni[t] && want.indexOf(t) < 0) { bad.push('class ' + tag + ': stale .' + t); return; }
	};
	root.classList.add('qa-foreign');
	let swaps = 0;
	for (let j = 0; j < n; j++) {
		if (j > 0 && Ay[j] - Ay[j - 1] <= 4) continue;
		if (j < n - 1 && Ay[j + 1] - Ay[j] <= 4) continue;
		if (!(await land(Ay[j] - 2 - vh / 2))) continue;
		clsOk(Ay[j] - 2, '#' + j + '−2');
		if (!(await land(Ay[j] + 2 - vh / 2))) continue;
		clsOk(Ay[j] + 2, '#' + j + '+2');
		swaps++;
	}
	if (!root.classList.contains('qa-foreign')) bad.push('foreign class removed by engine');
	root.classList.remove('qa-foreign');
	for (let i = 0; i < n; i++)
		if (M0.els[i].isConnected && snapAnchor(M0.els[i]) !== before[i])
			bad.push('anchor #' + i + ' style/class touched');
	/* idle: zero setProperty while scrollY is unchanged */
	await raf2();
	const st = root.style;
	const hadOwn = Object.prototype.hasOwnProperty.call(st, 'setProperty');
	const prevOwn = st.setProperty;
	let idleCalls = 0;
	st.setProperty = function(nn, vv, pp) { idleCalls++; return CSSStyleDeclaration.prototype.setProperty.call(this, nn, vv, pp); };
	await new Promise(res => setTimeout(res, 350));
	if (hadOwn) st.setProperty = prevOwn; else delete st.setProperty;
	if (idleCalls) bad.push('idle wrote ' + idleCalls + '× setProperty');
	/* regen: refresh() picks up + drops an anchor, no reload */
	const tmp = document.createElement('i');
	tmp.className = 'snow-fg';
	tmp.setAttribute('data-bg', '#123456');
	tmp.setAttribute('data-fg', '#654321');
	$('app').appendChild(tmp);
	engRefresh();
	const n1 = Snowfall.morph ? Snowfall.morph.n : -1;
	tmp.remove();
	engRefresh();
	const n2 = Snowfall.morph ? Snowfall.morph.n : -1;
	if (n1 !== n + 1) bad.push('regen: refresh saw ' + n1 + ' anchors, want ' + (n + 1));
	if (n2 !== n) bad.push('regen: after remove saw ' + n2 + ', want ' + n);
	if (!arrivals && !snaps && !swaps) return row('morph', -1, 'anchors unreachable at vh ' + vh);
	if (bad.length) return row('morph', 0, bad.slice(0, 5).join('; '));
	return row('morph', 1, arrivals + ' arrival(s), ' + snaps + ' snap(s), ' + swaps + ' swap(s), idle 0 writes, regen ok'
		+ (skipped ? ', ' + skipped + ' skipped (zone/clamp)' : ''));
}
async function qaAll() {
	if (qaBusy) return;
	qaBusy = true;
	stopAuto();
	$('qaBtn').disabled = true;
	$('auto').disabled = true;
	$('qa').innerHTML = '';
	try {
		await qReversibility();
		await qOverlap();
		await qAnchorAlign();
		await qJump();
		await qStickSlots();
		await qEvents();
		await qMorph();
	} finally {
		qaBusy = false;
		$('qaBtn').disabled = false;
		$('auto').disabled = false;
	}
}

/* ---------------- boot ---------------- */
function bind(id, ev, fn) { $(id).addEventListener(ev, fn); }
function boot() {
	readHash(); build();
	bind('reg','click',build); bind('seed','click',()=>{SEED=(Math.random()*0xFFFFFFFF)>>>0;build();});
	bind('addChapter','click',addChapter); bind('addBackground','click',addBackground); bind('templateCopy','click',copyTemplate);
	bind('sourceToggle','click',()=>toggleSource()); bind('exampleImages','change',build); bind('exampleGradient','change',build);
	bind('n','input',()=>{$('nO').textContent=$('n').value;}); bind('bgs','input',()=>{$('bgsO').textContent=$('bgs').value;});
	bind('speed','input',()=>{$('spd').textContent=$('speed').value;}); bind('preset','change',()=>applyPreset($('preset').value));
	bind('inspectFields','change',applyInspector);
	bind('src','input',()=>{sourceDirty=true;headLineCache=null;sourceStatus('source ≠ preview',false);clearTimeout(sourceTimer);sourceTimer=setTimeout(()=>{if(!qaBusy)applySource();},400);});
	bind('src','blur',()=>{flushSource();writeSource(false);});
	bind('src','keydown',e=>{if(e.key==='Tab'){e.preventDefault();const p=e.target.selectionStart;e.target.setRangeText('\t',p,e.target.selectionEnd,'end');e.target.dispatchEvent(new Event('input'));}if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();applySource();}if(e.key==='Escape'){e.preventDefault();clearTimeout(sourceTimer);e.target.value=lastApplied;sourceDirty=false;sourceStatus('reverted',false);}});
	bind('src','wheel',()=>{scrollDriver='source';driverUntil=Date.now()+600;},{passive:true});
	bind('src','scroll',()=>{if(Date.now()<paneQuietUntil||!$('syncScroll').checked||qaBusy)return;scrollDriver='source';driverUntil=Date.now()+600;const lines=headLines(),top=$('src').scrollTop/18;let i=0;for(let k=0;k<lines.length;k++)if(lines[k]<=top)i=k;const h=chapters()[i];if(h)setY(h.getBoundingClientRect().top+window.scrollY-window.innerHeight*.1);});
	bind('top','click',()=>setY(0));bind('bot','click',()=>setY(maxY()));bind('prev','click',()=>gotoChapter(-1));bind('next','click',()=>gotoChapter(1));bind('jump','change',jumpTo);bind('auto','click',toggleAuto);bind('qaBtn','click',()=>{flushSource();qaAll();});
	bind('wire','change',()=>{$('wires').classList.toggle('on',$('wire').checked);if(!$('wire').checked)$('wires').innerHTML='';});
	window.addEventListener('wheel',e=>{if(e.target!==$('src')){scrollDriver='preview';driverUntil=Date.now()+600;}},{passive:true}); window.addEventListener('resize',engRefresh);
	document.addEventListener('keydown',e=>{const t=(e.target&&e.target.tagName)||'';if((e.key==='s'||e.key==='S')&&t!=='INPUT'&&t!=='SELECT'&&t!=='TEXTAREA'){toggleSource();return;}if(t==='INPUT'||t==='SELECT'||t==='TEXTAREA')return;if(e.key==='r')build();else if(e.key==='t')setY(0);else if(e.key==='b')setY(maxY());else if(e.key==='q')qaAll();else if(e.key===' ') {e.preventDefault();toggleAuto();}});
	panelH=$('gen').offsetHeight+$('diag').offsetHeight;requestAnimationFrame(fpsLoop);setInterval(diagTick,100);diagTick();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();