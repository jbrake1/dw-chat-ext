# Site API used by the extension

This is a public summary of the three HTTP endpoints the extension talks to on a DW Alliance site. The extension also uses the existing `GET /_dw/whoami` editor check. Server implementation is not in this repository.

Request and response bodies are JSON unless noted. Field names and types are what the extension expects.

## 1. Site instructions

`GET {dwBase}/_dw/ext/sites/{site}.json`

`{dwBase}` and the path template come from `extension/config.json` (`dwBase`, `instructionsPath`). `{site}` is a short id such as `chatgpt`.

- Public, no cookies, no authentication.
- `Content-Type: application/json`. Body at most 64 KB.
- A strong `ETag` is recommended. The extension sends `If-None-Match` and accepts `304`.
- Unknown `{site}` → `404`.
- The body must match `extension/schema/site-instructions.schema.json`. It is data only; the extension never executes it.
- Optional `integrity.hash` (SHA-256 of the canonical JSON without `integrity`) and `integrity.sig` (Ed25519). When a public key is configured in `config.json`, a missing or invalid signature is rejected.

## 2. Editor pass

`POST /_dw/ext/pass` on the brand host the editor is viewing (same origin as the page).

The extension sends this with cookies included, only after `GET /_dw/whoami` says the visitor may edit.

Request:

```
POST /_dw/ext/pass
X-DW-Ext: 1
Content-Type: application/json

{"extVersion":"0.1.0"}
```

The custom `X-DW-Ext` header is required (it forces a CORS preflight, which is how this stays same-origin). No CORS allowance should be sent. `Cache-Control: no-store`.

Success (`200`):

```json
{
  "ok": true,
  "pass": "<random token, at least 128 bits of entropy>",
  "site": "<request host, lower-case, no port>",
  "sub": "<opaque id, stable per person and site; not an email or name>",
  "role": "editor",
  "iat": 1795289000,
  "exp": 1795289300,
  "now": 1795289000,
  "sig": "<optional base64url Ed25519 signature>"
}
```

- Times are Unix seconds from the **server** clock. The extension uses `exp - now` so the browser clock does not matter. Expected TTL is 300 seconds; a lifetime over 900 seconds is rejected.
- `site` must match the page host (`www.` is ignored).
- `sig`, when present, is over the canonical JSON of `{exp, iat, pass, role, site, sub}` (keys sorted, no whitespace). When `config.json` has `passPublicKeyJwk`, an unsigned pass is refused.
- Anyone who is not an editor should get `403` with `{"ok":false,"error":"not_editor"}`.

The extension never sends the pass anywhere except its own service worker. A fresh pass is fetched for every submit.

## 3. Anonymous error reports

`POST {dwBase}/_dw/ext/report`

Sent by the service worker with `credentials: 'omit'` (no cookies).

```json
{
  "site": "chatgpt",
  "step": "send",
  "extVersion": "0.1.0",
  "instructionsVersion": "2",
  "errorCode": "send_not_found",
  "ts": 1795289000
}
```

- Exactly these six fields. Each is regex-validated in the extension (`extension/lib/report.js`) so a prompt, reply, screenshot, URL or account detail cannot be included.
- Suggested server rules: `site` `^[a-z0-9_-]{1,32}$`, `step` `^[a-z_]{1,32}$`, `extVersion` and `instructionsVersion` `^[0-9A-Za-z._-]{1,32}$`, `errorCode` `^[a-z0-9_]{1,40}$`, `ts` an integer. Reject anything else with `400`. Body at most 1 KB. Success → `204`.

The popup has an opt-out. One report per site+step+code+version per hour is sent from a given browser.

## Page protocol

When the site's Suggest an edit tool is present, it may talk to the extension with `window.postMessage` (`dw-ext-hello`, `dw-ext-submit`, `dw-ext-control`, and the extension's `dw-ext-ready` / `dw-ext-chunk` / `dw-ext-done` / `dw-ext-error` replies). Messages are accepted only from the same window and origin, and a submit also requires a recent real click or keypress. The reference implementation is `mock/dw-editor.html`. If the page has no hook, the extension falls back to observing `POST /markup/`.
