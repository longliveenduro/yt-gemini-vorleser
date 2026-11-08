/*
 * Spielt Text per Google TTS ab: Der Text wird in Stücke geteilt, das erste Stück startet sofort,
 * während das nächste schon geladen wird. Jedes Stück wird zuvor für die Stimme aufbereitet (Abkürzungen buchstabieren,
 * Fremdwörter in ihrer Sprache sprechen, siehe speech-markup.js). fetch und Audio werden übergeben (testbar ohne Browser).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./text.js'), require('./google-tts.js'), require('./speech-markup.js'));
  } else {
    const ns = (root.YTGR = root.YTGR || {});
    ns.speaker = factory(ns.text, ns.googleTts, ns.speechMarkup);
  }
})(typeof self !== 'undefined' ? self : globalThis, function (text, tts, markup) {
  'use strict';

  const MIME = { OGG_OPUS: 'audio/ogg', MP3: 'audio/mpeg' };
  const CHUNK_BYTES = 1200;

  function audioError(message) {
    return Object.assign(new Error(message), { code: 'AUDIO_ERROR' });
  }

  function createSpeaker({ fetchImpl, createAudio, onStatus }) {
    const emit = onStatus || (() => {});
    let session = 0;
    let current = null; // { abort, audio, cancelPlay }

    /** Bricht die laufende Wiedergabe ab. silent: keinen „stopped“-Status melden. */
    function stop(opts) {
      session += 1;
      const wasActive = Boolean(current);
      if (current) {
        current.abort.abort();
        if (current.audio) {
          try {
            current.audio.pause();
          } catch (_) {
            /* Audio schon beendet */
          }
        }
        if (current.cancelPlay) current.cancelPlay();
        current = null;
      }
      if (wasActive && !(opts && opts.silent)) emit({ phase: 'stopped' });
    }

    function play(base64, encoding, ctx) {
      return new Promise((resolve, reject) => {
        const audio = createAudio(`data:${MIME[encoding] || MIME.OGG_OPUS};base64,${base64}`);
        ctx.audio = audio;
        ctx.cancelPlay = resolve;
        audio.onended = () => resolve();
        audio.onerror = () => reject(audioError('Die Audiodaten konnten nicht abgespielt werden.'));
        const started = audio.play();
        if (started && typeof started.catch === 'function') {
          started.catch((e) => reject(audioError(`Wiedergabe blockiert: ${e && e.message ? e.message : e}`)));
        }
      });
    }

    async function speak(rawText, settings) {
      stop({ silent: true });
      const chunks = text.splitIntoChunks(rawText, CHUNK_BYTES);
      if (!chunks.length) {
        emit({ phase: 'error', code: 'EMPTY', message: 'Kein Text zum Vorlesen.' });
        return;
      }
      const id = ++session;
      const ctx = { abort: new AbortController(), audio: null, cancelPlay: null };
      current = ctx;
      const voice = tts.effectiveVoice(settings);
      let plainOnly = false; // Google hat SSML abgelehnt: für den Rest dieser Wiedergabe nur noch Klartext

      /** Ein Stück → Audio. Mit SSML, wenn die Stimme es versteht; lehnt Google es ab, einmal mit Klartext wiederholen. */
      const synth = async (chunk) => {
        const rendered = markup.render(chunk, { voiceName: voice.name || '', languageCode: voice.languageCode });
        const send = (ssml) => tts.synthesize({ text: rendered.text, ssml, settings, fetchImpl, signal: ctx.abort.signal });
        try {
          return await send(plainOnly ? null : rendered.ssml);
        } catch (e) {
          if (!(e && e.ssml && e.code === 'BAD_REQUEST')) throw e;
          plainOnly = true;
          return send(null);
        }
      };

      try {
        let next = synth(chunks[0]);
        for (let i = 0; i < chunks.length; i += 1) {
          const audio = await next;
          if (id !== session) return;
          if (i + 1 < chunks.length) {
            next = synth(chunks[i + 1]); // schon laden, während das aktuelle Stück läuft
            next.catch(() => {}); // Fehler tauchen beim nächsten await auf
          }
          if (i === 0) emit({ phase: 'speaking' });
          await play(audio, settings.audioEncoding, ctx);
          if (id !== session) return;
        }
        emit({ phase: 'done' });
      } catch (e) {
        if (id !== session || (e && e.name === 'AbortError')) return;
        emit({ phase: 'error', code: (e && e.code) || 'TTS_ERROR', message: (e && e.message) || String(e) });
      } finally {
        if (id === session) current = null;
      }
    }

    return { speak, stop, isSpeaking: () => Boolean(current) };
  }

  return { createSpeaker, CHUNK_BYTES };
});
