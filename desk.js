/**
 * desk.js — Sam's front desk, wired to the layered stack:
 *   SamVoice (canned mp3 / server TTS) → SamNLU (conversation + booking)
 *   → SamMessages (message intake + routing) → SamQualify (silent lead notes)
 * Script order (receptionist.html): sam-voice > desk-nlu > desk-messages >
 * desk-qualify > sam-states > desk.js. No browser speechSynthesis, ever.
 */
const said = document.getElementById("said");
const logEl = document.getElementById("log");
const q = document.getElementById("q");
const calEl = document.getElementById("calendar");
const cardsEl = document.getElementById("cards");
const bookEl = document.getElementById("bookbox");
const desk = document.getElementById("desk");
const micBtn = document.getElementById("mic");
const hint = document.getElementById("hint");
const enterBtn = document.getElementById("enter");
const vidIdle = document.getElementById("vidIdle");
const vidTalk = document.getElementById("vidTalk");
const vidListen = document.getElementById("vidListen");
const vidProcess = document.getElementById("vidProcess");
const stateEl = document.getElementById("state");

let remoteSlots = [];
let selected = null;
let started = false;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const session = SamNLU.createSession();
const msgSession = SamMessages.createSession();
const qual = SamQualify.createSession();

const GREETING = SamNLU.GREETING;
const GREETING_CLIP = "./assets/sam-imagine-speak.mp4"; // already lip-synced to GREETING
const TALK_CLIP = "./assets/desk-talk.mp4"; // generic mouth motion for non-greeting lines

let talkSrc = ""; // tracks vidTalk's current clip; only swap when different
function setTalkClip(src, loop) {
  if (!vidTalk) return;
  if (talkSrc !== src) {
    vidTalk.src = src;
    talkSrc = src;
  }
  vidTalk.loop = !!loop;
}

// --- Returning-visitor memory ------------------------------------------------
const VISITOR_KEY = "caa_visitor";
function getVisitor() {
  try {
    const v = JSON.parse(localStorage.getItem(VISITOR_KEY) || "null");
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}
function saveVisitor(v) {
  try { localStorage.setItem(VISITOR_KEY, JSON.stringify(v)); } catch {}
}

let mode = "idle";
let processTimer = 0;
let talkTimer = 0;

const VIDS = { idle: vidIdle, listen: vidListen, process: vidProcess, talk: vidTalk };

function playVid(el, unmuted) {
  if (!el || reduceMotion) return;
  el.muted = !unmuted;
  const p = el.play();
  if (p && p.catch) p.catch(() => {});
}

function armVideos() {
  const ok = (el) => el && el.readyState >= 2 && el.videoWidth > 0;
  if (ok(vidIdle) || ok(vidTalk) || ok(vidListen) || ok(vidProcess)) desk.classList.add("has-vid");
  if (!reduceMotion) playVid(vidIdle, false);
}

function setStatus(label) {
  if (stateEl) stateEl.textContent = label || "";
}

function setMode(next) {
  mode = next;
  desk.classList.remove("talking", "listening", "processing");
  if (next === "talk") desk.classList.add("talking");
  if (next === "listen") desk.classList.add("listening");
  if (next === "process") desk.classList.add("processing");
  setStatus(next === "listen" ? "Listening" : next === "process" ? "Working" : "");
  if (reduceMotion) return;
  const active = VIDS[next] || vidIdle;
  Object.entries(VIDS).forEach(([k, el]) => {
    if (!el) return;
    if (el === active) playVid(el, k === "talk" && el === vidTalk && vidTalk.dataset.ownAudio === "1");
    else el.pause();
  });
}

// SamVoice drives the talk state; greeting plays its own lip-synced clip.
window.addEventListener("samvoice:start", () => setMode("talk"));
window.addEventListener("samvoice:end", () => { if (mode === "talk") setMode("idle"); });
window.addEventListener("samvoice:unavailable", (e) => {
  const len = (e && e.detail && e.detail.text ? e.detail.text.length : 80);
  setMode("talk");
  clearTimeout(talkTimer);
  talkTimer = setTimeout(() => { if (mode === "talk") setMode("idle"); }, Math.min(8000, 80 * len));
});

function speak(text) {
  said.textContent = text;
  if (hint) hint.classList.add("hidden");
  addLog("sam", text);
  if (text === GREETING && vidTalk && !reduceMotion) {
    // The greeting clip carries Sam's real voice — play it unmuted, skip TTS.
    vidTalk.dataset.ownAudio = "1";
    setTalkClip(GREETING_CLIP, false);
    vidTalk.onended = () => { vidTalk.onended = null; vidTalk.dataset.ownAudio = ""; setMode("idle"); };
    setMode("talk");
    return;
  }
  if (vidTalk && !reduceMotion) {
    // Generic mouth loop for every non-greeting line — muted, looping.
    vidTalk.dataset.ownAudio = "";
    vidTalk.onended = null;
    setTalkClip(TALK_CLIP, true);
    vidTalk.muted = true;
  }
  SamVoice.play(text);
}

function receive(text) {
  const t = (text || "").trim();
  if (!t) return;
  if (!started) begin();
  addLog("you", t);
  setMode("process");
  clearTimeout(processTimer);
  processTimer = setTimeout(() => handle(t), 400);
}

function addLog(who, text) {
  const d = document.createElement("div");
  d.className = who === "you" ? "you" : "sam";
  d.textContent = (who === "you" ? "You: " : "Sam: ") + text;
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
}

function hidePanels() {
  calEl.classList.add("hidden");
  cardsEl.classList.add("hidden");
  bookEl.classList.add("hidden");
}

function showCards(title, items) {
  hidePanels();
  cardsEl.classList.remove("hidden");
  cardsEl.innerHTML =
    `<h3>${title}</h3>` +
    items.map((it) => `<article><strong>${it.t}</strong> ${it.b}</article>`).join("");
}

function fmtDay(ts) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(ts));
}
function fmtTime(ts) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(ts));
}
function dayKey(ts) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ts));
}

