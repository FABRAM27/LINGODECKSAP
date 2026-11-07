const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createStaticServer } = require('./helpers/static-server.cjs');
const gradientThemeIds = ['arctic-ice', 'golden-sunset', 'lavender-dream', 'mint-serenity', 'midnight-aurora'];
const themeIds = ['default', 'ocean', 'forest', 'lavender', 'warm-neutral', ...gradientThemeIds];

let browser, server, origin;
before(async () => {
  server = createStaticServer();
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
async function enableAnswers(page) {
  await page.locator('#settingsButton').click();
  await page.getByLabel('Enable Answers column', { exact: true }).check();
  await page.locator('#closeSettingsButton').click();
}
async function outsideKeys(page, key, modifiers = {}) {
  return page.evaluate(({ key, modifiers }) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  }, { key, modifiers });
}

async function setPracticeGroupSize(page, size, commitKey = 'Enter') {
  await page.locator('#settingsButton').click();
  const input = page.getByLabel('Entries per practice group', { exact: true });
  await input.fill(String(size));
  await input.press(commitKey);
  assert.equal(await input.getAttribute('aria-invalid'), 'false');
  await page.locator('#closeSettingsButton').click();
}

async function currentReviewIds(page) {
  return page.locator('#practiceTableBody tr').evaluateAll(rows => rows.map(row => row.dataset.recordId));
}
async function collectReviewIds(page) {
  const ids = [];
  const count = await page.locator('#rangeSelect option').count();
  for (let group = 0; group < count; group++) {
    if (await page.locator('#rangeSelect').inputValue() !== String(group)) await page.locator('#rangeSelect').selectOption(String(group));
    ids.push(...await currentReviewIds(page));
  }
  return ids;
}
async function seedShuffle(page) {
  await page.evaluate(() => {
    let seed = 123456789;
    window.shuffleDraws = 0;
    Math.random = () => { window.shuffleDraws++; seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  });
}
async function readStoredLibrary(page) {
  return page.evaluate(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('lingodeck-library'); request.onsuccess = () => resolve(request.result); });
    const saved = await new Promise(resolve => { const request = db.transaction('library').objectStore('library').get('current'); request.onsuccess = () => resolve(request.result); });
    db.close(); return saved;
  });
}

for (const count of [4, 30, 500]) {
  test(`whole-deck shuffle contains all ${count} entry identities once and never changes Source or stored records`, async t => {
    const { page } = await setup(t, false, { reducedMotion: 'reduce' });
    const data = Array.from({ length: count }, (_, i) => `Basic|Review::Deck|${i < 2 ? 'identical↑identisch' : 'word ' + i + '↑Wort ' + i}`).join('↓');
    await importData(page, data); await practice(page);
    if (count === 500) await setPracticeGroupSize(page, 100);
    const stored = await readStoredLibrary(page);
    const source = await page.locator('#sourceTableBody tr').allTextContents();
    const expected = stored.records.map(record => record.id);
    await seedShuffle(page);
    await page.locator('#shuffleButton').click();
    assert.equal(await page.locator('#rangeSelect').inputValue(), '0');
    const shuffled = await collectReviewIds(page);
    assert.equal(shuffled.length, count);
    assert.equal(new Set(shuffled).size, count);
    assert.deepEqual([...shuffled].sort(), [...expected].sort());
    assert.equal(await page.locator('#nextButton').isDisabled(), true, 'No loop remains finite after manual Shuffle');
    assert.deepEqual(await page.locator('#sourceTableBody tr').allTextContents(), source);
    assert.deepEqual((await readStoredLibrary(page)).records, stored.records);
    const draws = await page.evaluate(() => shuffleDraws);
    await page.locator('#shuffleButton').click();
    assert.equal(await page.locator('#rangeSelect').inputValue(), '0');
    assert.equal(await page.locator('#headerProgress').getAttribute('aria-valuenow'), '0');
    assert.ok(await page.evaluate(() => shuffleDraws) > draws);
    if (count > 5) {
      await page.locator('#nextButton').click();
      await page.locator('#shuffleButton').click();
      assert.equal(await page.locator('#rangeSelect').inputValue(), '0', 'An unfinished round can be deliberately replaced');
    }
    assert.deepEqual([...(await collectReviewIds(page))].sort(), [...expected].sort());
    await page.locator('#sourceTab').click();
    assert.deepEqual(await page.locator('#sourceTableBody tr').allTextContents(), source);
    await page.locator('#retrieveButton').click(); await page.locator('#practiceTab').click();
    assert.deepEqual(await collectReviewIds(page), expected, 'Retrieving restores the original ordered workflow');
    assert.equal(await page.locator('#reviewLoop').inputValue(), 'none');
  });
}

test('Loop repeats the current complete sequence only when Next is clicked, with a non-color restart cue', async t => {
  const { page } = await setup(t, false, { reducedMotion: 'reduce' });
  await importData(page); await practice(page); await setPracticeGroupSize(page, 4);
  const original = await collectReviewIds(page);
  assert.equal(await page.locator('#nextButton').isDisabled(), true);
  assert.equal(await page.locator('#headerProgress').getAttribute('aria-valuenow'), '100');
  await page.locator('#reviewLoop').selectOption('loop');
  assert.equal(await page.locator('#rangeSelect').inputValue(), '3', 'Changing to Loop preserves position');
  assert.match(await page.locator('#nextButton').getAttribute('class'), /is-round-restart/);
  assert.equal(await page.locator('#nextRestartIcon').isVisible(), true);
  assert.equal(await page.locator('#nextArrowIcon').isVisible(), false);
  assert.match(await page.locator('#nextButton').getAttribute('aria-label'), /Restart/);
  assert.equal(await page.locator('#nextButton').getAttribute('aria-describedby'), 'roundRestartHint');
  await page.locator('#nextButton').click();
  assert.deepEqual(await currentReviewIds(page), original.slice(0, 4));
  assert.equal(await page.locator('#headerProgress').getAttribute('aria-valuenow'), '0');
  assert.deepEqual(await collectReviewIds(page), original);
  await seedShuffle(page); await page.locator('#shuffleButton').click();
  const shuffled = await collectReviewIds(page), draws = await page.evaluate(() => shuffleDraws);
  assert.equal(await outsideKeys(page, 'n'), true, 'The existing Next shortcut also restarts a looping round');
  assert.deepEqual(await collectReviewIds(page), shuffled);
  assert.equal(await page.evaluate(() => shuffleDraws), draws, 'Loop repeats a shuffled sequence without reshuffling it');
  await page.locator('#reviewLoop').selectOption('none');
  assert.equal(await page.locator('#rangeSelect').inputValue(), '3');
  assert.equal(await page.locator('#nextButton').isDisabled(), true);
  assert.deepEqual(await currentReviewIds(page), shuffled.slice(12));
});

test('Loop and shuffle stays stable through navigation and group-size changes and reshuffles only at explicit round starts', async t => {
  const { page } = await setup(t, false, { reducedMotion: 'reduce' });
  await importData(page); await practice(page); await setPracticeGroupSize(page, 4); await seedShuffle(page);
  await page.locator('#reviewLoop').selectOption('shuffle');
  const first = await collectReviewIds(page), draws = await page.evaluate(() => shuffleDraws);
  assert.equal(first.length, 13); assert.equal(new Set(first).size, 13);
  await page.locator('#previousButton').click();
  await page.locator('#rangeSelect').selectOption('1');
  assert.deepEqual(await currentReviewIds(page), first.slice(4, 8));
  await setPracticeGroupSize(page, 6);
  assert.deepEqual(await currentReviewIds(page), first.slice(0, 6), 'Recalculated group contains the old first entry');
  assert.deepEqual(await collectReviewIds(page), first);
  assert.equal(await page.evaluate(() => shuffleDraws), draws);
  await page.locator('#reviewLoop').selectOption('none');
  assert.deepEqual(await currentReviewIds(page), first.slice(12));
  assert.equal(await page.locator('#nextButton').isDisabled(), true);
  await page.locator('#reviewLoop').selectOption('loop');
  assert.deepEqual(await currentReviewIds(page), first.slice(12));
  assert.equal(await page.evaluate(() => shuffleDraws), draws);
  await page.locator('#reviewLoop').selectOption('shuffle');
  assert.equal(await page.locator('#rangeSelect').inputValue(), '0', 'Selecting Loop and shuffle immediately starts a round');
  const second = await collectReviewIds(page), secondDraws = await page.evaluate(() => shuffleDraws);
  assert.ok(secondDraws > draws);
  assert.deepEqual([...second].sort(), [...first].sort());
  await page.locator('#nextButton').click();
  assert.equal(await page.locator('#rangeSelect').inputValue(), '0');
  assert.equal(await page.locator('#headerProgress').getAttribute('aria-valuenow'), '0');
  assert.ok(await page.evaluate(() => shuffleDraws) > secondDraws);
  const third = await collectReviewIds(page);
  assert.deepEqual([...third].sort(), [...first].sort());
});

