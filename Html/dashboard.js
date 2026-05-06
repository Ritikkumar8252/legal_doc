document.addEventListener("DOMContentLoaded", () => {
  loadDashboard();
  loadHistory();
  setupActions();
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
      console.warn("Using static dashboard fallback:", err);
    }
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

function readLocalReport() {
  const stored = localStorage.getItem("latestLegalSummary");

  if (!stored) {
    return null;
  }

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
      tags: ["Legal Document"],
      overview: summary,
      eli15_summary: summary,
      key_clauses: [],
      risks: [],
      dates: [],
      risk_score: 100,
      clarity_score: 70,
      contract_duration: "N/A",
      duration_note: "Not specified",
      suggestions: [],
      final_advice: "Review the full analysis before signing.",
      confidence_note: ""
    };
  }

  const clauses = Array.isArray(summary.key_clauses)
    ? summary.key_clauses
    : legacyClauses(summary);

  const risks = Array.isArray(summary.risks) ? summary.risks : [];
  const dates = Array.isArray(summary.dates) ? summary.dates : legacyDates(summary);
  const riskCounts = countRisks(risks);

  return {
    document_title: summary.document_title || report.filename || "Document Analysis",
    document_type: summary.document_type || "Legal Document",
    tags: Array.isArray(summary.tags) && summary.tags.length ? summary.tags : [summary.document_type || "Legal Document"],
    overview: summary.overview || "No overview returned.",
    eli15_summary: summary.eli15_summary || summary.final_advice || "No simple explanation returned.",
    key_clauses: clauses,
    risks,
    dates,
    risk_score: numberOr(summary.risk_score, estimateRiskScore(riskCounts)),
    clarity_score: numberOr(summary.clarity_score, 70),
    contract_duration: summary.contract_duration || "N/A",
    duration_note: summary.duration_note || "Not specified",
    suggestions: Array.isArray(summary.suggestions) ? summary.suggestions : [],
    final_advice: summary.final_advice || "Review the document carefully before signing.",
    confidence_note: summary.confidence_note || "",
    risk_counts: summary.risk_counts || riskCounts,
    stats: summary.stats || {}
  };
}

function renderDashboard(report) {
  const summary = normalizeSummary(report);
  const content = report.content || "";
  const clauses = summary.key_clauses;
  const risks = summary.risks;
  const counts = summary.risk_counts || countRisks(risks);
  const stats = summary.stats || {};
  const analyzedAt = formatDate(report.created_at);

  setText(".topbar-right > div:first-child", report.filename || "Uploaded document");
  setText(".page-title", summary.document_title);
  setText(".page-subtitle", "Extracted | Classified | Risk-Scored");
  setHtml(".doc-meta", `Analyzed: <span>${escapeHtml(analyzedAt)}</span><br>Words: <span>${countWords(content)}</span><br>Doc type: <span>${escapeHtml(summary.document_type)}</span>`);

  setStat(0, stats.key_clauses_found ?? clauses.length, "across dashboard categories");
  setStat(1, stats.risk_alerts ?? risks.length, stats.risk_summary || `${counts.high} high | ${counts.medium} medium | ${counts.low} low`);
  setStat(2, `${summary.clarity_score}/100`, clarityLabel(summary.clarity_score));
  setStat(3, stats.contract_duration || summary.contract_duration, stats.duration_note || summary.duration_note);

  setText(".summary-text", summary.overview);
  setText(".eli15-label", "Explain Like I am 15");
  setText(".eli15-text", summary.eli15_summary);

  renderTags(summary.tags);
  renderClauses(clauses);
  renderRisks(risks);
  renderDates(summary.dates);
  renderSuggestions(summary);
  renderRiskScore(summary.risk_score, counts);
}

function renderTags(tags) {
  const container = document.querySelector(".doc-type-row");
  if (!container) return;

  container.innerHTML = "";

  tags.slice(0, 4).forEach((tag, index) => {
    const item = document.createElement("div");
    item.className = `doc-type-tag${index === 0 ? " active" : ""}`;
    item.textContent = tag;
    container.appendChild(item);
  });
}

