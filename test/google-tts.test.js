'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const tts = require('../src/lib/google-tts.js');
const { normalizeSettings } = require('../src/lib/settings.js');

const settings = normalizeSettings({ apiKey: 'KEY123', voiceName: 'de-DE-Neural2-B', speakingRate: 1.2, audioEncoding: 'OGG_OPUS' });

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('buildSynthesizeRequest erzeugt den erwarteten Körper', () => {
  assert.deepEqual(tts.buildSynthesizeRequest({ text: 'Hallo', settings }), {
    input: { text: 'Hallo' },
    voice: { languageCode: 'de-DE', name: 'de-DE-Neural2-B' },
    audioConfig: { audioEncoding: 'OGG_OPUS', speakingRate: 1.2 },
  });
});

test('buildSynthesizeRequest leitet die Sprache aus dem Stimmennamen ab (verhindert Sprach-/Stimmen-Konflikt)', () => {
  const s = normalizeSettings({ languageCode: 'en-US', voiceName: 'de-DE-Wavenet-F' });
  assert.equal(tts.buildSynthesizeRequest({ text: 'x', settings: s }).voice.languageCode, 'de-DE');
  assert.equal(tts.localeOf('cmn-CN-Wavenet-A', 'x'), 'cmn-CN');
  assert.equal(tts.localeOf('en-US-Chirp3-HD-Aoede', 'x'), 'en-US');
  assert.equal(tts.localeOf('', 'fr-FR'), 'fr-FR');
});

test('buildSynthesizeRequest lässt den Stimmennamen bei leerer Stimme weg', () => {
  const s = normalizeSettings({ languageCode: 'fr-FR', voiceName: '' });
  assert.deepEqual(tts.buildSynthesizeRequest({ text: 'x', settings: s }).voice, { languageCode: 'fr-FR' });
});

test('synthesize sendet den Key im Header (nicht in der URL) und gibt audioContent zurück', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return jsonResponse(200, { audioContent: 'QUJD' });
  };
  const audio = await tts.synthesize({ text: 'Hallo', settings, fetchImpl });
  assert.equal(audio, 'QUJD');
  assert.equal(seen.url, 'https://texttospeech.googleapis.com/v1/text:synthesize');
  assert.ok(!seen.url.includes('KEY123'));
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['X-Goog-Api-Key'], 'KEY123');
  assert.equal(JSON.parse(seen.init.body).input.text, 'Hallo');
});

test('synthesize übersetzt typische API-Fehler in verständliche Meldungen', async () => {
  const cases = [
    [400, { error: { message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } }, 'API_KEY_INVALID', /API-Key ist ungültig/],
    [403, { error: { message: 'Cloud Text-to-Speech API has not been used in project 1 before or it is disabled.', details: [{ reason: 'SERVICE_DISABLED' }] } }, 'API_DISABLED', /nicht aktiviert/],
    [403, { error: { message: 'This API method requires billing to be enabled.' } }, 'BILLING', /Abrechnung/],
    [403, { error: { message: 'Requests from this referrer are blocked.' } }, 'PERMISSION', /Einschränkungen/],
    [429, { error: { message: 'Quota exceeded' } }, 'QUOTA', /Kontingent/],
    [400, { error: { message: 'Voice does not exist' } }, 'BAD_REQUEST', /Voice does not exist/],
    [503, null, 'SERVER', /vorübergehend/],
  ];
  for (const [status, body, code, pattern] of cases) {
    const fetchImpl = async () => jsonResponse(status, body);
    await assert.rejects(tts.synthesize({ text: 'x', settings, fetchImpl }), (e) => {
      assert.equal(e.code, code);
      assert.match(e.message, pattern);
      return true;
    });
  }
});

test('synthesize meldet Netzwerkfehler verständlich, reicht Abbrüche aber unverändert durch', async () => {
  await assert.rejects(
    tts.synthesize({ text: 'x', settings, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }),
    (e) => e.code === 'NETWORK' && /Verbindung/.test(e.message),
  );
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  await assert.rejects(tts.synthesize({ text: 'x', settings, fetchImpl: async () => { throw abort; } }), (e) => e.name === 'AbortError');
});

test('synthesize erkennt leere Antworten', async () => {
  await assert.rejects(
    tts.synthesize({ text: 'x', settings, fetchImpl: async () => jsonResponse(200, {}) }),
    (e) => e.code === 'EMPTY_AUDIO',
  );
});

test('listVoices sortiert nach Qualität und liefert Typ und Geschlecht', async () => {
  let seenUrl;
  const fetchImpl = async (url) => {
    seenUrl = url;
    return jsonResponse(200, {
      voices: [
        { name: 'de-DE-Standard-A', ssmlGender: 'FEMALE' },
        { name: 'de-DE-Neural2-B', ssmlGender: 'MALE' },
        { name: 'de-DE-Chirp3-HD-Charon', ssmlGender: 'MALE' },
        { name: 'de-DE-Wavenet-F', ssmlGender: 'FEMALE' },
        { bogus: true },
      ],
    });
  };
  const voices = await tts.listVoices({ apiKey: 'K', languageCode: 'de-DE', fetchImpl });
  assert.equal(seenUrl, 'https://texttospeech.googleapis.com/v1/voices?languageCode=de-DE');
  assert.deepEqual(voices.map((v) => v.name), ['de-DE-Chirp3-HD-Charon', 'de-DE-Neural2-B', 'de-DE-Wavenet-F', 'de-DE-Standard-A']);
  assert.equal(voices[0].type, 'Chirp3-HD');
  assert.equal(voices[1].gender, 'MALE');
});
