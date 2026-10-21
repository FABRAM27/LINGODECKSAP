const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function loadModules(voices = []) {
  const context = vm.createContext({ window: { speechSynthesis: { getVoices: () => voices } } });
  for (const name of ['config', 'content', 'library', 'speech']) {
    const filename = path.join(root, 'assets/js', name + '.js');
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  }
  return context.window.Bellasprak;
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('the downloadable entry uses local classic scripts and a local stylesheet without a build step', () => {
  const html = fs.readFileSync(path.join(root, 'lingodeck.html'), 'utf8');
  assert.equal(/<style[\s>]/.test(html), false);
  const scripts = [...html.matchAll(/<script defer src="([^"]+)"><\/script>/g)].map(match => match[1]);
  assert.deepEqual(scripts, ['config', 'content', 'library', 'speech', 'app'].map(name => `assets/js/${name}.js`));
  for (const filename of [...scripts, 'assets/css/app.css', 'assets/icons/favicon.svg']) {
    assert.equal(fs.existsSync(path.join(root, filename)), true);
    if (filename.endsWith('.js')) new vm.Script(fs.readFileSync(path.join(root, filename), 'utf8'), { filename });
  }
  assert.match(html, /<link rel="stylesheet" href="assets\/css\/app\.css">/);
  assert.equal(/type="module"|rel="manifest"/.test(html), false, 'No module-loader requirement or unapproved PWA implementation');
});

test('native sample parsing retains all 18 records, hierarchy, field contents, and order', () => {
  const { config, content } = loadModules();
  const parsed = content.parseData(config.sampleData);
  assert.equal(parsed.records.length, 18);
  assert.equal(parsed.maxFields, 3);
  assert.equal(parsed.errors, 0);
  assert.equal(parsed.inconsistentWidths, false);
  assert.deepEqual(plain(parsed.records[0].fields), ['the cause', 'die Ursache', 'What was the cause of the delay?']);
  assert.equal(parsed.records[12].fields[0], 'the world');
  assert.equal(parsed.records[13].deck, 'Languages::French::Core Verbs');
  assert.equal(parsed.records[17].fields[1], 'écrire');
});

test('multiline/BOM normalization, literal pipes, empty fields, malformed records, and padding retain their semantics', () => {
  const { content } = loadModules();
  const multiline = '\uFEFF#separator:pipe\r\n#html:true\r\n#notetype column:1\r\n#deck column:2\r\nBasic|Root::Child|bird↑Vogel↑<b>a|b</b>\r\nmalformed\r\nBasic|Root::Child|dog↑\r\n';
  const parsed = content.parseData(content.normalizeUploadedText(multiline));
  assert.equal(parsed.errors, 1);
  assert.equal(parsed.inconsistentWidths, true);
  assert.deepEqual(plain(parsed.records.map(record => record.fields)), [['bird', 'Vogel', '<b>a|b</b>'], ['dog', '', '']]);
  assert.deepEqual(plain(content.parseData('Basic|Deck|one|uno').records[0].fields), ['one', 'uno']);
  assert.throws(() => content.parseData(''), /Add Anki data/);
  assert.throws(() => content.parseData('malformed'), /No valid records/);
});

test('library defaults and validation preserve the version-1 backup contract', () => {
  const { library } = loadModules();
  const first = library.createEmpty(), second = library.createEmpty();
  first.records.push({ deck: 'Temporary' });
  assert.equal(second.records.length, 0, 'Empty libraries do not share mutable state');
  const clean = library.validate({
    version: 1,
    records: [{ deck: 'Parent::Child', noteType: 'Basic', fields: ['bird', 'Vogel'] }],
    deckSettings: { 'Parent::Child': { fields: [{ name: 'German', language: 'de-DE', enabled: true, visible: true }], answerField: 0, answerCollapsed: true, chunk: 2 } },
    completed: { 'Parent::Child': '2026-10-01T12:00:00.000Z' },
    preferences: { rate: 0.75, theme: 'midnight-aurora', keyLanguage: 'de-DE', repeatPasses: true },
    session: { deck: 'Parent::Child', view: 'practice', chunk: 2 }
  });
  assert.equal(clean.version, 1);
  assert.deepEqual(plain(clean.records[0].fields), ['bird', 'Vogel']);
  assert.equal(clean.deckSettings['Parent::Child'].answerCollapsed, true);
  assert.equal(clean.preferences.theme, 'midnight-aurora');
  assert.equal(clean.preferences.shortcuts, true);
  assert.equal(clean.preferences.rate, 0.75);
  assert.equal(clean.completed['Parent::Child'], '2026-10-01T12:00:00.000Z');
  assert.deepEqual(plain(clean.session), { deck: 'Parent::Child', chunk: 2, view: 'practice' });
  const old = library.validate({ version: 1, records: [], preferences: { theme: 'unknown', rate: 99 } });
  assert.equal(old.preferences.theme, 'default');
  assert.equal(old.preferences.rate, 1);
  assert.throws(() => library.validate({ version: 2, records: [] }), /not a supported Bellasprak/);
  assert.throws(() => library.validate({ version: 1, records: [{ deck: 'Broken', fields: null }] }), /invalid record/);
});

test('voice selection still prefers natural voices within the exact locale and keeps the local fallback', () => {
  const voices = [
    { name: 'German local', lang: 'de-DE', localService: true },
    { name: 'Microsoft Katja Online Natural', lang: 'de-DE', localService: false },
    { name: 'Swiss Natural', lang: 'de-CH', localService: false },
    { name: 'Norwegian local', lang: 'no-NO', localService: true }
  ];
  const modules = loadModules(voices);
  const speech = modules.speech.create({ state: {}, els: {}, getCurrentChunk: () => [], getPreferences: () => ({ rate: 1 }), showToast() {} });
  speech.refreshVoices();
  assert.equal(speech.selectBestVoice('de-DE'), voices[1]);
  assert.equal(speech.selectBestVoice('de-DE', { localOnly: true }), voices[0]);
  assert.equal(speech.selectBestVoice('de-DE', { excludeName: voices[1].name }), voices[0]);
  assert.equal(speech.selectBestVoice('de-CH'), voices[2]);
  assert.equal(speech.selectBestVoice('nb-NO'), voices[3]);
  assert.equal(speech.selectBestVoice('ja-JP'), null);
});
