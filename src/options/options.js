/*
 * Optionsseite: Einstellungen laden/speichern, Stimmen der Sprache abrufen, Stimme testen.
 */
(function () {
  'use strict';

  const Settings = YTGR.settings;
  const Tts = YTGR.googleTts;
  const $ = (id) => document.getElementById(id);

  const FIELDS = [
    'apiKey', 'languageCode', 'requestMode', 'voiceName', 'speakingRate', 'audioEncoding', 'pauseVideo', 'pageButton',
    'customPrompt', 'speechRules', 'summaryWords', 'summaryMinutes', 'summaryMinWords', 'summaryMaxWords', 'maxChars',
    'askLabels', 'summarizeKeywords', 'askButtonSelector', 'panelSelector', 'responseTimeoutSec', 'debug',
  ];
  const LENGTH_FIELDS = ['summaryWords', 'summaryMinutes', 'summaryMinWords', 'summaryMaxWords'];
  const EXAMPLE_MINUTES = [10, 30, 60, 120];

  const GENDER = { MALE: 'männlich', FEMALE: 'weiblich', NEUTRAL: 'neutral' };

  const SAMPLES = {
    de: 'Hallo! Dies ist ein Test der Google-Sprachausgabe.',
    en: 'Hello! This is a test of the Google voice output.',
    fr: 'Bonjour ! Ceci est un test de la synthèse vocale de Google.',
    es: '¡Hola! Esta es una prueba de la voz de Google.',
    it: 'Ciao! Questa è una prova della voce di Google.',
    nl: 'Hallo! Dit is een test van de Google-spraakuitvoer.',
    pl: 'Cześć! To jest test mowy Google.',
    pt: 'Olá! Este é um teste da voz do Google.',
    ru: 'Привет! Это проверка голоса Google.',
  };

  function setStatus(el, text, kind) {
    el.textContent = text;
    el.classList.remove('ok', 'bad');
    if (kind) el.classList.add(kind);
  }

  function updateRate() {
    $('rateOut').textContent = Number($('speakingRate').value).toFixed(2).replace('.', ',');
  }

  /** Sprachauswahl aus der Liste in settings.js aufbauen. */
  function fillLanguages() {
    const select = $('languageCode');
    for (const language of Settings.LANGUAGES) {
      const option = document.createElement('option');
      option.value = language.code;
      option.textContent = language.label;
      select.appendChild(option);
    }
  }

  /** Ein gespeicherter Sprachcode, der nicht in der Liste steht, bleibt als eigene Option erhalten. */
  function ensureLanguageOption(code) {
    const select = $('languageCode');
    if ([...select.options].some((o) => o.value === code)) return;
    const option = document.createElement('option');
    option.value = code;
    option.textContent = code;
    select.appendChild(option);
  }

  /** Beispielzeile unter der Längeneinstellung: Wortzahl für 10, 30, 60 und 120 Minuten Video. */
  function updateLengthExample() {
    const settings = read();
    const duration = (minutes) => (minutes % 60 === 0 ? `${minutes / 60} ${minutes === 60 ? 'Stunde' : 'Stunden'}` : `${minutes} Minuten`);
    const parts = EXAMPLE_MINUTES.map((minutes, i) => {
      const words = Settings.targetWords(settings, minutes * 60).toLocaleString('de-DE');
      return `${duration(minutes)}${i === 0 ? ' Video' : ''} → ${words} Wörter`;
    });
    $('lengthExample').textContent = `Beispiele: ${parts.join(', ')}. Vorgelesen dauern 150 Wörter etwa eine Minute.`;
  }

  function fill(settings) {
    ensureLanguageOption(settings.languageCode);
    for (const key of FIELDS) {
      const el = $(key);
      if (el.type === 'checkbox') el.checked = Boolean(settings[key]);
      else el.value = String(settings[key]);
    }
    updateRate();
    updateLengthExample();
  }

  function read() {
    const raw = {};
    for (const key of FIELDS) {
      const el = $(key);
      raw[key] = el.type === 'checkbox' ? el.checked : el.value;
    }
    return Settings.normalizeSettings(raw);
  }

  async function save(event) {
    event.preventDefault();
    const saved = await Settings.saveSettings(chrome.storage.local, read());
    fill(saved);
    setStatus($('saveStatus'), 'Gespeichert.', 'ok');
    setTimeout(() => setStatus($('saveStatus'), ''), 3000);
  }

  /** Nach einem Sprachwechsel passt die bisherige Stimme evtl. nicht mehr. */
  function onLanguageChange() {
    const language = $('languageCode').value;
    const voice = $('voiceName').value.trim();
    const german = Settings.primaryLanguage(language) === 'de';
    const voiceLocale = Tts.localeOf(voice, null);
    const mismatch = voice && voiceLocale && Settings.primaryLanguage(voiceLocale) !== Settings.primaryLanguage(language);
    if (mismatch || (!voice && german)) {
      $('voiceName').value = german ? Settings.DEFAULT_SETTINGS.voiceName : '';
      setStatus(
        $('voicesStatus'),
        german
          ? 'Stimme auf die Standardstimme für Deutsch gesetzt.'
          : 'Stimme zurückgesetzt (Standardstimme der Sprache). „Stimmen laden“ zeigt passende Stimmen.',
      );
    }
  }

  async function loadVoices() {
    const settings = read();
    const status = $('voicesStatus');
    if (!settings.apiKey) {
      setStatus(status, 'Trage zuerst den API-Key ein.', 'bad');
      return;
    }
    setStatus(status, 'Lade Stimmen …');
    try {
      const voices = await Tts.listVoices({
        apiKey: settings.apiKey,
        languageCode: settings.languageCode,
        fetchImpl: (...args) => fetch(...args),
      });
      const list = $('voices');
      list.textContent = '';
      for (const v of voices) {
        const option = document.createElement('option');
        option.value = v.name;
        option.label = `${v.type} · ${GENDER[v.gender] || v.gender}`;
        list.appendChild(option);
      }
      if (voices.length) setStatus(status, `${voices.length} Stimmen geladen – klicke in das Feld „Stimme“, um sie zu sehen.`, 'ok');
      else setStatus(status, 'Für diese Sprache wurden keine Stimmen gefunden.', 'bad');
    } catch (e) {
      setStatus(status, e.message || String(e), 'bad');
    }
  }

  async function testVoice() {
    const settings = read();
    const status = $('testStatus');
    const button = $('test');
    button.disabled = true;
    setStatus(status, 'Erzeuge Sprache …');
    try {
      const sample = SAMPLES[settings.languageCode.slice(0, 2)] || SAMPLES.en;
      const res = await chrome.runtime.sendMessage({ type: 'YTGR_SPEAK', source: 'options', text: sample, settings });
      if (!res || !res.ok) {
        setStatus(status, (res && res.message) || 'Test fehlgeschlagen.', 'bad');
        button.disabled = false;
      }
    } catch (e) {
      setStatus(status, e.message || String(e), 'bad');
      button.disabled = false;
    }
  }

  // Ergebnis des Tests kommt asynchron vom Offscreen-Dokument (nur Meldungen ohne Tab-Bezug).
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'YTGR_TTS_STATUS' || msg.target !== 'background' || msg.tabId != null) return;
    const status = $('testStatus');
    if (msg.phase === 'speaking') {
      setStatus(status, 'Wiedergabe läuft …', 'ok');
    } else if (msg.phase === 'done' || msg.phase === 'stopped') {
      setStatus(status, 'Test beendet.', 'ok');
      $('test').disabled = false;
    } else if (msg.phase === 'error') {
      setStatus(status, msg.message || 'Fehler bei der Wiedergabe.', 'bad');
      $('test').disabled = false;
    }
  });

  $('languageCode').addEventListener('change', onLanguageChange);
  $('speakingRate').addEventListener('input', updateRate);
  for (const id of LENGTH_FIELDS) $(id).addEventListener('input', updateLengthExample);
  $('toggleKey').addEventListener('click', () => {
    const input = $('apiKey');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('toggleKey').textContent = show ? 'Verbergen' : 'Anzeigen';
    $('toggleKey').setAttribute('aria-pressed', String(show));
  });
  $('form').addEventListener('submit', save);
  $('reset').addEventListener('click', () => {
    fill({ ...Settings.DEFAULT_SETTINGS, apiKey: $('apiKey').value });
    setStatus($('saveStatus'), 'Standardwerte geladen – zum Übernehmen speichern.');
  });
  $('loadVoices').addEventListener('click', loadVoices);
  $('test').addEventListener('click', testVoice);

  fillLanguages();
  Settings.loadSettings(chrome.storage.local).then(fill);
})();
