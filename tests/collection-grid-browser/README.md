# Isolated real-browser collection fixture

`node tests/collection-grid-browser/run.mjs` uses the locked, already-installed
Vite/React/Tailwind dependencies, minifies a local fixture and serves it on
`http://127.0.0.1:4319/` (strict port; no public bind). Stop with Ctrl+C.
After source edits, `node tests/collection-grid-browser/run.mjs --build-only`
rebuilds this fixture only; reload the browser before checking the changed code.

It imports the actual WindowedCollectionGrid, collection-window calculation and
current application CSS. The tile DOM follows CardTile but substitutes coloured
blocks and synthetic prices for artwork and user data. CSP disallows all network
connections. No `.env`, application entrypoint, credentials, Firebase service,
signing or production build is loaded. Outputs are ignored under
`outputs/collection-grid-browser/`; no dependency installation is performed.

Verify normal scrolling, keyboard End/Home (including repeated End), responsive
width changes, wrapping price text, late text growth, sorting, filters/empty
results, and 10,000 synthetic entries. Inspect bounded rendered button count,
visible focus destination and non-overlap, as well as browser error logs. This
is real layout evidence, not a logged-in Firebase or production acceptance test.

## Root checkpoint — 2026-10-04, 23:14–23:16 Europe/Berlin

The minified fixture was rebuilt and the page explicitly reloaded after source
changes. Final JS: `index-DyiPl_wT.js`; CSS: `index-DAoK0XDE.css`.
The actual product grid source SHA256 at this checkpoint is
`671FA7E9140E862CF685A54D631B3DA431AA168E2C207AAFD99CCB6F51B14863`.

- Desktop 1280×720, 10,000 entries, long prices and a uniquely taller penultimate
  tile: End focuses `synthetic-9999`, top181.6/bottom529.675,22 mounted buttons,
  zero intersecting tile rectangles. Mobile390×844: same target,
  top294.6/bottom618.1,8 mounted buttons, zero intersections. These are settled
  observations, not a maximum-over-time count, timing benchmark or real device.
- Repeated End and Home remain usable. Width changes reset the measured height
  bound; a fresh End reaches the target after resizing.
- Filter after reordering yields exactly`synthetic-9999`; clicking selects that
  ID, never a reused visual slot. An unmatched query yields zero buttons.
- No error/warning console entries were returned for the final fixture run.
  Screenshots: ignored`outputs/collection-grid-browser/desktop-final-10000.jpg`
  and`mobile-final-10000.jpg`. They contain synthetic data only.

The first neighbour-height browser probe genuinely FAILED: old fixture
`index-CLantVI_.js` left target350 at top3899.2/bottom4310.275 in a720px viewport.
The updated implementation measures the target window including neighbours before
the jump. Same351-card case now yields top181.6/bottom592.675 with21 buttons.
That failed bundle remains in the ignored local fixture directory; it is not a
production artifact. No result above proves Firebase/live data or all possible
CSS/font/zoom states. At unchanged grid geometry, a previously observed larger
row height is intentionally retained, so shorter replacement text can leave space.
Unrelated asynchronous content growth after a completed keyboard jump has no
general scroll-anchoring guarantee. `envDir:false` disables `.env` loading, not
the entire inherited process environment; the fixture uses no `import.meta.env`.
This trusted local harness is not an OS sandbox.
