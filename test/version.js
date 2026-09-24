#!/usr/bin/env node
/* test/version.js — cache-token freshness gate. Every local asset url in the
	html pages carries the content-derived ?v= token that tools/version.js
	computes, so editing any shared .js/.css without a resync fails here instead
	of shipping a stale preview. Fix: `node tools/version.js`.
	Directly executable or via `node test/run.js`. */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const r = spawnSync(process.execPath,
	[path.join(__dirname, '..', 'tools', 'version.js'), '--check'], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
