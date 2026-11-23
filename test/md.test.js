const test = require('node:test'), assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { renderMd } = require('../extension/lib/md.js');

function render(text) {
  const dom = new JSDOM('<!doctype html><div id="t"></div>');
  const into = dom.window.document.getElementById('t');
  renderMd(dom.window.document, text, into);
  return into;
}

test('renderMd writes only text and safe https links, never raw HTML', () => {
  const into = render('Hello <img src=x onerror=alert(1)> **bold** and `code` and [docs](https://example.com/a) and [bad](javascript:alert(1))');
  assert.equal(into.querySelectorAll('img').length, 0);
  assert.equal(into.querySelector('strong').textContent, 'bold');
  assert.equal(into.querySelector('code').textContent, 'code');
  const a = into.querySelectorAll('a');
  assert.equal(a.length, 1);
  assert.equal(a[0].getAttribute('href'), 'https://example.com/a');
  assert.ok(into.textContent.includes('<img src=x'));
  assert.ok(into.textContent.includes('[bad](javascript:alert(1))'));
});

test('renderMd renders fenced code and headings without executing markup', () => {
  const into = render('# Title\n\n```html\n<script>alert(1)</script>\n```\n\n- one\n- two');
  assert.equal(into.querySelector('h1').textContent, 'Title');
  assert.equal(into.querySelector('pre code').textContent, '<script>alert(1)</script>');
  assert.equal(into.querySelectorAll('script').length, 0);
  assert.equal(into.querySelectorAll('li').length, 2);
});
