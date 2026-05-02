const fileInput = document.getElementById("file-upload");
let currentFileName = "Pasted Text";

if (fileInput) {
  fileInput.addEventListener("change", function (event) {
    const file = event.target.files[0];
    if (file) {
      uploadFile(file);
    }
  });
}

async function uploadFile(file) {
  const status = addMsg(`Uploading ${escapeHtml(file.name)}...`, "bot-msg");
  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch("/upload", {
      method: "POST",
      body: formData
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Upload failed");
    }

    document.getElementById("input").value = data.content;
    currentFileName = data.filename;
    status.innerHTML = `Loaded <strong>${escapeHtml(data.filename)}</strong>. Review the extracted text, then analyze it.`;
  } catch (err) {
    status.innerText = err.message || "Unable to upload this file.";
    status.style.color = "#ef4444";
    console.error("Upload error:", err);
  }
}

async function send() {
  const input = document.getElementById("input");
  const btn = document.querySelector(".btn-analyze");
  const text = input.value.trim();

  if (!text) return;

  btn.disabled = true;
  btn.innerHTML = "<span>Analyzing...</span>";
  btn.style.opacity = "0.7";

  const bot = addMsg("Analyzing content...", "bot-msg");

  try {
    const res = await fetch("/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contract: text,
        filename: currentFileName
      })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Summary failed");
    }

    localStorage.setItem("latestLegalSummary", JSON.stringify(data));
    bot.innerHTML = "Summary ready. Opening dashboard...";
    window.location.href = "/dashboard.html";
  } catch (err) {
    bot.innerText = err.message || "Unable to connect to the backend.";
    bot.style.color = "#ef4444";
    console.error("Analyze error:", err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Summarize Document</span><span class="arrow-icon">&rarr;</span>';
    btn.style.opacity = "1";
  }
}

function addMsg(text, type) {
  const chat = document.getElementById("chat");
  const div = document.createElement("div");

  div.className = type;
  div.innerHTML = text;

  chat.appendChild(div);
  chat.scrollTo({
    top: chat.scrollHeight,
    behavior: "smooth"
  });

  return div;
}

function formatAnalysis(text) {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
