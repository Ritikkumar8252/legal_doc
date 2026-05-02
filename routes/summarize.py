from flask import Blueprint, jsonify, request

from services.ai_service import summarize_contract
from services.storage import save_contract

summarize_bp = Blueprint("summarize", __name__)


@summarize_bp.route("/summarize", methods=["POST"])
def summarize():
    payload = request.get_json(silent=True)

    if payload is None:
        return jsonify({
            "error": "Request body must be valid JSON"
        }), 400

    contract_text = payload.get("contract", "")
    filename = payload.get("filename", "uploaded_document")

    if isinstance(contract_text, str):
        contract_text = contract_text.strip()

    if not contract_text:
        return jsonify({
            "error": "Document text missing"
        }), 400

    try:
        summary = summarize_contract(contract_text)
        contract_id = save_contract(filename, contract_text, summary)

    except ValueError as exc:
        return jsonify({
            "error": str(exc)
        }), 400

    except Exception as exc:
        return jsonify({
            "error": f"Unable to summarize document right now: {exc}"
        }), 500

    return jsonify({
        "id": contract_id,
        "filename": filename,
        "summary": summary
    })
