from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / 'data'
CONTRACTS_FILE = DATA_DIR / 'contracts.json'


def init_db():
    DATA_DIR.mkdir(exist_ok=True)

    if not CONTRACTS_FILE.exists():
        CONTRACTS_FILE.write_text('[]', encoding='utf-8')