test('unchanged speech reads displayed shuffled entries, honors its settings, and cancels stale playback on Shuffle', async t => {
  const { page } = await setup(t, true, { reducedMotion: 'reduce' });
  await importData(page); await practice(page); await seedShuffle(page);
  await page.locator('[data-column-toggle="0"]').click();
  await page.locator('#shuffleButton').click();
  await page.locator('#nextButton').click();
  await page.locator('#settingsButton').click(); await page.locator('#speechRate').selectOption('0.75'); await page.locator('#closeSettingsButton').click();
  const expected = await page.locator('#practiceTableBody [data-practice-field="0"] .reference-text').allTextContents();
  await page.locator('[data-speak-column="0"]').click();
  await page.waitForFunction(() => speechLog.length === 5 && document.querySelector('[data-speak-column="0"]').getAttribute('aria-pressed') === 'false');
  assert.deepEqual(await page.evaluate(() => speechLog.map(item => item.text)), expected);
  assert.equal(await page.evaluate(() => speechLog.every(item => item.voice === 'Microsoft Ava Online Natural' && item.lang === 'en-US' && item.rate === 0.75)), true);
  await page.evaluate(() => { window.holdSpeech = true; });
  await page.locator('[data-speak-column="0"]').click(); await page.waitForFunction(() => speechLog.length === 6);
  await page.locator('#shuffleButton').click();
  assert.equal(await page.locator('[data-speak-column="0"]').getAttribute('aria-pressed'), 'false');
  await page.evaluate(() => speechInstances[5].onend());
  assert.equal(await page.evaluate(() => speechLog.length), 6);
});

test('header progress advances, retreats and recalculates without changing the review sequence', async t => {
  const { page } = await setup(t, false, { reducedMotion: 'reduce' });
  await importData(page); await practice(page);
  assert.equal(await page.locator('#headerProgress').getAttribute('aria-valuenow'), '0');
  await page.locator('#nextButton').click();
  assert.equal(await page.locator('#headerProgress').getAttribute('aria-valuenow'), '50');
  await page.locator('#nextButton').click();
  assert.equal(await page.locator('#headerProgress').getAttribute('aria-valuenow'), '100');
  await page.locator('#previousButton').click();
  assert.equal(await page.locator('#headerProgress').getAttribute('aria-valuenow'), '50');
  await setPracticeGroupSize(page, 4);
  assert.ok(Math.abs(Number(await page.locator('#headerProgress').getAttribute('aria-valuenow')) - 100 / 3) < 0.001);
  assert.match(await page.locator('#headerProgress').getAttribute('aria-valuetext'), /Group 2 of 4/);
  await page.locator('#sourceTab').click(); assert.equal(await page.locator('#headerProgress').isVisible(), false);
  await page.locator('#practiceTab').click(); assert.equal(await page.locator('#headerProgress').isVisible(), true);
});

test('Focus mode releases heading space without replacing inputs, changing state, or stopping speech; Source stays normal', async t => {
  const { page } = await setup(t, true, { reducedMotion: 'reduce' });
  await importData(page); await practice(page); await enableAnswers(page); await seedShuffle(page);
  await page.locator('#shuffleButton').click(); await page.locator('[data-column-toggle="0"]').click();
  const word = await page.locator('#practiceTableBody [data-practice-field="0"] .reference-text').first().textContent();
  const input = page.locator('.answer-input').first(); await input.fill(word); await input.press('Enter');
  await input.evaluate(element => { window.focusAnswerNode = element; });
  const ids = await currentReviewIds(page), beforeTop = await page.locator('.practice-card').evaluate(element => element.getBoundingClientRect().top + scrollY);
  await page.evaluate(() => { const notice = document.querySelector('#storageNotice'); notice.textContent = 'Local-file storage depends on this browser and file location. Keep a library backup in Settings before moving this file.'; notice.dataset.kind = 'local-file'; notice.hidden = false; window.holdSpeech = true; });
  await page.locator('[data-speak-column="0"]').click(); await page.waitForFunction(() => speechLog.length === 1);
  const cancellations = await page.evaluate(() => speechCancelCount);
  await page.getByLabel('Focus mode', { exact: true }).check();
  assert.equal(await page.locator('#practiceView > .view-heading').isVisible(), false);
  assert.equal(await page.locator('#storageNotice').isVisible(), false);
  assert.ok(await page.locator('.practice-card').evaluate(element => element.getBoundingClientRect().top + scrollY) < beforeTop - 60);
  assert.equal(await input.evaluate(element => element === window.focusAnswerNode), true);
  assert.equal(await input.inputValue(), word);
  assert.equal(await page.locator('.answer-wrap.is-correct').count(), 1);
  assert.deepEqual(await currentReviewIds(page), ids);
  assert.equal(await page.evaluate(() => speechCancelCount), cancellations);
  assert.equal(await page.locator('[data-speak-column="0"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => document.fullscreenElement === null), true);
  await page.getByLabel('Focus mode', { exact: true }).uncheck();
  assert.equal(await input.evaluate(element => element === window.focusAnswerNode), true);
  assert.equal(await page.locator('#practiceView > .view-heading').isVisible(), true);
  assert.equal(await page.locator('#storageNotice').isVisible(), true);
  await page.getByLabel('Focus mode', { exact: true }).check();
  await page.locator('#sourceTab').click();
  assert.equal(await page.locator('#sourceView .view-heading').isVisible(), true);
  assert.equal(await page.locator('#storageNotice').isVisible(), true);
  await page.locator('#practiceTab').click();
  assert.equal(await page.locator('#practiceView > .view-heading').isVisible(), false);
  assert.deepEqual(await currentReviewIds(page), ids);
  await page.waitForFunction(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('lingodeck-library'); request.onsuccess = () => resolve(request.result); });
    const saved = await new Promise(resolve => { const request = db.transaction('library').objectStore('library').get('current'); request.onsuccess = () => resolve(request.result); });
    db.close(); return saved.preferences.focusMode === true;
  });
  await page.reload(); await ready(page);
  assert.equal(await page.getByLabel('Focus mode', { exact: true }).isChecked(), true);
  assert.equal(await page.locator('#practiceView > .view-heading').isVisible(), false);
  assert.equal(await page.locator('#reviewLoop').inputValue(), 'none');
});

