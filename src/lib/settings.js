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

  // Sprachen für Zusammenfassung (Prompt an Gemini) und Sprachausgabe. name = Eigenbezeichnung, english = englischer Name.
  const LANGUAGES = Object.freeze([
    { code: 'de-DE', label: 'Deutsch', name: 'Deutsch', english: 'German' },
    { code: 'en-US', label: 'English (US)', name: 'English', english: 'English' },
    { code: 'en-GB', label: 'English (UK)', name: 'English', english: 'English' },
    { code: 'fr-FR', label: 'Français', name: 'Français', english: 'French' },
    { code: 'es-ES', label: 'Español', name: 'Español', english: 'Spanish' },
    { code: 'it-IT', label: 'Italiano', name: 'Italiano', english: 'Italian' },
    { code: 'nl-NL', label: 'Nederlands', name: 'Nederlands', english: 'Dutch' },
    { code: 'pl-PL', label: 'Polski', name: 'Polski', english: 'Polish' },
    { code: 'pt-BR', label: 'Português (Brasil)', name: 'Português', english: 'Portuguese' },
    { code: 'ru-RU', label: 'Русский', name: 'Русский', english: 'Russian' },
    { code: 'tr-TR', label: 'Türkçe', name: 'Türkçe', english: 'Turkish' },
    { code: 'ja-JP', label: '日本語', name: '日本語', english: 'Japanese' },
    { code: 'ko-KR', label: '한국어', name: '한국어', english: 'Korean' },
    { code: 'cmn-CN', label: '中文 (普通话)', name: '中文', english: 'Chinese' },
  ]);

  const REQUEST_MODES = ['prompt', 'chip'];

  const DEFAULT_SETTINGS = Object.freeze({
    apiKey: '',
    languageCode: 'de-DE',
    voiceName: 'de-DE-Neural2-B',
    speakingRate: 1,
    audioEncoding: 'OGG_OPUS',
    requestMode: 'prompt',
    pauseVideo: true,
    pageButton: true,
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
      requestMode: REQUEST_MODES.includes(r.requestMode) ? r.requestMode : d.requestMode,
      pauseVideo: typeof r.pauseVideo === 'boolean' ? r.pauseVideo : d.pauseVideo,
      pageButton: typeof r.pageButton === 'boolean' ? r.pageButton : d.pageButton,
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

  /** "de-DE" → "de" */
  function primaryLanguage(code) {
    return String(code || '').toLowerCase().split('-')[0];
  }

  /** Infos zu einem Sprachcode; unbekannte Codes werden über die Hauptsprache zugeordnet. */
  function languageInfo(code) {
    const wanted = String(code || '').toLowerCase();
    const exact = LANGUAGES.find((l) => l.code.toLowerCase() === wanted);
    if (exact) return exact;
    const byPrimary = LANGUAGES.find((l) => primaryLanguage(l.code) === primaryLanguage(code));
    if (byPrimary) return { ...byPrimary, code };
    return { code, label: code, name: code, english: code };
  }

  /**
   * Die Frage an Gemini. Ein eigener Prompt hat Vorrang; darin werden {sprache} (z. B. „Deutsch“) und
   * {language} (z. B. „German“) ersetzt. Ohne eigenen Prompt wird die Zielsprache ausdrücklich verlangt.
   */
  function buildSummaryPrompt(settings) {
    const info = languageInfo(settings.languageCode);
    const custom = String(settings.customPrompt || '').trim();
    if (custom) return custom.replace(/\{sprache\}/gi, info.name).replace(/\{language\}/gi, info.english);
    if (primaryLanguage(settings.languageCode) === 'de') {
      return 'Fasse dieses Video in wenigen Sätzen auf Deutsch zusammen. Antworte als zusammenhängender Fließtext ohne Aufzählungen, Überschriften und Zeitangaben.';
    }
    return `Summarize this video in a few sentences. Respond in ${info.english} as continuous prose, without bullet points, headings or timestamps.`;
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
    REQUEST_MODES,
    LANGUAGES,
    normalizeSettings,
    primaryLanguage,
    languageInfo,
    buildSummaryPrompt,
    parseList,
    loadSettings,
    saveSettings,
  };
});
