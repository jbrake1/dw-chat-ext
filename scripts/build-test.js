#!/usr/bin/env node
/* Builds .build/test-ext: the production extension plus ONLY the changes tests need:
 *  - http://localhost and http://127.0.0.1 host permissions + content-script matches (mock DW = localhost, mock/live chat = 127.0.0.1)
 *  - config.allowDevOverride=true (lets the harness point the service worker at the mock server), dwHosts += localhost,
 *    aiSites += 127.0.0.1
 *  - bundled chatgpt.json: match.hosts += 127.0.0.1, stream.startTimeoutMs=8000 (so a broken selector fails in 8 s, not 90 s)
 * The shipped zip never contains these. Prints a diff summary so you can see exactly what differs. */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const src = path.join(root, 'extension'), out = path.join(root, '.build', 'test-ext');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
const rj = (p) => JSON.parse(fs.readFileSync(path.join(out, p), 'utf8'));
const wj = (p, o) => fs.writeFileSync(path.join(out, p), JSON.stringify(o, null, 2) + '\n');
const m = rj('manifest.json');
m.host_permissions.push('http://localhost/*', 'http://127.0.0.1/*');
m.content_scripts[0].matches.push('http://localhost/*');
m.content_scripts[1].matches.push('http://127.0.0.1/*');
m.name += ' (TEST BUILD)';
wj('manifest.json', m);
const c = rj('config.json');
c.allowDevOverride = true; c.dwHosts.push('localhost'); c.aiSites['127.0.0.1'] = 'chatgpt';
wj('config.json', c);
const i = rj('instructions/chatgpt.json');
i.match.hosts.push('127.0.0.1'); if (!process.env.DW_LIVE) i.stream.startTimeoutMs = 8000; // live runs keep the production timeout (a real site can take longer than 8 s to start)
wj('instructions/chatgpt.json', i);
console.log('test build at', out);
