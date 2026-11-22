#!/usr/bin/env node
/* Rewrites manifest host_permissions / content-script matches and config.dwHosts from hosts.json. */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const hosts = JSON.parse(fs.readFileSync(path.join(root, 'hosts.json'), 'utf8'));
const mp = path.join(root, 'extension/manifest.json'), cp = path.join(root, 'extension/config.json');
const m = JSON.parse(fs.readFileSync(mp, 'utf8')), c = JSON.parse(fs.readFileSync(cp, 'utf8'));
const pat = (h) => 'https://' + h + '/*';
for (const h of [...hosts.dw, ...hosts.ai]) if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) throw new Error('bad host ' + h);
m.host_permissions = [...hosts.ai, ...hosts.dw].map(pat);
m.content_scripts[0].matches = hosts.dw.map(pat);
m.content_scripts[1].matches = hosts.ai.map(pat);
c.dwHosts = hosts.dw;
fs.writeFileSync(mp, JSON.stringify(m, null, 2) + '\n'); fs.writeFileSync(cp, JSON.stringify(c, null, 2) + '\n');
console.log('manifest + config updated:', JSON.stringify(hosts));
