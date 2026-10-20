const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

let browser, server, origin;
before(async () => {
  server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(fs.readFileSync(path.join(__dirname, '..', 'lingodeck.html')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function setup(t, mockSpeech = false) {
  const context = await browser.newContext();
  t.after(() => context.close());
  if (mockSpeech) await context.addInitScript(() => {
    const voices = [
      { name: 'German local', lang: 'de-DE', localService: true },
      { name: 'Microsoft Katja Online Natural', lang: 'de-DE', localService: false },
      { name: 'English local', lang: 'en-US', localService: true },
      { name: 'Microsoft Ava Online Natural', lang: 'en-US', localService: false }
    ];
    window.speechLog = [];
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
    Object.defineProperty(window, 'speechSynthesis', { value: {
      getVoices: () => voices, cancel() {}, addEventListener() {},
      speak(utterance) {
        window.speechLog.push({ text: utterance.text, voice: utterance.voice?.name, lang: utterance.lang, rate: utterance.rate });
        setTimeout(() => {
          if (window.failRemote && utterance.voice?.localService === false) utterance.onerror?.({ error: 'network' });
          else { utterance.onstart?.(); utterance.onend?.(); }
        }, 5);
      }
    } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'No uncaught page errors'));
  await page.goto(origin);
  await ready(page);
  return { page, context };
}
async function ready(page) {
  await page.waitForSelector('html[data-library-ready="true"]');
}
async function importData(page, data) {
  if (data) await page.locator('#rawInput').fill(data);
  await page.locator('#parseButton').click();
  await page.waitForFunction(() => !document.querySelector('#parseButton').disabled);
}
async function practice(page) {
  await page.locator('#retrieveButton').click();
  await page.locator('#practiceTab').click();
}
async function outsideKeys(page, key, modifiers = {}) {
  return page.evaluate(({ key, modifiers }) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  }, { key, modifiers });
}

test('native imports retain order, add to the library, and require confirmation to update', async t => {
  const { page } = await setup(t);
  await importData(page);
  assert.equal(await page.locator('#recordCount').textContent(), '18');
  assert.equal(await page.locator('#sourceTableBody tr').count(), 0);
  await practice(page);
  assert.deepEqual(await page.locator('#sourceTableBody tr td:nth-child(2)').allTextContents(), [
    'the cause', 'the choice', 'the experience', 'the freedom', 'the habit', 'the knowledge',
    'the opinion', 'the reason', 'the result', 'the truth', 'the value', 'the way', 'the world'
  ]);
  await page.locator('#sourceTab').click();
  await importData(page, '#separator:pipe #html:true #notetype column:1 #deck column:2 Basic|Extra::Deck|bird↑Vogel');
  assert.equal(await page.locator('#recordCount').textContent(), '19');
  await page.locator('#rawInput').fill('Basic|Extra::Deck|dog↑Hund');
  await page.locator('#parseButton').click();
  await page.locator('#cancelImportButton').click();
  await page.waitForFunction(() => !document.querySelector('#parseButton').disabled);
  await practice(page);
  assert.equal(await page.locator('#sourceTableBody tr td:nth-child(2)').textContent(), 'bird');
  await page.locator('#sourceTab').click();
  await page.locator('#parseButton').click();
  await page.locator('#confirmImportButton').click();
  await page.waitForFunction(() => !document.querySelector('#parseButton').disabled);
  await practice(page);
  assert.equal(await page.locator('#sourceTableBody tr td:nth-child(2)').textContent(), 'dog');
  assert.equal(await page.locator('#recordCount').textContent(), '19');
});

test('column visibility complements Fields and Repeat group preserves configuration and order', async t => {
  const { page } = await setup(t);
  await importData(page); await practice(page);
  await page.locator('[data-column-toggle="0"]').click();
  assert.equal(await page.locator('.reference-content').count(), 5);
  await page.locator('.answer-input').first().fill('the cause');
  await page.locator('#fieldsButton').click();
  await page.locator('[data-field-toggle="2"]').uncheck();
  await page.locator('#applyFieldsButton').click();
  assert.equal(await page.locator('[data-column-toggle]').count(), 2);
  assert.equal(await page.locator('.answer-input').first().inputValue(), 'the cause');
  assert.equal(await page.locator('#repeatButton').isVisible(), false);
  await page.locator('#settingsButton').click();
  await page.locator('#repeatPasses').check();
  await page.locator('#closeSettingsButton').click();
  const before = await page.locator('#practiceTableBody .number-col').allTextContents();
  await page.locator('#repeatButton').click();
  assert.deepEqual(await page.locator('#practiceTableBody .number-col').allTextContents(), before);
  assert.equal(await page.locator('.answer-input').first().inputValue(), '');
  assert.equal(await page.locator('.reference-content').count(), 5);
  assert.equal(await page.locator('[data-column-toggle]').count(), 2);
});

test('shortcuts leave browser modifiers, text inputs, IME, dialogs, and normal controls alone', async t => {
  const { page } = await setup(t);
  await importData(page); await practice(page);
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { ctrlKey: true, altKey: true }, { isComposing: true }, { repeat: true }]) {
    assert.equal(await outsideKeys(page, 'v', modifiers), false);
  }
  assert.equal(await outsideKeys(page, ' '), false);
  assert.equal(await outsideKeys(page, 'ArrowRight'), false);
  assert.equal(await outsideKeys(page, 'n', { ctrlKey: true }), false);
  assert.equal(await outsideKeys(page, 'n'), true);
  assert.match(await page.locator('#groupPosition').textContent(), /Group 2 of 3/);
  assert.equal(await outsideKeys(page, 'b'), true);
  assert.equal(await outsideKeys(page, 'v'), true);
  assert.equal(await page.locator('.reference-content').count(), 15);
  await page.locator('#resetButton').click();
  const input = page.locator('.answer-input').first();
  await input.fill(''); await input.pressSequentially('vfrkp123');
  assert.equal(await input.inputValue(), 'vfrkp123');
  assert.equal(await page.locator('.reference-content').count(), 0);
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }]) {
    const prevented = await input.evaluate((element, modifiers) => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...modifiers });
      element.dispatchEvent(event); return event.defaultPrevented;
    }, modifiers);
    assert.equal(prevented, false);
  }
  for (const modifiers of [{ ctrlKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }]) {
    assert.equal(await page.locator('#rawInput').evaluate((element, modifiers) => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...modifiers });
      element.dispatchEvent(event); return event.defaultPrevented;
    }, modifiers), false);
  }
  assert.equal(await page.locator('#sourceTab').evaluate(element => {
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true });
    element.dispatchEvent(event); return event.defaultPrevented;
  }), false);
  assert.equal(await page.locator('#importDialog').isVisible(), false);
  await page.locator('#settingsButton').click();
  assert.equal(await outsideKeys(page, 'v'), false);
  await page.locator('#enableShortcuts').uncheck();
  await page.locator('#closeSettingsButton').click();
  assert.equal(await outsideKeys(page, 'v'), false);
});

