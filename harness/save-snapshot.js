#!/usr/bin/env node
/* Saves a REDACTED snapshot of a page for the selector-only health check.
 *   node harness/save-snapshot.js --url https://chatgpt.com/ --out harness/snapshots/chatgpt-idle.html [--profile DIR] [--wait 25]
 * Opens a visible browser with the persistent test profile (see `npm run login`), waits N seconds (use them to put the page in
 * the state you want: e.g. type text, attach a file, or let a reply finish) and then saves the DOM with text, values and
 * query strings removed and scripts stripped. It never sends anything. Use the TEST account only. */
const fs = require('fs'), path = require('path'), os = require('os');
const { chromium } = require('playwright');
const a = process.argv.slice(2); const get = (n, d) => { const i = a.indexOf('--' + n); return i < 0 ? d : a[i + 1]; };
(async () => {
  const profile = get('profile', path.join(os.homedir(), '.dw-chat-ext-test-profile'));
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: false, viewport: { width: 1280, height: 900 } });
  const p = ctx.pages()[0] || await ctx.newPage();
  await p.goto(get('url', 'https://chatgpt.com/'));
  console.error(`Put the page in the state to capture; saving in ${get('wait', '25')} s ...`);
  await p.waitForTimeout(Number(get('wait', '25')) * 1000);
  const html = await p.evaluate(() => {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('script,style,link,noscript,svg path').forEach((n) => n.remove());
    const w = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT); const texts = []; while (w.nextNode()) texts.push(w.currentNode);
    // keep the text of buttons/labels (selectors may use textMatches) but blank everything else
    texts.forEach((t) => { const keep = t.parentElement && t.parentElement.closest('button,label,a,[role=button],[role=alert]'); if (!keep) t.nodeValue = t.nodeValue.replace(/\S/g, 'x'); });
    clone.querySelectorAll('[value]').forEach((n) => n.setAttribute('value', ''));
    clone.querySelectorAll('[href],[src]').forEach((n) => ['href', 'src'].forEach((k) => { const v = n.getAttribute(k); if (v && /^https?:/.test(v)) n.setAttribute(k, v.split('?')[0]); }));
    return '<!doctype html>' + clone.outerHTML;
  });
  fs.mkdirSync(path.dirname(get('out')), { recursive: true });
  fs.writeFileSync(get('out'), html);
  console.error('saved', get('out'), html.length, 'bytes (review before committing: this is a snapshot of a signed-in page)');
  await ctx.close();
})();
