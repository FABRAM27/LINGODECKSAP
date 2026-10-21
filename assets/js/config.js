(function (Bellasprak) {
  'use strict';

  var languages = [
    { label: 'English', code: 'en-US' },
    { label: 'Spanish', code: 'es-ES' },
    { label: 'Korean', code: 'ko-KR' },
    { label: 'Japanese', code: 'ja-JP' },
    { label: 'Portuguese', code: 'pt-BR' },
    { label: 'German', code: 'de-DE' },
    { label: 'Norwegian Bokmal', code: 'nb-NO' },
    { label: 'Italian', code: 'it-IT' },
    { label: 'French', code: 'fr-FR' }
  ];

  var sampleRows = [
    ['the cause', 'die Ursache', 'What was the cause of the delay?'],
    ['the choice', 'die Wahl', 'You always have a choice.'],
    ['the experience', 'die Erfahrung', 'It was a valuable experience.'],
    ['the freedom', 'die Freiheit', 'Freedom requires responsibility.'],
    ['the habit', 'die Gewohnheit', 'Reading became a daily habit.'],
    ['the knowledge', 'das Wissen', 'Knowledge grows when it is shared.'],
    ['the opinion', 'die Meinung', 'Everyone may express an opinion.'],
    ['the reason', 'der Grund', 'There is a reason for the change.'],
    ['the result', 'das Ergebnis', 'The result exceeded expectations.'],
    ['the truth', 'die Wahrheit', 'The truth eventually came out.'],
    ['the value', 'der Wert', 'The value is difficult to measure.'],
    ['the way', 'der Weg', 'We found a better way forward.'],
    ['the world', 'die Welt', 'The world is full of languages.']
  ];

  var sampleFrench = [
    ['to learn', 'apprendre', 'I learn something new each day.'],
    ['to understand', 'comprendre', 'Do you understand the question?'],
    ['to remember', 'se souvenir', 'Try to remember this phrase.'],
    ['to speak', 'parler', 'We speak three languages.'],
    ['to write', 'écrire', 'She likes to write by hand.']
  ];

  var sampleData = '#separator:pipe #html:true #notetype column:1 #deck column:2 ' +
    sampleRows.map(function (row) {
      return 'Basic|Languages::German::Core Nouns|' + row.join('↑');
    }).join('↓') + '↓' +
    sampleFrench.map(function (row) {
      return 'Basic|Languages::French::Core Verbs|' + row.join('↑');
    }).join('↓');

  var themes = [
    { id: 'default', name: 'Default', tokens: {} },
    { id: 'ocean', name: 'Ocean', tokens: {
      '--ink': '#122a38', '--ink-2': '#405a68', '--ink-3': '#526a78', '--paper': '#f1f8fb', '--surface-soft': '#eaf3f7',
      '--line': '#cddde5', '--line-strong': '#9fb9c7', '--blue': '#146b8c', '--blue-dark': '#0d526c', '--blue-soft': '#e3f3f8',
      '--teal': '#076f68', '--teal-soft': '#e0f3ee', '--accent-light': '#64b7d4', '--accent-rgb': '20, 107, 140', '--teal-rgb': '8, 126, 118', '--nav-rgb': '7, 34, 48', '--nav-muted': '#b9d5df', '--shadow-rgb': '18, 42, 56'
    } },
    { id: 'forest', name: 'Forest', tokens: {
      '--ink': '#192c23', '--ink-2': '#435c4e', '--ink-3': '#566e5f', '--paper': '#f3f7f1', '--surface-soft': '#edf3e9',
      '--line': '#d1dece', '--line-strong': '#a3b99f', '--blue': '#28734a', '--blue-dark': '#1e5839', '--blue-soft': '#e6f3e9',
      '--teal': '#256d52', '--teal-soft': '#e6f2e8', '--accent-light': '#79b489', '--accent-rgb': '40, 115, 74', '--teal-rgb': '37, 109, 82', '--nav-rgb': '19, 40, 30', '--nav-muted': '#c0d2c4', '--shadow-rgb': '25, 44, 35'
    } },
    { id: 'lavender', name: 'Lavender', tokens: {
      '--ink': '#2c213e', '--ink-2': '#62516e', '--ink-3': '#6c5c78', '--paper': '#f8f5fc', '--surface-soft': '#f0ebf7',
      '--line': '#ddd3eb', '--line-strong': '#b9a7cf', '--blue': '#7250b8', '--blue-dark': '#59398f', '--blue-soft': '#f0eafa',
      '--teal': '#4e6d65', '--teal-soft': '#e7f1ed', '--accent-light': '#b29ad8', '--accent-rgb': '114, 80, 184', '--teal-rgb': '78, 109, 101', '--nav-rgb': '36, 28, 55', '--nav-muted': '#d0c3df', '--shadow-rgb': '44, 33, 62'
    } },
    { id: 'warm-neutral', name: 'Warm Neutral', tokens: {
      '--ink': '#332a23', '--ink-2': '#655549', '--ink-3': '#746252', '--paper': '#f9f5ef', '--surface': '#fffdf9eb', '--surface-strong': '#fffdf9', '--surface-soft': '#f3ede4',
      '--line': '#ddd0c2', '--line-strong': '#b5a18e', '--blue': '#8a5839', '--blue-dark': '#6a3f28', '--blue-soft': '#f6ece1',
      '--teal': '#476b57', '--teal-soft': '#e8f0e5', '--accent-light': '#c99e76', '--accent-rgb': '138, 88, 57', '--teal-rgb': '71, 107, 87', '--nav-rgb': '44, 33, 26', '--nav-muted': '#d7c6b7', '--shadow-rgb': '51, 42, 35'
    } },
    { id: 'arctic-ice', name: 'Arctic Ice', tokens: {
      '--page-gradient': 'linear-gradient(130deg, #edf6ff 0%, #e9f8f8 50%, #dff4ee 100%)',
      '--ink': '#163340', '--ink-2': '#405c68', '--ink-3': '#526d77', '--paper': '#eef8fb', '--surface': '#fcfefff2', '--surface-strong': '#fcfeff', '--surface-soft': '#e8f3f5',
      '--line': '#cadfe5', '--line-strong': '#9ab7c1', '--blue': '#086b83', '--blue-dark': '#075367', '--blue-soft': '#ddf3f6',
      '--teal': '#076e66', '--teal-soft': '#dff5ef', '--accent-light': '#6dc4ce', '--accent-rgb': '8, 107, 131', '--teal-rgb': '7, 110, 102', '--nav-rgb': '10, 36, 49', '--nav-muted': '#bed6df', '--shadow-rgb': '22, 51, 64'
    } },
    { id: 'golden-sunset', name: 'Golden Sunset', tokens: {
      '--page-gradient': 'linear-gradient(125deg, #f9e8ef 0%, #fbeadf 50%, #fbf1d5 100%)',
      '--ink': '#3c2c31', '--ink-2': '#6a4d50', '--ink-3': '#795e60', '--paper': '#fff5ef', '--surface': '#fffdfaf2', '--surface-strong': '#fffdfa', '--surface-soft': '#faeee7',
      '--line': '#e8d3c8', '--line-strong': '#c4a293', '--blue': '#99513e', '--blue-dark': '#773d30', '--blue-soft': '#fbe9de',
      '--teal': '#6e6540', '--teal-soft': '#f4efdc', '--accent-light': '#e8ac93', '--accent-rgb': '153, 81, 62', '--teal-rgb': '148, 116, 58', '--nav-rgb': '53, 33, 38', '--nav-muted': '#dfc9c8', '--shadow-rgb': '60, 44, 49'
    } },
    { id: 'lavender-dream', name: 'Lavender Dream', tokens: {
      '--page-gradient': 'linear-gradient(135deg, #eee7fa 0%, #eaeafb 50%, #e1f0fa 100%)',
      '--ink': '#2b2948', '--ink-2': '#575372', '--ink-3': '#696581', '--paper': '#f5f3fc', '--surface': '#fefcfff2', '--surface-strong': '#fefcff', '--surface-soft': '#eeebf7',
      '--line': '#d9d4eb', '--line-strong': '#b3a9d0', '--blue': '#6653ac', '--blue-dark': '#4e3e88', '--blue-soft': '#ece7fa',
      '--teal': '#446d7c', '--teal-soft': '#e5f1f6', '--accent-light': '#b3a4df', '--accent-rgb': '102, 83, 172', '--teal-rgb': '68, 109, 124', '--nav-rgb': '32, 30, 55', '--nav-muted': '#ccc8e3', '--shadow-rgb': '43, 41, 72'
    } },
    { id: 'mint-serenity', name: 'Mint Serenity', tokens: {
      '--page-gradient': 'linear-gradient(125deg, #f2f3e5 0%, #e6f3e9 48%, #dff2ef 100%)',
      '--ink': '#203a32', '--ink-2': '#486257', '--ink-3': '#5a7167', '--paper': '#f1f8f1', '--surface': '#fdfef9f2', '--surface-strong': '#fdfef9', '--surface-soft': '#e9f2e9',
      '--line': '#cddfd3', '--line-strong': '#9ebbad', '--blue': '#286e59', '--blue-dark': '#1e5445', '--blue-soft': '#e0f2e9',
      '--teal': '#286b66', '--teal-soft': '#dff2ef', '--accent-light': '#96c7b4', '--accent-rgb': '40, 110, 89', '--teal-rgb': '40, 107, 102', '--nav-rgb': '22, 44, 37', '--nav-muted': '#c2d9cc', '--shadow-rgb': '32, 58, 50'
    } },
    { id: 'midnight-aurora', name: 'Midnight Aurora', tokens: {
      '--app-color-scheme': 'dark', '--page-gradient': 'linear-gradient(130deg, #101b31 0%, #122c35 52%, #26223e 100%)',
      '--ink': '#e8edf7', '--ink-2': '#bbc8dc', '--ink-3': '#a3b3cb', '--paper': '#101b2c', '--surface': '#17263bf5', '--surface-strong': '#1a2a40', '--surface-soft': '#20334b',
      '--line': '#344a63', '--line-strong': '#607993', '--blue': '#8cbbfa', '--blue-dark': '#afd1ff', '--blue-soft': '#263f60', '--on-accent': '#101d30',
      '--teal': '#86dbcc', '--teal-soft': '#193e40', '--success': '#8ad9b6', '--success-soft': '#1c3d36', '--success-rgb': '138, 217, 182',
      '--danger': '#ffb1bf', '--danger-soft': '#492b3b', '--danger-rgb': '255, 177, 191', '--warning': '#f5cf8b', '--warning-soft': '#403824', '--warning-border': '#ae8b51',
      '--accent-light': '#c3b2f0', '--accent-rgb': '140, 187, 250', '--teal-rgb': '78, 167, 157', '--nav-rgb': '11, 20, 36', '--nav-muted': '#b7c8e1', '--shadow-rgb': '4, 10, 22'
    } }
  ];

  var usefulLetters = {
    'en-US': [], 'es-ES': [],
    'de-DE': ['ä', 'ö', 'ü', 'ß'],
    'pt-BR': ['ã', 'õ', 'â', 'ê', 'ô', 'à', 'ç'],
    'nb-NO': ['æ', 'ø', 'å'],
    'it-IT': ['à', 'è', 'é', 'ì', 'ò', 'ù'],
    'fr-FR': ['à', 'â', 'æ', 'ç', 'è', 'é', 'ê', 'ë', 'î', 'ï', 'ô', 'œ', 'ù', 'û', 'ü', 'ÿ']
  };

  var preferredVoiceNames = {
    'en-US': ['Ava', 'Emma', 'Jenny', 'Aria', 'Guy'],
    'es-ES': ['Elvira', 'Alvaro', 'Abril'],
    'ko-KR': ['SunHi', 'InJoon', 'Hyunsu'],
    'ja-JP': ['Nanami', 'Keita', 'Aoi'],
    'pt-BR': ['Francisca', 'Antonio', 'Thalita'],
    'de-DE': ['Katja', 'Conrad', 'Amala'],
    'nb-NO': ['Pernille', 'Finn', 'Iselin'],
    'it-IT': ['Elsa', 'Diego', 'Isabella'],
    'fr-FR': ['Denise', 'Henri', 'Eloise']
  };

  var icons = {
    play: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8.5 6.5v11l9-5.5-9-5.5Z" fill="currentColor"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 12s3-5 8.5-5 8.5 5 8.5 5-3 5-8.5 5-8.5-5-8.5-5Z" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.2" stroke="currentColor" stroke-width="1.7"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4 20 20M10.2 7.2A9.9 9.9 0 0 1 12 7c5.5 0 8.5 5 8.5 5a12.9 12.9 0 0 1-2.2 2.7M14.3 16.7c-.7.2-1.5.3-2.3.3-5.5 0-8.5-5-8.5-5a13 13 0 0 1 3-3.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M10.2 10.2a2.5 2.5 0 0 0 3.6 3.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    chevronRight: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9.5 7 5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  Bellasprak.config = { languages: languages, sampleData: sampleData, themes: themes, usefulLetters: usefulLetters, preferredVoiceNames: preferredVoiceNames, icons: icons };
}(window.Bellasprak = window.Bellasprak || {}));
