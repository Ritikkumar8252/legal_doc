async function send() {
  const input = document.getElementById("input");
  const btn = document.querySelector(".btn-analyze");
  const text = input.value.trim();
  
  if (!text) return;

  
  btn.disabled = true;
  btn.innerHTML = '<span>Analyzing...</span>';
  btn.style.opacity = "0.7";

  
  addMsg(text, "user");
  input.value = "";

  
  const bot = addMsg("Scanning document for liabilities...", "bot-msg");

  try {
    const res = await fetch("http://127.0.0.1:5000/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text })
    });

    if (!res.ok) throw new Error("Network response was not ok");

    const data = await res.json();
    
    
    bot.innerHTML = data.reply; 

  } catch (err) {
    bot.innerText = "Connection Error: Please ensure your Flask/Node server is running on port 5000.";
    bot.style.color = "#ef4444";
    console.error("Fetch error:", err);
  } finally {
    
    btn.disabled = false;
    btn.innerHTML = '<span>Analyze Contract</span><span class="arrow-icon">→</span>';
    btn.style.opacity = "1";
  }
}

document.getElementById('file-upload').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  if (file.type === "text/plain") {
    reader.onload = function(e) {
      document.getElementById('input').value = e.target.result;
      addMsg(`Successfully uploaded: ${file.name}`, "bot-msg");
    };
    reader.readAsText(file);
  } 
  else if (file.type === "application/pdf") {
    addMsg(`PDF Detected: ${file.name}. (Parsing PDF content...)`, "bot-msg");
    
  } 
  else if (file.type.startsWith("image/")) {
    addMsg(`Image Detected: ${file.name}. (Running OCR...)`, "bot-msg");
    
  }
});

async function send() {
  const input = document.getElementById("input");
  const btn = document.querySelector(".btn-analyze");
  const text = input.value.trim();
  
  if (!text) return;

  btn.disabled = true;
  btn.innerHTML = '<span>Analyzing...</span>';

  addMsg("Analyzing content...", "bot-msg");

  try {
    const res = await fetch("http://127.0.0.1:5000/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        message: text,
        fileName: document.getElementById('file-upload').files[0]?.name || "Text Paste"
      })
    });

    const data = await res.json();
    
    const messages = document.querySelectorAll('.bot-msg');
    messages[messages.length - 1].innerHTML = data.reply;

  } catch (err) {
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Analyze Contract</span><span class="arrow-icon">→</span>';
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
    behavior: 'smooth'
  });
  
  return div;
}