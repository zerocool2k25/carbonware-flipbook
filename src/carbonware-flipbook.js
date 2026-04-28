/*!
 * Carbonware Flipbook v1.0.0
 * https://github.com/zerocool2k25/carbonware-flipbook
 * MIT — (c) 2026 Carbonware (carbonware.ca)
 *
 * A polished, cross-device PDF flipbook plugin. Vanilla JS, no framework.
 * Built on top of PDF.js (peer dependency — load pdf.mjs separately).
 *
 * Usage (data-attribute auto-init):
 *
 *   <script src="cw-flipbook.js" defer></script>
 *   <button data-cwflip-pdf="/docs/brochure.pdf"
 *           data-cwflip-title="Brochure"
 *           data-cwflip-pdfworker="/path/to/pdf.worker.mjs">
 *     Read the brochure
 *   </button>
 *
 * Usage (programmatic):
 *
 *   CWFlipbook.open({ url, title, workerSrc, accent });
 */

(function (global) {
  'use strict';

  // ====================================================================
  // SVG icon set (inline to avoid extra HTTP requests)
  // ====================================================================
  var ICONS = {
    close:    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>',
    fs:       '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>',
    prev:     '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
    next:     '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
    zin:      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M11 8v6M8 11h6M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
    zout:     '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M8 11h6M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
    fit:      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>'
  };

  // ====================================================================
  // PDF.js loader — uses an existing global if present, else lazy-loads
  // ====================================================================
  var pdfjsPromise = null;
  function ensurePdfjs(workerSrc) {
    if (global.pdfjsLib) {
      if (workerSrc) global.pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
      return Promise.resolve(global.pdfjsLib);
    }
    if (pdfjsPromise) return pdfjsPromise;
    // Default to jsdelivr CDN if no workerSrc given (caller can pin a vendored copy)
    var pdfBase = (workerSrc || '').replace(/\/build\/pdf\.worker\.[^/]+$/, '');
    var pdfMjs = pdfBase ? pdfBase + '/build/pdf.mjs'
                         : 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.mjs';
    var pdfWorker = workerSrc || 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.mjs';
    pdfjsPromise = import(pdfMjs).then(function (mod) {
      var lib = mod.default || mod;
      lib.GlobalWorkerOptions.workerSrc = pdfWorker;
      global.pdfjsLib = lib;
      return lib;
    });
    return pdfjsPromise;
  }

  // ====================================================================
  // Utility helpers
  // ====================================================================
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }
  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function isMobile() { return window.matchMedia('(max-width: 768px)').matches; }
  function isCoarsePointer() { return window.matchMedia('(pointer: coarse)').matches; }
  function reducedMotion() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  // ====================================================================
  // Main class
  // ====================================================================
  function CWFlipbook(options) {
    this.options = Object.assign({
      url: '',
      title: 'Document',
      workerSrc: '',
      accent: null,
      onPage: null,
      onClose: null
    }, options || {});
    this.pdf = null;
    this.totalPages = 0;
    this.pageNum = 1;       // 1-indexed
    this.zoom = 1;          // display scale (1 = fit-to-stage)
    this.renderScale = 1;   // last canvas-render scale (re-renders past 1.5)
    this.cache = {};        // pageNum:scale → canvas
    this.mode = 'spread-flip'; // 'spread-flip' | 'spread-slide' | 'single'
    this.pageSizes = [];    // [{w,h}, ...] one entry per PDF page (1-indexed: pageSizes[n-1])
    this.flipping = false;
    this.chromeIdleTimer = null;
    this.modal = null;
    this._touch = { x:0, y:0, t:0, mode:null, startDist:0, startZoom:1 };
    this._destroyed = false;
  }

  CWFlipbook.prototype = {

    // ----- public lifecycle -----
    open: function () {
      var self = this;
      this._buildModal();
      document.body.appendChild(this.modal);
      // Force reflow so the open animation runs
      void this.modal.offsetWidth;
      this.modal.classList.add('cwflip-open');
      document.body.style.overflow = 'hidden';
      // Auto-fullscreen on touch devices
      if (isCoarsePointer() && this.modal.requestFullscreen) {
        this.modal.requestFullscreen().catch(function(){});
      }
      // Keyboard
      this._onKey = this._onKey.bind(this);
      document.addEventListener('keydown', this._onKey);
      this._onResize = debounce(this._handleResize.bind(this), 150);
      window.addEventListener('resize', this._onResize);
      window.addEventListener('orientationchange', this._onResize);
      document.addEventListener('fullscreenchange', this._onResize);
      // Load + render
      this._loadPdf().then(function () {
        self._pickMode();
        self._renderCurrent();
      }).catch(function (err) {
        self._showError(err);
      });
      return this;
    },

    close: function () {
      if (!this.modal) return;
      this.modal.classList.remove('cwflip-open');
      var modal = this.modal;
      setTimeout(function () { if (modal.parentNode) modal.parentNode.removeChild(modal); }, 400);
      document.body.style.overflow = '';
      document.removeEventListener('keydown', this._onKey);
      window.removeEventListener('resize', this._onResize);
      window.removeEventListener('orientationchange', this._onResize);
      document.removeEventListener('fullscreenchange', this._onResize);
      if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
      this.cache = {};
      this._destroyed = true;
      if (typeof this.options.onClose === 'function') this.options.onClose();
    },

    // ----- public navigation -----
    next: function () { return this._navigate(+1); },
    prev: function () { return this._navigate(-1); },
    goTo: function (n) {
      if (this.flipping) return;
      this.pageNum = clamp(n, 1, this.totalPages);
      this._renderCurrent();
      this._announce();
    },

    // ----- public zoom -----
    zoomIn:  function () { this.setZoom(this.zoom + 0.25); },
    zoomOut: function () { this.setZoom(this.zoom - 0.25); },
    zoomFit: function () { this.setZoom(1); },
    setZoom: function (z) {
      var newZ = clamp(+z.toFixed(2), 0.5, 3.0);
      if (newZ === this.zoom) return;
      var crossedHi = (newZ > 1.5 && this.zoom <= 1.5);
      var crossedLo = (newZ <= 1.5 && this.zoom > 1.5);
      this.zoom = newZ;
      this._showZoomBadge();
      // Re-render at higher resolution past 150% so text stays sharp
      if (crossedHi || crossedLo) {
        this._invalidateCache();
        this._renderCurrent();
      } else {
        this._applyZoomTransform();
      }
    },

    // ----- internal: build modal DOM -----
    _buildModal: function () {
      var self = this;
      var m = el('div', {
        'class': 'cwflip-modal',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'cwflip-title-' + Math.random().toString(36).slice(2, 8)
      });
      if (this.options.accent) m.style.setProperty('--cwflip-accent', this.options.accent);

      // Top bar
      var titleId = m.getAttribute('aria-labelledby');
      var titleEl = el('span', { 'class': 'cwflip-title', id: titleId }, this.options.title);
      var dlBtn = el('a', {
        'class': 'cwflip-btn', href: this.options.url, download: '',
        'aria-label': 'Download PDF', title: 'Download',
        html: ICONS.download
      });
      var fsBtn = el('button', {
        'class': 'cwflip-btn', type: 'button',
        'aria-label': 'Toggle fullscreen', title: 'Fullscreen (F)',
        onclick: function () { self._toggleFullscreen(); },
        html: ICONS.fs
      });
      var closeBtn = el('button', {
        'class': 'cwflip-btn', type: 'button',
        'aria-label': 'Close', title: 'Close (Esc)',
        onclick: function () { self.close(); },
        html: ICONS.close
      });
      var topBar = el('div', { 'class': 'cwflip-bar cwflip-bar-top' }, [
        titleEl,
        el('div', { 'class': 'cwflip-actions' }, [dlBtn, fsBtn, closeBtn])
      ]);

      // Stage
      var track = el('div', { 'class': 'cwflip-track' });
      var stage = el('div', { 'class': 'cwflip-stage' }, track);

      // Loading
      var loading = el('div', { 'class': 'cwflip-loading' }, [
        el('div', { 'class': 'cwflip-loading-spinner' }),
        el('div', { 'class': 'cwflip-loading-text' }, [
          'Loading… ',
          el('span', { 'class': 'cwflip-loading-pct' }, '0%')
        ]),
        el('div', { 'class': 'cwflip-loading-bar' }, el('div', { 'class': 'cwflip-loading-bar-fill' }))
      ]);
      stage.appendChild(loading);

      // Zoom badge + keyhint
      var zoomBadge = el('div', { 'class': 'cwflip-zoom-badge' }, '100%');
      var keyHint = el('div', { 'class': 'cwflip-keyhint' });
      keyHint.innerHTML = 'Use <kbd>←</kbd> <kbd>→</kbd> turn pages · <kbd>+</kbd> <kbd>−</kbd> zoom · <kbd>F</kbd> fullscreen · <kbd>Esc</kbd> close';
      stage.appendChild(zoomBadge);
      stage.appendChild(keyHint);

      // Bottom bar
      var prevBtn = el('button', {
        'class': 'cwflip-btn', type: 'button',
        'aria-label': 'Previous page', title: 'Previous (←)',
        onclick: function () { self.prev(); },
        html: ICONS.prev
      });
      var nextBtn = el('button', {
        'class': 'cwflip-btn', type: 'button',
        'aria-label': 'Next page', title: 'Next (→)',
        onclick: function () { self.next(); },
        html: ICONS.next
      });
      var pageInd = el('div', { 'class': 'cwflip-page-indicator' }, [
        el('span', { 'class': 'cwflip-cur' }, '–'),
        el('span', { 'class': 'cwflip-sep' }, '/'),
        el('span', { 'class': 'cwflip-tot' }, '–')
      ]);
      var navGroup = el('div', { 'class': 'cwflip-nav-group' }, [prevBtn, pageInd, nextBtn]);

      var zoOut = el('button', {
        'class': 'cwflip-btn', type: 'button',
        'aria-label': 'Zoom out', title: 'Zoom out (−)',
        onclick: function () { self.zoomOut(); },
        html: ICONS.zout
      });
      var zoFit = el('button', {
        'class': 'cwflip-btn', type: 'button',
        'aria-label': 'Fit page', title: 'Fit page (0)',
        onclick: function () { self.zoomFit(); },
        html: ICONS.fit
      });
      var zoIn = el('button', {
        'class': 'cwflip-btn', type: 'button',
        'aria-label': 'Zoom in', title: 'Zoom in (+)',
        onclick: function () { self.zoomIn(); },
        html: ICONS.zin
      });
      var zoomGroup = el('div', { 'class': 'cwflip-nav-group' }, [zoOut, zoFit, zoIn]);

      var botBar = el('div', { 'class': 'cwflip-bar cwflip-bar-bot' }, [navGroup, zoomGroup]);

      // Live region for screen readers
      var sr = el('div', { 'class': 'cwflip-sr-only', 'aria-live': 'polite' });

      m.appendChild(topBar);
      m.appendChild(stage);
      m.appendChild(botBar);
      m.appendChild(sr);

      // Backdrop click to close
      m.addEventListener('click', function (e) { if (e.target === m) self.close(); });

      // Wire touch / pointer
      this._attachGestures(stage, track);
      // Idle chrome auto-hide on mobile
      if (isCoarsePointer()) this._setupIdleHide(m);

      this.modal = m;
      this._refs = {
        track: track, stage: stage, loading: loading, zoomBadge: zoomBadge,
        cur: pageInd.querySelector('.cwflip-cur'),
        tot: pageInd.querySelector('.cwflip-tot'),
        prev: prevBtn, next: nextBtn,
        zin: zoIn, zout: zoOut,
        sr: sr,
        loadingPct: loading.querySelector('.cwflip-loading-pct'),
        loadingBar: loading.querySelector('.cwflip-loading-bar-fill')
      };
    },

    // ----- internal: load PDF -----
    _loadPdf: function () {
      var self = this;
      return ensurePdfjs(this.options.workerSrc).then(function (lib) {
        var loadingTask = lib.getDocument(self.options.url);
        loadingTask.onProgress = function (p) {
          if (!p.total) return;
          var pct = Math.round(p.loaded / p.total * 100);
          if (self._refs.loadingPct) self._refs.loadingPct.textContent = pct + '%';
          if (self._refs.loadingBar) self._refs.loadingBar.style.width = pct + '%';
        };
        return loadingTask.promise.then(function (pdf) {
          self.pdf = pdf;
          self.totalPages = pdf.numPages;
          self._refs.tot.textContent = pdf.numPages;
          self._refs.cur.textContent = '1';
          // Capture native size of every page so we can keep aspect ratios
          // independent (some brochures mix portrait covers with double-wide
          // designed-as-spread inner pages).
          var jobs = [];
          for (var i = 1; i <= pdf.numPages; i++) {
            jobs.push(pdf.getPage(i).then(function (page) {
              var v = page.getViewport({ scale: 1 });
              return { w: v.width, h: v.height };
            }));
          }
          return Promise.all(jobs).then(function (sizes) {
            self.pageSizes = sizes;
          });
        });
      });
    },

    // ----- internal: pick render mode based on viewport -----
    _pickMode: function () {
      var w = window.innerWidth;
      var h = window.innerHeight;
      var landscape = w > h;
      if (w >= 1024) {
        this.mode = reducedMotion() ? 'spread-slide' : 'spread-flip';
      } else if (w >= 600 || (landscape && w >= 600)) {
        this.mode = 'spread-slide';
      } else {
        this.mode = 'single';
      }
      this.modal.classList.toggle('cwflip-mode-single', this.mode === 'single');
      this.modal.classList.toggle('cwflip-mode-flip', this.mode === 'spread-flip');
      this.modal.classList.toggle('cwflip-mode-slide', this.mode === 'spread-slide');
    },

    // ----- internal: a "wide" page is one whose natural width > height. For
    // brochures authored as already-merged 2-page spreads (e.g. CorelDRAW
    // exports at 1224×792), each PDF page is itself a spread and should
    // occupy the full stage in spread/flip modes — no right-pair partner.
    _isWide: function (n) {
      var p = this.pageSizes[n - 1];
      return !!(p && p.w > p.h);
    },

    // ----- internal: which pages render in the current "view"
    // Returns [leftN] or [leftN, rightN]. In single mode always one page.
    // In spread modes: pair only when both pages are portrait (not wide).
    _viewPages: function () {
      var n = this.pageNum;
      if (this.mode === 'single') return [n];
      // First page often shown alone (cover) — keep that convention only when
      // we're already on page 1 of a multi-page PDF, regardless of size.
      var leftWide = this._isWide(n);
      var hasNext = n + 1 <= this.totalPages;
      var nextWide = hasNext && this._isWide(n + 1);
      if (leftWide || !hasNext || nextWide) return [n];
      return [n, n + 1];
    },

    // ----- internal: per-page fit calculation. Each page gets its own
    // display dimensions based on its native aspect ratio so mixed-size
    // PDFs don't get squished into the first page's aspect.
    _calcFit: function (pages) {
      var stage = this._refs.stage;
      var stageRect = stage.getBoundingClientRect();
      var availW = stageRect.width - 16;
      var availH = stageRect.height - 16;
      var sizes = pages.map(function (n) { return this.pageSizes[n - 1]; }, this);
      var totalNativeW, maxNativeH;
      if (sizes.length === 1) {
        totalNativeW = sizes[0].w;
        maxNativeH = sizes[0].h;
      } else {
        // Two pages share the available width with a small gutter (16 px)
        availW -= 16;
        totalNativeW = sizes[0].w + sizes[1].w;
        maxNativeH = Math.max(sizes[0].h, sizes[1].h);
      }
      var scale = Math.min(availW / totalNativeW, availH / maxNativeH);
      return {
        scale: scale,
        slots: sizes.map(function (s) {
          return {
            w: Math.floor(s.w * scale),
            h: Math.floor(s.h * scale)
          };
        })
      };
    },

    // ----- internal: render current page(s) -----
    _renderCurrent: function () {
      if (!this.pdf) return;
      var self = this;
      var pages = this._viewPages();
      var fit = this._calcFit(pages);
      // Re-render scale: scale up if zoomed past 150%, else 1.5× dpr for crispness
      var dpr = window.devicePixelRatio || 1;
      var renderScale = fit.scale * Math.max(dpr * 1.5, this.zoom * dpr);
      this.renderScale = renderScale;

      var jobs = pages.map(function (n) { return self._renderPage(n, renderScale); });

      Promise.all(jobs).then(function (canvases) {
        if (self._destroyed) return;
        if (self._refs.loading) self._refs.loading.style.display = 'none';
        self._buildSpread(canvases, fit);
        self._refs.cur.textContent = pages.length === 2 ? (pages[0] + '–' + pages[1]) : String(pages[0]);
        self._announce();
        self._updateNavButtons();
        if (typeof self.options.onPage === 'function') self.options.onPage(pages[0], self.totalPages);
        // Prefetch the next view so the upcoming flip starts instantly.
        // Uses requestIdleCallback when available so it doesn't compete
        // with the just-completed render's frame budget.
        self._prefetchAdjacent(renderScale);
      }).catch(function (err) {
        if (!self._destroyed) self._showError(err);
      });
    },

    // ----- internal: prefetch pages on either side of the current view
    // at the same scale. Renders happen in the background; results land
    // in the cache and are picked up by `_renderPage` immediately.
    _prefetchAdjacent: function (scale) {
      var self = this;
      var pages = this._viewPages();
      var lastVisible = pages[pages.length - 1];
      // Forward: peek at the next view's pages
      var forwardN = lastVisible + 1;
      // Backward: peek at the previous view's last page
      var backwardN = pages[0] - 1;
      var schedule = window.requestIdleCallback
        ? function (fn) { return window.requestIdleCallback(fn, { timeout: 800 }); }
        : function (fn) { return setTimeout(fn, 100); };
      schedule(function () {
        if (self._destroyed) return;
        if (forwardN <= self.totalPages) self._renderPage(forwardN, scale).catch(function () {});
        if (backwardN >= 1) self._renderPage(backwardN, scale).catch(function () {});
        // Also prefetch the partner of forwardN if it'd be paired in a spread view
        if (self.mode !== 'single' && forwardN + 1 <= self.totalPages
            && !self._isWide(forwardN) && !self._isWide(forwardN + 1)) {
          self._renderPage(forwardN + 1, scale).catch(function () {});
        }
      });
    },

    // ----- internal: render a single page to canvas (cached + deduped).
    // Two callers (e.g. user click + background prefetch) asking for the
    // same page+scale share one render Promise — PDF.js rejects
    // concurrent render() calls on the same page, so deduping is
    // mandatory, not an optimization.
    _renderPage: function (n, scale) {
      var key = n + ':' + scale.toFixed(3);
      if (this.cache[key]) return Promise.resolve(this.cache[key]);
      this._inflight = this._inflight || {};
      if (this._inflight[key]) return this._inflight[key];
      var self = this;
      var p = this.pdf.getPage(n).then(function (page) {
        var v = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(v.width);
        canvas.height = Math.round(v.height);
        return page.render({ canvasContext: canvas.getContext('2d'), viewport: v }).promise.then(function () {
          self.cache[key] = canvas;
          delete self._inflight[key];
          return canvas;
        });
      });
      p.catch(function () { delete self._inflight[key]; });
      this._inflight[key] = p;
      return p;
    },

    // ----- internal: build spread DOM from canvases. Each slot is sized to
    // its own page's native aspect (from `fit.slots`), so a 1224×792 spread
    // page won't be crushed into a 612×792 cover's box.
    _buildSpread: function (canvases, fit) {
      var track = this._refs.track;
      track.innerHTML = '';
      track.style.transform = '';
      var spread = el('div', { 'class': 'cwflip-spread' });
      var classes = ['cwflip-page-left', 'cwflip-page-right'];
      for (var i = 0; i < canvases.length; i++) {
        var slot = fit.slots[i];
        var pg = el('div', { 'class': 'cwflip-page ' + classes[i] });
        pg.style.width = slot.w + 'px';
        pg.style.height = slot.h + 'px';
        var img = canvases[i].cloneNode(false);
        img.getContext('2d').drawImage(canvases[i], 0, 0);
        img.style.width = '100%';
        img.style.height = '100%';
        pg.appendChild(img);
        spread.appendChild(pg);
      }
      track.appendChild(spread);
      this._applyZoomTransform();
    },

    // ----- internal: apply zoom + center via transform -----
    _applyZoomTransform: function () {
      var track = this._refs.track;
      track.style.transform = 'scale(' + this.zoom + ')';
      track.style.transformOrigin = 'center center';
    },

    _showZoomBadge: function () {
      var b = this._refs.zoomBadge;
      b.textContent = Math.round(this.zoom * 100) + '%';
      b.classList.add('cwflip-visible');
      var self = this;
      clearTimeout(this._zoomBadgeT);
      this._zoomBadgeT = setTimeout(function () { b.classList.remove('cwflip-visible'); }, 1200);
    },

    _invalidateCache: function () { this.cache = {}; },

    _announce: function () {
      this._refs.sr.textContent = 'Page ' + this.pageNum + ' of ' + this.totalPages;
    },

    _updateNavButtons: function () {
      this._refs.prev.disabled = this.pageNum <= 1;
      var pages = this._viewPages();
      this._refs.next.disabled = pages[pages.length - 1] >= this.totalPages;
      this._refs.zout.disabled = this.zoom <= 0.5;
      this._refs.zin.disabled = this.zoom >= 3.0;
    },

    _navigate: function (dir) {
      if (this.flipping) return;
      // Step depends on the current view: paired spreads advance by 2,
      // singles advance by 1. Going back, we need to know whether the
      // previous view was paired (look at pageNum-1 and pageNum-2).
      var step = 1;
      if (dir > 0) {
        step = this._viewPages().length;
      } else {
        var prevN = this.pageNum - 1;
        var prevPrevN = this.pageNum - 2;
        if (this.mode !== 'single'
            && prevPrevN >= 1
            && !this._isWide(prevN)
            && !this._isWide(prevPrevN)) {
          step = 2;
        }
      }
      var nxt = this.pageNum + dir * step;
      if (nxt < 1 || nxt > this.totalPages) return;

      // Capture the current canvases for the flip animation BEFORE we
      // re-render. Cloning is cheap and lets the new render happen in
      // parallel with the animation.
      var oldSpread = this._refs.track.querySelector('.cwflip-spread');
      var oldCanvases = oldSpread
        ? Array.from(oldSpread.querySelectorAll('canvas')).map(this._cloneCanvas)
        : [];
      var oldSlots = oldSpread
        ? Array.from(oldSpread.querySelectorAll('.cwflip-page')).map(function (p) {
            var r = p.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height), left: r.left, top: r.top };
          })
        : [];

      this.pageNum = nxt;

      if (oldCanvases.length && !reducedMotion()
          && (this.mode === 'spread-flip' || this.mode === 'spread-slide' || this.mode === 'single')) {
        this._renderAndAnimate(dir, oldCanvases, oldSlots);
      } else {
        this._renderCurrent();
      }
    },

    // ----- internal: clone a canvas (snapshot) -----
    _cloneCanvas: function (src) {
      var c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      c.getContext('2d').drawImage(src, 0, 0);
      return c;
    },

    // ----- internal: render the destination view, then animate the
    // transition from the old view (oldCanvases) to it. The animation
    // form depends on mode: 3D page-flip in spread-flip, horizontal
    // slide in spread-slide and single, opacity crossfade if either
    // pre-render fails or reduced-motion fires mid-transition.
    _renderAndAnimate: function (dir, oldCanvases, oldSlots) {
      var self = this;
      self.flipping = true;
      var newPages = this._viewPages();
      var fit = this._calcFit(newPages);
      var dpr = window.devicePixelRatio || 1;
      var renderScale = fit.scale * Math.max(dpr * 1.5, this.zoom * dpr);
      this.renderScale = renderScale;
      var jobs = newPages.map(function (n) { return self._renderPage(n, renderScale); });
      Promise.all(jobs).then(function (newCanvases) {
        if (self._destroyed) return;
        if (self.mode === 'spread-flip') {
          self._animatePageFlip(dir, oldCanvases, oldSlots, newCanvases, fit, newPages);
        } else {
          self._animateSlide(dir, newCanvases, fit, newPages);
        }
      }).catch(function (err) {
        self.flipping = false;
        if (!self._destroyed) self._showError(err);
      });
    },

    // ----- internal: 3D page-flip animation -----
    // Forward (dir>0): the page on the right (or only page in a single
    // view) peels off about its LEFT edge (the spine) — front face is
    // the old page, back face is the leading new page. Underneath, the
    // new spread is laid in BEFORE the animation starts; the flipper
    // sits on top of it during rotation.
    _animatePageFlip: function (dir, oldCanvases, oldSlots, newCanvases, fit, newPages) {
      var self = this;
      var track = this._refs.track;

      // Lay in the destination spread first (it sits underneath the flipper)
      this._buildSpread(newCanvases, fit);

      // Identify which old slot is "flipping": rightmost on next, leftmost on prev
      var flipFromIdx = (dir > 0) ? (oldCanvases.length - 1) : 0;
      var flipFrom = oldCanvases[flipFromIdx];
      var flipFromSlot = oldSlots[flipFromIdx];
      // The corresponding new face is the new spread's mirror end:
      // forward → first page of new view (lands on the LEFT side)
      // backward → last page of new view (lands on the RIGHT side)
      var flipToIdx = (dir > 0) ? 0 : (newCanvases.length - 1);
      var flipTo = newCanvases[flipToIdx];
      var flipToSlot = fit.slots[flipToIdx];

      // Position the flipper over the old slot's location, sized to its dims
      var trackRect = track.getBoundingClientRect();
      var flipper = el('div', { 'class': 'cwflip-flip' });
      flipper.style.left = (flipFromSlot.left - trackRect.left) + 'px';
      flipper.style.top = (flipFromSlot.top - trackRect.top) + 'px';
      flipper.style.width = flipFromSlot.w + 'px';
      flipper.style.height = flipFromSlot.h + 'px';
      flipper.style.transformOrigin = (dir > 0 ? 'left' : 'right') + ' center';
      flipper.style.transform = 'rotateY(0deg)';
      flipper.style.boxShadow = 'var(--cwflip-page-shadow)';

      // Front face: old (flipping) page
      var front = el('div', { 'class': 'cwflip-flip-face cwflip-flip-front' });
      var frontImg = flipFrom.cloneNode(false);
      frontImg.getContext('2d').drawImage(flipFrom, 0, 0);
      front.appendChild(frontImg);
      flipper.appendChild(front);

      // Back face: new page that will land in the opposite slot. We size
      // the back face element to match the destination slot so its
      // aspect ratio matches when revealed (matters for mixed-size PDFs).
      var back = el('div', { 'class': 'cwflip-flip-face cwflip-flip-back' });
      var backImg = flipTo.cloneNode(false);
      backImg.getContext('2d').drawImage(flipTo, 0, 0);
      back.appendChild(backImg);
      // Stretch back to the same flipper box (CSS already inset:0). If
      // the destination slot has different aspect, the image will scale
      // to fill — for our spread case that's the correct behavior.
      flipper.appendChild(back);

      track.appendChild(flipper);

      // Force layout, then start the rotation
      void flipper.offsetWidth;
      var dur = parseInt(getComputedStyle(this.modal).getPropertyValue('--cwflip-flip-time'), 10) || 700;
      flipper.style.transition = 'transform ' + dur + 'ms cubic-bezier(0.42, 0, 0.4, 1), box-shadow ' + dur + 'ms ease';
      flipper.style.boxShadow = '-12px 18px 36px rgba(0,0,0,0.5), 0 24px 60px rgba(0,0,0,0.7)';
      flipper.style.transform = 'rotateY(' + (dir > 0 ? -180 : 180) + 'deg)';
      flipper.classList.add('cwflip-flipping');

      setTimeout(function () {
        if (self._destroyed) return;
        if (flipper.parentNode) flipper.parentNode.removeChild(flipper);
        self._refs.cur.textContent = newPages.length === 2 ? newPages.join('–') : String(newPages[0]);
        self._announce();
        self._updateNavButtons();
        if (typeof self.options.onPage === 'function') self.options.onPage(newPages[0], self.totalPages);
        self.flipping = false;
      }, dur + 30);
    },

    // ----- internal: horizontal slide (mobile + tablet) -----
    _animateSlide: function (dir, newCanvases, fit, newPages) {
      var self = this;
      var track = this._refs.track;
      var oldSpread = track.querySelector('.cwflip-spread');
      var dur = parseInt(getComputedStyle(this.modal).getPropertyValue('--cwflip-slide-time'), 10) || 360;

      // Build the new spread but keep it positioned just off-screen on
      // the leading edge so it can slide in.
      var width = oldSpread ? oldSpread.getBoundingClientRect().width : track.getBoundingClientRect().width;
      var oldShift = (dir > 0 ? -1 : 1) * width;
      var newShift = (dir > 0 ? 1 : -1) * width;

      // Add the new spread alongside the old (positioned absolutely, off-screen)
      var holder = el('div', { 'class': 'cwflip-slide-holder' });
      holder.style.position = 'absolute';
      holder.style.top = '0';
      holder.style.left = '0';
      holder.style.width = '100%';
      holder.style.height = '100%';
      holder.style.display = 'flex';
      holder.style.alignItems = 'center';
      holder.style.justifyContent = 'center';
      holder.style.transform = 'translate3d(' + newShift + 'px, 0, 0)';
      holder.style.transition = 'transform ' + dur + 'ms cubic-bezier(0.22, 1, 0.36, 1)';
      // Build new spread inside holder
      var newSpread = el('div', { 'class': 'cwflip-spread' });
      var classes = ['cwflip-page-left', 'cwflip-page-right'];
      for (var i = 0; i < newCanvases.length; i++) {
        var slot = fit.slots[i];
        var pg = el('div', { 'class': 'cwflip-page ' + classes[i] });
        pg.style.width = slot.w + 'px';
        pg.style.height = slot.h + 'px';
        var img = newCanvases[i].cloneNode(false);
        img.getContext('2d').drawImage(newCanvases[i], 0, 0);
        pg.appendChild(img);
        newSpread.appendChild(pg);
      }
      holder.appendChild(newSpread);
      track.appendChild(holder);

      if (oldSpread) {
        oldSpread.style.transition = 'transform ' + dur + 'ms cubic-bezier(0.22, 1, 0.36, 1)';
      }

      void holder.offsetWidth;
      if (oldSpread) oldSpread.style.transform = 'translate3d(' + oldShift + 'px, 0, 0)';
      holder.style.transform = 'translate3d(0, 0, 0)';

      setTimeout(function () {
        if (self._destroyed) return;
        // Replace track contents with the final new spread (clean state)
        self._buildSpread(newCanvases, fit);
        self._refs.cur.textContent = newPages.length === 2 ? newPages.join('–') : String(newPages[0]);
        self._announce();
        self._updateNavButtons();
        if (typeof self.options.onPage === 'function') self.options.onPage(newPages[0], self.totalPages);
        self.flipping = false;
      }, dur + 20);
    },

    // ----- internal: gesture handling -----
    _attachGestures: function (stage, track) {
      var self = this;
      var t = this._touch;

      function dist(t1, t2) {
        var dx = t1.clientX - t2.clientX, dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
      }

      stage.addEventListener('touchstart', function (e) {
        if (e.touches.length === 2) {
          t.mode = 'pinch';
          t.startDist = dist(e.touches[0], e.touches[1]);
          t.startZoom = self.zoom;
        } else if (e.touches.length === 1) {
          t.mode = 'maybe-swipe';
          t.x = e.touches[0].clientX;
          t.y = e.touches[0].clientY;
          t.t = Date.now();
        }
      }, { passive: true });

      stage.addEventListener('touchmove', function (e) {
        if (t.mode === 'pinch' && e.touches.length === 2) {
          e.preventDefault();
          var d = dist(e.touches[0], e.touches[1]);
          var ratio = d / t.startDist;
          self.zoom = clamp(+(t.startZoom * ratio).toFixed(2), 0.5, 3.0);
          self._applyZoomTransform();
          self._showZoomBadge();
        } else if (t.mode === 'maybe-swipe' && e.touches.length === 1) {
          var dx = e.touches[0].clientX - t.x;
          var dy = e.touches[0].clientY - t.y;
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            t.mode = 'swiped';
            self._navigate(dx < 0 ? +1 : -1);
          }
        }
      }, { passive: false });

      stage.addEventListener('touchend', function (e) {
        // Pinch released past 150% — re-render at higher resolution for crisp text
        if (t.mode === 'pinch') {
          var crossedHi = self.zoom > 1.5;
          if (crossedHi) {
            self._invalidateCache();
            self._renderCurrent();
          }
        }
        // Single tap on edge → flip on desktop
        if (t.mode === 'maybe-swipe') {
          var elapsed = Date.now() - t.t;
          if (elapsed < 250) {
            // Treat as tap; check edge zone
            var rect = stage.getBoundingClientRect();
            var rel = (t.x - rect.left) / rect.width;
            if (rel < 0.18) self.prev();
            else if (rel > 0.82) self.next();
          }
        }
        t.mode = null;
      }, { passive: true });

      // Mouse wheel zoom on desktop (Ctrl/Cmd or already zoomed)
      stage.addEventListener('wheel', function (e) {
        if (e.ctrlKey || e.metaKey || self.zoom > 1) {
          e.preventDefault();
          if (e.deltaY < 0) self.zoomIn(); else self.zoomOut();
        }
      }, { passive: false });

      // Click on edges to flip (desktop)
      stage.addEventListener('click', function (e) {
        if (isCoarsePointer()) return; // mobile uses tap-end logic above
        var rect = stage.getBoundingClientRect();
        var rel = (e.clientX - rect.left) / rect.width;
        if (rel < 0.18) self.prev();
        else if (rel > 0.82) self.next();
      });
    },

    // ----- internal: keyboard -----
    _onKey: function (e) {
      if (!this.modal || !this.modal.classList.contains('cwflip-open')) return;
      switch (e.key) {
        case 'Escape':     this.close(); break;
        case 'ArrowLeft':  e.preventDefault(); this.prev(); break;
        case 'ArrowRight': e.preventDefault(); this.next(); break;
        case '+': case '=': e.preventDefault(); this.zoomIn(); break;
        case '-': case '_': e.preventDefault(); this.zoomOut(); break;
        case '0':          e.preventDefault(); this.zoomFit(); break;
        case 'f': case 'F': e.preventDefault(); this._toggleFullscreen(); break;
      }
    },

    _toggleFullscreen: function () {
      if (!document.fullscreenElement) {
        if (this.modal.requestFullscreen) this.modal.requestFullscreen().catch(function(){});
      } else {
        if (document.exitFullscreen) document.exitFullscreen().catch(function(){});
      }
    },

    _handleResize: function () {
      this._pickMode();
      this._invalidateCache();
      this._renderCurrent();
    },

    _setupIdleHide: function (modal) {
      var self = this;
      function bump() {
        modal.classList.remove('cwflip-chrome-hidden');
        clearTimeout(self.chromeIdleTimer);
        self.chromeIdleTimer = setTimeout(function () {
          modal.classList.add('cwflip-chrome-hidden');
        }, 3500);
      }
      modal.addEventListener('touchstart', bump, { passive: true });
      modal.addEventListener('mousemove', bump);
      bump();
    },

    _showError: function (err) {
      var url = this.options.url;
      if (this._refs && this._refs.loading) {
        this._refs.loading.innerHTML = '<div class="cwflip-error">Sorry — could not load the document. <a href="' + url + '" download>Download instead</a>.</div>';
      }
      console.error('[CWFlipbook]', err);
    }
  };

  // ====================================================================
  // Static API + auto-init
  // ====================================================================
  var staticAPI = {
    open: function (opts) {
      var fb = new CWFlipbook(opts);
      return fb.open();
    },
    version: '1.0.0'
  };

  function autoInit() {
    document.querySelectorAll('[data-cwflip-pdf]').forEach(function (btn) {
      if (btn._cwflipBound) return;
      btn._cwflipBound = true;
      btn.classList.add('cwflip-trigger');
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        staticAPI.open({
          url:       btn.getAttribute('data-cwflip-pdf'),
          title:     btn.getAttribute('data-cwflip-title') || 'Document',
          workerSrc: btn.getAttribute('data-cwflip-pdfworker') || '',
          accent:    btn.getAttribute('data-cwflip-accent') || null
        });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
  // Re-run on DOM mutations so dynamically-added buttons get bound
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(autoInit).observe(document.documentElement, { childList: true, subtree: true });
  }

  global.CWFlipbook = staticAPI;
})(typeof window !== 'undefined' ? window : this);
