'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRunner, DEFAULT_PROMPT } = require('../src/lib/runner.js');
const { normalizeSettings } = require('../src/lib/settings.js');
const { createWatchPage, FAST_TIMING, EXPECTED_DEFAULT_TEXT } = require('./helpers/fake-youtube.js');

function recordingUi() {
  const ui = {
    statuses: [],
    errors: [],
    hidden: 0,
    status: (text) => ui.statuses.push(text),
    error: (info) => ui.errors.push(info),
    info: () => {},
    hide: () => { ui.hidden += 1; },
  };
  return ui;
}

function setup({ page: pageOptions = {}, settings = {}, timing = {}, send } = {}) {
  const page = createWatchPage(pageOptions);
  const ui = recordingUi();
  const sent = [];
  const runner = createRunner({
    document: page.document,
    location: page.window.location,
    getSettings: async () => normalizeSettings({ apiKey: 'KEY', ...settings }),
    send: async (message) => {
      sent.push(message);
      return send ? send(message) : { ok: true };
    },
    ui,
    timing: { ...FAST_TIMING, ...timing },
    log: () => {},
  });
  return { page, ui, sent, runner };
}

test('Ablauf (EN): Ask öffnen → „Summarize the video“ → bereinigten Text zum Vorlesen senden', async () => {
  const { page, ui, sent, runner } = setup();
  const result = await runner.run();
  assert.equal(result.ok, true);
  assert.equal(page.state.askClicks, 1);
  assert.equal(page.state.chipClicks, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'YTGR_SPEAK');
  assert.equal(sent[0].text, EXPECTED_DEFAULT_TEXT);
  assert.equal(ui.errors.length, 0);
  assert.ok(ui.statuses.some((s) => /Öffne Gemini/.test(s)));
});

test('Ablauf (DE): deutsche Beschriftungen „Fragen“ und „Video zusammenfassen“', async () => {
  const { page, sent, runner } = setup({ page: { askLabel: 'Fragen', chipLabel: 'Video zusammenfassen' } });
  const result = await runner.run();
  assert.equal(result.ok, true);
  assert.equal(page.state.chipClicks, 1);
  assert.equal(sent[0].text, EXPECTED_DEFAULT_TEXT);
});

test('Zeitstempel, Markdown-Reste, Daumen/Kopieren, neue Vorschläge und Hinweise landen nicht im Vorlesetext', async () => {
  const { sent, runner } = setup();
  await runner.run();
  const text = sent[0].text;
  assert.doesNotMatch(text, /\d:\d\d/);
  assert.doesNotMatch(text, /Summarize the video|Good response|Copy|key takeaways|inaccurate|AI-generated/);
});

test('ist das Panel schon offen, wird „Ask“ nicht noch einmal geklickt (sonst würde es schließen)', async () => {
  const { page, sent, runner } = setup({ page: { panelOpen: true } });
  const result = await runner.run();
  assert.equal(result.ok, true);
  assert.equal(page.state.askClicks, 0);
  assert.equal(page.state.chipClicks, 1);
  assert.equal(sent[0].text, EXPECTED_DEFAULT_TEXT);
});

test('wiederholter Lauf im selben Panel: nur die neue Antwort wird vorgelesen', async () => {
  const { page, sent, runner } = setup();
  await runner.run();
  // zweite Runde: neues Vorschlags-Chip „Summarize the video“ erscheint wieder
  page.panel.querySelector('.chips').insertAdjacentHTML('beforeend', '<button>Summarize the video</button>');
  await runner.run();
  assert.equal(page.state.askClicks, 1, 'Panel war offen');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].text, EXPECTED_DEFAULT_TEXT);
});

test('unbekannte Chip-Beschriftung → Rückfall: Standard-Prompt wird ins Eingabefeld getippt', async () => {
  const { page, sent, runner } = setup({ page: { chipLabel: 'Zeig mir alles' } });
  const result = await runner.run();
  assert.equal(result.ok, true);
  assert.equal(page.state.chipClicks, 0);
  assert.deepEqual(page.state.sent, [DEFAULT_PROMPT]);
  assert.equal(sent[0].text, EXPECTED_DEFAULT_TEXT);
});

