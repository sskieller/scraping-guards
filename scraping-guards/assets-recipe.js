/* Client script for the recipe page.
 *
 * Three jobs, each of which is a genuine scraping obstacle a real site creates
 * without ever intending to:
 *   - the servings calculator rewrites every quantity in the DOM (guard 1);
 *   - the last five steps load on scroll (guard 6);
 *   - nutrition arrives from an API after load (guard 1).
 */
(function () {
  "use strict";

  const BASE_YIELD = Number(document.body.dataset.baseYield) || 12;

  /* ---- Servings calculator ---------------------------------------------
   * Mirrors scaleItem() in lib/recipe-data.js. Non-scalable quantities are
   * left alone and visually marked, rather than silently multiplied. */
  function roundLikeACook(v) {
    if (v >= 100) return Math.round(v / 5) * 5;
    if (v >= 10) return Math.round(v);
    return Math.round(v * 2) / 2;
  }

  function scaleTo(target) {
    const factor = target / BASE_YIELD;
    document.querySelectorAll(".qty").forEach((el) => {
      const base = Number(el.dataset.qty);
      const unit = el.dataset.unit || "";
      if (el.dataset.scalable !== "true") {
        el.textContent = `${base}${unit ? " " + unit : ""}`;
        el.classList.add("fixed");
        el.title = "Does not scale linearly — adjust by judgement";
        return;
      }
      const scaled = roundLikeACook(base * factor);
      el.textContent = `${scaled}${unit ? " " + unit : ""}`;
    });

    const readout = document.getElementById("yield-readout");
    if (readout) readout.textContent = String(target);
    const note = document.getElementById("scale-note");
    if (note) {
      const f = factor.toFixed(2).replace(/\.00$/, "");
      note.textContent = factor === 1 ? "×1 — as written" : `×${f} — scaled from ${BASE_YIELD}`;
    }
  }

  const select = document.getElementById("servings");
  if (select) {
    select.addEventListener("change", () => scaleTo(Number(select.value)));
    scaleTo(Number(select.value));
  }

  /* ---- Guard 6: the remaining steps load on scroll ---------------------- */
  (function () {
    const sentinel = document.getElementById("more-steps");
    const list = document.getElementById("steps");
    if (!sentinel || !list) return;

    let loaded = false;
    async function loadRest() {
      if (loaded) return;
      loaded = true;
      try {
        const from = list.querySelectorAll("li.step").length + 1;
        const { steps } = await fetch(`/api/recipe/steps?from=${from}`).then((r) => r.json());
        for (const s of steps) {
          const li = document.createElement("li");
          li.className = "step";
          li.id = "step-" + s.n;
          li.value = s.n;
          li.innerHTML = `<h3><span class="step-n">${s.n}</span> ${s.title}</h3><p>${s.text}</p>`;
          list.appendChild(li);
        }
        sentinel.textContent = `All ${list.querySelectorAll("li.step").length} steps loaded.`;
        sentinel.classList.remove("loading");
      } catch (e) {
        sentinel.textContent = "Could not load the remaining steps.";
      }
    }

    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { loadRest(); io.disconnect(); } });
      }, { rootMargin: "200px" });
      io.observe(sentinel);
    } else {
      loadRest();
    }
  })();

  /* ---- Nutrition, fetched after load ----------------------------------- */
  (async function () {
    const panel = document.getElementById("nutrition-panel");
    if (!panel) return;
    try {
      const n = await fetch("/api/recipe/nutrition").then((r) => r.json());
      panel.innerHTML =
        `<table class="nutrition-table"><tbody>` +
        [["Energy", n.calories + " kcal"], ["Fat", n.fat + " g"], ["  of which saturates", n.saturates + " g"],
         ["Carbohydrate", n.carbs + " g"], ["  of which sugars", n.sugars + " g"],
         ["Protein", n.protein + " g"], ["Salt", n.salt + " g"]]
          .map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join("") +
        `</tbody></table>`;
    } catch (e) {
      panel.textContent = "Nutrition unavailable.";
    }
  })();
})();
