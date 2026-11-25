/* Provider adapter: Google Gemini (gemini.google.com). Data only; selectors are in instructions/gemini.json.
 * The relay always starts a New chat there (flow "newChat"), uses the "Upload & tools" menu's "Upload files" item through the page-world hook (never the OS
 * file chooser), and never touches the model picker, Upgrade or Get app (instructions guard.neverClick). */
(function (root) {
  'use strict';
  var R = (typeof module === 'object' && module.exports) ? require('./registry.js') : root.DWX.providers;
  var p = R.register({
    id: 'gemini',
    label: 'Gemini',
    hosts: ['gemini.google.com'],
    tabMatches: ['https://gemini.google.com/*'],
    newChatUrl: 'https://gemini.google.com/app',
    instructions: 'instructions/gemini.json',
    signInUrl: 'https://gemini.google.com/app',
    messages: {
      not_logged_in: 'Gemini is not signed in (uploads need a Google account). Sign in at gemini.google.com in Chrome, then try again.',
      usage_limit: 'Gemini says a usage or upload limit was reached. Try again after it resets, untick "Include page files", or switch the AI to ChatGPT.',
      attach_not_confirmed: 'Gemini did not accept the screenshot or page files. Untick "Include page files" and try again, or press Send page snapshot / Copy diagnostics so it can be fixed.'
    }
  });
  if (typeof module === 'object' && module.exports) module.exports = p;
})(typeof self !== 'undefined' ? self : globalThis);
