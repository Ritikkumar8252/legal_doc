from flask import Blueprint, jsonify

from services.storage import get_contract, get_history, get_latest_contract

history_bp = Blueprint("history", __name__)


@history_bp.route("/history", methods=["GET"])
def history():
    data = get_history()

    return jsonify(data)


@history_bp.route("/history/latest", methods=["GET"])
def latest_history():
    contract = get_latest_contract()

    if contract is None:
        return jsonify({
            "error": "No analyzed documents found"
        }), 404

    return jsonify(contract)


@history_bp.route("/history/<int:contract_id>", methods=["GET"])
def history_item(contract_id):
    contract = get_contract(contract_id)

    if contract is None:
        return jsonify({
            "error": "Document not found"
        }), 404

    return jsonify(contract)