test('empty and single-group decks handle loop choices and progress without claiming completion', async t => {
  const { page } = await setup(t, false, { reducedMotion: 'reduce' });
  await page.locator('#practiceTab').click();
  assert.equal(await page.locator('#shuffleButton').isDisabled(), true);
  assert.equal(await page.locator('#reviewLoop').isDisabled(), true);
  assert.equal(await page.locator('#headerProgress').getAttribute('aria-valuenow'), '0');
  assert.equal(await page.locator('#headerProgress').getAttribute('aria-valuetext'), 'No deck selected');
  await page.getByLabel('Focus mode', { exact: true }).check(); await page.getByLabel('Focus mode', { exact: true }).uncheck();
  await page.locator('#sourceTab').click(); await importData(page, 'Basic|Single|bird↑Vogel'); await practice(page);
  await setPracticeGroupSize(page, 6);
  assert.equal(await page.locator('#nextButton').isDisabled(), true);
  assert.equal(await page.locator('#headerProgress').getAttribute('aria-valuenow'), '0');
  assert.match(await page.locator('#headerProgress').getAttribute('aria-valuetext'), /all entries are displayed/);
  for (const mode of ['loop', 'shuffle']) {
    await page.locator('#reviewLoop').selectOption(mode);
    const ids = await currentReviewIds(page);
    assert.equal(await page.locator('#nextButton').isDisabled(), false);
    await page.locator('#nextButton').click();
    assert.deepEqual(await currentReviewIds(page), ids);
    assert.equal(await page.locator('#headerProgress').getAttribute('aria-valuenow'), '0');
  }
  await page.locator('#shuffleButton').click();
  assert.equal(await page.locator('#practiceTableBody tr').count(), 1);
  assert.equal(await page.locator('#completeDeckButton').textContent(), 'Mark completed');
});

test('shuffled navigation and resizing do not replace the saved ordered checkpoint or leak a round into backups', async t => {
  const { page } = await setup(t, false, { reducedMotion: 'reduce' });
  await importData(page); await practice(page); await page.locator('#rangeSelect').selectOption('2');
  await page.locator('#shuffleButton').click(); await setPracticeGroupSize(page, 4);
  await page.locator('#rangeSelect').selectOption('1');
  await page.locator('#settingsButton').click();
  const downloading = page.waitForEvent('download'); await page.locator('#backupButton').click();
  const stream = await (await downloading).createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const saved = JSON.parse(Buffer.concat(chunks));
  assert.equal(saved.session.chunk, 2, 'Original row 11 stays in ordered group 9–12');
  assert.equal(saved.deckSettings[saved.session.deck].chunk, 2);
  assert.equal(Object.hasOwn(saved, 'reviewRows'), false);
  assert.equal(Object.hasOwn(saved.preferences, 'reviewLoop'), false);
  await page.locator('#closeSettingsButton').click(); await page.reload(); await ready(page);
  assert.deepEqual(await page.locator('.item-number').allTextContents(), ['9', '10', '11', '12']);
  assert.equal(await page.locator('#reviewLoop').inputValue(), 'none');
  assert.doesNotMatch(await page.locator('#groupPosition').textContent(), /Shuffled/);
});

test('slider-styled checkboxes keep native labels, keyboard state, Fields selection, and saved preferences', async t => {
  const { page } = await setup(t, false, { reducedMotion: 'reduce' });
  await importData(page); await page.locator('#retrieveButton').click();
  async function slider(selector) {
    const input = page.locator(selector);
    const style = await input.evaluate(element => ({ width: getComputedStyle(element).width, height: getComputedStyle(element).height, appearance: getComputedStyle(element).appearance }));
    assert.deepEqual(style, { width: '38px', height: '22px', appearance: 'none' });
    const before = await input.isChecked();
    await input.focus(); await input.press('Space');
    assert.equal(await input.isChecked(), !before);
    assert.equal(await input.evaluate(element => getComputedStyle(element).outlineStyle !== 'none'), true);
  }
  await slider('#retainHeaders'); await slider('#retainLanguages');
  await page.locator('#settingsButton').click();
  await slider('#answersEnabled'); await slider('#repeatPasses');
  await page.locator('#closeSettingsButton').click(); await page.locator('#practiceTab').click();
  await page.locator('#fieldsButton').click(); await slider('[data-field-toggle="2"]');
  await page.locator('#applyFieldsButton').click();
  assert.equal(await page.locator('[data-column-toggle="2"]').count(), 0);
  await page.locator('#keysButton').click(); await slider('#uppercaseKeys');
  assert.equal(await page.locator('[data-letter="Ä"]').isVisible(), true);
  await page.locator('#settingsButton').click();
  const downloading = page.waitForEvent('download'); await page.locator('#backupButton').click();
  const stream = await (await downloading).createReadStream(), chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const saved = JSON.parse(Buffer.concat(chunks));
  assert.equal(saved.preferences.retainHeaders, true); assert.equal(saved.preferences.retainLanguages, true);
  assert.equal(saved.preferences.answersEnabled, true); assert.equal(saved.preferences.repeatPasses, true);
  assert.equal(saved.deckSettings[saved.session.deck].fields[2].enabled, false);
  await page.emulateMedia({ forcedColors: 'active' });
  assert.equal(await page.locator('#answersEnabled').evaluate(element => getComputedStyle(element).appearance), 'auto');
});

test('Focus mode does not conceal actual storage failures', async t => {
  const { page, context } = await setup(t, false, { reducedMotion: 'reduce' });
  await context.addInitScript(() => Object.defineProperty(window, 'indexedDB', { get() { throw new Error('Storage denied'); } }));
  await page.reload(); await ready(page); await page.locator('#practiceTab').click();
  await page.getByLabel('Focus mode', { exact: true }).check();
  assert.equal(await page.locator('#practiceView > .view-heading').isVisible(), false);
  assert.equal(await page.locator('#storageNotice').isVisible(), true);
  assert.match(await page.locator('#storageNotice').textContent(), /Saved storage is unavailable/);
});

test('Answers is off by default, is removed entirely, and can be re-enabled without losing its show/hide state or attempts', async t => {
  const { page } = await setup(t, true, { reducedMotion: 'reduce' });
  await importData(page); await practice(page);
  assert.equal(await page.locator('#practiceTable .answer-col').count(), 0);
  assert.equal(await page.locator('.answer-input').count(), 0);
  assert.equal(await page.locator('[data-column-toggle="answer"]').count(), 0);
  assert.equal(await page.locator('#practiceTableHead th').count(), 4);
  assert.equal(await page.locator('#practiceTableBody tr').first().locator('td').count(), 4);
  assert.equal(await page.locator('#keysButton').isDisabled(), true);
  await page.locator('[data-reveal-row="0"]').click();
  assert.equal(await page.locator('.reference-content').count(), 3);
  await page.locator('[data-reveal-row="0"]').click();
  assert.equal(await outsideKeys(page, 'n'), true);
  assert.deepEqual(await page.locator('.item-number').allTextContents(), ['6', '7', '8', '9', '10']);
  assert.equal(await outsideKeys(page, 'b'), true);
  await page.locator('[data-speak-column="1"]').click();
  await page.waitForFunction(() => speechLog.length === 5 && document.querySelector('[data-speak-column="1"]').getAttribute('aria-pressed') === 'false');
  assert.equal(await page.evaluate(() => speechLog.every(item => item.voice === 'Microsoft Katja Online Natural')), true);
  await page.locator('#settingsButton').click();
  assert.equal(await page.getByLabel('Enable Answers column', { exact: true }).isChecked(), false);
  assert.equal(await page.locator('#answerField').isDisabled(), true);
  await page.getByLabel('Enable Answers column', { exact: true }).check();
  assert.equal(await page.locator('#answerField').isDisabled(), false);
  await page.locator('#closeSettingsButton').click();
  assert.equal(await page.locator('#practiceTable .answer-col').count(), 6);
  await page.locator('.answer-input').first().fill('the cause');
  await page.locator('.answer-input').first().press('Enter');
  await page.locator('[data-column-toggle="answer"]').click();
  await page.locator('#settingsButton').click();
  await page.getByLabel('Enable Answers column', { exact: true }).uncheck();
  assert.equal(await page.locator('#practiceTable .answer-col').count(), 0);
  await page.getByLabel('Enable Answers column', { exact: true }).check();
  await page.locator('#closeSettingsButton').click();
  assert.equal(await page.locator('[data-column-toggle="answer"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.answer-input').first().isVisible(), false);
  await page.locator('[data-column-toggle="answer"]').click();
  assert.equal(await page.locator('.answer-input').first().inputValue(), 'the cause');
  assert.equal(await page.locator('.answer-wrap.is-correct').count(), 1);
  await page.waitForFunction(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('lingodeck-library'); request.onsuccess = () => resolve(request.result); });
    const saved = await new Promise(resolve => { const request = db.transaction('library').objectStore('library').get('current'); request.onsuccess = () => resolve(request.result); });
    db.close(); return saved.preferences.answersEnabled && !saved.deckSettings[saved.session.deck].answerCollapsed;
  });
  await page.reload(); await ready(page);
  assert.equal(await page.locator('#practiceTable .answer-col').count(), 6);
  await page.locator('#settingsButton').click();
  assert.equal(await page.getByLabel('Enable Answers column', { exact: true }).isChecked(), true);
  await page.getByLabel('Enable Answers column', { exact: true }).uncheck();
  await page.locator('#closeSettingsButton').click();
  await page.waitForFunction(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('lingodeck-library'); request.onsuccess = () => resolve(request.result); });
    const saved = await new Promise(resolve => { const request = db.transaction('library').objectStore('library').get('current'); request.onsuccess = () => resolve(request.result); });
    db.close(); return saved.preferences.answersEnabled === false;
  });
  await page.reload(); await ready(page);
  assert.equal(await page.locator('#practiceTable .answer-col').count(), 0);
});

