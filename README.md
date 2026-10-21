# Bellasprak

Bellasprak prepares vocabulary for Anki through small, predictable, ordered groups,
visual recognition, and pronunciation. Anki remains responsible for randomized
recall and spaced repetition.

## Open the app

Download/extract the repository and open `lingodeck.html` in a modern browser.
The app needs no installation, build step, account, or backend. Browser voices
and online speech engines may need an internet connection.

For a consistent local web address, an optional development server is:

```sh
python -m http.server 8765
```

Then open `http://localhost:8765/lingodeck.html` in your browser. Keep using the
same address and browser profile to access the same saved library.

The app was previously called LingoDeck. Its launch filename (`lingodeck.html`)
and internal browser-storage ID are intentionally unchanged so existing links and
saved libraries keep working. Existing JSON backups remain compatible; new
downloads use the `bellasprak-library-…` name. `PROJECT_CONTEXT.md` retains the
original development conversations and historical product name.

## Import and practice

- Paste the existing native export or use **Add file**, then **Parse data**.
  The import format is unchanged: `|` separates metadata, `↑` separates fields,
  `↓` separates records, and `::` defines deck hierarchy. Multiline text-file
  exports are also supported.
- Imports add to the browser's library. Importing an existing deck asks before
  updating it; other decks and completion markers are retained.
- Choose a deck or parent deck and click **Retrieve data**. Record order is kept.
- **Fields** selects the languages included in Practice. Each included column
  has an **eye / eye-off** button in its header, with a tooltip describing the
  action. These controls do not change field inclusion or erase typed answers.
  A column control clears temporary
  row/global reveal overrides so its visibility applies consistently to the group.
- The **Your answer** header has the same visibility control. Collapsing it only
  hides the input presentation; values, validation results, and field selection
  stay intact. The header remains available to expand it again. This preference
  is saved per deck and kept when changing groups or using Repeat group.
- Typing is optional. Enter checks a typed answer and advances to the next
  editable row. Settings can restrict checking to one included field; the default
  continues to accept any included field.
- Each item's **View / Hide** control is directly beside its number. It reveals
  or hides only that row's reference content, using the same visibility state as
  before; revealing still clears/disables that row's answer. There is no separate
  Reference-controls column. Column visibility and **Reveal all** continue to
  provide broader overrides. **Reveal all**
  exposes all included references; **Hide all** hides them. **Reset** clears
  answers and hides references.
- Settings → **Enable Repeat group** adds a Repeat group button. It clears typed
  answers and individual row reveals while keeping the group, order, included
  fields, column visibility, and global reveal state. It is off by default and
  never changes languages or advances automatically.
- **Mark completed** records an intentional review date. Later, **Reviewed today**
  updates that date. Opening a deck does not change it. Completion stays until
  **Undo completion**, explicit deck deletion, or replacement from a backup.
  Marking a parent does not mark its children. Source's **Completed decks** filter
  and blue completion labels identify reviewed decks.

## Audio and Useful Keys

The play icon in each language column's header reads that column's **current
practice group** from top to bottom, even when its text is hidden. Empty cells
are skipped. The control changes to Stop while playing and highlights the active
column; click again to stop. Starting another pronunciation or column cancels
the previous one. Group/deck navigation, leaving Practice, changing reference
visibility, and opening settings stop playback. Collapsing the Answer column
does not interrupt audio. A remote-voice failure retries locally and uses that
fallback for the rest of the current sequence.

One Settings panel controls universal playback speed and voice previews. The
existing locale matching, natural/enhanced voice ranking, and remote-to-local
retry behavior are preserved. Available voices are listed in automatic selection
order, preferred first. Actual availability and pronunciation depend on the
browser, operating system, installed voices, and connection; a natural voice
cannot be supplied when the browser does not expose one.

**Useful keys** is an optional letter palette. Choose a language and click an
extra letter to insert it at the last active answer's cursor or replace its
selection. Uppercase variants are available. Korean and Japanese are disabled;
use their system input methods. The panel never changes system keyboard settings.

## Appearance

Settings → **Appearance** preserves Default, Ocean, Forest, Lavender, and Warm
Neutral, and adds five gradient palettes:

- **Arctic Ice:** icy blue, soft cyan, and aqua.
- **Golden Sunset:** muted rose, peach, and pale gold.
- **Lavender Dream:** lavender, periwinkle, and powder blue.
- **Mint Serenity:** sage, mint, teal, and ivory.
- **Midnight Aurora:** dark navy, teal, and subdued violet, with matching dark
  surfaces and native form controls.

Swatches preview each palette, including gradients for the new options; a
checkmark identifies the active choice. Gradients enhance the page background;
content surfaces remain calm and readable.
Changes apply immediately throughout the app and are saved with your library.
Default preserves the original blue-and-midnight identity. Existing libraries
and older backups default to this palette and expanded answer inputs.

The palette group supports Tab, arrow keys, Home/End, and Enter/Space. Themes use
centralized semantic color tokens, visible focus indicators, and text/checkmark
feedback alongside color. Reduced-motion preferences disable decorative motion.

## Keyboard shortcuts

Shortcuts can be disabled in Settings. They operate outside inputs, editable text,
select controls, open dialogs, and the open deck menu. They ignore composition,
held-key repeats, Ctrl, Command, Alt, and AltGr. Normal Space, arrow navigation,
browser shortcuts, and native control activation remain available.

| Key | Action in Practice |
| --- | --- |
| B / N | Previous / next group; `[` / `]` also work |
| 1–9 | Show/hide the corresponding included column |
| V | Reveal/hide all references |
| R | Replay the last pronunciation if its reference is still visible |
| F | Fields |
| K | Useful Keys |
| P | Repeat group, when enabled |
| ? | Settings and shortcut help; also works in Source |

Enter inside an answer field checks it. Browser modifiers and IME composition
are ignored there too. Group shortcuts keep focus outside text entry so you can
continue navigating; clicking navigation buttons still focuses the first answer.

## Saved data and backups

IndexedDB stores decks, hierarchy, per-deck field settings and visibility, the
last deck/group/view, appearance and playback preferences, and completion dates.
Typed attempts are temporary; this is not a score history or a scheduling system.

Use Settings → **Back up library** to download a JSON backup. **Restore backup**
validates that file and asks before replacing a nonempty library. **Delete selected
deck** asks before deleting that deck and its subdecks.

Browser data does not live beside the HTML. Copying the repository does not copy
your library. Direct `file:` storage behavior varies by browser and file location;
clearing browser data or changing profiles/addresses can remove access to saved
decks. Keep backups. Full folder-based portability and native applications are
deferred.

Storage failures show a persistent notice rather than claiming changes were
saved. If two tabs edit the library, a stale tab stops saving instead of silently
overwriting the newer library. Reload or export that tab's work before continuing.

## Development checks

The application itself has no package dependencies. The browser regression suite
requires Node.js, the `playwright` package, and Chromium. In an environment with
those tools available:

```sh
node --test --test-concurrency=1 tests/lingodeck.test.cjs
```

Set `CHROMIUM_PATH` if Chromium is neither installed at `/usr/bin/chromium` nor
available through Playwright's bundled-browser location. Speech tests use mock
voice inventories and simulated engine failures; listening checks should also be
performed in the browser and device used for studying.
The direct-file test reports a skip when a managed browser policy blocks `file:`
navigation; that restriction does not count as a successful direct-file check.
