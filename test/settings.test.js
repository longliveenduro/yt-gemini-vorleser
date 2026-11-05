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