for (const [headers, assignedLanguages] of [[false, false], [true, false], [false, true], [true, true]]) {
  test(`Source retain options are independent: headers ${headers}, languages ${assignedLanguages}`, async t => {
    const { page } = await setup(t, true, { reducedMotion: 'reduce' });
    await importData(page, 'Basic|Origin|bird↑Vogel↑Example');
    await page.locator('#retrieveButton').click();
    for (let i = 0; i < 3; i++) {
      await page.locator(`#fieldName${i}`).fill(['Prompt', 'Translation', 'Context'][i]);
      await page.locator(`#fieldLanguage${i}`).selectOption(['de-DE', 'es-ES', 'fr-FR'][i]);
    }
    await page.locator('#retainHeaders').setChecked(headers);
    await page.locator('#retainLanguages').setChecked(assignedLanguages);
    await importData(page, 'Basic|Target|house↑Haus↑Example↑More');
    await page.locator('#retrieveButton').click();
    assert.deepEqual(await page.locator('[data-field-name]').evaluateAll(inputs => inputs.map(input => input.value)), headers ? ['Field 1', 'Prompt', 'Translation', 'Context'] : ['Field 1', 'Field 2', 'Field 3', 'Field 4']);
    assert.deepEqual(await page.locator('[data-field-language]').evaluateAll(inputs => inputs.map(input => input.value)), assignedLanguages ? ['en-US', 'de-DE', 'es-ES', 'fr-FR'] : ['en-US', 'de-DE', 'en-US', 'en-US']);
    await page.locator('#practiceTab').click();
    await page.locator('[data-speak-column="0"]').click();
    await page.waitForFunction(() => speechLog.length === 1 && document.querySelector('[data-speak-column="0"]').getAttribute('aria-pressed') === 'false');
    assert.equal(await page.evaluate(() => speechLog[0].lang), 'en-US');
    assert.equal(await page.evaluate(() => speechLog[0].voice), 'Microsoft Ava Online Natural');
    await page.locator('[data-speak-column="1"]').click();
    await page.waitForFunction(() => speechLog.length === 2 && document.querySelector('[data-speak-column="1"]').getAttribute('aria-pressed') === 'false');
    assert.equal(await page.evaluate(() => speechLog[1].lang), 'de-DE');
    assert.equal(await page.evaluate(() => speechLog[1].voice), 'Microsoft Katja Online Natural');
  });
}

test('Source retain options override existing deck metadata but preserve field visibility', async t => {
  const { page } = await setup(t, false, { reducedMotion: 'reduce' });
  await importData(page, 'Basic|Known|one↑eins'); await page.locator('#retrieveButton').click();
  await page.locator('#fieldName0').fill('Known prompt');
  await page.locator('#fieldLanguage0').selectOption('it-IT');
  await page.locator('#practiceTab').click(); await page.locator('[data-column-toggle="0"]').click();
  await page.locator('#sourceTab').click();
  await importData(page, 'Basic|Origin|bird↑Vogel'); await page.locator('#retrieveButton').click();
  await page.locator('#fieldName0').fill('New prompt');
  await page.locator('#fieldLanguage0').selectOption('fr-FR');
  await page.locator('#retainHeaders').check(); await page.locator('#retainLanguages').check();
  await page.locator('#deckTrigger').click(); await page.locator('[data-deck="Known"]').click();
  await page.locator('#retrieveButton').click();
  assert.equal(await page.locator('#fieldName0').inputValue(), 'New prompt');
  assert.equal(await page.locator('#fieldLanguage0').inputValue(), 'fr-FR');
  await page.locator('#practiceTab').click();
  assert.equal(await page.locator('[data-column-toggle="0"]').getAttribute('aria-pressed'), 'true');
});

test('Source retain options survive reload and backups with only the current right-aligned columns', async t => {
  const { page } = await setup(t, false, { reducedMotion: 'reduce' });
  await importData(page, 'Basic|Origin|bird↑Vogel↑Example'); await page.locator('#retrieveButton').click();
  for (let i = 0; i < 3; i++) {
    await page.locator(`#fieldName${i}`).fill(['Prompt', 'Translation', 'Context'][i]);
    await page.locator(`#fieldLanguage${i}`).selectOption(['de-DE', 'es-ES', 'fr-FR'][i]);
  }
  await page.locator('#retainHeaders').check(); await page.locator('#retainLanguages').check();
  await importData(page, 'Basic|Short|house↑Haus'); await page.locator('#retrieveButton').click();
  await page.waitForFunction(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('lingodeck-library'); request.onsuccess = () => resolve(request.result); });
    const saved = await new Promise(resolve => { const request = db.transaction('library').objectStore('library').get('current'); request.onsuccess = () => resolve(request.result); });
    db.close(); return saved.session.deck === 'Short' && saved.preferences.retainedHeaders.length === 2 && saved.preferences.retainedHeaders[1] === 'Context';
  });
  await page.reload(); await ready(page);
  assert.equal(await page.locator('#retainHeaders').isChecked(), true);
  assert.equal(await page.locator('#retainLanguages').isChecked(), true);
  assert.equal(await page.locator('#fieldName0').inputValue(), 'Translation');
  await page.locator('#settingsButton').click();
  const downloading = page.waitForEvent('download'); await page.locator('#backupButton').click();
  const stream = await (await downloading).createReadStream();
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const backup = Buffer.concat(chunks);
  assert.deepEqual(JSON.parse(backup).preferences.retainedHeaders, ['Translation', 'Context']);
  await page.locator('#closeSettingsButton').click();
  await page.locator('#retainHeaders').uncheck(); await page.locator('#retainLanguages').uncheck();
  await page.locator('#settingsButton').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#backupInput').setInputFiles({ name: 'retained-columns.json', mimeType: 'application/json', buffer: backup });
  await page.waitForFunction(() => !document.querySelector('#settingsDialog').open);
  assert.equal(await page.locator('#retainHeaders').isChecked(), true);
  assert.equal(await page.locator('#retainLanguages').isChecked(), true);
  await importData(page, 'Basic|Wide|dog↑Hund↑Example↑Extra'); await page.locator('#retrieveButton').click();
  assert.deepEqual(await page.locator('[data-field-name]').evaluateAll(inputs => inputs.map(input => input.value)), ['Field 1', 'Field 2', 'Translation', 'Context']);
  assert.deepEqual(await page.locator('[data-field-language]').evaluateAll(inputs => inputs.map(input => input.value)), ['en-US', 'en-US', 'es-ES', 'fr-FR']);
  assert.equal(await page.locator('#recordCount').textContent(), '3');
});