function renderClauses(clauses) {
  const container = document.querySelector(".clause-list");
  const count = document.querySelector(".content-left .card:nth-child(2) .card-header span");
  if (!container) return;

  if (count) {
    count.textContent = `${clauses.length} found`;
  }

  container.innerHTML = "";

  if (!clauses.length) {
    container.appendChild(emptyState("No key clauses found."));
    return;
  }

  clauses.forEach((clause) => {
    const item = document.createElement("div");
    item.className = "clause-item";

    const typeWrap = document.createElement("div");
    const type = document.createElement("div");
    type.className = `clause-type ${clauseClass(clause.type)}`;
    type.textContent = clause.title || clause.type || "Clause";
    typeWrap.appendChild(type);

    const desc = document.createElement("div");
    desc.className = "clause-desc";
    desc.textContent = clause.description || "Not specified.";

    const value = document.createElement("div");
    value.className = "clause-value";
    value.textContent = clause.value || "Not specified";

    item.append(typeWrap, desc, value);
    container.appendChild(item);
  });
}

function renderRisks(risks) {
  const container = document.querySelector(".risk-list");
  if (!container) return;

  container.innerHTML = "";

  if (!risks.length) {
    container.appendChild(emptyState("No risk alerts found."));
    return;
  }

  risks.forEach((risk) => {
    const level = riskClass(risk.level);
    const item = document.createElement("div");
    item.className = `risk-item ${level}`;

    const header = document.createElement("div");
    header.className = "risk-header";

    const name = document.createElement("div");
    name.className = "risk-name";
    name.textContent = risk.title || "Risk";

    const badge = document.createElement("div");
    badge.className = `risk-badge ${level}`;
    badge.textContent = risk.level || "Medium";

    const desc = document.createElement("div");
    desc.className = "risk-desc";
    desc.textContent = risk.explanation || "No explanation returned.";

    header.append(name, badge);
    item.append(header, desc);
    container.appendChild(item);
  });
}

function renderDates(dates) {
  const container = document.querySelector(".timeline");
  if (!container) return;

  container.innerHTML = "";

  if (!dates.length) {
    container.appendChild(emptyState("No key dates found."));
    return;
  }

  dates.slice(0, 5).forEach((date) => {
    const item = document.createElement("div");
    item.className = "tl-item";

    const dot = document.createElement("div");
    dot.className = `tl-dot ${dateStatus(date.status)}`;

    const content = document.createElement("div");
    content.className = "tl-content";

    const title = document.createElement("div");
    title.className = "tl-title";
    title.textContent = date.label || "Important Date";

    const value = document.createElement("div");
    value.className = "tl-date";
    value.textContent = date.value || "Not specified";

    content.append(title, value);
    item.append(dot, content);
    container.appendChild(item);
  });
}

function renderSuggestions(summary) {
  const card = document.querySelector(".content-left .card:nth-child(3)");
  const title = card?.querySelector(".card-title");
  const status = card?.querySelector(".card-header span");
  const body = card?.querySelector(".card-body");

  if (!body) return;

  if (title) title.textContent = "Suggestions";
  if (status) status.textContent = "Backend";

  body.innerHTML = "";

  const list = document.createElement("ul");
  list.className = "suggestion-list";

  const suggestions = summary.suggestions.length
    ? summary.suggestions
    : ["No suggestions returned."];

  suggestions.forEach((suggestion) => {
    const item = document.createElement("li");
    item.textContent = suggestion;
    list.appendChild(item);
  });

  const advice = document.createElement("div");
  advice.className = "advice-block";
  advice.textContent = summary.final_advice;

  const note = document.createElement("p");
  note.className = "empty-state";
  note.textContent = summary.confidence_note;

  body.append(list, advice, note);
}

