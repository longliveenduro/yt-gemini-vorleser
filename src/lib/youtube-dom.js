/*
 * Zugriff auf die YouTube-Watch-Seite. Alle Funktionen bekommen das Dokument bzw. ein Element übergeben,
 * damit sie in den Tests gegen jsdom-Fixtures laufen können.
 *
 * Wichtig: YouTube dokumentiert die Oberfläche der Gemini-Funktion („Ask“) nicht. Die Erkennung arbeitet
 * deshalb mit Beschriftungen und Strukturmerkmalen und lässt sich über die Optionen (Beschriftungen,
 * Stichwörter, CSS-Selektoren) anpassen.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.YTGR = root.YTGR || {}).dom = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const BUTTON_SELECTOR = 'button, [role="button"]';
  const CHIP_SELECTOR = `${BUTTON_SELECTOR}, yt-chip-cloud-chip-renderer, chip-view-model, [role="option"]`;
  const PANEL_SELECTOR = 'ytd-engagement-panel-section-list-renderer, [role="dialog"]';
  // Engagement-Panels, die sicher nicht das Gemini-Panel sind.
  const PANEL_BLACKLIST = /transcript|comment|chapter|description|clip|product|shopping|playlist|live-?chat|ads|macro-markers|timed/i;
  const INPUT_SELECTOR =
    'textarea, input[type="text"], input[type="search"], input:not([type]), [contenteditable="true"], [contenteditable=""], [role="textbox"]';
  // Eingabefelder, in die niemals geschrieben wird (Kommentare, Suche).
  const INPUT_EXCLUDE = 'ytd-commentbox, ytd-comments, #comments, ytd-searchbox, #search-form, ytd-transcript-search-panel-renderer';
  const SEND_TOKENS = ['send', 'senden', 'absenden', 'submit', 'enviar', 'envoyer', 'invia', 'verstuur', 'wyślij', 'отправ', '送信', '보내', '发送'];
  const NOT_SEND = /feedback|rückmeld|report|melden/;
  // Beschriftungen des „Teilen“-Buttons: Ausweich-Anker für den eigenen Button, wenn „Ask“ fehlt.
  const SHARE_LABELS = [
    'share', 'teilen', 'compartir', 'partager', 'condividi', 'compartilhar', 'delen', 'udostępnij',
    'поделиться', '共有', '공유', '分享', 'paylaş', 'dela',
  ];

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG', 'NOSCRIPT', 'TEMPLATE', 'BUTTON', 'TEXTAREA', 'INPUT', 'SELECT', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME']);
  const BLOCK_TAGS = new Set([
    'DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'BR', 'TR', 'BLOCKQUOTE',
    'PRE', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'TABLE', 'DL', 'DT', 'DD', 'FIGURE', 'FORM', 'HR',
  ]);

  function isWatchUrl(href) {
    try {
      const u = new URL(href);
      return u.hostname === 'www.youtube.com' && u.pathname === '/watch' && u.searchParams.has('v');
    } catch (_) {
      return false;
    }
  }

  function normalizeLabel(s) {
    return String(s || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.:!?…]+$/u, '')
      .trim();
  }

  /** aria-label, title und sichtbarer Text eines Elements (normalisiert, ohne Duplikate). */
  function getLabels(el) {
    const out = [];
    for (const v of [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent]) {
      const n = normalizeLabel(v);
      if (n && !out.includes(n)) out.push(n);
    }
    return out;
  }

  function shadowRootOf(el) {
    if (el.shadowRoot) return el.shadowRoot;
    try {
      if (typeof chrome !== 'undefined' && chrome.dom && chrome.dom.openOrClosedShadowRoot) {
        return chrome.dom.openOrClosedShadowRoot(el);
      }
    } catch (_) {
      /* kein Zugriff */
    }
    return null;
  }

  /** querySelectorAll, das auch in (offene und – soweit erlaubt – geschlossene) Shadow-Roots hineinsucht. */
  function queryAllDeep(rootNode, selector) {
    const results = [];
    const seen = new Set();
    const roots = [rootNode];
    if (rootNode.nodeType === 1) {
      const own = shadowRootOf(rootNode);
      if (own) roots.push(own);
    }
    while (roots.length) {
      const r = roots.pop();
      if (!r.querySelectorAll) continue;
      for (const el of r.querySelectorAll(selector)) {
        if (!seen.has(el)) {
          seen.add(el);
          results.push(el);
        }
      }
      for (const el of r.querySelectorAll('*')) {
        const sr = shadowRootOf(el);
        if (sr) roots.push(sr);
      }
    }
    return results;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ checkVisibilityCSS: true })) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    // Fallback (jsdom, ältere Browser): Stile entlang der Vorfahren prüfen.
    const view = el.ownerDocument.defaultView;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hidden) return false;
      const cs = view.getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  }

  /** Bei Wrapper-Elementen (chip-view-model …) den innersten klickbaren Knoten verwenden. */
  function clickableOf(el) {
    if (el.matches(BUTTON_SELECTOR)) return el;
    return el.querySelector(BUTTON_SELECTOR) || el;
  }

  function findActionScope(doc) {
    return doc.querySelector('ytd-watch-metadata') || doc.querySelector('#above-the-fold') || doc.querySelector('#primary') || doc.body;
  }

  /** Die Aktionsleiste unter dem Video (Like, Teilen, …) ist gerendert. */
  function isActionBarReady(doc) {
    const scope = findActionScope(doc);
    if (!scope) return false;
    return queryAllDeep(scope, BUTTON_SELECTOR).filter(isVisible).length >= 3;
  }

  /** Sucht den „Ask“-Button (Gemini-Funktion) unter dem Video. */
  function findAskButton(doc, opts) {
    const o = opts || {};
    if (o.askButtonSelector) {
      try {
        const el = queryAllDeep(doc, o.askButtonSelector).find(isVisible);
        if (el) return clickableOf(el);
      } catch (_) {
        /* ungültiger Selektor → weiter mit den Beschriftungen */
      }
    }
    const wanted = new Set((o.askLabels || []).map(normalizeLabel).filter(Boolean));
    if (!wanted.size) return null;
    for (const el of queryAllDeep(findActionScope(doc), BUTTON_SELECTOR)) {
      if (isVisible(el) && getLabels(el).some((l) => wanted.has(l))) return el;
    }
    return null;
  }

  /** Sichtbare Panels, in denen die Gemini-Unterhaltung laufen könnte. */
  function candidatePanels(doc, panelSelector) {
    if (panelSelector) {
      try {
        return queryAllDeep(doc, panelSelector).filter(isVisible);
      } catch (_) {
        /* ungültiger Selektor → Standardsuche */
      }
    }
    return queryAllDeep(doc, PANEL_SELECTOR).filter((el) => isVisible(el) && !PANEL_BLACKLIST.test(el.getAttribute('target-id') || ''));
  }

  /** „Video zusammenfassen“-Vorschlag im Panel (Stichwort-Vergleich auf aria-label/Text). */
  function findSummarizeChip(scope, keywords) {
    const kws = (keywords || []).map((k) => String(k).toLowerCase()).filter(Boolean);
    if (!kws.length) return null;
    for (const el of queryAllDeep(scope, CHIP_SELECTOR)) {
      if (!isVisible(el)) continue;
      const labels = getLabels(el).filter((l) => l.length <= 120);
      if (labels.some((l) => kws.some((k) => l.includes(k)))) return clickableOf(el);
    }
    return null;
  }

  /** Eingabefeld für Fragen im Panel – niemals Kommentar- oder Suchfeld. */
  function findPromptInput(panel) {
    return (
      queryAllDeep(panel, INPUT_SELECTOR).find(
        (el) => isVisible(el) && !el.disabled && !el.readOnly && !el.closest(INPUT_EXCLUDE),
      ) || null
    );
  }

  function findSendButton(panel) {
    for (const el of queryAllDeep(panel, BUTTON_SELECTOR)) {
      if (!isVisible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      const labels = getLabels(el);
      if (labels.some((l) => NOT_SEND.test(l))) continue;
      if (labels.some((l) => SEND_TOKENS.some((t) => l.includes(t)))) return el;
    }
    return null;
  }

  /** „Teilen“-Button unter dem Video (feste, mehrsprachige Beschriftungsliste). */
  function findShareButton(doc) {
    const wanted = new Set(SHARE_LABELS);
    for (const el of queryAllDeep(findActionScope(doc), BUTTON_SELECTOR)) {
      if (isVisible(el) && getLabels(el).some((l) => wanted.has(l))) return el;
    }
    return null;
  }

  /**
   * Das Element der Aktionsleiste, hinter dem ein eigener Button eingefügt werden kann: der Eintrag der Leiste
   * (nicht der innere Button), der „Ask“ – sonst „Teilen“ – enthält. Die Leiste ist der nächste Vorfahre mit
   * mindestens drei sichtbaren Buttons.
   */
  function findButtonSlot(doc, opts) {
    const anchor = findAskButton(doc, opts) || findShareButton(doc);
    if (!anchor) return null;
    let child = anchor;
    for (let i = 0; i < 8 && child.parentElement; i += 1) {
      const parent = child.parentElement;
      if (queryAllDeep(parent, BUTTON_SELECTOR).filter(isVisible).length >= 3) return child;
      child = parent;
    }
    return anchor;
  }

  /**
   * Findet die geöffnete Gemini-Oberfläche: { panel, chip, input } oder null.
   * Ein Panel zählt nur, wenn es eine Zusammenfassen-Schaltfläche oder ein Eingabefeld enthält.
   */
  function locateAskUi(doc, opts) {
    const o = opts || {};
    for (const panel of candidatePanels(doc, o.panelSelector)) {
      const chip = findSummarizeChip(panel, o.summarizeKeywords);
      const input = findPromptInput(panel);
      if (chip || input) return { panel, chip, input };
    }
    return null;
  }

  /** Text in ein Eingabefeld schreiben, so dass Frameworks die Änderung bemerken. */
  function setPromptText(input, text) {
    const win = input.ownerDocument.defaultView;
    input.focus();
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      const proto = input.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, text);
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
      input.dispatchEvent(new win.Event('change', { bubbles: true }));
      return;
    }
    const doc = input.ownerDocument;
    let inserted = false;
    try {
      doc.execCommand('selectAll', false);
      inserted = doc.execCommand('insertText', false, text);
    } catch (_) {
      inserted = false;
    }
    if (!inserted) {
      input.textContent = text;
      input.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }

  /** Das Eingabefeld enthält keinen Text (mehr). */
  function inputIsEmpty(input) {
    const value = typeof input.value === 'string' ? input.value : input.textContent;
    return String(value || '').trim() === '';
  }

  /** Eingabefeld leeren (z. B. nach einem Prompt, der nicht gesendet wurde). */
  function clearPromptText(input) {
    const win = input.ownerDocument.defaultView;
    input.focus();
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      const proto = input.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, '');
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
      return;
    }
    const doc = input.ownerDocument;
    let cleared = false;
    try {
      doc.execCommand('selectAll', false);
      cleared = doc.execCommand('delete', false);
    } catch (_) {
      cleared = false;
    }
    if (!cleared) {
      input.textContent = '';
      input.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    }
  }

  function pressEnter(input) {
    const win = input.ownerDocument.defaultView;
    for (const type of ['keydown', 'keypress', 'keyup']) {
      input.dispatchEvent(
        new win.KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
      );
    }
  }

  /** Frage absenden: Senden-Button, sonst Enter. Gibt 'button' oder 'enter' zurück. */
  function submitPrompt(panel, input) {
    const button = findSendButton(panel);
    if (button) {
      button.click();
      return 'button';
    }
    pressEnter(input);
    return 'enter';
  }

  /**
   * Sichtbarer Text eines Elements als Zeilen. Schaltflächen (Chips, Daumen, Kopieren …), Skripte,
   * versteckte Elemente und Formularfelder werden ausgelassen.
   */
  function collectText(rootNode) {
    const lines = [];
    let buf = '';
    const flush = () => {
      const t = buf.replace(/\s+/g, ' ').trim();
      if (t) lines.push(t);
      buf = '';
    };
    const view = (rootNode.ownerDocument || rootNode).defaultView;

    const walk = (node) => {
      if (node.nodeType === 3) {
        buf += node.nodeValue;
        return;
      }
      if (node.nodeType !== 1 && node.nodeType !== 11) return;
      let block = false;
      if (node.nodeType === 1) {
        const tag = node.tagName.toUpperCase();
        if (SKIP_TAGS.has(tag)) return;
        if (node.hidden || node.getAttribute('aria-hidden') === 'true' || node.getAttribute('role') === 'button') return;
        const cs = view ? view.getComputedStyle(node) : null;
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return;
        block = BLOCK_TAGS.has(tag) || Boolean(cs && cs.display && !/^(inline|contents)/.test(cs.display));
        if (tag === 'BR') {
          flush();
          return;
        }
      }
      if (block) flush();
      if (node.nodeType === 1) {
        const sr = shadowRootOf(node);
        if (sr) walk(sr);
      }
      for (const child of node.childNodes) walk(child);
      if (block) flush();
    };

    walk(rootNode);
    flush();
    return lines;
  }

  /** true = angemeldet, false = abgemeldet, null = unklar. */
  function isSignedIn(doc) {
    if (doc.querySelector('#avatar-btn')) return true;
    if (doc.querySelector('ytd-masthead a[href*="accounts.google.com/ServiceLogin"], ytd-masthead a[href*="accounts.google.com/v3/signin"]')) {
      return false;
    }
    return null;
  }

  /** Länderkürzel aus den YouTube-Konfigurationsdaten der Seite (z. B. "DE"), sonst null. */
  function detectCountry(doc) {
    for (const s of doc.querySelectorAll('script')) {
      const t = s.textContent;
      if (!t || t.length < 20 || (!t.includes('"gl"') && !t.includes('"GL"'))) continue;
      const m = /"(?:gl|GL)"\s*:\s*"([A-Za-z]{2})"/.exec(t);
      if (m) return m[1].toUpperCase();
    }
    return null;
  }

  function pauseMainVideo(doc) {
    const v = doc.querySelector('video.html5-main-video') || doc.querySelector('video');
    if (v && !v.paused) {
      v.pause();
      return true;
    }
    return false;
  }

  /** „1:02:03“, „12:34“ → Sekunden; null, wenn der Text keine Uhrzeitform hat (z. B. „LIVE“). */
  function parseClock(text) {
    const m = /^\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{2})\s*$/.exec(String(text || ''));
    if (!m) return null;
    return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }

  /** ISO-8601-Dauer wie „PT1H2M3S“ (steht in den Metadaten der Seite) → Sekunden; sonst null. */
  function parseIsoDuration(text) {
    const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(text || '').trim());
    if (!m) return null;
    const sec = Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Math.round(Number(m[4] || 0));
    return sec > 0 ? sec : null;
  }

  /**
   * Länge des Videos in Sekunden – oder null (Livestream, Player noch nicht bereit). Läuft gerade Werbung, gehören
   * Videoelement und Zeitanzeige zur Werbung; dann bleiben nur die Metadaten der Seite.
   */
  function getVideoDurationSec(doc) {
    const adShowing = Boolean(doc.querySelector('.html5-video-player.ad-showing, #movie_player.ad-showing'));
    if (!adShowing) {
      const video = doc.querySelector('video.html5-main-video') || doc.querySelector('video');
      if (video && Number.isFinite(video.duration) && video.duration > 0) return Math.round(video.duration);
      const shown = doc.querySelector('.ytp-time-duration');
      const fromClock = shown ? parseClock(shown.textContent) : null;
      if (fromClock) return fromClock;
    }
    const meta = doc.querySelector('meta[itemprop="duration"]');
    return meta ? parseIsoDuration(meta.getAttribute('content')) : null;
  }

  /** Momentaufnahme für die Fehlersuche (Konsole bzw. GitHub-Issue). */
  function debugSnapshot(doc) {
    const labelOf = (el) => getLabels(el)[0];
    const scope = findActionScope(doc);
    return {
      url: doc.location ? doc.location.href : '',
      signedIn: isSignedIn(doc),
      country: detectCountry(doc),
      actionButtons: queryAllDeep(scope, BUTTON_SELECTOR).filter(isVisible).map(labelOf).filter(Boolean).slice(0, 40),
      panels: queryAllDeep(doc, PANEL_SELECTOR).map((el) => ({
        tag: el.tagName.toLowerCase(),
        targetId: el.getAttribute('target-id') || '',
        visible: isVisible(el),
        hasInput: Boolean(findPromptInput(el)),
        buttons: queryAllDeep(el, BUTTON_SELECTOR).filter(isVisible).map(labelOf).filter(Boolean).slice(0, 12),
      })),
    };
  }

  return {
    isWatchUrl,
    normalizeLabel,
    getLabels,
    queryAllDeep,
    isVisible,
    isActionBarReady,
    findAskButton,
    candidatePanels,
    findSummarizeChip,
    findPromptInput,
    findSendButton,
    findShareButton,
    findButtonSlot,
    locateAskUi,
    setPromptText,
    inputIsEmpty,
    clearPromptText,
    pressEnter,
    submitPrompt,
    collectText,
    isSignedIn,
    detectCountry,
    pauseMainVideo,
    parseClock,
    parseIsoDuration,
    getVideoDurationSec,
    debugSnapshot,
  };
});
