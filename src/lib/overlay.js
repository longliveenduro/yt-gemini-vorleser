/*
 * Kleine Statuskarte unten links auf der YouTube-Seite: Fortschritt, Fehler und der VPN-Hinweis.
 * Aufbau per createElement/textContent (kein innerHTML), Stile im Shadow DOM, damit YouTube nichts überschreibt.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.YTGR = root.YTGR || {}).overlay = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const CSS = `
    .card { box-sizing: border-box; width: min(380px, calc(100vw - 32px)); padding: 12px 14px 12px 16px;
      border-radius: 10px; border-left: 4px solid #5aa9e6; background: #1b2230; color: #eef2f7;
      font: 13px/1.5 "Ubuntu", "Cantarell", system-ui, "Segoe UI", sans-serif; box-shadow: 0 8px 28px rgba(0, 0, 0, .35); }
    .card[data-tone="warn"] { border-left-color: #f2c14e; }
    .card[data-tone="error"] { border-left-color: #ff7b72; }
    .title { font-weight: 600; margin-bottom: 4px; }
    .title[hidden], .actions[hidden] { display: none; }
    .body { color: #d4dbe6; white-space: pre-wrap; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    button { font: inherit; color: #eef2f7; background: transparent; border: 1px solid #55607a;
      border-radius: 6px; padding: 4px 10px; cursor: pointer; }
    button:hover { background: #2a3347; }
    button:focus-visible { outline: 2px solid #8ec5ff; outline-offset: 2px; }
    .card[data-busy="true"] .body::before { content: ""; display: inline-block; width: 8px; height: 8px;
      margin-right: 8px; border-radius: 50%; background: #5aa9e6; animation: pulse 1.2s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .card[data-busy="true"] .body::before { animation: none; } }
  `;

  function createOverlay(doc, handlers) {
    const h = handlers || {};
    let host = null;
    let parts = null;
    let hideTimer = null;

    function el(tag, className, text) {
      const e = doc.createElement(tag);
      if (className) e.className = className;
      if (text !== undefined) e.textContent = text;
      return e;
    }

    function ensure() {
      if (host && host.isConnected) return parts;
      host = doc.createElement('div');
      host.id = 'ytgr-overlay-host';
      host.style.cssText = 'all: initial; position: fixed; left: 16px; bottom: 16px; z-index: 2147483647;';
      const shadow = host.attachShadow({ mode: 'open' });
      const style = doc.createElement('style');
      style.textContent = CSS;
      const card = el('div', 'card');
      card.setAttribute('role', 'status');
      card.setAttribute('aria-live', 'polite');
      const title = el('div', 'title');
      const body = el('div', 'body');
      const actions = el('div', 'actions');
      card.append(title, body, actions);
      shadow.append(style, card);
      (doc.body || doc.documentElement).appendChild(host);
      parts = { card, title, body, actions };
      return parts;
    }

    function render({ tone, title, text, busy, vpn, buttons }) {
      clearTimeout(hideTimer);
      const p = ensure();
      p.card.dataset.tone = tone;
      p.card.dataset.busy = busy ? 'true' : 'false';
      p.card.dataset.vpn = vpn ? 'true' : 'false';
      p.title.textContent = title || '';
      p.title.hidden = !title;
      p.body.textContent = text || '';
      p.actions.textContent = '';
      for (const b of buttons) {
        const btn = el('button', '', b.label);
        btn.type = 'button';
        btn.addEventListener('click', b.onClick);
        p.actions.appendChild(btn);
      }
      p.actions.hidden = buttons.length === 0;
    }

    function hide() {
      clearTimeout(hideTimer);
      if (host) host.remove();
      host = null;
      parts = null;
    }

    const stopButton = { label: 'Stopp', onClick: () => h.onStop && h.onStop() };
    const closeButton = { label: 'Schließen', onClick: hide };
    const optionsButton = { label: 'Optionen öffnen', onClick: () => h.onOptions && h.onOptions() };

    return {
      /** Laufender Vorgang mit Stopp-Schaltfläche. */
      status(text) {
        render({ tone: 'info', title: '', text, busy: true, vpn: false, buttons: [stopButton] });
      },
      /** Kurze Information, optional automatisch ausgeblendet. */
      info(text, opts) {
        render({ tone: 'info', title: '', text, busy: false, vpn: false, buttons: [closeButton] });
        const ms = opts && opts.autoHideMs;
        if (ms) hideTimer = setTimeout(hide, ms);
      },
      /** Fehler oder Hinweis aus messages.format(): { tone, title, text, vpn, options }. */
      error(info) {
        const buttons = info.options ? [optionsButton, closeButton] : [closeButton];
        render({ tone: info.tone || 'error', title: info.title, text: info.text, busy: false, vpn: info.vpn, buttons });
      },
      hide,
      isShown: () => Boolean(host && host.isConnected),
    };
  }

  return { createOverlay };
});
