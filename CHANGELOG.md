# Changelog

## v0.1.1 — 2026-11-23

- Suggest an edit shows a compact extension status line: not installed (with a link to the install page), installed but the site is not enabled or the editor is unconfirmed, installed but not paired, or paired with ChatGPT. The line updates live when you pair or unpair.
- New `dw-ext-status` page message (origin-checked). The page only receives the extension version, a paired flag, an allowlisted AI id (currently `chatgpt`), the instructions revision, and whether the site confirmed an editor pass. Tab titles and chat content are not sent.
- Site-instruction (pattern) updates are fetched from the static file `https://dwalliance.com/editor-ai/patterns/<ai>.json` (first: `chatgpt.json`), not from `/_dw/ext/sites/`. Seal verification, ETag / If-None-Match, and the bundled fallback are unchanged. The URL is configurable for staging (`instructionsUrl`).
- Includes the existing reply-panel docking fix from the v0.1.0 source tree (panel sits above the editor note box, or above the Suggest an edit button when the editor is closed). Production pass-key handling is unchanged (`passPublicKeyJwk` remains unset on the shipped tree; the staging build still injects the staging public key).

The packaged zip is `dw-chat-ext-v0.1.1.zip` (64,294 bytes), md5 `fb668aad7cf18bf880c62d956a7928a7`. Official download: [dwalliance.com/editor-ai](https://dwalliance.com/editor-ai/index.html). Version 0.1.0 remains available on that page.

## v0.1.0 — 2026-11-22

First public release of the DW Chat Integration Chrome extension (Manifest V3).

The packaged zip is `dw-chat-ext-v0.1.0.zip` (62,838 bytes), md5 `321bfae3f98070bdbdffb8eeb9f5750a`. Official download: [dwalliance.com/editor-ai](https://dwalliance.com/editor-ai/index.html).

### What it does

- Relays a signed-in editor's **Suggest an edit** screenshot and note to a ChatGPT tab they paired earlier.
- Streams the reply into a scroll panel above the editor's note box.
- Gives the editor **Stop**, **Pause / Resume**, and **Unpair** so they stay in control. Nothing is sent until they press Send.
- Stays off until the DW site issues a short-lived editor pass for that person on that site.
- Fetches a remote site-instructions JSON (ChatGPT page selectors) so a UI change can be fixed without an extension release. A bundled copy is the fallback.
- Sends anonymous, six-field error reports when a step fails (opt-out in the popup).

### Verified in this release

- End-to-end relay, controls, pass checks, remote-update flow and reports against mock DW and mock ChatGPT pages (unit tests and Playwright scenarios).
- ChatGPT page selectors (revision 2, 2026-11-22) checked on the real signed-in chatgpt.com desktop layout. Text entry, attach, send, stream, done-detection, stop, and a code reply were exercised on the live site.

### Known gaps

- Files and images that ChatGPT puts in a reply are not extracted yet (ChatGPT now uses widgets and `blob:` URLs).
- A live attach can fail if the ChatGPT account has hit its upload limit.
- Error-banner selectors, narrow/non-English layouts, and the ChatGPT tab running in the background were not fully exercised.

ChatGPT is the first chat site and Chrome is the first browser.
