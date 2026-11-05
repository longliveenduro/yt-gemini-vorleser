/*
 * Einstellungen: Standardwerte, Validierung und Zugriff auf chrome.storage.
 * UMD: läuft als klassisches Skript in der Erweiterung (YTGR.settings) und per require() in den Tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.YTGR = root.YTGR || {}).settings = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // Beschriftungen des „Ask“-Buttons unter dem Video (Vergleich ohne Groß-/Kleinschreibung, exakt).
  const DEFAULT_ASK_LABELS = [
    'Ask', 'Ask about this video', 'Ask Gemini', 'Ask YouTube',
    'Fragen', 'Frage stellen', 'Gemini fragen', 'YouTube fragen', 'Zum Video fragen',
    'Preguntar', 'Demander', 'Chiedi', 'Perguntar', 'Vragen', 'Zapytaj',
    'Спросить', '質問', '질문하기', '询问',
  ];

  // Stichwörter der Vorschlags-Schaltfläche „Summarize the video“ (Teilstring-Vergleich).
  const DEFAULT_SUMMARIZE_KEYWORDS = [
    'summar', 'zusammenfass', 'résum', 'resum', 'riassum', 'samenvat', 'podsumuj',
    'резюм', 'суммир', '要約', '요약', '总结', '總結',
  ];

  const DEFAULT_SETTINGS = Object.freeze({
    apiKey: '',
    languageCode: 'de-DE',
    voiceName: 'de-DE-Neural2-B',
    speakingRate: 1,
    audioEncoding: 'OGG_OPUS',
    pauseVideo: true,
    customPrompt: '',
    maxChars: 6000,
    askLabels: DEFAULT_ASK_LABELS.join(', '),
    summarizeKeywords: DEFAULT_SUMMARIZE_KEYWORDS.join(', '),
    askButtonSelector: '',
    panelSelector: '',
    responseTimeoutSec: 90,
    debug: false,
  });

  const AUDIO_ENCODINGS = ['OGG_OPUS', 'MP3'];

  function str(value, fallback) {
    return typeof value === 'string' ? value.trim() : fallback;
  }

  function num(value, fallback, min, max, integer) {
    let n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) n = fallback;
    n = Math.min(max, Math.max(min, n));
    return integer ? Math.round(n) : n;
  }

  /** Ergänzt fehlende Werte, korrigiert ungültige und begrenzt Zahlenbereiche. */
  function normalizeSettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = DEFAULT_SETTINGS;

    const languageCode = str(r.languageCode, d.languageCode);
    const voiceName = str(r.voiceName, d.voiceName);

    return {
      apiKey: str(r.apiKey, d.apiKey),
      languageCode: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(languageCode) ? languageCode : d.languageCode,
      voiceName: /^[A-Za-z0-9-]*$/.test(voiceName) ? voiceName : d.voiceName,
      speakingRate: num(r.speakingRate, d.speakingRate, 0.5, 2, false),
      audioEncoding: AUDIO_ENCODINGS.includes(r.audioEncoding) ? r.audioEncoding : d.audioEncoding,
      pauseVideo: typeof r.pauseVideo === 'boolean' ? r.pauseVideo : d.pauseVideo,
      customPrompt: str(r.customPrompt, d.customPrompt),
      maxChars: num(r.maxChars, d.maxChars, 500, 20000, true),
      askLabels: str(r.askLabels, '') || d.askLabels,
      summarizeKeywords: str(r.summarizeKeywords, '') || d.summarizeKeywords,
      askButtonSelector: str(r.askButtonSelector, d.askButtonSelector),
      panelSelector: str(r.panelSelector, d.panelSelector),
      responseTimeoutSec: num(r.responseTimeoutSec, d.responseTimeoutSec, 15, 300, true),
      debug: typeof r.debug === 'boolean' ? r.debug : d.debug,
    };
  }

  /** "a, b\nc" → ['a', 'b', 'c'] */
  function parseList(value) {
    return String(value || '')
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function loadSettings(storageArea) {
    const { settings } = await storageArea.get('settings');
    return normalizeSettings(settings);
  }

  async function saveSettings(storageArea, settings) {
    const normalized = normalizeSettings(settings);
    await storageArea.set({ settings: normalized });
    return normalized;
  }

  return {
    DEFAULT_SETTINGS,
    DEFAULT_ASK_LABELS,
    DEFAULT_SUMMARIZE_KEYWORDS,
    AUDIO_ENCODINGS,
    normalizeSettings,
    parseList,
    loadSettings,
    saveSettings,
  };
});
