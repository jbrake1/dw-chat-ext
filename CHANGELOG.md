# Changelog

## v0.1.11 — 2026-11-24

- **Larger attachments (10 MB each, 30 MB in all).** Suggest an edit was refusing a screenshot over 2 MB ("up to 10 files, 2 MB each, 6 MB in all"). The cap is now 10 MB per file and 30 MB in total, in the editor, the staged-save path, and the extension. The help text matches. PHP `post_max_size` and nginx `client_max_body_size` on the production nodes are raised from 12M to 20M so a 10 MB file posted as JSON (base64 is about 14 MB) is accepted; `upload_max_filesize` stays 10M, which is the per-file cap.
- **Chat history survives a refresh.** The editor feed and the last reply’s code blocks are saved per page in this tab. After a reload the chat comes back, including Publish and Discard when a preview was staged (or can still be staged from the saved blocks). The extension keeps the last job result and, if the AI tab already finished, can re-read that reply.
- **Large images are resized for the AI only.** A big PNG (a typical macOS screenshot) is re-encoded as a JPEG under 2 MB, longest side 2048, before it is attached in the ChatGPT or Gemini tab. The original file is what is staged and published.

## v0.1.10 — 2026-11-24

- **Gemini replies keep their code.** v0.1.9 flattened a Gemini reply to plain text, so an HTML page showed in the chat window as raw source in paragraphs and nothing was staged. The reply is now read as markdown (`steps.blocks.markdownText` in `instructions/gemini.json` rev 3, needs extension 0.1.10): a code block becomes a fenced block (copy buttons and language chips left out), and if the model wrote HTML into ordinary paragraphs instead of a code block, that run is fenced too. A whole page (`<!DOCTYPE>`/`<html>…</html>`) also becomes a file block, so it is staged as a preview with Publish and Discard like a ChatGPT reply. A fragment is shown as code and never published; the editor says so and asks for the whole file.
- **Code is collapsed in the chat window.** A code block of three or more lines shows as one line ("HTML · 120 lines · click to show"); it stays open if you opened it while the reply keeps streaming.
- **Editor missing on some pages (home page).** Ten stored pages had a stray unterminated script before `</body>` that swallowed the editor loader, so the editor never mounted and only the extension panel showed. The pages are repaired on the site, and the extension now loads the editor itself (once, after 3 s) when a page names `/_dw/edit.js`, no editor mounted and nothing loaded it.

## v0.1.9 — 2026-11-24

- **Gemini upload fixed.** A live snapshot (id s2b34afff) showed there is no `input[type=file]` on the Gemini page until Gemini's own "Upload files" menu item runs, and the old "Open upload file menu" / `uploader` / `uploader-file-preview` names are gone (the menu button is now "Upload & tools"). v0.1.8 tried drop and paste, waited 30 s on each and failed with `attach_not_confirmed` after about 95 s. v0.1.9 opens "Upload & tools", arms a small page-world hook (`content/ai-hook.js`), and clicks Gemini's own "Upload files" item. When Gemini calls `input.click()` to open the OS file chooser, the hook gives the files to that input instead, so no dialog opens. The hook only acts while armed, once, for a few seconds, and talks to nothing. It is injected by the manifest on gemini.google.com and by the service worker into tabs that were already open.
- **Faster, truthful confirmation.** Each upload attempt has its own short wait (6 to 12 s, 8 s for drop) and a chip counts only if matching elements grew compared with before the attempt, so a "Remove" button or thumbnail already on the page is never taken for the upload. Total worst case is about 35 s, not 95 s.
- **Inline fallback.** If no strategy attaches the files, Gemini's instructions send the text files inside the message (no screenshot) and the chat window says so ("Gemini did not take the upload, so N files went in the message as text (no screenshot)") instead of failing the request. Images and binaries are left out; size is capped.
- Errors now carry a per-strategy trace (for example `hookedChooser:selector_not_found:4012`) in the relay log and Copy diagnostics.
- **Send page snapshot fixed.** v0.1.8 counted bytes twice per nesting level, so on Gemini it stopped in the sidebar and never reached the composer. Each byte is now counted once (cap 300 KB).
- `instructions/gemini.json` rev 2 (needs extension 0.1.9), schema: new strategy `hookedChooser`, per-strategy `confirmMs`, `attach.inlineFallback`.

