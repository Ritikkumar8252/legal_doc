import json
from datetime import datetime

from models.contract import CONTRACTS_FILE, init_db


def _backup_corrupted_store():
    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
    backup_path = CONTRACTS_FILE.with_name(f'{CONTRACTS_FILE.stem}.corrupt.{timestamp}.json')
    CONTRACTS_FILE.replace(backup_path)
    CONTRACTS_FILE.write_text('[]', encoding='utf-8')


def _load_contracts():
    init_db()

    try:
        raw_data = CONTRACTS_FILE.read_text(encoding='utf-8')
        data = json.loads(raw_data)
    except json.JSONDecodeError:
        _backup_corrupted_store()
        return []

    if not isinstance(data, list):
        _backup_corrupted_store()
        return []

    return data


def _write_contracts(contracts):
    CONTRACTS_FILE.write_text(
        json.dumps(contracts, ensure_ascii=True, indent=2),
        encoding='utf-8'
    )


def save_contract(filename, content, analysis):
    contracts = _load_contracts()
    next_id = max((item.get('id', 0) for item in contracts), default=0) + 1

    contract = {
        'id': next_id,
        'filename': filename,
        'content': content,
        'analysis': analysis,
        'created_at': datetime.now().isoformat(timespec='seconds'),
    }

    contracts.append(contract)
    _write_contracts(contracts)
    return next_id


def get_history():
    contracts = _load_contracts()
    return sorted(contracts, key=lambda item: item.get('id', 0), reverse=True)


def get_latest_contract():
    contracts = get_history()

    if not contracts:
        return None

    return contracts[0]


def get_contract(contract_id):
    contracts = _load_contracts()

    for contract in contracts:
        if contract.get('id') == contract_id:
            return contract

    return None
