#!/usr/bin/env node
/* tools/version.js — cache-token sync for the html pages.

	Browsers cache local .js/.css by url, and a stale harness.js next to a fresh
	snowfall-region.js fails silently (a page of hidden crops, no error line), so
	every local asset carries one shared ?v=<token>. The token is sha256[:10] over
	the sorted path+content of every versioned asset: any edit to a shared file
	changes every url at once, and one page can never half-update next to another.

	`node tools/version.js` rewrites all pages; `--check` only reports drift
	(exit 1) — wired into the gate matrix as test/version.js. */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const CHECK = process.argv.includes('--check');
const ATTR = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const SKIP = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;      // external, data:, anchors
const ASSET = /\.(?:js|css)$/i;
const QUERY = /\?v=[^\s?&#]*/;

function pages() {
	const out = fs.readdirSync(root).filter(f => f.endsWith('.html'));
	const qa = path.join(root, 'test', 'browser');
	for (const f of fs.readdirSync(qa))
		if (f.endsWith('.html')) out.push(path.join('test', 'browser', f));
	return out.sort();
}

/* urls that join the shared token: already tagged, or a local .js/.css that
	must be (window.fetch results and media stay out of the cache game) */
function versioned(value) {
	if (SKIP.test(value)) return null;
	if (QUERY.test(value)) return true;
	return ASSET.test(value);
}

function retag(value, tok) {
	const q = QUERY.exec(value);
	if (!q) return value + '?v=' + tok;
	return value.slice(0, q.index) + '?v=' + tok + value.slice(q.index + q[0].length);
}

function collect() {
	const refs = [];      // { page, value }
	const assets = new Set();
	for (const page of pages()) {
		const text = fs.readFileSync(path.join(root, page), 'utf8');
		let m;
		ATTR.lastIndex = 0;
		while ((m = ATTR.exec(text))) {
			const value = m[1] !== undefined ? m[1] : m[2];
			if (!versioned(value)) continue;
			refs.push({ page, value });
			const bare = value.replace(QUERY, '');
			const rel = path.normalize(path.join(path.dirname(page), bare)).split(path.sep).join('/');
			if (fs.existsSync(path.join(root, rel))) assets.add(rel);
			else console.error('warn: missing asset ' + rel + ' (' + page + ')');
		}
	}
	return { refs, assets: [...assets].sort() };
}

function token(assets) {
	const h = crypto.createHash('sha256');
	for (const rel of assets) {
		h.update(rel);
		h.update('\0');
		h.update(fs.readFileSync(path.join(root, rel)));
	}
	return h.digest('hex').slice(0, 10);
}

const { refs, assets } = collect();
const tok = token(assets);

if (CHECK) {
	const bad = refs.filter(r => retag(r.value, tok) !== r.value);
	for (const r of bad)
		console.log(r.page + ': ' + r.value + ' -> ' + retag(r.value, tok));
	if (bad.length) {
		console.log('\n' + bad.length + ' of ' + refs.length + ' ref(s) drifted from the asset token'
			+ ' — a shared .js/.css changed without a resync. Fix: node tools/version.js');
		process.exit(1);
	}
	console.log('all ' + refs.length + ' versioned refs across ' + pages().length
		+ ' pages match ?v=' + tok);
	process.exit(0);
}

let changed = 0;
for (const page of pages()) {
	const abs = path.join(root, page);
	const before = fs.readFileSync(abs, 'utf8');
	let hits = 0;
	const after = before.replace(ATTR, (full, dq, sq) => {
		const value = dq !== undefined ? dq : sq;
		if (!versioned(value)) return full;
		hits++;
		return full.replace(/(["']).*\1/, '"' + retag(value, tok) + '"');
	});
	if (after === before) continue;
	fs.writeFileSync(abs, after);
	changed++;
	console.log(page + ': ' + hits + ' ref(s) -> ?v=' + tok);
}
console.log(changed ? changed + ' page(s) synced to ?v=' + tok
	: 'all pages already at ?v=' + tok);
