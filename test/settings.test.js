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
  // Länge der Zusammenfassung: 1000 Wörter je 60 Minuten, mindestens 100, höchstens 2000
  assert.equal(s.summaryWords, 1000);
  assert.equal(s.summaryMinutes, 60);
  assert.equal(s.summaryMinWords, 100);
  assert.equal(s.summaryMaxWords, 2000);
  assert.equal(s.speechRules, true);
  assert.equal(s.maxChars, 20000);
  assert.equal(s.settingsVersion, S.SETTINGS_VERSION);
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

test('normalizeSettings begrenzt die Längeneinstellungen und hält Höchstwert ≥ Mindestwert', () => {
  const n = (o) => S.normalizeSettings(o);
  assert.equal(n({ summaryWords: 1 }).summaryWords, 10);
  assert.equal(n({ summaryWords: 99999 }).summaryWords, 20000);
  assert.equal(n({ summaryWords: '750,6' }).summaryWords, 751);
  assert.equal(n({ summaryWords: 'abc' }).summaryWords, 1000);
  assert.equal(n({ summaryMinutes: 0 }).summaryMinutes, 1);
  assert.equal(n({ summaryMinutes: 99999 }).summaryMinutes, 1440);
  assert.equal(n({ summaryMinWords: 1 }).summaryMinWords, 10);
  // Höchstwert unter dem Mindestwert wird auf den Mindestwert angehoben
  const swapped = n({ summaryMinWords: 400, summaryMaxWords: 200 });
  assert.equal(swapped.summaryMinWords, 400);
  assert.equal(swapped.summaryMaxWords, 400);
  assert.equal(n({ summaryMinWords: 150, summaryMaxWords: 3000 }).summaryMaxWords, 3000);
  // speechRules: nur echte Booleans
  assert.equal(n({ speechRules: false }).speechRules, false);
  assert.equal(n({ speechRules: 'nein' }).speechRules, true);
});

test('targetWords: Standard ist 1000 Wörter je 60 Minuten, auf 25 gerundet und auf 100 bis 2000 begrenzt', () => {
  const s = S.normalizeSettings({});
  const words = (minutes) => S.targetWords(s, minutes * 60);
  assert.equal(words(1), 100); // Minimum
  assert.equal(words(5), 100); // 83 → 75 → Minimum
  assert.equal(words(8), 125); // 133,3 → 125
  assert.equal(words(10), 175); // 166,7 → 175
  assert.equal(words(15), 250);
  assert.equal(words(20), 325); // 333,3 → 325
  assert.equal(words(30), 500);
  assert.equal(words(45), 750);
  assert.equal(words(60), 1000);
  assert.equal(words(90), 1500);
  assert.equal(words(120), 2000);
  assert.equal(words(180), 2000); // Maximum
  assert.equal(words(600), 2000);
});

test('targetWords: eigene Verhältnisse und Grenzen', () => {
  const s = S.normalizeSettings({ summaryWords: 500, summaryMinutes: 10, summaryMinWords: 200, summaryMaxWords: 1500 });
  assert.equal(S.targetWords(s, 600), 500);
  assert.equal(S.targetWords(s, 60), 200); // 50 → Minimum
  assert.equal(S.targetWords(s, 3600), 1500); // 3000 → Maximum
  // Rundung kann Grenzen nicht überschreiten, auch wenn sie keine Vielfachen von 25 sind
  const odd = S.normalizeSettings({ summaryMinWords: 110, summaryMaxWords: 130 });
  assert.equal(S.targetWords(odd, 5 * 60), 110);
  assert.equal(S.targetWords(odd, 60 * 60), 130);
});

test('targetWords: ohne bekannte Videolänge werden 300 Wörter (im Rahmen der Grenzen) angefragt', () => {
  const s = S.normalizeSettings({});
  for (const unknown of [undefined, null, 0, -5, NaN, Infinity, '600', {}]) assert.equal(S.targetWords(s, unknown), 300, String(unknown));
  assert.equal(S.targetWords(S.normalizeSettings({ summaryMaxWords: 200 }), null), 200);
  assert.equal(S.targetWords(S.normalizeSettings({ summaryMinWords: 500, summaryMaxWords: 900 }), null), 500);
  // auch unvollständige Einstellungen funktionieren (Standardwerte werden ergänzt)
  assert.equal(S.targetWords({}, 1800), 500);
});

test('buildSummaryPrompt: nennt die aus der Videolänge berechnete Wortzahl', () => {
  const s = S.normalizeSettings({});
  assert.match(S.buildSummaryPrompt(s, { durationSec: 30 * 60 }), /auf Deutsch zusammen, in etwa 500 Wörtern\./);
  assert.match(S.buildSummaryPrompt(s, { durationSec: 3 * 3600 }), /in etwa 2000 Wörtern\./);
  assert.match(S.buildSummaryPrompt(s, { durationSec: 4 * 60 }), /in etwa 100 Wörtern\./);
  assert.match(S.buildSummaryPrompt(s), /in etwa 300 Wörtern\./); // Länge unbekannt
  assert.match(S.buildSummaryPrompt(s, {}), /in etwa 300 Wörtern\./);
  const en = S.buildSummaryPrompt(S.normalizeSettings({ languageCode: 'en-US' }), { durationSec: 3600 });
  assert.match(en, /^Summarize this video in about 1000 words\. Respond in English as continuous prose/);
});

