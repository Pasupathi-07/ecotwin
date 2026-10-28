"""Reproducible chronological training pipeline for EcoTwin AI."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import joblib
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline

from .evaluate import compute_explainability, evaluate_regression_predictions
from .inspect_data import load_and_inspect_csv
from .preprocess import chronological_train_test_split


DEFAULT_FEATURES = [
    "pm25_lag1",
    "no2",
    "so2",
    "co",
    "o3",
    "temperature_c",
    "humidity_pct",
    "wind_speed_ms",
    "rainfall_mm",
]


def train_and_save_model(
    csv_path: str | Path,
    version: str = "v1.0.0",
    target_col: str = "pm25",
    features: list[str] | None = None,
    n_estimators: int = 60,
    max_depth: int = 10,
    min_samples_leaf: int = 4,
    train_ratio: float = 0.8,
    save_dir: str | Path | None = None,
) -> dict[str, Any]:
    inspected = load_and_inspect_csv(csv_path, target_col=target_col)
    split = chronological_train_test_split(
        inspected["dataframe"],
        target_col=target_col,
        features=features or DEFAULT_FEATURES,
        train_ratio=train_ratio,
    )

    usable_features = split["features"]
    train_df = split["train_df"]
    test_df = split["test_df"]

    X_train = train_df[usable_features]
    y_train = train_df[target_col].to_numpy()
    X_test = test_df[usable_features]
    y_test = test_df[target_col].to_numpy()

    # 1. Ridge Linear Baseline
    linear_pipeline = Pipeline(
        steps=[
            ("preprocessor", split["preprocessor"]),
            ("regressor", Ridge(alpha=1.0)),
        ]
    )
    linear_pipeline.fit(X_train, y_train)
    linear_preds = linear_pipeline.predict(X_test)
    linear_metrics = evaluate_regression_predictions(y_test, linear_preds)

    # 2. Random Forest Regressor Candidate
    from sklearn.base import clone

    rf_pipeline = Pipeline(
        steps=[
            ("preprocessor", clone(split["preprocessor"])),
            (
                "regressor",
                RandomForestRegressor(
                    n_estimators=n_estimators,
                    max_depth=max_depth,
                    min_samples_leaf=min_samples_leaf,
                    random_state=42,
                    n_jobs=-1,
                ),
            ),
        ]
    )
    rf_pipeline.fit(X_train, y_train)
    rf_preds = rf_pipeline.predict(X_test)
    rf_metrics = evaluate_regression_predictions(y_test, rf_preds)

    explainability = compute_explainability(rf_pipeline, X_test, y_test, usable_features)

    out_dir = Path(save_dir) if save_dir else Path(__file__).resolve().parent / "saved_models"
    out_dir.mkdir(parents=True, exist_ok=True)
    artifact_file = out_dir / f"ecotwin_rf_{version}.joblib"

    artifact_bundle = {
        "version": version,
        "target": target_col,
        "unit": "ug/m3",
        "features": usable_features,
        "feature_bounds": split["feature_bounds"],
        "training_period": split["training_period"],
        "test_period": split["test_period"],
        "train_size": len(train_df),
        "test_size": len(test_df),
        "metrics": {
            **rf_metrics,
            "linear_baseline_mae": linear_metrics["mae"],
            "linear_baseline_rmse": linear_metrics["rmse"],
        },
        "feature_importance": explainability,
        "rf_pipeline": rf_pipeline,
        "linear_pipeline": linear_pipeline,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    joblib.dump(artifact_bundle, artifact_file)
    return {"artifact_path": str(artifact_file), "bundle": artifact_bundle}


if __name__ == "__main__":
    default_csv = Path(__file__).resolve().parents[2] / "data" / "datasets" / "demo_regional_air_quality_2025_2026.csv"
    if default_csv.exists():
        result = train_and_save_model(default_csv)
        print("Saved trained artifact:", result["artifact_path"])
        print("Held-out metrics:", result["bundle"]["metrics"])
