import os
import json
import re
import socket
import urllib.error
import urllib.request
from pathlib import Path

from dotenv import load_dotenv

from prompts.final_prompt import SYSTEM_MESSAGE, build_prompt

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(ENV_PATH, override=True)

GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
GEMINI_TIMEOUT_SECONDS = int(os.getenv("GEMINI_TIMEOUT_SECONDS", "60"))
MAX_SUMMARY_CHARS = int(os.getenv("MAX_SUMMARY_CHARS", "12000"))


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
        with urllib.request.urlopen(request, timeout=GEMINI_TIMEOUT_SECONDS) as response:
            data = json.loads(response.read().decode("utf-8"))

    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        message = _extract_gemini_error(details)
        raise ValueError(message) from exc

    except (TimeoutError, socket.timeout) as exc:
        raise ValueError('Gemini took too long to respond') from exc

    except urllib.error.URLError as exc:
        if isinstance(exc.reason, (TimeoutError, socket.timeout)):
            raise ValueError('Gemini took too long to respond') from exc

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
    prompt = SYSTEM_MESSAGE + "\n\n" + build_prompt(_trim_contract_text(contract_text))
    content = _generate_with_gemini(prompt, json_response=True)

    return _normalize_dashboard_summary(_parse_json_response(content), contract_text)


def _parse_json_response(content):
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", content, re.S)

        if match:
            return json.loads(match.group(0))

        raise ValueError("Gemini returned an invalid JSON format")


def _normalize_level(value):
    level = str(value or "Medium").strip().lower()

    if level.startswith("h"):
        return "High"
    if level.startswith("l"):
        return "Low"
    return "Medium"


def _risk_level_from_score(score):
    value = int(score) if isinstance(score, int) else int(float(score or 0))

    if value >= 61:
        return "High"
    if value >= 31:
        return "Medium"
    return "Low"


def _category_title(value):
    text = str(value or "other").replace("_", " ").strip()
    return text.title() if text else "Other"


def _clause_type(category):
    category = str(category or "").lower()

    if "pay" in category:
        return "pay"
    if "work" in category or "scope" in category:
        return "ip"
    if "owner" in category or "ip" in category:
        return "ip"
    if "term" in category:
        return "term"
    return "other"


def _normalize_final_prompt_output(summary):
    if not isinstance(summary, dict):
        return summary

    if not any(key in summary for key in ("overall_risk_score", "verdict")):
        return summary

    normalized = dict(summary)
    final_risks = []
    final_clauses = []

    for risk in _safe_list(summary.get("risks")):
        if not isinstance(risk, dict):
            continue

        score = risk.get("score")
        level = _normalize_level(risk.get("level") or risk.get("severity"))

        if not risk.get("level") and risk.get("score") is not None:
            level = _risk_level_from_score(score)

        category = risk.get("category") or "other"
        description = risk.get("description") or risk.get("explanation") or "No explanation returned."
        suggestion = f"Ask to clarify or improve the {_category_title(category).lower()} term before signing."

        final_risks.append({
            "level": level,
            "severity": level.upper(),
            "title": risk.get("title") or _category_title(category),
            "category": category,
            "explanation": description,
            "description": description,
            "what_to_do": risk.get("what_to_do") or suggestion,
            "score": score,
        })
        final_clauses.append({
            "type": _clause_type(category),
            "title": risk.get("title") or _category_title(category),
            "description": description,
            "why_it_matters": "This can affect your money, work, rights, or ability to leave the contract.",
            "action": risk.get("what_to_do") or suggestion,
            "value": f"{level} risk",
        })

    overall_risk = summary.get("overall_risk_score")
    safety_score = None

    if overall_risk is not None:
        try:
            overall_risk = max(0, min(100, int(float(overall_risk))))
            safety_score = 100 - overall_risk
        except (TypeError, ValueError):
            overall_risk = None
            safety_score = None

    verdict = str(summary.get("verdict") or "").upper()
    verdict_note = {
        "SIGN": "The final prompt says this may be okay to sign after checking the details.",
        "NEGOTIATE": "The final prompt says you should negotiate before signing.",
        "AVOID": "The final prompt says you should avoid signing unless the risky terms change.",
    }.get(verdict, "Use the final prompt output to review the document before signing.")

    normalized["overview"] = summary.get("overview") or summary.get("summary") or "No overview returned."
    normalized["plain_language_summary"] = summary.get("plain_language_summary") or normalized["overview"]
    normalized["eli15_summary"] = summary.get("eli15_summary") or summary.get("final_advice") or normalized["overview"]
    normalized["top_takeaways"] = _safe_list(summary.get("top_takeaways")) or [
        normalized["overview"],
        verdict_note,
        summary.get("final_advice") or "Review the risks before signing.",
    ]
    normalized["risks"] = final_risks
    normalized["key_clauses"] = final_clauses[:8]
    normalized["overall_risk_score"] = overall_risk
    normalized["risk_score"] = safety_score
    normalized["document_title"] = summary.get("document_title") or "Freelance Contract Analysis"
    normalized["document_type"] = summary.get("document_type") or "Freelance Contract"
    normalized["tags"] = summary.get("tags") or ["Final Prompt", verdict or "Review"]
    normalized["action_items"] = _safe_list(summary.get("action_items")) or _safe_list(summary.get("suggestions"))
    normalized["questions_to_ask"] = _safe_list(summary.get("questions_to_ask")) or [
        "Can we change or clarify the highest risk terms before I sign?",
        "Can you confirm payment, deadlines, ownership, and termination terms in writing?",
    ]
    normalized["confidence_note"] = summary.get("confidence_note") or "Dashboard generated from prompts/final_prompt.py output."

    return normalized

