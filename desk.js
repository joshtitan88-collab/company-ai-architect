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
const depositEl = document.getElementById("depositbox");
const depositBtn = document.getElementById("depositBtn");
const depositStatus = document.getElementById("depositStatus");
const googleCal = document.getElementById("googleCal");
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
let slotsStatus = "loading";
let bookingBusy = false;
let messageBusy = false;
let selected = null;
let depositConfig = { enabled: false, amount: 0 };
let lastBooking = null;
let started = false;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let session = SamNLU.createSession();
let msgSession = SamMessages.createSession();
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
let greetingTimer = 0;
let deferredReplyTimer = 0;
let turnNumber = 0;
let turnController = null;

const VIDS = { idle: vidIdle, listen: vidListen, process: vidProcess, talk: vidTalk };

function playVid(el, unmuted) {
  if (!el || reduceMotion) return;
  el.muted = !unmuted;
  const p = el.play();
  if (p && p.catch) p.catch(() => {});
}

function armVideos() {
  if (reduceMotion) return; // stills only — never swap the stage to video layers
  const ok = (el) => el && el.readyState >= 2 && el.videoWidth > 0;
  if (ok(vidIdle) || ok(vidTalk) || ok(vidListen) || ok(vidProcess)) desk.classList.add("has-vid");
  // Only nudge the idle layer; other modes own their own layer via setMode
  // (never touch vidTalk here — sam-lipsync.js may be pausing it mid-talk).
  if (mode === "idle" && vidIdle) {
    vidIdle.classList.add("on");
    playVid(vidIdle, false);
  }
}

function setStatus(label) {
  if (stateEl) stateEl.textContent = label || "";
}

const FADE_MS = 300; // pause outgoing layers just after the 260ms CSS crossfade
let fadeTimer = 0;

function setMode(next) {
  mode = next;
  window.dispatchEvent(new CustomEvent("sam:mode", { detail: { mode: next } }));
  desk.classList.remove("talking", "listening", "processing");
  if (next === "talk") desk.classList.add("talking");
  if (next === "listen") desk.classList.add("listening");
  if (next === "process") desk.classList.add("processing");
  setStatus(next === "listen" ? "Listening" : next === "process" ? "Thinking…" : next === "talk" ? "Speaking" : "Ready when you are");
  if (window.Sam3D && Sam3D.active()) {
    Object.values(VIDS).forEach(el => { if (el) { el.pause(); el.muted = true; } });
    return;
  }
  if (reduceMotion) return;
  const active = VIDS[next] || vidIdle;
  Object.entries(VIDS).forEach(([k, el]) => {
    if (!el) return;
    if (el === active) {
      // Fade the incoming layer in while it plays — no hard cut.
      el.classList.add("on");
      playVid(el, k === "talk" && el === vidTalk && vidTalk.dataset.ownAudio === "1");
    } else {
      // Fade out now; keep it playing until the fade ends so the outgoing
      // frame doesn't freeze mid-blend. Actual pause happens in fadeTimer.
      el.classList.remove("on");
    }
  });
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => {
    const current = VIDS[mode] || vidIdle;
    Object.values(VIDS).forEach((el) => {
      // Never pause the active layer (sam-lipsync.js may itself pause/play
      // vidTalk during talk — we leave the visible layer alone), and skip
      // any layer that became active again mid-fade.
      if (el && el !== current && !el.classList.contains("on")) el.pause();
    });
  }, FADE_MS);
}

// SamVoice drives the talk state; greeting plays its own lip-synced clip.
window.addEventListener("samvoice:start", () => setMode("talk"));
window.addEventListener("samvoice:end", () => { if (mode === "talk") setMode("idle"); });
window.addEventListener("samvoice:cancel", () => { if (mode === "talk") setMode("idle"); });
window.addEventListener("samvoice:loading", () => setMode("process"));
window.addEventListener("samvoice:unavailable", () => {
  setMode("idle");
  if (hint) { hint.textContent = "Voice is unavailable right now. You can keep chatting here."; hint.classList.remove("hidden"); }
});
window.addEventListener("sam3d:ready", () => setMode(mode));
window.addEventListener("sam3d:unavailable", () => setMode(mode));

