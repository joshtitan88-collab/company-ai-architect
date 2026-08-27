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

const LINES = {
  hello: "Hello, welcome to Company AI Architect. I am Sam, nice to meet you, and who do I have the pleasure of helping today?",
  capabilities: "You're already inside the product. Same idea on a tower or mini at your shop: calls, jobs, notes, on hardware you own. Not a ChatGPT login. Discovery is free. Want the calendar?",
  price: "Discovery is free. The written audit is one thousand five hundred. Architect plus a fourteen-day install starts at four thousand five hundred. You keep the map even if you stop after the audit.",
  privacy: "Customer files do not belong on this site. The discovery call does not need them. When we install, models stay on a tower, mini, or machine at your shop.",
  schedule: "Here are open discovery times in Eastern. Openings only — not who is on the book. Pick a slot.",
  leak: "That's the leak. I catch it before it becomes a voicemail. Pick a free thirty minutes. I'll put it on the book.",
  none: "I can book a discovery, quote the packages, or talk privacy. Thirty minutes. Free.",
};
const CLIPS = { [LINES.hello]: "./assets/sam-hello.mp4" };
let mode = "idle";
let processTimer = 0;

function preferFemaleVoice() {
  const vs = speechSynthesis.getVoices();
  const rank = (v) => {
    const n = (v.name + " " + v.lang).toLowerCase();
    let s = 0;
    if (v.lang.startsWith("en")) s += 4;
    if (/female|woman|samantha|victoria|karen|moira|zira|susan|fiona|jenny|natural/.test(n)) s += 6;
    if (/google|premium|neural/.test(n)) s += 2;
    return s;
  };
  return vs.slice().sort((a, b) => rank(b) - rank(a))[0] || null;
}

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
    if (el === active) playVid(el, k === "talk");
    else { el.pause(); }
  });
}

function speak(text) {
  said.textContent = text;
  if (hint) hint.classList.add("hidden");
  const clip = CLIPS[text];
  if (clip && vidTalk) {
    const src = vidTalk.querySelector("source");
    if (src && !vidTalk.src.endsWith("sam-hello.mp4") && clip.indexOf("sam-hello") >= 0) {
      vidTalk.src = clip;
    }
    vidTalk.onended = () => { vidTalk.onended = null; setMode("idle"); };
    setMode("talk");
    return;
  }
  setMode("talk");
  setTimeout(() => { if (mode === "talk") setMode("idle"); }, Math.min(8000, 70 * text.length));
}

function receive(text) {
  const t = (text || "").trim();
  if (!t) return;
  if (!started) begin();
  addLog("you", t);
  setMode("process");
  clearTimeout(processTimer);
  processTimer = setTimeout(() => handle(t), 800);
}

function addLog(who, text) {
  const d = document.createElement("div");
  d.className = who;
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
  cardsEl.innerHTML = `<h3>${title}</h3>` + items.map((it) => `<article><strong>${it.t}</strong> ${it.b}</article>`).join("");
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
    const t = s.start;
    const k = dayKey(t);
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
    openBook();
  }));
}

function openBook() {
  hidePanels();
  bookEl.classList.remove("hidden");
  const when = selected ? `${fmtDay(selected.start)} at ${fmtTime(selected.start)} Eastern` : "a time we confirm";
  document.getElementById("slotLabel").textContent = when;
  speak("Name, work email, shop. I take the slot. This board never shows who is booked.");
}

