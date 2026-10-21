(function (Bellasprak) {
  'use strict';

  function createSpeech(options) {
    var state = options.state;
    var els = options.els;
    var getCurrentChunk = options.getCurrentChunk;
    var showToast = options.showToast;
    var stripHtml = Bellasprak.content.stripHtml;
    var escapeHtml = Bellasprak.content.escapeHtml;
    var icons = Bellasprak.config.icons;
    var preferredVoiceNames = Bellasprak.config.preferredVoiceNames;
    var availableVoices = [];

    function renderVoiceOptions() {
      refreshVoices();
      var locale = els.previewLanguage.value;
      var preferred = selectBestVoice(locale);
      var voices = availableVoices.filter(function (voice) { return languageFamily(voice.lang) === languageFamily(locale); });
      voices.sort(function (a, b) {
        var aExact = normalizeLocale(a.lang) === normalizeLocale(locale);
        var bExact = normalizeLocale(b.lang) === normalizeLocale(locale);
        return Number(bExact) - Number(aExact) || rankVoice(b, locale) - rankVoice(a, locale);
      });
      els.voiceDescription.textContent = preferred ? 'Automatic choice: ' + preferred.name + ' · ' + preferred.lang + '. Natural and enhanced voices are preferred when available for this locale.' : 'No matching voices are currently listed. Your browser will try its language default at playback time.';
      els.voiceList.innerHTML = voices.length ? voices.map(function (voice, index) { return '<li>' + (index === 0 ? 'Preferred: ' : '') + escapeHtml(voice.name) + ' · ' + escapeHtml(voice.lang) + '</li>'; }).join('') : '<li>No voices currently listed for this language.</li>';
    }
    function normalizeLocale(locale) {
      return String(locale || '').replace(/_/g, '-').toLocaleLowerCase();
    }

    function languageFamily(locale) {
      var base = normalizeLocale(locale).split('-')[0];
      return base === 'no' ? 'nb' : base;
    }

    function refreshVoices() {
      if (!window.speechSynthesis || typeof window.speechSynthesis.getVoices !== 'function') return [];
      availableVoices = window.speechSynthesis.getVoices() || [];
      return availableVoices;
    }

    function rankVoice(voice, locale) {
      var description = (String(voice.name || '') + ' ' + String(voice.voiceURI || '')).toLocaleLowerCase();
      var score = 0;
      if (description.indexOf('natural') >= 0 || description.indexOf('neural') >= 0) score += 180;
      if (description.indexOf('premium') >= 0 || description.indexOf('enhanced') >= 0) score += 165;
      if (description.indexOf('online') >= 0) score += 150;
      if (voice.localService === false) score += 120;
      if (description.indexOf('microsoft') >= 0) score += 80;
      if (description.indexOf('google') >= 0) score += 55;

      var favourites = preferredVoiceNames[locale] || [];
      var favouriteIndex = favourites.findIndex(function (name) {
        return description.indexOf(name.toLocaleLowerCase()) >= 0;
      });
      if (favouriteIndex >= 0) score += 70 - favouriteIndex * 8;
      if (voice.default) score += 5;
      return score;
    }

    function selectBestVoice(locale, options) {
      var settings = options || {};
      var pool = availableVoices.filter(function (voice) {
        if (settings.localOnly && voice.localService === false) return false;
        if (settings.excludeName && voice.name === settings.excludeName) return false;
        return true;
      });
      var exact = pool.filter(function (voice) {
        return normalizeLocale(voice.lang) === normalizeLocale(locale);
      });
      var family = pool.filter(function (voice) {
        return languageFamily(voice.lang) === languageFamily(locale);
      });
      var candidates = exact.length ? exact : family;
      if (!candidates.length) return null;
      return candidates.slice().sort(function (a, b) {
        return rankVoice(b, locale) - rankVoice(a, locale);
      })[0];
    }

    function waitForVoices(maximumWait) {
      refreshVoices();
      if (availableVoices.length) return Promise.resolve(availableVoices);
      var started = Date.now();
      return new Promise(function (resolve) {
        var timer = window.setInterval(function () {
          refreshVoices();
          if (availableVoices.length || Date.now() - started >= maximumWait) {
            window.clearInterval(timer);
            resolve(availableVoices);
          }
        }, 120);
      });
    }

    function clearSpeechButton() {
      if (!state.speechButton) return;
      state.speechButton.classList.remove('is-loading', 'is-speaking');
      state.speechButton.setAttribute('aria-pressed', 'false');
      state.speechButton.setAttribute('aria-busy', 'false');
    }

    function updateSpeechPresentation() {
      els.practiceTableHead.querySelectorAll('[data-speak-column]').forEach(function (button) {
        var active = state.speechButton === button;
        var name = button.dataset.columnName;
        button.innerHTML = active ? icons.stop : icons.play;
        button.title = (active ? 'Stop column audio' : 'Play entire column') + ' · ' + name;
        button.setAttribute('aria-label', active ? 'Stop ' + name + ' column audio' : 'Play entire ' + name + ' column in this group');
        button.setAttribute('aria-pressed', String(active));
      });
      els.practiceTable.querySelectorAll('[data-practice-field]').forEach(function (cell) {
        cell.classList.toggle('is-audio-active', state.speechColumn !== null && Boolean(state.speechButton) && Number(cell.dataset.practiceField) === state.speechColumn);
      });
    }

    function finishSpeech() {
      clearSpeechButton();
      state.speechButton = null;
      state.speechUtterance = null;
      state.speechColumn = null;
      updateSpeechPresentation();
    }

    function cancelSpeech() {
      state.speechToken += 1;
      if (window.speechSynthesis && typeof window.speechSynthesis.cancel === 'function') {
        window.speechSynthesis.cancel();
      }
      finishSpeech();
    }

    async function speakField(localIndex, fieldIndex, button) {
      var record = getCurrentChunk()[localIndex];
      if (!record) return;
      var text = stripHtml(record.fields[fieldIndex] || '');
      if (!text) return;
      state.lastSpeech = { row: localIndex, field: fieldIndex, id: record.id };
      return playSpeech(text, state.fields[fieldIndex].language, button);
    }

    function speakColumn(fieldIndex, button) {
      if (!state.fields[fieldIndex] || !state.fields[fieldIndex].enabled) return;
      var texts = getCurrentChunk().map(function (record) { return stripHtml(record.fields[fieldIndex] || ''); }).filter(Boolean);
      if (!texts.length) {
        showToast('This column has no text to read in the current group.', 'info');
        return;
      }
      return playSpeech(texts[0], state.fields[fieldIndex].language, button, texts);
    }

    async function playSpeech(text, locale, button, sequence) {
      if (!window.speechSynthesis || typeof window.speechSynthesis.speak !== 'function' || typeof SpeechSynthesisUtterance !== 'function') {
        showToast('Speech playback is not supported in this browser.', 'error');
        return;
      }

      if (state.speechButton === button) {
        cancelSpeech();
        return;
      }

      cancelSpeech();
      var token = state.speechToken;
      var queue = sequence || [text];
      var queueIndex = 0;
      var retryLocally = false;
      var failedVoice = '';
      state.speechButton = button;
      state.speechColumn = button.hasAttribute('data-speak-column') ? Number(button.dataset.speakColumn) : null;
      button.classList.add('is-loading');
      button.setAttribute('aria-pressed', 'true');
      button.setAttribute('aria-busy', 'true');
      updateSpeechPresentation();
      await waitForVoices(960);
      if (token !== state.speechToken || state.speechButton !== button) return;

      function startUtterance(localOnly, excludedName) {
        if (token !== state.speechToken || state.speechButton !== button) return;
        var voice = selectBestVoice(locale, {
          localOnly: localOnly,
          excludeName: excludedName || ''
        });
        var utterance = new SpeechSynthesisUtterance(queue[queueIndex]);
        utterance.lang = locale;
        utterance.rate = options.getPreferences().rate;
        utterance.pitch = 1;
        utterance.volume = 1;
        if (voice) utterance.voice = voice;
        state.speechUtterance = utterance;

        utterance.onstart = function () {
          if (token !== state.speechToken || state.speechUtterance !== utterance) return;
          button.classList.remove('is-loading');
          button.classList.add('is-speaking');
          button.setAttribute('aria-busy', 'false');
          if (voice && queueIndex === 0) showToast('Playing with ' + voice.name + '.', 'info');
        };

        utterance.onend = function () {
          if (token !== state.speechToken || state.speechUtterance !== utterance) return;
          queueIndex += 1;
          if (queueIndex < queue.length) {
            startUtterance(retryLocally, failedVoice);
          } else finishSpeech();
        };

        utterance.onerror = function (event) {
          if (token !== state.speechToken || state.speechUtterance !== utterance) return;
          if (event.error === 'canceled' || event.error === 'interrupted') { finishSpeech(); return; }

          if (!localOnly && voice && voice.localService === false) {
            state.speechUtterance = null;
            retryLocally = true;
            failedVoice = voice.name;
            button.classList.remove('is-speaking');
            button.classList.add('is-loading');
            window.setTimeout(function () {
              startUtterance(true, voice.name);
            }, 80);
            return;
          }

          finishSpeech();
          showToast('Speech could not start for this language.', 'error');
        };

        try {
          window.speechSynthesis.speak(utterance);
        } catch (error) {
          utterance.onerror({ error: 'synthesis-failed' });
        }
      }

      startUtterance(false, '');
    }

    return { cancelSpeech: cancelSpeech, speakField: speakField, speakColumn: speakColumn, playSpeech: playSpeech, refreshVoices: refreshVoices, renderVoiceOptions: renderVoiceOptions, selectBestVoice: selectBestVoice };
  }

  Bellasprak.speech = { create: createSpeech };
}(window.Bellasprak = window.Bellasprak || {}));
