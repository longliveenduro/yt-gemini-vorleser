'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { ROOT, manifest } = require('./helpers/fake-chrome.js');
const { createWatchPage } = require('./helpers/fake-youtube.js');
const { HOST_ATTR } = require('../src/lib/page-button.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Lädt die Content-Skripte in der Reihenfolge aus dem Manifest in ein jsdom-Fenster:
 * entweder auf eine leere Seite oder (watchPage) auf die nachgebaute YouTube-Watch-Seite.
 */
function loadContent({ settings, url = 'https://www.youtube.com/watch?v=abc123', watchPage } = {}) {
  let window;
  let page = null;
  if (watchPage) {
    page = createWatchPage({ runScripts: 'outside-only', ...watchPage });
    window = page.window;
  } else {
    window = new JSDOM('<!doctype html><body></body>', { url, runScripts: 'outside-only', pretendToBeVisual: true }).window;
  }
  const messageListeners = [];
  const storageListeners = [];
  const sent = [];
  window.chrome = {
    runtime: {
      id: 'test-extension',
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
      sendMessage: (message) => {
        sent.push(message);
        return Promise.resolve({ ok: true });
      },
    },
    storage: {
      local: { get: async () => ({ settings }) },
      onChanged: { addListener: (fn) => storageListeners.push(fn) },
    },
  };
  const evalAll = () => {
    for (const file of manifest.content_scripts[0].js) window.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  };
  evalAll();
  const card = () => {
    const host = window.document.getElementById('ytgr-overlay-host');
    return host ? host.shadowRoot : null;
  };
  const pageButtonHost = () => window.document.querySelector(`[${HOST_ATTR}]`);
  const pageButtonEl = () => pageButtonHost().shadowRoot.querySelector('button');
  const send = (message) => messageListeners.forEach((l) => l(message, {}, () => {}));
  const changeSettings = (newValue) => storageListeners.forEach((l) => l({ settings: { newValue } }, 'local'));
  return { window, page, messageListeners, storageListeners, sent, card, pageButtonHost, pageButtonEl, send, changeSettings, evalAll };
}

test('die Content-Skripte laden in Manifest-Reihenfolge und registrieren je einen Nachrichten- und Speicher-Listener', () => {
  const { messageListeners, storageListeners, window } = loadContent();
  assert.equal(messageListeners.length, 1);
  assert.equal(storageListeners.length, 1);
  for (const name of ['text', 'settings', 'messages', 'dom', 'pageButton', 'runner', 'overlay']) {
    assert.ok(window.YTGR[name], `YTGR.${name} fehlt`);
  }
});

test('doppeltes Einbinden (Nachinjektion) registriert keine zweiten Listener', () => {
  const { messageListeners, storageListeners, evalAll } = loadContent();
  evalAll();
  assert.equal(messageListeners.length, 1);
  assert.equal(storageListeners.length, 1);
});

test('YTGR_TOGGLE ohne API-Key zeigt den Hinweis mit Optionen-Schaltfläche', async () => {
  const { send, card } = loadContent({ settings: {} });
  send({ type: 'YTGR_TOGGLE' });
  await wait(30);
  assert.match(card().querySelector('.title').textContent, /API-Key/);
  assert.ok([...card().querySelectorAll('button')].some((b) => b.textContent === 'Optionen öffnen'));
});

test('der „Optionen öffnen“-Knopf bittet den Hintergrunddienst, die Optionsseite zu öffnen', async () => {
  const { send, card, sent } = loadContent({ settings: {} });
  send({ type: 'YTGR_TOGGLE' });
  await wait(30);
  [...card().querySelectorAll('button')].find((b) => b.textContent === 'Optionen öffnen').click();
  assert.equal(sent.at(-1).type, 'YTGR_OPEN_OPTIONS');
});

test('YTGR_TOGGLE auf einer anderen YouTube-Seite meldet „Kein YouTube-Video geöffnet“', async () => {
  const { send, card } = loadContent({ settings: { apiKey: 'K' }, url: 'https://www.youtube.com/feed/subscriptions' });
  send({ type: 'YTGR_TOGGLE' });
  await wait(30);
  assert.match(card().querySelector('.title').textContent, /Kein YouTube-Video/);
});

test('Statusmeldungen steuern die Anzeige; ein weiterer Klick stoppt das Vorlesen', async () => {
  const { send, card, sent } = loadContent({ settings: { apiKey: 'K' } });
  send({ type: 'YTGR_STATUS', phase: 'speaking' });
  assert.match(card().querySelector('.body').textContent, /Lese die Zusammenfassung vor/);

  send({ type: 'YTGR_TOGGLE' }); // Klick auf das Symbol während des Vorlesens
  await wait(10);
  assert.ok(sent.some((m) => m.type === 'YTGR_STOP'));
  assert.equal(card(), null, 'Anzeige ausgeblendet');

  send({ type: 'YTGR_STATUS', phase: 'error', message: 'Der API-Key ist ungültig.' });
  assert.match(card().querySelector('.title').textContent, /Vorlesen fehlgeschlagen/);
  assert.match(card().querySelector('.body').textContent, /API-Key ist ungültig/);

  send({ type: 'YTGR_STATUS', phase: 'stopped' });
  assert.equal(card(), null);
});

test('Nachrichten mit unbekanntem Typ werden ignoriert', () => {
  const { send, card } = loadContent();
  send({ type: 'IRGENDWAS' });
  send(null);
  assert.equal(card(), null);
});

test('BUTTON: erscheint nach dem Laden direkt hinter „Ask“ in der Aktionsleiste', async () => {
  const { pageButtonHost, window } = loadContent({ settings: {}, watchPage: {} });
  await wait(30);
  const host = pageButtonHost();
  assert.ok(host, 'Button fehlt');
  assert.equal(host.previousElementSibling, window.document.getElementById('ask'));
  assert.equal(host.shadowRoot.querySelector('.label').textContent, 'Vorlesen');
});

test('BUTTON: ist die Einstellung aus, wird er nicht angezeigt', async () => {
  const { pageButtonHost } = loadContent({ settings: { pageButton: false }, watchPage: {} });
  await wait(30);
  assert.equal(pageButtonHost(), null);
});

test('BUTTON: Änderungen in den Optionen wirken sofort (ohne Neuladen der Seite)', async () => {
  const { pageButtonHost, changeSettings } = loadContent({ settings: {}, watchPage: {} });
  await wait(30);
  assert.ok(pageButtonHost());
  changeSettings({ pageButton: false });
  assert.equal(pageButtonHost(), null, 'ausgeblendet');
  changeSettings({ pageButton: true });
  assert.ok(pageButtonHost(), 'wieder eingeblendet');
});

test('BUTTON: Klick startet den Ablauf (hier: Hinweis auf fehlenden API-Key)', async () => {
  const { pageButtonEl, card } = loadContent({ settings: {}, watchPage: {} });
  await wait(30);
  pageButtonEl().click();
  await wait(30);
  assert.match(card().querySelector('.title').textContent, /API-Key/);
});

test('BUTTON: zeigt „Stopp“, solange vorgelesen wird, und stoppt beim nächsten Klick', async () => {
  const { pageButtonEl, send, sent, card } = loadContent({ settings: { apiKey: 'K' }, watchPage: {} });
  await wait(30);
  assert.equal(pageButtonEl().querySelector('.label').textContent, 'Vorlesen');

  send({ type: 'YTGR_STATUS', phase: 'speaking' });
  assert.equal(pageButtonEl().querySelector('.label').textContent, 'Stopp');
  assert.equal(pageButtonEl().dataset.state, 'active');

  pageButtonEl().click();
  await wait(10);
  assert.ok(sent.some((m) => m.type === 'YTGR_STOP'));
  assert.equal(pageButtonEl().querySelector('.label').textContent, 'Vorlesen');
  assert.equal(card(), null);

  send({ type: 'YTGR_STATUS', phase: 'speaking' });
  send({ type: 'YTGR_STATUS', phase: 'done' });
  assert.equal(pageButtonEl().querySelector('.label').textContent, 'Vorlesen');
});

test('BUTTON: eine verwaiste Instanz (Erweiterung neu geladen) räumt ihren Button selbst weg', async () => {
  const { pageButtonHost, window } = loadContent({ settings: {}, watchPage: {} });
  await wait(30);
  assert.ok(pageButtonHost());
  window.chrome.runtime.id = undefined; // so sieht ein Content-Script nach dem Neuladen der Erweiterung aus
  window.document.dispatchEvent(new window.Event('yt-navigate-finish'));
  await wait(550); // Entprellzeit des Buttons
  assert.equal(pageButtonHost(), null);
});

test('BUTTON: nach einem erfolgreichen Lauf bleibt er auf „Stopp“, bis das Vorlesen beendet ist', async () => {
  const { pageButtonEl, send, sent } = loadContent({ settings: { apiKey: 'K' }, watchPage: {} });
  await wait(30);
  pageButtonEl().click();
  assert.equal(pageButtonEl().dataset.state, 'active', 'sofort aktiv: der Ablauf läuft');

  // echter Ablauf gegen die nachgebaute Seite (mit den normalen Wartezeiten, ca. 3–4 s)
  for (let i = 0; i < 80 && !sent.some((m) => m.type === 'YTGR_SPEAK'); i += 1) await wait(100);
  const speak = sent.find((m) => m.type === 'YTGR_SPEAK');
  assert.ok(speak, 'Auftrag zum Vorlesen wurde gesendet');
  assert.match(speak.text, /Sauerteig/);
  await wait(30);
  assert.equal(pageButtonEl().dataset.state, 'active', 'Vorlesen ist beauftragt, aber noch nicht beendet');

  send({ type: 'YTGR_STATUS', phase: 'done' });
  assert.equal(pageButtonEl().dataset.state, 'idle');
});
