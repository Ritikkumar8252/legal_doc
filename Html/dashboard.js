let currentDashboardDocument = {
  filename: "No document loaded",
  content: "",
  createdAt: ""
};

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
        severity: "MEDIUM",
        title: "Only Basic Analysis Available",
        category: "other",
        explanation: "This saved report has no structured risk details.",
        description: "This saved report has no structured risk details.",
        score: 50,
        what_to_do: "Rerun the analysis to get a complete dashboard."
      }],
      overall_risk_score: 50,
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
    overview: summary.overview || summary.summary || "No overview returned.",
    plain_language_summary: summary.plain_language_summary || summary.eli15_summary || summary.overview || "",
    top_takeaways: asList(summary.top_takeaways),
    key_clauses: Array.isArray(summary.key_clauses) ? summary.key_clauses : legacyClauses(summary),
    risks,
    dates: Array.isArray(summary.dates) ? summary.dates : [],
    overall_risk_score: numberOr(summary.overall_risk_score, null),
    risk_score: numberOr(summary.risk_score, estimateSafetyScore(riskCounts)),
    clarity_score: numberOr(summary.clarity_score, 70),
    contract_duration: summary.contract_duration || "N/A",
    duration_note: summary.duration_note || "Not specified",
    suggestions: asList(summary.suggestions),
    action_items: asList(summary.action_items),
    questions_to_ask: asList(summary.questions_to_ask),
    final_advice: summary.final_advice || "Review the document carefully before signing.",
    verdict: summary.verdict || "",
    confidence_note: summary.confidence_note || "",
    risk_counts: summary.risk_counts || riskCounts,
    stats: summary.stats || {}
  };
}

function renderDashboard(report) {
  const summary = normalizeSummary(report);
  const filename = report.filename || "Uploaded document";
  const content = report.content || "";
  currentDashboardDocument = {
    filename,
    content,
    createdAt: report.created_at || ""
  };
  const risks = sortRisks(summary.risks);
  const counts = summary.risk_counts || countRisks(risks);
  const stats = summary.stats || {};
  const promptRiskScore = getPromptRiskScore(summary, stats);
  const safetyScore = 100 - promptRiskScore;
  const verdict = getVerdict(safetyScore, counts, summary.verdict);

  setText("tb-docname", filename);
  setText("d-title", summary.document_title || filename);
  setText("d-time", formatDate(report.created_at));
  setText("d-words", countWords(content).toLocaleString());
  setText("d-type", summary.document_type);

  setText("m-risks", String(stats.risk_alerts ?? risks.length));
  setText("m-risks-sub", stats.risk_summary || `${counts.high} high | ${counts.medium} medium | ${counts.low} low`);
  renderOverallRisk(promptRiskScore, numberOr(summary.overall_risk_score ?? stats.overall_risk_score, null) !== null);
  renderTopSeverity(counts);
  setText("m-verdict", verdict.label);
  setMetricTone("m-overall-risk", riskTone(promptRiskScore));
  setMetricTone("m-top-severity", severityTone(counts));
  setMetricTone("m-verdict", verdictTone(verdict.label));

  renderVerdict(verdict, promptRiskScore);
  setText("ai-summary", summary.overview || summary.plain_language_summary);
  renderPromptRisks(risks);
  renderRiskGauge(promptRiskScore, counts);
  renderSuggestions(summary.suggestions.length ? summary.suggestions : summary.action_items);
  setText("final-advice", summary.final_advice);
  setText("prompt-source-note", summary.confidence_note || "Showing output shaped by prompts/final_prompt.py.");
}

function getPromptRiskScore(summary, stats) {
  const promptRisk = numberOr(summary.overall_risk_score ?? stats.overall_risk_score, null);

  if (promptRisk === null) {
    return 100 - clampScore(summary.risk_score);
  }

  return clampScore(promptRisk);
}

function renderOverallRisk(promptRiskScore, hasPromptRisk) {
  setText("m-overall-risk", `${promptRiskScore}/100`);
  setText("m-overall-risk-sub", hasPromptRisk ? "from final prompt" : "estimated from alerts");
}

function renderTopSeverity(counts) {
  if (counts.high > 0) {
    setText("m-top-severity", "HIGH");
    setText("m-top-severity-sub", `${counts.high} high risk item${counts.high === 1 ? "" : "s"}`);
    return;
  }

  if (counts.medium > 0) {
    setText("m-top-severity", "MED");
    setText("m-top-severity-sub", `${counts.medium} medium risk item${counts.medium === 1 ? "" : "s"}`);
    return;
  }

  setText("m-top-severity", "LOW");
  setText("m-top-severity-sub", `${counts.low} low risk item${counts.low === 1 ? "" : "s"}`);
}

