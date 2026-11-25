(async function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  // The popup targets the tab that was active when it opened. (A dev-only ?targetTab=ID lets the test harness open this page in a tab.)
  var targetTab = null;
  async function resolveTab() {
    var q = new URLSearchParams(location.search).get('targetTab');
    if (q) return Number(q);
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] ? tabs[0].id : null;
  }
  async function refresh() {
    var s = await chrome.runtime.sendMessage({ type: 'popup:state', tabId: targetTab });
    if (!s || !s.ok) return;
    $('ver').textContent = 'v' + s.extVersion;
    var t = s.tab;
    $('dot-this').className = 'dot' + (t && t.active ? ' on' : '');
    $('this-status').textContent = !t ? 'No page' : t.active ? 'Active on ' + t.host + ' (you are a signed-in editor)' : t.dw ? 'Off on ' + t.host + ' (sign in as an editor, then open #suggest-edit)' : 'Off on this page';
    $('dot-pair').className = 'dot' + (s.pair ? ' on' : '');
    $('pair-status').textContent = s.pair ? 'Paired with: ' + s.pair.title + (s.paused ? ' (paused)' : '') : 'No chat tab paired';
    $('pair').disabled = !(t && t.canPair) || (s.pair && t && s.pair.tabId === t.id);
    $('unpair').disabled = !s.pair;
    if (Array.isArray(s.providers) && s.providers.length) {
      var sel = $('provider');
      if (sel.options.length !== s.providers.length) { sel.textContent = ''; s.providers.forEach(function (p) { var o = document.createElement('option'); o.value = p.id; o.textContent = p.label; sel.appendChild(o); }); }
      sel.value = s.provider || 'chatgpt';
    }
    var pl = (s.providers || []).filter(function (p) { return p.id === s.provider; })[0];
    var pname = pl ? pl.label : 'ChatGPT';
    $('pair-hint').textContent = t && t.canPair ? '' : 'On Send, an open ' + pname + ' tab is used (or one opens in the background). To pair one now: open chatgpt.com or gemini.google.com, sign in, then click this icon there.';
    var lines = Object.keys(s.instructions).map(function (k) {
      var i = s.instructions[k];
      return k + ': ' + i.version + ' (' + i.source + ', rev ' + i.revision + ')' + (i.verified ? '' : ' [unverified]') + (i.status ? ' last check: ' + i.status.status + (i.status.code ? ' ' + i.status.code : '') : '');
    });
    $('instr').textContent = lines.join('\n');
    $('instr').style.whiteSpace = 'pre-wrap';
    $('reports').checked = s.reportsEnabled;
    $('enable-box').hidden = !(t && t.httpsOther);
    if (t && t.httpsOther) $('enable-host').textContent = t.host;
  }
  targetTab = await resolveTab();
  $('pair').addEventListener('click', async function () { await chrome.runtime.sendMessage({ type: 'popup:pair', tabId: targetTab }); refresh(); });
  $('unpair').addEventListener('click', async function () { await chrome.runtime.sendMessage({ type: 'popup:unpair' }); refresh(); });
  $('refresh').addEventListener('click', async function () { $('instr').textContent = 'Checking…'; await chrome.runtime.sendMessage({ type: 'popup:refresh' }); refresh(); });
  $('reports').addEventListener('change', function () { chrome.runtime.sendMessage({ type: 'popup:setReports', on: $('reports').checked }); });
  $('enable').addEventListener('click', async function () {
    var s = await chrome.runtime.sendMessage({ type: 'popup:state', tabId: targetTab });
    var host = s.tab.host;
    var granted = await chrome.permissions.request({ origins: ['https://' + host + '/*'] }); // needs this click (user gesture)
    if (granted) await chrome.runtime.sendMessage({ type: 'popup:addHost', host: host });
    refresh();
  });
  $('provider').addEventListener('change', async function () { await chrome.runtime.sendMessage({ type: 'popup:setProvider', provider: $('provider').value }); refresh(); });
  refresh();
})();
