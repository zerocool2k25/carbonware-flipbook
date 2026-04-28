# Changelog

## v1.0.3 — 2026-04-27

**Mouse drag-to-pan when zoomed (desktop).**

When zoom > 1, the page can now be click-and-dragged around the stage. Pan offset clamps to keep the page's center within reach (you can't drag the page entirely off-stage). Edge-click navigation auto-disables while zoomed. Cursor switches between `grab` and `grabbing` for affordance.

## v1.0.2 — 2026-04-27

**Polished page-flip animation.**

The previous build used a slide-out + fade-in for transitions. v1.0.2 replaces it with a real 3D page-turn:

- In spread-flip mode (≥ 1024 px), the leading page rotates around the spine (rotateY 0 → ±180°), revealing the next page on its back face. Underneath, the destination spread is laid in before the rotation, so the reveal feels seamless.
- Slide-mode (600–1023 px) and single-mode (< 600 px) get a clean horizontal slide between spreads instead of the old fade.
- Subtle shadow gradient on the flipping page during rotation gives a sense of paper bending.
- Reduced-motion preference still drops to instant page swap.

## v1.0.1 — 2026-04-27

**Fix: per-page sizing for PDFs with mixed page dimensions.**

Previously the plugin captured only page 1's natural dimensions and forced every subsequent page into that aspect ratio. Brochures authored as already-merged 2-page spreads (e.g. CorelDRAW exports where page 1 = 612×792 portrait cover but pages 2-N = 1224×792 landscape spreads) had inner pages crushed by 50% horizontally.

- Plugin now captures every page's native viewport on load
- Each rendered slot is sized to its own page's aspect ratio (no global fit)
- In spread/flip and spread/slide modes, a "wide" PDF page (w > h) is treated as a full-width single view, not paired
- Navigation step adapts to the current view (1 or 2) so prev/next stay in sync across mixed-size documents

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