test('Useful Keys inserts at the caret and excludes Japanese and Korean', async t => {
  const { page } = await setup(t);
  await importData(page); await practice(page);
  await page.locator('#keysButton').click();
  assert.equal(await page.locator('#keyLanguage option[value="ko-KR"]').isDisabled(), true);
  assert.equal(await page.locator('#keyLanguage option[value="ja-JP"]').isDisabled(), true);
  const input = page.locator('.answer-input').first();
  await input.fill('fr Hund');
  await input.evaluate(element => { element.focus(); element.setSelectionRange(1, 1); element.dispatchEvent(new Event('select', { bubbles: true })); });
  await page.locator('[data-letter="ü"]').click();
  assert.equal(await input.inputValue(), 'für Hund');
  assert.equal(await input.evaluate(element => element.selectionStart), 2);
  await page.locator('#uppercaseKeys').check();
  await page.locator('[data-letter="Ä"]').click();
  assert.equal(await input.inputValue(), 'füÄr Hund');
});

test('the browser restores decks, field preferences, position, settings and completion without reimporting', async t => {
  const { page, context } = await setup(t);
  await importData(page); await practice(page);
  await page.locator('#sourceTab').click();
  await page.locator('#fieldName0').fill('English');
  await page.locator('#fieldLanguage1').selectOption('fr-FR');
  await page.locator('#practiceTab').click();
  await page.locator('[data-column-toggle="0"]').click();
  await page.locator('#nextButton').click();
  await page.locator('#completeDeckButton').click();
  await page.locator('#settingsButton').click();
  await page.locator('#speechRate').selectOption('0.75');
  await page.locator('#repeatPasses').check();
  await page.locator('#closeSettingsButton').click();
  await page.waitForFunction(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('lingodeck-library'); r.onsuccess = () => resolve(r.result); });
    const saved = await new Promise(resolve => { const r = db.transaction('library').objectStore('library').get('current'); r.onsuccess = () => resolve(r.result); });
    db.close(); return saved.preferences.repeatPasses && saved.session.chunk === 1;
  });
  await page.close();
  const reopened = await context.newPage(); await reopened.goto(origin); await ready(reopened);
  assert.equal(await reopened.locator('#recordCount').textContent(), '18');
  assert.equal(await reopened.locator('#practiceView').isVisible(), true);
  assert.match(await reopened.locator('#groupPosition').textContent(), /Group 2 of 3/);
  assert.equal(await reopened.locator('[data-column-toggle="0"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await reopened.locator('#completeDeckButton').textContent(), 'Reviewed today');
  assert.equal(await reopened.locator('#repeatButton').isVisible(), true);
  await reopened.locator('#sourceTab').click();
  assert.equal(await reopened.locator('#fieldName0').inputValue(), 'English');
  assert.equal(await reopened.locator('#fieldLanguage1').inputValue(), 'fr-FR');
  await reopened.locator('#libraryFilter').selectOption('completed');
  await reopened.locator('#deckTrigger').click();
  assert.equal(await reopened.locator('.deck-option.is-completed').count(), 1);
});