test('Source retention adds and removes columns only on the left across five, six, three, and five columns', async t => {
  const { page } = await setup(t, false, { reducedMotion: 'reduce' });
  await importData(page, 'Basic|Five|a↑b↑c↑d↑e'); await page.locator('#retrieveButton').click();
  const names = ['English', 'German', 'Spanish', 'French', 'Italian'];
  const codes = ['en-US', 'de-DE', 'es-ES', 'fr-FR', 'it-IT'];
  for (let i = 0; i < 5; i++) {
    await page.locator(`#fieldName${i}`).fill(names[i]);
    await page.locator(`#fieldLanguage${i}`).selectOption(codes[i]);
  }
  await page.locator('#retainHeaders').check(); await page.locator('#retainLanguages').check();
  for (const [deck, values, expectedNames, expectedLanguages] of [
    ['Six', ['x', 'a', 'b', 'c', 'd', 'e'], ['Field 1', ...names], ['en-US', ...codes]],
    ['Three', ['c', 'd', 'e'], names.slice(2), codes.slice(2)],
    ['FiveAgain', ['x', 'y', 'c', 'd', 'e'], ['Field 1', 'Field 2', ...names.slice(2)], ['en-US', 'en-US', ...codes.slice(2)]]
  ]) {
    await importData(page, `Basic|${deck}|${values.join('↑')}`); await page.locator('#retrieveButton').click();
    assert.deepEqual(await page.locator('[data-field-name]').evaluateAll(inputs => inputs.map(input => input.value)), expectedNames);
    assert.deepEqual(await page.locator('[data-field-language]').evaluateAll(inputs => inputs.map(input => input.value)), expectedLanguages);
    assert.deepEqual(await page.locator('#sourceTableBody tr td:not(.number-col)').allTextContents(), values, 'Only metadata aligns; vocabulary fields never move');
  }
});

for (const size of [1, 4, 5, 6, 20]) {
  test(`practice group size ${size} keeps row order, ranges, navigation, progress, and column audio consistent`, async t => {
    const { page } = await setup(t, true, { reducedMotion: 'reduce' });
    await importData(page); await practice(page);
    const english = await page.locator('#sourceTableBody td:nth-child(2)').allTextContents();
    const german = await page.locator('#sourceTableBody td:nth-child(3)').allTextContents();
    await setPracticeGroupSize(page, size);
    await page.locator('[data-column-toggle="0"]').click();
    const count = Math.ceil(13 / size);
    const ranges = Array.from({ length: count }, (_, i) => `${i * size + 1}-${Math.min((i + 1) * size, 13)}`);
    assert.deepEqual(await page.locator('#rangeSelect option').allTextContents(), ranges);
    for (let group = 0; group < count; group++) {
      const start = group * size, end = Math.min(start + size, 13);
      assert.deepEqual(await page.locator('.item-number').allTextContents(), Array.from({ length: end - start }, (_, i) => String(start + i + 1)));
      assert.deepEqual(await page.locator('#practiceTableBody [data-practice-field="0"] .reference-text').allTextContents(), english.slice(start, end));
      assert.equal(await page.locator('#rangeSelect').inputValue(), String(group));
      assert.equal(await page.locator('#groupPosition').textContent(), `Group ${group + 1} of ${count} · Words ${start + 1}–${end} of 13`);
      assert.equal(await page.locator('#previousButton').isDisabled(), group === 0);
      assert.equal(await page.locator('#nextButton').isDisabled(), group === count - 1);
      const progress = await page.locator('#practiceProgressBar').evaluate(element => parseFloat(element.style.width));
      assert.ok(Math.abs(progress - (group + 1) / count * 100) < 0.001);
      if (group === 0 || group === count - 1) {
        await page.evaluate(() => { speechLog.length = 0; });
        await page.locator('[data-speak-column="1"]').click();
        await page.waitForFunction(length => speechLog.length === length && document.querySelector('[data-speak-column="1"]').getAttribute('aria-pressed') === 'false', end - start);
        assert.deepEqual(await page.evaluate(() => speechLog.map(item => item.text)), german.slice(start, end));
        assert.equal(await page.evaluate(() => speechLog.every(item => item.lang === 'de-DE' && item.voice === 'Microsoft Katja Online Natural')), true);
      }
      if (group < count - 1) await page.locator('#nextButton').click();
    }
    if (count > 1) {
      await page.locator('#previousButton').click();
      assert.equal(await page.locator('.item-number').first().textContent(), String((count - 2) * size + 1));
      await page.locator('#rangeSelect').selectOption('0');
      assert.equal(await page.locator('.item-number').first().textContent(), '1');
      await page.locator('#rangeSelect').selectOption(String(count - 1));
      assert.equal(await page.locator('.item-number').first().textContent(), String((count - 1) * size + 1));
    }
  });
}

test('changing practice group size anchors the previous first entry and preserves fields, visibility, attempts, pronunciation replay, and completion', async t => {
  const { page } = await setup(t, true, { reducedMotion: 'reduce' });
  await importData(page); await practice(page);
  await enableAnswers(page);
  await page.locator('#fieldsButton').click();
  await page.locator('[data-field-toggle="2"]').uncheck();
  await page.locator('#applyFieldsButton').click();
  await page.locator('[data-column-toggle="0"]').click();
  await page.locator('#rangeSelect').selectOption('2');
  await page.locator('[data-speak-row="0"][data-speak-field="0"]').click();
  await page.waitForFunction(() => speechLog.length === 1 && document.querySelector('[data-speak-row="0"][data-speak-field="0"]').getAttribute('aria-pressed') === 'false');
  await page.locator('.answer-input').first().fill('the value');
  await page.locator('.answer-input').first().press('Enter');
  await page.locator('[data-reveal-row="1"]').click();
  await page.locator('[data-column-toggle="answer"]').click();
  await page.locator('#completeDeckButton').click();
  await setPracticeGroupSize(page, 4);
  assert.deepEqual(await page.locator('.item-number').allTextContents(), ['9', '10', '11', '12']);
  assert.equal(await page.locator('[data-column-toggle]:not([data-column-toggle="answer"])').count(), 2);
  assert.equal(await page.locator('[data-column-toggle="answer"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('[data-column-toggle="0"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.answer-input').nth(2).inputValue(), 'the value');
  assert.equal(await page.locator('.answer-wrap').nth(2).getAttribute('class'), 'answer-wrap is-correct');
  assert.equal(await page.locator('.answer-input').nth(2).isVisible(), false);
  assert.equal(await page.locator('[data-reveal-row="3"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#completeDeckButton').textContent(), 'Reviewed today');
  assert.equal(await outsideKeys(page, 'r'), true);
  await page.waitForFunction(() => speechLog.length === 2);
  assert.equal(await page.evaluate(() => speechLog[1].text), 'the value', 'Replay follows the same record after its local row index changes');
  await setPracticeGroupSize(page, 6);
  assert.deepEqual(await page.locator('.item-number').allTextContents(), ['7', '8', '9', '10', '11', '12']);
  await setPracticeGroupSize(page, 1);
  assert.deepEqual(await page.locator('.item-number').allTextContents(), ['7']);
  await setPracticeGroupSize(page, 5);
  assert.deepEqual(await page.locator('.item-number').allTextContents(), ['6', '7', '8', '9', '10']);
  assert.equal(await outsideKeys(page, 'n'), true);
  assert.deepEqual(await page.locator('.item-number').allTextContents(), ['11', '12', '13']);
  assert.equal(await outsideKeys(page, 'b'), true);
  assert.deepEqual(await page.locator('.item-number').allTextContents(), ['6', '7', '8', '9', '10']);
});

test('invalid practice group sizes show inline feedback without replacing the previous valid value', async t => {
  const { page } = await setup(t, false, { reducedMotion: 'reduce' });
  await importData(page); await practice(page);
  await setPracticeGroupSize(page, 6);
  await page.locator('#settingsButton').click();
  const input = page.getByLabel('Entries per practice group', { exact: true });
  for (const value of ['', '0', '-1', '1.5', '4.0', '2e2', '9007199254740992']) {
    await input.fill(value); await input.press('Enter');
    assert.equal(await input.getAttribute('aria-invalid'), 'true', `${value} is rejected`);
    assert.equal(await page.locator('#practiceGroupSizeError').isVisible(), true);
    assert.match(await page.locator('#practiceGroupSizeError').textContent(), /current setting is still 6/);
    assert.equal(await page.locator('#practiceTableBody tr').count(), 6);
    assert.equal(await page.locator('#rangeSelect option').first().textContent(), '1-6');
  }
  await input.fill('4');
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }, { keyCode: 229 }]) {
    assert.equal(await input.evaluate((element, modifiers) => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...modifiers });
      element.dispatchEvent(event); return event.defaultPrevented;
    }, modifiers), false);
    assert.equal(await page.locator('#practiceTableBody tr').count(), 6);
  }
  await input.press('Tab');
  assert.equal(await input.getAttribute('aria-invalid'), 'false');
  assert.equal(await page.locator('#practiceGroupSizeError').isVisible(), false);
  assert.equal(await page.locator('#practiceTableBody tr').count(), 4);
  await page.locator('#closeSettingsButton').click();
  await page.locator('#settingsButton').click();
  assert.equal(await input.inputValue(), '4');
});

