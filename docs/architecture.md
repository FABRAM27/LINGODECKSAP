# Bellasprak architecture

## Goals and deliberate constraints

Bellasprak remains a static HTML/CSS/JavaScript application. It familiarizes
learners with ordered groups of vocabulary before Anki; it is not a scheduler,
randomized test system, cloud library, or paid service. This reorganization changes
code ownership and loading, not the visual design or learning workflow.

There is no build step or runtime dependency. Open `lingodeck.html` with `assets/`
beside it, or serve the repository with `python -m http.server 8765` and visit
`http://localhost:8765/lingodeck.html`. File-based storage depends on the browser;
a stable HTTP origin is more predictable. Copy the whole folder, not just HTML.

## Module boundaries

| File | Responsibility | Dependencies |
| --- | --- | --- |
| `lingodeck.html` | Static, accessible page and dialog markup | Relative stylesheet, icon, ordered scripts |
| `assets/css/app.css` | Existing layout, semantic tokens, component states, responsive and reduced-motion rules | No external styles or fonts |
| `assets/js/config.js` | Languages, ten theme definitions, Useful Keys, SVG controls, built-in sample | None |
| `assets/js/content.js` | Native import parsing, text normalization, safe HTML rendering, answer matching normalization | DOM only for HTML utilities |
| `assets/js/library.js` | Default library, version-1 validation, IndexedDB connection, save queue, revision/conflict protection | Configuration, browser IndexedDB; warning callback |
| `assets/js/speech.js` | Voice inventory and ranking, previews, ordered playback, stop/cancel, remote-to-local retry | Configuration, content utilities; injected UI/state and preference getter |
| `assets/js/app.js` | Composition, private application/library state, deck/practice rendering, events, settings, keyboard shortcuts, optional browser-agent callbacks | All preceding modules |

Scripts are classic `defer` scripts in the order shown above. They share one
`window.Bellasprak` namespace containing configuration and module APIs, not a
global copy of personal library data. Module internals use closures. Native ES
modules and `fetch()`-loaded local configuration are deliberately avoided because
they would impose additional restrictions on direct `file:` use.

The UI controller creates one library store and one speech controller. It supplies
the speech controller with the current group and a **live preference getter**:
restoring a backup replaces the library object, so retaining the old preference
object would play at the wrong speed. Shared practice/audio state remains private
to these controllers. There is one playback owner/token, not separate competing
row/column audio engines.

## Compatibility contracts

- Keep `lingodeck.html` as the launch filename. The public product name is
  Bellasprak; changing the entry URL or moving a local file can change access to
  browser-managed data.
- Keep database **`lingodeck-library`**, version **1**, object store **`library`**,
  key **`current`**. Existing data and JSON backups do not require reimport or a
  schema migration on the same origin/profile.
- Preserve the library's `version`, `records`, `deckSettings`, `completed`,
  `preferences`, `session`, and stored `revision` behavior. Validation restores
  supported defaults for older preferences; do not discard user content.
- Saves are serialized and check the existing revision inside a read/write
  transaction. A stale tab must not overwrite another tab's newer library.
  Storage failures must remain visible, with backup available.
- Preserve the native `|` metadata, `↑` field, `↓` record, and `::` hierarchy
  delimiters, metadata headers, multiline-file normalization, field padding,
  record order, and HTML sanitization. Do not replace this with an incompatible
  Anki/export format during cleanup.
- **Fields** inclusion and column visibility are separate. Row and global reveal
  overrides keep their current behavior. Answer-column collapse is visual only;
  revealing a row retains the existing answer-clearing/disabling behavior.
- Keep exact-locale/family matching, natural/enhanced voice ranking, asynchronous
  voice discovery, current speed, and local retry. An engine or library rewrite
  is not part of this reorganization. Actual available voices remain a browser,
  operating-system, and connection property.
- Groups remain ordered and user-controlled. Typed attempts are temporary;
  completion dates, last deck/group/view, settings, and imported content persist.

Browser storage is origin/profile scoped, not stored in `assets/` or beside HTML.
Changing protocol, hostname, port, browser, profile, or computer does not migrate
data. Use Settings backups before moving between the downloaded and hosted app.

## Testing and maintenance

`package.json` and its lockfile describe **development-only** testing. Playwright
was already the browser suite's dependency; it is not shipped into the app.
`npm ci`, `npx playwright install chromium`, and `npm test` reproduce the suite.
The unit suite also runs directly with `node --test tests/modules.test.cjs`.

The browser server serves the actual source files with their proper MIME types.
Tests cover the normal entry and a nested hosting prefix, a seeded legacy
IndexedDB library/revision, old/new backups, imports, fields, ordered practice,
themes, keyboard safety, touch targets, storage failure, stale tabs, and speech
engine mocks. The direct-file test is explicitly skipped if a managed Chromium
policy forbids that navigation; it is not reported as a pass.

Headless speech tests establish selection, sequence, cancellation, and fallback
logic, not naturalness of audible pronunciation. Listen in the real studying
browser/device after any future speech change. There is no assertion here that
Windows Edge/Chrome installation has been tested on this Linux execution host.

For future changes, edit the owning module, preserve the contracts above, run the
full suite, and inspect the affected UI on a narrow and a desktop viewport.
Do not add a framework, bundler, runtime dependency, storage migration, or
service worker merely to organize files. Historical `PROJECT_CONTEXT.md` remains
unchanged; current decisions belong in maintained documentation.