function stopEverything(reason) {
  cancelListening();
  clearTimeout(processTimer);
  clearTimeout(talkTimer);
  clearTimeout(greetingTimer);
  clearTimeout(deferredReplyTimer);
  if (turnController) {
    try { turnController.abort(); } catch (_e) {}
    turnController = null;
  }
  SamVoice.stop(reason || "interrupted");
  if (window.SamAvatar && SamAvatar.active()) SamAvatar.stop();
  if (vidTalk) {
    vidTalk.onended = null;
    vidTalk.dataset.ownAudio = "";
    vidTalk.pause();
    vidTalk.muted = true;
  }
}

function speak(text, expectedTurn) {
  if (expectedTurn != null && expectedTurn !== turnNumber) return;
  SamVoice.stop("new_reply");
  said.textContent = text;
  if (hint) hint.classList.add("hidden");
  addLog("sam", text);
  // One Eve audio authority handles every line, including the greeting.
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
  if (/^(?:stop|stop speaking|be quiet|quiet|pause)[.!]*$/i.test(t)) { stopEverything("visitor_stop"); turnNumber++; setMode("idle"); addLog("sam", "Of course. I’m here when you’re ready."); said.textContent = "Of course. I’m here when you’re ready."; return; }
  if (!started) begin(false);
  stopEverything("visitor_interrupt");
  const myTurn = ++turnNumber;
  turnController = typeof AbortController !== "undefined" ? new AbortController() : null;
  addLog("you", t);
  setMode("process");
  const signal = turnController ? turnController.signal : null;
  handle(t, myTurn, signal).catch(() => {
    if (myTurn === turnNumber) speak("Something interrupted that response. Please try again.", myTurn);
  });
}

function addLog(who, text) {
  const d = document.createElement("div");
  d.className = who === "you" ? "you" : "sam";
  d.textContent = (who === "you" ? "You: " : "Sam: ") + text;
  logEl.appendChild(d);
  while (logEl.children.length > 40) logEl.firstChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
}

function hidePanels() {
  calEl.classList.add("hidden");
  cardsEl.classList.add("hidden");
  bookEl.classList.add("hidden");
  if (depositEl) depositEl.classList.add("hidden");
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
    calEl.innerHTML = `<h3>Discovery availability</h3><p class="fine">${slotsStatus === "error" ? "I can’t check availability right now. Please retry, or leave a message with your preferred time." : slotsStatus === "loading" ? "Checking the latest openings…" : "No openings in this window. You can leave a message with your preferred time."}</p><button type="button" id="retrySlots">Check again</button>`;
    calEl.querySelector("#retrySlots").addEventListener("click", async () => { await loadSlots(); renderCal(); });
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
    stopEverything("slot_selected");
    turnNumber++;
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
  if (bookingBusy) return false;
  bookingBusy = true;
  const bookingTurn = turnNumber;
  const body = { ...payload, ...SamQualify.fields(qual),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
    idempotencyKey: idemKey(), sessionId: sessionId() };
  try {
    const r = await fetch("/api/book", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    const data = await r.json().catch(() => ({}));
    if (r.status === 409) {
      session.phase = "awaiting_slot";
      selected = null;
      session.booking.slotIso = "";
      await loadSlots();
      if (bookingTurn === turnNumber) { speak("That time has just been taken. Let's choose another opening.", bookingTurn); renderCal(); }
      return false;
    }
    if (!r.ok || !data.ok || !data.id) throw new Error("booking_failed");
    const confirmed = data.status === "confirmed";
    session.phase = confirmed ? "booked" : "requested";
    lastBooking = { ...payload, bookingId: data.id, slotIso: payload.slotIso, status: data.status, confirmed, emailSent: !!data.confirmationEmail?.sent };
    saveVisitor({ seen: true, lastBooking: { iso: payload.slotIso, slotLabel: document.getElementById("slotLabel").textContent, confirmed } });
    selected = null;
    if (bookingTurn === turnNumber) {
      speak(confirmed
        ? "Your discovery appointment is confirmed." + (data.confirmationEmail?.sent ? " A confirmation email has been sent." : " You can add the time to your calendar below.")
        : "Your appointment request has been saved for the team. It still needs confirmation." + (data.confirmationEmail?.sent ? " I've sent an email acknowledging your request." : ""), bookingTurn);
      showPostBooking();
    } else {
      addLog("sam", confirmed ? "Your discovery appointment was confirmed." : "Your discovery request was saved and is awaiting confirmation.");
    }
    return true;
  } catch {
    session.phase = "confirming";
    if (bookingTurn === turnNumber) speak("I couldn't confirm that submission. Your details are still here; please try again.", bookingTurn);
    return false;
  } finally { bookingBusy = false; }
}

function googleCalendarUrl(booking) {
  if (!booking || !booking.slotIso) return "#";
  const start = new Date(booking.slotIso);
  const end = new Date(start.getTime() + 30 * 60_000);
  const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: "Company AI Architect discovery",
    dates: `${stamp(start)}/${stamp(end)}`,
    details: "Free 30-minute discovery with Company AI Architect.",
    location: "Online",
  });
  return "https://calendar.google.com/calendar/render?" + p.toString();
}

