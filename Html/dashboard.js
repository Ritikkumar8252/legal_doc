document.addEventListener("DOMContentLoaded", () => {
  setupActions();
  loadDashboard();
  loadHistory();
});

async function loadDashboard() {
  const localReport = readLocalReport();

  if (localReport) {
    renderDashboard(localReport);
  }

  try {
    const report = await fetchReport();
    renderDashboard(report);
    localStorage.setItem("latestLegalSummary", JSON.stringify(toLocalReport(report)));
  } catch (err) {
    if (!localReport) {
      renderEmptyDashboard(err.message || "No analyzed document found.");
    }
    console.warn("Dashboard load error:", err);
  }
}

async function fetchReport() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const url = id ? `/history/${encodeURIComponent(id)}` : "/history/latest";
  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Unable to load dashboard data.");
  }

  return data;
}

function readLocalReport() {
  const stored = localStorage.getItem("latestLegalSummary");
  if (!stored) return null;

  try {
    return JSON.parse(stored);
  } catch (err) {
    localStorage.removeItem("latestLegalSummary");
    return null;
  }
}

function toLocalReport(report) {
  return {
    id: report.id,
    filename: report.filename,
    content: report.content,
    created_at: report.created_at,
    summary: normalizeSummary(report)
  };
}

function normalizeSummary(report) {
  const summary = report.summary || report.analysis || {};

  if (typeof summary === "string") {
    return {
      document_title: report.filename || "Document Analysis",
      document_type: "Legal Document",
      overview: summary,
      plain_language_summary: summary,
      top_takeaways: [],
      key_clauses: [],
      risks: [{
        level: "Medium",
        title: "Only Basic Analysis Available",
        explanation: "This saved report has no structured risk details.",
        what_to_do: "Rerun the analysis to get a complete dashboard."
      }],
      dates: [],
      risk_score: 60,
      clarity_score: 70,
      contract_duration: "N/A",
      duration_note: "Not specified",
      suggestions: [],
      action_items: [],
      questions_to_ask: [],
      final_advice: "Review the full analysis before signing.",
      confidence_note: ""
    };
  }

  const risks = Array.isArray(summary.risks) ? summary.risks : [];
  const riskCounts = countRisks(risks);

  return {
    document_title: summary.document_title || report.filename || "Document Analysis",
    document_type: summary.document_type || "Legal Document",
    overview: summary.overview || "No overview returned.",
    plain_language_summary: summary.plain_language_summary || summary.eli15_summary || summary.overview || "",
    top_takeaways: asList(summary.top_takeaways),
    key_clauses: Array.isArray(summary.key_clauses) ? summary.key_clauses : legacyClauses(summary),
    risks,
    dates: Array.isArray(summary.dates) ? summary.dates : [],
    risk_score: numberOr(summary.risk_score, estimateSafetyScore(riskCounts)),
    clarity_score: numberOr(summary.clarity_score, 70),
    contract_duration: summary.contract_duration || "N/A",
    duration_note: summary.duration_note || "Not specified",
    suggestions: asList(summary.suggestions),
    action_items: asList(summary.action_items),
    questions_to_ask: asList(summary.questions_to_ask),
    final_advice: summary.final_advice || "Review the document carefully before signing.",
    confidence_note: summary.confidence_note || "",
    risk_counts: summary.risk_counts || riskCounts,
    stats: summary.stats || {}
  };
}

function renderDashboard(report) {
  const summary = normalizeSummary(report);
  const filename = report.filename || "Uploaded document";
  const content = report.content || "";
  const risks = sortRisks(summary.risks);
  const clauses = summary.key_clauses;
  const counts = summary.risk_counts || countRisks(risks);
  const stats = summary.stats || {};
  const safetyScore = clampScore(summary.risk_score);
  const verdict = getVerdict(safetyScore, counts);

  setText("tb-docname", filename);
  setText("d-title", summary.document_title || filename);
  setText("d-time", formatDate(report.created_at));
  setText("d-words", countWords(content).toLocaleString());
  setText("d-type", summary.document_type);

  setText("m-clauses", String(stats.key_clauses_found ?? clauses.length));
  setText("m-risks", String(stats.risk_alerts ?? risks.length));
  setText("m-risks-sub", stats.risk_summary || `${counts.high} high | ${counts.medium} medium | ${counts.low} low`);
  setText("m-clarity", `${summary.clarity_score}/100`);
  setText("m-clarity-sub", clarityLabel(summary.clarity_score));
  setText("m-duration", compactDuration(stats.contract_duration || summary.contract_duration));
  setText("m-duration-sub", stats.duration_note || summary.duration_note);

  renderVerdict(verdict, safetyScore);
  setText("ai-summary", summary.overview || summary.plain_language_summary);
  renderTakeaways(summary);
  renderRiskClauses(risks);
  renderKeyClauses(clauses);
  renderGauge(safetyScore, counts);
  renderRiskAlerts(risks);
  renderActions(summary);
  renderQuestions(summary.questions_to_ask);
}

