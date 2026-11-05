/*
 * Der Ablauf nach dem Klick auf das Erweiterungs-Symbol (läuft im Content-Script):
 *  1. prüfen: Video-Seite, API-Key vorhanden
 *  2. „Ask“-Button finden und klicken – fehlt er: Diagnose (Geofencing → VPN-Hinweis in die USA)
 *  3. „Video zusammenfassen“ anklicken (oder eigenen Prompt eintippen)
 *  4. Antwort abwarten (Text ändert sich eine Weile nicht mehr), bereinigen
 *  5. an den Hintergrunddienst zum Vorlesen übergeben
 * Alle Abhängigkeiten werden übergeben, damit der Ablauf mit jsdom getestet werden kann.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./text.js'), require('./youtube-dom.js'), require('./messages.js'), require('./settings.js'));
  } else {
    const ns = (root.YTGR = root.YTGR || {});
    ns.runner = factory(ns.text, ns.dom, ns.messages, ns.settings);
  }
})(typeof self !== 'undefined' ? self : globalThis, function (text, dom, messages, settingsLib) {
  'use strict';

  const DEFAULT_TIMING = {
    pollMs: 250,
    pageReadyTimeoutMs: 15000,
    askButtonTimeoutMs: 6000,
    panelTimeoutMs: 8000,
    chipTimeoutMs: 6000,
    stableMs: 3000,
    minAnswerChars: 40,
  };

  const DEFAULT_PROMPT =
    'Fasse dieses Video in wenigen Sätzen zusammen. Antworte als Fließtext ohne Aufzählungen und ohne Zeitangaben.';

  // Bei diesen Fehlern hilft eine Momentaufnahme der Seite bei der Fehlersuche.
  const DIAGNOSE_CODES = new Set(['GEOFENCE', 'NOT_AVAILABLE', 'PANEL_NOT_FOUND', 'NO_PROMPT_TARGET', 'NO_ANSWER', 'PAGE_NOT_READY']);

  class UserError extends Error {
    constructor(code, params) {
      super(code);
      this.code = code;
      this.params = params || {};
    }
  }

  class AbortedError extends Error {}

  function createRunner(deps) {
    const { document, location, getSettings, send, ui } = deps;
    const t = Object.assign({}, DEFAULT_TIMING, deps.timing);
    const now = deps.now || Date.now;
    const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const log = deps.log || ((...args) => console.info('[YTGR]', ...args));

    let busy = false;
    let aborted = false;

    function checkAborted() {
      if (aborted) throw new AbortedError('abgebrochen');
    }

    async function waitFor(fn, timeoutMs) {
      const start = now();
      for (;;) {
        checkAborted();
        const value = fn();
        if (value) return value;
        if (now() - start >= timeoutMs) return null;
        await sleep(t.pollMs);
      }
    }

    /** Wartet, bis neuer Antworttext erscheint und sich eine Weile nicht mehr ändert. */
    async function waitForAnswer(panel, baseline, echo, timeoutMs) {
      const echoSet = new Set(echo.map(dom.normalizeLabel));
      const start = now();
      let last = '';
      let lastChange = start;
      for (;;) {
        checkAborted();
        const fresh = text.diffLines(baseline, dom.collectText(panel)).filter((l) => !echoSet.has(dom.normalizeLabel(l)));
        const cleaned = text.cleanSummaryText(fresh.join('\n'));
        const n = now();
        if (cleaned !== last) {
          last = cleaned;
          lastChange = n;
          if (cleaned) ui.status(`Gemini antwortet … (${cleaned.length} Zeichen)`);
        }
        if (last.length >= t.minAnswerChars && n - lastChange >= t.stableMs) return last;
        if (n - start >= timeoutMs) {
          if (last) return last;
          throw new UserError('NO_ANSWER', { sec: Math.round(timeoutMs / 1000) });
        }
        await sleep(t.pollMs);
      }
    }

    async function runFlow(settings) {
      if (!dom.isWatchUrl(location.href)) throw new UserError('NOT_WATCH_PAGE');
      if (!settings.apiKey) throw new UserError('NO_API_KEY');

      const opts = {
        askLabels: settingsLib.parseList(settings.askLabels),
        summarizeKeywords: settingsLib.parseList(settings.summarizeKeywords),
        askButtonSelector: settings.askButtonSelector,
        panelSelector: settings.panelSelector,
      };

      ui.status('Prüfe YouTube-Seite …');
      if (!(await waitFor(() => dom.isActionBarReady(document), t.pageReadyTimeoutMs))) throw new UserError('PAGE_NOT_READY');

      // 1) Gemini-Panel öffnen – außer es ist schon offen (ein zweiter Klick auf „Ask“ würde es schließen).
      let located = dom.locateAskUi(document, opts);
      if (!located) {
        ui.status('Suche Gemini-Funktion („Ask“) …');
        const button = await waitFor(() => dom.findAskButton(document, opts), t.askButtonTimeoutMs);
        if (!button) {
          const d = messages.diagnoseMissingAsk({ signedIn: dom.isSignedIn(document), country: dom.detectCountry(document) });
          throw new UserError(d.code, d.params);
        }
        ui.status('Öffne Gemini …');
        button.click();
        located = await waitFor(() => dom.locateAskUi(document, opts), t.panelTimeoutMs);
        if (!located) throw new UserError('PANEL_NOT_FOUND');
      }

      // 2) Eigener Prompt hat Vorrang; sonst „Video zusammenfassen“, ersatzweise Standard-Prompt.
      const customPrompt = settings.customPrompt;
      let route = customPrompt ? 'type' : 'chip';
      if (route === 'chip' && !located.chip) {
        const again = await waitFor(() => {
          const a = dom.locateAskUi(document, opts);
          return a && a.chip ? a : null;
        }, t.chipTimeoutMs);
        if (again) located = again;
        else route = 'type';
      }

      const panel = located.panel;
      const baseline = dom.collectText(panel);
      let echo;
      if (route === 'chip') {
        echo = dom.getLabels(located.chip);
        ui.status('Fordere Zusammenfassung an …');
        located.chip.click();
      } else {
        const input = located.input || dom.findPromptInput(panel);
        if (!input) throw new UserError('NO_PROMPT_TARGET');
        const prompt = customPrompt || DEFAULT_PROMPT;
        echo = [prompt];
        ui.status('Sende Frage an Gemini …');
        dom.setPromptText(input, prompt);
        dom.submitPrompt(panel, input);
      }

      // 3) Antwort abwarten und aufbereiten
      ui.status('Gemini fasst das Video zusammen …');
      const timeoutMs = t.responseTimeoutMs != null ? t.responseTimeoutMs : settings.responseTimeoutSec * 1000;
      const answer = await waitForAnswer(panel, baseline, echo, timeoutMs);
      const speech = text.truncateAtSentence(answer, settings.maxChars);
      if (!speech.trim()) throw new UserError('EMPTY_ANSWER');

      // 4) Vorlesen
      if (settings.pauseVideo) dom.pauseMainVideo(document);
      ui.status('Sende Zusammenfassung an Google Text-to-Speech …', { stop: true });
      const res = await send({ type: 'YTGR_SPEAK', text: speech });
      if (!res || res.ok !== true) {
        const code = res && res.code === 'NO_API_KEY' ? 'NO_API_KEY' : 'TTS_ERROR';
        throw new UserError(code, { details: (res && res.message) || 'Unbekannter Fehler.' });
      }
      return speech;
    }

    /** Führt den kompletten Ablauf aus. Ergebnis: { ok: true, text } oder { ok: false, code }. */
    async function run() {
      if (busy) return { ok: false, code: 'BUSY' };
      busy = true;
      aborted = false;
      let settings = null;
      try {
        settings = await getSettings();
        const speech = await runFlow(settings);
        return { ok: true, text: speech };
      } catch (e) {
        if (e instanceof AbortedError) {
          ui.hide();
          return { ok: false, code: 'ABORTED' };
        }
        if (e instanceof UserError) {
          if ((settings && settings.debug) || DIAGNOSE_CODES.has(e.code)) log('Diagnose', e.code, dom.debugSnapshot(document));
          ui.error(messages.format(e.code, e.params));
          return { ok: false, code: e.code };
        }
        const invalidated = /context invalidated/i.test(String((e && e.message) || ''));
        log('Fehler', e);
        ui.error(messages.format(invalidated ? 'CONTEXT_INVALIDATED' : 'UNEXPECTED', { details: String((e && e.message) || e) }));
        return { ok: false, code: invalidated ? 'CONTEXT_INVALIDATED' : 'UNEXPECTED' };
      } finally {
        busy = false;
      }
    }

    function abort() {
      if (busy) aborted = true;
    }

    return { run, abort, isBusy: () => busy };
  }

  return { createRunner, DEFAULT_TIMING, DEFAULT_PROMPT };
});
