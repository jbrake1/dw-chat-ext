# Changelog

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
