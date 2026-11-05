/*
 * Offscreen-Dokument: erzeugt die Sprache per Google TTS und spielt sie ab.
 * Hier ist nur chrome.runtime verfügbar; die Einstellungen kommen per Nachricht vom Hintergrunddienst.
 */
(function () {
  'use strict';

  let tabId = null;

  const speaker = YTGR.speaker.createSpeaker({
    fetchImpl: (...args) => fetch(...args),
    createAudio: (src) => new Audio(src),
    onStatus: (status) => {
      chrome.runtime.sendMessage({ target: 'background', type: 'YTGR_TTS_STATUS', tabId, ...status }).catch(() => {});
    },
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'offscreen') return false;
    if (msg.type === 'YTGR_PLAY') {
      tabId = msg.tabId == null ? null : msg.tabId;
      speaker.speak(msg.text, msg.settings);
      sendResponse({ ok: true });
    } else if (msg.type === 'YTGR_STOP') {
      speaker.stop();
      sendResponse({ ok: true });
    }
    return false;
  });
})();
