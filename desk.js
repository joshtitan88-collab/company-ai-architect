const said = document.getElementById("said");
const logEl = document.getElementById("log");
const q = document.getElementById("q");
const calEl = document.getElementById("calendar");
const cardsEl = document.getElementById("cards");
const bookEl = document.getElementById("bookbox");
const desk = document.getElementById("desk");
const micBtn = document.getElementById("mic");
const hint = document.querySelector(".desk-ui .hint");
let remoteSlots = [];
let selected = null;

const LINES = {
  hello: "I'm the desk for Company AI Architect. Thirty minutes, free. Tell me the shop and what is leaking hours, or ask me to put a discovery on the calendar.",
  capabilities: "We ingest how the shop actually runs, rank the work by hours back, and put a private stack on hardware you own. Not a ChatGPT login. Not a metered employee on your customers.",
  price: "Discovery is free. The written audit is one thousand five hundred. Architect plus a fourteen-day install starts at four thousand five hundred. You keep the map even if you stop after the audit.",
  privacy: "Customer files do not belong on this site. The discovery call does not need them. When we install, models stay on a tower, mini, or machine at your shop.",
  schedule: "Here are open discovery times in Eastern. Openings only — not who is on the book. Pick a slot.",
  none: "I can book a discovery, explain the five-stage audit, quote the packages, or talk privacy. Speak or type.",
};

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

function speak(text) {
  said.textContent = text;
  if (hint) hint.classList.add("hidden");
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.96;
  u.pitch = 1.02;
  const v = preferFemaleVoice();
  if (v) u.voice = v;
  u.onstart = () => desk.classList.add("talking");
  u.onend = () => desk.classList.remove("talking");
  speechSynthesis.speak(u);
}

function addLog(who, text) {
  const d = document.createElement("div");
  d.className = who;
  d.textContent = (who === "you" ? "You: " : "Desk: ") + text;
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
  speak("Name, work email, shop. I send the slot to Joshua. He confirms. This board never shows who is booked.");
}

function handle(text) {
  const t = text.trim();
  if (!t) return;
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
  if (/privacy|data|chatgpt|leak|hipaa|pii/.test(s)) {
    speak(LINES.privacy);
    return;
  }
  if (/what do you|capabilit|how it work|pipeline|install|ai|agent/.test(s)) {
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

document.getElementById("send").addEventListener("click", () => {
  handle(q.value);
  q.value = "";
});
q.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); handle(q.value); q.value = ""; }
});

const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Rec) {
  const rec = new Rec();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.onresult = (e) => handle(e.results[0][0].transcript);
  rec.onend = () => micBtn.classList.remove("live");
  micBtn.addEventListener("click", () => {
    try { rec.start(); micBtn.classList.add("live"); }
    catch { addLog("desk", "Mic did not start. Type instead."); q.focus(); }
  });
} else {
  micBtn.addEventListener("click", () => {
    addLog("desk", "This browser has no speech recognition. Type and I'll still book.");
    q.focus();
  });
}

document.getElementById("bookForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    name: fd.get("name"),
    email: fd.get("email"),
    company: fd.get("company"),
    pain: fd.get("pain"),
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
    if (!r.ok || !data.ok) throw new Error(data.error || "book_failed");
    speak("Request is in. Joshua confirms the time by email. Nothing else is stored on this page.");
    addLog("desk", "Booking sent.");
    hidePanels();
    e.target.reset();
    selected = null;
  } catch (err) {
    speak("The desk could not file that slot. Try again, or write joshua@hhinvestigations.com.");
    addLog("desk", "Booking failed.");
  } finally {
    btn.disabled = false;
  }
});

fetch("/api/slots")
  .then((r) => r.json())
  .then((d) => { remoteSlots = d.slots || []; })
  .catch(() => { remoteSlots = []; });

speechSynthesis.onvoiceschanged = () => {};
window.addEventListener("load", () => { setTimeout(() => speak(LINES.hello), 400); });
