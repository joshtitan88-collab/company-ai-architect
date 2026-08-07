/* Company AI Architect — marketing interactions */
(function () {
  const notes = [
    "Ingesting systems, pain points, and goals…",
    "Modeling departments, processes, and data constraints…",
    "Ranking opportunities by impact, effort, and hours saved…",
    "Designing buy / integrate / custom-local stack…",
    "Emitting audit PDF, one-pager, and private AI package…",
  ];
  const stages = Array.from(document.querySelectorAll(".stage"));
  const bar = document.getElementById("progressBar");
  const note = document.getElementById("stageNote");
  const scoreEl = document.getElementById("gaugeScore");
  const arc = document.getElementById("gaugeArc");
  let i = 0;

  function setStage(idx) {
    stages.forEach((el, n) => {
      el.classList.toggle("active", n === idx);
      el.classList.toggle("done", n < idx);
    });
    if (bar) bar.style.width = `${((idx + 1) / stages.length) * 100}%`;
    if (note) note.textContent = notes[idx] || notes[0];
  }

  setInterval(() => {
    i = (i + 1) % stages.length;
    setStage(i);
  }, 2200);

  // Count-up readiness gauge
  const target = 70;
  const circumference = 2 * Math.PI * 42;
  if (arc) {
    arc.style.strokeDasharray = String(circumference);
    arc.style.strokeDashoffset = String(circumference);
  }
  let shown = 0;
  const tick = setInterval(() => {
    shown += 2;
    if (shown >= target) {
      shown = target;
      clearInterval(tick);
    }
    if (scoreEl) scoreEl.textContent = String(shown);
    if (arc) {
      const offset = circumference * (1 - shown / 100);
      arc.style.strokeDashoffset = String(offset);
    }
  }, 30);

  // Particles
  const canvas = document.getElementById("particles");
  if (canvas && canvas.getContext) {
    const ctx = canvas.getContext("2d");
    let w = 0, h = 0, dots = [];
    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      const n = Math.min(70, Math.floor((w * h) / 22000));
      dots = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.6 + 0.4,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        a: Math.random() * 0.45 + 0.15,
      }));
    }
    function frame() {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.x += d.vx;
        d.y += d.vy;
        if (d.x < 0) d.x = w;
        if (d.x > w) d.x = 0;
        if (d.y < 0) d.y = h;
        if (d.y > h) d.y = 0;
        ctx.beginPath();
        ctx.fillStyle = `rgba(120, 180, 255, ${d.a})`;
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(frame);
    }
    window.addEventListener("resize", resize);
    resize();
    frame();
  }

  // Book form → mailto with structured body
  const form = document.getElementById("bookForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const name = (fd.get("name") || "").toString().trim();
      const email = (fd.get("email") || "").toString().trim();
      const company = (fd.get("company") || "").toString().trim();
      const body = (fd.get("body") || "").toString().trim();
      const text = [
        `Name: ${name}`,
        `Email: ${email}`,
        `Company: ${company}`,
        "",
        "What AI should take off our plate:",
        body,
      ].join("\n");
      const subject = encodeURIComponent("Company AI Architect — Discovery Call");
      const mailBody = encodeURIComponent(text);
      window.location.href = `mailto:joshua@hhinvestigations.com?subject=${subject}&body=${mailBody}`;
    });
  }

  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());
})();
