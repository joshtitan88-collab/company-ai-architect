const EMAIL = "joshua@hhinvestigations.com";
const said = document.getElementById("said");
const logEl = document.getElementById("log");
const q = document.getElementById("q");
const calEl = document.getElementById("calendar");
const cardsEl = document.getElementById("cards");
const bookEl = document.getElementById("bookbox");
const desk = document.getElementById("desk");
const micBtn = document.getElementById("mic");
let avail = null;
let selectedSlot = null;
let speaking = false;

const LINES = {
  hello: "I'm the desk for Company AI Architect. Thirty minutes, free. Tell me the shop and what is leaking hours, or ask me to put a discovery on the calendar.",
  capabilities: "We ingest how the shop actually runs, rank the work by hours back, and put a private stack on hardware you own. Not a ChatGPT login. Not a metered employee on your customers.",
  price: "Discovery is free. The written audit is one thousand five hundred. Architect plus a fourteen-day install starts at four thousand five hundred. You keep the map even if you stop after the audit.",
  privacy: "Customer files do not belong on this site. The discovery call does not need them. When we install, models stay on a tower, mini, or machine at your shop.",
  schedule: "Here are open discovery times in Eastern. The board shows openings only — not who is on the book. Pick a slot and I'll take your name.",
  none: "I can book a discovery, explain the five-stage audit, quote the packages, or talk privacy. Speak or type.",
};

function preferFemaleVoice() {
  const vs = speechSynthesis.getVoices();
  const rank = (v) => {
    const n = (v.name + v.lang).toLowerCase();
    let s = 0;
    if (v.lang.startsWith("en")) s += 4;
    if (/female|woman|samantha|victoria|karen|moira|zira|susan|fiona|aria|jenny|natural/.test(n)) s += 6;
    if (/google|premium|neural/.test(n)) s += 2;
    return s;
  };
  return vs.slice().sort((a, b) => rank(b) - rank(a))[0] || null;
}

function speak(text) {
  said.textContent = text;
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.96;
  u.pitch = 1.02;
  const v = preferFemaleVoice();
  if (v) u.voice = v;
  u.onstart = () => { speaking = true; desk.classList.add("talking"); };
  u.onend = () => { speaking = false; desk.classList.remove("talking"); };
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

function overlaps(a0, a1, b0, b1) {
  return a0 < b1 && b0 < a1;
}

function buildSlots(data) {
  const busy = (data.busy || []).map((b) => [Date.parse(b.start), Date.parse(b.end)]);
  const out = [];
  const end = new Date(data.rangeEnd + "T23:59:59-04:00");
  const now = Date.now();
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  for (let day = 0; day < 18; day++) {
    const cur = new Date(d.getTime() + day * 86400000);
    const wd = cur.getDay();
    if (!data.weekdays.includes(wd)) continue;
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const da = String(cur.getDate()).padStart(2, "0");
    for (let h = data.hours.start; h < data.hours.end; h++) {
      for (let min = 0; min < 60; min += data.slotMinutes) {
        const start = Date.parse(`${y}-${m}-${da}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00-04:00`);
        const stop = start + data.slotMinutes * 60000;
        if (start < now || start > end.getTime()) continue;
        if (busy.some(([b0, b1]) => overlaps(start, stop, b0, b1))) continue;
        out.push(start);
      }
    }
  }
  return out;
}

function fmtDay(ts) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(ts));
}
function fmtTime(ts) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(ts));
}

function renderCal(focusDay) {
  if (!avail) return;
  const slots = buildSlots(avail);
  const byDay = new Map();
  for (const t of slots) {
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(t));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(t);
  }
  const days = [...byDay.keys()];
  if (!days.length) {
    calEl.innerHTML = `<h3>Open discovery times</h3><p class="fine">No open weekday slots in this window. Type a time you want and I'll email Joshua to confirm.</p>`;
    calEl.classList.remove("hidden");
    return;
  }
  const day = focusDay && byDay.has(focusDay) ? focusDay : days[0];
  const chips = byDay.get(day).map((t) =>
    `<button type="button" class="slot${selectedSlot === t ? " on" : ""}" data-ts="${t}">${fmtTime(t)}</button>`
  ).join("");
  const dayBtns = days.map((k) => {
    const t = byDay.get(k)[0];
    return `<button type="button" class="cal-day${k === day ? " on" : ""}" data-day="${k}"><span class="d">${fmtDay(t).split(" ")[0]}</span><span class="n">${fmtDay(t).split(" ").slice(1).join(" ")}</span></button>`;
  }).join("");
  calEl.innerHTML = `<h3>Open discovery times · Eastern</h3>
    <div class="cal-days">${dayBtns}</div>
    <div class="slots">${chips}</div>
    <p class="fine">Openings only. No names. Thirty minutes. You keep the notes.</p>`;
  calEl.classList.remove("hidden");
  calEl.querySelectorAll(".cal-day").forEach((b) => b.addEventListener("click", () => renderCal(b.dataset.day)));
  calEl.querySelectorAll(".slot").forEach((b) => b.addEventListener("click", () => {
    selectedSlot = Number(b.dataset.ts);
    openBook();
  }));
}

function openBook() {
  hidePanels();
  bookEl.classList.remove("hidden");
  const when = selectedSlot ? `${fmtDay(selectedSlot)} at ${fmtTime(selectedSlot)} Eastern` : "a time we confirm";
  document.getElementById("slotLabel").textContent = when;
  speak("Give me your name, work email, and the shop. I'll send Joshua that slot. He confirms. This page does not write the calendar itself.");
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
  if (/what do you|capabilit|how it work|audit|pipeline|install|ai|agent/.test(s)) {
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
  rec.onresult = (e) => {
    const t = e.results[0][0].transcript;
    q.value = t;
    handle(t);
  };
  rec.onend = () => micBtn.classList.remove("live");
  micBtn.addEventListener("click", () => {
    try {
      rec.start();
      micBtn.classList.add("live");
    } catch (err) {
      addLog("desk", "Mic did not start in this browser. Type instead.");
    }
  });
} else {
  micBtn.addEventListener("click", () => {
    addLog("desk", "This browser has no speech recognition. Type and I'll still book.");
    q.focus();
  });
}

document.getElementById("bookForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const when = selectedSlot ? `${fmtDay(selectedSlot)} ${fmtTime(selectedSlot)} America/New_York` : "(no slot picked)";
  const body = [
    "Company AI Architect — discovery request from the desk",
    `requested_slot: ${when}`,
    `iso: ${selectedSlot ? new Date(selectedSlot).toISOString() : ""}`,
    ...[...fd.entries()].map(([k, v]) => `${k}: ${v}`),
  ].join("\n");
  const href = "mailto:" + EMAIL + "?subject=" + encodeURIComponent("Desk booking: discovery") + "&body=" + encodeURIComponent(body);
  window.location.href = href;
  speak("I opened your mail app with the slot. Joshua confirms. Nothing is stored on this site.");
});

fetch("./availability.json")
  .then((r) => r.json())
  .then((d) => { avail = d; })
  .catch(() => { avail = { timezone: "America/New_York", slotMinutes: 30, hours: { start: 9, end: 17 }, weekdays: [1,2,3,4,5], rangeEnd: "2026-09-12", busy: [] }; });

speechSynthesis.onvoiceschanged = () => {};
window.addEventListener("load", () => {
  setTimeout(() => speak(LINES.hello), 400);
});