def _risk_counts(risks):
    counts = {
        "high": 0,
        "medium": 0,
        "low": 0,
    }

    for risk in risks:
        level = str(risk.get("level") or risk.get("severity") or "Medium").lower()

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


def _safe_list(value):
    return value if isinstance(value, list) else []


def _normalize_dashboard_summary(summary, contract_text):
    if not isinstance(summary, dict):
        summary = {}

    summary = _normalize_final_prompt_output(summary)
    risks = _safe_list(summary.get("risks"))

    key_clauses = _safe_list(summary.get("key_clauses"))

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

    dates = _safe_list(summary.get("dates"))

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
    summary.setdefault("plain_language_summary", summary["overview"])
    summary.setdefault("eli15_summary", summary.get("final_advice", "No simple explanation returned."))
    summary.setdefault("tags", [summary["document_type"]])
    summary["key_clauses"] = key_clauses
    summary["risks"] = risks
    summary["dates"] = dates
    summary["risk_score"] = risk_score
    summary["clarity_score"] = clarity_score
    summary.setdefault("contract_duration", "N/A")
    summary.setdefault("duration_note", "Not specified")
    summary["top_takeaways"] = _safe_list(summary.get("top_takeaways"))
    summary["suggestions"] = _safe_list(summary.get("suggestions"))
    summary["action_items"] = _safe_list(summary.get("action_items"))
    summary["questions_to_ask"] = _safe_list(summary.get("questions_to_ask"))
    summary.setdefault("final_advice", "Review the document carefully before signing.")
    summary.setdefault("confidence_note", "")

    if not summary["top_takeaways"]:
        summary["top_takeaways"] = [
            summary["overview"],
        ]

    if not summary["action_items"]:
        summary["action_items"] = summary["suggestions"]

    summary["risk_counts"] = counts
    summary["stats"] = {
        "key_clauses_found": len(key_clauses),
        "risk_alerts": len(risks),
        "clarity_score": clarity_score,
        "overall_risk_score": summary.get("overall_risk_score"),
        "contract_duration": summary["contract_duration"],
        "risk_summary": f'{counts["high"]} high | {counts["medium"]} medium | {counts["low"]} low',
        "duration_note": summary["duration_note"],
    }

    return summary


def _trim_contract_text(contract_text):
    text = contract_text.strip()

    if len(text) <= MAX_SUMMARY_CHARS:
        return text

    head_size = MAX_SUMMARY_CHARS // 2
    tail_size = MAX_SUMMARY_CHARS - head_size

    return (
        text[:head_size]
        + "\n\n[Middle of document omitted to keep analysis fast.]\n\n"
        + text[-tail_size:]
    )


def _first_sentence(text):
    cleaned = " ".join(text.split())
    match = re.search(r"(.{40,240}?[.!?])\s", cleaned)

    if match:
        return match.group(1)

    return cleaned[:240] or "No readable text found."


def _fallback_title(contract_text):
    for line in contract_text.splitlines():
        cleaned = line.strip()

        if 5 <= len(cleaned) <= 90:
            return cleaned.title()

    return "Document Analysis"


def _has_any(text, terms):
    return any(term in text for term in terms)