function renderVerdict(verdict, score) {
  setText("v-icon", verdict.icon);
  setText("v-label", `Verdict - ${verdict.label}`);
  setText("v-title", verdict.title);
  setText("v-sub", verdict.sub);

  const arc = document.getElementById("score-arc");
  const circumference = 175.9;
  const offset = circumference - (score / 100) * circumference;

  if (arc) {
    arc.style.stroke = scoreColor(score);
    arc.style.transition = "stroke-dashoffset 1.2s ease";
    window.requestAnimationFrame(() => {
      arc.style.strokeDashoffset = offset;
    });
  }

  animateCount(document.getElementById("score-num"), 0, score, 900);
}

function renderTakeaways(summary) {
  const container = document.getElementById("takeaway-list");
  if (!container) return;

  container.innerHTML = "";
  const items = summary.top_takeaways.length
    ? summary.top_takeaways
    : [summary.plain_language_summary || summary.final_advice].filter(Boolean);

  items.slice(0, 3).forEach((takeaway) => {
    const item = document.createElement("div");
    item.className = "takeaway-item";
    item.textContent = takeaway;
    container.appendChild(item);
  });
}

function renderRiskClauses(risks) {
  const container = document.getElementById("clause-list");
  if (!container) return;

  container.innerHTML = "";

  if (!risks.length) {
    container.appendChild(emptyState("No risk clauses found."));
    return;
  }

  risks.forEach((risk) => {
    const level = levelName(risk.level);
    const score = riskScore(risk);
    const color = level === "HIGH" ? "var(--red)" : level === "MEDIUM" ? "var(--amber)" : "var(--green)";
    const card = document.createElement("div");
    card.className = "clause-card";

    const top = document.createElement("div");
    top.className = "clause-top";

    const badge = document.createElement("span");
    badge.className = `risk-badge risk-${level}`;
    badge.textContent = level;

    const name = document.createElement("span");
    name.className = "clause-name";
    name.textContent = risk.title || risk.name || "Risk";

    const scoreNode = document.createElement("span");
    scoreNode.className = "clause-score";
    scoreNode.textContent = `${score}/100`;

    const barWrap = document.createElement("div");
    barWrap.className = "clause-bar-wrap";

    const bar = document.createElement("div");
    bar.className = "clause-bar";
    bar.style.background = color;
    bar.style.width = `${score}%`;
    barWrap.appendChild(bar);

    const desc = document.createElement("div");
    desc.className = "clause-desc";
    desc.textContent = risk.what_to_do
      ? `${risk.explanation || risk.desc || "No explanation returned."} Next: ${risk.what_to_do}`
      : risk.explanation || risk.desc || "No explanation returned.";

    top.append(badge, name, scoreNode);
    card.append(top, barWrap, desc);

    if (risk.tag || risk.title) {
      const tag = document.createElement("span");
      tag.className = "clause-tag";
      tag.textContent = `-> ${risk.tag || slugText(risk.title)}`;
      card.appendChild(tag);
    }

    container.appendChild(card);
  });
}

function renderKeyClauses(clauses) {
  const container = document.getElementById("key-clause-list");
  if (!container) return;

  container.innerHTML = "";

  if (!clauses.length) {
    container.appendChild(emptyState("No key clauses found."));
    return;
  }

  clauses.slice(0, 8).forEach((clause) => {
    const item = document.createElement("div");
    item.className = "key-clause-item";

    const type = document.createElement("span");
    type.className = "kc-type";
    type.textContent = clause.title || clause.type || "Clause";

    const text = document.createElement("span");
    text.className = "kc-text";
    text.textContent = clauseText(clause);

    const value = document.createElement("span");
    value.className = "kc-value";
    value.textContent = clause.value || "";

    item.append(type, text, value);
    container.appendChild(item);
  });
}

