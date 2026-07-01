/*
 * NG.ui — shared in-game UI kit ("Cabinet OS: In Play").
 *
 * Classic script (NOT an ES module): load it AFTER ng.js with a plain
 *   <script src="../../shared/ui.js"></script>
 * Works from file:// and HTTP alike; attaches to the single global `NG`.
 *
 * Games render their chrome to a <canvas>, so this kit is a set of canvas
 * drawing helpers, not CSS. It codifies the one visual language every game
 * shares — buttons, HUD readouts, status LEDs, and the start/win/pause/over
 * overlays — so a player crossing between games meets the same cabinet.
 *
 * The look extends the catalogue's "Cabinet OS": phosphor-green chrome, amber
 * for live data, red for failure; titles carry a phosphor bloom, overlays are
 * framed by corner-bracket reticles rather than solid boxes, and every
 * "TAP TO ..." prompt ends in a blinking block cursor.
 *
 * Animation: helpers take a caller-supplied time `t` (seconds) — games already
 * run a clock — so the kit needs no RAF of its own. Motion (prompt pulse,
 * cursor blink, LED breathing) is automatically stilled under the OS
 * "reduce motion" setting.
 */
(function (global) {
  'use strict';

  var NG = global.NG || (global.NG = {});
  var FAMILY = '"Courier New", monospace';

  // Honour prefers-reduced-motion: when set, timing helpers freeze so nothing
  // blinks, pulses or breathes.
  var reduceMotion = false;
  try {
    var mq = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq) {
      reduceMotion = mq.matches;
      var onMq = function (e) { reduceMotion = e.matches; };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
      else if (mq.addListener) mq.addListener(onMq); // older Safari
    }
  } catch (e) {}

  // Whether this browser supports canvas letter-spacing (Chromium 99+). Detected
  // lazily against a real context the first time text is drawn.
  var trackingSupported = null;
  function canTrack(ctx) {
    if (trackingSupported === null) {
      try { trackingSupported = ('letterSpacing' in ctx); }
      catch (e) { trackingSupported = false; }
    }
    return trackingSupported;
  }

  var ui = {
    // -------------------------------------------------------------------------
    // Tokens — the shared palette, matching every game and the catalogue.
    // green = chrome, amber = live data, red = failure.
    // -------------------------------------------------------------------------
    colors: {
      fg:    '#4dff88',   // phosphor green — primary chrome
      ink:   '#d6f7e4',   // neutral text
      muted: '#6b7a72',   // secondary / labels
      amber: '#ffcf4d',   // live data — score, NEW BEST
      err:   '#ff5d6c',   // failure — game over, conflicts
      dim:   '#1d5e38',   // disabled / ambient
      deep:  '#14351f',   // hairline borders
      panel: '#0a1410',   // control backing
      bg:    '#060b08',   // tube black
      scrim: 'rgba(0,0,0,0.62)'
    },

    reduceMotion: function () { return reduceMotion; },

    // -------------------------------------------------------------------------
    // Timing helpers — pass the game's clock (seconds).
    // -------------------------------------------------------------------------

    /** Blink on/off (square wave). Steady-on under reduce-motion. */
    blink: function (t, period) {
      if (reduceMotion) return true;
      period = period || 1.05;
      return (t % period) < period / 2;
    },

    /** Smooth pulse in [lo, hi] (sine). Sits at hi under reduce-motion. */
    pulse: function (t, period, lo, hi) {
      lo = lo == null ? 0.55 : lo;
      hi = hi == null ? 1 : hi;
      if (reduceMotion) return hi;
      period = period || 1.6;
      var s = 0.5 + 0.5 * Math.sin((t / period) * Math.PI * 2);
      return lo + (hi - lo) * s;
    },

    // -------------------------------------------------------------------------
    // Primitives
    // -------------------------------------------------------------------------

    /** Build a font string in the cabinet family. */
    font: function (px, bold) {
      return (bold ? 'bold ' : '') + Math.round(px) + 'px ' + FAMILY;
    },

    /** Trace a rounded rectangle (does not stroke/fill — caller decides). */
    rrect: function (ctx, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y,     x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x,     y + h, r);
      ctx.arcTo(x,     y + h, x,     y,     r);
      ctx.arcTo(x,     y,     x + w, y,     r);
      ctx.closePath();
    },

    /** Centered text with optional tracking (em) and phosphor bloom. */
    text: function (ctx, str, x, y, o) {
      o = o || {};
      ctx.save();
      ctx.fillStyle = o.color || ui.colors.ink;
      ctx.font = ui.font(o.size || 16, o.bold !== false);
      ctx.textAlign = o.align || 'center';
      ctx.textBaseline = o.baseline || 'middle';
      if (o.track && canTrack(ctx)) ctx.letterSpacing = o.track + 'em';
      if (o.glow) {
        ctx.shadowColor = o.glowColor || o.color || ui.colors.fg;
        ctx.shadowBlur = o.glow;
      }
      if (o.alpha != null) ctx.globalAlpha = o.alpha;
      ctx.fillText(str, x, y);
      ctx.restore();
    },

    /** Dim a play-area rectangle behind an overlay. */
    scrim: function (ctx, x, y, w, h, fill) {
      ctx.save();
      ctx.fillStyle = fill || ui.colors.scrim;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    },

    /**
     * Corner-bracket reticle around a box — the signature overlay frame. Draws
     * four L-shaped marks, not a full rectangle.
     *   o.len   arm length (default 8% of the shorter side)
     *   o.lw    line width
     *   o.color stroke colour (default fg)
     *   o.glow  bloom radius (0 = none)
     */
    brackets: function (ctx, x, y, w, h, o) {
      o = o || {};
      var len = o.len != null ? o.len : Math.min(w, h) * 0.08;
      ctx.save();
      ctx.strokeStyle = o.color || ui.colors.fg;
      ctx.lineWidth = o.lw != null ? o.lw : 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (o.glow) { ctx.shadowColor = o.color || ui.colors.fg; ctx.shadowBlur = o.glow; }
      var r = x + w, b = y + h;
      ctx.beginPath();
      ctx.moveTo(x, y + len);     ctx.lineTo(x, y);     ctx.lineTo(x + len, y);       // TL
      ctx.moveTo(r - len, y);     ctx.lineTo(r, y);     ctx.lineTo(r, y + len);       // TR
      ctx.moveTo(r, b - len);     ctx.lineTo(r, b);     ctx.lineTo(r - len, b);       // BR
      ctx.moveTo(x + len, b);     ctx.lineTo(x, b);     ctx.lineTo(x, b - len);       // BL
      ctx.stroke();
      ctx.restore();
    },

    /**
     * A standard cabinet button. `rect` = {x,y,w,h}; `label` is drawn centered.
     *   o.state 'normal' | 'active' | 'disabled'
     *   o.color override the accent (default fg)
     * Returns `rect` for convenience.
     */
    button: function (ctx, rect, label, o) {
      o = o || {};
      var state = o.state || 'normal';
      var accent = o.color || ui.colors.fg;
      var col, fill, lw;
      if (state === 'disabled') {
        col = ui.colors.dim; fill = 'rgba(0,0,0,0.35)'; lw = 1.5;
      } else if (state === 'active') {
        col = accent; fill = 'rgba(77,255,136,0.12)'; lw = 2.5;
      } else {
        col = accent; fill = 'rgba(0,0,0,0.40)'; lw = 1.5;
      }
      ctx.save();
      ui.rrect(ctx, rect.x, rect.y, rect.w, rect.h, Math.min(rect.w, rect.h) * 0.24);
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = lw; ctx.strokeStyle = col;
      if (state === 'active') { ctx.shadowColor = accent; ctx.shadowBlur = rect.h * 0.35; }
      ctx.stroke();
      ctx.restore();
      ui.text(ctx, label, rect.x + rect.w / 2, rect.y + rect.h * 0.54, {
        color: state === 'disabled' ? ui.colors.dim : col,
        size: Math.min(rect.h * 0.44, rect.w * 0.30),
        track: 0.08
      });
      return rect;
    },

    /**
     * A HUD readout chip: a muted LABEL and an accented VALUE, left-aligned at
     * (x,y). Green value = chrome/state, amber = live data (score, best).
     * Returns the drawn width so callers can lay chips out in a row.
     */
    chip: function (ctx, x, y, label, value, o) {
      o = o || {};
      var size = o.size || 15;
      var accent = o.color || ui.colors.amber;
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      var gap = size * 0.5;
      var lw = 0, vw = 0;
      if (label) {
        ctx.font = ui.font(size, false);
        if (canTrack(ctx)) ctx.letterSpacing = '0.14em';
        ctx.fillStyle = ui.colors.muted;
        ctx.fillText(label, x, y);
        lw = ctx.measureText(label).width + (canTrack(ctx) ? size * 0.14 : 0);
      }
      var vx = x + (label ? lw + gap : 0);
      ctx.font = ui.font(size, true);
      if (canTrack(ctx)) ctx.letterSpacing = '0.06em';
      ctx.fillStyle = accent;
      ctx.fillText(String(value), vx, y);
      vw = ctx.measureText(String(value)).width;
      ctx.restore();
      return (vx + vw) - x;
    },

    /**
     * Status LED — a small dot that breathes when `on`. Use for turn/alive/
     * armed indicators.  o.on (default true), o.color, o.t (clock for the pulse).
     */
    led: function (ctx, x, y, radius, o) {
      o = o || {};
      var on = o.on !== false;
      var color = o.color || ui.colors.fg;
      ctx.save();
      if (on) {
        ctx.globalAlpha = ui.pulse(o.t || 0, 2.4, 0.35, 1);
        ctx.shadowColor = color; ctx.shadowBlur = radius * 1.8;
        ctx.fillStyle = color;
      } else {
        ctx.fillStyle = ui.colors.dim;
      }
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },

    /**
     * A pulsing "TAP TO ..." prompt centered at (cx, y), terminated by a
     * blinking block cursor (the cabinet signature).
     *   o.t     clock (drives pulse + blink)
     *   o.size  text size
     *   o.color default fg
     *   o.cursor set false to drop the block cursor
     */
    prompt: function (ctx, cx, y, str, o) {
      o = o || {};
      var size = o.size || 22;
      var color = o.color || ui.colors.fg;
      var showCursor = o.cursor !== false;
      ctx.save();
      ctx.font = ui.font(size, true);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      if (canTrack(ctx)) ctx.letterSpacing = '0.22em';
      ctx.globalAlpha = ui.pulse(o.t || 0, 1.4, 0.45, 1);
      ctx.fillStyle = color;
      var block = '█';
      var full = str + (showCursor ? '  ' + block : '');
      var x0 = cx - ctx.measureText(full).width / 2;
      ctx.fillText(str, x0, y);
      if (showCursor && ui.blink(o.t || 0)) {
        ctx.fillText(block, x0 + ctx.measureText(str + '  ').width, y);
      }
      ctx.restore();
    },

    /**
     * The shared start/win/pause/over overlay. Dims the play-area `rect`
     * ({x,y,w,h}), frames a centered panel in corner brackets, and stacks:
     *   o.title    big bloom headline (e.g. 'SOLVED', 'PAUSED', 'GAME OVER')
     *   o.tone     'win' (green) | 'lose' (red) | 'pause' (amber) — title colour
     *   o.stat     one live-data line (e.g. 'BEST  2:41'); amber if o.statNew
     *   o.statNew  true → stat reads as NEW BEST (amber + label swap by caller)
     *   o.detail   a quieter muted line under the stat (optional)
     *   o.prompt   pulsing prompt with blinking cursor (e.g. 'TAP TO PLAY')
     *   o.t        clock
     * All sizes derive from the shorter side of `rect`, so it scales across the
     * three aspect ratios untouched.
     */
    overlay: function (ctx, rect, o) {
      o = o || {};
      var unit = Math.min(rect.w, rect.h);
      var cx = rect.x + rect.w / 2;
      var cy = rect.y + rect.h / 2;

      ui.scrim(ctx, rect.x, rect.y, rect.w, rect.h);

      var boxW = Math.min(rect.w * 0.86, unit * 1.9);
      var boxH = Math.min(rect.h * 0.66, unit * 0.92);
      ui.brackets(ctx, cx - boxW / 2, cy - boxH / 2, boxW, boxH, {
        len: unit * 0.07,
        lw: Math.max(2, unit * 0.007),
        color: ui.colors.fg,
        glow: unit * 0.02
      });

      var titleCol = o.tone === 'lose' ? ui.colors.err
                   : o.tone === 'pause' ? ui.colors.amber
                   : ui.colors.fg;
      if (o.title) {
        ui.text(ctx, o.title, cx, cy - unit * 0.16, {
          color: titleCol, size: unit * 0.14, track: 0.08,
          glow: unit * 0.05, glowColor: titleCol
        });
      }
      if (o.stat) {
        ui.text(ctx, o.stat, cx, cy - unit * 0.005, {
          color: o.statNew ? ui.colors.amber : ui.colors.ink,
          size: unit * 0.05, track: 0.06
        });
      }
      if (o.detail) {
        ui.text(ctx, o.detail, cx, cy + unit * 0.075, {
          color: ui.colors.muted, size: unit * 0.036, bold: false, track: 0.04
        });
      }
      if (o.prompt) {
        ui.prompt(ctx, cx, cy + unit * 0.19, o.prompt, {
          t: o.t, size: unit * 0.052, color: ui.colors.fg
        });
      }
    }
  };

  NG.ui = ui;
})(window);
