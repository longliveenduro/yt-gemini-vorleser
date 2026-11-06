/*
 * Der Ablauf nach dem Klick auf das Erweiterungs-Symbol (läuft im Content-Script):
 *  1. prüfen: Video-Seite, API-Key vorhanden
 *  2. „Ask“-Button finden und klicken – fehlt er: Diagnose (Geofencing → VPN-Hinweis in die USA)
 *  3. Zusammenfassung anfordern: Prompt in der gewählten Sprache eintippen (Standard) oder den Vorschlag
 *     „Video zusammenfassen“ anklicken – bei Misserfolg wird jeweils die andere Variante versucht
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
    sendButtonWaitMs: 800,
    sendCheckMs: 4000,
    stableMs: 3000,
    minAnswerChars: 40,
  };

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

    /** Vorschlag „Video zusammenfassen“ anklicken. Gibt { panel, baseline, echo } zurück oder null. */
    async function tryChip(located, opts) {
      let current = located;
      if (!current.chip) {
        const again = await waitFor(() => {
          const a = dom.locateAskUi(document, opts);
          return a && a.chip ? a : null;
        }, t.chipTimeoutMs);
        if (!again) return null;
        current = again;
      }
      const baseline = dom.collectText(current.panel);
      ui.status('Fordere Zusammenfassung an …');
      current.chip.click();
      return { panel: current.panel, baseline, echo: dom.getLabels(current.chip) };
    }

    /**
     * Prompt in der gewählten Sprache ins Eingabefeld tippen und absenden. Gilt nur als gesendet, wenn das Feld
     * danach leer ist oder im Panel neuer Text erscheint – sonst wird das Feld geleert und null zurückgegeben.
     */
    async function tryType(located, settings) {
      const input = located.input || dom.findPromptInput(located.panel);
      if (!input) return null;
      const prompt = settingsLib.buildSummaryPrompt(settings);
      const baseline = dom.collectText(located.panel);
      ui.status('Sende Frage an Gemini …');
      dom.setPromptText(input, prompt);
      if (dom.inputIsEmpty(input)) return null; // Eingabe wurde nicht übernommen
      await waitFor(() => dom.findSendButton(located.panel), t.sendButtonWaitMs); // Button wird erst nach der Eingabe aktiv
      dom.submitPrompt(located.panel, input);
      const accepted = await waitFor(
        () => dom.inputIsEmpty(input) || text.diffLines(baseline, dom.collectText(located.panel)).length > 0,
        t.sendCheckMs,
      );
      if (!accepted) {
        dom.clearPromptText(input);
        return null;
      }
      return { panel: located.panel, baseline, echo: [prompt] };
    }

    /** Fordert die Zusammenfassung an – in der bevorzugten Variante, bei Misserfolg in der anderen. */
    async function requestSummary(settings, opts, located) {
      const order = settings.requestMode === 'chip' ? ['chip', 'type'] : ['type', 'chip'];
      let current = located;
      for (let i = 0; i < order.length; i += 1) {
        current = dom.locateAskUi(document, opts) || current;
        const started = order[i] === 'chip' ? await tryChip(current, opts) : await tryType(current, settings);
        if (started) return started;
        if (i + 1 < order.length) {
          ui.status(
            order[i] === 'type'
              ? 'Eingabe nicht möglich – verwende den Vorschlag von YouTube (Antwortsprache bestimmt YouTube) …'
              : 'Vorschlag nicht gefunden – sende eigenen Prompt …',
          );
        }
      }
      throw new UserError('NO_PROMPT_TARGET');
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

      // 2) Zusammenfassung anfordern (Prompt in der gewählten Sprache bzw. YouTube-Vorschlag)
      const { panel, baseline, echo } = await requestSummary(settings, opts, located);

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

  return { createRunner, DEFAULT_TIMING };
});