test('practice group size persists before import, across visits, and through backup restoration', async t => {
  const { page, context } = await setup(t, false, { reducedMotion: 'reduce' });
  await setPracticeGroupSize(page, 6, 'Tab');
  await importData(page); await practice(page);
  assert.equal(await page.locator('#practiceTableBody tr').count(), 6);
  await page.locator('#rangeSelect').selectOption('2');
  await page.locator('#completeDeckButton').click();
  await page.waitForFunction(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('lingodeck-library'); request.onsuccess = () => resolve(request.result); });
    const saved = await new Promise(resolve => { const request = db.transaction('library').objectStore('library').get('current'); request.onsuccess = () => resolve(request.result); });
    db.close(); return saved.preferences.practiceGroupSize === 6 && saved.session.chunk === 2 && Boolean(saved.completed[saved.session.deck]);
  });
  await page.close();
  const reopened = await context.newPage(); await reopened.goto(origin); await ready(reopened);
  assert.deepEqual(await reopened.locator('.item-number').allTextContents(), ['13']);
  assert.equal(await reopened.locator('#groupPosition').textContent(), 'Group 3 of 3 · Words 13–13 of 13');
  await reopened.locator('#settingsButton').click();
  assert.equal(await reopened.getByLabel('Entries per practice group', { exact: true }).inputValue(), '6');
  const downloading = reopened.waitForEvent('download'); await reopened.locator('#backupButton').click();
  const stream = await (await downloading).createReadStream();
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const backup = Buffer.concat(chunks);
  assert.equal(JSON.parse(backup).preferences.practiceGroupSize, 6);
  await reopened.locator('#closeSettingsButton').click();
  await setPracticeGroupSize(reopened, 1);
  await reopened.locator('#settingsButton').click();
  reopened.once('dialog', dialog => dialog.accept());
  await reopened.locator('#backupInput').setInputFiles({ name: 'group-size-backup.json', mimeType: 'application/json', buffer: backup });
  await reopened.waitForFunction(() => !document.querySelector('#settingsDialog').open);
  assert.deepEqual(await reopened.locator('.item-number').allTextContents(), ['13']);
  assert.equal(await reopened.locator('#rangeSelect option').count(), 3);
  assert.equal(await reopened.locator('#completeDeckButton').textContent(), 'Reviewed today');
  await reopened.reload(); await ready(reopened);
  assert.deepEqual(await reopened.locator('.item-number').allTextContents(), ['13']);
  await reopened.locator('#settingsButton').click();
  assert.equal(await reopened.getByLabel('Entries per practice group', { exact: true }).inputValue(), '6');
});

test('changing the global practice group size recalculates positions saved for other decks', async t => {
  const { page } = await setup(t, false, { reducedMotion: 'reduce' });
  await importData(page); await practice(page);
  await setPracticeGroupSize(page, 1);
  async function openDeck(deck) {
    await page.locator('#sourceTab').click(); await page.locator('#deckTrigger').click();
    if (!(await page.locator(`[data-deck="${deck}"]`).isVisible())) {
      await page.getByRole('button', { name: `Expand or collapse ${deck.split('::')[1]}`, exact: true }).click();
    }
    await page.locator(`[data-deck="${deck}"]`).click(); await practice(page);
  }
  await openDeck('Languages::French::Core Verbs');
  await page.locator('#rangeSelect').selectOption('3');
  await openDeck('Languages::German::Core Nouns');
  await page.locator('#rangeSelect').selectOption('10');
  await setPracticeGroupSize(page, 4);
  assert.deepEqual(await page.locator('.item-number').allTextContents(), ['9', '10', '11', '12']);
  await openDeck('Languages::French::Core Verbs');
  assert.deepEqual(await page.locator('.item-number').allTextContents(), ['1', '2', '3', '4']);
  await page.locator('#nextButton').click();
  await setPracticeGroupSize(page, 6);
  assert.deepEqual(await page.locator('.item-number').allTextContents(), ['1', '2', '3', '4', '5']);
  await openDeck('Languages::German::Core Nouns');
  assert.deepEqual(await page.locator('.item-number').allTextContents(), ['7', '8', '9', '10', '11', '12']);
  await page.reload(); await ready(page);
  assert.deepEqual(await page.locator('.item-number').allTextContents(), ['7', '8', '9', '10', '11', '12']);
});

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

test('external assets load with their real MIME types under a nested hosting path', async t => {
  const { page } = await setup(t);
  const nested = createStaticServer('/preview/');
  await new Promise(resolve => nested.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => nested.close(resolve)));
  const base = `http://127.0.0.1:${nested.address().port}/preview/`;
  const loaded = [];
  page.on('response', response => {
    if (response.url().startsWith(base + 'assets/')) loaded.push({ url: response.url(), status: response.status(), type: response.headers()['content-type'] });
  });
  await page.goto(base + 'lingodeck.html'); await ready(page);
  for (const name of ['config', 'content', 'library', 'speech', 'app']) {
    assert.ok(loaded.some(item => item.url.endsWith(`/assets/js/${name}.js`) && item.status === 200 && item.type.startsWith('text/javascript')));
  }
  assert.ok(loaded.some(item => item.url.endsWith('/assets/css/app.css') && item.status === 200 && item.type.startsWith('text/css')));
  assert.equal(await page.locator('.brand-name').textContent(), 'Bellasprak');
  await importData(page); await practice(page);
  await page.locator('[data-reveal-row="0"]').click();
  assert.equal(await page.locator('.reference-content').count(), 3);
  assert.equal(await page.locator('link[rel="manifest"]').count(), 0);
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0, 'PWA support is assessed, not implemented');
});

test('the reorganized app reopens the legacy IndexedDB library and increments its existing revision', async t => {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  // Establish the same origin without starting an app or creating a new database.
  await page.goto(origin + '/assets/icons/favicon.svg');
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('lingodeck-library', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('library');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('library', 'readwrite');
      transaction.objectStore('library').put({
        version: 1, revision: 42,
        records: Array.from({ length: 6 }, (_, i) => ({ id: `legacy-${i}`, noteType: 'Basic', deck: 'Legacy::German', fields: [`word ${i + 1}`, `Wort ${i + 1}`] })),
        deckSettings: { 'Legacy::German': { fields: [{ name: 'English', language: 'en-US', enabled: true, visible: true }, { name: 'German', language: 'de-DE', enabled: true, visible: false }], answerField: 1, answerCollapsed: true, chunk: 1 } },
        completed: { 'Legacy::German': '2026-10-01T12:00:00.000Z' },
        preferences: { rate: 0.75, repeatPasses: true, shortcuts: true, keys: true, keyLanguage: 'de-DE', theme: 'ocean' },
        session: { deck: 'Legacy::German', chunk: 1, view: 'practice' }
      }, 'current');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
  await page.goto(origin + '/lingodeck.html'); await ready(page);
  assert.equal(await page.locator('#recordCount').textContent(), '6');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'ocean');
  assert.deepEqual(await page.locator('.item-number').allTextContents(), ['6']);
  assert.equal(await page.locator('.reference-text').textContent(), 'word 6');
  assert.equal(await page.locator('[data-column-toggle="1"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.answer-input').isVisible(), false);
  assert.equal(await page.locator('#completeDeckButton').textContent(), 'Reviewed today');
  assert.equal(await page.locator('#repeatButton').isVisible(), true);
  await page.locator('#settingsButton').click();
  assert.equal(await page.locator('#speechRate').inputValue(), '0.75');
  assert.equal(await page.locator('#answerField').inputValue(), '1');
  await page.locator('[data-theme-choice="mint-serenity"]').click();
  await page.waitForFunction(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('lingodeck-library'); request.onsuccess = () => resolve(request.result); });
    const saved = await new Promise(resolve => { const request = db.transaction('library').objectStore('library').get('current'); request.onsuccess = () => resolve(request.result); });
    db.close(); return saved.revision > 42 && saved.preferences.theme === 'mint-serenity' && saved.records.length === 6;
  });
  await page.reload(); await ready(page);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'mint-serenity');
  assert.equal(await page.locator('#recordCount').textContent(), '6');
});

