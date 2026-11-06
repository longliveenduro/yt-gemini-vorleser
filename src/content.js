/*
 * Content-Script auf youtube.com. Der Ablauf startet per Klick auf das Erweiterungs-Symbol
 * (Nachricht YTGR_TOGGLE vom Hintergrunddienst) oder per Button in der Aktionsleiste unter dem Video.
 * Ein weiterer Klick, solange etwas läuft, bricht ab. Der Status erscheint als Overlay.
 */
(function () {
  'use strict';

  // Schutz vor doppelter Injektion (z. B. nach manueller Nachinstallation in einen offenen Tab).
  if (globalThis.__ytgrContentLoaded) return;
  globalThis.__ytgrContentLoaded = true;

  const {
    settings: Settings,
    runner: Runner,
    overlay: Overlay,
    messages: Messages,
    pageButton: PageButton,
  } = globalThis.YTGR;

  let speaking = false;
  let runPromise = null;

  /** Nach dem Neuladen/Aktualisieren der Erweiterung ist dieses Skript verwaist (chrome.runtime.id fehlt). */
  function isAlive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  const pageButton = PageButton.createPageButton({ document, onClick: () => toggle(), isAlive });

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

  function isActive() {
    return runner.isBusy() || speaking;
  }

  function refreshButton() {
    pageButton.setState(isActive() ? 'active' : 'idle');
  }

  function stopAll() {
    runner.abort();
    speaking = false;
    pageButton.setState('idle');
    const sendStop = () => chrome.runtime.sendMessage({ type: 'YTGR_STOP' }).catch(() => {});
    sendStop();
    // Falls „vorlesen“ gerade erst unterwegs war: nach Ende des Ablaufs noch einmal stoppen.
    if (runPromise) runPromise.then(sendStop);
    overlay.hide();
  }

  function startRun() {
    runPromise = runner.run().then((result) => {
      // Der Auftrag zum Vorlesen ist angenommen; der Status „speaking“ folgt, sobald das erste Stück fertig ist.
      if (result && result.ok) speaking = true;
      refreshButton();
      return result;
    });
    refreshButton();
  }

  /** Klick auf Symbol oder Button: starten – oder abbrechen, solange Zusammenfassen oder Vorlesen läuft. */
  function toggle() {
    if (isActive()) stopAll();
    else startRun();
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
        return;
    }
    refreshButton();
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;
    if (msg.type === 'YTGR_TOGGLE') {
      toggle();
      sendResponse({ ok: true });
    } else if (msg.type === 'YTGR_STATUS') {
      onTtsStatus(msg);
    }
    return false;
  });

  // Button auf der Seite: Einstellungen laden und Änderungen aus den Optionen sofort übernehmen.
  function applySettings(settings) {
    pageButton.configure({
      enabled: settings.pageButton,
      askLabels: Settings.parseList(settings.askLabels),
      askButtonSelector: settings.askButtonSelector,
    });
  }

  Settings.loadSettings(chrome.storage.local)
    .then((settings) => {
      applySettings(settings);
      pageButton.start();
    })
    .catch(() => {});

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) applySettings(Settings.normalizeSettings(changes.settings.newValue));
  });
})();