function renderVerdict(verdict, riskScore) {
  const banner = document.getElementById("verdict-banner");
  if (banner) {
    banner.classList.remove("verdict-SIGN", "verdict-NEGOTIATE", "verdict-AVOID");
    banner.classList.add(`verdict-${verdict.label}`);
  }

  setText("v-icon", verdict.icon);
  setText("v-label", `Verdict - ${verdict.label}`);
  setText("v-title", verdict.title);
  setText("v-sub", verdict.sub);

  const arc = document.getElementById("score-arc");
  const circumference = 175.9;
  const offset = circumference - (riskScore / 100) * circumference;

  if (arc) {
    arc.style.stroke = riskColor(riskScore);
    arc.style.transition = "stroke-dashoffset 1.2s ease";
    window.requestAnimationFrame(() => {
      arc.style.strokeDashoffset = offset;
    });
  }

  animateCount(document.getElementById("score-num"), 0, riskScore, 900);
}

function renderPromptRisks(risks) {
  const container = document.getElementById("prompt-risk-list");
  if (!container) return;

  container.innerHTML = "";

  if (!risks.length) {
    container.appendChild(emptyState("No risks returned by the prompt."));
    return;
  }

  risks.forEach((risk) => {
    const level = levelName(risk.level || risk.severity);
    const score = riskScore(risk);
    const card = document.createElement("div");
    card.className = `prompt-risk-card ${level}`;

    const top = document.createElement("div");
    top.className = "prompt-risk-top";

    const badge = document.createElement("span");
    badge.className = `risk-badge risk-${level}`;
    badge.textContent = level;

    const title = document.createElement("div");
    title.className = "prompt-risk-title";
    title.textContent = risk.title || "Risk";

    const scoreNode = document.createElement("div");
    scoreNode.className = "prompt-risk-score";
    scoreNode.textContent = `${score}/100`;

    const category = document.createElement("div");
    category.className = "category-pill";
    category.textContent = risk.category || "other";

    const desc = document.createElement("div");
    desc.className = "prompt-risk-desc";
    desc.textContent = risk.description || risk.explanation || "No description returned.";

    top.append(badge, title, scoreNode);
    card.append(top, category, desc);
    container.appendChild(card);
  });
}