function handle(text) {
  const t = text.trim();
  if (!t) return;
  if (!started) begin();
  addLog("you", t);
  const s = t.toLowerCase();
  hidePanels();
  if (/book|schedul|calendar|avail|slot|consult|discovery|call|appoint/.test(s)) {
    speak(LINES.schedule);
    renderCal();
    return;
  }
  if (/price|cost|how much|\$|package|audit|4500|1500/.test(s)) {
    speak(LINES.price);
    showCards("Packages", [
      { t: "Discovery · Free", b: "30 minutes. Fit check. You keep the notes." },
      { t: "AI Opportunity Audit · $1,500", b: "One company, about a week. PDF, one-pager, ranked hours, 90-day plan." },
      { t: "Architect + 14-day install · $4,500+", b: "Private package on hardware you own. Ride-along on real jobs." },
    ]);
    return;
  }
  if (/privacy|data|chatgpt|leak|hipaa|pii/.test(s) && !/hours|dispatch|missed/.test(s)) {
    speak(LINES.privacy);
    return;
  }
  if (/shop|hvac|plumb|dispatch|hours|job|customer|missed|voicemail|front desk|reception|after.?hours/.test(s)) {
    speak(LINES.leak);
    renderCal();
    return;
  }
  if (/what do you|capabilit|how it work|pipeline|install|ai|agent|what is this|who are you|product|demo/.test(s)) {
    speak(LINES.capabilities);
    showCards("Five stages", [
      { t: "01 Ingest", b: "How the shop actually runs." },
      { t: "02 Model", b: "Where notes live and where they leak." },
      { t: "03 Rank", b: "Hours back, effort, hardware you own." },
      { t: "04 Design", b: "Buy, integrate, or private local." },
      { t: "05 Package", b: "You keep the map and the bundle." },
    ]);
    return;
  }
  speak(LINES.none);
}

function begin() {
  if (started) return;
  started = true;
  enterBtn.classList.add("gone");
  desk.classList.add("live");
  armVideos();
  setMode("process");
  setTimeout(() => speak(LINES.hello), 600);
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

const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Rec) {
  const rec = new Rec();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.onresult = (e) => receive(e.results[0][0].transcript);
  rec.onstart = () => { micBtn.classList.add("live"); setMode("listen"); };
  rec.onend = () => { micBtn.classList.remove("live"); if (mode === "listen") setMode("process"); };
  micBtn.addEventListener("click", () => {
    if (!started) begin();
    try { rec.start(); }
    catch { addLog("desk", "Mic did not start. Type instead."); q.focus(); }
  });
} else {
  micBtn.addEventListener("click", () => {
    if (!started) begin();
    addLog("desk", "This browser has no speech recognition. Type and I'll still book.");
    q.focus();
  });
}

document.getElementById("bookForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  const localConfirm = selected
    ? new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(selected.start))
    : "";
  let idem = sessionStorage.getItem("caa_idem");
  if (!idem) { idem = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()); sessionStorage.setItem("caa_idem", idem); }
  if (!sessionStorage.getItem("caa_sid")) sessionStorage.setItem("caa_sid", (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()));
  const payload = {
    idempotency_key: idem + (selected ? ":" + selected.iso : ""),
    name: fd.get("name"),
    email: fd.get("email"),
    company: fd.get("company") || undefined,
    phone: fd.get("phone") || undefined,
    appointment: {
      start_utc: selected ? selected.iso : "",
      timezone: tz,
      local_confirm: localConfirm,
    },
    summary: fd.get("pain"),
    interest_level: "Medium",
    highlights: [],
    visitor_timezone_confirmed: true,
    raw_session_id: sessionStorage.getItem("caa_sid") || "",
    slotIso: selected ? selected.iso : "",
  };
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    const r = await fetch("/api/book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 409 && data.error === "slot_taken") {
      speak("That time just filled. I can show what's still open.");
      renderCal();
      return;
    }
    if (r.status === 503 || data.error === "calendar_unavailable" || data.error === "intake_failed" || r.status === 502) {
      speak("I've noted your interest, and someone will follow up within a few hours.");
      return;
    }
    if (!r.ok || !data.ok) throw new Error(data.error || "book_failed");
    if (data.duplicate) {
      speak("You're already on the book for that time.");
      return;
    }
    setMode("process");
    setTimeout(() => speak("You're set. You'll get a confirmation shortly. I'm glad we found a time."), 700);
    addLog("desk", "Booked.");
    hidePanels();
    e.target.reset();
    selected = null;
  } catch (err) {
    speak("I could not file that slot. Try again.");
    addLog("desk", "Booking failed.");
  } finally {
    btn.disabled = false;
  }
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

speechSynthesis.onvoiceschanged = () => {};
if (!reduceMotion) {
  vidIdle.addEventListener("canplay", () => playVid(vidIdle), { once: true });
}
