from flask import Flask, send_from_directory
from routes.upload import upload_bp
from routes.analyze import analyze_bp
from routes.history import history_bp
from routes.summarize import summarize_bp
from models.contract import init_db

app = Flask(__name__, static_folder='Html', static_url_path='')
app.config['UPLOAD_FOLDER'] = 'uploads'

init_db()

app.register_blueprint(upload_bp)
app.register_blueprint(analyze_bp)
app.register_blueprint(history_bp)
app.register_blueprint(summarize_bp)

@app.route("/")
def home():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/app.html")
def app_page():
    return send_from_directory(app.static_folder, "app.html")


@app.route("/how.html")
def how_page():
    return send_from_directory(app.static_folder, "how.html")


@app.route("/dashboard.html")
def dashboard_page():
    return send_from_directory(app.static_folder, "dashboard.html")


@app.route("/health")
def health():
    return {"status": "ok"}


if __name__ == '__main__':
    app.run(debug=True)