test('column visibility complements Fields and Repeat group preserves configuration and order', async t => {
  const { page } = await setup(t);
  await importData(page); await practice(page);
  await enableAnswers(page);
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

test('all previous/next shortcuts focus the first answer and accept immediate typing', async t => {
  const { page } = await setup(t, false, { reducedMotion: 'reduce' });
  await importData(page); await practice(page); await enableAnswers(page);
  await page.locator('#nextButton').focus();
  for (const key of [']', '[', 'n', 'b', 'N', 'B']) {
    const group = [']', 'n', 'N'].includes(key) ? '1' : '0';
    await page.keyboard.press(key);
    await page.waitForFunction(() => document.activeElement === document.querySelector('.answer-input'));
    assert.equal(await page.locator('#rangeSelect').inputValue(), group, `${key} navigates to the expected group`);
    assert.equal(await page.locator('.item-number').first().textContent(), group === '1' ? '6' : '1');
    await page.keyboard.type('answer [ ] b n B N');
    assert.equal(await page.locator('.answer-input').first().inputValue(), 'answer [ ] b n B N', `${key} leaves typing in the first answer`);
    assert.equal(await page.locator('#rangeSelect').inputValue(), group, 'Navigation letters remain text while typing');
    await page.locator('.answer-input').first().evaluate(input => input.blur());
  }
});

test('type, check, navigate, type works without mouse interaction', async t => {
  const { page } = await setup(t, false, { reducedMotion: 'reduce' });
  await importData(page); await practice(page); await enableAnswers(page);
  await setPracticeGroupSize(page, 1);
  await page.locator('.answer-input').focus();
  let group = 0;
  for (const key of [']', ']', '[', 'n', 'b', 'N', 'B']) {
    await page.keyboard.type('practice answer');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.answer-input').evaluate(input => document.activeElement === input), false, 'Checking the last row exits text entry');
    await page.keyboard.press(key);
    group += [']', 'n', 'N'].includes(key) ? 1 : -1;
    await page.waitForFunction(() => document.activeElement === document.querySelector('.answer-input'));
    assert.equal(await page.locator('#rangeSelect').inputValue(), String(group));
    assert.equal(await page.locator('.answer-input').inputValue(), '');
  }
  await page.keyboard.type('ready to keep typing');
  assert.equal(await page.locator('.answer-input').inputValue(), 'ready to keep typing');
});

for (const answers of ['disabled', 'collapsed']) {
  test(`navigation shortcuts leave focus alone when Answers is ${answers}`, async t => {
    const { page } = await setup(t, false, { reducedMotion: 'reduce' });
    await importData(page); await practice(page);
    if (answers === 'collapsed') {
      await enableAnswers(page);
      await page.locator('[data-column-toggle="answer"]').click();
    }
    await page.evaluate(() => {
      window.answerFocusCalls = 0;
      const original = HTMLInputElement.prototype.focus;
      HTMLInputElement.prototype.focus = function (...args) {
        if (this.matches('.answer-input')) window.answerFocusCalls++;
        return original.apply(this, args);
      };
    });
    for (const key of [']', '[', 'n', 'b', 'N', 'B']) {
      await page.keyboard.press(key);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('#rangeSelect').inputValue(), [']', 'n', 'N'].includes(key) ? '1' : '0');
      assert.equal(await page.evaluate(() => document.activeElement.matches('.answer-input')), false);
      assert.equal(await page.evaluate(() => window.answerFocusCalls), 0, 'No hidden or absent answer is asked to focus');
    }
  });
}

test('navigation focus skips disabled, hidden, and read-only answers and tolerates no editable inputs', async t => {
  const { page } = await setup(t, false, { reducedMotion: 'reduce' });
  await importData(page); await practice(page); await enableAnswers(page);
  await page.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true }));
    const inputs = document.querySelectorAll('.answer-input');
    inputs[0].disabled = true;
    inputs[1].closest('.answer-wrap').hidden = true;
    inputs[2].style.visibility = 'hidden';
    inputs[3].readOnly = true;
  });
  await page.waitForFunction(() => document.activeElement === document.querySelectorAll('.answer-input')[4]);
  await page.keyboard.type('first editable answer');
  assert.equal(await page.locator('.answer-input').nth(4).inputValue(), 'first editable answer');
  await page.locator('.answer-input').nth(4).evaluate(input => input.blur());
  for (const unavailable of ['disabled', 'hidden']) {
    await page.evaluate(unavailable => {
      window.answerFocusCalls = 0;
      const key = document.querySelector('#rangeSelect').value === '1' ? '[' : ']';
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      document.querySelectorAll('.answer-input').forEach(input => {
        input.focus = () => window.answerFocusCalls++;
        if (unavailable === 'disabled') input.disabled = true;
        else input.closest('.answer-wrap').hidden = true;
      });
    }, unavailable);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('#rangeSelect').inputValue(), unavailable === 'disabled' ? '0' : '1');
    assert.equal(await page.evaluate(() => window.answerFocusCalls), 0);
    assert.equal(await page.evaluate(() => document.activeElement.matches('.answer-input')), false);
  }
});

test('Next shortcuts focus the first answer when restarting either kind of loop', async t => {
  const { page } = await setup(t, false, { reducedMotion: 'reduce' });
  await importData(page); await practice(page); await enableAnswers(page);
  for (const mode of ['loop', 'shuffle']) {
    await page.locator('#reviewLoop').selectOption(mode);
    for (const key of [']', 'n', 'N']) {
      await page.locator('#rangeSelect').selectOption('2');
      await page.waitForFunction(() => document.activeElement === document.querySelector('.answer-input'));
      await page.locator('.answer-input').first().evaluate(input => input.blur());
      await page.keyboard.press(key);
      await page.waitForFunction(() => document.querySelector('#rangeSelect').value === '0' && document.activeElement === document.querySelector('.answer-input'));
      await page.keyboard.type('new round');
      assert.equal(await page.locator('.answer-input').first().inputValue(), 'new round');
    }
  }
});

