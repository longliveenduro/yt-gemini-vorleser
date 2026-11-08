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

  // Version 2: längenabhängige Zusammenfassung; das Zeichenlimit steigt von 6000 auf 20000 (siehe migrate()).
  const SETTINGS_VERSION = 2;
  const LEGACY_MAX_CHARS = 6000;

  // Ist die Videolänge unbekannt (Livestream, gerade läuft Werbung), bittet der Prompt um so viele Wörter.
  const FALLBACK_WORDS = 300;
  const WORD_STEP = 25; // die gewünschte Wortzahl wird auf Vielfache davon gerundet („etwa 175 Wörter“)

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
    speechRules: true,
    summaryWords: 1000,
    summaryMinutes: 60,
    summaryMinWords: 100,
    summaryMaxWords: 2000,
    maxChars: 20000,
    askLabels: DEFAULT_ASK_LABELS.join(', '),
    summarizeKeywords: DEFAULT_SUMMARIZE_KEYWORDS.join(', '),
    askButtonSelector: '',
    panelSelector: '',
    responseTimeoutSec: 90,
    debug: false,
    settingsVersion: SETTINGS_VERSION,
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
    const summaryMinWords = num(r.summaryMinWords, d.summaryMinWords, 10, 20000, true);

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
      speechRules: typeof r.speechRules === 'boolean' ? r.speechRules : d.speechRules,
      summaryWords: num(r.summaryWords, d.summaryWords, 10, 20000, true),
      summaryMinutes: num(r.summaryMinutes, d.summaryMinutes, 1, 1440, true),
      summaryMinWords,
      summaryMaxWords: Math.max(summaryMinWords, num(r.summaryMaxWords, d.summaryMaxWords, 10, 20000, true)),
      maxChars: num(r.maxChars, d.maxChars, 500, 20000, true),
      askLabels: str(r.askLabels, '') || d.askLabels,
      summarizeKeywords: str(r.summarizeKeywords, '') || d.summarizeKeywords,
      askButtonSelector: str(r.askButtonSelector, d.askButtonSelector),
      panelSelector: str(r.panelSelector, d.panelSelector),
      responseTimeoutSec: num(r.responseTimeoutSec, d.responseTimeoutSec, 15, 300, true),
      debug: typeof r.debug === 'boolean' ? r.debug : d.debug,
      settingsVersion: SETTINGS_VERSION,
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
   * Gewünschte Länge der Zusammenfassung in Wörtern, abhängig von der Videolänge: summaryWords je summaryMinutes
   * Minuten, auf 25 gerundet und auf [summaryMinWords, summaryMaxWords] begrenzt. Ohne bekannte Länge: 300 Wörter
   * (ebenfalls begrenzt). Standard: 1000 Wörter je 60 Minuten, mindestens 100, höchstens 2000.
   */
  function targetWords(settings, durationSec) {
    const s = normalizeSettings(settings);
    const known = typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0;
    const raw = known ? (durationSec / 60) * (s.summaryWords / s.summaryMinutes) : FALLBACK_WORDS;
    const stepped = Math.round(raw / WORD_STEP) * WORD_STEP;
    return Math.min(s.summaryMaxWords, Math.max(s.summaryMinWords, stepped));
  }

  // Regeln, damit sich die Zusammenfassung gut vorlesen lässt. Sie werden in den Prompt eingebaut (und ersetzen im
  // eigenen Prompt den Platzhalter {regeln}). Die Markierung {en|Wort} wertet speech-markup.js aus. Alles in einer
  // Zeile: Der Prompt erscheint als Frage im Ask-Panel, und die Erkennung des Echos arbeitet zeilenweise.
  const SPEECH_RULES_DE =
    'Der Text wird vorgelesen. Schreibe buchstabierte Abkürzungen mit Bindestrichen (K-I, E-U, U-S-A, G-P-U), ' +
    'als Wort gesprochene normal (NASA, NATO). Übersetze Fachbegriffe aus Softwareentwicklung und künstlicher ' +
    'Intelligenz nicht, sondern verwende die englischen Originalbegriffe (Harness, Prompt, Pull Request, Agent, ' +
    'Token; nie „Programmgerüst“ oder „Eingabeaufforderung“). Kennzeichne nicht eingedeutschte fremdsprachige Wörter ' +
    'und Namen mit dem Sprachcode in geschweiften Klammern, z. B. {en|Harness}, {en|Pull Request}, {it|Di Gianantonio}.';

  const SPEECH_RULES_EN =
    'The text will be read aloud. Write abbreviations that are spelled out with hyphens between the letters ' +
    '(A-I, E-U, U-S-A, G-P-U) and abbreviations pronounced as words normally (NASA, NATO). Do not translate technical ' +
    'terms from software development and artificial intelligence; keep the original English terms (harness, prompt, ' +
    'pull request, agent, token). Mark foreign-language words and names that are not in the answer language and not in ' +
    'common use there by putting the language code in curly braces, e.g. {en|harness}, {it|Di Gianantonio}.';

  /**
   * Die Frage an Gemini. Ein eigener Prompt hat Vorrang; darin werden ersetzt: {sprache} (z. B. „Deutsch“),
   * {language} (z. B. „German“), {wörter} bzw. {words} (die aus der Videolänge berechnete Wortzahl) und {regeln}
   * bzw. {rules} (die Vorlese-Regeln, leer bei ausgeschalteten Regeln). Ohne eigenen Prompt wird die Zielsprache
   * ausdrücklich verlangt und die Länge in Wörtern genannt. context.durationSec ist die Videolänge in Sekunden.
   */
  function buildSummaryPrompt(settings, context) {
    const info = languageInfo(settings.languageCode);
    const german = primaryLanguage(settings.languageCode) === 'de';
    const words = targetWords(settings, context && context.durationSec);
    const rules = settings.speechRules === false ? '' : german ? SPEECH_RULES_DE : SPEECH_RULES_EN;
    const custom = String(settings.customPrompt || '').trim();
    if (custom) {
      return custom
        .replace(/\{sprache\}/gi, () => info.name)
        .replace(/\{language\}/gi, () => info.english)
        .replace(/\{(?:wörter|woerter|words)\}/gi, () => String(words))
        .replace(/\{(?:regeln|rules)\}/gi, () => rules)
        .trim();
    }
    const base = german
      ? `Fasse dieses Video auf Deutsch zusammen, in etwa ${words} Wörtern. Antworte als zusammenhängender Fließtext ohne Aufzählungen, Überschriften und Zeitangaben.`
      : `Summarize this video in about ${words} words. Respond in ${info.english} as continuous prose, without bullet points, headings or timestamps.`;
    return rules ? `${base} ${rules}` : base;
  }

  /** "a, b\nc" → ['a', 'b', 'c'] */
  function parseList(value) {
    return String(value || '')
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /**
   * Gespeicherte Einstellungen älterer Versionen anpassen. Bis Version 1.1 war 6000 Zeichen der Standard für die
   * maximale Länge; das schneidet die längeren, von der Videolänge abhängigen Zusammenfassungen ab. Dieser alte
   * Standardwert gilt deshalb als „nie geändert“ und wird durch den neuen ersetzt. Gespeichert wird die Version mit
   * (normalizeSettings), eine später bewusst gewählte 6000 bleibt also erhalten.
   */
  function migrate(raw) {
    if (!raw || typeof raw !== 'object' || Number(raw.settingsVersion) >= SETTINGS_VERSION) return raw;
    const migrated = { ...raw };
    if (Number(migrated.maxChars) === LEGACY_MAX_CHARS) delete migrated.maxChars;
    return migrated;
  }

  async function loadSettings(storageArea) {
    const { settings } = await storageArea.get('settings');
    return normalizeSettings(migrate(settings));
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
    targetWords,
    migrate,
    SETTINGS_VERSION,
    loadSettings,
    saveSettings,
  };
});
