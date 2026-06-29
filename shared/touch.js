/*
 * NG.touch — multitouch input helper for the Nostalgic Gaming catalogue.
 *
 * Classic script (no ES module). Load AFTER ng.js:
 *   <script src="../../shared/ng.js"></script>
 *   <script src="../../shared/touch.js"></script>
 *
 * Built on Pointer Events, so the same code handles touch (one pointer per
 * finger, up to `maxPoints`), pen, and mouse — the last is handy for testing
 * on a desktop, where one mouse acts as a single touch point.
 *
 * Usage:
 *   var ctl = NG.createTouch(canvas, {
 *     onDown: function (p) { ... },   // p = a point (see below)
 *     onMove: function (p) { ... },
 *     onUp:   function (p) { ... },
 *   });
 *   ctl.list();      // -> array of currently-active points, for per-frame polling
 *   ctl.count;       // -> number of active points
 *   ctl.destroy();   // detach listeners
 *
 * Optional 3rd arg `options`: { maxPoints (default 10), ignoreMouse (skip mouse
 * pointers, e.g. when a game handles the mouse itself) }.
 *
 * A point: {
 *   id,                 // pointer id
 *   x, y,               // current position in CSS pixels, relative to the element
 *   nx, ny,             // current position normalised to 0..1 across the element
 *   startX, startY,     // where the touch began (CSS px)
 *   startNx, startNy,   // where the touch began (0..1) — useful for "which side?"
 * }
 */
(function (global) {
  'use strict';

  var NG = global.NG || (global.NG = {});
  var MAX_POINTS_DEFAULT = 10;

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  NG.createTouch = function (element, handlers, options) {
    handlers = handlers || {};
    options = options || {};
    var maxPoints = options.maxPoints || MAX_POINTS_DEFAULT;

    var points = Object.create(null); // id -> point
    var count = 0;

    // Stop the browser from treating drags as scroll/zoom/selection.
    element.style.touchAction = 'none';
    element.style.userSelect = 'none';

    function coords(ev) {
      var rect = element.getBoundingClientRect();
      var w = rect.width || 1;
      var h = rect.height || 1;
      var x = ev.clientX - rect.left;
      var y = ev.clientY - rect.top;
      return { x: x, y: y, nx: clamp01(x / w), ny: clamp01(y / h) };
    }

    function onDown(ev) {
      if (options.ignoreMouse && ev.pointerType === 'mouse') return;
      // Only the primary mouse button drives a touch point; right/middle clicks
      // are left for the game to use (e.g. right-click to flag in Minesweeper).
      if (ev.pointerType === 'mouse' && ev.button > 0) return;
      if (count >= maxPoints || points[ev.pointerId]) return;
      var c = coords(ev);
      var p = {
        id: ev.pointerId,
        x: c.x, y: c.y, nx: c.nx, ny: c.ny,
        startX: c.x, startY: c.y, startNx: c.nx, startNy: c.ny,
      };
      points[ev.pointerId] = p;
      count++;
      // Keep receiving move/up even if the finger leaves the element bounds.
      if (element.setPointerCapture) {
        try { element.setPointerCapture(ev.pointerId); } catch (e) {}
      }
      ev.preventDefault();
      if (handlers.onDown) handlers.onDown(p, ev);
    }

    function onMove(ev) {
      var p = points[ev.pointerId];
      if (!p) return;
      var c = coords(ev);
      p.x = c.x; p.y = c.y; p.nx = c.nx; p.ny = c.ny;
      ev.preventDefault();
      if (handlers.onMove) handlers.onMove(p, ev);
    }

    function onUp(ev) {
      var p = points[ev.pointerId];
      if (!p) return;
      delete points[ev.pointerId];
      count--;
      ev.preventDefault();
      if (handlers.onUp) handlers.onUp(p, ev);
    }

    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onUp);

    return {
      points: points,
      list: function () {
        var out = [];
        for (var id in points) out.push(points[id]);
        return out;
      },
      get count() { return count; },
      destroy: function () {
        element.removeEventListener('pointerdown', onDown);
        element.removeEventListener('pointermove', onMove);
        element.removeEventListener('pointerup', onUp);
        element.removeEventListener('pointercancel', onUp);
      },
    };
  };
})(window);
