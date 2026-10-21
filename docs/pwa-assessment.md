# Optional Windows PWA: feasibility and recommendation

Assessment date: October 21, 2026. Scope: current Microsoft Edge and Google Chrome
on Windows. This is a proposal, **not an implemented or deployed PWA**.

## Recommendation

Bellasprak is a good fit for a small, optional PWA: retain the same static app,
publish its runtime files using **free GitHub Pages hosting**, and later add a
manifest, install icons, and a small hand-written offline service worker. Keep
the downloadable folder equally usable. No native wrapper, rewrite, framework,
backend, paid hosting, subscription, paid speech API, account, or sync service is
needed or proposed. A custom domain is unnecessary; the free `github.io` address
is sufficient. Hosting is subject to GitHub Pages' free eligibility and limits;
on GitHub Free, Pages is available for public repositories. If this repository
is private, confirm a no-cost eligible publication route and approval before
making any code public; do not change visibility or upgrade to a paid plan.

This should be a separate, approved follow-up. The main engineering work is
reliable cache/update handling and actual Windows validation, not porting the UI.
Manifest/icons alone are low complexity; safe offline updates and voice checks
are moderate complexity. A larger PWA toolkit would add little value here.

## Current reality versus the proposal

| Area | Current repository | Proposed optional PWA |
| --- | --- | --- |
| Launch | Download/extract/open `lingodeck.html`, or use a static server | Same download plus an HTTPS site users can install |
| Windows integration | Normal browser tab | Icon, separate app window, Start/taskbar integration |
| Application files offline | Available in the downloaded folder; ordinary hosted browser caching is not an offline guarantee | Explicit cached app files after a successful first online visit/cache installation |
| Imported content/settings | Browser-local IndexedDB | Same IndexedDB and backup format; no personal-data backend |
| Pronunciation | Existing browser speech synthesis and fallback | Same engine; installation does not improve or package voices |
| Updates | Replace downloaded app files, or reload an updated hosted site | Hosted releases plus a controlled service-worker update lifecycle |

## Installation and the Windows experience

Use a valid web app manifest linked by the existing HTML. Include `name` and
`short_name` (Bellasprak), a stable explicit `id`, `start_url`, `scope`,
`display: standalone`, appropriate theme/background colors, and real 192×192 and
512×512 install icons. The current SVG favicon is not a substitute for those
recommended install assets. Use paths relative to the deployed repository
subfolder: for example, `start_url: ./lingodeck.html` and `scope: ./`. Choose the
app identity once; changing a display name should not create a second app.

In Edge, eligible sites expose the address-bar install control and app menu.
Chrome likewise offers browser-managed installation controls. Exact labels and
promotions vary by browser version, engagement heuristics, and enterprise policy.
Some current browser menus can also install ordinary pages as apps. Do not
confuse that shortcut capability with a tested offline-ready PWA, or claim an
install prompt is guaranteed to appear immediately.

Launching the installed app opens a standalone browser-managed window, with the
same layout, speech controls, and learning workflow. Windows can expose it in
Start, the taskbar, and Alt+Tab; users can pin it. The installing browser/runtime
is still required. No `.exe` installer, Microsoft Store publication, Windows
developer account, or app-store registration is necessary for browser install.

A service worker is **not a universal current installability prerequisite**.
It is nevertheless recommended here to make the offline promise real. Prefer
the browser's own installation UI initially; no persistent in-app Install button
or additional settings clutter is needed.

## Free hosting and HTTPS

GitHub Pages can serve static HTML/CSS/JS over HTTPS on a free `github.io` URL;
the app needs no server-side processing. Publish only the application entry and
`assets/` (plus future manifest/worker/icons), not personal backups, test artifacts,
or development conversations. Do not include personal decks in the published
sample/configuration. This assessment does not enable Pages or change repository
visibility or settings.

Production installation should use a stable HTTPS URL. `http://localhost` and
loopback addresses are development exceptions, not a convenient public
distribution mechanism. A localhost installation still depends on its local
server being reachable for initial setup and future updates. `file:` opening
continues as an alternative but is **not** the supported PWA installation route;
neither a GitHub source-file page nor a downloaded ZIP is the hosted app.

Use a stable host, protocol, and deployment path. With a project Pages site,
scope all worker/cache paths to that project's folder, not every project on the
account's origin. GitHub project paths on the same hostname share an origin;
the existing database name could also be shared with other copies of Bellasprak
there. A stable single deployment avoids accidental cross-copy confusion.

## Offline capability and speech limitations

After an initial successful online load and completed cache installation, a
small worker can serve the HTML, stylesheet, scripts, and icons offline. Ordered
practice, field/column controls, themes, local imports, backup/restore, and
completion marking can then run without a server connection, using IndexedDB.
First-ever launch, uncached files, and fetching a new release still need a network.
Browsers/users can clear cached files; installation is not permanent file ownership.

Speech is the important exception. Natural/online voices may need the browser's
remote synthesis service. A service worker cannot download those voice engines,
intercept/cache the browser's internal speech requests reliably, or turn an
online voice into an offline voice. Local installed voices may work offline,
depending on the Windows language packs and the voices that browser exposes;
some languages may have no usable local fallback. Some speech engines may also
report failures inconsistently. Do not promise equal voice quality offline.