function renderGauge(score, counts) {
  setText("gauge-num", String(score));
  drawGauge(score);

  const total = Math.max(1, counts.high, counts.medium, counts.low);
  setText("rbc-high", String(counts.high));
  setText("rbc-med", String(counts.medium));
  setText("rbc-low", String(counts.low));
  setWidth("rb-high", counts.high / total * 100);
  setWidth("rb-med", counts.medium / total * 100);
  setWidth("rb-low", counts.low / total * 100);
}

function renderRiskAlerts(risks) {
  const container = document.getElementById("risk-alerts");
  if (!container) return;

  container.innerHTML = "";

  if (!risks.length) {
    container.appendChild(emptyState("No risk alerts found."));
    return;
  }

  risks.slice(0, 3).forEach((risk) => {
    const level = levelName(risk.level);
    const card = document.createElement("div");
    card.className = `alert-card ${level === "MEDIUM" ? "medium" : level === "LOW" ? "low" : ""}`;

    const title = document.createElement("div");
    title.className = "alert-title";

    const name = document.createElement("span");
    name.textContent = risk.title || risk.name || "Risk";

    const badge = document.createElement("span");
    badge.className = `risk-badge risk-${level}`;
    badge.textContent = level;

    const desc = document.createElement("div");
    desc.className = "alert-desc";
    desc.textContent = risk.explanation || risk.desc || "No explanation returned.";

    title.append(name, badge);
    card.append(title, desc);
    container.appendChild(card);
  });
}

function renderActions(summary) {
  const container = document.getElementById("action-list");
  if (!container) return;

  container.innerHTML = "";
  const actions = summary.action_items.length ? summary.action_items : summary.suggestions;
  const items = actions.length ? actions : [summary.final_advice || "Review the document carefully before signing."];

  items.slice(0, 5).forEach((action, index) => {
    const item = document.createElement("div");
    item.className = "action-item";

    const num = document.createElement("span");
    num.className = "action-num";
    num.textContent = String(index + 1);

    const text = document.createElement("span");
    text.textContent = action;

    item.append(num, text);
    container.appendChild(item);
  });
}

function renderQuestions(questions) {
  const container = document.getElementById("question-list");
  if (!container) return;

  container.innerHTML = "";
  const items = questions.length ? questions : ["Ask the other party to clarify any section marked Not specified."];

  items.slice(0, 4).forEach((question) => {
    const item = document.createElement("div");
    item.className = "question-item";
    item.textContent = question;
    container.appendChild(item);
  });
}

function drawGauge(score) {
  const canvas = document.getElementById("gauge-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const cx = 70;
  const cy = 70;
  const radius = 50;

  ctx.clearRect(0, 0, 140, 140);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, 0, false);
  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, Math.PI + (score / 100) * Math.PI, false);
  ctx.strokeStyle = score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444";
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.stroke();
}

function renderEmptyDashboard(message) {
  setText("tb-docname", "No report");
  setText("d-title", "No Analysis Yet");
  setText("v-title", "Upload a document first");
  setText("v-sub", message);
  setText("ai-summary", message);
  renderGauge(0, { high: 0, medium: 0, low: 0 });
}

function setupActions() {
  document.getElementById("new-analysis-btn")?.addEventListener("click", () => {
    window.location.href = "/app.html";
  });

  document.querySelector(".upload-btn")?.addEventListener("click", () => {
    window.location.href = "/app.html";
  });
}

function legacyClauses(summary) {
  const sections = [
    ["Payment", "PAYMENT", summary.payment],
    ["Work Scope", "SCOPE", summary.work_scope],
    ["Ownership", "IP", summary.ownership],
    ["Deadlines", "DEADLINE", summary.deadlines],
    ["Ending Terms", "TERMINATION", summary.ending_terms],
  ];

  return sections
    .filter(([, , section]) => section && (section.summary || section.risk))
    .map(([title, type, section]) => ({
      type,
      title,
      description: section.summary || "Not specified.",
      value: section.risk || ""
    }));
}

