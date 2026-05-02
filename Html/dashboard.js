const storedSummary = localStorage.getItem("latestLegalSummary");

if (storedSummary) {
  renderDashboard(JSON.parse(storedSummary));
}

function renderDashboard(data) {
  const summary = data.summary || {};

  setText("document-title", summary.document_title || "Document Summary");
  setText("document-meta", `Source: ${data.filename || "Uploaded document"} | Report ID: ${data.id || "Not saved"}`);
  setText("overview", summary.overview || "No overview returned.");
  setText("recommendation", summary.recommendation || "No recommendation returned.");
  setText("confidence-note", summary.confidence_note || "");

  renderList("important-points", summary.important_points);
  renderRisks(summary.risks);
  renderKeyValueList("obligations", summary.obligations, "party", "duty");
  renderKeyValueList("dates", summary.dates, "label", "value");
}

function renderList(id, items) {
  const container = document.getElementById(id);
  container.innerHTML = "";

  if (!Array.isArray(items) || items.length === 0) {
    container.appendChild(createEmpty("No items found."));
    return;
  }

  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    container.appendChild(li);
  });
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

function renderKeyValueList(id, items, labelKey, valueKey) {
  const container = document.getElementById(id);
  container.innerHTML = "";

  if (!Array.isArray(items) || items.length === 0) {
    container.appendChild(createEmpty("Nothing specified."));
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "compact-row";

    const label = document.createElement("strong");
    label.textContent = item[labelKey] || "Not specified";

    const value = document.createElement("span");
    value.textContent = item[valueKey] || "Not specified";

    row.append(label, value);
    container.appendChild(row);
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
