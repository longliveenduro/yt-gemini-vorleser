'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

/** Lädt die echte options.html samt Skripten (Reihenfolge wie im HTML) in jsdom. */
async function loadOptions({ stored, fetchImpl } = {}) {
  const { window } = new JSDOM(read('src/options/options.html'), {
    url: 'chrome-extension://test/src/options/options.html',
    runScripts: 'outside-only',
  });
  const store = { settings: stored };
  const runtimeMessages = [];
  const listeners = [];
  window.chrome = {
    storage: { local: { get: async () => ({ settings: store.settings }), set: async (o) => Object.assign(store, o) } },
    runtime: {
      sendMessage: async (m) => {
        runtimeMessages.push(m);
        return { ok: true };
      },
      onMessage: { addListener: (fn) => listeners.push(fn) },
    },
  };
  window.fetch = fetchImpl || (async () => { throw new Error('kein Netz'); });
  for (const file of ['src/lib/settings.js', 'src/lib/google-tts.js', 'src/options/options.js']) window.eval(read(file));
  await tick();
  const $ = (id) => window.document.getElementById(id);
  return { window, store, runtimeMessages, listeners, $ };
}

test('jede in options.js benutzte Element-ID existiert in options.html', () => {
  const js = read('src/options/options.js');
  const html = read('src/options/options.html');
  const ids = new Set([...js.matchAll(/\$\('([A-Za-z]+)'\)/g)].map((m) => m[1]));
  const fields = /const FIELDS = \[([\s\S]*?)\];/.exec(js)[1];
  for (const m of fields.matchAll(/'([A-Za-z]+)'/g)) ids.add(m[1]);
  assert.ok(ids.size > 20);
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `id="${id}" fehlt in options.html`);
});

test('zeigt Standardwerte, wenn noch nichts gespeichert ist', async () => {
  const { $ } = await loadOptions();
  assert.equal($('languageCode').value, 'de-DE');
  assert.equal($('voiceName').value, 'de-DE-Neural2-B');
  assert.equal($('pauseVideo').checked, true);
  assert.equal($('audioEncoding').value, 'OGG_OPUS');
  assert.equal($('rateOut').textContent, '1,00');
  assert.equal($('apiKey').type, 'password');
});

test('zeigt gespeicherte Werte', async () => {
  const { $ } = await loadOptions({ stored: { apiKey: 'KEY', speakingRate: 1.5, pauseVideo: false, customPrompt: 'Kurz.' } });
  assert.equal($('apiKey').value, 'KEY');
  assert.equal($('speakingRate').value, '1.5');
  assert.equal($('rateOut').textContent, '1,50');
  assert.equal($('pauseVideo').checked, false);
  assert.equal($('customPrompt').value, 'Kurz.');
});

test('Speichern normalisiert die Eingaben und bestätigt', async () => {
  const { $, store, window } = await loadOptions();
  $('apiKey').value = '  KEY  ';
  $('languageCode').value = 'kaputt!';
  $('maxChars').value = '99999';
  $('pauseVideo').checked = false;
  $('form').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
  await tick();
  assert.equal(store.settings.apiKey, 'KEY');
  assert.equal(store.settings.languageCode, 'de-DE');
  assert.equal(store.settings.maxChars, 20000);
  assert.equal(store.settings.pauseVideo, false);
  assert.equal($('languageCode').value, 'de-DE', 'Formular zeigt den korrigierten Wert');
  assert.match($('saveStatus').textContent, /Gespeichert/);
});

test('„Anzeigen“ schaltet die Sichtbarkeit des Keys um', async () => {
  const { $ } = await loadOptions();
  $('toggleKey').click();
  assert.equal($('apiKey').type, 'text');
  assert.equal($('toggleKey').getAttribute('aria-pressed'), 'true');
  $('toggleKey').click();
  assert.equal($('apiKey').type, 'password');
});

test('„Standardwerte laden“ behält den API-Key', async () => {
  const { $ } = await loadOptions({ stored: { apiKey: 'KEY', speakingRate: 2, voiceName: 'x' } });
  $('reset').click();
  assert.equal($('apiKey').value, 'KEY');
  assert.equal($('speakingRate').value, '1');
  assert.equal($('voiceName').value, 'de-DE-Neural2-B');
});

test('„Stimmen laden“ braucht einen Key und füllt sonst die Vorschlagsliste', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, key: init.headers['X-Goog-Api-Key'] });
    return { ok: true, status: 200, json: async () => ({ voices: [{ name: 'de-DE-Neural2-B', ssmlGender: 'MALE' }, { name: 'de-DE-Standard-A', ssmlGender: 'FEMALE' }] }) };
  };
  const { $ } = await loadOptions({ fetchImpl });
  $('loadVoices').click();
  await tick();
  assert.match($('voicesStatus').textContent, /API-Key/);
  assert.equal(requests.length, 0);

  $('apiKey').value = 'KEY';
  $('loadVoices').click();
  await tick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].key, 'KEY');
  assert.match(requests[0].url, /languageCode=de-DE$/);
  const options = [...$('voices').querySelectorAll('option')];
  assert.deepEqual(options.map((o) => o.value), ['de-DE-Neural2-B', 'de-DE-Standard-A']);
  assert.equal(options[0].label, 'Neural2 · männlich');
  assert.match($('voicesStatus').textContent, /2 Stimmen geladen/);
});

test('„Stimmen laden“ zeigt Fehler von Google verständlich an', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } }) });
  const { $ } = await loadOptions({ fetchImpl });
  $('apiKey').value = 'FALSCH';
  $('loadVoices').click();
  await tick();
  assert.match($('voicesStatus').textContent, /API-Key ist ungültig/);
  assert.ok($('voicesStatus').classList.contains('bad'));
});

test('„Stimme testen“ nutzt die Formularwerte (ungespeichert), sperrt den Knopf und zeigt das Ergebnis', async () => {
  const { $, runtimeMessages, listeners } = await loadOptions();
  $('apiKey').value = 'FORMKEY';
  $('languageCode').value = 'en-US';
  $('voiceName').value = '';
  $('test').click();
  await tick();
  const msg = runtimeMessages.at(-1);
  assert.equal(msg.type, 'YTGR_SPEAK');
  assert.equal(msg.source, 'options');
  assert.equal(msg.settings.apiKey, 'FORMKEY');
  assert.equal(msg.settings.languageCode, 'en-US');
  assert.match(msg.text, /Hello/);
  assert.equal($('test').disabled, true);

  const status = (phase, extra = {}) => listeners.forEach((l) => l({ type: 'YTGR_TTS_STATUS', target: 'background', tabId: null, phase, ...extra }));
  status('speaking');
  assert.match($('testStatus').textContent, /Wiedergabe läuft/);
  status('done');
  assert.equal($('test').disabled, false);

  $('test').click();
  await tick();
  status('error', { message: 'Der API-Key ist ungültig.' });
  assert.match($('testStatus').textContent, /API-Key ist ungültig/);
  assert.equal($('test').disabled, false);
});

test('Statusmeldungen, die zu einem YouTube-Tab gehören, ändern die Testanzeige nicht', async () => {
  const { $, listeners } = await loadOptions();
  listeners.forEach((l) => l({ type: 'YTGR_TTS_STATUS', target: 'background', tabId: 7, phase: 'error', message: 'x' }));
  assert.equal($('testStatus').textContent, '');
});
