#!/usr/bin/env node
/* Regenerates harness/snapshots/mock-{idle,typing,streaming,replied}[-v2].html from mock/chatgpt.html (no extension involved). */
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const { startMock } = require('../mock/server');
(async () => {
  const m = await startMock();
  const b = await chromium.launch({ channel: 'chromium', headless: true });
  const out = path.join(__dirname, 'snapshots');
  for (const v of ['', '-v2']) {
    const p = await b.newPage();
    await p.goto(m.gptUrl + '/?speed=80&tokens=30' + (v ? '&v=2' : ''));
    const snap = async (n) => fs.writeFileSync(path.join(out, `mock-${n}${v}.html`), await p.content());
    await snap('idle');
    await p.locator('[contenteditable=true]').click();
    await p.keyboard.type('hello');
    await p.setInputFiles('input[type=file]', path.join(__dirname, 'fixtures/sample-screenshot.jpg'));
    await p.waitForTimeout(700); await snap('typing');
    await p.locator('form button').first().click();
    await p.waitForTimeout(900); await snap('streaming');
    await p.waitForTimeout(3500); await snap('replied');
    await p.close();
  }
  await b.close(); await m.close();
  console.log('snapshots written to', out);
})();