function renderRiskScore(score, counts) {
  setText(".ring-num", String(score));

  const ring = document.querySelector(".ring-container svg circle:nth-child(2)");
  if (ring) {
    const circumference = 251.2;
    ring.setAttribute("stroke-dashoffset", String(circumference - (circumference * score / 100)));
    ring.setAttribute("stroke", score >= 75 ? "#4caf7d" : score >= 45 ? "#e09a2f" : "#e05252");
  }

  const rows = document.querySelectorAll(".legend-row");
  const values = [
    ["high", counts.high],
    ["medium", counts.medium],
    ["low", counts.low],
  ];
  const total = Math.max(1, counts.high + counts.medium + counts.low);

  values.forEach(([, value], index) => {
    const row = rows[index];
    if (!row) return;

    const bar = row.querySelector(".legend-bar");
    const count = row.querySelector(".legend-val");
    if (bar) bar.style.width = `${Math.max(8, Math.round((value / total) * 100))}%`;
    if (count) count.textContent = String(value);
  });
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

function setupActions() {
  document.querySelector(".upload-btn")?.addEventListener("click", () => {
    window.location.href = "/app.html";
  });

  document.querySelector(".upload-zone")?.addEventListener("click", () => {
    window.location.href = "/app.html";
  });
}

function legacyClauses(summary) {
  const sections = [
    ["Payment", "pay", summary.payment],
    ["Work Scope", "ip", summary.work_scope],
    ["Ownership", "nda", summary.ownership],
    ["Deadlines", "term", summary.deadlines],
    ["Ending Terms", "renewal", summary.ending_terms],
  ];

  return sections
    .filter(([, , section]) => section && (section.summary || section.risk))
    .map(([title, type, section]) => ({
      type,
      title,
      description: section.summary || "Not specified.",
      value: section.risk || "No risk noted",
    }));
}

function legacyDates(summary) {
  if (!summary.deadlines?.summary) {
    return [];
  }

  return [{
    label: "Deadlines",
    value: summary.deadlines.summary,
    status: "warn",
  }];
}

function countRisks(risks) {
  return risks.reduce((counts, risk) => {
    const level = riskClass(risk.level);
    if (level === "high") counts.high += 1;
    else if (level === "low") counts.low += 1;
    else counts.medium += 1;
    return counts;
  }, { high: 0, medium: 0, low: 0 });
}

function estimateRiskScore(counts) {
  const penalty = (counts.high * 22) + (counts.medium * 12) + (counts.low * 5);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function setStat(index, value, subtext) {
  const cards = document.querySelectorAll(".stat-card");
  const card = cards[index];
  if (!card) return;

  const statValue = card.querySelector(".stat-value");
  const statSub = card.querySelector(".stat-sub");

  if (statValue) statValue.textContent = value;
  if (statSub) statSub.textContent = subtext;
}

function clauseClass(value) {
  const type = String(value || "").toLowerCase();
  if (type.includes("pay")) return "pay";
  if (type.includes("term")) return "term";
  if (type.includes("liability")) return "liability";
  if (type.includes("conf") || type.includes("nda")) return "nda";
  if (type.includes("own") || type.includes("ip")) return "ip";
  if (type.includes("renew")) return "renewal";
  return "term";
}

function riskClass(value) {
  const level = String(value || "Medium").toLowerCase();
  if (level.startsWith("h")) return "high";
  if (level.startsWith("l")) return "low";
  return "med";
}

function dateStatus(value) {
  const status = String(value || "").toLowerCase();
  if (status === "done") return "done";
  if (status === "warn") return "warn";
  return "";
}

function clarityLabel(score) {
  if (score >= 75) return "Easy to understand";
  if (score >= 50) return "Moderate complexity";
  return "Needs careful reading";
}

function countWords(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatDate(value) {
  if (!value) return new Date().toLocaleString();

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function emptyState(text) {
  const item = document.createElement("p");
  item.className = "empty-state";
  item.textContent = text;
  return item;
}

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function setHtml(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.innerHTML = value;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
