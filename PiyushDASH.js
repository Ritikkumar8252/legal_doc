
/* ============================================================
   LexAI Dashboard — script.js
   ============================================================ */

/* ── Config ── */
const SAFETY_SCORE  = 54;   // out of 100
const VERDICT_SCORE = 65;   // out of 100 (risk score)

const RISK_BARS = {
  high : { id: 'rb-h', pct: 80 },
  med  : { id: 'rb-m', pct: 40 },
  low  : { id: 'rb-l', pct: 10 },
};

/* ── Run on DOM ready ── */
document.addEventListener('DOMContentLoaded', () => {
  drawGauge(SAFETY_SCORE);
  animateGaugeNumber('gauge-num', SAFETY_SCORE);
  animateScoreRing('score-arc', 'score-num', VERDICT_SCORE, 169.6);
  animateRiskBars();
});

/* ============================================================
   1. HALF-CIRCLE GAUGE (Canvas)
   ============================================================ */
function drawGauge(score) {
  const canvas = document.getElementById('gauge');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const cx = 70, cy = 70, radius = 50;

  ctx.clearRect(0, 0, 140, 140);

  /* Background arc */
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, 0, false);
  ctx.strokeStyle = '#222228';
  ctx.lineWidth   = 10;
  ctx.lineCap     = 'round';
  ctx.stroke();

  /* Coloured value arc */
  const fillAngle = Math.PI + (Math.min(score, 100) / 100) * Math.PI;
  const colour    = gaugeColour(score);

  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, fillAngle, false);
  ctx.strokeStyle = colour;
  ctx.lineWidth   = 10;
  ctx.lineCap     = 'round';
  ctx.stroke();
}

/* Choose gauge colour based on score */
function gaugeColour(score) {
  if (score >= 70) return '#22c55e';  /* green  — safe */
  if (score >= 40) return '#f59e0b';  /* amber  — caution */
  return '#ef4444';                   /* red    — danger */
}

/* ============================================================
   2. ANIMATED NUMBER COUNTER
   ============================================================ */
function animateCount(element, from, to, durationMs) {
  const startTime = performance.now();

  function tick(now) {
    const elapsed  = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    const eased    = easeOutCubic(progress);
    element.textContent = Math.round(from + (to - from) * eased);

    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

function animateGaugeNumber(elementId, targetScore) {
  const el = document.getElementById(elementId);
  if (el) animateCount(el, 0, targetScore, 1200);
}

/* ============================================================
   3. SVG SCORE RING ANIMATION
   ============================================================ */
function animateScoreRing(arcId, numId, score, circumference) {
  const arc    = document.getElementById(arcId);
  const numEl  = document.getElementById(numId);
  if (!arc || !numEl) return;

  const targetOffset = circumference - (score / 100) * circumference;

  /* Animate the number */
  animateCount(numEl, 0, score, 1200);

  /* Animate the ring stroke with a CSS transition */
  arc.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1)';
  requestAnimationFrame(() => {
    arc.style.strokeDashoffset = targetOffset;
  });
}

/* ============================================================
   4. RISK BREAKDOWN BAR ANIMATION
   ============================================================ */
function animateRiskBars() {
  /* Short delay so the page has painted first */
  setTimeout(() => {
    Object.values(RISK_BARS).forEach(({ id, pct }) => {
      const el = document.getElementById(id);
      if (el) el.style.width = pct + '%';
    });
  }, 300);
}

/* ============================================================
   5. EASING HELPER
   ============================================================ */
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}
