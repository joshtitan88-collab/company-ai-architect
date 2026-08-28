/**
 * Sam visual states: idle → listen → process → talk.
 * Photoreal stills of the same woman. Not speak-only.
 *
 *   SamStates.set("listen"|"process"|"talk"|"idle")
 *   SamStates.cycle()  // listen → process → talk → idle (for wiring tests)
 *
 * Claude: load this before desk.js. Do not open the public homepage until critics pass.
 * This file injects missing stills into #desk .desk-stage so HTML can stay closed.
 */
(function (root) {
  "use strict";

  const MODES = ["idle", "listen", "process", "talk"];
  const STILLS = {
    idle: "./assets/desk.jpg",
    listen: "./assets/desk-listen.jpg",
    process: "./assets/desk-process.jpg",
    talk: "./assets/desk-speak.jpg",
  };
  const VIDS = {
    idle: "#vidIdle",
    talk: "#vidTalk",
  };

  function deskEl() {
    return document.getElementById("desk");
  }

  function ensureStills() {
    const stage = document.querySelector("#desk .desk-stage");
    if (!stage) return;
    Object.keys(STILLS).forEach(function (mode) {
      const klass = mode === "talk" ? "speak" : mode;
      if (stage.querySelector(".desk-still." + klass)) return;
      const img = document.createElement("img");
      img.className = "desk-still " + klass;
      img.src = STILLS[mode];
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      stage.insertBefore(img, stage.firstChild);
    });
  }

  function playVid(sel, on) {
    const el = document.querySelector(sel);
    if (!el || typeof el.play !== "function") return;
    if (on) {
      const p = el.play();
      if (p && p.catch) p.catch(function () {});
    } else {
      try {
        el.pause();
      } catch (_e) {}
    }
  }

  function set(mode) {
    if (MODES.indexOf(mode) < 0) mode = "idle";
    const desk = deskEl();
    if (!desk) return mode;
    ensureStills();
    desk.classList.remove("talking", "listening", "processing");
    if (mode === "listen") desk.classList.add("listening");
    if (mode === "process") desk.classList.add("processing");
    if (mode === "talk") desk.classList.add("talking");
    desk.dataset.samMode = mode;
    const reduce =
      root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce && desk.classList.contains("has-vid")) {
      playVid(VIDS.idle, mode === "idle" || mode === "listen" || mode === "process");
      playVid(VIDS.talk, mode === "talk");
    }
    if (typeof root.dispatchEvent === "function") {
      root.dispatchEvent(new CustomEvent("samstate", { detail: { mode: mode } }));
    }
    return mode;
  }

  function sleep(ms) {
    return new Promise(function (ok) {
      setTimeout(ok, ms);
    });
  }

  /** listen (client talking/typing) → process (working it) → talk → idle */
  function cycle(opts) {
    opts = opts || {};
    const listenMs = opts.listenMs || 1400;
    const processMs = opts.processMs || 1100;
    const talkMs = opts.talkMs || 1800;
    return Promise.resolve()
      .then(function () {
        set("listen");
        return sleep(listenMs);
      })
      .then(function () {
        set("process");
        return sleep(processMs);
      })
      .then(function () {
        set("talk");
        return sleep(talkMs);
      })
      .then(function () {
        set("idle");
        return "idle";
      });
  }

  root.SamStates = {
    set: set,
    cycle: cycle,
    ensure: ensureStills,
    MODES: MODES,
    STILLS: STILLS,
  };
})(typeof window !== "undefined" ? window : globalThis);
