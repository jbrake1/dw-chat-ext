# DW Chat Integration (Chrome extension)

A Manifest V3 Chrome extension for [DW Alliance](https://dwalliance.com) site editors. When you use **Suggest an edit** on a logged-in customer site and press **Send**, the extension also sends the screenshot and your note to a **ChatGPT tab you paired earlier**, watches the streamed answer, and shows it in a scroll panel above the editor's note box. You keep control with **Stop**, **Pause / Resume** and **Unpair**. Nothing is sent unless you press Send.

ChatGPT is the first chat site and Chrome is the first browser. Adding another chat site later is a new JSON instructions file plus one config line, not a rewrite of the extension.

**Download:** [dwalliance.com/editor-ai](https://dwalliance.com/editor-ai/index.html) (packaged zip). This repository is the source, the test harness, and the tagged releases.

> **Status.** The relay, controls, remote-update flow, pass checks and test harness are verified end to end against a **mock** ChatGPT page and mock DW site. The **live chatgpt.com selectors in `chatgpt.json` were verified on 2026-11-22 (revision 2) against the real signed-in site** (see [What is and is not verified](#what-is-and-is-not-verified)); file and image extraction from replies is the known gap.

## How it works

```
 DW site tab (signed-in editor)                                ChatGPT tab (paired)
 ┌─────────────────────────────┐                               ┌──────────────────────────┐
 │ markup tool  ──submit──┐    │                               │ content/chatgpt.js        │
 │ content/dw.js ◄────────┘    │   service worker (sw.js)      │  = generic interpreter    │
 │  1 gate: editor cookie /    │   - pairing (1 chat tab)      │  runs the site            │
 │    #suggest-edit / editor   │   - verifies the editor pass  │  instructions JSON:       │
 │  2 /_dw/whoami              │   - loads + validates the     │  text → attach → send →   │
 │  3 POST /_dw/ext/pass       │     site instructions         │  MutationObserver stream  │
 │  4 panel (shadow DOM)       │   - routes jobs/events/control│  → done detection → files │
 └──────────── messages ───────┴───────────────────────────────┴──────── messages ─────────┘
```

1. **Pairing.** Open chatgpt.com in a tab, click the extension icon there, **Pair this tab**. The icon shows an `AI` badge on that tab. Closing the tab, or navigating it off the chat site, unpairs. One paired tab at a time.
2. **Off by default.** `content/dw.js` does nothing, makes no network request and shows no panel on a DW page unless the page looks like an editor session (the `dw_ed`/`dw_mk` hint cookie, `#suggest-edit` in the URL, or the editor's `#dw-markup-root` appears). It then asks the site (same origin, cookies included) `GET /_dw/whoami` and `POST /_dw/ext/pass`. Only a valid **pass** (for that host, for that person, a few minutes) turns the extension on: green icon, panel, relay. A fresh pass is fetched for every submit. Without a valid pass the service worker refuses to touch the ChatGPT tab (tested: denied, expired, wrong-site and unsigned passes).
3. **Submit.** Send in the editor → the editor's own `POST /markup/` still happens exactly as today → the extension picks up the same screenshot and note (via the optional `dw-ext-submit` page message, or its fetch tap if the editor has no hook yet) → builds the prompt from `config.json` `promptTemplate` → the service worker hands it to the ChatGPT tab.
4. **ChatGPT side.** The content script **interprets the site instructions**: finds the prompt box (ordered fallback selectors), puts the text in, attaches the screenshot, clicks Send (or presses Enter if configured), then a `MutationObserver` watches the reply. The reply is relayed as growing snapshots (`text` + files/links) while it streams. **Done** = rule from the JSON, by default *new assistant message AND stop button gone AND text unchanged for 1500 ms*.
5. **Controls.** *Stop* clicks ChatGPT's own stop button (the partial reply is kept; before anything was sent it just cancels). *Pause* holds the relay: the chat keeps streaming but nothing new is shown, and a new Send is queued, not sent, until *Resume*. *Unpair* forgets the tab. The editor page can send the same three controls with `dw-ext-control`.

The official page for editors, including the packaged download, is [https://dwalliance.com/editor-ai/index.html](https://dwalliance.com/editor-ai/index.html).

## Privacy

- The extension sends your screenshot, note and page URL only to the **ChatGPT tab you paired**, and only when you press Send in the editor. That is the point of the feature: the chat service sees the page URL and the note.
- **Anonymous error reports** are optional (opt-out in the popup). On a failed step the service worker POSTs exactly six fields — `{site, step, extVersion, instructionsVersion, errorCode, ts}` — to the configured DW report URL, with no cookies. Each field is regex-validated, so a prompt, reply, screenshot, URL or account detail cannot get in (unit-tested). One report per site+step+code+version per hour.
- Nothing else is sent anywhere. The extension does not send your DW session, the editor pass, or chat contents to any third party other than the paired tab. The pass stays inside the extension's service worker.
- The extension is active only while you are signed in as an editor on that site and hold a short-lived pass.

See [API.md](API.md) for the three site endpoints and the optional page-message protocol.

## Permissions

- `host_permissions`: `https://chatgpt.com/*`, `https://app.dwalliance.com/*`, `https://mingapothecary.com/*`, `https://www.mingapothecary.com/*`. **No `<all_urls>`**, no `tabs`, no `webRequest`.
- `permissions`: `storage`, `alarms`, `scripting` (to inject the chat script into an already-open tab and the fetch tap into the editor page), `activeTab` (pairing from the popup).
- `optional_host_permissions: ["https://*/*"]` is **only a request mechanism, nothing is granted by it**: on a DW customer site that is not on the list, the popup shows **Enable on this site**; you click, Chrome asks, and only that one origin is granted and its content script registered. (Chrome requires a broad pattern here to allow arbitrary customer domains later.)
- Adding a domain permanently: edit `hosts.json`, run `npm run sync-hosts` (rewrites the manifest matches and `config.json` `dwHosts`), bump the version, package. A unit test checks `hosts.json` and the manifest agree.

## Install

A standalone copy of these steps is in [INSTALL.md](INSTALL.md). Chrome is the supported browser (version 120 or later). The extension is not in the Chrome Web Store yet, so you load the zip yourself.

**Download:** [dw-chat-ext-v0.1.1.zip](https://dwalliance.com/editor-ai/dw-chat-ext-v0.1.1.zip) from the [AI/SI Editor](https://dwalliance.com/editor-ai/index.html) page, or from the [v0.1.1 GitHub release](https://github.com/jbrake1/dw-chat-ext/releases/tag/v0.1.1). Optional check: the zip’s md5 is `fb668aad7cf18bf880c62d956a7928a7`. Version 0.1.0 remains available on the install page.

### Load it in Chrome

1. **Download the zip** and unzip it into its own folder. Put that folder somewhere you will keep, such as Documents — not a temporary place you empty later. Chrome reads the extension from this folder, so do not move or delete it after you install.
2. **Open the unzipped folder.** You should see a file named `manifest.json` right there, next to folders such as `background`, `content`, `icons`, and `popup`. If you only see a single folder, open that folder and look again. (If you cloned this repository instead, the folder to load is `extension/`.)
3. In Chrome’s address bar, go to `chrome://extensions`.
4. Turn on **Developer mode**. The switch is usually in the top right.
5. Click **Load unpacked** and choose the folder that contains `manifest.json`.
6. Pin it for easy access: click the puzzle-piece **Extensions** icon on the Chrome toolbar, find **DW Chat Integration**, and click the pin.

You may see a Chrome warning that this extension is in developer mode. That is normal for an extension you load this way.

### Pair ChatGPT, then use it on your site

1. Open [chatgpt.com](https://chatgpt.com) in a tab and sign in.
2. While that ChatGPT tab is in front, click the **DW Chat Integration** icon and click **Pair this tab**. The popup should say **Paired with:** followed by the tab title, and an **AI** badge appears on the icon for that tab. If **Pair this tab** is unavailable, the popup hint is: “To pair: open chatgpt.com in a tab, sign in, then click this icon there.”
3. Open your DW Alliance site and sign in as an editor.
4. Open **Suggest an edit** on the page (or add `#suggest-edit` to the end of the page address).
5. If the popup says “This site is not on the built-in list. Allow DW Chat Integration to run on it?”, click **Enable on** that site’s name and approve Chrome’s permission prompt.

When the extension is active, the toolbar icon turns green and a **ChatGPT relay** panel appears above the editor’s typing area. Circle or point at what you want to change, type your note, and press **Send**. Your screenshot and note go to the paired ChatGPT tab, and the reply streams into the panel. Nothing is sent until you press Send.

In the panel you can use **Stop**, **Pause**, **Resume**, and **Unpair**. There is also a checkbox: **Also send my request to ChatGPT when I press Send**.

Closing the ChatGPT tab, or navigating that tab away from chatgpt.com, unpairs it. You can pair again from the ChatGPT tab at any time. Only one chat tab can be paired at once. Until the site confirms you are a signed-in editor, the icon stays grey and the extension will not touch ChatGPT.

### Update to a new version

1. Download the new zip.
2. Unzip it and replace the files in the **same folder** you loaded before. Leave that folder where it is.
3. Open `chrome://extensions` and click the reload icon on the **DW Chat Integration** card.

You do not need to click **Load unpacked** again unless you moved the folder.

### Remove it

1. Open `chrome://extensions`.
2. On the **DW Chat Integration** card, click **Remove** and confirm.
3. You can then delete the unzipped folder if you no longer need it.

### If something goes wrong

- **“Manifest file is missing” or “Manifest file is missing or unreadable.”** You picked the wrong folder. Choose the folder that itself contains `manifest.json`. If unzipping created an extra nested folder, go one level in.
- **Chrome warns about Developer mode or unpacked extensions.** That is expected until the extension is in the Chrome Web Store.
- **The icon stays grey on your site.** Sign in as an editor, open **Suggest an edit**, and if the popup asks, click **Enable on** that site. If Suggest an edit is not enabled on that site yet, the extension will not switch on.
- **The popup says “No chat tab paired,” or the panel says “ChatGPT relay: no tab paired.”** Open chatgpt.com, sign in, click the **DW Chat Integration** icon **on that tab**, and click **Pair this tab**.
- **ChatGPT is not responding, or you see “ChatGPT tab is not signed in” or “could not reach the ChatGPT tab.”** Refresh the ChatGPT tab, sign in again, and re-pair. Closing the tab or leaving chatgpt.com unpairs it automatically.
- **“Not sent: the site did not confirm you are an editor.”** Sign in again as an editor. If the editor is not enabled on that site yet, ask DW to turn it on.
- **The extension stopped working after you moved or deleted the folder.** Put the folder back (or unzip the zip again), then use **Load unpacked** and choose it once more.

Chrome is the supported browser. Nothing in the extension is written to block other Chromium browsers. In Microsoft Edge or Brave you can try the same steps from `edge://extensions` or `brave://extensions` (Developer mode, then **Load unpacked**). If anything looks different, use Chrome.

### Local demo with the mocks (no live site needed)

```
npm ci
npm run mock          # prints two local URLs
npm run build:test    # writes .build/test-ext (localhost allowed; not the shipped zip)
```

Load `.build/test-ext` unpacked. Open the ChatGPT mock, pair it, visit the mock DW `/__login` once, then open the mock editor and use *Suggest an edit*.

Since Chrome 137, branded Google Chrome ignores `--load-extension` on the command line; use **Load unpacked** in the UI, or Chromium / Chrome for Testing.

## The thin shell: site instructions

All knowledge of a chat site's page lives in a versioned JSON file (`extension/instructions/chatgpt.json`, schema `extension/schema/site-instructions.schema.json`): selectors for the prompt box, file input, send, stop, reply container and its text, file/link extraction, error banners, the done rule and timings. Every step takes an **ordered list** of selectors (index 0 primary, later entries fallbacks). `test/static.test.js` fails the build if a ChatGPT selector appears anywhere in the extension JavaScript.

Update path (no extension release):

- The service worker fetches the instructions file from the configured `dwBase` at install/startup and about every 24 hours (an alarm), and from the popup's **Check for update**.
- The file must pass: size ≤ 64 KB, JSON schema, `site` matches, `minExtVersion` ≤ this version, `revision` not lower than what it already holds, every regex/selector compiles, and **sha256** / optional **Ed25519** integrity when those fields are present. Failing files are ignored and a count-only report is sent. The extension keeps the last good copy and a **bundled copy**, and picks the highest usable revision (bundled wins ties and after an extension upgrade).
- If a step fails **before anything was sent** while running remote instructions, the job is retried once with the bundled copy.
- The file is declarative data; nothing from it is ever executed.

When ChatGPT changes its UI: the daily test or the error reports show it → fix the JSON → `npm run seal` → publish a higher `revision` → browsers pick it up within a day (or on next start). See [API.md](API.md).

## Repository layout

```
dw-chat-ext/
├── extension/                   <- what you load unpacked / what the zip contains
│   ├── manifest.json  config.json
│   ├── background/sw.js         service worker: pairing, pass check, instructions, routing, reports
│   ├── content/dw.js            DW page: gate, whoami/pass, panel, submit, controls
│   ├── content/panel.js         reply panel (shadow DOM, docks above the editor's note box)
│   ├── content/dw-tap.js        page-world fetch tap (fallback when the editor has no hook)
│   ├── content/chatgpt.js       chat tab glue (generic)
│   ├── lib/interpreter.js       generic instruction interpreter
│   ├── lib/runner.js            job flow, MutationObserver stream watcher, pause/stop
│   ├── lib/done.js              done-detection state machine
│   ├── lib/{instructions,schema,pass,report,util}.js
│   ├── instructions/chatgpt.json   bundled default (revision 2, verified 2026-11-22)
│   ├── schema/site-instructions.schema.json
│   ├── popup/                   Pair this tab / Unpair / status / update check / enable site
│   └── icons/                   grey (off) and green (active)
├── mock/                        mock DW site + editor + mock ChatGPT (streaming) + server
├── harness/                     Playwright: run-daily.js, e2e.js, health-check.js, snapshots, login.js, save-snapshot.js
├── test/                        node:test unit tests
├── scripts/                     build-test, sync-hosts, seal-instructions, package
├── hosts.json  API.md  README.md  CHANGELOG.md  LICENSE
```

This repository is the **extension and its test harness only**. DW server code is not included.

## Tests

```
npm ci
npm test
```

| Command | What it does | Needs |
|---------|--------------|-------|
| `npm test` | Unit tests: interpreter, done detection, schema validator, instruction validation/integrity/signature/refresh, pass checks, report sanitising, runner against the streaming mock in jsdom, selector health check, static rules (no hardcoded selectors, no `<all_urls>`, manifest/hosts agree) | Node only |
| `npm run test:e2e` | Playwright scenarios in real Chromium with the unpacked **test build**: basic relay with streaming, paste fallback, pass failures, signed pass, native page hook, pause/queue/resume/stop/unpair, UI-change recovery by publishing new JSON, popup pairing, tab lifecycle | Playwright Chromium (`npx playwright install chromium`) |
| `npm run health` | **Selector-only check** of the instructions against saved HTML snapshots (no browser, no network) | Node only |
| `npm run daily` | One fixed sample request through the whole relay on the mock; prints per-step JSON | Chromium |
| `npm run daily:live` | The same against the **real chatgpt.com** with a persistent test profile (see below) | display or `xvfb-run`, a dedicated test account |

The test build (`scripts/build-test.js`) differs from `extension/` only by: `http://localhost` and `http://127.0.0.1` host permissions and content-script matches, `allowDevOverride` (lets the harness point the service worker at the mock server), those hosts in the host lists, and a shorter `startTimeoutMs` in the bundled JSON. The shipped zip never contains these (`test/static.test.js` asserts `allowDevOverride` is false in `extension/`).

### Daily live test (optional, nothing is scheduled for you)

1. **Once, by hand:** create a dedicated **test** ChatGPT account (a personal account works, but its uploads and rate limits are shared). Run `npm run login`, sign in yourself in the window that opens, close it. The profile is stored in `~/.dw-chat-ext-test-profile` with a `.dw-test-profile` marker. Login is never automated. Do not commit that profile.
2. **When you want a live check:** `xvfb-run -a node harness/run-daily.js --mode live --yes-send` (add `--instructions bundled` to ignore the published file, `--profile DIR`, `--chat-url URL`). It serves a mock DW editor on localhost, fetches the published instructions, pairs a temporary ChatGPT chat, sends a fixed request ("reply with the single word OK" and a sample screenshot), and asserts prompt → text → attach → send → stream → done → reply contains OK. Exit code 0 pass, 1 fail, 2 refused to run. `--yes-send` is required because it sends one real message; it refuses profiles without the marker.
3. Playwright's default launch is often shown a "Verify you are human" check on chatgpt.com. Live runs therefore start Chromium directly and attach over CDP (`launchDirect` in `harness/lib.js`).
4. To capture new selector snapshots: `node harness/save-snapshot.js --url https://chatgpt.com/ --out harness/snapshots/chatgpt-idle.html --wait 25`. The saver blanks text and strips scripts, but always review a snapshot of a signed-in page before committing it.

## What is and is not verified

**Verified** (automated, in this repo, against the mock ChatGPT and mock DW):

- Full relay with streaming: prompt, file attach (file input and paste fallback), send, live snapshots, done detection, text equal to the chat's, files/links extracted and rendered safely, the chat received exactly one prompt and the exact screenshot bytes.
- Stop, Pause/Resume (including a Send queued while paused), Unpair; closing the paired tab; navigating away turns the icon grey.
- Off by default: no extension requests for anonymous visitors; no pass for non-editors; denied/expired/wrong-site/unsigned passes leave the ChatGPT tab untouched; Ed25519-signed passes accepted.
- Remote update: a fixed JSON published on the server repairs a "redesigned" page with no extension change; tampered, invalid, too-new and downgraded files are rejected and reported; bad-but-valid remote files fall back to the bundled copy before anything is sent (and the message is sent once).
- Anonymous reports contain only the six fields.
- Panel docks above the editor's note box, and is excluded from the editor's screenshot.
- Selector-only health check detects the mock redesign and lists stale primaries.

**Not verified:**

- **Live ChatGPT, partly.** `chatgpt.json` revision 2 (`"verified": true`, 2026-11-22) was checked against the real signed-in chatgpt.com (desktop layout): composer, attach (file input and the "Remove" chip), send, stop, assistant message, reply text, code block, completion; the real extension ran text entry, attach, send, stream and done-detection on the live page (harness live run, reply was `OK`).
  - **Not covered:** (a) **file downloads and images in replies**: ChatGPT now shows files as `span[role=link]` widgets plus a *Download file* button (no `href`) and generated images as `blob:` URLs, which `readFiles` cannot extract (needs an interpreter feature: click the button / fetch the blob); (b) the `errors` selectors (rate limit, network error): not triggered; (c) the layout for a narrow window or other languages: labels such as `Send`/`Stop` are English; (d) the **ChatGPT tab in the background** while the DW tab is in front; (e) a Free plan can run out of **file uploads** after a burst of test uploads (silent failure; `attach_not_confirmed`), so a daily live test with an attachment may need a paid or dedicated test account.
- Behaviour with the ChatGPT tab **in the background**: Chrome throttles timers in hidden tabs (the 1.5 s stable-text wait may take up to about 1 s longer) and may discard or freeze tabs under memory pressure. MutationObservers still fire. Playwright's headless Chromium reports every tab as visible, so this was not exercised.
- Real DW sites: the extension stays off until the site answers a valid editor pass. The fetch tap was tested against a mock that copies the editor's FormData shape, not against every live editor build.
- Whether a page CSP on customer sites blocks the panel: the panel uses a constructable stylesheet and no inline script, but this was not tested against a CSP.
- File downloads: the panel lists files and can click a link in the ChatGPT tab; downloading `sandbox:` files into the DW page (fetching bytes) is not built.
- Other browsers (Edge, Brave, Firefox), other chat sites, and Chrome Web Store packaging/review (`optional_host_permissions: https://*/*` and `scripting` will draw questions).

## Security notes

- Narrow permissions, no remote code, selectors validated before use, regexes compiled in try/catch, link schemes filtered, text never inserted as HTML.
- Page messages are accepted only from the same window and origin, and a submit also requires a real (trusted) click or keypress in that page within the last 120 s, so a script cannot silently trigger a relay.
- A page script on a customer site could read the reply text that is posted to the page when the page asked for events (`wantEvents`). In the fallback (no hook) mode nothing but state is posted to the page; the reply lives only in the extension's shadow-DOM panel.
- The pass is only as strong as the server issuing it; sign it (see [API.md](API.md)).
- The prompt template sends the page URL and note to ChatGPT. That is the point of the feature, but you should know that customer page URLs and notes go to a third-party chat service.
- `self.__dw` in the service worker is a debug handle for the harness; it is not reachable from web pages.

## Adding another chat site later

1. New `extension/instructions/<site>.json` (copy and adapt), `config.json` `aiSites` (`"host": "site"`), `hosts.json` `ai`, `npm run sync-hosts`, a `GET /_dw/ext/sites/<site>.json` on the server, a mock page in `mock/` and a scenario. The interpreter, runner and service worker need no changes unless the site needs a new *kind* of step.

## Troubleshooting

For install, pairing and everyday use, see [If something goes wrong](#if-something-goes-wrong) or [INSTALL.md](INSTALL.md).

- Icon stays grey on the DW page: you are not signed in as an editor (`/_dw/whoami` says `edit: false`), the site has not issued an editor pass, or the site is not enabled (popup → **Enable on** this site).
- Panel says "ChatGPT relay: no tab paired": pair from the ChatGPT tab's popup (**Pair this tab**).
- "Relay problem at step …": the step name and error code are shown; the popup lists the instruction version in use and the last update check.

## License

[MIT](LICENSE) © 2026 DW Alliance LLC