## v0.1.8 — 2026-11-24

- **Send page snapshot** (popup, and the chat window on an error): captures a redacted structure of the paired AI tab (ChatGPT or Gemini) so a selector or layout problem can be diagnosed. It keeps tags, id, class, role, aria-*, data-* and testid, contenteditable/disabled, shadow and iframe structure, and button, label and placeholder text. Chat text and input values become length markers; scripts, styles and query strings are dropped. Each selector in that AI's instructions file is listed with a match count and pass/fail.
- The snapshot is uploaded to an editor-only endpoint (`POST /markup/?a=snapshot`) with the same checks as staged file saves (signed-in editor, same origin, CSRF). It is stored outside the webroot, size-capped, with the last 20 kept per site. `/_dw/ext/report` and `/_dw/ext/files` stay disabled.
- If no editor tab is available to upload through, the snapshot is downloaded instead. A short snapshot id is shown either way.

## v0.1.7 — 2026-11-24

- **Fixes the silent "nothing happened" after Send.** Chrome does not start a newly installed or updated extension in tabs that were already open, so an editor page opened before the install had no relay: Send saved the request, closed the form and flashed the toast, and nothing else happened. Now (1) the extension starts itself in already-open editor tabs when it is installed, updated or reloaded, and (2) if a page still has no relay, Send keeps the chat window open with a clear message ("Your edit request was saved, but the AI relay is not running on this page… reload this page, then press Send again") instead of closing, and the toast no longer promises a reply.
- **Relay log that survives a reload.** The editor keeps a short log of step names and codes in sessionStorage, the extension keeps a ring buffer in its own storage, and the page keeps one too. If a page is reloaded or closed mid-request, the next load shows "The last request did not finish… (last step: …)".
- **Copy diagnostics** in the extension popup and in the chat window (on errors and no-relay): last step reached, errors, handshake and inject timeouts, instruction status, tab state and the last events. It holds no notes, replies, screenshots, file names or page addresses.
- A send that fails before the AI is reached (not paired, no editor pass, extension reloaded) no longer leaves the panel title on "Sending to …".
- New messages for a reloaded or updated extension ("Reload this page to reconnect it"), the relay switched off, and a send without a fresh click.
- Test harness: version and title checks no longer hard-code old values; new `diagnostics` scenario.

## v0.1.6.1 — 2026-11-24

- Provider-named labels now follow the selected AI. With Gemini selected, the relay title is "Sending to Gemini…", steps say "Opening Gemini" and "Gemini is reading…", and errors say "Gemini". The same applies to ChatGPT.
- The editor reads the AI picker (or the provider on `dw-ext-submit`) when it paints those labels and when it sends the job, so a stale saved pref can no longer leave the title on ChatGPT while Gemini is selected.
- The editor-ai install page Step 3 now says "ChatGPT or Gemini writes the answer".
- After Send, the feed no longer hangs on "Collecting page files": the extension reports "Opening Gemini" (or ChatGPT) right away, and if nothing starts within 25 seconds the editor shows a clear error instead of spinning.
- Stop works at every stage, including before the AI tab is reached: it aborts pending work and shows "Stopped. Nothing changed."
- Timeouts on opening or injecting the AI tab, and on the editor pass request, so a stuck handshake is reported instead of hanging.


## v0.1.6 — 2026-11-24

