# LingoDeck

LingoDeck prepares vocabulary for Anki through small, predictable, ordered groups,
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

## Import and practice

- Paste the existing native export or use **Add file**, then **Parse data**.
  The import format is unchanged: `|` separates metadata, `↑` separates fields,
  `↓` separates records, and `::` defines deck hierarchy. Multiline text-file
  exports are also supported.
- Imports add to the browser's library. Importing an existing deck asks before
  updating it; other decks and completion markers are retained.
- Choose a deck or parent deck and click **Retrieve data**. Record order is kept.
- **Fields** selects the languages included in Practice. Each included column
  has its own **Show column / Hide column** control. These controls do not change
  field inclusion or erase typed answers. A column control clears temporary
  row/global reveal overrides so its visibility applies consistently to the group.
- Typing is optional. Enter checks a typed answer and advances to the next
  editable row. Settings can restrict checking to one included field; the default
  continues to accept any included field.
- **View** reveals a row and clears/disables its answer, as before. **Reveal all**
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
last deck/group/view, playback preferences, and completion dates. Typed attempts
are temporary; this is not a score history or a scheduling system.

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
