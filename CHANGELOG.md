# Changelog

## v1.0.0 — 2026-04-27

Initial release.

- Three render modes auto-picked by viewport: spread+flip (≥1024 px), spread+slide (600-1023 px), single+swipe (<600 px)
- High-quality re-render on zoom past 150%
- Full touch gesture decoder: swipe, pinch, edge-tap, double-tap
- Auto-fullscreen on mobile open
- Glass-morphism modal chrome with auto-hide on idle
- Full keyboard navigation
- ARIA / a11y compliant
- `prefers-reduced-motion` respected
- No dependencies (PDF.js is a peer dependency, vendored separately)
- Pure vanilla JS + CSS, ~25 KB combined
