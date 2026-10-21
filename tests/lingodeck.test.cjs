const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const gradientThemeIds = ['arctic-ice', 'golden-sunset', 'lavender-dream', 'mint-serenity', 'midnight-aurora'];
const themeIds = ['default', 'ocean', 'forest', 'lavender', 'warm-neutral', ...gradientThemeIds];

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

async function setup(t, mockSpeech = false, options = {}) {
  const context = await browser.newContext(options);
  t.after(() => context.close());
  if (mockSpeech) await context.addInitScript(() => {
    const voices = [
      { name: 'German local', lang: 'de-DE', localService: true },
      { name: 'Microsoft Katja Online Natural', lang: 'de-DE', localService: false },
      { name: 'English local', lang: 'en-US', localService: true },
      { name: 'Microsoft Ava Online Natural', lang: 'en-US', localService: false }
    ];
    window.speechLog = [];
    window.speechInstances = [];
    window.speechCancelCount = 0;
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => window.noVoices ? [] : voices, cancel() { window.speechCancelCount += 1; }, addEventListener() {},
      speak(utterance) {
        window.speechLog.push({ text: utterance.text, voice: utterance.voice?.name, lang: utterance.lang, rate: utterance.rate });
        window.speechInstances.push(utterance);
        if (window.holdSpeech) return;
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
  assert.equal(await page.locator('[data-column-toggle]:not([data-column-toggle="answer"])').count(), 2);
  assert.equal(await page.locator('.answer-input').first().inputValue(), 'the cause');
  assert.equal(await page.locator('#repeatButton').isVisible(), false);
  await page.locator('#settingsButton').click();
  await page.locator('#repeatPasses').check();
  await page.locator('#closeSettingsButton').click();
  const before = await page.locator('#practiceTableBody .item-number').allTextContents();
  await page.locator('#repeatButton').click();
  assert.deepEqual(await page.locator('#practiceTableBody .item-number').allTextContents(), before);
  assert.equal(await page.locator('.answer-input').first().inputValue(), '');
  assert.equal(await page.locator('.reference-content').count(), 5);
  assert.equal(await page.locator('[data-column-toggle]:not([data-column-toggle="answer"])').count(), 2);
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

test('practice headers expose aligned, accessible icon controls even when their content is hidden', async t => {
  const { page } = await setup(t);
  await importData(page); await practice(page);
  const toggle = page.locator('[data-column-toggle="0"]');
  assert.equal(await toggle.textContent(), '');
  assert.match(await toggle.getAttribute('title'), /Show .* column/);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(await toggle.locator('svg').count(), 1);
  await toggle.focus(); await toggle.press('Enter');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  assert.match(await toggle.getAttribute('aria-label'), /Hide .* column/);
  assert.equal(await page.locator('.reference-content').count(), 5);
  await toggle.press('Space');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(await toggle.isVisible(), true);
  assert.equal(await page.locator('[data-speak-column="0"]').isVisible(), true);
  assert.equal(await page.locator('.reference-content').count(), 0);
  const centers = await page.locator('.practice-header-actions').evaluateAll(groups => groups.map(group => { const rect = group.getBoundingClientRect(); return rect.top + rect.height / 2; }));
  assert.ok(Math.max(...centers) - Math.min(...centers) < 1, 'Header controls align on a shared horizontal axis');
});

test('row reference toggles sit beside every item number and independently preserve existing reveal behavior', async t => {
  const { page } = await setup(t);
  await importData(page); await practice(page);
  const rows = page.locator('#practiceTableBody tr');
  assert.equal(await rows.count(), 5);
  assert.equal(await page.locator('#practiceTableHead th').count(), 5, 'No redundant Reference-controls column');
  assert.equal(await page.locator('.reveal-col').count(), 0);
  assert.deepEqual(await page.locator('.item-number').allTextContents(), ['1', '2', '3', '4', '5']);
  const input = rows.nth(0).locator('.answer-input');
  await input.fill('the cause'); await input.press('Enter');
  await rows.nth(1).locator('.answer-input').fill('keep this attempt');
  for (let i = 0; i < 5; i++) {
    const cell = rows.nth(i).locator('td').first();
    assert.equal(await cell.locator('.item-number').textContent(), String(i + 1));
    assert.equal(await cell.locator('[data-reveal-row]').count(), 1);
    const [number, button] = await Promise.all([cell.locator('.item-number').boundingBox(), cell.locator('.view-toggle').boundingBox()]);
    assert.ok(button.x > number.x + number.width, 'The toggle is beside, not below, the item number');
    assert.ok(Math.abs(number.y + number.height / 2 - button.y - button.height / 2) < 1);
  }
  await rows.nth(0).getByRole('button', { name: 'View reference for row 1', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await rows.nth(0).locator('.view-toggle').getAttribute('aria-pressed'), 'true');
  assert.equal(await rows.nth(0).locator('.reference-content').count(), 3);
  assert.equal(await input.inputValue(), '', 'Revealing retains the existing answer-clearing behavior');
  assert.equal(await input.isDisabled(), true);
  assert.equal(await rows.nth(0).locator('.answer-mark').textContent(), '');
  assert.equal(await rows.nth(1).locator('.answer-input').inputValue(), 'keep this attempt');
  assert.equal(await rows.nth(1).locator('.reference-content').count(), 0);
  assert.equal(await rows.nth(0).locator('.view-toggle').evaluate(element => document.activeElement === element), true, 'Focus survives rendering');
  await page.keyboard.press('Space');
  assert.equal(await rows.nth(0).locator('.reference-content').count(), 0);
  assert.equal(await input.isDisabled(), false);
  await rows.nth(1).locator('.view-toggle').click();
  await rows.nth(3).locator('.view-toggle').click();
  assert.deepEqual(await page.locator('.view-toggle').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-pressed'))), ['false', 'true', 'false', 'true', 'false']);
  assert.equal(await page.locator('.reference-content').count(), 6);
  await page.locator('[data-column-toggle="0"]').click();
  assert.equal(await page.locator('.reference-content').count(), 0, 'Hiding a partially revealed column clears row overrides, as before');
  await page.locator('[data-column-toggle="0"]').click();
  assert.equal(await page.locator('.reference-content').count(), 5, 'Column visibility still uses the shared reveal state');
  await rows.nth(0).locator('.view-toggle').click();
  await rows.nth(0).locator('.view-toggle').click();
  assert.equal(await rows.nth(0).locator('.reference-content').count(), 1, 'Hiding a row preserves explicitly visible columns');
  await page.locator('#nextButton').click(); await page.locator('#nextButton').click();
  assert.deepEqual(await page.locator('.item-number').allTextContents(), ['11', '12', '13']);
  assert.equal(await page.locator('.view-toggle').count(), 3);
  await rows.nth(2).getByRole('button', { name: 'View reference for row 13', exact: true }).click();
  assert.equal(await rows.nth(2).locator('.reference-content').count(), 3);
  assert.equal(await rows.nth(1).locator('.reference-content').count(), 1);
});

test('collapsing answers preserves input nodes, values, validation results, and saved column preferences', async t => {
  const { page } = await setup(t);
  await importData(page); await practice(page);
  const input = page.locator('.answer-input').first();
  await input.fill('the cause'); await input.press('Enter');
  await input.evaluate(element => { window.originalAnswer = element; });
  const expandedWidth = await page.locator('th.answer-col').evaluate(element => element.getBoundingClientRect().width);
  const toggle = page.locator('[data-column-toggle="answer"]');
  await toggle.click();
  assert.equal(await input.isVisible(), false);
  assert.equal(await input.isDisabled(), false);
  assert.equal(await input.inputValue(), 'the cause');
  assert.equal(await page.locator('.answer-wrap.is-correct').count(), 1);
  assert.equal(await input.evaluate(element => window.originalAnswer === element), true);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  const collapsedWidth = await page.locator('th.answer-col').evaluate(element => element.getBoundingClientRect().width);
  assert.ok(collapsedWidth < expandedWidth, 'The hidden answer column occupies less space');
  assert.equal(await toggle.isVisible(), true);
  await toggle.click();
  assert.equal(await input.isVisible(), true);
  assert.equal(await input.inputValue(), 'the cause');
  assert.equal(await input.evaluate(element => window.originalAnswer === element), true);
  await toggle.click();
  await page.waitForFunction(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('lingodeck-library'); request.onsuccess = () => resolve(request.result); });
    const saved = await new Promise(resolve => { const request = db.transaction('library').objectStore('library').get('current'); request.onsuccess = () => resolve(request.result); });
    db.close(); return saved.deckSettings[saved.session.deck].answerCollapsed;
  });
  await page.reload(); await ready(page);
  assert.equal(await page.locator('[data-column-toggle="answer"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.answer-input').first().isVisible(), false);
});

test('column audio follows current-group order, skips empty cells, and uses its language and universal speed', async t => {
  const { page } = await setup(t, true);
  await importData(page, 'Basic|Audio::Deck|bird↑Vogel↑↓Basic|Audio::Deck|dog↑↑↓Basic|Audio::Deck|house↑Haus↑');
  await practice(page);
  await page.locator('#settingsButton').click();
  await page.locator('#speechRate').selectOption('0.75');
  await page.locator('#closeSettingsButton').click();
  await page.locator('[data-speak-column="1"]').click();
  await page.waitForFunction(() => speechLog.length === 2 && document.querySelector('[data-speak-column="1"]').getAttribute('aria-pressed') === 'false');
  assert.deepEqual(await page.evaluate(() => speechLog.map(item => item.text)), ['Vogel', 'Haus']);
  assert.deepEqual(await page.evaluate(() => speechLog.map(item => item.lang)), ['de-DE', 'de-DE']);
  assert.deepEqual(await page.evaluate(() => speechLog.map(item => item.voice)), ['Microsoft Katja Online Natural', 'Microsoft Katja Online Natural']);
  assert.deepEqual(await page.evaluate(() => speechLog.map(item => item.rate)), [0.75, 0.75]);
  assert.equal(await page.locator('.is-audio-active').count(), 0);
  await page.locator('[data-speak-column="2"]').click();
  assert.equal(await page.evaluate(() => speechLog.length), 2);
  assert.match((await page.locator('.toast').allTextContents()).join(' '), /no text to read/);
});

test('column playback can be stopped or replaced without stale completions advancing another queue', async t => {
  const { page } = await setup(t, true);
  await importData(page); await practice(page);
  await page.evaluate(() => { window.holdSpeech = true; });
  const english = page.locator('[data-speak-column="0"]');
  const german = page.locator('[data-speak-column="1"]');
  await english.click();
  await page.waitForFunction(() => speechLog.length === 1);
  assert.equal(await english.getAttribute('aria-pressed'), 'true');
  assert.equal(await english.locator('rect').count(), 1);
  assert.equal(await page.locator('.is-audio-active').count(), 6);
  await page.locator('[data-column-toggle="answer"]').click();
  assert.equal(await english.getAttribute('aria-pressed'), 'true', 'Answer visibility does not interrupt audio');
  await page.evaluate(() => { speechInstances[0].onstart(); speechInstances[0].onend(); });
  assert.deepEqual(await page.evaluate(() => speechLog.map(item => item.text)), ['the cause', 'the choice']);
  await english.click();
  assert.equal(await english.getAttribute('aria-pressed'), 'false');
  await page.evaluate(() => speechInstances[1].onend());
  assert.equal(await page.evaluate(() => speechLog.length), 2);
  await english.click(); await page.waitForFunction(() => speechLog.length === 3);
  await german.click(); await page.waitForFunction(() => speechLog.length === 4);
  assert.equal(await english.getAttribute('aria-pressed'), 'false');
  assert.equal(await german.getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => speechInstances[2].onend());
  assert.equal(await page.evaluate(() => speechLog.length), 4);
  await page.locator('#nextButton').click();
  await page.evaluate(() => speechInstances[3].onend());
  assert.equal(await page.evaluate(() => speechLog.length), 4);
  assert.equal(await page.locator('.is-audio-active').count(), 0);
  await page.locator('[data-speak-column="0"]').evaluate(button => { button.click(); button.click(); });
  assert.equal(await page.locator('[data-speak-column="0"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => speechLog.length), 4);
  await page.locator('[data-speak-column="0"]').click();
  await page.waitForFunction(() => speechLog.length === 5);
  await page.locator('#sourceTab').click();
  await page.evaluate(() => speechInstances[4].onend());
  assert.equal(await page.evaluate(() => speechLog.length), 5);
  assert.equal(await page.locator('.is-audio-active').count(), 0);
  await page.locator('#practiceTab').click();
  await page.locator('[data-speak-column="0"]').click();
  await page.waitForFunction(() => speechLog.length === 6);
  await page.evaluate(() => speechInstances[5].onerror({ error: 'interrupted' }));
  assert.equal(await page.locator('[data-speak-column="0"]').getAttribute('aria-pressed'), 'false');
});

test('a failed online voice retries once locally and continues the column without repeated remote failures', async t => {
  const { page } = await setup(t, true);
  await importData(page); await practice(page);
  await page.evaluate(() => { window.failRemote = true; });
  await page.locator('[data-speak-column="1"]').click();
  await page.waitForFunction(() => speechLog.length === 6 && document.querySelector('[data-speak-column="1"]').getAttribute('aria-pressed') === 'false');
  assert.deepEqual(await page.evaluate(() => speechLog.slice(1).map(item => item.text)), ['die Ursache', 'die Wahl', 'die Erfahrung', 'die Freiheit', 'die Gewohnheit']);
  assert.equal(await page.evaluate(() => speechLog.filter(item => item.voice === 'Microsoft Katja Online Natural').length), 1);
  assert.equal(await page.evaluate(() => speechLog.slice(1).every(item => item.voice === 'German local')), true);
});

test('missing voices use the language default and unsupported speech returns idle controls', async t => {
  const { page } = await setup(t, true);
  await importData(page, 'Basic|Audio::Deck|bird↑Vogel'); await practice(page);
  await page.evaluate(() => { window.noVoices = true; });
  await page.locator('[data-speak-column="1"]').click();
  await page.waitForFunction(() => speechLog.length === 1 && document.querySelector('[data-speak-column="1"]').getAttribute('aria-pressed') === 'false');
  assert.equal(await page.evaluate(() => speechLog[0].lang), 'de-DE');
  assert.equal(await page.evaluate(() => speechLog[0].voice), undefined);
  await page.evaluate(() => Object.defineProperty(window, 'speechSynthesis', { value: undefined }));
  await page.locator('[data-speak-column="1"]').click();
  assert.equal(await page.locator('[data-speak-column="1"]').getAttribute('aria-pressed'), 'false');
  assert.match((await page.locator('.toast').allTextContents()).join(' '), /not supported/);
});

test('appearance updates semantic tokens immediately, supports keyboard selection, and survives reload', async t => {
  const { page } = await setup(t);
  await importData(page); await practice(page);
  await page.locator('#completeDeckButton').click();
  await page.locator('#settingsButton').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'default');
  assert.deepEqual(await page.locator('[data-theme-choice]').evaluateAll(buttons => buttons.map(button => button.dataset.themeChoice)), themeIds);
  for (const id of [...themeIds.slice(1), 'default']) {
    await page.locator(`[data-theme-choice="${id}"]`).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), id);
    assert.equal(await page.locator(`[data-theme-choice="${id}"]`).getAttribute('aria-checked'), 'true');
    assert.equal(await page.locator('#themeOptions [aria-checked="true"]').count(), 1);
    assert.equal(await page.locator('#recordCount').textContent(), '18');
    const ratios = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      function rgb(token) { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = style.getPropertyValue(token); ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3); }
      function lum(color) { return color.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0); }
      function contrast(a, b) { const [light, dark] = [lum(rgb(a)), lum(rgb(b))].sort((a, b) => b - a); return (light + .05) / (dark + .05); }
      return {
        text: contrast('--ink', '--paper'), secondary: contrast('--ink-2', '--paper'), muted: contrast('--ink-3', '--surface-soft'),
        primary: contrast('--on-accent', '--blue'), primaryHover: contrast('--on-accent', '--blue-dark'), selected: contrast('--blue-dark', '--blue-soft'),
        success: contrast('--success', '--success-soft'), danger: contrast('--danger', '--danger-soft'), warning: contrast('--warning', '--warning-soft'),
        successMark: contrast('--on-accent', '--success'), errorMark: contrast('--on-accent', '--danger'),
        nav: contrast('--nav-text', '--nav-bg'), navSecondary: contrast('--nav-muted', '--nav-bg')
      };
    });
    for (const [name, ratio] of Object.entries(ratios)) assert.ok(ratio >= 4.5, `${id} ${name} contrast ${ratio.toFixed(2)} must reach 4.5:1`);
  }
  await page.locator('[data-theme-choice="default"]').press('ArrowRight');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'ocean');
  await page.locator('[data-theme-choice="ocean"]').press('ArrowRight');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'forest');
  await page.locator('#closeSettingsButton').click();
  await page.waitForFunction(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('lingodeck-library'); request.onsuccess = () => resolve(request.result); });
    const saved = await new Promise(resolve => { const request = db.transaction('library').objectStore('library').get('current'); request.onsuccess = () => resolve(request.result); });
    db.close(); return saved.preferences.theme === 'forest';
  });
  await page.reload(); await ready(page);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'forest');
  assert.equal(await page.locator('#completeDeckButton').textContent(), 'Reviewed today');
  assert.equal(await page.locator('#recordCount').textContent(), '18');
});

