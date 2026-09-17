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
function engRefresh() { if (window.Snowfall && Snowfall.refresh) Snowfall.refresh(); }
function wagons() { return Array.from(document.querySelectorAll('#app .snow-bg')); }
function chapters() { return Array.from(document.querySelectorAll('#app h4.n')); }
const raf2 = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
function setY(y) { window.scrollTo(0, clamp(Math.round(y), 0, maxY())); }
/* tolerant transform parse: engines normalize translate3d spacing differently */
function parseT(el) {
	const s = el.style.transform || '';
	if (!s) return { x: 0, y: 0 };
	const m = /translate3d\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(s);
	if (!m) return { x: 0, y: 0 };
	return { x: +m[1], y: +m[2] };
}

/* ---------------- config in location.hash ---------------- */
const IDS = ['preset', 'n', 'len', 'gap', 'flow', 'mode', 'size', 'dir', 'nest', 'stick'];
const CHECKS = ['style', 'events'];
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
	if (cfg.style && rng() < 0.3) at += ' data-bg="' + pal.bg + '"';
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
	if (wrap === 'flat') return s;
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
function build() {
	const cfg = getCfg();
	const rng = mulberry32(SEED);
	WAGON_NO = 0;
	const parts = [];
	if (cfg.preset === 'draft') parts.push(draftHTML(rng, cfg));
	else {
		const n = clamp(+cfg.n || 6, 1, 12);
		for (let k = 1; k <= n; k++) parts.push(chapterHTML(rng, k, cfg));
	}
	parts.push('<div class="tail"></div>');
	$('app').innerHTML = parts.join('');
	LOG.length = 0;
	$('qa').innerHTML = '';
	$('jump').max = chapters().length || 1;
	window.scrollTo(0, 0);
	writeHash();
	engRefresh();
}

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
	$('dstats').textContent = 'scrollY ' + y + ' · vh ' + vh + ' · doc ' + docH
		+ '\n#bg ' + n + ' · ' + eng + ' · ' + act
		+ '\nfps ' + fps + ' · worst ' + worstMs.toFixed(1) + 'ms'
		+ '\nevents ' + logCounts() + ' · total ' + LOG.length
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
async function qReversibility() {
	const els = wagons();
	if (!els.length) return row('reversibility', -1, 'no wagons');
	const mx = maxY(), N = 10, downs = [], ups = [];
	for (let k = 0; k < N; k++) {
		const t = Math.round(mx * k / (N - 1));
		setY(t); await raf2();
		if (Math.abs(window.scrollY - t) > 1)
			return row('reversibility', 0, 'scroll did not land: want ' + t + ' got ' + Math.round(window.scrollY));
		downs.push(els.map(e => e.style.transform || ''));
	}
	for (let k = N - 1; k >= 0; k--) {
		setY(Math.round(mx * k / (N - 1))); await raf2();
		ups.unshift(els.map(e => e.style.transform || ''));
	}
	let differ = 0;
	for (let k = 0; k < N; k++)
		for (let i = 0; i < els.length; i++)
			if (downs[k][i] !== ups[k][i]) differ++;
	if (differ) return row('reversibility', 0, differ + ' transform(s) differ for equal scrollY');
	return row('reversibility', 1, N + '/' + N + ' identical' + (hasEng() ? '' : ' (no engine — static)'));
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
		if (side === 'top') {
			if (sBot - eTop < 160) continue;
			setY(eTop + Math.min(250, (sBot - eTop) * 0.3)); await raf2();
			const r = el.getBoundingClientRect();
			checked++;
			if (Math.abs(r.top - off) > 2) { bad.push('top holds at ' + r.top.toFixed(1) + ', want ' + off); continue; }
			const hit = document.elementFromPoint(clamp(r.left + r.width / 2, 0, window.innerWidth - 1), clamp(r.top + r.height / 2, 0, vh - 1));
			if (!hit || !hit.closest || !hit.closest('.snow-stick')) bad.push('top covered by ' + (hit ? hit.className || hit.tagName : 'nothing'));
		} else {
			if (eTop - sTop < 160) continue;
			setY(eTop + eH - vh - Math.min(250, (eTop - sTop) * 0.3)); await raf2();
			const r = el.getBoundingClientRect();
			checked++;
			if (Math.abs(r.bottom - (vh - off)) > 2) { bad.push('bottom holds at ' + r.bottom.toFixed(1) + ', want ' + (vh - off)); continue; }
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
	const nCh = chapters().length;
	if (!nCh) return row('events', -1, 'no chapters');
	engRefresh(); setY(0); await raf2(); await raf2();
	LOG.length = 0;
	const mx = maxY();
	for (let y = 200; y < mx; y += 200) { setY(y); await raf2(); }
	setY(mx); await raf2();
	const slow = logTable();
	const bad = [];
	for (let k = 1; k <= nCh; k++) {
		const c = slow[k] || {};
		for (const e of ['view', 'center', 'parked', 'end'])
			if (c[e] !== 1) bad.push('ch' + k + ' ' + e + '×' + (c[e] || 0) + ' (slow)');
		if (c.skip) bad.push('ch' + k + ' skip×' + c.skip + ' (slow)');
	}
	if ((slow[1] || {})['center+parked'] !== 2) bad.push('ch1 center+parked×' + ((slow[1] || {})['center+parked'] || 0) + ', want 2');
	engRefresh(); setY(0); await raf2(); await raf2();
	LOG.length = 0;
	setY(mx); await raf2(); await raf2();
	const flick = logTable();
	for (let k = 2; k <= nCh - 1; k++) {
		const c = flick[k] || {};
		if (c.skip !== 1) bad.push('ch' + k + ' skip×' + (c[c.skip] || 0) + ' (flick)');
		if (c.view) bad.push('ch' + k + ' view×' + c.view + ' (flick)');
		if (c.center) bad.push('ch' + k + ' center×' + c.center + ' (flick)');
	}
	if (bad.length) return row('events', 0, bad.slice(0, 6).join('; '));
	return row('events', 1, nCh + ' chapter(s): slow 1× each, flick skips clean');
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
	} finally {
		qaBusy = false;
		$('qaBtn').disabled = false;
		$('auto').disabled = false;
	}
}

