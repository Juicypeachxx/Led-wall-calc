# LED Wall Planner: notes between Claude sessions

Claude Code reads this file at the start of every session. It says how the project is built and checked, where the last session stopped, and what each session changed. **Before you finish a session, update "Where we left off" and add your session to the log**, in the same push as your work. When the log gets long, shorten the oldest entries to a line each.

## Working rules

- **Work on `main`.** The owner asked for this on 2026-10-14: commit and push straight to `main`. GitHub Pages publishes the repository root from `main`, so every push is live at https://juicypeachxx.github.io/Led-wall-calc/ about a minute later. Check before you push.
- **Never edit `index.html` by hand.** Change `source/src`, run `python3 source/build.py`, and commit the rebuilt `index.html` together with the source.
- **README.md is the user guide.** When something visible changes, update it in the same commit.
- **Every visible text is translated.** Write it in English inside `tr('…')` (`trn(n, '{n} cabinet', '{n} cabinets')` for counts, `trc('context', '…')` when one word needs another translation in one place), with `{name}` placeholders instead of pasted-in values, and add the Slovenian to `source/src/lang-sl.js` in the same change. Format numbers with `fmtInt`, `fmtNum`, `fmtDec`, `fmtPct` and dates with `fmtDate`, never `toFixed` or `toLocaleString` alone, so Slovenian gets decimal commas (1.026,5). `node source/check-lang.js` must pass. The language core is at the top of `engine.js`.
- **Keep old project files opening.** `normalizeProject` in `engine.js` upgrades old files and fills in defaults; give every new project or screen field a default there.
- **The repository is public** (the README says so): no private data, stock lists or contact details in it.
- **The planner also runs on the owner's Synology NAS** (NAS.md), at https://stevecur.ddns.net/led/, beside their own PHP time tracking site "timebox" (which runs in a Web Station container; don't touch it). There `server/api/index.php` keeps projects, your panels and settings in MariaDB (database `led_planner`), behind one shared password. The planner finds it as `api/index.php` next to `index.html`; anywhere else (GitHub Pages, a file) it works from browser storage as before. Keep the API PHP 7.4 compatible, working with both pdo_mysql and mysqli, and never commit `server/api/config.php` (it is in `.gitignore`). The owner updates the NAS by hand: tell them when `index.html` or `server/api/index.php` changed.
- **The same code also runs as a claude.ai artifact.** When `window.claude` exists, projects are saved per signed-in user in the artifact database and exports go through its downloads capability (`storage.js`, end of `ui.js`). Keep both paths working.
- Style: short, plain wording for people who build screens, British spelling (metres, colour), `·` between facts in readouts. Commit messages: a short title, then bullets on what changed for the user.
- Slovenian words used throughout: cabinet = panel, screen = zaslon, data port = podatkovni izhod, controller = krmilnik, power circuit = tokokrog, flown = obešen, ground stack = stoječ, ground beam = talni nosilec, H-frame = H-okvir, post = steber, packing list = seznam opreme. Plurals have four forms (1, 2, 3–4, 5+); where a number would change the words around it, Slovenian uses "label: number" (e.g. `izhodi v uporabi: glavni 7, rezervni 7`).

## Files

| Path | What it is |
|---|---|
| `index.html` | The whole app in one file, built from `source/`; the site serves it |
| `source/build.py` | Builds `index.html` from `source/src` and `source/vendor` |
| `source/check-lang.js` | Checks that every text has its Slovenian, with the same placeholders and four plural forms |
| `server/api/index.php` | The planner's own server: sign-in, and projects, your panels and settings in MariaDB (tables `led_*`, made on first use) |
| `server/api/config.sample.php` | Template for the server's `config.php` (shared password, database) |
| `NAS.md` | Setting the planner up on the owner's Synology NAS |
| `source/src/engine.js` | Language core (`tr`, `trn`, `trc`, number formats), project model, panel catalogue, upgrading old files, all calculations (size, curves, data, power, controller, mounting); no DOM |
| `source/src/lang-sl.js` | Slovenian for every text, keyed by the English |
| `source/src/ui.js` | App state, undo, cards, dialogs, events, exports, start-up |
| `source/src/draw.js` | Stage layout, screen plans, pixel map, test card |
| `source/src/pens.js` | One drawing API for SVG (screen), canvas (PNG, 3D textures) and PDF |
| `source/src/three3d.js` | 3D view (three.js r128) |
| `source/src/pdf.js` | PDF report (jsPDF) |
| `source/src/storage.js` | Saving (browser storage, artifact database) and downloads |
| `source/src/sheets.js` | Reads panel lists from .xlsx or CSV |
| `source/src/shell.html`, `styles.css` | Page markup and styles |
| `source/src/fonts.js` | Barlow subset embedded in the PDF |
| `source/vendor/` | three.js, OrbitControls, jsPDF, web fonts; do not edit |
| `panels-template.xlsx` | Template for panel lists, linked from the README |
| `.nojekyll` | Lets GitHub Pages serve the files as they are |

