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


def _risk_counts(risks):
    counts = {
        "high": 0,
        "medium": 0,
        "low": 0,
    }

    for risk in risks:
        level = str(risk.get("level", "Medium")).lower()

        if level.startswith("h"):
            counts["high"] += 1
        elif level.startswith("l"):
            counts["low"] += 1
        else:
            counts["medium"] += 1

    return counts


def _estimate_risk_score(risks):
    counts = _risk_counts(risks)
    penalty = (counts["high"] * 22) + (counts["medium"] * 12) + (counts["low"] * 5)
    return max(0, min(100, 100 - penalty))


def _estimate_clarity_score(contract_text):
    word_count = len(contract_text.split())
    penalty = min(45, word_count // 250)
    return max(45, 90 - penalty)


def _normalize_dashboard_summary(summary, contract_text):
    if not isinstance(summary, dict):
        summary = {}

    risks = summary.get("risks")
    if not isinstance(risks, list):
        risks = []

    key_clauses = summary.get("key_clauses")
    if not isinstance(key_clauses, list):
        key_clauses = []

    legacy_sections = [
        ("Payment", "pay", summary.get("payment")),
        ("Work Scope", "ip", summary.get("work_scope")),
        ("Ownership", "nda", summary.get("ownership")),
        ("Deadlines", "term", summary.get("deadlines")),
        ("Ending Terms", "renewal", summary.get("ending_terms")),
    ]

    if not key_clauses:
        for title, clause_type, section in legacy_sections:
            if isinstance(section, dict) and (section.get("summary") or section.get("risk")):
                key_clauses.append({
                    "type": clause_type,
                    "title": title,
                    "description": section.get("summary", "Not specified."),
                    "value": section.get("risk", "No risk noted"),
                })

    dates = summary.get("dates")
    if not isinstance(dates, list):
        dates = []

    if not dates and isinstance(summary.get("deadlines"), dict):
        dates.append({
            "label": "Deadlines",
            "value": summary["deadlines"].get("summary", "Not specified"),
            "status": "warn",
        })

    counts = _risk_counts(risks)
    risk_score = summary.get("risk_score")
    clarity_score = summary.get("clarity_score")

    if not isinstance(risk_score, int):
        risk_score = _estimate_risk_score(risks)

    if not isinstance(clarity_score, int):
        clarity_score = _estimate_clarity_score(contract_text)

    summary.setdefault("document_title", "Document Analysis")
    summary.setdefault("document_type", "Legal Document")
    summary.setdefault("overview", "No overview returned.")
    summary.setdefault("eli15_summary", summary.get("final_advice", "No simple explanation returned."))
    summary.setdefault("tags", [summary["document_type"]])
    summary["key_clauses"] = key_clauses
    summary["risks"] = risks
    summary["dates"] = dates
    summary["risk_score"] = risk_score
    summary["clarity_score"] = clarity_score
    summary.setdefault("contract_duration", "N/A")
    summary.setdefault("duration_note", "Not specified")
    summary.setdefault("suggestions", [])
    summary.setdefault("final_advice", "Review the document carefully before signing.")
    summary.setdefault("confidence_note", "")
    summary["risk_counts"] = counts
    summary["stats"] = {
        "key_clauses_found": len(key_clauses),
        "risk_alerts": len(risks),
        "clarity_score": clarity_score,
        "contract_duration": summary["contract_duration"],
        "risk_summary": f'{counts["high"]} high | {counts["medium"]} medium | {counts["low"]} low',
        "duration_note": summary["duration_note"],
    }

    return summary


def summarize_contract(contract_text):
    prompt = f"""
You are a legal document summarizer for a static dashboard UI.
Read the uploaded document text and return only valid JSON.
The JSON must directly power these dashboard sections:
- page header and document metadata
- four stat cards
- AI summary and Explain Like I am 15 block
- document type tags
- key clauses list
- risk score ring
- risk alerts list
- key dates timeline
- suggestions and final advice

JSON format:
{{
  "document_title": "Short title for the document",
  "document_type": "Service Agreement, NDA, Lease, Admission Letter, Policy, or other best label",
  "tags": ["Service Agreement", "SaaS", "B2B"],
  "overview": "Plain English summary in 2-4 sentences",
  "eli15_summary": "Very simple explanation for a 15-year-old",
  "risk_score": 60,
  "clarity_score": 62,
  "contract_duration": "12 mo, N/A, or another compact value",
  "duration_note": "Short note like Auto-renews annually or Not specified",
  "key_clauses": [
    {{
      "type": "pay, term, liability, nda, ip, renewal, or other",
      "title": "Short clause label",
      "description": "What the clause means in simple words",
      "value": "Compact value shown at right, such as INR 5000/mo, 30 days, Shared, or Not specified"
    }}
  ],
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
  "dates": [
    {{
      "label": "Contract Start",
      "value": "Jan 01, 2025 or Not specified",
      "status": "done, warn, or pending"
    }}
  ],
  "suggestions": ["Suggestion 1", "Suggestion 2", "Suggestion 3"],
  "final_advice": "Final practical advice before signing",
  "confidence_note": "Mention if the document text was incomplete or unclear"
}}

Rules:
- Use INR formatting when the document uses rupees.
- Keep key_clauses to 4-8 dashboard-friendly items.
- Use risk_score as a safety score from 0 to 100, where lower means more risky.
- Use clarity_score from 0 to 100, where higher means easier to understand.
- If data is missing, use "Not specified" instead of inventing facts.
Keep language simple. Do not give legal advice as a lawyer.

Document:
{contract_text}
"""

    content = _generate_with_gemini(prompt, json_response=True)

    try:
        summary = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError('Gemini returned an invalid summary format') from exc

    return _normalize_dashboard_summary(summary, contract_text)
