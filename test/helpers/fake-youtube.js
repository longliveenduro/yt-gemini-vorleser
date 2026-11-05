'use strict';

/*
 * Eine Attrappe der YouTube-Watch-Seite für jsdom. Sie bildet nach, was die Erweiterung braucht:
 * Aktionsleiste mit (optionalem) „Ask“-Button, ein Gemini-Panel mit Vorschlags-Chips, Eingabefeld und
 * schrittweise eingeblendeter Antwort sowie „Störer“ (Transkript-Panel mit Suchfeld, Kommentarfeld).
 *
 * Das ist ein Modell – die echte YouTube-Oberfläche ist nicht dokumentiert und ändert sich.
 */

const { JSDOM } = require('jsdom');

const DEFAULT_BLOCKS = [
  '<p>Das Video erklärt Schritt für Schritt, wie man einen Sauerteig ansetzt und pflegt.</p>',
  '<ul><li><a href="#">0:00</a> Einführung und benötigte Zutaten</li><li><a href="#">1:25</a> Das Ansetzen in den ersten drei Tagen</li></ul>',
  '<p><strong>Fazit:</strong> Mit Geduld gelingt der Sauerteig auch Anfängern.</p>',
];

const EXPECTED_DEFAULT_TEXT = [
  'Das Video erklärt Schritt für Schritt, wie man einen Sauerteig ansetzt und pflegt.',
  'Einführung und benötigte Zutaten.',
  'Das Ansetzen in den ersten drei Tagen.',
  'Fazit: Mit Geduld gelingt der Sauerteig auch Anfängern.',
].join('\n');

function createWatchPage(options = {}) {
  const o = {
    askLabel: 'Ask', // null → kein Ask-Button (z. B. Geofencing)
    chipLabel: 'Summarize the video', // null → kein Zusammenfassen-Chip
    signedIn: true,
    country: 'DE',
    panelOpen: false,
    askOpensPanel: true,
    withInput: true,
    withSendButton: true,
    answerBlocks: DEFAULT_BLOCKS,
    streamMs: 10,
    openDelayMs: 5,
    panelTargetId: 'engagement-panel-ask',
    url: 'https://www.youtube.com/watch?v=abc123',
    ...options,
  };

  const askButton = o.askLabel ? `<button id="ask" aria-label="${o.askLabel}"><span>${o.askLabel}</span></button>` : '';
  const chip = o.chipLabel ? `<button>${o.chipLabel}</button>` : '';
  const composer = o.withInput
    ? `<div class="composer"><textarea aria-label="Ask a question"></textarea>${
        o.withSendButton ? '<button aria-label="Send">Send</button>' : ''
      }</div>`
    : '';
  const account = o.signedIn
    ? '<button id="avatar-btn" aria-label="Account menu">A</button>'
    : '<a href="https://accounts.google.com/ServiceLogin?service=youtube">Sign in</a>';

  const html = `<!doctype html><html lang="de"><body>
    <ytd-masthead>${account}<input id="search" type="text" placeholder="Search" /></ytd-masthead>
    <ytd-watch-flexy>
      <div id="primary">
        <video class="html5-main-video"></video>
        <ytd-watch-metadata>
          <div id="actions"><div id="top-level-buttons-computed">
            <button aria-label="Like this video along with 1,234 other people">1.2K</button>
            <button aria-label="Dislike this video"></button>
            <button aria-label="Share"><span>Share</span></button>
            ${askButton}
            <button aria-label="Download"><span>Download</span></button>
          </div></div>
        </ytd-watch-metadata>
        <ytd-comments><ytd-commentbox><div id="contenteditable-root" contenteditable="true"></div></ytd-commentbox></ytd-comments>
      </div>
      <div id="secondary">
        <ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript">
          <input type="text" placeholder="Search in video" /><div>Transcript line</div>
        </ytd-engagement-panel-section-list-renderer>
        <ytd-engagement-panel-section-list-renderer id="ask-panel" target-id="${o.panelTargetId}" style="display:none">
          <div class="header">Ask about this video</div>
          <div class="messages"></div>
          <div class="chips">${chip}<button>Recommend related content</button></div>
          ${composer}
          <div class="legal">Gemini may display inaccurate info.</div>
        </ytd-engagement-panel-section-list-renderer>
      </div>
    </ytd-watch-flexy>
    <script>ytcfg.set({"INNERTUBE_CONTEXT":{"client":{"hl":"de","gl":"${o.country}"}}});</script>
  </body></html>`;

  const dom = new JSDOM(html, { url: o.url, pretendToBeVisual: true });
  const { window } = dom;
  const doc = window.document;
  const panel = doc.getElementById('ask-panel');
  const messages = panel.querySelector('.messages');
  const chips = panel.querySelector('.chips');
  const state = { askClicks: 0, chipClicks: 0, sent: [] };

  function openPanel() {
    panel.style.display = '';
    panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
  }
  if (o.panelOpen) openPanel();

  function answer(question) {
    const user = doc.createElement('div');
    user.className = 'msg user';
    user.textContent = question;
    messages.appendChild(user);
    const bot = doc.createElement('div');
    bot.className = 'msg bot';
    messages.appendChild(bot);
    chips.textContent = '';

    o.answerBlocks.forEach((block, i) => {
      setTimeout(() => bot.insertAdjacentHTML('beforeend', block), (i + 1) * o.streamMs);
    });
    setTimeout(() => {
      bot.insertAdjacentHTML(
        'beforeend',
        '<div class="tools"><button aria-label="Good response">👍</button><button aria-label="Bad response">👎</button>' +
          '<button aria-label="Copy">Copy</button></div><div class="note">AI-generated. May contain inaccurate information.</div>',
      );
      chips.insertAdjacentHTML('beforeend', '<button>What are the key takeaways?</button>');
      state.finished = true;
    }, (o.answerBlocks.length + 1) * o.streamMs);
  }

  function sendTyped() {
    const textarea = panel.querySelector('textarea');
    if (textarea && textarea.value.trim()) {
      state.sent.push(textarea.value);
      answer(textarea.value);
      textarea.value = '';
    }
  }

  doc.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    if (button.id === 'ask') {
      state.askClicks += 1;
      if (o.askOpensPanel) setTimeout(openPanel, o.openDelayMs);
    } else if (chips.contains(button) && o.chipLabel && button.textContent === o.chipLabel) {
      state.chipClicks += 1;
      answer(o.chipLabel);
    } else if (button.getAttribute('aria-label') === 'Send') {
      sendTyped();
    }
  });
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'TEXTAREA' && !o.withSendButton) sendTyped();
  });

  return { dom, window, document: doc, panel, state, openPanel };
}

/** Kurze Zeiten, damit Tests in Millisekunden laufen. */
const FAST_TIMING = {
  pollMs: 5,
  pageReadyTimeoutMs: 300,
  askButtonTimeoutMs: 150,
  panelTimeoutMs: 300,
  chipTimeoutMs: 150,
  stableMs: 80,
  minAnswerChars: 20,
};

module.exports = { createWatchPage, FAST_TIMING, DEFAULT_BLOCKS, EXPECTED_DEFAULT_TEXT };
