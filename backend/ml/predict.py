"""Schema-validated inference module for EcoTwin AI."""
from __future__ import annotations

from pathlib import Path
from typing import Any
import joblib
import numpy as np
import pandas as pd


def predict_from_artifact(artifact_path: str | Path, input_payload: dict[str, float | None]) -> dict[str, Any]:
    bundle = joblib.load(artifact_path)
    features: list[str] = bundle["features"]
    bounds: dict[str, dict[str, float]] = bundle["feature_bounds"]

    provided = [f for f in features if input_payload.get(f) is not None]
    if not provided:
        raise ValueError(f"Incompatible input payload: none of required features {features} were provided.")

    warnings: list[str] = []
    row_dict: dict[str, float] = {}
    for feat in features:
        val = input_payload.get(feat)
        if val is None or not np.isfinite(val):
            row_dict[feat] = np.nan
            warnings.append(f"Imputed omitted feature '{feat}' using training median.")
        else:
            if feat in {"pm25_lag1", "pm10", "no2", "so2", "co", "o3", "wind_speed_ms", "rainfall_mm"} and val < 0:
                raise ValueError(f"Physical indicator '{feat}' cannot be negative ({val}).")
            b = bounds.get(feat)
            if b and (val < b["min"] or val > b["max"]):
                warnings.append(
                    f"Feature '{feat}' ({val}) is outside training range [{b['min']}, {b['max']}]."
                )
            row_dict[feat] = float(val)

    X_in = pd.DataFrame([row_dict], columns=features)
    rf_pred = float(bundle["rf_pipeline"].predict(X_in)[0])
    lin_pred = float(bundle["linear_pipeline"].predict(X_in)[0])

    return {
        "predicted_value": round(max(0.0, rf_pred), 2),
        "linear_comparison_value": round(max(0.0, lin_pred), 2),
        "unit": bundle["unit"],
        "version": bundle["version"],
        "warnings": warnings,
    }
