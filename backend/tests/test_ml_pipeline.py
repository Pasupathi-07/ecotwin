"""Pytest suite for Python ML pipeline and chronological validation."""
from pathlib import Path
import pandas as pd
import pytest

from ml.inspect_data import load_and_inspect_csv
from ml.predict import predict_from_artifact
from ml.train import train_and_save_model


def test_chronological_training_and_inference(tmp_path: Path):
    csv_file = tmp_path / "sample.csv"
    rows = []
    for day in range(1, 45):
        date_str = f"2026-01-{day if day <= 28 else day - 28:02d}"
        month = "01" if day <= 28 else "02"
        full_date = f"2026-{month}-{day if day <= 28 else day - 28:02d}"
        no2 = 20.0 + (day % 12) * 2.5
        wind = 1.5 + (day % 5) * 0.6
        pm25 = 18.0 + no2 * 0.85 - wind * 3.1
        rows.append(
            {
                "date": full_date,
                "location": "Test Station Alpha",
                "pm25": round(pm25, 2),
                "no2": round(no2, 2),
                "so2": 8.5,
                "co": 0.9,
                "o3": 34.0,
                "temperature_c": 26.0,
                "humidity_pct": 65.0,
                "wind_speed_ms": round(wind, 2),
                "rainfall_mm": 0.0,
            }
        )

    pd.DataFrame(rows).to_csv(csv_file, index=False)

    inspected = load_and_inspect_csv(csv_file)
    assert inspected["row_count"] == 44

    trained = train_and_save_model(csv_file, version="v1.0.0-test", save_dir=tmp_path)
    metrics = trained["bundle"]["metrics"]
    assert metrics["mae"] >= 0
    assert metrics["rmse"] >= metrics["mae"]

    pred = predict_from_artifact(
        trained["artifact_path"],
        {
            "pm25_lag1": 35.0,
            "no2": 32.0,
            "so2": 8.5,
            "co": 0.9,
            "o3": 34.0,
            "temperature_c": 26.0,
            "humidity_pct": 65.0,
            "wind_speed_ms": 2.1,
            "rainfall_mm": 0.0,
        },
    )
    assert pred["predicted_value"] > 0

    with pytest.raises(ValueError):
        predict_from_artifact(trained["artifact_path"], {"no2": -15.0})
