'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { ROOT, manifest } = require('./helpers/fake-chrome.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lädt die Content-Skripte genau in der Reihenfolge aus dem Manifest in ein jsdom-Fenster. */
function loadContent({ settings, url = 'https://www.youtube.com/watch?v=abc123' } = {}) {
  const { window } = new JSDOM('<!doctype html><body></body>', { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const listeners = [];
  const sent = [];
  window.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: (message) => {
        sent.push(message);
        return Promise.resolve({ ok: true });
      },
    },
    storage: { local: { get: async () => ({ settings }) } },
  };
  const evalAll = () => {
    for (const file of manifest.content_scripts[0].js) window.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  };
  evalAll();
  const card = () => {
    const host = window.document.getElementById('ytgr-overlay-host');
    return host ? host.shadowRoot : null;
  };
  const send = (message) => listeners.forEach((l) => l(message, {}, () => {}));
  return { window, listeners, sent, card, send, evalAll };
}

test('die Content-Skripte laden in Manifest-Reihenfolge und registrieren genau einen Listener', () => {
  const { listeners, window } = loadContent();
  assert.equal(listeners.length, 1);
  for (const name of ['text', 'settings', 'messages', 'dom', 'runner', 'overlay']) {
    assert.ok(window.YTGR[name], `YTGR.${name} fehlt`);
  }
});

test('doppeltes Einbinden (Nachinjektion) registriert keinen zweiten Listener', () => {
  const { listeners, evalAll } = loadContent();
  evalAll();
  assert.equal(listeners.length, 1);
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

test('Statusmeldungen des Hintergrunddienstes steuern die Anzeige; ein weiterer Klick stoppt das Vorlesen', async () => {
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