/* ---------------- boot ---------------- */
function bind(id, ev, fn) { $(id).addEventListener(ev, fn); }
function boot() {
	readHash();
	build();
	bind('reg', 'click', build);
	bind('seed', 'click', () => { SEED = (Math.random() * 0xFFFFFFFF) >>> 0; build(); });
	bind('top', 'click', () => setY(0));
	bind('bot', 'click', () => setY(maxY()));
	bind('prev', 'click', () => gotoChapter(-1));
	bind('next', 'click', () => gotoChapter(1));
	bind('jump', 'change', jumpTo);
	bind('auto', 'click', toggleAuto);
	bind('qaBtn', 'click', qaAll);
	bind('n', 'input', () => { $('nO').textContent = $('n').value; });
	bind('speed', 'input', () => { $('spd').textContent = $('speed').value; });
	bind('preset', 'change', () => applyPreset($('preset').value));
	bind('wire', 'change', () => {
		$('wires').classList.toggle('on', $('wire').checked);
		if (!$('wire').checked) $('wires').innerHTML = '';
	});
	window.addEventListener('resize', engRefresh);
	document.addEventListener('keydown', e => {
		const t = (e.target && e.target.tagName) || '';
		if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
		if (e.key === 'r') build();
		else if (e.key === 't') setY(0);
		else if (e.key === 'b') setY(maxY());
		else if (e.key === 'q') qaAll();
		else if (e.key === 'w') { $('wire').checked = !$('wire').checked; $('wire').dispatchEvent(new Event('change')); }
		else if (e.key === ' ') { e.preventDefault(); toggleAuto(); }
	});
	panelH = $('gen').offsetHeight + $('diag').offsetHeight;
	requestAnimationFrame(fpsLoop);
	setInterval(diagTick, 100);
	diagTick();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();