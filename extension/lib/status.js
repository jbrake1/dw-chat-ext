/* Sanitize the extension-status payload posted to a DW page.
 * Only these fields leave the extension: extVersion, paired, ai (allowlisted id or null),
 * revision, and editor. No tab titles, hosts, prompts, replies or screenshots. */
(function (root) {
  'use strict';
  var AI_ALLOWLIST = { chatgpt: true };
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
    return { extVersion: extVersion, paired: paired, ai: ai, revision: revision, editor: editor };
  }
  root.DWX = root.DWX || {};
  root.DWX.AI_ALLOWLIST = AI_ALLOWLIST;
  root.DWX.pageStatus = pageStatus;
})(typeof self !== 'undefined' ? self : globalThis);