test('eigener Prompt hat Vorrang vor dem Chip und fasst Eingabe-Echo nicht als Antwort auf', async () => {
  const prompt = 'Fasse das Video in zwei Sätzen zusammen.';
  const { page, sent, runner } = setup({ settings: { customPrompt: prompt } });
  const result = await runner.run();
  assert.equal(result.ok, true);
  assert.deepEqual(page.state.sent, [prompt]);
  assert.equal(page.state.chipClicks, 0);
  assert.equal(sent[0].text, EXPECTED_DEFAULT_TEXT);
});

test('Prompt ohne Senden-Button wird per Enter abgeschickt', async () => {
  const { page, runner } = setup({ page: { withSendButton: false }, settings: { customPrompt: 'Kurz bitte.' } });
  const result = await runner.run();
  assert.equal(result.ok, true);
  assert.deepEqual(page.state.sent, ['Kurz bitte.']);
});

test('Kommentarfeld und Transkript-Suche werden beim Tippen nie angefasst', async () => {
  const { page, runner } = setup({ settings: { customPrompt: 'Frage' } });
  await runner.run();
  assert.equal(page.document.querySelector('#contenteditable-root').textContent, '');
  assert.equal(page.document.querySelector('ytd-masthead input').value, '');
  assert.equal(page.document.querySelector('[target-id="engagement-panel-searchable-transcript"] input').value, '');
});

test('GEOFENCING: kein Ask-Button, Standort DE → VPN-Hinweis auf die USA, nichts wird vorgelesen', async () => {
  const { page, ui, sent, runner } = setup({ page: { askLabel: null, country: 'DE' } });
  const result = await runner.run();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'GEOFENCE');
  assert.equal(sent.length, 0);
  assert.equal(page.state.askClicks, 0);
  const info = ui.errors[0];
  assert.equal(info.vpn, true);
  assert.match(info.text, /VPN/);
  assert.match(info.text, /USA/);
  assert.match(info.text, /erkannter YouTube-Standort: DE/);
});

test('GEOFENCING: ohne erkennbaren Standort wird trotzdem auf ein US-VPN hingewiesen', async () => {
  const { page, ui, runner } = setup({ page: { askLabel: null } });
  page.document.querySelectorAll('script').forEach((s) => s.remove());
  const result = await runner.run();
  assert.equal(result.code, 'GEOFENCE');
  assert.match(ui.errors[0].text, /VPN-Server in den USA/);
  assert.doesNotMatch(ui.errors[0].text, /erkannter YouTube-Standort/);
});

test('kein Ask-Button, aber Standort bereits US → kein VPN-Rat, sondern „nicht verfügbar“', async () => {
  const { ui, runner } = setup({ page: { askLabel: null, country: 'US' } });
  const result = await runner.run();
  assert.equal(result.code, 'NOT_AVAILABLE');
  assert.equal(ui.errors[0].vpn, false);
  assert.match(ui.errors[0].text, /ein VPN hilft also nicht/);
});

test('kein Ask-Button und nicht angemeldet → Hinweis zur Anmeldung statt VPN', async () => {
  const { ui, runner } = setup({ page: { askLabel: null, signedIn: false } });
  const result = await runner.run();
  assert.equal(result.code, 'NOT_SIGNED_IN');
  assert.equal(ui.errors[0].vpn, false);
});

test('fehlender API-Key bricht ab, bevor die Seite angefasst wird', async () => {
  const { page, ui, runner } = setup({ settings: { apiKey: '' } });
  const result = await runner.run();
  assert.equal(result.code, 'NO_API_KEY');
  assert.equal(page.state.askClicks, 0);
  assert.equal(ui.errors[0].options, true);
});

test('auf anderen Seiten als /watch wird nichts unternommen', async () => {
  const { ui, runner } = setup({ page: { url: 'https://www.youtube.com/feed/subscriptions' } });
  const result = await runner.run();
  assert.equal(result.code, 'NOT_WATCH_PAGE');
  assert.equal(ui.errors.length, 1);
});

test('Panel öffnet sich nicht → PANEL_NOT_FOUND mit Hinweis auf die Optionen', async () => {
  const { ui, runner } = setup({ page: { askOpensPanel: false }, timing: { panelTimeoutMs: 60 } });
  const result = await runner.run();
  assert.equal(result.code, 'PANEL_NOT_FOUND');
  assert.equal(ui.errors[0].options, true);
});

