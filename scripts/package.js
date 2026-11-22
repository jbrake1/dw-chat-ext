#!/usr/bin/env node
/* Zips extension/ (exactly what is loaded unpacked) to dist/dw-chat-ext-v<version>.zip. Uses python3's zipfile (no `zip` binary needed). */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '..');
const v = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8')).version;
const out = path.join(root, 'dist', `dw-chat-ext-v${v}.zip`);
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.rmSync(out, { force: true });
const py = `
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for d, _, fs in sorted(os.walk(src)):
        for f in sorted(fs):
            if f == '.DS_Store': continue
            p = os.path.join(d, f)
            z.write(p, os.path.relpath(p, src))
`;
cp.execFileSync('python3', ['-c', py, path.join(root, 'extension'), out], { stdio: 'inherit' });
console.log('wrote', out, fs.statSync(out).size, 'bytes');
