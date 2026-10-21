(function (Bellasprak) {
  'use strict';

  var config = Bellasprak.config;
  var languages = config.languages;
  var themes = config.themes;
  var usefulLetters = config.usefulLetters;
  var icons = config.icons;
  var sampleData = config.sampleData;
  var content = Bellasprak.content;
  var escapeHtml = content.escapeHtml;
  var escapeAttr = content.escapeAttr;
  var sanitizeHtml = content.sanitizeHtml;
  var stripHtml = content.stripHtml;
  var normalizeAnswer = content.normalizeAnswer;
  var normalizeUploadedText = content.normalizeUploadedText;
  var parseData = content.parseData;
  var validateLibrary = Bellasprak.library.validate;

  var state = {
    records: [],
    fields: [],
    decks: [],
    pendingDeck: '',
    activeDeck: '',
    activeRows: [],
    chunkIndex: 0,
    chunkSize: 5,
    practice: new Map(),
    revealAll: false,
    tempEnabledFields: [],
    speechButton: null,
    speechUtterance: null,
    speechToken: 0,
    speechColumn: null,
    answerField: -1,
    answerCollapsed: false,
    lastAnswer: null,
    lastSpeech: null,
    restoring: false
  };

  var library = Bellasprak.library.createEmpty();
  var themeTokenNames = Array.from(new Set(themes.flatMap(function (theme) { return Object.keys(theme.tokens); })));
  var defaultThemeColors = { accent: getComputedStyle(document.documentElement).getPropertyValue('--blue').trim(), paper: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() };
  var storageReady = false;
  var saveTimer = null;

  var els = {
    sourceTab: document.getElementById('sourceTab'),
    practiceTab: document.getElementById('practiceTab'),
    sourceView: document.getElementById('sourceView'),
    practiceView: document.getElementById('practiceView'),
    statusDot: document.getElementById('statusDot'),
    topStatusText: document.getElementById('topStatusText'),
    rawInput: document.getElementById('rawInput'),
    fileInput: document.getElementById('fileInput'),
    parseButton: document.getElementById('parseButton'),
    deckPicker: document.getElementById('deckPicker'),
    deckTrigger: document.getElementById('deckTrigger'),
    deckTriggerLabel: document.getElementById('deckTriggerLabel'),
    deckMenu: document.getElementById('deckMenu'),
    retrieveButton: document.getElementById('retrieveButton'),
    recordCount: document.getElementById('recordCount'),
    deckCount: document.getElementById('deckCount'),
    fieldCount: document.getElementById('fieldCount'),
    sourceEmpty: document.getElementById('sourceEmpty'),
    sourceTableWrap: document.getElementById('sourceTableWrap'),
    sourceTableHead: document.getElementById('sourceTableHead'),
    sourceTableBody: document.getElementById('sourceTableBody'),
    previousButton: document.getElementById('previousButton'),
    nextButton: document.getElementById('nextButton'),
    rangeSelect: document.getElementById('rangeSelect'),
    fieldsButton: document.getElementById('fieldsButton'),
    revealAllButton: document.getElementById('revealAllButton'),
    resetButton: document.getElementById('resetButton'),
    practiceProgressBar: document.getElementById('practiceProgressBar'),
    practiceEmpty: document.getElementById('practiceEmpty'),
    practiceTableWrap: document.getElementById('practiceTableWrap'),
    practiceTableHead: document.getElementById('practiceTableHead'),
    practiceTableBody: document.getElementById('practiceTableBody'),
    fieldsDialog: document.getElementById('fieldsDialog'),
    fieldOptions: document.getElementById('fieldOptions'),
    fieldSelectionNote: document.getElementById('fieldSelectionNote'),
    applyFieldsButton: document.getElementById('applyFieldsButton'),
    closeFieldsButton: document.getElementById('closeFieldsButton'),
    toastRegion: document.getElementById('toastRegion')
  };
  els.answerFeedback = document.getElementById('answerFeedback');
  ['practiceTable', 'settingsButton', 'settingsDialog', 'closeSettingsButton', 'themeOptions', 'speechRate', 'previewLanguage', 'previewVoiceButton', 'voiceDescription', 'voiceList', 'repeatPasses', 'enableShortcuts', 'answerField', 'backupButton', 'backupInput', 'restoreBackupLabel', 'libraryControls', 'libraryFilter', 'deleteDeckButton', 'storageNotice', 'repeatButton', 'keysButton', 'usefulKeys', 'keyLanguage', 'uppercaseKeys', 'keyButtons', 'keyHint', 'activeDeckName', 'groupPosition', 'reviewDate', 'completeDeckButton', 'undoCompletionButton', 'importDialog', 'importMessage', 'cancelImportButton', 'confirmImportButton'].forEach(function (name) {
    els[name] = document.getElementById(name);
  });

  var libraryStore = Bellasprak.library.createStore(storageWarning);
  var speech = Bellasprak.speech.create({
    state: state, els: els, getCurrentChunk: getCurrentChunk, showToast: showToast,
    getPreferences: function () { return library.preferences; }
  });
  var cancelSpeech = speech.cancelSpeech;
  var speakField = speech.speakField;
  var speakColumn = speech.speakColumn;
  var playSpeech = speech.playSpeech;
  var refreshVoices = speech.refreshVoices;
  var renderVoiceOptions = speech.renderVoiceOptions;

  function applyTheme() {
    var theme = themes.find(function (item) { return item.id === library.preferences.theme; }) || themes[0];
    themeTokenNames.forEach(function (name) { document.documentElement.style.removeProperty(name); });
    Object.keys(theme.tokens).forEach(function (name) { document.documentElement.style.setProperty(name, theme.tokens[name]); });
    document.documentElement.dataset.theme = theme.id;
    document.querySelector('meta[name="theme-color"]').content = 'rgb(' + (theme.tokens['--nav-rgb'] || '9, 15, 31') + ')';
  }

  function renderThemeOptions() {
    els.themeOptions.innerHTML = themes.map(function (theme) {
      var selected = library.preferences.theme === theme.id;
      var swatches = [theme.tokens['--paper'] || defaultThemeColors.paper, theme.tokens['--blue'] || defaultThemeColors.accent, 'rgb(' + (theme.tokens['--nav-rgb'] || '9, 15, 31') + ')'];
      var preview = theme.tokens['--page-gradient']
        ? '<span class="theme-gradient-preview" aria-hidden="true" style="--theme-preview:' + escapeAttr(theme.tokens['--page-gradient']) + '"></span>'
        : '<span class="theme-swatches" aria-hidden="true">' + swatches.map(function (color) { return '<span style="--swatch:' + color + '"></span>'; }).join('') + '</span>';
      return '<button class="theme-option" type="button" role="radio" aria-checked="' + selected + '" tabindex="' + (selected ? '0' : '-1') + '" data-theme-choice="' + theme.id + '">' + preview + '<span>' + theme.name + '</span><span class="theme-check" aria-hidden="true">' + (selected ? '✓' : '') + '</span></button>';
    }).join('');
  }

  function chooseTheme(id) {
    if (!themes.some(function (theme) { return theme.id === id; })) return;
    library.preferences.theme = id;
    applyTheme();
    renderThemeOptions();
    els.themeOptions.querySelector('[data-theme-choice="' + id + '"]').focus();
    persistLibrary();
  }

  function storageWarning(message) {
    els.storageNotice.textContent = message;
    els.storageNotice.hidden = false;
  }

  function saveCurrentDeck() {
    if (!state.activeDeck) return;
    library.deckSettings[state.activeDeck] = {
      fields: state.fields.map(function (field) { return Object.assign({}, field); }),
      answerField: state.answerField,
      answerCollapsed: state.answerCollapsed,
      chunk: state.chunkIndex
    };
  }

  function persistLibrary() {
    if (state.restoring) return libraryStore.pending();
    saveCurrentDeck();
    library.session = { deck: state.activeDeck, chunk: state.chunkIndex, view: els.practiceView.hidden ? 'source' : 'practice' };
    return libraryStore.save(library);
  }

  function scheduleSave() {
    if (state.restoring) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(persistLibrary, 150);
  }

  function syncLibraryUI() {
    state.records = library.records;
    state.decks = Array.from(new Set(state.records.map(function (record) { return record.deck; }))).sort();
    var hasRecords = state.records.length > 0;
    els.recordCount.textContent = String(state.records.length);
    els.deckCount.textContent = String(state.decks.length);
    els.fieldCount.textContent = String(state.fields.length);
    els.libraryControls.hidden = !hasRecords;
    els.deckTrigger.disabled = !hasRecords;
    els.retrieveButton.disabled = !state.pendingDeck || !hasRecords;
    els.deleteDeckButton.disabled = !state.pendingDeck || !hasRecords;
    els.deckTriggerLabel.textContent = state.pendingDeck || 'Import data to choose a deck';
    renderDeckMenu();
    updateTopStatus();
  }

  function restoreLibraryUI() {
    state.restoring = true;
    cancelSpeech();
    applyTheme();
    state.fields = [];
    resetLoadedData();
    state.pendingDeck = library.session.deck || (library.records[0] && library.records[0].deck) || '';
    syncLibraryUI();
    if (state.pendingDeck && state.records.some(function (record) { return isDeckMatch(record.deck, state.pendingDeck); })) {
      retrieveData(true);
      switchView(library.session.view || 'source');
    } else {
      state.pendingDeck = state.decks[0] || '';
      syncLibraryUI();
      switchView('source');
    }
    renderUsefulKeys();
    state.restoring = false;
  }

  async function initializeLibrary() {
    els.parseButton.disabled = true;
    try {
      var saved = await libraryStore.open();
      if (saved) library = validateLibrary(saved);
      restoreLibraryUI();
      if (location.protocol === 'file:') storageWarning('Local-file storage depends on this browser and file location. Keep a library backup in Settings before moving this file.');
    } catch (error) {
      libraryStore.close();
      storageWarning('Saved storage is unavailable or could not be read. You can practice, but back up this session in Settings before closing it.');
    } finally {
      storageReady = true;
      els.parseButton.disabled = false;
      document.documentElement.dataset.libraryReady = 'true';
    }
  }

  function confirmImport(count) {
    els.importMessage.textContent = count + (count === 1 ? ' imported deck already exists in your library.' : ' imported decks already exist in your library.');
    els.importDialog.returnValue = '';
    els.importDialog.showModal();
    return new Promise(function (resolve) {
      els.importDialog.addEventListener('close', function () { resolve(els.importDialog.returnValue === 'update'); }, { once: true });
    });
  }

  function completionAction(undo) {
    if (!state.activeDeck) return;
    if (undo) delete library.completed[state.activeDeck];
    else library.completed[state.activeDeck] = new Date().toISOString();
    renderDeckMenu();
    updatePracticeControls();
    persistLibrary();
  }

  function deleteSelectedDeck() {
    var deck = state.pendingDeck;
    if (!deck || !window.confirm('Delete “' + deck + '” and its subdecks from this library? Other decks will be kept.')) return;
    saveCurrentDeck();
    library.records = library.records.filter(function (record) { return !isDeckMatch(record.deck, deck); });
    [library.deckSettings, library.completed].forEach(function (settings) { Object.keys(settings).forEach(function (path) { if (isDeckMatch(path, deck)) delete settings[path]; }); });
    library.session = {};
    state.fields = [];
    restoreLibraryUI();
    persistLibrary();
    showToast('Selected deck and its subdecks were deleted. Restore a previous backup to recover them.', 'info');
  }

  function showToast(message, type) {
    var toast = document.createElement('div');
    toast.className = 'toast ' + (type || 'info');
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.innerHTML = '<span class="toast-icon">' + (type === 'success' ? '✓' : type === 'error' ? '!' : 'i') + '</span><span>' + escapeHtml(message) + '</span>';
    els.toastRegion.appendChild(toast);

    window.setTimeout(function () {
      toast.classList.add('is-leaving');
      window.setTimeout(function () {
        toast.remove();
      }, 190);
    }, 3200);
  }

  function updateTopStatus() {
    if (state.activeRows.length) {
      els.statusDot.classList.add('ready');
      els.topStatusText.textContent = state.activeRows.length + ' cards ready';
    } else if (state.records.length) {
      els.statusDot.classList.add('ready');
      els.topStatusText.textContent = state.records.length + ' records parsed';
    } else {
      els.statusDot.classList.remove('ready');
      els.topStatusText.textContent = 'Waiting for data';
    }
  }

  function switchView(name) {
    cancelSpeech();
    var isSource = name === 'source';
    els.sourceTab.setAttribute('aria-selected', String(isSource));
    els.practiceTab.setAttribute('aria-selected', String(!isSource));
    els.sourceView.hidden = !isSource;
    els.practiceView.hidden = isSource;

    if (!isSource) {
      renderPractice();
    }
    scheduleSave();
  }

  function makeDeckTree(deckNames) {
    var root = Object.create(null);
    var exactCounts = Object.create(null);

    state.records.forEach(function (record) {
      exactCounts[record.deck] = (exactCounts[record.deck] || 0) + 1;
    });

    deckNames.forEach(function (deckName) {
      var parts = deckName.split('::').map(function (part) {
        return part.trim();
      }).filter(Boolean);
      var cursor = root;
      var path = [];

      parts.forEach(function (part) {
        path.push(part);
        if (!cursor[part]) {
          cursor[part] = { name: part, fullPath: path.join('::'), children: Object.create(null) };
        }
        cursor = cursor[part].children;
      });
    });

    function addInclusiveCounts(nodes) {
      Object.keys(nodes).forEach(function (key) {
        var node = nodes[key];
        addInclusiveCounts(node.children);
        node.count = state.records.filter(function (record) {
          return record.deck === node.fullPath || record.deck.indexOf(node.fullPath + '::') === 0;
        }).length;
        node.exactCount = exactCounts[node.fullPath] || 0;
      });
    }

    addInclusiveCounts(root);
    return root;
  }

  function renderDeckNode(node) {
    var children = Object.keys(node.children).sort().map(function (key) {
      return renderDeckNode(node.children[key]);
    }).join('');
    var hasChildren = Boolean(children);
    var completed = Boolean(library.completed[node.fullPath]);
    if (els.libraryFilter.value === 'completed' && !completed && !hasChildren) return '';
    var isSelected = state.pendingDeck === node.fullPath;
    var isOpen = isSelected || state.pendingDeck.indexOf(node.fullPath + '::') === 0 || els.libraryFilter.value === 'completed';

    return '<li class="deck-node' + (isOpen ? ' is-open' : '') + '" role="treeitem"' + (hasChildren ? ' aria-expanded="' + String(isOpen) + '"' : '') + '>' +
      '<div class="deck-line">' +
        '<button class="deck-expand" type="button" ' + (hasChildren ? '' : 'disabled') + ' aria-label="' + (hasChildren ? 'Expand or collapse ' + escapeAttr(node.name) : '') + '">' + icons.chevronRight + '</button>' +
        '<button class="deck-option' + (isSelected ? ' is-selected' : '') + (completed ? ' is-completed' : '') + '" type="button" data-deck="' + escapeAttr(node.fullPath) + '">' +
          '<span class="deck-option-name">' + escapeHtml(node.name) + (completed ? '<span class="completed-label"> ✓ Completed</span>' : '') + '</span>' +
          '<span class="deck-count">' + node.count + '</span>' +
        '</button>' +
      '</div>' +
      (hasChildren ? '<ul class="deck-children" role="group">' + children + '</ul>' : '') +
    '</li>';
  }

  function renderDeckMenu() {
    var tree = makeDeckTree(state.decks);
    var html = Object.keys(tree).sort().map(function (key) {
      return renderDeckNode(tree[key]);
    }).join('');

    els.deckMenu.innerHTML = html ? '<ul class="deck-tree" role="tree">' + html + '</ul>' : '<p class="settings-note">' + (els.libraryFilter.value === 'completed' ? 'No completed decks yet.' : 'No decks found.') + '</p>';
  }

  function resetLoadedData() {
    state.activeDeck = '';
    state.activeRows = [];
    state.chunkIndex = 0;
    state.answerCollapsed = false;
    state.practice.clear();
    state.revealAll = false;
    els.sourceTableWrap.hidden = true;
    els.sourceEmpty.hidden = false;
    els.practiceTableWrap.hidden = true;
    els.practiceEmpty.hidden = false;
    updatePracticeControls();
  }

  async function handleParse() {
    if (!storageReady || els.importDialog.open) return;
    els.parseButton.disabled = true;
    try {
      var result = parseData(els.rawInput.value);
      var importedDecks = new Set(result.records.map(function (record) { return record.deck; }));
      var overlaps = Array.from(importedDecks).filter(function (deck) { return state.decks.indexOf(deck) >= 0; });
      if (overlaps.length && !(await confirmImport(overlaps.length))) return;
      saveCurrentDeck();
      library.records = library.records.filter(function (record) { return !importedDecks.has(record.deck); }).concat(result.records);
      state.pendingDeck = result.records[0].deck;
      resetLoadedData();
      state.fields = [];
      els.libraryFilter.value = 'all';
      syncLibraryUI();
      els.fieldCount.textContent = String(result.maxFields);
      await persistLibrary();

      var message = result.records.length + ' records imported across ' + importedDecks.size + (importedDecks.size === 1 ? ' deck.' : ' decks.');
      if (result.errors) {
        message += ' ' + result.errors + (result.errors === 1 ? ' malformed row was skipped.' : ' malformed rows were skipped.');
      }
      if (result.inconsistentWidths) {
        message += ' Short rows were padded to keep the columns aligned.';
      }
      showToast(message, 'success');
      return result;
    } catch (error) {
      showToast(error.message || 'The data could not be parsed.', 'error');
    } finally {
      els.parseButton.disabled = false;
    }
  }

  function isDeckMatch(recordDeck, selectedDeck) {
    return recordDeck === selectedDeck || recordDeck.indexOf(selectedDeck + '::') === 0;
  }

  function retrieveData(restoring) {
    restoring = restoring === true;
    if (!state.pendingDeck) {
      showToast('Choose a deck before retrieving data.', 'error');
      return;
    }

    var matching = state.records.filter(function (record) {
      return isDeckMatch(record.deck, state.pendingDeck);
    });

    if (!matching.length) {
      showToast('No records were found for that deck.', 'error');
      return;
    }

    saveCurrentDeck();
    cancelSpeech();
    state.activeDeck = state.pendingDeck;
    state.activeRows = matching;
    var saved = library.deckSettings[state.activeDeck] || {};
    var width = matching.reduce(function (maximum, record) { return Math.max(maximum, record.fields.length); }, 0);
    state.fields = Array.from({ length: width }, function (_, index) {
      var previous = saved.fields && saved.fields[index];
      return previous ? Object.assign({}, previous) : { name: 'Field ' + (index + 1), language: index === 1 ? 'de-DE' : 'en-US', enabled: true, visible: false };
    });
    if (!state.fields.some(function (field) { return field.enabled; })) state.fields[0].enabled = true;
    state.answerField = Number.isInteger(saved.answerField) && state.fields[saved.answerField] && state.fields[saved.answerField].enabled ? saved.answerField : -1;
    state.answerCollapsed = saved.answerCollapsed === true;
    state.chunkIndex = Math.min(restoring && library.session.deck === state.activeDeck ? library.session.chunk || 0 : saved.chunk || 0, getChunkCount() - 1);
    state.practice.clear();
    state.revealAll = false;

    renderSourceTable();
    populateRanges();
    renderPractice();
    updateTopStatus();
    els.fieldCount.textContent = String(state.fields.length);
    if (!restoring) {
      persistLibrary();
      showToast(matching.length + (matching.length === 1 ? ' card is' : ' cards are') + ' ready to practice.', 'success');
    }
  }

  function languageOptions(selectedCode) {
    return languages.map(function (language) {
      return '<option value="' + language.code + '"' + (language.code === selectedCode ? ' selected' : '') + '>' + escapeHtml(language.label) + '</option>';
    }).join('');
  }

  function renderSourceTable() {
    var headerCells = state.fields.map(function (field, index) {
      return '<th scope="col">' +
        '<div class="header-control">' +
          '<label class="sr-only" for="fieldName' + index + '">Name for field ' + (index + 1) + '</label>' +
          '<input class="header-name" id="fieldName' + index + '" data-field-name="' + index + '" value="' + escapeAttr(field.name) + '" aria-label="Editable name for field ' + (index + 1) + '">' +
          '<label class="sr-only" for="fieldLanguage' + index + '">Speech language for ' + escapeHtml(field.name) + '</label>' +
          '<select class="language-select" id="fieldLanguage' + index + '" data-field-language="' + index + '" aria-label="Speech language for ' + escapeAttr(field.name) + '">' +
            languageOptions(field.language) +
          '</select>' +
        '</div>' +
      '</th>';
    }).join('');

    els.sourceTableHead.innerHTML = '<tr><th class="number-col" scope="col">#</th>' + headerCells + '</tr>';
    els.sourceTableBody.innerHTML = state.activeRows.map(function (record, rowIndex) {
      var cells = state.fields.map(function (_, fieldIndex) {
        return '<td class="source-cell">' + sanitizeHtml(record.fields[fieldIndex] || '') + '</td>';
      }).join('');
      return '<tr style="animation-delay:' + Math.min(rowIndex * 24, 180) + 'ms"><td class="number-col">' + (rowIndex + 1) + '</td>' + cells + '</tr>';
    }).join('');

    els.sourceEmpty.hidden = true;
    els.sourceTableWrap.hidden = false;
    updatePracticeControls();
  }

  function getChunkCount() {
    return Math.ceil(state.activeRows.length / state.chunkSize);
  }

  function populateRanges() {
    var chunkCount = getChunkCount();
    if (!chunkCount) {
      els.rangeSelect.innerHTML = '<option>No rows</option>';
      els.rangeSelect.disabled = true;
      return;
    }

    els.rangeSelect.innerHTML = Array.from({ length: chunkCount }, function (_, index) {
      var start = index * state.chunkSize + 1;
      var end = Math.min((index + 1) * state.chunkSize, state.activeRows.length);
      return '<option value="' + index + '">' + start + '-' + end + '</option>';
    }).join('');
    els.rangeSelect.value = String(state.chunkIndex);
    els.rangeSelect.disabled = false;
  }

  function getCurrentChunk() {
    var start = state.chunkIndex * state.chunkSize;
    return state.activeRows.slice(start, start + state.chunkSize);
  }

  function getSelectedFieldIndexes() {
    return state.fields.map(function (field, index) {
      return field.enabled ? index : -1;
    }).filter(function (index) {
      return index >= 0;
    });
  }

  function getRowPractice(recordId) {
    if (!state.practice.has(recordId)) {
      state.practice.set(recordId, { value: '', result: '', revealed: false });
    }
    return state.practice.get(recordId);
  }

  function isColumnVisible(fieldIndex) {
    return Boolean(state.revealAll || state.fields[fieldIndex].visible || getCurrentChunk().some(function (record) { return getRowPractice(record.id).revealed; }));
  }

  function visibilityControl(fieldIndex, visible, name) {
    var label = (visible ? 'Hide ' : 'Show ') + name + ' column';
    return '<button class="header-icon column-toggle" type="button" data-column-toggle="' + fieldIndex + '" aria-pressed="' + visible + '" aria-label="' + escapeAttr(label) + '" title="' + escapeAttr(label) + '">' + (visible ? icons.eye : icons.eyeOff) + '</button>';
  }

  function renderPractice() {
    cancelSpeech();
    if (!state.activeRows.length) {
      els.practiceEmpty.hidden = false;
      els.practiceTableWrap.hidden = true;
      updatePracticeControls();
      return;
    }

    var selectedFields = getSelectedFieldIndexes();
    if (!selectedFields.length) {
      state.fields[0].enabled = true;
      selectedFields = [0];
    }

    var chunk = getCurrentChunk();
    var startNumber = state.chunkIndex * state.chunkSize + 1;
    var answerContract = state.answerField < 0 ? 'Optional · matches any included field' : 'Optional · matches ' + state.fields[state.answerField].name;
    var visibleColumns = {};
    var dynamicHeaders = selectedFields.map(function (fieldIndex) {
      var visible = isColumnVisible(fieldIndex);
      var name = state.fields[fieldIndex].name;
      visibleColumns[fieldIndex] = visible;
      return '<th scope="col" class="reference-heading' + (visible ? '' : ' is-concealed') + '" data-practice-field="' + fieldIndex + '"><div class="practice-table-header"><span class="practice-header-title" title="' + escapeAttr(name) + '">' + escapeHtml(name) + '</span><div class="practice-header-actions">' + visibilityControl(fieldIndex, visible, name) + '<button class="header-icon column-audio" type="button" data-speak-column="' + fieldIndex + '" data-column-name="' + escapeAttr(name) + '" aria-label="Play entire ' + escapeAttr(name) + ' column in this group" title="Play entire column · ' + escapeAttr(name) + '" aria-pressed="false">' + icons.play + '</button></div></div></th>';
    }).join('');

    els.practiceTableHead.innerHTML = '<tr>' +
      '<th class="number-col practice-number-col" scope="col"><span aria-hidden="true">#</span><span class="sr-only">Item and reference visibility</span></th>' +
      '<th class="answer-col' + (state.answerCollapsed ? ' is-collapsed' : '') + '" scope="col"><div class="practice-table-header"><span class="practice-header-title" title="' + escapeAttr(answerContract) + '">Your answer</span><div class="practice-header-actions">' + visibilityControl('answer', !state.answerCollapsed, 'answer') + '</div><span class="answer-contract sr-only">' + escapeHtml(answerContract) + '</span></div></th>' +
      dynamicHeaders +
    '</tr>';

    els.practiceTableBody.innerHTML = chunk.map(function (record, localIndex) {
      var practice = getRowPractice(record.id);
      var isVisible = state.revealAll || practice.revealed;
      var answerClass = practice.result ? ' is-' + practice.result : '';
      var mark = practice.result === 'correct' ? '✓' : practice.result === 'incorrect' ? '×' : '';
      var rowNumber = startNumber + localIndex;

      var referenceCells = selectedFields.map(function (fieldIndex) {
        var text = record.fields[fieldIndex] || '';
        if (!isVisible && !state.fields[fieldIndex].visible) {
          return '<td class="reference-cell' + (visibleColumns[fieldIndex] ? '' : ' is-concealed') + '" data-practice-field="' + fieldIndex + '"><span class="hidden-reference" aria-label="Hidden reference">•••••</span></td>';
        }

        return '<td class="reference-cell" data-practice-field="' + fieldIndex + '">' +
          '<div class="reference-content">' +
            '<span class="reference-text">' + sanitizeHtml(text) + '</span>' +
            (stripHtml(text) ? '<button class="tts-button" type="button" data-speak-row="' + localIndex + '" data-speak-field="' + fieldIndex + '" aria-label="Play ' + escapeAttr(state.fields[fieldIndex].name) + '" title="Play pronunciation" aria-pressed="false">' + icons.play + '</button>' : '') +
          '</div>' +
        '</td>';
      }).join('');

      return '<tr data-record-id="' + escapeAttr(record.id) + '" style="animation-delay:' + (localIndex * 35) + 'ms">' +
        '<td class="number-col practice-number-col"><div class="item-controls"><span class="item-number">' + rowNumber + '</span>' +
          '<button class="view-toggle" type="button" data-reveal-row="' + localIndex + '" aria-pressed="' + String(practice.revealed) + '" aria-label="' + (practice.revealed ? 'Hide' : 'View') + ' reference for row ' + rowNumber + '" title="' + (practice.revealed ? 'Hide' : 'View') + ' reference for row ' + rowNumber + '">' +
            (practice.revealed ? icons.eyeOff : icons.eye) +
          '</button>' +
        '</div></td>' +
        '<td class="answer-col' + (state.answerCollapsed ? ' is-collapsed' : '') + '">' +
          '<span class="collapsed-answer" aria-hidden="true"' + (state.answerCollapsed ? '' : ' hidden') + '>•••</span>' +
          '<div class="answer-wrap' + answerClass + '"' + (state.answerCollapsed ? ' hidden' : '') + '>' +
            '<label class="sr-only" for="answer-' + record.id + '">Answer for row ' + rowNumber + '</label>' +
            '<input class="answer-input" id="answer-' + record.id + '" data-local-index="' + localIndex + '" value="' + escapeAttr(practice.value) + '" placeholder="Type, then press Enter" autocomplete="off" spellcheck="false" aria-invalid="' + String(practice.result === 'incorrect') + '"' + (practice.revealed ? ' disabled' : '') + '>' +
            '<span class="answer-mark" aria-hidden="true">' + mark + '</span>' +
          '</div>' +
        '</td>' +
        referenceCells +
      '</tr>';
    }).join('');

    els.practiceEmpty.hidden = true;
    els.practiceTableWrap.hidden = false;
    updatePracticeControls();
    renderUsefulKeys();
  }

  function updatePracticeControls() {
    var hasRows = state.activeRows.length > 0;
    var chunkCount = getChunkCount();
    els.fieldsButton.disabled = !hasRows;
    els.revealAllButton.disabled = !hasRows;
    els.resetButton.disabled = !hasRows;
    els.rangeSelect.disabled = !hasRows;
    els.previousButton.disabled = !hasRows || state.chunkIndex <= 0;
    els.nextButton.disabled = !hasRows || state.chunkIndex >= chunkCount - 1;
    els.repeatButton.hidden = !library.preferences.repeatPasses;
    els.repeatButton.disabled = !hasRows;
    els.keysButton.disabled = !hasRows || state.answerCollapsed;
    els.completeDeckButton.disabled = !hasRows;
    els.completeDeckButton.textContent = library.completed[state.activeDeck] ? 'Reviewed today' : 'Mark completed';
    els.undoCompletionButton.hidden = !library.completed[state.activeDeck];
    els.activeDeckName.textContent = state.activeDeck;
    els.activeDeckName.style.overflowWrap = 'anywhere';
    els.reviewDate.textContent = library.completed[state.activeDeck] ? 'Completed · Last reviewed ' + new Date(library.completed[state.activeDeck]).toLocaleDateString() : '';
    els.groupPosition.textContent = hasRows ? 'Group ' + (state.chunkIndex + 1) + ' of ' + chunkCount + ' · Words ' + (state.chunkIndex * state.chunkSize + 1) + '–' + Math.min((state.chunkIndex + 1) * state.chunkSize, state.activeRows.length) + ' of ' + state.activeRows.length : 'No group selected';
    els.revealAllButton.setAttribute('aria-pressed', String(state.revealAll));
    els.revealAllButton.classList.toggle('is-active', state.revealAll);
    els.revealAllButton.lastChild.nodeValue = state.revealAll ? ' Hide all' : ' Reveal all';
    els.practiceProgressBar.style.width = hasRows ? (((state.chunkIndex + 1) / chunkCount) * 100) + '%' : '0%';
  }

  function clearPracticeForNavigation() {
    state.practice.clear();
    state.revealAll = false;
    cancelSpeech();
    state.lastAnswer = null;
  }

  function changeChunk(nextIndex, focusAnswer) {
    var chunkCount = getChunkCount();
    if (nextIndex < 0 || nextIndex >= chunkCount || nextIndex === state.chunkIndex) return;
    clearPracticeForNavigation();
    state.chunkIndex = nextIndex;
    els.rangeSelect.value = String(nextIndex);
    renderPractice();
    persistLibrary();

    if (focusAnswer === false || state.answerCollapsed) return;
    window.requestAnimationFrame(function () {
      var firstInput = els.practiceTableBody.querySelector('.answer-input');
      if (firstInput) firstInput.focus();
    });
  }

  function checkAnswer(localIndex) {
    var chunk = getCurrentChunk();
    var record = chunk[localIndex];
    var input = els.practiceTableBody.querySelector('.answer-input[data-local-index="' + localIndex + '"]');
    if (!record || !input) return;

    var practice = getRowPractice(record.id);
    practice.value = input.value;
    var normalized = normalizeAnswer(input.value);
    var accepted = (state.answerField < 0 ? getSelectedFieldIndexes() : [state.answerField]).map(function (fieldIndex) {
      return normalizeAnswer(record.fields[fieldIndex] || '');
    }).filter(Boolean);
    practice.result = normalized && accepted.indexOf(normalized) >= 0 ? 'correct' : 'incorrect';

    var wrap = input.closest('.answer-wrap');
    var mark = wrap.querySelector('.answer-mark');
    wrap.classList.remove('is-correct', 'is-incorrect');
    wrap.classList.add('is-' + practice.result);
    mark.textContent = practice.result === 'correct' ? '✓' : '×';
    input.setAttribute('aria-invalid', String(practice.result === 'incorrect'));
    els.answerFeedback.textContent = 'Row ' + (state.chunkIndex * state.chunkSize + localIndex + 1) + ': ' + practice.result + '.';

    var nextInput = !state.answerCollapsed && Array.prototype.slice.call(els.practiceTableBody.querySelectorAll('.answer-input:not(:disabled)')).find(function (item) { return Number(item.dataset.localIndex) > localIndex; });
    if (nextInput) {
      nextInput.focus();
      nextInput.select();
    } else {
      input.blur();
      var checked = chunk.every(function (row) { return Boolean(getRowPractice(row.id).result); });
      showToast(checked ? 'All answers checked. Review or continue when ready.' : 'End of group. Continue reviewing at your own pace.', 'info');
    }
  }

  function toggleRowReveal(localIndex) {
    var record = getCurrentChunk()[localIndex];
    if (!record) return;
    var practice = getRowPractice(record.id);
    practice.revealed = !practice.revealed;

    if (practice.revealed) {
      practice.value = '';
      practice.result = '';
    }

    cancelSpeech();

    renderPractice();
  }

  function toggleColumn(fieldIndex) {
    if (fieldIndex === 'answer') { toggleAnswerColumn(); return; }
    if (!state.fields[fieldIndex] || !state.fields[fieldIndex].enabled) return;
    var wasVisible = isColumnVisible(fieldIndex);
    if (state.revealAll) state.fields.forEach(function (field) { if (field.enabled) field.visible = true; });
    state.revealAll = false;
    state.practice.forEach(function (practice) { practice.revealed = false; });
    state.fields[fieldIndex].visible = !wasVisible;
    cancelSpeech();
    renderPractice();
    persistLibrary();
    var button = els.practiceTableHead.querySelector('[data-column-toggle="' + fieldIndex + '"]');
    if (button) button.focus();
  }

  function toggleAnswerColumn() {
    state.answerCollapsed = !state.answerCollapsed;
    els.practiceTable.querySelectorAll('.answer-col').forEach(function (cell) { cell.classList.toggle('is-collapsed', state.answerCollapsed); });
    els.practiceTableBody.querySelectorAll('.answer-wrap').forEach(function (wrap) { wrap.hidden = state.answerCollapsed; });
    els.practiceTableBody.querySelectorAll('.collapsed-answer').forEach(function (placeholder) { placeholder.hidden = !state.answerCollapsed; });
    var button = els.practiceTableHead.querySelector('[data-column-toggle="answer"]');
    var label = (state.answerCollapsed ? 'Show' : 'Hide') + ' answer column';
    button.innerHTML = state.answerCollapsed ? icons.eyeOff : icons.eye;
    button.setAttribute('aria-pressed', String(!state.answerCollapsed));
    button.setAttribute('aria-label', label);
    button.title = label;
    updatePracticeControls();
    renderUsefulKeys();
    persistLibrary();
  }

  function repeatGroup() {
    if (!library.preferences.repeatPasses || !state.activeRows.length) return;
    state.practice.clear();
    cancelSpeech();
    renderPractice();
    var input = els.practiceTableBody.querySelector('.answer-input');
    if (input && !state.answerCollapsed) input.focus();
    showToast('Same group, same order. Column visibility has been kept.', 'info');
  }

  function rememberAnswer(input) {
    if (input && input.matches('.answer-input')) state.lastAnswer = { id: input.id, start: input.selectionStart, end: input.selectionEnd };
  }

  function renderUsefulKeys() {
    els.usefulKeys.hidden = !library.preferences.keys || !state.activeRows.length || state.answerCollapsed;
    els.keysButton.setAttribute('aria-pressed', String(library.preferences.keys));
    els.keyLanguage.value = library.preferences.keyLanguage;
    var letters = usefulLetters[library.preferences.keyLanguage] || [];
    els.keyButtons.innerHTML = letters.map(function (letter) {
      var value = els.uppercaseKeys.checked ? (letter === 'ß' ? 'ẞ' : letter.toLocaleUpperCase()) : letter;
      return '<button class="key-button" type="button" data-letter="' + escapeAttr(value) + '" aria-label="Insert ' + escapeAttr(value) + '">' + escapeHtml(value) + '</button>';
    }).join('');
    els.keyHint.textContent = letters.length ? 'Choose an answer field, then insert a letter at the cursor.' : 'No extra letters are needed in this panel for this language.';
  }

  function toggleUsefulKeys() {
    library.preferences.keys = !library.preferences.keys;
    renderUsefulKeys();
    persistLibrary();
  }

  function insertUsefulLetter(letter) {
    if (state.answerCollapsed) return;
    var last = state.lastAnswer;
    var input = last && document.getElementById(last.id);
    if (!input || input.disabled) { showToast('Choose an editable answer field first.', 'info'); return; }
    input.focus();
    input.setSelectionRange(last.start, last.end);
    input.setRangeText(letter, last.start, last.end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    rememberAnswer(input);
  }

  function openSettings() {
    cancelSpeech();
    renderThemeOptions();
    els.speechRate.value = String(library.preferences.rate);
    els.repeatPasses.checked = library.preferences.repeatPasses;
    els.enableShortcuts.checked = library.preferences.shortcuts;
    els.answerField.innerHTML = '<option value="-1">Any included field</option>' + getSelectedFieldIndexes().map(function (index) { return '<option value="' + index + '">' + escapeHtml(state.fields[index].name) + '</option>'; }).join('');
    els.answerField.value = String(state.answerField);
    els.answerField.disabled = !state.activeRows.length;
    els.settingsDialog.showModal();
    els.settingsDialog.scrollTop = 0;
    renderVoiceOptions();
  }

  function exportLibrary() {
    saveCurrentDeck();
    library.session = { deck: state.activeDeck, chunk: state.chunkIndex, view: els.practiceView.hidden ? 'source' : 'practice' };
    var blob = new Blob([JSON.stringify(library, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'bellasprak-library-' + new Date().toISOString().slice(0, 10) + '.json';
    link.click();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function hasShortcutModifier(event) {
    return event.ctrlKey || event.metaKey || event.altKey || (event.getModifierState && event.getModifierState('AltGraph'));
  }

  function handleShortcut(event) {
    if (!library.preferences.shortcuts || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || hasShortcutModifier(event)) return;
    var target = event.target;
    if (target instanceof Element && (target.closest('input, textarea, select') || target.isContentEditable || target.closest('[contenteditable]:not([contenteditable="false"])'))) return;
    if (document.querySelector('dialog[open]') || !els.deckMenu.hidden) return;
    if (event.key === '?') { event.preventDefault(); openSettings(); return; }
    if (els.practiceView.hidden || !state.activeRows.length) return;
    var key = event.key.toLocaleLowerCase();
    var action = null;
    if ((key === '[' || key === 'b') && state.chunkIndex > 0) action = function () { changeChunk(state.chunkIndex - 1, false); };
    if ((key === ']' || key === 'n') && state.chunkIndex < getChunkCount() - 1) action = function () { changeChunk(state.chunkIndex + 1, false); };
    if (/^[1-9]$/.test(key)) {
      var index = getSelectedFieldIndexes()[Number(key) - 1];
      if (index !== undefined) action = function () { toggleColumn(index); };
    }
    if (key === 'v') action = function () { els.revealAllButton.click(); };
    if (key === 'f') action = openFieldsDialog;
    if (key === 'k') action = toggleUsefulKeys;
    if (key === 'p' && library.preferences.repeatPasses) action = repeatGroup;
    if (key === 'r' && state.lastSpeech) {
      var replay = els.practiceTableBody.querySelector('[data-speak-row="' + state.lastSpeech.row + '"][data-speak-field="' + state.lastSpeech.field + '"]');
      if (replay && getCurrentChunk()[state.lastSpeech.row] && getCurrentChunk()[state.lastSpeech.row].id === state.lastSpeech.id) action = function () { cancelSpeech(); replay.click(); };
    }
    if (action) { event.preventDefault(); action(); }
  }

  function resetPractice() {
    state.practice.clear();
    state.revealAll = false;
    state.fields.forEach(function (field) { field.visible = false; });
    cancelSpeech();
    renderPractice();
    persistLibrary();
    showToast('This practice range has been reset.', 'info');
  }

  function openFieldsDialog() {
    cancelSpeech();
    state.tempEnabledFields = state.fields.map(function (field) {
      return field.enabled;
    });
    renderFieldOptions();
    els.fieldsDialog.showModal();
  }

  function renderFieldOptions() {
    els.fieldOptions.innerHTML = state.fields.map(function (field, index) {
      var language = languages.find(function (item) {
        return item.code === field.language;
      });
      return '<label class="field-option">' +
        '<input type="checkbox" data-field-toggle="' + index + '"' + (state.tempEnabledFields[index] ? ' checked' : '') + '>' +
        '<span class="field-option-name">' + escapeHtml(field.name) + '</span>' +
        '<span class="language-badge">' + escapeHtml(language ? language.label : field.language) + '</span>' +
      '</label>';
    }).join('');
    updateFieldDialogState();
  }

  function updateFieldDialogState() {
    var selectedCount = state.tempEnabledFields.filter(Boolean).length;
    els.applyFieldsButton.disabled = selectedCount === 0;
    els.fieldSelectionNote.textContent = selectedCount + (selectedCount === 1 ? ' field selected' : ' fields selected');
  }

  function applyFieldSelection() {
    state.fields.forEach(function (field, index) {
      field.enabled = Boolean(state.tempEnabledFields[index]);
    });
    state.practice.forEach(function (practice) { practice.result = ''; });
    if (state.answerField >= 0 && !state.fields[state.answerField].enabled) state.answerField = -1;
    cancelSpeech();
    els.fieldsDialog.close();
    renderPractice();
    persistLibrary();
    showToast('Practice fields updated.', 'success');
  }

  function closeDeckMenu() {
    els.deckMenu.hidden = true;
    els.deckTrigger.setAttribute('aria-expanded', 'false');
  }

  els.sourceTab.addEventListener('click', function () {
    switchView('source');
  });

  els.practiceTab.addEventListener('click', function () {
    switchView('practice');
  });

  [els.sourceTab, els.practiceTab].forEach(function (tab, index, tabs) {
    tab.addEventListener('keydown', function (event) {
      if (hasShortcutModifier(event) || event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
      var targetIndex = index;
      if (event.key === 'ArrowRight') targetIndex = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') targetIndex = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') targetIndex = 0;
      else if (event.key === 'End') targetIndex = tabs.length - 1;
      else return;

      event.preventDefault();
      tabs[targetIndex].click();
      tabs[targetIndex].focus();
    });
  });

  els.parseButton.addEventListener('click', handleParse);
  els.rawInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !hasShortcutModifier(event) && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && !event.repeat && !event.defaultPrevented) {
      event.preventDefault();
      handleParse();
    }
  });

  els.fileInput.addEventListener('change', function () {
    var file = els.fileInput.files && els.fileInput.files[0];
    if (!file) return;
    if (!/\.txt$/i.test(file.name) && file.type !== 'text/plain') {
      showToast('Choose a .txt file.', 'error');
      els.fileInput.value = '';
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      els.rawInput.value = normalizeUploadedText(reader.result);
      els.rawInput.scrollLeft = 0;
      showToast(file.name + ' is ready to parse.', 'success');
    };
    reader.onerror = function () {
      showToast('The file could not be read.', 'error');
    };
    reader.readAsText(file);
  });

  els.deckTrigger.addEventListener('click', function () {
    var isOpen = els.deckTrigger.getAttribute('aria-expanded') === 'true';
    els.deckTrigger.setAttribute('aria-expanded', String(!isOpen));
    els.deckMenu.hidden = isOpen;
  });

  els.deckMenu.addEventListener('click', function (event) {
    var expandButton = event.target.closest('.deck-expand');
    if (expandButton && !expandButton.disabled) {
      var node = expandButton.closest('.deck-node');
      var isOpen = node.classList.toggle('is-open');
      node.setAttribute('aria-expanded', String(isOpen));
      return;
    }

    var option = event.target.closest('.deck-option');
    if (!option) return;
    state.pendingDeck = option.getAttribute('data-deck');
    els.deckTriggerLabel.textContent = state.pendingDeck;
    els.retrieveButton.disabled = false;
    renderDeckMenu();
    closeDeckMenu();
  });

  document.addEventListener('click', function (event) {
    if (!els.deckPicker.contains(event.target)) {
      closeDeckMenu();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !hasShortcutModifier(event) && !event.isComposing && event.keyCode !== 229 && !event.defaultPrevented && !els.deckMenu.hidden) {
      closeDeckMenu();
      els.deckTrigger.focus();
    }
  });

  els.retrieveButton.addEventListener('click', retrieveData);

  els.sourceTableHead.addEventListener('input', function (event) {
    var input = event.target.closest('[data-field-name]');
    if (!input) return;
    var index = Number(input.getAttribute('data-field-name'));
    state.fields[index].name = input.value.trim() || 'Field ' + (index + 1);
    scheduleSave();
  });

  els.sourceTableHead.addEventListener('change', function (event) {
    var languageSelect = event.target.closest('[data-field-language]');
    if (languageSelect) {
      var index = Number(languageSelect.getAttribute('data-field-language'));
      state.fields[index].language = languageSelect.value;
      scheduleSave();
      showToast(state.fields[index].name + ' speech set to ' + languageSelect.options[languageSelect.selectedIndex].text + '.', 'info');
      return;
    }

    var nameInput = event.target.closest('[data-field-name]');
    if (nameInput) {
      var fieldIndex = Number(nameInput.getAttribute('data-field-name'));
      if (!nameInput.value.trim()) {
        nameInput.value = 'Field ' + (fieldIndex + 1);
        state.fields[fieldIndex].name = nameInput.value;
      }
    }
  });

  els.rangeSelect.addEventListener('change', function () {
    changeChunk(Number(els.rangeSelect.value));
  });

  els.previousButton.addEventListener('click', function () {
    changeChunk(state.chunkIndex - 1);
  });

  els.nextButton.addEventListener('click', function () {
    changeChunk(state.chunkIndex + 1);
  });

  els.revealAllButton.addEventListener('click', function () {
    state.revealAll = !state.revealAll;
    if (!state.revealAll) {
      state.fields.forEach(function (field) { field.visible = false; });
      state.practice.forEach(function (practice) { practice.revealed = false; });
    }
    cancelSpeech();
    renderPractice();
    persistLibrary();
  });

  els.resetButton.addEventListener('click', resetPractice);
  els.fieldsButton.addEventListener('click', openFieldsDialog);
  els.closeFieldsButton.addEventListener('click', function () {
    els.fieldsDialog.close();
  });

  els.fieldsDialog.addEventListener('click', function (event) {
    if (event.target === els.fieldsDialog) {
      els.fieldsDialog.close();
    }
  });

  els.fieldOptions.addEventListener('change', function (event) {
    var checkbox = event.target.closest('[data-field-toggle]');
    if (!checkbox) return;
    state.tempEnabledFields[Number(checkbox.getAttribute('data-field-toggle'))] = checkbox.checked;
    updateFieldDialogState();
  });

  els.applyFieldsButton.addEventListener('click', applyFieldSelection);

  els.practiceTableBody.addEventListener('input', function (event) {
    var input = event.target.closest('.answer-input');
    if (!input) return;
    var localIndex = Number(input.getAttribute('data-local-index'));
    var record = getCurrentChunk()[localIndex];
    if (!record) return;
    var practice = getRowPractice(record.id);
    practice.value = input.value;
    practice.result = '';
    var wrap = input.closest('.answer-wrap');
    wrap.classList.remove('is-correct', 'is-incorrect');
    wrap.querySelector('.answer-mark').textContent = '';
    input.setAttribute('aria-invalid', 'false');
    rememberAnswer(input);
  });

  els.practiceTableBody.addEventListener('keydown', function (event) {
    var input = event.target.closest('.answer-input');
    if (!input || event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.repeat || event.defaultPrevented || hasShortcutModifier(event) || event.shiftKey) return;
    event.preventDefault();
    checkAnswer(Number(input.getAttribute('data-local-index')));
  });

  els.practiceTableBody.addEventListener('click', function (event) {
    var revealButton = event.target.closest('[data-reveal-row]');
    if (revealButton) {
      var localIndex = Number(revealButton.getAttribute('data-reveal-row'));
      toggleRowReveal(localIndex);
      // Rendering replaces the button; retain focus for keyboard and assistive-technology users.
      els.practiceTableBody.querySelector('[data-reveal-row="' + localIndex + '"]').focus({ preventScroll: true });
      return;
    }

    var speechButton = event.target.closest('[data-speak-row]');
    if (speechButton) {
      speakField(
        Number(speechButton.getAttribute('data-speak-row')),
        Number(speechButton.getAttribute('data-speak-field')),
        speechButton
      );
    }
  });

  els.practiceTableHead.addEventListener('click', function (event) {
    var button = event.target.closest('[data-column-toggle]');
    if (button) {
      toggleColumn(button.dataset.columnToggle === 'answer' ? 'answer' : Number(button.dataset.columnToggle));
      return;
    }
    var audioButton = event.target.closest('[data-speak-column]');
    if (audioButton) speakColumn(Number(audioButton.dataset.speakColumn), audioButton);
  });
  els.themeOptions.addEventListener('click', function (event) {
    var button = event.target.closest('[data-theme-choice]');
    if (button) chooseTheme(button.dataset.themeChoice);
  });
  els.themeOptions.addEventListener('keydown', function (event) {
    if (hasShortcutModifier(event) || event.isComposing || event.defaultPrevented) return;
    var button = event.target.closest('[data-theme-choice]');
    if (!button) return;
    var index = themes.findIndex(function (theme) { return theme.id === button.dataset.themeChoice; });
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index = (index + 1) % themes.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') index = (index - 1 + themes.length) % themes.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = themes.length - 1;
    else return;
    event.preventDefault();
    chooseTheme(themes[index].id);
  });
  ['focusin', 'focusout', 'select', 'keyup', 'pointerup'].forEach(function (name) {
    els.practiceTableBody.addEventListener(name, function (event) { rememberAnswer(event.target); });
  });
  document.addEventListener('selectionchange', function () { rememberAnswer(document.activeElement); });
  els.keysButton.addEventListener('click', toggleUsefulKeys);
  els.keyLanguage.innerHTML = languages.map(function (language) {
    var supported = Object.hasOwn(usefulLetters, language.code);
    return '<option value="' + language.code + '"' + (supported ? '' : ' disabled') + '>' + escapeHtml(language.label) + (supported ? '' : ' · use your system input method') + '</option>';
  }).join('');
  els.keyLanguage.value = library.preferences.keyLanguage;
  els.keyLanguage.addEventListener('change', function () {
    library.preferences.keyLanguage = els.keyLanguage.value;
    renderUsefulKeys();
    persistLibrary();
  });
  els.uppercaseKeys.addEventListener('change', renderUsefulKeys);
  els.keyButtons.addEventListener('pointerdown', function (event) { if (event.target.closest('[data-letter]')) event.preventDefault(); });
  els.keyButtons.addEventListener('click', function (event) {
    var button = event.target.closest('[data-letter]');
    if (button) insertUsefulLetter(button.dataset.letter);
  });
  els.repeatButton.addEventListener('click', repeatGroup);
  els.completeDeckButton.addEventListener('click', function () { completionAction(false); });
  els.undoCompletionButton.addEventListener('click', function () { completionAction(true); });
  els.libraryFilter.addEventListener('change', renderDeckMenu);
  els.deleteDeckButton.addEventListener('click', deleteSelectedDeck);
  els.cancelImportButton.addEventListener('click', function () { els.importDialog.close('cancel'); });
  els.confirmImportButton.addEventListener('click', function () { els.importDialog.close('update'); });
  els.settingsButton.addEventListener('click', openSettings);
  els.closeSettingsButton.addEventListener('click', function () { els.settingsDialog.close(); });
  els.settingsDialog.addEventListener('close', function () { cancelSpeech(); });
  els.settingsDialog.addEventListener('click', function (event) { if (event.target === els.settingsDialog) els.settingsDialog.close(); });
  els.previewLanguage.innerHTML = languageOptions('en-US');
  els.previewLanguage.addEventListener('change', function () { cancelSpeech(); renderVoiceOptions(); });
  els.previewVoiceButton.addEventListener('click', function () {
    var previews = { 'en-US': 'A little practice every day.', 'es-ES': 'Un poco de práctica cada día.', 'de-DE': 'Jeden Tag ein wenig üben.', 'fr-FR': 'Un peu de pratique chaque jour.', 'pt-BR': 'Um pouco de prática todos os dias.', 'nb-NO': 'Litt øvelse hver dag.', 'it-IT': 'Un po’ di pratica ogni giorno.', 'ko-KR': '매일 조금씩 연습하세요.', 'ja-JP': '毎日少しずつ練習しましょう。' };
    playSpeech(previews[els.previewLanguage.value], els.previewLanguage.value, els.previewVoiceButton);
  });
  els.speechRate.addEventListener('change', function () { library.preferences.rate = Number(els.speechRate.value); persistLibrary(); });
  els.repeatPasses.addEventListener('change', function () { library.preferences.repeatPasses = els.repeatPasses.checked; updatePracticeControls(); persistLibrary(); });
  els.enableShortcuts.addEventListener('change', function () { library.preferences.shortcuts = els.enableShortcuts.checked; persistLibrary(); });
  els.answerField.addEventListener('change', function () { state.answerField = Number(els.answerField.value); state.practice.forEach(function (practice) { practice.result = ''; }); renderPractice(); persistLibrary(); });
  els.backupButton.addEventListener('click', exportLibrary);
  els.restoreBackupLabel.addEventListener('keydown', function (event) {
    if ((event.key === 'Enter' || event.key === ' ') && !hasShortcutModifier(event)) { event.preventDefault(); els.backupInput.click(); }
  });
  els.backupInput.addEventListener('change', async function () {
    var file = els.backupInput.files && els.backupInput.files[0];
    if (!file) return;
    try {
      var restored = validateLibrary(JSON.parse(await file.text()));
      if (library.records.length && !window.confirm('Replace this browser’s library with the backup? Back up the current library first if you want to keep it.')) return;
      library = restored;
      restoreLibraryUI();
      await persistLibrary();
      els.settingsDialog.close();
      showToast('Library backup restored.', 'success');
    } catch (error) {
      showToast(error.message || 'The backup could not be restored.', 'error');
    } finally { els.backupInput.value = ''; }
  });
  document.addEventListener('keydown', handleShortcut);
  window.addEventListener('pagehide', persistLibrary);
  document.addEventListener('visibilitychange', function () { if (document.hidden) persistLibrary(); });

  if (window.speechSynthesis) {
    refreshVoices();
    if (typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
      window.speechSynthesis.addEventListener('voiceschanged', function () { if (els.settingsDialog.open) renderVoiceOptions(); });
    } else {
      window.speechSynthesis.onvoiceschanged = refreshVoices;
    }
    window.addEventListener('pagehide', cancelSpeech);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) cancelSpeech();
    });
  }

  function registerAgentTools() {
    var context = document.modelContext;
    if (!context || typeof context.registerTool !== 'function') return;

    var registrations = [
      {
        name: 'parse_anki_data',
        title: 'Parse Anki data',
        description: 'Import Anki-formatted text into the local deck library. Updating existing decks requires confirmation.',
        inputSchema: {
          type: 'object',
          properties: {
            data: { type: 'string', minLength: 1 }
          },
          required: ['data'],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: async function (input) {
          if (!input || typeof input.data !== 'string' || !input.data.trim()) {
            throw new Error('data must be a non-empty string');
          }
          parseData(input.data);
          els.rawInput.value = normalizeUploadedText(input.data);
          var result = await handleParse();
          if (!result) throw new Error('Import was canceled or the library is not ready.');
          switchView('source');
          return {
            records: result.records.length,
            decks: Array.from(new Set(result.records.map(function (record) { return record.deck; }))),
            fields: result.maxFields
          };
        }
      },
      {
        name: 'retrieve_deck',
        title: 'Retrieve a deck',
        description: 'Select a parsed deck or parent deck and load its matching rows into Source and Practice.',
        inputSchema: {
          type: 'object',
          properties: {
            deck: { type: 'string', minLength: 1 }
          },
          required: ['deck'],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: function (input) {
          if (!input || typeof input.deck !== 'string' || !input.deck.trim()) {
            throw new Error('deck must be a non-empty string');
          }
          var requestedDeck = input.deck.trim();
          var exists = state.records.some(function (record) {
            return isDeckMatch(record.deck, requestedDeck);
          });
          if (!exists) {
            throw new Error('No parsed rows match that deck');
          }
          state.pendingDeck = requestedDeck;
          els.deckTriggerLabel.textContent = requestedDeck;
          renderDeckMenu();
          retrieveData();
          return {
            deck: state.activeDeck,
            rows: state.activeRows.length,
            ranges: getChunkCount()
          };
        }
      },
      {
        name: 'open_practice_range',
        title: 'Open a practice range',
        description: 'Open Practice at the five-card range containing the requested one-based row number.',
        inputSchema: {
          type: 'object',
          properties: {
            row: { type: 'integer', minimum: 1 }
          },
          required: ['row'],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: function (input) {
          if (!input || !Number.isInteger(input.row) || input.row < 1) {
            throw new Error('row must be a positive integer');
          }
          if (!state.activeRows.length) {
            throw new Error('Retrieve a deck before opening Practice');
          }
          if (input.row > state.activeRows.length) {
            throw new Error('row is outside the retrieved data');
          }
          clearPracticeForNavigation();
          state.chunkIndex = Math.floor((input.row - 1) / state.chunkSize);
          els.rangeSelect.value = String(state.chunkIndex);
          switchView('practice');
          persistLibrary();
          var start = state.chunkIndex * state.chunkSize + 1;
          return {
            start: start,
            end: Math.min(start + state.chunkSize - 1, state.activeRows.length),
            rows: getCurrentChunk().length
          };
        }
      }
    ];

    registrations.forEach(function (tool) {
      try {
        Promise.resolve(context.registerTool(tool)).catch(function () {});
      } catch (error) {
        // The interface remains fully usable when WebMCP is unavailable.
      }
    });
  }

  els.rawInput.value = sampleData;
  applyTheme();
  updateTopStatus();
  updatePracticeControls();
  registerAgentTools();
  initializeLibrary();
}(window.Bellasprak = window.Bellasprak || {}));