test('all five gradient palettes preview their backgrounds and persist without losing the existing library', async t => {
  const { page } = await setup(t);
  await importData(page); await practice(page);
  assert.match(await page.title(), /^Bellasprak —/);
  assert.equal(await page.locator('.brand').getAttribute('aria-label'), 'Bellasprak');
  assert.equal(await page.locator('.brand-name').textContent(), 'Bellasprak');
  for (const id of gradientThemeIds) {
    await page.locator('#settingsButton').click();
    const option = page.locator(`[data-theme-choice="${id}"]`);
    assert.equal(await option.locator('.theme-gradient-preview').count(), 1);
    const preview = await option.locator('.theme-gradient-preview').evaluate(element => getComputedStyle(element).backgroundImage);
    assert.match(preview, /^linear-gradient\(/);
    await option.click();
    const background = await page.locator('body').evaluate(element => getComputedStyle(element).backgroundImage);
    assert.ok(background.includes(preview), `${id} uses the previewed gradient`);
    assert.equal(await page.locator('html').evaluate(element => getComputedStyle(element).colorScheme), id === 'midnight-aurora' ? 'dark' : 'light');
    assert.equal(await page.locator('.theme-swatches').count(), 5, 'Original palette previews are preserved');
    await page.locator('#closeSettingsButton').click();
    await page.waitForFunction(async expected => {
      const db = await new Promise(resolve => { const request = indexedDB.open('lingodeck-library'); request.onsuccess = () => resolve(request.result); });
      const saved = await new Promise(resolve => { const request = db.transaction('library').objectStore('library').get('current'); request.onsuccess = () => resolve(request.result); });
      db.close(); return saved.preferences.theme === expected;
    }, id);
    await page.reload(); await ready(page);
    assert.equal(await page.locator('html').getAttribute('data-theme'), id);
    assert.equal(await page.locator('#recordCount').textContent(), '18', 'Legacy storage still contains the saved library after renaming');
    assert.deepEqual(await page.locator('.item-number').allTextContents(), ['1', '2', '3', '4', '5']);
  }
  await page.locator('#settingsButton').click();
  await page.locator('[data-theme-choice="default"]').click();
  assert.equal(await page.locator('html').evaluate(element => getComputedStyle(element).colorScheme), 'light');
  assert.equal(await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--page-gradient').trim()), 'none');
  assert.equal(await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--ink').trim()), '#10172b', 'Dark token overrides are completely cleared');
});

test('themes, collapsed headers, and icon touch targets remain usable on narrow screens', async t => {
  const { page } = await setup(t, false, { hasTouch: true });
  await importData(page); await practice(page);
  await page.locator('[data-column-toggle="answer"]').click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (const selector of ['[data-column-toggle="answer"]', '[data-column-toggle="0"]', '[data-speak-column="0"]', '[data-reveal-row="0"]']) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      const box = await page.locator(selector).boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, `Touch target ${selector} is at least 44px`);
    }
    await page.locator('#settingsButton').click();
    for (const id of gradientThemeIds) {
      await page.locator(`[data-theme-choice="${id}"]`).click();
      assert.equal(await page.evaluate(() => document.querySelector('#settingsDialog').scrollWidth <= document.querySelector('#settingsDialog').clientWidth), true, `${id} settings fit at ${width}px`);
      const optionFits = await page.locator(`[data-theme-choice="${id}"]`).evaluate(element => element.scrollWidth <= element.clientWidth);
      assert.equal(optionFits, true, `${id} preview and name fit at ${width}px`);
    }
    await page.locator('#closeSettingsButton').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const rowLayout = await page.locator('.item-controls').first().evaluate(element => {
      const number = element.querySelector('.item-number').getBoundingClientRect();
      const button = element.querySelector('.view-toggle').getBoundingClientRect();
      return { gap: button.left - number.right, aligned: Math.abs(number.top + number.height / 2 - button.top - button.height / 2) < 1 };
    });
    assert.ok(rowLayout.gap >= 8 && rowLayout.aligned, `Row controls stay beside numbers at ${width}px`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.header-icon').first().evaluate(element => getComputedStyle(element).transitionDuration.split(',').every(duration => parseFloat(duration) <= .001)), true);
});

test('older library backups preserve their content and settings while new appearance preferences round-trip', async t => {
  const { page } = await setup(t);
  const oldLibrary = {
    version: 1, records: [{ id: 'old-1', noteType: 'Basic', deck: 'Saved::Deck', fields: ['bird', 'Vogel'] }],
    deckSettings: { 'Saved::Deck': { fields: [{ name: 'English', language: 'en-US', enabled: true, visible: true }, { name: 'German', language: 'de-DE', enabled: true, visible: false }], answerField: 1, chunk: 0 } },
    completed: { 'Saved::Deck': '2026-10-01T12:00:00.000Z' }, preferences: { rate: .75, repeatPasses: true, shortcuts: true, keyLanguage: 'de-DE' },
    session: { deck: 'Saved::Deck', chunk: 0, view: 'practice' }
  };
  await page.locator('#settingsButton').click();
  await page.locator('#backupInput').setInputFiles({ name: 'old-library.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(oldLibrary)) });
  await page.waitForFunction(() => !document.querySelector('#settingsDialog').open);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'default');
  assert.equal(await page.locator('#recordCount').textContent(), '1');
  assert.equal(await page.locator('[data-column-toggle="answer"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-column-toggle="0"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-column-toggle="1"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#completeDeckButton').textContent(), 'Reviewed today');
  await page.locator('[data-column-toggle="answer"]').click();
  await page.locator('#settingsButton').click();
  assert.equal(await page.locator('#speechRate').inputValue(), '0.75');
  await page.locator('[data-theme-choice="midnight-aurora"]').click();
  const downloading = page.waitForEvent('download');
  await page.locator('#backupButton').click();
  const download = await downloading;
  assert.match(download.suggestedFilename(), /^bellasprak-library-\d{4}-\d{2}-\d{2}\.json$/);
  const stream = await download.createReadStream();
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const saved = JSON.parse(Buffer.concat(chunks));
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.records[0].fields, ['bird', 'Vogel']);
  assert.equal(saved.preferences.theme, 'midnight-aurora');
  assert.equal(saved.deckSettings['Saved::Deck'].answerCollapsed, true);
  assert.equal(saved.deckSettings['Saved::Deck'].answerField, 1);
  assert.equal(saved.completed['Saved::Deck'], oldLibrary.completed['Saved::Deck']);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#backupInput').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.concat(chunks) });
  await page.waitForFunction(() => !document.querySelector('#settingsDialog').open);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'midnight-aurora');
  assert.equal(await page.locator('.answer-input').first().isVisible(), false);
  assert.equal(await page.locator('#recordCount').textContent(), '1');
});
