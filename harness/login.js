#!/usr/bin/env node
/* One-time interactive sign-in for the ChatGPT TEST account. Opens a visible Chromium with the persistent test profile
 * at chatgpt.com. YOU sign in by hand; close the window when done. Nothing is automated or recorded.
 * Use a dedicated test account, not a personal one. Needs a display (on a server: xvfb-run + VNC/desktop). */
const path = require('path'), os = require('os');
const { chromium } = require('playwright');
const fs = require('fs');
const profile = process.argv[2] || path.join(os.homedir(), '.dw-chat-ext-test-profile');
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, '.dw-test-profile'), 'created by harness/login.js; run-daily --mode live only runs against profiles with this marker\n');
(async () => {
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: false, viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://chatgpt.com/');
  console.log(`Sign in to the TEST account in the opened window (profile: ${profile}). Close the window when finished.`);
  await new Promise((r) => ctx.on('close', r));
  console.log('Profile saved.');
})();