## Checking a change

1. `python3 source/build.py`, then `git status`: only the files you meant to change, plus `index.html`. Then `node source/check-lang.js`.
2. Open `index.html` in headless Chromium with Playwright. In the cloud container it is preinstalled (`require('/opt/node-tools/node_modules/playwright')`; don't run `playwright install`). Watch for page errors, open the example project (`#btn-example`), try the change, and run every export (`#btn-export`, then `[data-exp="pdf"]`, `layout`, `plan`, `pixmap`, `packing`, `cabinets`, `json`). Warnings about software WebGL come from headless Chromium, not from the app.
3. At phone width (390 px) the page must not scroll sideways.
4. When `server/` or `storage.js` changed: test against a real MariaDB. In the cloud container `apt-get update && apt-get install -y mariadb-server` works; start it with `mariadbd --user=mysql &` (after `mkdir -p /run/mysqld && chown mysql /run/mysqld`), make `led_planner` and its user as NAS.md says, put `index.html` and `server/api` (with a `config.php`) into a folder `led/`, and serve its parent with `php -d opcache.enable=0 -S 127.0.0.1:8099` (with opcache on, a changed `config.php` takes a few seconds to count). Test both drivers (`db_driver` `pdo` and `mysqli`), over host and port and over `db_socket`. Then sign in from two browser contexts and check that a project saved in one shows up in the other.
6. **The NAS package**, for a first install only (it holds an empty `config.php`): `led-for-nas.zip` with one folder `led`: `index.html`, `api/index.php`, and `server/api/config.sample.php` as `api/config.php`. Build it in the scratchpad (`mkdir -p led/api`, copy, `zip -r led-for-nas.zip led`) and send it with SendUserFile; don't commit it. For updates, send just the changed `index.html` or `index.php`.
5. Try it in Slovenian too: Settings › Language, or a browser context with `locale: 'sl-SI'`. After using the change, `window.__lwp.TR_MISSING` (texts asked for with no Slovenian) must be empty. `pdftotext` is installed for reading the PDF report's text.

## Where we left off

Updated 2026-10-14, session 2.

- The planner is in English and Slovenian, switched in Settings › Language (see the session log). Both languages are checked: no text without a translation, all seven exports, phone width, and English output byte for byte as before.
- **The owner is moving the planner onto the NAS** and asked to finish that before new features. Server mode is built and tested (PHP 8.3 with MariaDB 10.11 here, both drivers, over host and port or a socket, two devices). From work they reach the NAS only through QuickConnect (DSM: File Station, Task Scheduler, Package Center), not phpMyAdmin, so NAS.md is ordered for that: 1. upload `led-for-nas.zip` into `web` and extract it, 2. fill in `web/led/api/config.php` with the same database host and port (or socket) as timebox's own `config.php` (which runs in a Web Station container) and test the sign-in ("user name or password is wrong" before step 3 means MariaDB answered), 3. make the database and user `led_planner` (host `%`) in phpMyAdmin at home or with a one-time Task Scheduler script, 4. sign in. They can send the lines of timebox's `config.php` with the host and port, never the passwords. If `/led/` shows timebox, `/led/index.html` should still work; ask for timebox's `.htaccess` (95 bytes) to fix it.
  - **Mix-up on 2026-10-14, not solved yet:** the owner unzipped the package on their computer and dragged the `led` folder into `web`. Its contents landed loose in `web`: the planner's `index.html` replaced timebox's start page `web/index.html` (about 258 KB, uploaded 29 July; the Recycle Bin of `web` is off), and the planner's `api` folder is at `web/api`. Timebox's other files and its database are untouched. https://stevecur.ddns.net/ now shows the planner, which does nothing until `web/api/config.php` is filled in.
  - The owner looks for timebox's `index.html` at home. If found: upload it into `web` with Upload - Overwrite, delete the folder `web/api` (not timebox's file `api.php`), then install the planner as NAS.md says (upload the zip itself, Extract here) and make the database in phpMyAdmin. If not: their GitHub repository `time-tracker` (public, last pushed in May, maybe older than the NAS copy) has an `index.html`; or, if they give up timebox, the planner can be the site itself: move everything else in `web` to `Data/timebox-old`, fill in `web/api/config.php`, and change NAS.md to the address without `/led/`. Ask what they found.