function showPostBooking() {
  hidePanels();
  if (!depositEl || !lastBooking) return;
  const confirmed = lastBooking.confirmed;
  const title = document.getElementById("bookingHeading");
  if (title) title.textContent = confirmed ? "Your discovery is confirmed" : "Your request is with the team";
  googleCal.href = confirmed ? googleCalendarUrl(lastBooking) : "#";
  googleCal.classList.toggle("hidden", !confirmed);
  depositBtn.classList.toggle("hidden", !confirmed || !depositConfig.enabled);
  const explanation = depositEl.querySelector(".fine");
  if (explanation) explanation.textContent = confirmed ? "Your 30-minute discovery call is free." : "The team will review your preferred time. This is not a confirmed appointment yet.";
  depositStatus.textContent = confirmed && depositConfig.enabled ? `Optional deposit: $${(depositConfig.amount / 100).toFixed(2)}.` : "";
  depositEl.classList.remove("hidden");
}

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

async function handle(text, myTurn, signal) {
  if (myTurn !== turnNumber || (signal && signal.aborted)) return;
  hidePanels();
  SamQualify.observe(qual, text);

  // Message intake wins while active or explicitly requested.
  if (SamMessages.active(msgSession) || SamMessages.wants(text)) {
    if (messageBusy) { speak("Your message is being submitted. I will show the result here.", myTurn); return; }
    const nextMessageSession = cloneState(msgSession);
    const turn = await SamMessages.turnSmart(nextMessageSession, text);
    if (myTurn !== turnNumber || (signal && signal.aborted)) return;
    msgSession = nextMessageSession;
    speak(turn.reply, myTurn);
    if (turn.action === "handoff_book") { renderCal(); return; }
    if (turn.action === "submit_message") {
      messageBusy = true;
      try {
        const r = await fetch("/api/message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(turn.payload), signal: AbortSignal.timeout(20000) });
        const data = await r.json().catch(() => ({}));
        const ok = !!(r.ok && data.ok && data.id);
        SamMessages.markSubmitted(msgSession, ok);
        const line = ok ? SamMessages.LINES.sent_short : SamMessages.LINES.send_failed;
        if (myTurn === turnNumber) speak(line, myTurn); else addLog("sam", line);
      } catch {
        SamMessages.markSubmitted(msgSession, false);
        if (myTurn === turnNumber) speak(SamMessages.LINES.send_failed, myTurn);
      } finally { messageBusy = false; }
    }
    return;
  }

  const nextSession = cloneState(session);
  const turn = await SamNLU.turn(nextSession, text, { slots: remoteSlots, signal });
  if (myTurn !== turnNumber || (signal && signal.aborted)) return;
  session = nextSession;
  turnController = null;
  speak(turn.reply, myTurn);
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

async function begin(greet = true) {
  if (started) return;
  started = true;
  enterBtn.classList.add("gone");
  desk.classList.add("live");
  armVideos();
  setMode("process");
  const openingTurn = turnNumber;
  if (!greet) { q.focus(); return; }
  SamNLU.greetingTurn(session);
  if (openingTurn !== turnNumber) return;
  const visitor = getVisitor();
  if (visitor && visitor.seen) {
    let line = "Welcome back — good to see you again.";
    const lb = visitor.lastBooking;
    if (lb && lb.iso && new Date(lb.iso).getTime() > Date.now()) {
      line += (lb.confirmed ? " Your appointment is for " : " You requested ") + lb.slotLabel + ". What can I help with?";
    }
    greetingTimer = setTimeout(() => speak(line, openingTurn), 50);
  } else {
    saveVisitor({ seen: true, lastBooking: (visitor && visitor.lastBooking) || null });
    greetingTimer = setTimeout(() => speak(GREETING, openingTurn), 50);
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

// One listening owner. New text, Stop, navigation and another turn cancel stale input.
let recording = null;
let recognition = null;
let listeningEpoch = 0;
let micPending = false;
function micState(active, label) {
  micBtn.classList.toggle("live", active);
  micBtn.textContent = active ? "Done" : "Talk";
  micBtn.setAttribute("aria-pressed", String(active));
  micBtn.setAttribute("aria-label", active ? "Finish speaking" : "Talk to Sam");
  if (label) setStatus(label);
}
function cancelListening() {
  listeningEpoch++;
  micPending = false;
  const previous = recognition; recognition = null;
  if (previous) { previous.onresult = null; previous.onerror = null; previous.onend = null; try { previous.abort(); } catch {} }
  const clip = recording; recording = null;
  if (clip) clip.cancel();
  micState(false);
}
function micHint(text) {
  if (hint) { hint.textContent = text; hint.classList.remove("hidden"); }
}
async function sttFallback(epoch) {
  if (epoch !== listeningEpoch) return;
  micPending = true;
  if (!window.SamSTT || !(await SamSTT.available())) {
    if (epoch !== listeningEpoch) return;
    micPending = false; setMode("idle");
    micHint("Voice input is unavailable here. Type below and I’ll help you.");
    q.focus(); return;
  }
  if (epoch !== listeningEpoch) return;
  let clip;
  try {
    micState(true, "Allow microphone access to speak");
    clip = SamSTT.record({ maxMs: 15000,
      onRecording: () => { if (epoch === listeningEpoch) { micPending = false; setMode("listen"); micHint("I’m listening. Tap Done when you’ve finished."); } },
      onTranscribing: () => { if (epoch === listeningEpoch) { micState(false); setMode("process"); setStatus("Transcribing…"); } },
    });
    recording = clip;
    const text = await clip;
    if (epoch !== listeningEpoch) return;
    recording = null; micPending = false; micState(false);
    if (text.trim()) receive(text.trim());
    else { setMode("idle"); micHint("I didn’t catch any speech. Try Talk again, or type below."); }
  } catch (error) {
    if (epoch !== listeningEpoch) return;
    setMode("idle");
    micHint(error.name === "NotAllowedError" ? "Microphone access is blocked. Allow it in your browser’s site settings, or type below." : "I couldn’t transcribe that. Try Talk again, or type below.");
  } finally {
    if (epoch === listeningEpoch) { recording = null; micPending = false; micState(false); }
  }
}
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
micBtn.setAttribute("aria-pressed", "false");
micBtn.addEventListener("click", () => {
  if (recording && mode !== "process") { recording.stop(); return; }
  if (recording) cancelListening();
  if (recognition) { try { recognition.stop(); } catch {} return; }
  if (micPending) { cancelListening(); setMode("idle"); return; }
  if (!started) begin(false);
  stopEverything("visitor_barge_in"); turnNumber++;
  const epoch = listeningEpoch;
  if (!Rec) { sttFallback(epoch); return; }
  const rec = new Rec(); recognition = rec; micPending = true;
  rec.lang = "en-US"; rec.interimResults = false;
  rec.onstart = () => { if (recognition !== rec || epoch !== listeningEpoch) return; micPending = false; micState(true); setMode("listen"); micHint("I’m listening. Tap Done when you’ve finished."); };
  rec.onresult = event => {
    if (recognition !== rec || epoch !== listeningEpoch) return;
    recognition = null; micPending = false; micState(false);
    receive(event.results[0][0].transcript);
  };
  rec.onerror = event => {
    if (recognition !== rec || epoch !== listeningEpoch) return;
    recognition = null; micPending = false; micState(false);
    if (["network", "service-not-allowed", "language-not-supported"].includes(event.error)) { sttFallback(epoch); return; }
    setMode("idle");
    micHint(event.error === "not-allowed" ? "Microphone access is blocked. Allow it in your browser’s site settings, or type below." : "I didn’t catch that. Try Talk again, or type below.");
  };
  rec.onend = () => { if (recognition !== rec) return; recognition = null; micPending = false; micState(false); if (mode === "listen") setMode("idle"); };
  try { rec.start(); } catch { recognition = null; sttFallback(epoch); }
});
q.addEventListener("input", () => { if (recognition || recording || micPending) { cancelListening(); setMode("listen"); } });

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
    phone: fd.get("phone"),
    company: fd.get("company"),
    pain: fd.get("pain"),
    slotIso: selected ? selected.iso : "",
    localConfirm,
  });
  if (ok) e.target.reset();
  btn.disabled = false;
});

