const storedSummary = localStorage.getItem("latestLegalSummary");

if (storedSummary) {
  renderDashboard(JSON.parse(storedSummary));
}

function renderDashboard(data) {
  const summary = data.summary || {};

  setText("document-title", summary.document_title || "Document Summary");
  setText("document-meta", `Source: ${data.filename || "Uploaded document"} | Report ID: ${data.id || "Not saved"}`);
  setText("overview", summary.overview || "No overview returned.");
  renderCategory("payment", summary.payment);
  renderCategory("work-scope", summary.work_scope);
  renderCategory("ownership", summary.ownership);
  renderCategory("deadlines", summary.deadlines);
  renderCategory("ending", summary.ending_terms);
  setText("final-advice", summary.final_advice || "No final advice returned.");
  setText("confidence-note", summary.confidence_note || "");

  renderRisks(summary.risks);
  renderList("suggestions", summary.suggestions);
}

function renderCategory(idPrefix, section) {
  setText(`${idPrefix}-summary`, section?.summary || "Not specified.");
  setText(`${idPrefix}-risk`, `Risk: ${section?.risk || "Not specified."}`);
}

function renderRisks(risks) {
  const container = document.getElementById("risks");
  container.innerHTML = "";

  if (!Array.isArray(risks) || risks.length === 0) {
    container.appendChild(createEmpty("No risks found."));
    return;
  }

  risks.forEach((risk) => {
    const item = document.createElement("div");
    item.className = "risk-item";

    const level = document.createElement("span");
    level.className = `risk-level ${String(risk.level || "medium").toLowerCase()}`;
    level.textContent = risk.level || "Medium";

    const title = document.createElement("strong");
    title.textContent = risk.title || "Risk";

    const explanation = document.createElement("p");
    explanation.textContent = risk.explanation || "No explanation returned.";

    item.append(level, title, explanation);
    container.appendChild(item);
  });
}

function renderList(id, items) {
  const container = document.getElementById(id);
  container.innerHTML = "";

  if (!Array.isArray(items) || items.length === 0) {
    container.appendChild(createEmpty("No suggestions found."));
    return;
  }

  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    container.appendChild(li);
  });
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function createEmpty(text) {
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = text;
  return empty;
}