test('shortcuts leave browser modifiers, text inputs, IME, dialogs, and normal controls alone', async t => {
  const { page } = await setup(t);
  await importData(page); await practice(page);
  await enableAnswers(page);
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { ctrlKey: true, altKey: true }, { isComposing: true }, { repeat: true }]) {
    assert.equal(await outsideKeys(page, 'v', modifiers), false);
  }
  for (const key of ['[', ']', 'b', 'n', 'B', 'N']) {
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { modifierAltGraph: true }, { isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
      assert.equal(await outsideKeys(page, key, modifiers), false);
      assert.equal(await page.locator('#rangeSelect').inputValue(), '0');
    }
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
  await enableAnswers(page);
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
  await enableAnswers(page);
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
  await setPracticeGroupSize(page, 4);
  const resizedRange = await page.evaluate(() => agentTools.open_practice_range.execute({ row: 6 }));
  assert.deepEqual(resizedRange, { start: 5, end: 6, rows: 2 });
  assert.deepEqual(await page.locator('.item-number').allTextContents(), ['5', '6']);
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
  const { page } = await setup(t, false, { reducedMotion: 'reduce' });
  await importData(page); await practice(page);
  await enableAnswers(page);
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
    assert.equal(await cell.locator('.view-toggle').textContent(), '', 'Reference controls are icon-only');
    assert.equal(await cell.locator('.view-toggle svg[aria-hidden="true"]').count(), 1);
    assert.equal(await cell.locator('.view-toggle').getAttribute('aria-label'), `View reference for row ${i + 1}`);
    assert.equal(await cell.locator('.view-toggle').getAttribute('title'), `View reference for row ${i + 1}`);
    const [number, button] = await Promise.all([cell.locator('.item-number').boundingBox(), cell.locator('.view-toggle').boundingBox()]);
    assert.ok(button.width >= 74 && button.height >= 35, 'Existing desktop click area is preserved');
    assert.ok(button.x > number.x + number.width, 'The toggle is beside, not below, the item number');
    assert.ok(Math.abs(number.y + number.height / 2 - button.y - button.height / 2) < 1);
  }
  const hiddenIcon = await rows.nth(0).locator('.view-toggle svg').innerHTML();
  await rows.nth(0).getByRole('button', { name: 'View reference for row 1', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await rows.nth(0).locator('.view-toggle').getAttribute('aria-pressed'), 'true');
  assert.equal(await rows.nth(0).locator('.view-toggle').textContent(), '');
  assert.equal(await rows.nth(0).locator('.view-toggle').getAttribute('aria-label'), 'Hide reference for row 1');
  assert.equal(await rows.nth(0).locator('.view-toggle').getAttribute('title'), 'Hide reference for row 1');
  assert.notEqual(await rows.nth(0).locator('.view-toggle svg').innerHTML(), hiddenIcon, 'Revealing switches from eye to eye-off');
  assert.equal(await rows.nth(0).locator('.reference-content').count(), 3);
  assert.equal(await input.inputValue(), '', 'Revealing retains the existing answer-clearing behavior');
  assert.equal(await input.isDisabled(), true);
  assert.equal(await rows.nth(0).locator('.answer-mark').textContent(), '');
  assert.equal(await rows.nth(1).locator('.answer-input').inputValue(), 'keep this attempt');
  assert.equal(await rows.nth(1).locator('.reference-content').count(), 0);
  assert.equal(await rows.nth(0).locator('.view-toggle').evaluate(element => document.activeElement === element), true, 'Focus survives rendering');
  await page.keyboard.press('Space');
  assert.equal(await rows.nth(0).locator('.view-toggle').textContent(), '');
  assert.equal(await rows.nth(0).locator('.view-toggle').getAttribute('aria-label'), 'View reference for row 1');
  assert.equal(await rows.nth(0).locator('.view-toggle svg').innerHTML(), hiddenIcon, 'Hiding restores the eye icon');
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
  await enableAnswers(page);
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
  await enableAnswers(page);
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
  await enableAnswers(page);
  await page.locator('[data-column-toggle="answer"]').click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#shuffleButton').isVisible(), true);
    assert.equal(await page.locator('#reviewLoop').isVisible(), true);
    await page.getByLabel('Focus mode', { exact: true }).check();
    assert.equal(await page.locator('#headerProgress').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const focusTarget = await page.getByLabel('Focus mode', { exact: true }).evaluate(input => input.closest('label').getBoundingClientRect().height);
    assert.ok(focusTarget >= 44);
    await page.getByLabel('Focus mode', { exact: true }).uncheck();
    for (const selector of ['[data-column-toggle="answer"]', '[data-column-toggle="0"]', '[data-speak-column="0"]', '[data-reveal-row="0"]']) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      const box = await page.locator(selector).boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, `Touch target ${selector} is at least 44px`);
      if (selector === '[data-reveal-row="0"]') assert.ok(box.width >= 74, 'Icon-only row buttons retain their reserved click area on touch screens');
    }
    await page.locator('#settingsButton').click();
    for (const id of gradientThemeIds) {
      await page.locator(`[data-theme-choice="${id}"]`).click();
      assert.equal(await page.evaluate(() => document.querySelector('#settingsDialog').scrollWidth <= document.querySelector('#settingsDialog').clientWidth), true, `${id} settings fit at ${width}px`);
      const optionFits = await page.locator(`[data-theme-choice="${id}"]`).evaluate(element => element.scrollWidth <= element.clientWidth);
      assert.equal(optionFits, true, `${id} preview and name fit at ${width}px`);
    }
    const groupSizeInput = page.getByLabel('Entries per practice group', { exact: true });
    await groupSizeInput.fill('0'); await groupSizeInput.press('Enter');
    assert.equal(await page.locator('#practiceGroupSizeError').isVisible(), true);
    assert.equal(await page.evaluate(() => document.querySelector('#settingsDialog').scrollWidth <= document.querySelector('#settingsDialog').clientWidth), true, `Validation feedback fits at ${width}px`);
    const inputBox = await groupSizeInput.boundingBox();
    assert.ok(inputBox.width >= 44 && inputBox.height >= 44, 'Group-size input has a comfortable touch target');
    await groupSizeInput.fill('6'); await groupSizeInput.press('Enter');
    await page.locator('#closeSettingsButton').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const rowLayout = await page.locator('.item-controls').first().evaluate(element => {
      const number = element.querySelector('.item-number').getBoundingClientRect();
      const button = element.querySelector('.view-toggle').getBoundingClientRect();
      return { gap: button.left - number.right, aligned: Math.abs(number.top + number.height / 2 - button.top - button.height / 2) < 1 };
    });
    assert.ok(rowLayout.gap >= 8 && rowLayout.aligned, `Row controls stay beside numbers at ${width}px`);
    await page.locator('#sourceTab').click();
    assert.equal(await page.locator('#retainHeaders').isVisible(), true);
    assert.equal(await page.locator('#retainLanguages').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Source retain options fit at ${width}px`);
    await page.locator('#practiceTab').click();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.header-icon').first().evaluate(element => getComputedStyle(element).transitionDuration.split(',').every(duration => parseFloat(duration) <= .001)), true);
});

test('older library backups preserve their content and settings while new appearance preferences round-trip', async t => {
  const { page } = await setup(t, true);
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
  assert.equal(await page.locator('#practiceTable .answer-col').count(), 0, 'Older backups default to Answers disabled');
  await enableAnswers(page);
  assert.equal(await page.locator('[data-column-toggle="answer"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-column-toggle="0"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-column-toggle="1"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#completeDeckButton').textContent(), 'Reviewed today');
  await page.locator('[data-column-toggle="answer"]').click();
  await page.locator('#settingsButton').click();
  assert.equal(await page.locator('#speechRate').inputValue(), '0.75');
  assert.equal(await page.getByLabel('Entries per practice group', { exact: true }).inputValue(), '5', 'Older backups retain the default group size');
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
  assert.equal(saved.preferences.answersEnabled, true);
  assert.equal(saved.deckSettings['Saved::Deck'].answerCollapsed, true);
  assert.equal(saved.deckSettings['Saved::Deck'].answerField, 1);
  assert.equal(saved.completed['Saved::Deck'], oldLibrary.completed['Saved::Deck']);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#backupInput').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.concat(chunks) });
  await page.waitForFunction(() => !document.querySelector('#settingsDialog').open);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'midnight-aurora');
  assert.equal(await page.locator('[data-column-toggle="answer"]').count(), 1);
  assert.equal(await page.locator('.answer-input').first().isVisible(), false);
  assert.equal(await page.locator('#recordCount').textContent(), '1');
  await page.locator('[data-speak-column="1"]').click();
  await page.waitForFunction(() => speechLog.length === 1 && document.querySelector('[data-speak-column="1"]').getAttribute('aria-pressed') === 'false');
  assert.deepEqual(await page.evaluate(() => speechLog[0]), { text: 'Vogel', voice: 'Microsoft Katja Online Natural', lang: 'de-DE', rate: 0.75 }, 'The speech controller reads preferences from the restored library, not the original object');
});
