'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/lib/settings.js');

test('normalizeSettings füllt Standardwerte auf', () => {
  const s = S.normalizeSettings(undefined);
  assert.equal(s.languageCode, 'de-DE');
  assert.equal(s.audioEncoding, 'OGG_OPUS');
  assert.equal(s.apiKey, '');
  assert.equal(s.pauseVideo, true);
  assert.ok(S.parseList(s.askLabels).includes('Ask'));
  assert.ok(S.parseList(s.summarizeKeywords).includes('zusammenfass'));
});

test('normalizeSettings begrenzt Zahlen und akzeptiert Strings mit Komma', () => {
  assert.equal(S.normalizeSettings({ speakingRate: 9 }).speakingRate, 2);
  assert.equal(S.normalizeSettings({ speakingRate: 0.1 }).speakingRate, 0.5);
  assert.equal(S.normalizeSettings({ speakingRate: '1,25' }).speakingRate, 1.25);
  assert.equal(S.normalizeSettings({ speakingRate: 'abc' }).speakingRate, 1);
  assert.equal(S.normalizeSettings({ maxChars: 10 }).maxChars, 500);
  assert.equal(S.normalizeSettings({ maxChars: '7000.4' }).maxChars, 7000);
  assert.equal(S.normalizeSettings({ responseTimeoutSec: 1 }).responseTimeoutSec, 15);
});

test('normalizeSettings verwirft ungültige Sprach-, Stimmen- und Formatangaben', () => {
  const s = S.normalizeSettings({ languageCode: 'deutsch!', voiceName: 'de DE/x', audioEncoding: 'WAV' });
  assert.equal(s.languageCode, 'de-DE');
  assert.equal(s.voiceName, 'de-DE-Neural2-B');
  assert.equal(s.audioEncoding, 'OGG_OPUS');
});

test('normalizeSettings erlaubt eine leere Stimme (= Standardstimme der Sprache)', () => {
  assert.equal(S.normalizeSettings({ voiceName: '' }).voiceName, '');
});

test('normalizeSettings trimmt Texte und fällt bei leeren Listen auf Standardlisten zurück', () => {
  const s = S.normalizeSettings({ apiKey: '  KEY  ', askLabels: '   ', customPrompt: '  Fasse zusammen  ' });
  assert.equal(s.apiKey, 'KEY');
  assert.equal(s.askLabels, S.DEFAULT_SETTINGS.askLabels);
  assert.equal(s.customPrompt, 'Fasse zusammen');
});

test('normalizeSettings übernimmt nur echte Booleans', () => {
  assert.equal(S.normalizeSettings({ pauseVideo: false }).pauseVideo, false);
  assert.equal(S.normalizeSettings({ pauseVideo: 'false' }).pauseVideo, true);
  assert.equal(S.normalizeSettings({ debug: true }).debug, true);
});

test('parseList trennt an Komma und Zeilenumbruch', () => {
  assert.deepEqual(S.parseList('a, b\nc,, d '), ['a', 'b', 'c', 'd']);
  assert.deepEqual(S.parseList(''), []);
  assert.deepEqual(S.parseList(undefined), []);
});

test('loadSettings/saveSettings arbeiten mit einem storage-Objekt', async () => {
  const data = {};
  const storage = {
    get: async (key) => ({ [key]: data[key] }),
    set: async (obj) => Object.assign(data, obj),
  };
  assert.equal((await S.loadSettings(storage)).languageCode, 'de-DE');
  const saved = await S.saveSettings(storage, { apiKey: ' abc ', speakingRate: '1.5' });
  assert.equal(saved.apiKey, 'abc');
  assert.equal(data.settings.speakingRate, 1.5);
  assert.equal((await S.loadSettings(storage)).apiKey, 'abc');
});

test('neue Einstellungen: Anforderungsmodus „prompt“ und Seiten-Button sind standardmäßig aktiv', () => {
  const s = S.normalizeSettings({});
  assert.equal(s.requestMode, 'prompt');
  assert.equal(s.pageButton, true);
  assert.equal(S.normalizeSettings({ requestMode: 'chip' }).requestMode, 'chip');
  assert.equal(S.normalizeSettings({ requestMode: 'quatsch' }).requestMode, 'prompt');
  assert.equal(S.normalizeSettings({ pageButton: false }).pageButton, false);
  assert.equal(S.normalizeSettings({ pageButton: 'nein' }).pageButton, true);
});

test('Einstellungen aus Version 1.0 (ohne die neuen Felder) werden um Standardwerte ergänzt', () => {
  const old = { apiKey: 'KEY', languageCode: 'de-DE', voiceName: 'de-DE-Neural2-B', speakingRate: 1.1 };
  const s = S.normalizeSettings(old);
  assert.equal(s.apiKey, 'KEY');
  assert.equal(s.speakingRate, 1.1);
  assert.equal(s.requestMode, 'prompt');
  assert.equal(s.pageButton, true);
});

test('die Sprachliste ist konsistent und beginnt mit Deutsch', () => {
  assert.equal(S.LANGUAGES[0].code, 'de-DE');
  assert.equal(S.DEFAULT_SETTINGS.languageCode, S.LANGUAGES[0].code);
  const codes = S.LANGUAGES.map((l) => l.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const l of S.LANGUAGES) assert.ok(l.label && l.name && l.english, l.code);
});

test('languageInfo ordnet auch unbekannte Regionen über die Hauptsprache zu', () => {
  assert.equal(S.languageInfo('de-DE').english, 'German');
  assert.equal(S.languageInfo('de-AT').name, 'Deutsch');
  assert.equal(S.languageInfo('EN-gb').english, 'English');
  assert.deepEqual(S.languageInfo('sv-SE'), { code: 'sv-SE', label: 'sv-SE', name: 'sv-SE', english: 'sv-SE' });
  assert.equal(S.primaryLanguage('cmn-CN'), 'cmn');
});

test('buildSummaryPrompt: Standard-Prompt verlangt ausdrücklich die gewählte Sprache', () => {
  const de = S.buildSummaryPrompt(S.normalizeSettings({}));
  assert.match(de, /^Fasse dieses Video/);
  assert.match(de, /auf Deutsch/);
  assert.match(de, /ohne Aufzählungen/);

  const en = S.buildSummaryPrompt(S.normalizeSettings({ languageCode: 'en-US' }));
  assert.match(en, /^Summarize this video/);
  assert.match(en, /Respond in English/);

  const fr = S.buildSummaryPrompt(S.normalizeSettings({ languageCode: 'fr-FR' }));
  assert.match(fr, /Respond in French/);
});

test('buildSummaryPrompt: eigener Prompt hat Vorrang, Platzhalter werden ersetzt', () => {
  const s = S.normalizeSettings({ languageCode: 'de-DE', customPrompt: 'Kurz auf {sprache} ({language}), bitte. {SPRACHE}' });
  assert.equal(S.buildSummaryPrompt(s), 'Kurz auf Deutsch (German), bitte. Deutsch');
  assert.equal(S.buildSummaryPrompt({ languageCode: 'en-GB', customPrompt: '  Exakt so.  ' }), 'Exakt so.');
});
