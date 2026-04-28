# Carbonware Flipbook

A polished, cross-device PDF flipbook plugin. Vanilla JS, no framework, ~25 KB minified.

Built on top of [PDF.js](https://mozilla.github.io/pdf.js/) — the rendering engine that ships in Firefox. MIT licensed.

## Why

Off-the-shelf flipbook libraries either ([page-flip](https://github.com/Nodlik/StPageFlip)) have rough mobile sizing OR cost $39+/year ([DearFlip](https://dearflip.com/)). For a single brochure on a single page, neither is the right tradeoff.

This plugin is built specifically for **brochure-style PDFs that need to look professional on any device** — phones, tablets, desktops — without subscription fees.

## Features

- **Three render modes**, auto-picked by viewport:
  - `≥ 1024 px` — two-page spread with horizontal flip animation
  - `600-1023 px` — two-page spread with slide transition
  - `< 600 px` — single page with swipe navigation
- **Crisp at any zoom** — re-renders the page from PDF.js when you zoom past 150% so text never pixellates
- **Touch gestures**: swipe to flip, pinch to zoom, tap edges to navigate, double-tap to toggle zoom
- **Auto-fullscreen on mobile** — uses the entire screen when opened on a phone
- **Glass-morphism modal chrome** with auto-hide on idle
- **Full keyboard navigation**: arrow keys, +/−, 0 to fit, F for fullscreen, Esc to close
- **ARIA / a11y compliant** — labels, focus trap, page-change announcements
- **Honors `prefers-reduced-motion`** — drops to a clean opacity crossfade
- **Pure vanilla JS + CSS** — no jQuery, React, Vue, or any framework
- **Lightweight** — ~25 KB combined CSS + JS (excluding PDF.js)

## Install

PDF.js is a peer dependency. You need to include the prebuilt PDF.js viewer files (or load them from a CDN) — this plugin doesn't bundle them.

### Option 1 — Vendored PDF.js (recommended for production)

```bash
# Download prebuilt PDF.js from
# https://github.com/mozilla/pdf.js/releases
# Extract to your project's vendor folder.
```

Then in your HTML:

```html
<link rel="stylesheet" href="/path/to/cw-flipbook/src/carbonware-flipbook.css">
<script src="/path/to/cw-flipbook/src/carbonware-flipbook.js" defer></script>

<button type="button"
        data-cwflip-pdf="/docs/your-brochure.pdf"
        data-cwflip-title="Your Brochure"
        data-cwflip-pdfworker="/vendor/pdfjs/build/pdf.worker.mjs">
  Open the brochure
</button>
```

### Option 2 — PDF.js from CDN (quickest for prototyping)

```html
<link rel="stylesheet" href="src/carbonware-flipbook.css">
<script src="src/carbonware-flipbook.js" defer></script>

<button type="button"
        data-cwflip-pdf="https://example.com/brochure.pdf"
        data-cwflip-title="Brochure">
  Open
</button>
```

If `data-cwflip-pdfworker` is omitted, the plugin loads PDF.js from jsDelivr.

## Programmatic API

```js
CWFlipbook.open({
  url: '/docs/brochure.pdf',
  title: 'My Brochure',
  workerSrc: '/vendor/pdfjs/build/pdf.worker.mjs',
  accent: '#0d9488',         // override the gold accent
  onPage:  (n, total) => {}, // current page changed
  onClose: () => {}          // user closed the modal
});
```

Returns a `CWFlipbook` instance with these methods:

| Method | What it does |
|---|---|
| `next()` | Advance one page (or one spread on desktop) |
| `prev()` | Go back |
| `goTo(n)` | Jump to page `n` (1-indexed) |
| `zoomIn()` / `zoomOut()` / `zoomFit()` | Zoom controls |
| `setZoom(z)` | Set zoom level explicitly (0.5 to 3.0) |
| `close()` | Close the modal |

## Browser support

- Chrome 90+
- Firefox 90+
- Safari 15+ (macOS + iOS)
- Edge 90+

Anything older falls back gracefully — the modal still opens, pages still render via PDF.js, just without auto-fullscreen and some animation niceties.

## Theming

Override CSS custom properties on `.cwflip-modal`:

```css
.cwflip-modal {
  --cwflip-accent: #0d9488;       /* primary highlight */
  --cwflip-accent-deep: #0f766e;  /* hover/active */
  --cwflip-page-bg: #fafafa;      /* page paper colour */
  --cwflip-flip-time: 600ms;      /* flip animation duration */
}
```

## Development

```bash
git clone https://github.com/zerocool2k25/carbonware-flipbook.git
cd carbonware-flipbook
npx live-server demo --no-browser --port=8090
# open http://127.0.0.1:8090
```

## Roadmap

- v1.1 — text search, bookmarks/TOC, page thumbnail sidebar
- v1.2 — true CSS-3D page-curl animation
- v2.0 — multi-PDF library viewer

## License

MIT — © 2026 Carbonware (carbonware.ca) / Gavindra Nauth.

## Credits

Built on [Mozilla PDF.js](https://github.com/mozilla/pdf.js) (Apache 2.0).
