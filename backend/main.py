"""Standalone FastAPI backend for Windows VS Code local execution."""
from __future__ import annotations

import json
from pathlib import Path
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import Dataset, ModelVersion, Prediction, Scenario, SessionLocal, init_db
from ml.inspect_data import load_and_inspect_csv
from ml.predict import predict_from_artifact
from ml.train import train_and_save_model

init_db()

app = FastAPI(
    title="EcoTwin AI — Environmental Decision Support API",
    version="1.0.0",
    description="Local environmental risk prediction, scenario comparison, and dataset QA service.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173"],
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class PredictionPayload(BaseModel):
    location: str = Field(..., min_length=1, max_length=120)
    observation_date: str
    inputs: dict[str, float | None]
    model_version_id: int | None = None


class ScenarioComparePayload(BaseModel):
    name: str = "Scenario Estimate"
    location: str
    baseline_inputs: dict[str, float]
    modified_inputs: dict[str, float]
    model_version_id: int | None = None


@app.get("/api/health")
def health_check(db: Session = Depends(get_db)):
    ds_count = db.query(Dataset).count()
    active = db.query(ModelVersion).filter(ModelVersion.is_active.is_(True)).first()
    return {
        "status": "ok",
        "service": "EcoTwin AI Python FastAPI Backend",
        "datasets_count": ds_count,
        "active_model": {"id": active.id, "version": active.version} if active else None,
    }


@app.get("/api/datasets")
def list_datasets(db: Session = Depends(get_db)):
    rows = db.query(Dataset).order_by(Dataset.id.desc()).all()
    return {"datasets": rows}


@app.post("/api/datasets/upload")
async def upload_dataset(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are accepted.")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="CSV file exceeds 10 MB limit.")

    safe_name = Path(file.filename).name
    dest = UPLOAD_DIR / safe_name
    dest.write_bytes(content)

    try:
        info = load_and_inspect_csv(dest)
    except ValueError as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    record = Dataset(
        name=safe_name,
        source="Uploaded CSV",
        file_path=str(dest),
        row_count=info["row_count"],
        column_schema=json.dumps(info["feature_columns"]),
        date_range=json.dumps(info["date_range"]),
        validation_status="Valid",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"dataset": record}


@app.post("/api/models/train")
def train_endpoint(dataset_id: int, activate: bool = False, db: Session = Depends(get_db)):
    ds = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found.")

    count = db.query(ModelVersion).count()
    ver = f"v1.{count}.0"
    trained = train_and_save_model(ds.file_path, version=ver)
    bundle = trained["bundle"]

    if activate or count == 0:
        db.query(ModelVersion).update({ModelVersion.is_active: False})

    mv = ModelVersion(
        dataset_id=ds.id,
        model_name="EcoTwin Random Forest PM2.5 Regressor",
        version=ver,
        target=bundle["target"],
        features=json.dumps(bundle["features"]),
        training_period=json.dumps(bundle["training_period"]),
        test_period=json.dumps(bundle["test_period"]),
        metrics=json.dumps(bundle["metrics"]),
        artifact_path=trained["artifact_path"],
        is_active=(activate or count == 0),
    )
    db.add(mv)
    db.commit()
    db.refresh(mv)
    return {"model": mv}


@app.post("/api/predictions")
def create_prediction(payload: PredictionPayload, db: Session = Depends(get_db)):
    mv = (
        db.query(ModelVersion).filter(ModelVersion.id == payload.model_version_id).first()
        if payload.model_version_id
        else db.query(ModelVersion).filter(ModelVersion.is_active.is_(True)).first()
    )
    if not mv:
        raise HTTPException(status_code=400, detail="No active trained model available.")

    try:
        res = predict_from_artifact(mv.artifact_path, payload.inputs)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    pred = Prediction(
        model_version_id=mv.id,
        location=payload.location,
        input_payload=json.dumps(payload.inputs),
        predicted_value=res["predicted_value"],
        unit=res["unit"],
    )
    db.add(pred)
    db.commit()
    db.refresh(pred)
    return {"prediction": {**res, "id": pred.id, "location": payload.location}}


@app.post("/api/scenarios/compare")
def compare_scenario(payload: ScenarioComparePayload, db: Session = Depends(get_db)):
    mv = (
        db.query(ModelVersion).filter(ModelVersion.id == payload.model_version_id).first()
        if payload.model_version_id
        else db.query(ModelVersion).filter(ModelVersion.is_active.is_(True)).first()
    )
    if not mv:
        raise HTTPException(status_code=400, detail="No active trained model available.")

    base_res = predict_from_artifact(mv.artifact_path, payload.baseline_inputs)
    mod_res = predict_from_artifact(mv.artifact_path, payload.modified_inputs)
    diff = round(mod_res["predicted_value"] - base_res["predicted_value"], 2)

    sc = Scenario(
        name=payload.name,
        baseline_inputs=json.dumps(payload.baseline_inputs),
        modified_inputs=json.dumps(payload.modified_inputs),
        baseline_output=base_res["predicted_value"],
        modified_output=mod_res["predicted_value"],
        model_version_id=mv.id,
        assumptions=json.dumps(["Evaluated via trained Random Forest artifact without hardcoded overrides."]),
    )
    db.add(sc)
    db.commit()
    return {
        "scenario": {
            "name": payload.name,
            "baseline_output": base_res["predicted_value"],
            "modified_output": mod_res["predicted_value"],
            "abs_diff": diff,
            "warnings": list(set(base_res["warnings"] + mod_res["warnings"])),
        }
    }