Keep the existing natural-first selection, locale matching, universal rate,
ordered queue, and local retry. Do not force lower-quality local voices as the
default merely to make the app "offline." Do not add paid TTS APIs or download
large voice packs. Validate the actual voices in **both** Windows browsers, in
normal tabs and installed windows, online and offline. A PWA uses the browser
speech implementation, but identical voice inventories/quality are not guaranteed.

## Personal data, privacy, and migration

Imported decks, hierarchy, preferences, completion/review dates, last deck/group,
and view remain in the existing **`lingodeck-library`** IndexedDB database. They
are not uploaded to GitHub Pages. There is no account, analytics, telemetry,
cloud database, or synchronization endpoint in the application. As with any
website, the host receives ordinary page-request metadata, not the deck library.
Existing online voice playback may
send the **spoken text** to the browser/voice provider; local library storage must
not be described as a guarantee that pronunciation never uses a remote service.

An installed window and a tab normally use the same data **within the same
origin and installing browser profile**. Installing should not create a fresh
database. Edge versus Chrome, different profiles, InPrivate/Incognito sessions,
different computers, `file:` versus HTTPS, or localhost versus Pages are distinct
storage contexts. An existing downloaded user's migration is explicit: back up
in Settings, open the optional hosted app, restore the JSON there, then install.
Installing alone cannot discover or copy a local-file library. There is no
automatic cross-device portability or Chrome/Edge library sync.

Ordinary app updates must not delete IndexedDB. Browser-site-data deletion,
profile removal, storage pressure/eviction, or uninstall choices that remove site
data can still remove the library. Installation is not a backup or an absolute
persistence guarantee. A future best-effort `navigator.storage.persist()` request
could reduce automatic eviction if granted, but cannot prevent user deletion;
keep JSON backups regardless. Temporary typed attempts remain temporary, just as
now: this proposal does not add a score history or retention scheduler.

## Updates without losing personal data

Deploy the runtime files and future worker as a consistent static release. Use
one app-specific, versioned cache containing only a fixed allowlist of public
application assets. Download the complete new cache successfully before treating
the update as ready; keep the old release usable if download fails.

Let the new worker wait while existing windows use the old version. Offer a
small, non-disruptive "Update available—reload when ready" notice, or activate
after all old windows close. Save pending preferences/session state before an
intentional reload and warn that temporary typed answers are not stored. Do not
force `skipWaiting()` mid-practice or mix a new controller with old scripts.

On activation, remove **only Bellasprak's obsolete app caches**, not every cache
on the origin. Never call `indexedDB.deleteDatabase()` or clear personal storage
as part of an app-cache update. Keep the same database/version-1 validation and
backup contract unless a future explicitly tested migration is necessary.
Changing JavaScript files alone does not refresh a cache-first release: update
the worker's release identifier/precache list with every release. Verify updates
from a previously installed release, not just clean installations.

## Downloaded application remains supported

The repository remains a complete downloadable app. Keep `lingodeck.html` and
the relative `assets/` tree together when extracting or updating. The current
classic scripts require no npm installation, bundler, web account, or network
fetch of configuration. Keep the launch path/browser profile stable for existing
local data, and back up before moving or replacing the folder.

If PWA work is approved later, register its service worker only over HTTP(S)
where supported; do not make direct-file startup depend on registration success.
The manifest and optional worker must not become prerequisites for normal app
use. Copying the downloaded folder still does **not** copy browser-owned decks
or progress; transfer via the existing JSON backup/restore workflow.

## Approval boundary and validation before implementation/release

No manifest, service worker, installation button, hosting configuration, storage
permission request, or deployment is included in this reorganization. Approval
would authorize a separate minimal free-hosted PWA enhancement, not a native
Windows application or a paid-service integration.

Before shipping that enhancement, use actual Windows Edge and Chrome to verify:

1. Fresh install, correct name/icon, standalone launch, and Windows integration.
2. Same-origin tab/installed-window library continuity and no implied cross-browser sync.
3. Offline relaunch after caching; import, practice, themes, backup, and completion.
4. Natural-voice preference online and graceful local/no-voice behavior offline.
5. Upgrade from an older installed version with decks, preferences, and completion
   intact, including multiple open windows and an interrupted update download.
6. Uninstall/site-data deletion warnings and recovery from a JSON backup.
7. Download/extract/direct-open and local-server use still work without PWA APIs.

The current headless Linux checks verify application behavior, not these Windows
installation experiences or the audible naturalness of real installed voices.

## Sources

Consulted for this assessment; browser UI and installation heuristics can change.

- [Microsoft: Getting started with PWAs and HTTPS/static hosting](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/)
- [Microsoft: Using PWAs in Edge and Windows integration](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/ux)
- [GitHub: Pages availability and free static hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages)
- [Google: What does it take to be installable?](https://web.dev/articles/install-criteria)
- [MDN: Making PWAs installable (manifest, HTTPS, localhost, service workers)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [Chrome: Service-worker updates and lifecycle](https://developer.chrome.com/docs/workbox/service-worker-lifecycle)
- [MDN: SpeechSynthesisVoice.localService](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService)
- [MDN: Storage quotas, origins, persistence, and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