- **Gemini** as a second AI. A picker (ChatGPT / Gemini) in the editor note box and in the extension popup; the choice is remembered. A gemini.google.com tab can be paired from the popup like a ChatGPT tab.
- On Send, the job goes to the paired tab of the chosen AI, else to an open tab of it (same window first), else a new background tab at the AI's new-chat page, which then becomes the paired tab. After an explicit Unpair nothing is opened until you pair or pick an AI again.
- Gemini always starts from a **New chat**; files go in through the "+" upload menu's file input (fallbacks: drop, paste), never the OS file chooser. A guard in the instructions stops the relay from clicking anything that looks like the model picker, Upgrade, Get app, share, delete, rename or settings.
- Gemini code blocks are read with their `File: /path` labels (the language chip and copy icon are left out), so returned files are staged as previews with Publish / Discard as for ChatGPT.
- Gemini's sign-in wall and usage / upload limit notices are reported plainly ("Gemini is not signed in…", "Gemini's file limit was reached…").
- Provider adapters in `lib/providers/` (data only; selectors stay in `instructions/<id>.json`), new bundled `instructions/gemini.json` (revision 1, **unverified** against the live site), schema additions (`newChat` flow step, `menuFileInput` attach strategy, `blocks` hints, `guard.neverClick`, `loggedOut.strict`). `dw-ext-submit` accepts `provider: 'chatgpt' | 'gemini'`; `dw-ext-provider` sets the choice; the extension status reports `provider`.

## v0.1.5 — 2026-11-24

- **Attach files** in Suggest an edit: add your own files (images, HTML, CSS, JS, JSON, SVG, PDF, text) with the picker or by dragging them onto the page, each with an optional "put it at" path such as `/images/new-logo.png`. Same limits as page files, counted together (10 files, 2 MB each, 6 MB in all). A file with no path is only shown to the AI.
- The extension re-checks every attached file (same allowlist, now with pdf and txt) and uploads it to ChatGPT in the same message as the screenshot and page files; the prompt says where each file should go and asks for `File: /path` in the reply.
- When the reply names one of your files by its path, the editor stages it from your original bytes (a picture never has to come back as text); files the AI changes come back as code as before. Everything is a preview first, with Publish and Discard.
- ChatGPT's free-tier file limit ("You're out of data analysis for now…") is now recognised instead of ending as `no_reply`: the editor says "ChatGPT's file limit was reached. Try again after <time>, or send without page files." and offers **Send without page files** (note and screenshot only). The extension only reads the notice; it never clicks an upgrade button.

The packaged zip is `dw-chat-ext-v0.1.5.zip` (74,185 bytes), md5 `39951cf771de283d7b28c2f80c55535d`. Official download: [dwalliance.com/editor-ai](https://dwalliance.com/editor-ai/index.html).

## v0.1.4 — 2026-11-24

- When the AI's reply contains complete updated files that match the page files sent with the request, Suggest an edit now uploads each one to /files as a **staged preview**. Visitors still see the live site. The editor gets a card with **Publish**, **Discard** and **Show preview (reload)**, plus a countdown: previews expire in 10 minutes. Publish asks for confirmation, then makes the preview live (the previous version is kept in /files history). Discard drops the preview and leaves the live site unchanged.
- The extension reads each code block in the reply, with the "File: /path" text just above it, and sends those blocks back to the editor (`dw-ext-done` now includes `blocks: [{label, lang, code}]`, capped at 12 blocks, 2 MB each, 6 MB in total). With an older extension, the editor still takes the page HTML from the reply text.
- The editor also strips any form of the on-page editor loader from the HTML it sends, so the AI edits the file as stored in /files (the v0.1.3.1 loader-strip fix).
- `/_dw/ext/report` and `/_dw/ext/files` stay disabled on production. Staged saves go through the editor's own server (`POST /markup/?a=files`), not through those endpoints.

The packaged zip is `dw-chat-ext-v0.1.4.zip` (71,476 bytes), md5 `8389c6234a45ceef4f2e7567aec37d08`. Official download: [dwalliance.com/editor-ai](https://dwalliance.com/editor-ai/index.html). Versions 0.1.3, 0.1.2, 0.1.1 and 0.1.0 remain available on that page.

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
