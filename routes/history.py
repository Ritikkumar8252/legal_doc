from flask import Blueprint, jsonify

from services.storage import get_history

history_bp = Blueprint('history', __name__)

@history_bp.route('/history', methods=['GET'])
def history():
    data = get_history()
    return jsonify(data)
