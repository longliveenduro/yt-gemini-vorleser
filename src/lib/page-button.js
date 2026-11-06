/*
 * Ein Button „Vorlesen“ direkt in der Aktionsleiste unter dem Video, hinter „Ask“ (sonst hinter „Teilen“).
 *
 *  - Aufbau per createElement/createElementNS (kein innerHTML), Stile im Shadow DOM
 *  - Farben aus den CSS-Variablen von YouTube (hell/dunkel automatisch), mit Rückfallwerten
 *  - YouTube baut die Leiste bei Navigation und Größenänderung neu auf: Ein entprellter MutationObserver
 *    und das Ereignis yt-navigate-finish stellen den Button wieder her
 *  - Nach einem Neuladen der Erweiterung räumt die verwaiste alte Instanz ihren Button selbst weg (isAlive)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./youtube-dom.js'));
  } else {
    const ns = (root.YTGR = root.YTGR || {});
    ns.pageButton = factory(ns.dom);
  }
})(typeof self !== 'undefined' ? self : globalThis, function (dom) {
  'use strict';

  const HOST_ATTR = 'data-ytgr-page-button';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const TEXT = {
    idle: { label: 'Vorlesen', hint: 'Zusammenfassung vorlesen (Gemini + Google Text-to-Speech)' },
    active: { label: 'Stopp', hint: 'Abbrechen bzw. Vorlesen stoppen' },
  };

  const CSS = `
    button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px;
      height: 36px; padding: 0 14px; border-radius: 18px; cursor: pointer; white-space: nowrap;
      font: 500 14px/20px Roboto, "Ubuntu", Arial, sans-serif;
      color: var(--yt-spec-text-primary, #0f0f0f);
      background: var(--yt-spec-badge-chip-background, rgba(127, 127, 127, 0.18)); }
    button:hover { background: var(--yt-spec-button-chip-background-hover, rgba(127, 127, 127, 0.3)); }
    button:focus-visible { outline: 2px solid var(--yt-spec-call-to-action, #065fd4); outline-offset: 2px; }
    button[data-state="active"] { background: var(--yt-spec-call-to-action, #065fd4); color: #fff; }
    svg { width: 20px; height: 20px; flex: none; }
    .stop, button[data-state="active"] .speaker { display: none; }
    button[data-state="active"] .stop { display: block; }
    @media (max-width: 1000px) { .label { display: none; } button { padding: 0 10px; } }
  `;

  function createPageButton(deps) {
    const doc = deps.document;
    const onClick = deps.onClick || (() => {});
    const isAlive = deps.isAlive || (() => true);
    const debounceMs = deps.debounceMs != null ? deps.debounceMs : 400;
    const instance = Math.random().toString(36).slice(2);

    let enabled = true;
    let opts = {};
    let state = 'idle';
    let host = null;
    let parts = null;
    let observer = null;
    let timer = null;
    let started = false;

    function svgEl(tag, attrs) {
      const e = doc.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
      return e;
    }

    function render() {
      if (!parts) return;
      parts.button.dataset.state = state;
      parts.label.textContent = TEXT[state].label;
      parts.button.setAttribute('aria-label', TEXT[state].hint);
      parts.button.title = TEXT[state].hint;
    }

    function build() {
      const h = doc.createElement('span');
      h.setAttribute(HOST_ATTR, instance);
      h.style.cssText = 'all: initial; display: inline-flex; align-items: center; flex: none; margin-inline-start: 8px;';
      const shadow = h.attachShadow({ mode: 'open' });
      const style = doc.createElement('style');
      style.textContent = CSS;

      const button = doc.createElement('button');
      button.type = 'button';
      const speaker = svgEl('svg', { class: 'speaker', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
      speaker.append(
        svgEl('path', { d: 'M4 9v6h4l5 4V5L8 9H4z', fill: 'currentColor' }),
        svgEl('path', {
          d: 'M16.5 8.5a5 5 0 0 1 0 7M18.8 6a8.5 8.5 0 0 1 0 12',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': '2',
          'stroke-linecap': 'round',
        }),
      );
      const stop = svgEl('svg', { class: 'stop', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
      stop.append(svgEl('rect', { x: '6', y: '6', width: '12', height: '12', rx: '2', fill: 'currentColor' }));
      const label = doc.createElement('span');
      label.className = 'label';
      button.append(speaker, stop, label);
      // Der Klick gehört uns: YouTube-Handler der umgebenden Leiste sollen ihn nicht auch noch bekommen.
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      });

      shadow.append(style, button);
      host = h;
      parts = { button, label };
      render();
    }

    function removeHost() {
      if (host) host.remove();
      host = null;
      parts = null;
    }

    /**
     * Stellt sicher, dass genau ein Button an der richtigen Stelle hängt.
     * Rückgabe: 'dead' | 'removed' | 'present' | 'inserted' | 'no-anchor'
     */
    function ensure() {
      if (!isAlive()) {
        destroy(); // eslint-disable-line no-use-before-define
        return 'dead';
      }
      for (const other of doc.querySelectorAll(`[${HOST_ATTR}]`)) {
        if (other.getAttribute(HOST_ATTR) !== instance) other.remove(); // Reste einer früheren Instanz
      }
      if (!enabled || !dom.isWatchUrl(doc.location.href)) {
        removeHost();
        return 'removed';
      }
      if (host && host.isConnected && dom.isVisible(host)) return 'present';

      const slot = dom.findButtonSlot(doc, opts);
      if (!slot) return host && host.isConnected ? 'present' : 'no-anchor';
      if (!host) build();
      if (slot.nextElementSibling !== host) slot.after(host);
      return 'inserted';
    }

    function schedule() {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        ensure();
      }, debounceMs);
    }

    function start() {
      if (started) {
        ensure();
        return;
      }
      started = true;
      observer = new doc.defaultView.MutationObserver(schedule);
      observer.observe(doc.documentElement, { childList: true, subtree: true });
      doc.addEventListener('yt-navigate-finish', schedule);
      ensure();
    }

    function destroy() {
      if (observer) observer.disconnect();
      observer = null;
      clearTimeout(timer);
      timer = null;
      doc.removeEventListener('yt-navigate-finish', schedule);
      removeHost();
      started = false;
    }

    /** { enabled, askLabels, askButtonSelector } – wirkt sofort, auch bei laufendem Betrieb. */
    function configure(next) {
      if (next.enabled !== undefined) enabled = Boolean(next.enabled);
      opts = {
        askLabels: next.askLabels || opts.askLabels || [],
        askButtonSelector: next.askButtonSelector !== undefined ? next.askButtonSelector : opts.askButtonSelector,
      };
      if (started) ensure();
    }

    /** 'idle' (Vorlesen) oder 'active' (läuft: Stopp). */
    function setState(next) {
      state = next === 'active' ? 'active' : 'idle';
      render();
    }

    return { start, ensure, configure, setState, destroy, getHost: () => host };
  }

  return { createPageButton, HOST_ATTR };
});