function renderSuggestions(suggestions) {
  const container = document.getElementById("suggestion-list");
  if (!container) return;

  container.innerHTML = "";
  const items = suggestions.length ? suggestions : ["Ask the other party to clarify the risky terms before signing."];

  items.slice(0, 5).forEach((suggestion, index) => {
    const item = document.createElement("div");
    item.className = "suggestion-item";

    const num = document.createElement("span");
    num.className = "suggestion-num";
    num.textContent = String(index + 1);

    const text = document.createElement("span");
    text.textContent = suggestion;

    item.append(num, text);
    container.appendChild(item);
  });
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

function renderRiskGauge(score, counts) {
  setText("gauge-num", String(score));
  drawRiskGauge(score);

  const total = Math.max(1, counts.high, counts.medium, counts.low);
  setText("rbc-high", String(counts.high));
  setText("rbc-med", String(counts.medium));
  setText("rbc-low", String(counts.low));
  setWidth("rb-high", counts.high / total * 100);
  setWidth("rb-med", counts.medium / total * 100);
  setWidth("rb-low", counts.low / total * 100);
}

function renderGauge(score, counts) {
  renderRiskGauge(100 - clampScore(score), counts);
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

function drawRiskGauge(score) {
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
  ctx.strokeStyle = riskColor(score);
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.stroke();
}

function drawGauge(score) {
  drawRiskGauge(100 - clampScore(score));
}

function renderEmptyDashboard(message) {
  setText("tb-docname", "No report");
  setText("d-title", "No Analysis Yet");
  setText("v-title", "Upload a document first");
  setText("v-sub", message);
  setText("ai-summary", message);
  setText("m-overall-risk", "-");
  setText("m-risks", "0");
  setText("m-top-severity", "-");
  setText("m-verdict", "-");
  setText("final-advice", "Upload or paste a contract to generate final prompt output.");
  setText("prompt-source-note", "");
  renderPromptRisks([]);
  renderSuggestions([]);
  renderRiskGauge(0, { high: 0, medium: 0, low: 0 });
}

function setupActions() {
  document.getElementById("new-analysis-btn")?.addEventListener("click", () => {
    window.location.href = "/app.html";
  });

  document.querySelector(".upload-btn")?.addEventListener("click", () => {
    window.location.href = "/app.html";
  });

  getDocumentsNavItem()?.addEventListener("click", () => {
    openDocumentViewer();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDocumentViewer();
  });
}

function getDocumentsNavItem() {
  return Array.from(document.querySelectorAll(".sidebar .nav-item"))
    .find((item) => item.textContent.trim().toLowerCase() === "documents");
}

function openDocumentViewer() {
  const viewer = ensureDocumentViewer();
  const wordCount = countWords(currentDashboardDocument.content);
  const documentsItem = getDocumentsNavItem();

  viewer.querySelector("#doc-viewer-name").textContent = currentDashboardDocument.filename;
  viewer.querySelector("#doc-viewer-meta").textContent = `${wordCount.toLocaleString()} words${currentDashboardDocument.createdAt ? ` · analyzed ${formatDate(currentDashboardDocument.createdAt)}` : ""}`;
  viewer.querySelector("#doc-viewer-text").textContent = currentDashboardDocument.content || "No document text is available for this analysis.";
  documentsItem?.classList.add("viewing");
  viewer.classList.add("open");
  viewer.querySelector(".doc-viewer-close")?.focus();
}

function closeDocumentViewer() {
  document.getElementById("document-viewer")?.classList.remove("open");
  getDocumentsNavItem()?.classList.remove("viewing");
}

function ensureDocumentViewer() {
  let viewer = document.getElementById("document-viewer");
  if (viewer) return viewer;

  viewer = document.createElement("div");
  viewer.id = "document-viewer";
  viewer.className = "document-viewer";
  viewer.innerHTML = `
    <section class="doc-viewer-panel" role="dialog" aria-modal="true" aria-labelledby="doc-viewer-name">
      <div class="doc-viewer-head">
        <div class="doc-viewer-title">
          <strong id="doc-viewer-name">Document</strong>
          <span id="doc-viewer-meta">0 words</span>
        </div>
        <button class="doc-viewer-close" type="button" aria-label="Close document viewer">x</button>
      </div>
      <div class="doc-viewer-body">
        <div class="doc-viewer-text" id="doc-viewer-text"></div>
      </div>
    </section>
  `;
  viewer.addEventListener("click", (event) => {
    if (event.target === viewer) closeDocumentViewer();
  });
  viewer.querySelector(".doc-viewer-close").addEventListener("click", closeDocumentViewer);
  document.body.appendChild(viewer);
  return viewer;
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

function getVerdict(score, counts, promptVerdict) {
  const verdict = String(promptVerdict || "").toUpperCase();

  if (verdict === "AVOID") {
    return {
      label: "AVOID",
      title: "Do not sign yet",
      sub: "The final prompt found serious risks. Ask for changes before agreeing.",
      icon: "!"
    };
  }

  if (verdict === "NEGOTIATE") {
    return {
      label: "NEGOTIATE",
      title: "Negotiate before signing",
      sub: "The final prompt found terms that should be clarified or changed first.",
      icon: "!"
    };
  }

  if (verdict === "SIGN") {
    return {
      label: "SIGN",
      title: "Looks okay to sign",
      sub: "The final prompt did not find major blockers, but check the details once more.",
      icon: "OK"
    };
  }

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
    const level = levelName(risk.level || risk.severity);
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
  const level = levelName(risk.level || risk.severity);
  if (level === "HIGH") return 85;
  if (level === "MEDIUM") return 60;
  return 30;
}

function sortRisks(risks) {
  const order = { HIGH: 1, MEDIUM: 2, LOW: 3 };
  return [...risks].sort((a, b) => {
    const scoreDiff = riskScore(b) - riskScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return (order[levelName(a.level || a.severity)] || 9) - (order[levelName(b.level || b.severity)] || 9);
  });
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
  if (value === null || value === undefined || value === "") return fallback;
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

function riskColor(score) {
  if (score >= 61) return "#ef4444";
  if (score >= 31) return "#f59e0b";
  return "#22c55e";
}

function riskTone(score) {
  if (score >= 61) return "red";
  if (score >= 31) return "amber";
  return "green";
}

function severityTone(counts) {
  if (counts.high > 0) return "red";
  if (counts.medium > 0) return "amber";
  return "green";
}

function verdictTone(label) {
  if (label === "AVOID") return "red";
  if (label === "NEGOTIATE") return "amber";
  return "green";
}

function setMetricTone(childId, tone) {
  const child = document.getElementById(childId);
  const card = child?.closest(".metric-card");
  if (!card) return;

  card.classList.remove("red", "amber", "green", "teal");
  card.classList.add(tone);
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