def _build_fallback_summary(contract_text, reason):
    lower_text = contract_text.lower()
    title = _fallback_title(contract_text)
    clauses = []
    risks = []
    dates = []
    actions = [
        "Check all payment amounts, deadlines, and penalty terms before signing.",
        "Ask the other party to clarify anything marked as Not specified.",
        "Save a copy of the final signed document and any email approvals.",
    ]
    questions = [
        "Can you confirm every payment amount and due date in writing?",
        "Are there any penalties, auto-renewal terms, or extra fees I should know about?",
    ]

    if _has_any(lower_text, ["payment", "fee", "invoice", "salary", "compensation", "amount", "inr", "rs."]):
        clauses.append({
            "type": "pay",
            "title": "Payment",
            "description": "The document appears to include payment or fee terms.",
            "why_it_matters": "Money terms decide what must be paid, when it is due, and whether extra charges apply.",
            "action": "Confirm the amount, due date, taxes, and late fee.",
            "value": "Check payment terms",
        })

    if _has_any(lower_text, ["deadline", "due date", "milestone", "delivery", "term", "expiry", "expire"]):
        clauses.append({
            "type": "term",
            "title": "Deadlines",
            "description": "The document appears to include deadlines, milestones, or expiry terms.",
            "why_it_matters": "Missing a deadline can cause delays, extra costs, or loss of rights.",
            "action": "Write down each date and reminder.",
            "value": "Dates found",
        })
        dates.append({
            "label": "Important dates",
            "value": "Review deadlines in the document",
            "status": "warn",
        })

    if _has_any(lower_text, ["terminate", "termination", "cancel", "notice"]):
        clauses.append({
            "type": "term",
            "title": "Ending Terms",
            "description": "The document appears to explain how the agreement can end.",
            "why_it_matters": "Ending rules decide how much notice is needed and what happens after cancellation.",
            "action": "Check notice period and any payment due on exit.",
            "value": "Notice terms",
        })

    if _has_any(lower_text, ["confidential", "non-disclosure", "nda", "secret"]):
        clauses.append({
            "type": "nda",
            "title": "Confidentiality",
            "description": "The document appears to include confidentiality duties.",
            "why_it_matters": "You may be required to keep information private even after the agreement ends.",
            "action": "Check what information is covered and for how long.",
            "value": "Privacy duty",
        })

    if _has_any(lower_text, ["ownership", "intellectual property", "ip", "copyright", "license"]):
        clauses.append({
            "type": "ip",
            "title": "Ownership",
            "description": "The document appears to include ownership or IP terms.",
            "why_it_matters": "This decides who owns the work, data, designs, code, or content.",
            "action": "Confirm when ownership transfers and what is excluded.",
            "value": "Ownership terms",
        })

    if _has_any(lower_text, ["liability", "damages", "indemnify", "indemnification"]):
        clauses.append({
            "type": "liability",
            "title": "Liability",
            "description": "The document appears to limit or explain responsibility for losses.",
            "why_it_matters": "A liability cap can limit how much money you can recover if something goes wrong.",
            "action": "Check the cap and excluded damages.",
            "value": "Risk cap",
        })
        risks.append({
            "level": "Medium",
            "title": "Liability Limit",
            "explanation": "There may be a limit on what one side can recover after a problem.",
            "what_to_do": "Compare the cap with the real amount you could lose.",
        })

    if _has_any(lower_text, ["penalty", "late fee", "interest", "auto-renew", "renewal"]):
        risks.append({
            "level": "High",
            "title": "Penalty Or Renewal Risk",
            "explanation": "The document may include extra charges, penalties, or renewal rules that are easy to miss.",
            "what_to_do": "Ask for the exact cost, deadline, and cancellation process.",
        })

    risks.append({
        "level": "Medium",
        "title": "Full AI Review Unavailable",
        "explanation": "The full AI analysis did not finish in time, so this is only a quick local scan.",
        "what_to_do": "Treat this dashboard as a starting point and rerun analysis when the AI service responds.",
    })

    if not clauses:
        clauses.append({
            "type": "other",
            "title": "General Terms",
            "description": "The document needs a manual read for key obligations.",
            "why_it_matters": "The fallback summary could not confidently classify the clauses.",
            "action": "Review the document section by section.",
            "value": "Review needed",
        })

    overview = _first_sentence(contract_text)

    return {
        "document_title": title,
        "document_type": "Legal Document",
        "tags": ["Fallback Summary", "Needs Review"],
        "overview": overview,
        "plain_language_summary": "The AI service was slow, so this dashboard uses a quick local scan. It highlights likely payment, deadline, ownership, confidentiality, ending, and risk terms for you to review.",
        "eli15_summary": "This is a quick safety scan, not the full AI explanation. Use it to spot the parts you should check first.",
        "top_takeaways": [
            "The full AI response was not available in time.",
            "Review the highlighted clauses before signing.",
            "Ask clear questions about money, deadlines, penalties, and ownership.",
        ],
        "risk_score": min(60, _estimate_risk_score(risks)),
        "clarity_score": _estimate_clarity_score(contract_text),
        "contract_duration": "Not specified",
        "duration_note": "Check the document for start, end, renewal, or notice terms.",
        "key_clauses": clauses[:8],
        "risks": risks,
        "dates": dates,
        "suggestions": actions,
        "action_items": actions,
        "questions_to_ask": questions,
        "final_advice": "Use this fallback dashboard to find the important sections, then rerun the analysis or review the clauses manually before signing.",
        "confidence_note": f"Fallback summary used because: {reason}",
    }


def summarize_contract(contract_text):
    prompt_text = _trim_contract_text(contract_text)
    prompt = SYSTEM_MESSAGE + "\n\n" + build_prompt(prompt_text)

    try:
        content = _generate_with_gemini(prompt, json_response=True)
    except ValueError as exc:
        summary = _build_fallback_summary(contract_text, str(exc))
        return _normalize_dashboard_summary(summary, contract_text)

    try:
        summary = _parse_json_response(content)
    except (json.JSONDecodeError, ValueError):
        summary = _build_fallback_summary(contract_text, 'Gemini returned an invalid summary format')

    return _normalize_dashboard_summary(summary, contract_text)
