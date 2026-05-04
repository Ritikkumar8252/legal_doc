import os
import json
import urllib.error
import urllib.request
from pathlib import Path

from dotenv import load_dotenv

from prompts.final_prompt import build_prompt

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

load_dotenv(ENV_PATH, override=True)


def _get_gemini_api_key():
    load_dotenv(ENV_PATH, override=True)
    api_key = (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip()
    old_key_name = (os.getenv("OPENAI_API_KEY") or "").strip()

    if not api_key and old_key_name.startswith("AIza"):
        api_key = old_key_name

    if not api_key:
        raise ValueError('GEMINI_API_KEY is not configured')

    if api_key.startswith("your_"):
        raise ValueError('GEMINI_API_KEY is still a placeholder')

    if not api_key.startswith("AIza"):
        raise ValueError('GEMINI_API_KEY must be a Google Gemini key that starts with AIza')

    return api_key


def _generate_with_gemini(prompt, json_response=False):
    api_key = _get_gemini_api_key()
    generation_config = {
        "temperature": 0.2,
    }

    if json_response:
        generation_config["responseMimeType"] = "application/json"

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": prompt
                    }
                ]
            }
        ],
        "generationConfig": generation_config
    }

    request = urllib.request.Request(
        GEMINI_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.loads(response.read().decode("utf-8"))

    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        message = _extract_gemini_error(details)
        raise ValueError(message) from exc

    except urllib.error.URLError as exc:
        raise ValueError('Could not connect to Gemini API. Check internet connection.') from exc

    candidates = data.get("candidates") or []
    parts = (((candidates[0] or {}).get("content") or {}).get("parts") or []) if candidates else []
    text = "".join(part.get("text", "") for part in parts).strip()

    if not text:
        raise ValueError('Gemini returned an empty response')

    return text


def _extract_gemini_error(details):
    try:
        data = json.loads(details)
        error = data.get("error", {})
        message = error.get("message")
        status = error.get("status")

        if message:
            return f"Gemini API error: {message}"

        if status:
            return f"Gemini API error: {status}"

    except json.JSONDecodeError:
        pass

    return "Gemini API request failed"


def analyze_contract(contract_text):
    prompt = build_prompt(contract_text)

    return _generate_with_gemini(prompt)


def summarize_contract(contract_text):
    prompt = f"""
You are a legal document summarizer for a dashboard.
Read the uploaded document text and return only valid JSON.
Base the dashboard on these contract analysis categories:
1. Payment
2. Work scope
3. Ownership
4. Deadlines
5. Contract ending terms
6. Risks
7. Suggestions
8. Final advice

JSON format:
{{
  "document_title": "Short title for the document",
  "overview": "Plain English summary in 2-4 sentences",
  "payment": {{
    "summary": "Payment terms in simple words",
    "risk": "Payment risk or Not specified"
  }},
  "work_scope": {{
    "summary": "Scope of work in simple words",
    "risk": "Scope risk or Not specified"
  }},
  "ownership": {{
    "summary": "Ownership or IP terms in simple words",
    "risk": "Ownership risk or Not specified"
  }},
  "deadlines": {{
    "summary": "Deadlines in simple words",
    "risk": "Deadline risk or Not specified"
  }},
  "ending_terms": {{
    "summary": "Termination/ending terms in simple words",
    "risk": "Ending terms risk or Not specified"
  }},
  "risks": [
    {{
      "level": "Low, Medium, or High",
      "title": "Risk title",
      "explanation": "Why this matters"
    }}
  ],
  "suggestions": ["Suggestion 1", "Suggestion 2", "Suggestion 3"],
  "final_advice": "Final practical advice before signing",
  "confidence_note": "Mention if the document text was incomplete or unclear"
}}

Keep language simple. Do not give legal advice as a lawyer.

Document:
{contract_text}
"""

    content = _generate_with_gemini(prompt, json_response=True)

    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError('Gemini returned an invalid summary format') from exc
