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
    this.pageSize = { w: 612, h: 792 }; // Native page CSS pixels (default US Letter)
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
          // Capture native page size from page 1
          return pdf.getPage(1).then(function (page) {
            var v = page.getViewport({ scale: 1 });
            self.pageSize = { w: v.width, h: v.height };
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

    // ----- internal: compute fit-to-stage page dimensions -----
    _calcFit: function () {
      var stage = this._refs.stage;
      var stageRect = stage.getBoundingClientRect();
      var topBar = 64, botBar = 80;
      var availW = stageRect.width;
      var availH = stageRect.height;
      // Modal occupies full viewport, but stage is between bars
      // (already accounted for since stage is flex:1 between bars)
      var pageW = this.pageSize.w;
      var pageH = this.pageSize.h;
      var perPageMaxW;
      if (this.mode === 'single') {
        perPageMaxW = availW - 16;
      } else {
        perPageMaxW = (availW - 32) / 2; // 2 pages + small gutter
      }
      var perPageMaxH = availH - 16;
      var fit = Math.min(perPageMaxW / pageW, perPageMaxH / pageH);
      return {
        scale: fit,
        displayW: Math.floor(pageW * fit),
        displayH: Math.floor(pageH * fit)
      };
    },

    // ----- internal: render current page(s) -----
    _renderCurrent: function () {
      if (!this.pdf) return;
      var self = this;
      var fit = this._calcFit();
      // Re-render scale: scale up if zoomed past 150%, else 2× dpr for crispness
      var dpr = window.devicePixelRatio || 1;
      var renderScale = fit.scale * Math.max(dpr * 1.5, this.zoom * dpr);
      this.renderScale = renderScale;

      var leftN = this.pageNum;
      var rightN = (this.mode === 'single') ? null : (this.pageNum + 1 <= this.totalPages ? this.pageNum + 1 : null);

      var jobs = [this._renderPage(leftN, renderScale)];
      if (rightN) jobs.push(this._renderPage(rightN, renderScale));

      Promise.all(jobs).then(function (canvases) {
        if (self._destroyed) return;
        // Hide loading
        if (self._refs.loading) self._refs.loading.style.display = 'none';
        // Build spread DOM
        self._buildSpread(canvases[0], canvases[1] || null, fit);
        self._refs.cur.textContent = leftN + (rightN ? '–' + rightN : '');
        self._announce();
        self._updateNavButtons();
        if (typeof self.options.onPage === 'function') self.options.onPage(leftN, self.totalPages);
      }).catch(function (err) {
        if (!self._destroyed) self._showError(err);
      });
    },

    // ----- internal: render a single page to canvas (cached) -----
    _renderPage: function (n, scale) {
      var key = n + ':' + scale.toFixed(3);
      if (this.cache[key]) return Promise.resolve(this.cache[key]);
      var self = this;
      return this.pdf.getPage(n).then(function (page) {
        var v = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(v.width);
        canvas.height = Math.round(v.height);
        return page.render({ canvasContext: canvas.getContext('2d'), viewport: v }).promise.then(function () {
          self.cache[key] = canvas;
          return canvas;
        });
      });
    },

    // ----- internal: build spread DOM from canvases -----
    _buildSpread: function (leftCanvas, rightCanvas, fit) {
      var track = this._refs.track;
      track.innerHTML = '';
      track.style.transform = '';
      var spread = el('div', { 'class': 'cwflip-spread' });
      // Left page
      var pgL = el('div', { 'class': 'cwflip-page cwflip-page-left' });
      pgL.style.width = fit.displayW + 'px';
      pgL.style.height = fit.displayH + 'px';
      var imgL = leftCanvas.cloneNode(false);
      imgL.getContext('2d').drawImage(leftCanvas, 0, 0);
      imgL.style.width = '100%';
      imgL.style.height = '100%';
      pgL.appendChild(imgL);
      spread.appendChild(pgL);
      // Right page (if any)
      if (rightCanvas) {
        var pgR = el('div', { 'class': 'cwflip-page cwflip-page-right' });
        pgR.style.width = fit.displayW + 'px';
        pgR.style.height = fit.displayH + 'px';
        var imgR = rightCanvas.cloneNode(false);
        imgR.getContext('2d').drawImage(rightCanvas, 0, 0);
        imgR.style.width = '100%';
        imgR.style.height = '100%';
        pgR.appendChild(imgR);
        spread.appendChild(pgR);
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
      var step = (this.mode === 'single') ? 1 : 2;
      this._refs.next.disabled = this.pageNum + step - 1 >= this.totalPages;
      this._refs.zout.disabled = this.zoom <= 0.5;
      this._refs.zin.disabled = this.zoom >= 3.0;
    },

    _navigate: function (dir) {
      if (this.flipping) return;
      var step = (this.mode === 'single') ? 1 : 2;
      var nxt = this.pageNum + dir * step;
      if (nxt < 1 || nxt > this.totalPages) return;
      this.pageNum = nxt;
      // 3D flip on desktop
      if (this.mode === 'spread-flip' && !reducedMotion()) {
        this._flipAnimate(dir).then(this._renderCurrent.bind(this));
      } else {
        this._renderCurrent();
      }
    },

    // Simple slide-out / fade-in for the flip "animation". A full 3D
    // page-curl is a future enhancement; this looks clean and avoids
    // the page-flip library's mobile sizing bugs.
    _flipAnimate: function (dir) {
      var self = this;
      this.flipping = true;
      var track = this._refs.track;
      var dist = Math.round(track.getBoundingClientRect().width * 0.5) * (dir > 0 ? -1 : 1);
      track.style.transition = 'transform var(--cwflip-flip-time) cubic-bezier(0.42,0,0.4,1), opacity 0.4s ease';
      track.style.transform = 'translate3d(' + dist + 'px,0,0) scale(' + this.zoom + ')';
      track.style.opacity = '0';
      return new Promise(function (resolve) {
        setTimeout(function () {
          track.style.transition = '';
          self.flipping = false;
          resolve();
        }, 380);
      }).then(function () {
        // After render, fade the new spread in
        track.style.opacity = '1';
        track.style.transform = 'scale(' + self.zoom + ')';
      });
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