function getVerdict(score, counts) {
  if (counts.high > 0 || score < 45) {
    return {
      label: "NEGOTIATE FIRST",
      title: "Review before signing",
      sub: "This document has risk areas that should be clarified or negotiated.",
      icon: "!"
    };
  }

  if (counts.medium > 1 || score < 75) {
    return {
      label: "CHECK CAREFULLY",
      title: "Mostly workable, but review",
      sub: "There are a few terms worth checking before you agree.",
      icon: "?"
    };
  }

  return {
    label: "LOW RISK",
    title: "Looks safer to proceed",
    sub: "No major risk alerts were found, but still read the final terms.",
    icon: "OK"
  };
}

function countRisks(risks) {
  return risks.reduce((counts, risk) => {
    const level = levelName(risk.level);
    if (level === "HIGH") counts.high += 1;
    else if (level === "LOW") counts.low += 1;
    else counts.medium += 1;
    return counts;
  }, { high: 0, medium: 0, low: 0 });
}

function estimateSafetyScore(counts) {
  const penalty = counts.high * 22 + counts.medium * 12 + counts.low * 5;
  return Math.max(0, Math.min(100, 100 - penalty));
}

function riskScore(risk) {
  if (Number.isFinite(Number(risk.score))) return clampScore(Number(risk.score));
  const level = levelName(risk.level);
  if (level === "HIGH") return 85;
  if (level === "MEDIUM") return 60;
  return 30;
}

function sortRisks(risks) {
  const order = { HIGH: 1, MEDIUM: 2, LOW: 3 };
  return [...risks].sort((a, b) => (order[levelName(a.level)] || 9) - (order[levelName(b.level)] || 9));
}

function levelName(value) {
  const level = String(value || "Medium").toUpperCase();
  if (level.startsWith("H")) return "HIGH";
  if (level.startsWith("L")) return "LOW";
  return "MEDIUM";
}

function clauseText(clause) {
  const parts = [clause.description || clause.text];
  if (clause.why_it_matters) parts.push(`Why it matters: ${clause.why_it_matters}`);
  if (clause.action) parts.push(`Check: ${clause.action}`);
  return parts.filter(Boolean).join(" ");
}

function clarityLabel(score) {
  const value = Number(score);
  if (value >= 75) return "Easy to understand";
  if (value >= 50) return "Moderate";
  return "Complex";
}

function compactDuration(value) {
  const text = String(value || "N/A");
  return text.length > 16 ? `${text.slice(0, 15)}...` : text;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function countWords(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function formatDate(value) {
  if (!value) return new Date().toLocaleString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function setWidth(id, value) {
  const node = document.getElementById(id);
  if (node) node.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

function emptyState(text) {
  const node = document.createElement("p");
  node.className = "empty-state";
  node.textContent = text;
  return node;
}

function slugText(value) {
  return String(value || "risk").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function scoreColor(score) {
  if (score >= 70) return "var(--teal)";
  if (score >= 40) return "var(--amber)";
  return "var(--red)";
}

function animateCount(el, from, to, duration) {
  if (!el) return;
  const start = performance.now();

  function update(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}
async function loadHistory() {
  try {
    const res = await fetch("/history");
    const history = await res.json();

    if (res.ok && Array.isArray(history)) {
      renderHistory(history);
    }
  } catch (err) {
    console.warn("History unavailable:", err);
  }
}

function renderHistory(history) {
  const sections = Array.from(document.querySelectorAll(".sidebar-section"));
  const historySection = sections.find((section) => section.textContent.trim().toLowerCase() === "history");
  if (!historySection) return;

  let node = historySection.nextElementSibling;
  while (node && node.classList.contains("nav-item")) {
    const next = node.nextElementSibling;
    node.remove();
    node = next;
  }

  let anchor = historySection;

  history.slice(0, 3).forEach((item) => {
    const link = document.createElement("div");
    link.className = "nav-item";
    link.innerHTML = `<span class="icon">DOC</span> ${escapeHtml(item.filename || "Document")}`;
    link.addEventListener("click", () => {
      window.location.href = `/dashboard.html?id=${encodeURIComponent(item.id)}`;
    });
    anchor.insertAdjacentElement("afterend", link);
    anchor = link;
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

