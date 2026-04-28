from flask import Blueprint, jsonify, request

from services.ai_service import analyze_contract
from services.storage import save_contract

analyze_bp = Blueprint('analyze', __name__)

@analyze_bp.route('/analyze', methods=['POST'])
def analyze():
    payload = request.get_json(silent=True)
    if payload is None:
        return jsonify({'error': 'Request body must be valid JSON'}), 400

    contract_text = payload.get('contract', '')
    if isinstance(contract_text, str):
        contract_text = contract_text.strip()

    if not contract_text:
        return jsonify({'error': 'Contract text missing'}), 400

    try:
        result = analyze_contract(contract_text)
        contract_id = save_contract('manual_input', contract_text, result)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception:
        return jsonify({'error': 'Unable to analyze contract right now'}), 500

    return jsonify({
        'id': contract_id,
        'analysis': result
    })
