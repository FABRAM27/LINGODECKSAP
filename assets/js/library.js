(function (Bellasprak) {
  'use strict';

  var languages = Bellasprak.config.languages;
  var themes = Bellasprak.config.themes;
  var usefulLetters = Bellasprak.config.usefulLetters;

  function createEmptyLibrary() {
    return { version: 1, records: [], deckSettings: Object.create(null), completed: Object.create(null), preferences: { rate: 1, repeatPasses: false, shortcuts: true, keys: false, keyLanguage: 'de-DE', theme: 'default' }, session: {} };
  }

  function validateLibrary(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.records)) throw new Error('This is not a supported Bellasprak library backup.');
    var clean = { version: 1, records: [], deckSettings: Object.create(null), completed: Object.create(null), preferences: {}, session: {} };
    clean.records = value.records.map(function (record, index) {
      if (!record || typeof record.deck !== 'string' || !record.deck.trim() || !Array.isArray(record.fields) || !record.fields.length || record.fields.some(function (field) { return typeof field !== 'string'; })) throw new Error('The library contains an invalid record.');
      return { id: 'saved-' + index, noteType: typeof record.noteType === 'string' ? record.noteType : 'Basic', deck: record.deck, fields: record.fields.slice() };
    });
    Object.keys(value.deckSettings || {}).forEach(function (deck) {
      var item = value.deckSettings[deck];
      if (!item || !Array.isArray(item.fields)) return;
      clean.deckSettings[deck] = { fields: item.fields.map(function (field, index) {
        return { name: typeof field.name === 'string' ? field.name : 'Field ' + (index + 1), language: languages.some(function (language) { return language.code === field.language; }) ? field.language : 'en-US', enabled: field.enabled !== false, visible: field.visible === true };
      }), answerField: Number.isInteger(item.answerField) ? item.answerField : -1, answerCollapsed: item.answerCollapsed === true, chunk: Number.isInteger(item.chunk) && item.chunk >= 0 ? item.chunk : 0 };
    });
    Object.keys(value.completed || {}).forEach(function (deck) {
      if (typeof value.completed[deck] === 'string' && Number.isFinite(Date.parse(value.completed[deck]))) clean.completed[deck] = value.completed[deck];
    });
    var preferences = value.preferences || {};
    clean.preferences = {
      rate: [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5].indexOf(Number(preferences.rate)) >= 0 ? Number(preferences.rate) : 1,
      repeatPasses: preferences.repeatPasses === true, shortcuts: preferences.shortcuts !== false,
      keys: preferences.keys === true, keyLanguage: Object.hasOwn(usefulLetters, preferences.keyLanguage) ? preferences.keyLanguage : 'de-DE',
      theme: themes.some(function (theme) { return theme.id === preferences.theme; }) ? preferences.theme : 'default'
    };
    var session = value.session || {};
    clean.session = { deck: typeof session.deck === 'string' ? session.deck : '', chunk: Number.isInteger(session.chunk) && session.chunk >= 0 ? session.chunk : 0, view: session.view === 'practice' ? 'practice' : 'source' };
    return clean;
  }

  // Owns the connection, revision check, and save queue; UI supplies data snapshots.
  function createStore(storageWarning) {
    var database = null;
    var storageRevision = 0;
    var saveQueue = Promise.resolve();

    async function open() {
      database = await new Promise(function (resolve, reject) {
        // Keep the original storage ID so the Bellasprak rename retains existing libraries.
        var request = indexedDB.open('lingodeck-library', 1);
        request.onupgradeneeded = function () { request.result.createObjectStore('library'); };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
        request.onblocked = function () { reject(new Error('Storage is blocked by another tab')); };
      });
      database.onversionchange = function () { database.close(); database = null; storageWarning('Library storage changed in another tab. Reload before making more changes.'); };
      var saved = await new Promise(function (resolve, reject) {
        var request = database.transaction('library', 'readonly').objectStore('library').get('current');
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
      });

      storageRevision = saved && Number.isSafeInteger(saved.revision) ? saved.revision : 0;
      return saved;
    }

    function close() {
      if (database) database.close();
      database = null;
    }

    function save(value) {
      if (!database) return Promise.resolve(false);
      var snapshot = JSON.parse(JSON.stringify(value));
      saveQueue = saveQueue.catch(function () {}).then(function () {
        if (!database) return false;
        return new Promise(function (resolve, reject) {
          var transaction = database.transaction('library', 'readwrite');
          var store = transaction.objectStore('library');
          var check = store.get('current');
          var conflict = false;
          check.onsuccess = function () {
            var revision = check.result && Number.isSafeInteger(check.result.revision) ? check.result.revision : 0;
            if (revision !== storageRevision) { conflict = true; transaction.abort(); return; }
            snapshot.revision = storageRevision + 1;
            store.put(snapshot, 'current');
          };
          transaction.oncomplete = function () { storageRevision = snapshot.revision; resolve(true); };
          transaction.onerror = function () { reject(conflict ? new Error('LibraryConflict') : transaction.error || new Error('Save failed')); };
          transaction.onabort = transaction.onerror;
        });
      }).catch(function (error) {
        if (error.message === 'LibraryConflict') {
          if (database) database.close();
          database = null;
          storageWarning('Another tab changed the saved library. Reload to use that version, or back up this tab’s changes in Settings. This tab will not overwrite the other tab.');
        } else storageWarning('Your latest changes could not be saved. Back up your library in Settings before closing this page.');
        return false;
      });
      return saveQueue;
    }

    return { open: open, save: save, close: close, pending: function () { return saveQueue; } };
  }

  Bellasprak.library = { createEmpty: createEmptyLibrary, validate: validateLibrary, createStore: createStore };
}(window.Bellasprak = window.Bellasprak || {}));
