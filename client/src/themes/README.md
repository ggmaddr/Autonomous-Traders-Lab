# Palettes

The live palette is the two token blocks at the top of `client/src/styles.css`:
`:root` (light) and `:root[data-theme="dark"]` (dark). Every colour in the app reads
from those tokens, including the charts, which read them through `cssColor()`. The one
exception is the crew illustrations in `components/Crew.tsx`, which keep their own
fixed colours.

Archived palettes live in this folder, one CSS file each. Nothing imports them, so
they change nothing until you switch one on.

| Palette | File | Light | Dark | Status |
|---|---|---|---|---|
| Ink and brass | `../styles.css` | cool newsprint `#eef0f3`, white cards, navy ink `#0d1b2a`, navy signal `#0f3f8f` | near-black `#0b0c0e`, brass signal `#e2b04f` | live since 2026-11-11 |
| Sunny and the deep | `sunny-and-the-deep.css` | lemon `#ffea00`, cream cards `#fffce3`, cobalt signal `#1d4ed8` | deep purple `#1c0030`, sunflower signal `#ffea00` | archived 2026-11-11 |

## What a palette file covers

Every colour token, for both themes:

- grounds and surfaces: `--ground`, `--surface`, `--raised`, `--active`
- lines: `--border`, `--rule`, `--control`, `--grid`, `--card-edge`
- text tiers: `--text`, `--muted`, `--faint`, `--primary`
- the signal: `--accent-data`
- money and status: `--positive`, `--negative`, `--warn`, `--cash`
- the traders: `--t-robin`, `--t-nami`, `--t-jinbe`, `--t-law`, `--t-luffy`, `--t-zoro`, `--t-sanji`
- crew props: `--crew-gold`, `--crew-edge`
- regime bands: `--rg-calm-bull`, `--rg-volatile-bull`, `--rg-volatile-line`, `--rg-calm-chop`, `--rg-stress`
- shadows and the selected pill: `--shadow-card`, `--shadow-lift`, `--shadow-inner`, `--shadow-pill`, `--pill-on-bg`, `--pill-on-fg`

Fonts, sizes, radii and spacing are not part of a palette and stay in `styles.css`.

## Switch an archived palette on

Take "Sunny and the deep" (`data-palette="sunny"`):

1. In `client/src/main.tsx`, add `import "./themes/sunny-and-the-deep.css";` after `import "./styles.css";`.
2. In `client/index.html`, add `data-palette="sunny"` to the `<html>` tag.

The archived selectors outrank the live blocks, so both light and dark follow the
archived palette and the theme toggle still works. Undo both lines to go back.

## Archive the live palette before replacing it

1. Copy the colour tokens (not fonts, sizes, radii or spacing) from both blocks at the top of `styles.css` into a new file here.
2. Rename the selectors to `:root[data-palette="<name>"]:not([data-theme="dark"])` and `:root[data-palette="<name>"][data-theme="dark"]`.
3. Add a row to the table above.

Before shipping a palette, check every text tier against `--ground`, `--surface`,
`--raised` and `--active` (4.5:1 or better), and every trader and control colour
against `--surface` (3:1 or better).
