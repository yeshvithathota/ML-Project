from pathlib import Path
from typing import Any

import pandas as pd
import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi import Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
DATA_DIR = Path(os.getenv("DATA_DIR", str(ROOT / "data")))
DATA_DIR.mkdir(exist_ok=True)
TARGET = "customer_segment"
ID_COLUMNS = {"customer_id", "id"}
app = FastAPI(title="Customer Category Prediction API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
bearer = HTTPBearer(auto_error=False)

model: Pipeline | None = None
features: list[str] = []
classes: list[str] = []
metrics: dict[str, Any] | None = None
class_rows: list[dict[str, Any]] = []
confusion: dict[str, Any] | None = None
row_count = 0
error_message: str | None = None


class Customer(BaseModel):
    values: dict[str, Any]


class LoginRequest(BaseModel):
    username: str
    password: str


class SignupRequest(BaseModel):
    username: str
    password: str


def b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def issue_token(username: str, role: str) -> str:
    payload = b64encode(json.dumps({"username": username, "role": role, "exp": int(time.time()) + 86400}, separators=(",", ":")).encode())
    signature = b64encode(hmac.new(os.environ["APP_SECRET"].encode(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{signature}"


def account_db():
    connection = sqlite3.connect(DATA_DIR / "accounts.sqlite3")
    connection.execute("CREATE TABLE IF NOT EXISTS accounts (username TEXT PRIMARY KEY COLLATE NOCASE, salt TEXT NOT NULL, password_hash TEXT NOT NULL)")
    return connection


def hash_password(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)


def read_dataset(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, sep=None, engine="python", encoding="utf-8-sig")
    df.columns = [str(column).strip() for column in df.columns]
    target_aliases = {"customersegment", "customercategory", "segment", "category"}
    target_column = next((column for column in df.columns if "".join(ch for ch in column.lower() if ch.isalnum()) in target_aliases), None)
    if target_column is None:
        raise ValueError(f"CSV needs a customer category column such as '{TARGET}'. Columns found: {', '.join(df.columns[:12])}")
    if target_column != TARGET:
        df = df.rename(columns={target_column: TARGET})
    return df


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if credentials is None:
        raise HTTPException(401, "Please sign in to continue.")
    try:
        payload, signature = credentials.credentials.split(".", 1)
        expected = b64encode(hmac.new(os.environ["APP_SECRET"].encode(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise ValueError("Invalid token")
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if claims["exp"] < int(time.time()) or claims["role"] not in {"admin", "user"}:
            raise ValueError("Expired token")
        return {"username": claims["username"], "role": claims["role"]}
    except Exception as exc:
        raise HTTPException(401, "Your session has expired. Please sign in again.") from exc


def train_from_csv(path: Path) -> None:
    global model, features, classes, metrics, class_rows, confusion, row_count, error_message
    try:
        df = read_dataset(path)
        df = df.drop_duplicates().dropna(subset=[TARGET]).copy()
        df[TARGET] = df[TARGET].astype(str)
        features = [c for c in df.columns if c != TARGET and c.lower() not in ID_COLUMNS]
        if not features:
            raise ValueError("No usable feature columns were found.")
        X, y = df[features], df[TARGET]
        counts = y.value_counts()
        if len(counts) < 2 or counts.min() < 2:
            raise ValueError("Need at least two categories, with at least two rows in each category.")
        numeric = X.select_dtypes(include="number").columns.tolist()
        categorical = [c for c in features if c not in numeric]
        transformers = []
        if numeric:
            transformers.append(("numeric", Pipeline([("imputer", SimpleImputer(strategy="median")), ("scaler", StandardScaler())]), numeric))
        if categorical:
            transformers.append(("categorical", Pipeline([("imputer", SimpleImputer(strategy="most_frequent")), ("onehot", OneHotEncoder(handle_unknown="ignore"))]), categorical))
        preprocessor = ColumnTransformer(transformers)
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
        candidate = Pipeline([("preprocessor", preprocessor), ("classifier", LogisticRegression(max_iter=1000))])
        candidate.fit(X_train, y_train)
        pred = candidate.predict(X_test)
        class_names = candidate.named_steps["classifier"].classes_.tolist()
        cm = confusion_matrix(y_test, pred, labels=class_names)
        model, classes, row_count = candidate, class_names, len(df)
        metrics = {"accuracy": round(accuracy_score(y_test, pred), 4), "precision": round(precision_score(y_test, pred, average="weighted", zero_division=0), 4), "recall": round(recall_score(y_test, pred, average="weighted", zero_division=0), 4), "f1": round(f1_score(y_test, pred, average="weighted", zero_division=0), 4), "test_count": len(y_test)}
        class_report = __import__("sklearn.metrics", fromlist=["classification_report"]).classification_report(y_test, pred, labels=class_names, output_dict=True, zero_division=0)
        class_rows = [{"name": name, "precision": round(class_report[name]["precision"], 3), "recall": round(class_report[name]["recall"], 3), "f1": round(class_report[name]["f1-score"], 3), "support": int(class_report[name]["support"])} for name in class_names]
        confusion = {"labels": class_names, "matrix": cm.tolist()}
        error_message = None
    except Exception as exc:
        model, metrics, confusion = None, None, None
        error_message = str(exc)


def load_default_data() -> None:
    candidates = [DATA_DIR / "customer_data.csv", ROOT / "customer_data.csv"]
    for candidate in candidates:
        if candidate.exists():
            train_from_csv(candidate)
            return


load_default_data()


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/login")
def login(request: LoginRequest):
    if not os.getenv("APP_SECRET"):
        raise HTTPException(503, "Set APP_SECRET before enabling sign-in.")
    accounts = [
        ("admin", os.getenv("ADMIN_USERNAME"), os.getenv("ADMIN_PASSWORD")),
        ("user", os.getenv("USER_USERNAME"), os.getenv("USER_PASSWORD")),
    ]
    for role, username, password in accounts:
        if username and password and hmac.compare_digest(request.username, username) and hmac.compare_digest(request.password, password):
            if not os.getenv("APP_SECRET"):
                raise HTTPException(503, "Set APP_SECRET before enabling sign-in.")
            return {"token": issue_token(username, role), "username": username, "role": role}
    with account_db() as connection:
        row = connection.execute("SELECT username, salt, password_hash FROM accounts WHERE username = ?", (request.username.strip(),)).fetchone()
    if row:
        salt = base64.urlsafe_b64decode(row[1])
        stored_hash = base64.urlsafe_b64decode(row[2])
        if hmac.compare_digest(hash_password(request.password, salt), stored_hash):
            return {"token": issue_token(row[0], "user"), "username": row[0], "role": "user"}
    # Keep error the same whether username or password was wrong.
    secrets.compare_digest(request.password, "invalid")
    raise HTTPException(401, "Incorrect username or password.")


@app.post("/api/signup")
def signup(request: SignupRequest):
    if not os.getenv("APP_SECRET"):
        raise HTTPException(503, "Set APP_SECRET before enabling sign-in.")
    username = request.username.strip()
    if len(username) < 3 or len(username) > 32 or not all(ch.isalnum() or ch in "._-" for ch in username):
        raise HTTPException(422, "Username must be 3–32 characters and use only letters, numbers, dot, underscore, or hyphen.")
    if len(request.password) < 10:
        raise HTTPException(422, "Password must be at least 10 characters.")
    admin_name = os.getenv("ADMIN_USERNAME", "")
    configured_user = os.getenv("USER_USERNAME", "")
    if username.casefold() in {x.casefold() for x in [admin_name, configured_user] if x}:
        raise HTTPException(409, "That username is reserved. Choose another one.")
    salt = secrets.token_bytes(16)
    salt_text = b64encode(salt)
    hash_text = b64encode(hash_password(request.password, salt))
    try:
        with account_db() as connection:
            connection.execute("INSERT INTO accounts (username, salt, password_hash) VALUES (?, ?, ?)", (username, salt_text, hash_text))
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "That username is already registered. Sign in or choose another one.") from exc
    return {"token": issue_token(username, "user"), "username": username, "role": "user"}


@app.get("/api/status")
def status(user=Depends(current_user)):
    return {"ready": model is not None, "error": error_message, "rows": row_count, "classes": classes, "features": feature_schema() if model else [], "user": user}


def feature_schema():
    if model is None:
        return []
    # Pull types and categories from the fitted preprocessor's training feature names.
    pre = model.named_steps["preprocessor"]
    result = []
    for name in features:
        transformer_name, transformer, columns = next((item for item in pre.transformers_ if name in item[2]), (None, None, []))
        categorical = transformer_name == "categorical"
        choices = []
        if categorical:
            try:
                position = columns.index(name)
                choices = [str(x) for x in transformer.named_steps["onehot"].categories_[position].tolist()]
            except Exception:
                choices = []
        series_type = "number" if transformer_name == "numeric" else "text"
        result.append({"name": name, "type": series_type, "choices": choices})
    return result


@app.get("/api/analytics")
def analytics(user=Depends(current_user)):
    if model is None:
        return {"ready": False, "error": error_message, "rows": 0, "segments": [], "metrics": None, "class_metrics": [], "confusion": None}
    # Re-open current CSV for observed segment distribution.
    path = next((p for p in [DATA_DIR / "customer_data.csv", ROOT / "customer_data.csv"] if p.exists()), None)
    counts = read_dataset(path)[TARGET].dropna().astype(str).value_counts() if path else pd.Series(dtype=int)
    segments = [{"name": str(k), "count": int(v)} for k, v in counts.items()]
    return {"ready": True, "rows": row_count, "segments": segments, "metrics": metrics, "class_metrics": class_rows, "confusion": confusion}


@app.post("/api/predict")
def predict(customer: Customer, user=Depends(current_user)):
    if model is None:
        raise HTTPException(503, "Model is not trained yet. Add customer_data.csv to the data folder and restart the API.")
    missing = [name for name in features if name not in customer.values]
    if missing:
        raise HTTPException(422, f"Missing values for: {', '.join(missing)}")
    row = pd.DataFrame([{name: customer.values[name] for name in features}], columns=features)
    try:
        prediction = str(model.predict(row)[0])
        probabilities = model.predict_proba(row)[0]
        scores = sorted([{"name": name, "probability": round(float(prob), 4)} for name, prob in zip(classes, probabilities)], key=lambda x: x["probability"], reverse=True)
        return {"category": prediction, "confidence": scores[0]["probability"], "probabilities": scores}
    except Exception as exc:
        raise HTTPException(400, f"Could not make prediction: {exc}") from exc


@app.post("/api/upload")
async def upload_dataset(file: UploadFile = File(...), user=Depends(current_user)):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Upload a CSV file.")
    dest = DATA_DIR / "customer_data.csv"
    contents = await file.read()
    if len(contents) > 50_000_000:
        raise HTTPException(413, "CSV must be smaller than 50 MB.")
    dest.write_bytes(contents)
    train_from_csv(dest)
    if model is None:
        raise HTTPException(400, error_message or "Training failed.")
    return {"ready": True, "rows": row_count, "classes": classes, "features": feature_schema()}
