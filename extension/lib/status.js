/* Sanitize the extension-status payload posted to a DW page.
 * Only these fields leave the extension: extVersion, paired, ai (allowlisted id or null),
 * revision, and editor. No tab titles, hosts, prompts, replies or screenshots. */
(function (root) {
  'use strict';
  var AI_ALLOWLIST = { chatgpt: true, gemini: true, grok: true, claude: true };
  var VER = /^[0-9A-Za-z._-]{1,32}$/;
  function pageStatus(input) {
    var src = input && typeof input === 'object' ? input : {};
    var extVersion = typeof src.extVersion === 'string' && VER.test(src.extVersion) ? src.extVersion : '';
    var editor = src.editor === true;
    var paired = editor && src.paired === true;
    var ai = null;
    if (paired && typeof src.ai === 'string' && AI_ALLOWLIST[src.ai]) ai = src.ai;
    var revision = null;
    if (typeof src.revision === 'number' && isFinite(src.revision) && src.revision >= 0 && src.revision === Math.floor(src.revision) && src.revision <= 1e9) {
      revision = src.revision;
    }
    var out = { extVersion: extVersion, paired: paired, ai: ai, revision: revision, editor: editor };
    // v0.1.6: the editor's chosen AI (allowlisted id), only when the extension is on for a confirmed editor.
    if (editor && typeof src.provider === 'string' && AI_ALLOWLIST[src.provider]) out.provider = src.provider;
    // v0.1.13: every open AI tab is paired with another editor tab (this one gets a new AI tab on Send).
    if (editor && !paired && src.allTaken === true) out.allTaken = true;
    return out;
  }
  root.DWX = root.DWX || {};
  root.DWX.AI_ALLOWLIST = AI_ALLOWLIST;
  root.DWX.pageStatus = pageStatus;
})(typeof self !== 'undefined' ? self : globalThis);
