# Changelog

## v0.1.3 — 2026-11-23

- Suggest an edit now sends the page's source files with the screenshot by default. The editor (`/markup/markup.js`) downloads the page's own HTML as stored in /files (it removes the editor loader, affiliate tag and free-site credit that the server adds when it serves the page), its same-origin stylesheets and scripts, and up to 4 same-origin images (named in the note, under the drawing, or visible when Send was pressed). The editor's own scripts (`/markup/`, `/_dw/`, the affiliate tag) and third-party files are never sent; third-party files are listed as "not attached".
- Caps: 10 files, 2 MB per file, 6 MB in total, 10 seconds to collect. Anything skipped is listed in the prompt with the reason.
- `dw-ext-submit` gains `files: [{name, path, mime, size, dataUrl}]` and `skipped: [{path, reason}]`. The extension re-checks everything (`lib/pagefiles.js`): allowlisted extensions only (html, css, js, json, svg, png, jpg, gif, webp), MIME taken from the extension and never from the page, safe names and absolute paths without `..`, duplicate names renamed, the same caps enforced again in the service worker.
- The chat tab uploads the screenshot and every page file in one multi-file upload, in the same message. The prompt lists each file with its path and asks for the COMPLETE updated file in its own code block, with the same name and path.
- "Include page files (HTML, CSS, JS, images)" checkbox in the editor note box, ticked by default; the choice is remembered in the browser. Unticked sends the screenshot only, as in v0.1.2.
- Feed steps: "Collecting page files (n)" and "Uploaded screenshot + n files". `dw-ext-step` for `attach` carries `files` (the page-file count).
- Fix: the extension status line in the note box no longer picks up the text tool's red dashed style.

The packaged zip is `dw-chat-ext-v0.1.3.zip` (70,521 bytes), md5 `1925327f9abcf5c6102fedde1bb2d487`. Official download: [dwalliance.com/editor-ai](https://dwalliance.com/editor-ai/index.html). Versions 0.1.2, 0.1.1 and 0.1.0 remain available on that page.

## v0.1.2 — 2026-11-23

- Suggest an edit now draws a persistent in-editor transcript (`#dw-ext-feed`) after Send: the user's note plus a page-local screenshot thumbnail, status steps ("Screenshot sent" → "ChatGPT is reading…"), streaming assistant text with safe markdown, Pause / Stop, and auto-scroll. The editor hello is `{ panel: true, wantEvents: true }`, so the extension does not inject its own panel on DW editor pages.
- The fallback panel (used when a page has no native feed) uses the same compact dark transcript style, shows a screenshot thumbnail already in memory, and never displays a ChatGPT tab title.
- Production now issues a short-lived signed editor pass at `POST /_dw/ext/pass` for a signed-in editor on that site (same-origin and `X-DW-Ext` required). The official zip embeds the production pass public key so an unsigned or wrongly signed pass is refused. `allowDevOverride` stays false. Site-instruction updates still come from `https://dwalliance.com/editor-ai/patterns/{site}.json`.
- `/_dw/ext/report` and `/_dw/ext/files` stay disabled on production. The feed has no draft/publish/versions buttons; report calls fail silently.
- The content script now matches `dwalliance.com` and `www.dwalliance.com` (as well as `app.dwalliance.com` and the Ming Apothecary hosts), so the status line and feed work on the public marketing site without "Enable on this site."
- The compact extension status line from v0.1.1 is unchanged.

The packaged zip is `dw-chat-ext-v0.1.2.zip` (66,671 bytes), md5 `95f3c1e4c2adcef491e6b32e03444ac3`. Official download: [dwalliance.com/editor-ai](https://dwalliance.com/editor-ai/index.html). Versions 0.1.1 and 0.1.0 remain available on that page.


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