test('eigener Prompt, aber kein Eingabefeld im Panel → NO_PROMPT_TARGET', async () => {
  const { page, sent, runner } = setup({ page: { withInput: false }, settings: { customPrompt: 'Frage' } });
  const result = await runner.run();
  assert.equal(result.code, 'NO_PROMPT_TARGET');
  assert.equal(page.state.chipClicks, 0);
  assert.equal(sent.length, 0);
});

test('Panel ohne Chip und ohne Eingabefeld wird nicht als Gemini-Panel erkannt → PANEL_NOT_FOUND', async () => {
  const { runner } = setup({ page: { chipLabel: null, withInput: false }, timing: { panelTimeoutMs: 60 } });
  assert.equal((await runner.run()).code, 'PANEL_NOT_FOUND');
});

test('keine Antwort innerhalb des Zeitlimits → NO_ANSWER', async () => {
  const { ui, sent, runner } = setup({ page: { answerBlocks: [] }, timing: { responseTimeoutMs: 120 } });
  const result = await runner.run();
  assert.equal(result.code, 'NO_ANSWER');
  assert.equal(sent.length, 0);
  assert.match(ui.errors[0].title, /Keine Antwort/);
});

test('lange Antworten werden an Satzgrenzen auf maxChars gekürzt', async () => {
  const blocks = Array.from({ length: 20 }, (_, i) => `<p>Das ist der ${i + 1}. lange Absatz mit ziemlich viel Text darin, damit es zusammenkommt.</p>`);
  const { sent, runner } = setup({ page: { answerBlocks: blocks, streamMs: 3 }, settings: { maxChars: 500 } });
  const result = await runner.run();
  assert.equal(result.ok, true);
  assert.ok(sent[0].text.length <= 500);
  assert.match(sent[0].text, /\.$/);
});

test('TTS-Fehler vom Hintergrunddienst werden gemeldet', async () => {
  const { ui, runner } = setup({ send: () => ({ ok: false, code: 'OFFSCREEN', message: 'kaputt' }) });
  const result = await runner.run();
  assert.equal(result.code, 'TTS_ERROR');
  assert.match(ui.errors[0].text, /kaputt/);
});

test('fehlender Key im Hintergrunddienst wird als NO_API_KEY gemeldet', async () => {
  const { runner } = setup({ send: () => ({ ok: false, code: 'NO_API_KEY', message: 'x' }) });
  assert.equal((await runner.run()).code, 'NO_API_KEY');
});

test('„Video pausieren“ wird nur bei aktivierter Einstellung ausgeführt', async () => {
  for (const [pauseVideo, expected] of [[true, 1], [false, 0]]) {
    const { page, runner } = setup({ settings: { pauseVideo } });
    const video = page.document.querySelector('video');
    let pauses = 0;
    video.pause = () => { pauses += 1; };
    Object.defineProperty(video, 'paused', { value: false, configurable: true });
    await runner.run();
    assert.equal(pauses, expected, `pauseVideo=${pauseVideo}`);
  }
});

test('abort() beendet den Ablauf, blendet die Anzeige aus und liest nichts vor', async () => {
  const { ui, sent, runner } = setup({ page: { streamMs: 200 } });
  const running = runner.run();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(runner.isBusy(), true);
  runner.abort();
  const result = await running;
  assert.equal(result.code, 'ABORTED');
  assert.equal(sent.length, 0);
  assert.ok(ui.hidden >= 1);
  assert.equal(runner.isBusy(), false);
});

test('ein zweiter run() während des Laufs wird abgewiesen', async () => {
  const { runner } = setup();
  const first = runner.run();
  const second = await runner.run();
  assert.equal(second.code, 'BUSY');
  assert.equal((await first).ok, true);
});

test('unerwartete Fehler (z. B. ungültiger Erweiterungskontext) werden verständlich gemeldet', async () => {
  const { ui, runner } = setup({ send: () => { throw new Error('Extension context invalidated.'); } });
  const result = await runner.run();
  assert.equal(result.code, 'CONTEXT_INVALIDATED');
  assert.match(ui.errors[0].text, /Lade die Seite neu/);
});
