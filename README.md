# Pelican Case Layout Planner

Plan a Pelican case interior to scale before you buy or cut anything, much like a pedalboard planner.

1. **Pick the case**: Pelican Protector (1120–1690) and Air (1485–1637), with interior, base and lid depths from Pelican's spec pages, or enter custom dimensions.
2. **Pick the interior**: empty, pick-n-pluck foam, padded dividers, or TrekPak.
3. **Lay out your gear**: search the built-in library (about 70 items with sourced dimensions) or add your own, then drag, rotate, stand on side or end.

## What it does

- **Accurate 2D editor**: true millimetre geometry, rulers in inches or mm, snapping to walls, dividers and other gear with a set clearance, and live gap measurements around the selected item.
- **Height checks**: warns when gear rises into the lid foam, and errors when the lid won't close.
- **TrekPak**: 7/16" (11 mm) panels, perimeter walls, per-case divider height, T-joints with pins, and **Box it in** to wall off any item. Dividers re-fit automatically when a neighbour moves.
- **Cut list**: labelled cuts (A, B, C…), quantities, pin count, and a strip plan showing how many 15"/23"/30" strips to buy.
- **Foam**: shows exactly which pick-n-pluck cubes to remove.
- **3D preview**: orbit the packed case, with optional lid space.
- **1:1 print**: full-size template tiled across Letter or A4 pages with registration marks and a calibration bar, plus an SVG for a plotter or print shop.
- **Share and save**: the layout is encoded in the link; also save and load `.case.json` files. Autosaves in your browser.

## Adding gear to the library

Gear you add stays in your browser. Click **Submit** next to it to open a pre-filled GitHub issue; once approved, add the JSON line to `src/data/gear.ts`.

## Accuracy notes

- Case figures come from pelican.com spec tables (read 2026-11-21). Pelican's own lid + base sometimes doesn't add up to its total depth; the planner uses the published base depth for the rim.
- TrekPak can only be cut on a flute, and Pelican doesn't publish the flute pitch. Measure yours and set **Flute pitch** in Settings to round cut lengths.
- Manufacturer sizes are nominal and usually leave out knobs, antennas and batteries. Check anything marked as a conflict in its source notes, and measure before cutting.

Not affiliated with Pelican Products. Pelican, Protector, Air and TrekPak are trademarks of their owners.

## Develop

```bash
npm install
npm run dev
```

Every push to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`. In the repo, set **Settings → Pages → Source** to **GitHub Actions**.
