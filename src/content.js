/*
 * Content-Script auf youtube.com. Reagiert auf den Klick auf das Erweiterungs-Symbol
 * (Nachricht YTGR_TOGGLE vom Hintergrunddienst) und zeigt den Status als Overlay an.
 */
(function () {
  'use strict';

  // Schutz vor doppelter Injektion (z. B. nach manueller Nachinstallation in einen offenen Tab).
  if (globalThis.__ytgrContentLoaded) return;
  globalThis.__ytgrContentLoaded = true;

  const { settings: Settings, runner: Runner, overlay: Overlay, messages: Messages } = globalThis.YTGR;

  let speaking = false;
  let runPromise = null;

  const overlay = Overlay.createOverlay(document, {
    onStop: () => stopAll(),
    onOptions: () => chrome.runtime.sendMessage({ type: 'YTGR_OPEN_OPTIONS' }).catch(() => {}),
  });

  const runner = Runner.createRunner({
    document,
    location,
    getSettings: () => Settings.loadSettings(chrome.storage.local),
    send: (message) => chrome.runtime.sendMessage(message),
    ui: overlay,
  });

  function stopAll() {
    runner.abort();
    speaking = false;
    const sendStop = () => chrome.runtime.sendMessage({ type: 'YTGR_STOP' }).catch(() => {});
    sendStop();
    // Falls „vorlesen“ gerade erst unterwegs war: nach Ende des Ablaufs noch einmal stoppen.
    if (runPromise) runPromise.then(sendStop);
    overlay.hide();
  }

  function onTtsStatus(msg) {
    switch (msg.phase) {
      case 'speaking':
        speaking = true;
        overlay.status('Lese die Zusammenfassung vor …');
        break;
      case 'done':
        speaking = false;
        overlay.info('Fertig vorgelesen.', { autoHideMs: 2500 });
        break;
      case 'stopped':
        speaking = false;
        overlay.hide();
        break;
      case 'error':
        speaking = false;
        overlay.error(Messages.format('TTS_ERROR', { details: msg.message || 'Unbekannter Fehler.' }));
        break;
      default:
        break;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;
    if (msg.type === 'YTGR_TOGGLE') {
      // Zweiter Klick während Zusammenfassen oder Vorlesen = Abbruch.
      if (runner.isBusy() || speaking) stopAll();
      else runPromise = runner.run();
      sendResponse({ ok: true });
    } else if (msg.type === 'YTGR_STATUS') {
      onTtsStatus(msg);
    }
    return false;
  });
})();