test('buildSummaryPrompt: Vorlese-Regeln – Abkürzungen buchstabieren, Fachbegriffe nicht übersetzen, Fremdwörter markieren', () => {
  const de = S.buildSummaryPrompt(S.normalizeSettings({}), { durationSec: 600 });
  assert.match(de, /Abkürzungen mit Bindestrichen \(K-I, E-U, U-S-A, G-P-U\)/);
  assert.match(de, /als Wort gesprochene normal \(NASA, NATO\)/);
  assert.match(de, /Übersetze Fachbegriffe aus Softwareentwicklung und künstlicher Intelligenz nicht/);
  assert.match(de, /englischen Originalbegriffe \(Harness, Prompt, Pull Request/);
  assert.match(de, /nie „Programmgerüst“/);
  assert.match(de, /\{en\|Harness\}.*\{it\|Di Gianantonio\}/);
  assert.doesNotMatch(de, /\n/, 'alles in einer Zeile (das Ask-Panel zeigt die Frage als einen Block, die Echo-Erkennung arbeitet zeilenweise)');
  assert.ok(de.length < 900, `Prompt bleibt handlich (${de.length} Zeichen)`);

  const en = S.buildSummaryPrompt(S.normalizeSettings({ languageCode: 'fr-FR' }), { durationSec: 600 });
  assert.match(en, /\(A-I, E-U, U-S-A, G-P-U\)/);
  assert.match(en, /keep the original English terms/);
  assert.match(en, /\{en\|harness\}/);
  assert.doesNotMatch(en, /Abkürzungen/);
});

test('buildSummaryPrompt: ohne Vorlese-Regeln steht nur die Aufforderung im Prompt', () => {
  const off = S.buildSummaryPrompt(S.normalizeSettings({ speechRules: false }), { durationSec: 1800 });
  assert.equal(off, 'Fasse dieses Video auf Deutsch zusammen, in etwa 500 Wörtern. Antworte als zusammenhängender Fließtext ohne Aufzählungen, Überschriften und Zeitangaben.');
  const en = S.buildSummaryPrompt(S.normalizeSettings({ languageCode: 'en-US', speechRules: false }), { durationSec: 1800 });
  assert.equal(en, 'Summarize this video in about 500 words. Respond in English as continuous prose, without bullet points, headings or timestamps.');
});

test('buildSummaryPrompt: eigener Prompt – {wörter} und {regeln} werden ersetzt, ohne Platzhalter nichts angehängt', () => {
  const custom = (customPrompt, extra) => S.normalizeSettings({ customPrompt, ...extra });
  const words = S.buildSummaryPrompt(custom('Fasse auf {sprache} in {wörter} Wörtern zusammen ({WORDS}, {woerter}).'), { durationSec: 1800 });
  assert.equal(words, 'Fasse auf Deutsch in 500 Wörtern zusammen (500, 500).');

  const withRules = S.buildSummaryPrompt(custom('Kurz bitte. {regeln}'), { durationSec: 600 });
  assert.match(withRules, /^Kurz bitte\. Der Text wird vorgelesen\. Schreibe buchstabierte Abkürzungen/);
  assert.match(S.buildSummaryPrompt(custom('Short. {RULES}', { languageCode: 'en-US' })), /^Short\. The text will be read aloud\./);

  // ausgeschaltete Regeln: der Platzhalter verschwindet, die Ränder werden gekürzt
  assert.equal(S.buildSummaryPrompt(custom('Kurz bitte. {regeln}', { speechRules: false })), 'Kurz bitte.');
  // ohne Platzhalter bleibt der eigene Prompt genau wie geschrieben (keine versteckten Anhänge)
  assert.equal(S.buildSummaryPrompt(custom('Nur das hier.'), { durationSec: 600 }), 'Nur das hier.');
});

test('loadSettings: der frühere Standard von 6000 Zeichen wird durch den neuen ersetzt (nur einmal, bis gespeichert wird)', async () => {
  const data = { settings: { apiKey: 'K', maxChars: 6000 } }; // Stand von Version 1.1.x
  const storage = { get: async (key) => ({ [key]: data[key] }), set: async (obj) => Object.assign(data, obj) };
  assert.equal((await S.loadSettings(storage)).maxChars, 20000);

  // ein anderer Wert aus der alten Version bleibt erhalten
  data.settings = { apiKey: 'K', maxChars: 4000 };
  assert.equal((await S.loadSettings(storage)).maxChars, 4000);

  // wird ab Version 2 bewusst 6000 gewählt und gespeichert, bleibt es dabei
  data.settings = { apiKey: 'K', maxChars: 4000 };
  await S.saveSettings(storage, { apiKey: 'K', maxChars: 6000 });
  assert.equal(data.settings.settingsVersion, S.SETTINGS_VERSION);
  assert.equal((await S.loadSettings(storage)).maxChars, 6000);
});

test('migrate lässt neuere oder leere Einstellungen unangetastet', () => {
  assert.equal(S.migrate(undefined), undefined);
  assert.equal(S.migrate(null), null);
  const current = { maxChars: 6000, settingsVersion: S.SETTINGS_VERSION };
  assert.equal(S.migrate(current), current);
  assert.deepEqual(S.migrate({ maxChars: 6000 }), {});
  assert.deepEqual(S.migrate({ maxChars: '6000', other: 1 }), { other: 1 });
});