function renderCal(focusDay) {
  const byDay = new Map();
  for (const s of remoteSlots) {
    const k = dayKey(s.start);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }
  const days = [...byDay.keys()];
  hidePanels();
  if (!days.length) {
    calEl.innerHTML = `<h3>Open discovery times</h3><p class="fine">No open weekday slots in this window. Name a time and I'll still take the request.</p>`;
    calEl.classList.remove("hidden");
    return;
  }
  const day = focusDay && byDay.has(focusDay) ? focusDay : days[0];
  const chips = byDay.get(day).map((s) =>
    `<button type="button" class="slot${selected && selected.iso === s.iso ? " on" : ""}" data-iso="${s.iso}" data-ts="${s.start}">${fmtTime(s.start)}</button>`
  ).join("");
  const dayBtns = days.map((k) => {
    const t = byDay.get(k)[0].start;
    return `<button type="button" class="cal-day${k === day ? " on" : ""}" data-day="${k}"><span class="d">${fmtDay(t).split(" ")[0]}</span><span class="n">${fmtDay(t).split(" ").slice(1).join(" ")}</span></button>`;
  }).join("");
  calEl.innerHTML = `<h3>Open discovery times · Eastern</h3>
    <div class="cal-days">${dayBtns}</div>
    <div class="slots">${chips}</div>
    <p class="fine">Openings only. No names. Thirty minutes.</p>`;
  calEl.classList.remove("hidden");
  calEl.querySelectorAll(".cal-day").forEach((b) => b.addEventListener("click", () => renderCal(b.dataset.day)));
  calEl.querySelectorAll(".slot").forEach((b) => b.addEventListener("click", () => {
    selected = { iso: b.dataset.iso, start: Number(b.dataset.ts) };
    const follow = SamNLU.selectSlot(session, selected);
    if (follow && follow.reply) speak(follow.reply);
    openBook();
  }));
}

function openBook() {
  hidePanels();
  bookEl.classList.remove("hidden");
  const when = selected ? `${fmtDay(selected.start)} at ${fmtTime(selected.start)} Eastern` : "a time we confirm";
  document.getElementById("slotLabel").textContent = when;
}

function idemKey() {
  let idem = sessionStorage.getItem("caa_idem");
  if (!idem) {
    idem = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
    sessionStorage.setItem("caa_idem", idem);
  }
  return idem + (selected ? ":" + selected.iso : "");
}
function sessionId() {
  if (!sessionStorage.getItem("caa_sid")) {
    sessionStorage.setItem("caa_sid", "sam_chat_" + ((crypto.randomUUID && crypto.randomUUID()) || Date.now()));
  }
  return sessionStorage.getItem("caa_sid");
}

async function postBook(payload) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  const body = {
    ...payload,
    ...SamQualify.fields(qual),
    timezone: tz,
    idempotencyKey: idemKey(),
    sessionId: sessionId(),
  };
  try {
    const r = await fetch("/api/book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 409 && data.error === "slot_taken") {
      speak("That time just filled. Here is what's still open.");
      renderCal();
      return false;
    }
    if (!r.ok || !data.ok) {
      speak("I've noted your interest, and someone will follow up within a few hours.");
      return false;
    }
    if (data.duplicate) {
      speak("You're already on the book for that time.");
      hidePanels();
      return true;
    }
    setMode("process");
    setTimeout(() => speak("You're set. You'll get a confirmation shortly. I'm glad we found a time."), 500);
    hidePanels();
    // Remember the booking for returning visitors — before selected is cleared.
    const slotLabelEl = document.getElementById("slotLabel");
    saveVisitor({
      seen: true,
      lastBooking: {
        slotLabel: slotLabelEl ? slotLabelEl.textContent : "",
        iso: selected ? selected.iso : "",
      },
    });
    selected = null;
    return true;
  } catch {
    speak("I could not file that slot just now. Try again, or leave me a message and someone will follow up.");
    return false;
  }
}

