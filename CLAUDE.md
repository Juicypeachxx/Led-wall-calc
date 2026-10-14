# LED Wall Planner: notes between Claude sessions

Claude Code reads this file at the start of every session. It says how the project is built and checked, where the last session stopped, and what each session changed. **Before you finish a session, update "Where we left off" and add your session to the log**, in the same push as your work. When the log gets long, shorten the oldest entries to a line each.

## Working rules

- **Work on `main`.** The owner asked for this on 2026-10-14: commit and push straight to `main`. GitHub Pages publishes the repository root from `main`, so every push is live at https://juicypeachxx.github.io/Led-wall-calc/ about a minute later. Check before you push.
- **Never edit `index.html` by hand.** Change `source/src`, run `python3 source/build.py`, and commit the rebuilt `index.html` together with the source.
- **README.md is the user guide.** When something visible changes, update it in the same commit.
- **Keep old project files opening.** `normalizeProject` in `engine.js` upgrades old files and fills in defaults; give every new project or screen field a default there.
- **The repository is public** (the README says so): no private data, stock lists or contact details in it.
- **The same code also runs as a claude.ai artifact.** When `window.claude` exists, projects are saved per signed-in user in the artifact database and exports go through its downloads capability (`storage.js`, end of `ui.js`). Keep both paths working.
- Style: short, plain wording for people who build screens, British spelling (metres, colour), `·` between facts in readouts. Commit messages: a short title, then bullets on what changed for the user.

## Files

| Path | What it is |
|---|---|
| `index.html` | The whole app in one file, built from `source/`; the site serves it |
| `source/build.py` | Builds `index.html` from `source/src` and `source/vendor` |
| `source/src/engine.js` | Project model, panel catalogue, upgrading old files, all calculations (size, curves, data, power, controller, mounting); no DOM |
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

1. `python3 source/build.py`, then `git status`: only the files you meant to change, plus `index.html`.
2. Open `index.html` in headless Chromium with Playwright. In the cloud container it is preinstalled (`require('/opt/node-tools/node_modules/playwright')`; don't run `playwright install`). Watch for page errors, open the example project (`#btn-example`), try the change, and run every export (`#btn-export`, then `[data-exp="pdf"]`, `layout`, `plan`, `pixmap`, `packing`, `cabinets`, `json`). Warnings about software WebGL come from headless Chromium, not from the app.
3. At phone width (390 px) the page must not scroll sideways.

## Where we left off

Updated 2026-10-14, session 2.

- `main` is complete and checked: `index.html` matches the sources; the example project, the ground-stack controls (H-frame every N beams, posts, joints, arms) and all seven exports work in headless Chromium with no page errors, and nothing scrolls sideways at phone width.
- Nothing half-done was found in the code. Session 1's conversation can't be read from a later session, so ask the owner if anything was still pending from it.
- **Open question for the owner:** switching an existing screen to Ground stack in the Mounting card keeps its bottom height (the example's main screen stays 1 m up); only new ground-stack screens start on the floor. With a height above 0, the ground beams and feet are drawn under the screen, but the H-frames and posts stand on the floor at 0 and their automatic height counts from the floor (5.3 m for the 4 m main screen). Should switching drop the screen to the floor, or does a height mean a stage deck, with the frames standing on the deck too?

## Session log

Newest first: what the owner asked, the commits, decisions, and anything left open. Each commit's `Claude-Session` line links to the conversation that made it.

### Session 2 · 2026-10-14

- The owner asked to work on `main` from now on, to check where `main` was left, and to add a file that carries commits and changes from one Claude session to the next.
- Checked `main` (see "Where we left off"); no code changes.
- Added this file, `CLAUDE.md`.

### Session 1 · 2026-10-13 to 2026-10-14

All commits went straight to `main`.

- `4e19442` Add LED Wall Planner: the whole planner as one self-contained page for GitHub Pages; sources and `build.py` in `source/`.
- `e1a04f0`, `0617cc3` Added a Pages workflow, then removed it: Pages already publishes every push to `main`.
- `4891813` Mounting per screen (flown, ground stack, back construction): build order follows the mounting, loads in a Mounting card, drawn in the layout, 3D view and PDF, lengths in the packing list.
- `5111e9b` New projects start with an empty stage; the example project moved to the start card and Open. An empty project is saved only once something changes.
- `1cb95b3` Your own panels (brand, model, stock) kept in the browser (and the account in the artifact version); Excel or CSV import, CSV export; `panels.xlsx` next to `index.html` is read on every start; stock check; "Your own size" on the start card. Back construction removed (old files open as ground stack).
- `9924bab` Ground stack rebuilt after the owner's photos of their system: ground beams with adjustable feet, one per cabinet column; behind the screen, at the joints between beams, H-frames (a ladder on two floor rails, clamped to the cabinets) and optional posts. H-frame every N beams (always at both ends), posts or not, frame height (automatic: 0.3 m above the screen), any joint switchable. No diagonal braces.
- `ce93a8a` Arms to the screen: 0 to 10 per H-frame or post (default 1), spread evenly up the frames, drawn in 3D and counted in the readout and packing list.
