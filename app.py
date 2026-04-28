from flask import Flask
from routes.upload import upload_bp
from routes.analyze import analyze_bp
from routes.history import history_bp
from models.contract import init_db

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'

init_db()

app.register_blueprint(upload_bp)
app.register_blueprint(analyze_bp)
app.register_blueprint(history_bp)

@app.route("/")
def home():
    return "Backend is running"
if __name__ == '__main__':
    app.run(debug=True)