test('speech retains natural voice preference and local retry while honoring the universal speed', async t => {
  const { page } = await setup(t, true);
  await importData(page); await practice(page);
  await page.locator('#settingsButton').click();
  await page.locator('#previewLanguage').selectOption('de-DE');
  assert.match(await page.locator('#voiceList li').first().textContent(), /Katja Online Natural/);
  await page.locator('#speechRate').selectOption('0.75');
  await page.locator('#previewVoiceButton').click();
  await page.waitForFunction(() => window.speechLog.length === 1);
  assert.deepEqual(await page.evaluate(() => speechLog[0]), { text: 'Jeden Tag ein wenig üben.', voice: 'Microsoft Katja Online Natural', lang: 'de-DE', rate: 0.75 });
  await page.locator('#closeSettingsButton').click();
  await page.locator('[data-column-toggle="1"]').click();
  await page.evaluate(() => { window.failRemote = true; });
  await page.locator('[data-speak-row="0"][data-speak-field="1"]').click();
  await page.waitForFunction(() => speechLog.length === 3);
  assert.deepEqual(await page.evaluate(() => speechLog.slice(1).map(item => item.voice)), ['Microsoft Katja Online Natural', 'German local']);
  assert.deepEqual(await page.evaluate(() => speechLog.map(item => item.rate)), [0.75, 0.75, 0.75]);
});

test('backup round-trip keeps library data and deletion is explicit', async t => {
  const { page } = await setup(t);
  await importData(page); await practice(page);
  await page.locator('#completeDeckButton').click();
  await page.locator('#settingsButton').click();
  const downloading = page.waitForEvent('download');
  await page.locator('#backupButton').click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const backup = Buffer.concat(chunks);
  assert.equal(JSON.parse(backup).records.length, 18);
  await page.locator('#closeSettingsButton').click();
  await page.locator('#sourceTab').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#deleteDeckButton').click();
  assert.equal(await page.locator('#recordCount').textContent(), '5');
  await page.locator('#settingsButton').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#backupInput').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
  await page.waitForFunction(() => !document.querySelector('#settingsDialog').open);
  assert.equal(await page.locator('#recordCount').textContent(), '18');
  assert.equal(await page.locator('#completeDeckButton').textContent(), 'Reviewed today');
});

test('Enter skips revealed rows; mobile layout contains the table; file imports preserve parser behavior', async t => {
  const { page } = await setup(t);
  await importData(page); await practice(page);
  await page.locator('[data-reveal-row="1"]').click();
  await page.locator('.answer-input').first().fill('the cause');
  await page.locator('.answer-input').first().press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.localIndex), '2');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#sourceTab').click();
  await page.locator('#fileInput').setInputFiles({ name: 'native.txt', mimeType: 'text/plain', buffer: Buffer.from('\uFEFF#separator:pipe\r\n#html:true\r\n#notetype column:1\r\n#deck column:2\r\nBasic|Native::Deck|one↑uno\r\nBasic|Native::Deck|two\r\nbad record') });
  await page.waitForFunction(() => document.querySelector('#rawInput').value.includes('bad record'));
  await importData(page);
  assert.equal(await page.locator('#recordCount').textContent(), '20');
  assert.match((await page.locator('.toast').allTextContents()).join(' '), /malformed row.*padded/);
});