async function handle(text) {
  hidePanels();
  SamQualify.observe(qual, text);

  // Message intake wins while active or explicitly requested.
  if (SamMessages.active(msgSession) || SamMessages.wants(text)) {
    const turn = await SamMessages.turnSmart(msgSession, text);
    speak(turn.reply);
    if (turn.action === "handoff_book") { renderCal(); return; }
    if (turn.action === "submit_message") {
      try {
        const r = await fetch("/api/message", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(turn.payload),
        });
        if (!r.ok) speak(SamMessages.LINES.send_failed);
      } catch {
        speak(SamMessages.LINES.send_failed);
      }
    }
    return;
  }

  const turn = await SamNLU.turn(session, text, { slots: remoteSlots });
  speak(turn.reply);
  if (turn.action === "show_calendar") renderCal();
  if (turn.action === "show_packages") showCards("Packages", SamNLU.PACKAGES);
  if (turn.action === "show_stages") showCards("Five stages", SamNLU.STAGES);
  if (turn.action === "open_book") {
    if (turn.slot) selected = turn.slot;
    openBook();
  }
  if (turn.action === "submit_book") {
    await postBook(turn.payload || SamNLU.bookPayload(session));
  }
}

function begin() {
  if (started) return;
  started = true;
  enterBtn.classList.add("gone");
  desk.classList.add("live");
  armVideos();
  setMode("process");
  const visitor = getVisitor();
  if (visitor && visitor.seen) {
    let line = "Welcome back — good to see you again.";
    const lb = visitor.lastBooking;
    if (lb && lb.iso && new Date(lb.iso).getTime() > Date.now()) {
      line += " You're on the book for " + lb.slotLabel + ". Anything else I can help with?";
    }
    setTimeout(() => speak(line), 400);
  } else {
    saveVisitor({ seen: true, lastBooking: (visitor && visitor.lastBooking) || null });
    setTimeout(() => speak(GREETING), 400);
  }
  q.focus();
}

document.getElementById("send").addEventListener("click", () => {
  receive(q.value);
  q.value = "";
});
q.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); receive(q.value); q.value = ""; }
});
q.addEventListener("focus", () => { if (started && mode === "idle") setMode("listen"); });
q.addEventListener("input", () => { if (started && mode !== "talk" && mode !== "process") setMode("listen"); });

// Whisper-backed fallback (local dev /api/stt) for browsers without
// SpeechRecognition — records up to 6s, transcribes server-side.
let sttBusy = false;
async function sttFallback() {
  if (sttBusy) return;
  if (!window.SamSTT || !(await SamSTT.available())) {
    addLog("sam", "This browser has no speech recognition — type and I'll help just the same.");
    q.focus();
    return;
  }
  sttBusy = true;
  micBtn.classList.add("live");
  setMode("listen");
  try {
    const text = await SamSTT.record({ maxMs: 6000 });
    if (text && text.trim()) receive(text.trim());
    else { setMode("idle"); addLog("sam", "I didn't quite catch that — type it and I'll help just the same."); }
  } catch {
    setMode("idle");
    addLog("sam", "The mic did not start — type and I'll help just the same.");
  } finally {
    sttBusy = false;
    micBtn.classList.remove("live");
    q.focus();
  }
}

const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Rec) {
  const rec = new Rec();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.onresult = (e) => receive(e.results[0][0].transcript);
  rec.onstart = () => { micBtn.classList.add("live"); setMode("listen"); };
  rec.onend = () => { micBtn.classList.remove("live"); if (mode === "listen") setMode("idle"); };
  micBtn.addEventListener("click", () => {
    if (!started) begin();
    try { rec.start(); }
    catch { sttFallback(); }
  });
} else {
  micBtn.addEventListener("click", () => {
    if (!started) begin();
    sttFallback();
  });
}

document.getElementById("bookForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const localConfirm = selected
    ? new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(selected.start))
    : "";
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  const ok = await postBook({
    name: fd.get("name"),
    email: fd.get("email"),
    company: fd.get("company"),
    pain: fd.get("pain"),
    slotIso: selected ? selected.iso : "",
    localConfirm,
  });
  if (ok) e.target.reset();
  btn.disabled = false;
});

enterBtn.addEventListener("click", begin);
["vidIdle", "vidTalk", "vidListen", "vidProcess"].forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("loadeddata", armVideos);
  el.addEventListener("canplay", armVideos);
  el.addEventListener("error", () => {});
});

fetch("/api/slots")
  .then((r) => r.json())
  .then((d) => { remoteSlots = d.slots || []; })
  .catch(() => { remoteSlots = []; });

if (!reduceMotion) {
  vidIdle.addEventListener("canplay", () => playVid(vidIdle), { once: true });
}
