/* Guard 49: anti-debugging / DevTools detection.
 *
 * Readable SOURCE. tools/obfuscate.js packs this into antidebug.js, which is
 * what the page actually loads (guard 50). Edit this file, not the output.
 *
 * Every check here is defeatable by a determined analyst — that is inherent.
 * The purpose is to raise the cost of the FIRST look, which is what stops
 * casual scraper authors.
 */
(function () {
  "use strict";
  var signals = [];

  /* 1. Timing around a debugger statement. If a debugger is attached and
     paused, the elapsed time across this statement explodes. With no debugger
     it costs nothing. */
  function debuggerTrap() {
    var t0 = performance.now();
    // eslint-disable-next-line no-debugger
    debugger;
    if (performance.now() - t0 > 100) signals.push("debugger-detected");
  }

  /* 2. DevTools docked in the same window changes the viewport delta. */
  function viewportGap() {
    var wGap = window.outerWidth - window.innerWidth;
    var hGap = window.outerHeight - window.innerHeight;
    if (wGap > 200 || hGap > 250) signals.push("devtools-viewport-gap");
  }

  /* 3. Inspection tripwire: the getter only fires if something formats this
     object for display — i.e. a console is open and rendering it. */
  function consoleTripwire() {
    var probe = Object.create(null);
    var tripped = false;
    Object.defineProperty(probe, "id", {
      get: function () { tripped = true; return "sg"; },
      enumerable: true,
    });
    console.debug(probe);
    if (tripped) signals.push("console-inspected");
  }

  /* 4. Tamper check: if someone has monkey-patched the functions this script
     relies on, their toString no longer looks native. */
  function nativeIntegrity() {
    var suspects = [Function.prototype.toString, performance.now, JSON.parse];
    for (var i = 0; i < suspects.length; i++) {
      if (String(suspects[i]).indexOf("[native code]") === -1) {
        signals.push("patched-builtin");
        break;
      }
    }
  }

  try { debuggerTrap(); } catch (e) { /* ignore */ }
  try { viewportGap(); } catch (e) { /* ignore */ }
  try { consoleTripwire(); } catch (e) { /* ignore */ }
  try { nativeIntegrity(); } catch (e) { /* ignore */ }

  window.__SG_ANTIDEBUG = {
    signals: signals,
    clean: signals.length === 0,
    flag: signals.length === 0 ? "FLAG-ANTIDEBUG-6c4f" : "FLAG-ANTIDEBUG-TRIPPED",
  };
})();
