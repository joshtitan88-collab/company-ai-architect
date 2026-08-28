const story = document.querySelector(".story");
const img = document.querySelector(".stage-img");
const path = document.querySelector(".filament path");
const beats = [...document.querySelectorAll(".beat")];
const cursor = document.querySelector(".cursor");
const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());
const length = path ? path.getTotalLength() : 1800;
if (path) {
  path.style.strokeDasharray = String(length);
  path.style.strokeDashoffset = String(length);
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function tick() {
  if (!story) return;
  const rect = story.getBoundingClientRect();
  const total = story.offsetHeight - window.innerHeight;
  const p = clamp(-rect.top / total, 0, 1);
  if (img) {
    const scale = 1 + p * 0.18;
    img.style.transform = `scale(${scale}) translate3d(0, ${p * -4}%, 0)`;
    img.style.filter = `saturate(${1 + p * 0.15}) contrast(${1.02 + p * 0.08})`;
  }
  if (path) path.style.strokeDashoffset = String(length * (1 - p));
  const i = p < 0.33 ? 0 : p < 0.66 ? 1 : 2;
  beats.forEach((b, n) => b.classList.toggle("on", n === i));
}

window.addEventListener("scroll", () => requestAnimationFrame(tick), { passive: true });
window.addEventListener("resize", tick);
tick();

window.addEventListener("mousemove", (e) => {
  if (!cursor) return;
  cursor.style.opacity = "1";
  cursor.style.left = e.clientX + "px";
  cursor.style.top = e.clientY + "px";
});
document.querySelectorAll("a, button, input, textarea").forEach((el) => {
  el.addEventListener("mouseenter", () => { if (cursor) cursor.style.transform = "translate(-50%,-50%) scale(1.8)"; });
  el.addEventListener("mouseleave", () => { if (cursor) cursor.style.transform = "translate(-50%,-50%) scale(1)"; });
});
