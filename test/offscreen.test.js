'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { normalizeSettings } = require('../src/lib/settings.js');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** Lädt die Skripte des Offscreen-Dokuments in der Reihenfolge aus offscreen.html. */
function loadOffscreen({ autoEnd = true } = {}) {
  const { window } = new JSDOM(read('src/offscreen/offscreen.html'), { runScripts: 'outside-only', url: 'chrome-extension://test/src/offscreen/offscreen.html' });
  const sent = [];
  const listeners = [];
  const audios = [];
  const requests = [];
  window.TextEncoder = TextEncoder;
  window.chrome = {
    runtime: {
      sendMessage: async (m) => { sent.push(m); },
      onMessage: { addListener: (fn) => listeners.push(fn) },
    },
  };
  window.fetch = async (url, init) => {
    requests.push({ url, key: init.headers['X-Goog-Api-Key'], body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ audioContent: 'QUJD' }) };
  };
  window.Audio = function Audio(src) {
    this.src = src;
    this.paused = false;
    this.play = () => {
      if (autoEnd) setTimeout(() => this.onended && this.onended(), 1);
      return Promise.resolve();
    };
    this.pause = () => { this.paused = true; };
    audios.push(this);
  };
  for (const file of ['src/lib/text.js', 'src/lib/google-tts.js', 'src/lib/speaker.js', 'src/offscreen/offscreen.js']) window.eval(read(file));
  const dispatch = (msg) => {
    let response;
    for (const l of listeners) l(msg, {}, (r) => { response = r; });
    return response;
  };
  return { sent, audios, requests, dispatch };
}

const settings = normalizeSettings({ apiKey: 'KEY' });

test('YTGR_PLAY: erzeugt Sprache per Google TTS, spielt sie ab und meldet Status samt Tab-ID', async () => {
  const { sent, audios, requests, dispatch } = loadOffscreen();
  assert.deepEqual(JSON.parse(JSON.stringify(dispatch({ target: 'offscreen', type: 'YTGR_PLAY', text: 'Hallo Welt.', tabId: 5, settings }))), { ok: true });
  await tick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].key, 'KEY');
  assert.equal(requests[0].body.input.text, 'Hallo Welt.');
  assert.match(audios[0].src, /^data:audio\/ogg;base64,QUJD$/);
  const statuses = sent.filter((m) => m.type === 'YTGR_TTS_STATUS');
  assert.deepEqual(statuses.map((m) => m.phase), ['speaking', 'done']);
  assert.ok(statuses.every((m) => m.target === 'background' && m.tabId === 5));
});

test('Nachrichten ohne Ziel „offscreen“ werden ignoriert', async () => {
  const { sent, requests, dispatch } = loadOffscreen();
  assert.equal(dispatch({ type: 'YTGR_PLAY', text: 'x', settings }), undefined);
  assert.equal(dispatch(null), undefined);
  await tick();
  assert.equal(requests.length, 0);
  assert.equal(sent.length, 0);
});

test('YTGR_STOP hält die Wiedergabe an und meldet „stopped“', async () => {
  const { sent, audios, dispatch } = loadOffscreen({ autoEnd: false });
  dispatch({ target: 'offscreen', type: 'YTGR_PLAY', text: 'Hallo Welt.', tabId: null, settings });
  await tick();
  assert.equal(audios.length, 1);
  dispatch({ target: 'offscreen', type: 'YTGR_STOP' });
  await tick();
  assert.equal(audios[0].paused, true);
  assert.deepEqual(sent.filter((m) => m.type === 'YTGR_TTS_STATUS').map((m) => m.phase), ['speaking', 'stopped']);
  assert.equal(sent[0].tabId, null);
});