- **Next, asked by the owner: a warehouse.** A section listing the materials in stock, screens/panels and other equipment ("stuff"), filled by importing their Excel file, based on `panels-template.xlsx`. The planner should use it to show whether a project has enough of everything and how much is left for the next projects. It builds on the panels' Stock field and the panel import that exist now.
  - The owner's answers (session 2): track panels and screen versions, cases (how many panels each holds), controllers, ground stack and rigging, cables; reserve **by dates** (booking dates per project, from equipment out to back, day by day against the other booked projects); keep it all in **MariaDB on the NAS**: the warehouse list is imported from their Excel file (based on `panels-template.xlsx`) into the database through the planner. Projects then need real booking date fields in Settings, and the server's `booked` request already returns the projects booked in a period.
  - Plan from session 2: one row per item type with a Category column (panel, case, controller, ground beam, H-frame, post, arm, flying bar, data cable, power cable, other); panel rows carry the panel specs so they also feed the panel lists; cases name the panel they hold and how many; cables and flying bars a length, H-frames and posts a height, ground beams a width. The planner compares a project's needs (from the packing list calculations) with what is left after the other projects booked on the same days, shows a Warehouse section, and a status line in the project.
- **Open question for the owner:** switching an existing screen to Ground stack in the Mounting card keeps its bottom height (the example's main screen stays 1 m up); only new ground-stack screens start on the floor. With a height above 0, the ground beams and feet are drawn under the screen, but the H-frames and posts stand on the floor at 0 and their automatic height counts from the floor (5.3 m for the 4 m main screen). Should switching drop the screen to the floor, or does a height mean a stage deck, with the frames standing on the deck too?

## Session log

Newest first: what the owner asked, the commits, decisions, and anything left open. Each commit's `Claude-Session` line links to the conversation that made it.

### Session 2 · 2026-10-14

- The owner asked to work on `main` from now on, to check where `main` was left, and to add a file that carries commits and changes from one Claude session to the next. Checked `main`: complete, nothing half-done. Session 1's conversation can't be read from here.
- `4417d29` Added this file, `CLAUDE.md`.
- Slovenian translation with a language switch in Settings, asked for by the owner (the commit after `4417d29`):
  - Every text goes through `tr`/`trn`/`trc` (engine.js); `lang-sl.js` holds about 740 Slovenian texts. The page shell is translated in place and everything else is rendered again, so the switch needs no reload. The choice is saved per browser (`Prefs.lang`); with none saved, a Slovenian browser starts in Slovenian.
  - Numbers follow the language (1.026,5 kg; 96 %), and so do dates, the PDF report, CSV column and file names, the example project and new screen names, and mirroring ("Levi stranski" -> "Desni stranski"). In Slovenian the panel list exports Slovenian column names, which the import reads back.
  - The gear button and its dialog are now "Settings", with Language at the top.
  - Legend columns under the plan now size to their longest entry: the power legend's text ran into the next column, in English too.
  - `source/check-lang.js` added for keeping the translations complete.
- The owner asked to move the planner onto their Synology NAS with their MariaDB, beside their time tracking site (PHP files in the `web` share, a Web Station container, phpMyAdmin), with a separate shared password and a new database. Added `server/api/index.php`, `config.sample.php`, `NAS.md`, sign-in in the planner (Settings › Server, the save line), and Slovenian for it. The warehouse waits on top of this.
- The owner said to do the move first and the program after, and that from work they reach the NAS only through QuickConnect, without phpMyAdmin. The server can now reach MariaDB through a socket file (`db_socket`) as well as host and port, its messages say more (socket, host not allowed), and NAS.md does the files and settings first, then the database in phpMyAdmin or with Task Scheduler. Sent the owner `led-for-nas.zip`.
- The owner's first upload went wrong (see Where we left off): timebox's start page was replaced by the planner's. NAS.md now warns against unzipping on the computer and dragging the files in.

### Session 1 · 2026-10-13 to 2026-10-14

All commits went straight to `main`.

- `4e19442` Add LED Wall Planner: the whole planner as one self-contained page for GitHub Pages; sources and `build.py` in `source/`.
- `e1a04f0`, `0617cc3` Added a Pages workflow, then removed it: Pages already publishes every push to `main`.
- `4891813` Mounting per screen (flown, ground stack, back construction): build order follows the mounting, loads in a Mounting card, drawn in the layout, 3D view and PDF, lengths in the packing list.
- `5111e9b` New projects start with an empty stage; the example project moved to the start card and Open. An empty project is saved only once something changes.
- `1cb95b3` Your own panels (brand, model, stock) kept in the browser (and the account in the artifact version); Excel or CSV import, CSV export; `panels.xlsx` next to `index.html` is read on every start; stock check; "Your own size" on the start card. Back construction removed (old files open as ground stack).
- `9924bab` Ground stack rebuilt after the owner's photos of their system: ground beams with adjustable feet, one per cabinet column; behind the screen, at the joints between beams, H-frames (a ladder on two floor rails, clamped to the cabinets) and optional posts. H-frame every N beams (always at both ends), posts or not, frame height (automatic: 0.3 m above the screen), any joint switchable. No diagonal braces.
- `ce93a8a` Arms to the screen: 0 to 10 per H-frame or post (default 1), spread evenly up the frames, drawn in 3D and counted in the readout and packing list.