test('storage denial leaves the session usable with an explicit backup notice', async t => {
  const { page, context } = await setup(t);
  await context.addInitScript(() => Object.defineProperty(window, 'indexedDB', { get() { throw new Error('Storage denied'); } }));
  await page.reload(); await ready(page);
  assert.match(await page.locator('#storageNotice').textContent(), /storage is unavailable/);
  await importData(page); await practice(page);
  assert.equal(await page.locator('#practiceTableBody tr').count(), 5);
  await page.locator('#settingsButton').click();
  assert.equal(await page.locator('#backupButton').isEnabled(), true);
});

test('invalid backups do not replace a working library', async t => {
  const { page } = await setup(t);
  await importData(page); await practice(page);
  await page.locator('#settingsButton').click();
  await page.locator('#backupInput').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"records":[{"deck":"Broken","fields":null}]}') });
  await page.waitForFunction(() => document.querySelector('#backupInput').value === '');
  assert.equal(await page.locator('#recordCount').textContent(), '18');
  assert.equal(await page.locator('#settingsDialog').isVisible(), true);
});

test('a stale tab cannot silently overwrite a library updated in another tab', async t => {
  const { page, context } = await setup(t);
  const stale = await context.newPage(); await stale.goto(origin); await ready(stale);
  await importData(page, 'Basic|First::Deck|one↑uno');
  await importData(stale, 'Basic|Second::Deck|two↑dos');
  assert.match(await stale.locator('#storageNotice').textContent(), /Another tab changed/);
  await page.reload(); await ready(page);
  assert.equal(await page.locator('#recordCount').textContent(), '1');
  await page.locator('#deckTrigger').click();
  assert.equal(await page.locator('[data-deck="First::Deck"]').count(), 1);
  assert.equal(await page.locator('[data-deck="Second::Deck"]').count(), 0);
});

test('the HTML opens directly from disk and restores its library in Chromium', async t => {
  const { page } = await setup(t);
  try {
    await page.goto(require('node:url').pathToFileURL(path.join(__dirname, '..', 'lingodeck.html')).href);
  } catch (error) {
    if (error.message.includes('ERR_BLOCKED_BY_ADMINISTRATOR')) {
      t.skip('Managed Chromium policy blocks file:// navigation; verify direct opening in a normal browser.');
      return;
    }
    throw error;
  }
  await ready(page);
  assert.match(await page.locator('#storageNotice').textContent(), /Local-file storage depends/);
  await importData(page, 'Basic|Portable::Example|bird↑Vogel'); await practice(page);
  await page.locator('#completeDeckButton').click();
  await page.waitForFunction(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('lingodeck-library'); r.onsuccess = () => resolve(r.result); });
    const saved = await new Promise(resolve => { const r = db.transaction('library').objectStore('library').get('current'); r.onsuccess = () => resolve(r.result); });
    db.close(); return Boolean(saved?.completed['Portable::Example']);
  });
  await page.reload(); await ready(page);
  assert.equal(await page.locator('#recordCount').textContent(), '1');
  assert.equal(await page.locator('#sourceTableBody tr td:nth-child(2)').textContent(), 'bird');
  assert.equal(await page.locator('#completeDeckButton').textContent(), 'Reviewed today');
});

test('browser-agent callbacks still import, retrieve parent decks and validate range navigation', async t => {
  const { page, context } = await setup(t);
  await context.addInitScript(() => {
    window.agentTools = {};
    Object.defineProperty(document, 'modelContext', { value: { registerTool(tool) { window.agentTools[tool.name] = tool; } } });
  });
  await page.reload(); await ready(page);
  const result = await page.evaluate(async () => {
    const imported = await agentTools.parse_anki_data.execute({ data: 'Basic|Agent::Deck|one↑uno↓Basic|Agent::Deck|two↑dos↓Basic|Agent::Deck|three↑tres↓Basic|Agent::Deck|four↑cuatro↓Basic|Agent::Deck|five↑cinco↓Basic|Agent::Deck|six↑seis' });
    const retrieved = agentTools.retrieve_deck.execute({ deck: 'Agent' });
    const range = agentTools.open_practice_range.execute({ row: 6 });
    let rejected = false;
    try { agentTools.open_practice_range.execute({ row: 99 }); } catch { rejected = true; }
    return { imported, retrieved, range, rejected };
  });
  assert.deepEqual(result.imported, { records: 6, decks: ['Agent::Deck'], fields: 2 });
  assert.equal(result.retrieved.rows, 6);
  assert.deepEqual(result.range, { start: 6, end: 6, rows: 1 });
  assert.equal(result.rejected, true);
});