if (depositBtn) depositBtn.addEventListener("click", async () => {
  if (!lastBooking || !depositConfig.enabled) return;
  depositBtn.disabled = true;
  depositStatus.textContent = "Opening secure Stripe checkout…";
  try {
    const r = await fetch("/api/deposit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(lastBooking),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.url) throw new Error("checkout");
    window.location.assign(data.url);
  } catch {
    depositStatus.textContent = lastBooking.confirmed ? "Checkout could not open. Your discovery appointment is still confirmed." : "Checkout could not open. Your discovery request is still saved and awaiting confirmation.";
    depositBtn.disabled = false;
  }
});

enterBtn.addEventListener("click", () => begin());
document.querySelectorAll("[data-prompt]").forEach(el => el.addEventListener("click", () => receive(el.dataset.prompt)));
document.getElementById("stopSam")?.addEventListener("click", () => { stopEverything("visitor_stop"); turnNumber++; setMode("idle"); });
window.addEventListener("pagehide", () => { stopEverything("pagehide"); turnNumber++; });
["vidIdle", "vidTalk", "vidListen", "vidProcess"].forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("loadeddata", armVideos);
  el.addEventListener("canplay", armVideos);
  el.addEventListener("error", () => {});
});

async function loadSlots() {
  slotsStatus = "loading";
  try {
    const r = await fetch("/api/slots", { signal: AbortSignal.timeout(20000) });
    const data = await r.json();
    if (!r.ok || !Array.isArray(data.slots)) throw new Error("slots_failed");
    remoteSlots = data.slots; slotsStatus = "ready";
  } catch { remoteSlots = []; slotsStatus = "error"; }
}
loadSlots();

fetch("/api/deposit")
  .then((r) => r.json())
  .then((d) => { depositConfig = d && d.enabled ? d : depositConfig; })
  .catch(() => {});

if (!reduceMotion) {
  vidIdle.addEventListener("canplay", () => {
    if (mode === "idle") { vidIdle.classList.add("on"); playVid(vidIdle); }
  }, { once: true });
}
