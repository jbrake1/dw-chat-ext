#!/usr/bin/env node
/* Open the mock DW editor in a Chromium with NO extension loaded, and print the
 * extension-status line as JSON. Used by the ext-status scenario so the
 * missing-extension case does not share a Playwright process with the loaded
 * test-build (a second chromium.launch in that process can hang). */
const { chromium } = require('playwright');

(async () => {
  const url = process.argv[2];
  if (!url) { console.error('usage: bare-status.js <url>'); process.exit(2); }
  const extra = (process.env.DWX_CHROME_ARGS || '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const bare = await chromium.launch({ headless: true, timeout: 15000, args: ['--disable-dev-shm-usage', '--no-sandbox', ...extra] });
  try {
    const ctxOpts = {};
    const cookieFile = process.env.DWX_COOKIE_FILE;
    const ctx = await bare.newContext(ctxOpts);
    if (cookieFile) {
      const fs = require('fs');
      const j = JSON.parse(fs.readFileSync(cookieFile, 'utf8'));
      const u = new URL(url);
      const cookies = [];
      if (j.cookie) {
        // Same cookie setup as harness/e2e-staging.js. __Host- cookies are set on the https
        // localhost origin; Chromium still sends them to http://*.localhost (trustworthy).
        cookies.push({ name: '__Host-dw_s', value: j.cookie, url: 'https://' + u.hostname + '/', secure: true, httpOnly: true, sameSite: 'Lax' });
        cookies.push({ name: 'dw_ed', value: '1', url: u.origin + '/', sameSite: 'Lax' });
      }
      if (cookies.length) await ctx.addCookies(cookies);
    }
    const page = await ctx.newPage();
    await page.goto(url, { timeout: 15000, waitUntil: 'domcontentloaded' });
    await page.locator('#dw-markup-root').waitFor({ state: 'attached', timeout: 10000 });
    const t0 = Date.now();
    let s = null;
    while (Date.now() - t0 < 4000) {
      s = await page.evaluate(() => {
        const h = document.getElementById('dw-markup-root');
        const b = h && h.shadowRoot && h.shadowRoot.querySelector('[data-role=ext-status]');
        if (!b) return null;
        const a = b.querySelector('a');
        return { state: b.getAttribute('data-state'), text: b.querySelector('[data-role=ext-status-text]').textContent, href: a ? a.getAttribute('href') : null, on: b.classList.contains('on') };
      });
      if (s && s.state === 'missing') break;
      await new Promise((r) => setTimeout(r, 60));
    }
    process.stdout.write(JSON.stringify(s));
  } finally {
    await bare.close();
  }
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
