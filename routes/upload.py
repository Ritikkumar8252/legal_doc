import os

from flask import Blueprint, current_app, jsonify, request
from werkzeug.utils import secure_filename

from services.extractor import extract_text

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}

upload_bp = Blueprint("upload", __name__)


@upload_bp.route("/upload", methods=["GET", "POST"])
def upload_file():
    if request.method == "GET":
        return jsonify({
            "message": "Use POST request to upload file"
        })

    file = request.files.get("file")

    if file is None:
        return jsonify({
            "error": "No file part in request"
        }), 400

    if not file.filename:
        return jsonify({
            "error": "No file selected"
        }), 400

    filename = secure_filename(file.filename)

    if not filename:
        return jsonify({
            "error": "Invalid filename"
        }), 400

    extension = os.path.splitext(filename)[1].lower()

    if extension not in ALLOWED_EXTENSIONS:
        return jsonify({
            "error": "Unsupported file format. Use PDF, DOCX, or TXT."
        }), 400

    upload_folder = current_app.config.get("UPLOAD_FOLDER", "uploads")
    os.makedirs(upload_folder, exist_ok=True)

    filepath = os.path.join(upload_folder, filename)

    try:
        file.save(filepath)
        text = extract_text(filepath)

    except ValueError as exc:
        return jsonify({
            "error": str(exc)
        }), 400

    except Exception as exc:
        return jsonify({
            "error": f"Unable to process the uploaded file: {exc}"
        }), 500

    if not text.strip():
        return jsonify({
            "error": "No readable text found in uploaded file"
        }), 422

    return jsonify({
        "filename": filename,
        "content": text
    })
