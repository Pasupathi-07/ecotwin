# EcoTwin AI — Environmental Risk Prediction and Decision Support System

EcoTwin AI is a software-only **Environmental Digital-Twin & Decision Support System** designed for academic environmental data science, air-quality analytics, local machine-learning experimentation, geospatial exploration, what-if scenario comparison, and explainable rule-based recommendations.

It requires **zero physical IoT hardware**, **zero paid cloud AI APIs**, and **zero external API keys**.

---

## 1. Project Overview

Urban and regional environmental planners routinely face fragmented historical monitoring archives, opaque black-box forecasts, and unverified policy simulations. EcoTwin AI unifies historical CSV datasets, leak-free chronological regression pipelines, geospatial mapping, perturbation simulations, and threshold-linked recommendations inside a cohesive workspace.

## 2. Problem Statement

Conventional student and prototype environmental dashboards frequently suffer from fabricated "live" IoT readings, hardcoded scenario multipliers, target-leaking random splits on time-series data, or reliance on paid external LLM APIs. Decision-makers and researchers need an honest, reproducible local workbench where every displayed number carries explicit provenance (`Observed`, `Historical`, `Model prediction`, `Demonstration data`, or `Hypothetical scenario`).

## 3. Objectives

1. Ingest, audit, clean, and explore multi-station environmental CSV datasets with transparent missingness and duplicate diagnostics.
2. Train and evaluate baseline models (Mean, Persistence `t-1`, Ridge Linear Regression) alongside a **Random Forest Regressor** using strict chronological train/test splits.
3. Provide schema-checked PM2.5 estimates with ensemble interquartile dispersion (`P25–P75`), feature importance, and out-of-bounds extrapolation warnings.
4. Visualize station observations and ML estimates on an interactive Leaflet geographical map without fabricated coordinates.
5. Enable side-by-side Baseline vs. Modified scenario simulations (`Scenario Estimate`) backed by real model inference.
6. Generate deterministic, rule-referenced environmental advisories and export structured 12-section PDF and CSV reports.

## 4. Features

- **Overview Dashboard**: 6 data-driven KPI cards with inline sparklines, multi-pollutant trends, monthly profiles, station comparisons, held-out test overlays, and separated Observed vs. Model alerts.
- **Environmental Twin Workspace**: Interactive Leaflet map (CARTO OpenStreetMap dark/light tiles), dispersion halo toggle, AI estimate layer, station detail drawer, and inline perturbation controls.
- **AI Predictions Module**: Validated input form matched to the active model's feature schema, 1-click station prefill, ensemble spread, *"How This Estimate Was Produced"* transparency panel, and persisted SQLite history with multi-record comparison.
- **Scenario Lab**: Interactive feature sliders with training-domain `[min, max]` indicators, extrapolation warnings, assumption summaries, Recharts visual comparisons, and saved scenario reload/export.
- **Dataset Explorer**: Client-side PapaParse CSV preview before upload, schema & summary statistics table, cleaned CSV download, and paginated TanStack Table browser.
- **Model Laboratory**: Versioned model registry (never silently overwrites active models), MAE/RMSE/R² metrics, Actual-vs-Predicted test curve, Residual Error Histogram, Permutation Importance, and hyperparameter retraining controls.
- **Recommendations Engine**: Deterministic rules (`AQ-01`..`AQ-03`, `MET-01`, `VEG-01`, `DQ-01`..`DQ-03`, `ML-01`..`ML-02`) referencing WHO 2021 and CPCB NAAQS benchmarks.
- **Reports Module**: 12-section PDF synthesis (`jsPDF` + `jspdf-autotable`) plus direct CSV exports for observations, predictions, and scenarios.
- **Settings**: Switch between CPCB NAAQS (`60 ug/m3`) and WHO 2021 (`15 ug/m3`) standards, Dark (`#0B1220`) and Light (`#F8FAFC`) themes, table density, and reduced motion.

## 5. Technology Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Framer Motion (`motion/react`), Recharts, Leaflet, React Hook Form, Zod, TanStack Table v8, PapaParse, jsPDF, Lucide React.
- **Integrated Full-Stack Runtime (`server.ts`)**: Node.js 22+, Express, built-in `node:sqlite` (`WAL` mode), Multer, native TypeScript Random Forest & Ridge Regression engine (`server/ml/`).
- **Standalone Python Backend (`backend/`)**: Python 3.10+, FastAPI, Pydantic v2, Pandas, NumPy, Scikit-learn, Joblib, SQLAlchemy (SQLite / PostgreSQL-ready), Uvicorn, pytest.
- **Testing**: Vitest (`npm test`) and pytest (`pytest`).

> **Architectural Compatibility Note**: The integrated Node.js + Express + `node:sqlite` server (`npm run dev` on port `3000`) runs the entire full-stack application out-of-the-box with zero Python setup hurdles, while `backend/` provides the complete standalone Python FastAPI + Scikit-learn + SQLAlchemy implementation for two-terminal Windows VS Code workflows.

## 6. System Architecture

```text
[ CSV Archives / User Uploads ]
              │
              ▼
[ Inspection & Chronological Split Pipeline ]
   ├── Deduplication & negative-value sanitization
   ├── Strictly past lag-1 feature generation (per station)
   └── Leak-free X_train median imputer + feature bounds
              │
              ▼
[ Candidate & Baseline ML Training ] ──► [ Saved Model Artifacts ]
   ├── Mean & Persistence Baselines
   ├── Ridge Linear Regression
   └── Random Forest Regressor + Permutation Importance
              │
              ▼
[ Local SQLite Database ] ◄──► [ REST API (/api/*) ] ◄──► [ React UI Workspace ]
```

## 7. Folder Structure

```text
├── backend/                     # Standalone Python FastAPI + Scikit-learn suite
│   ├── database.py              # SQLAlchemy ORM models (Dataset, ModelVersion, etc.)
│   ├── main.py                  # FastAPI REST endpoints & OpenAPI docs
│   ├── requirements.txt         # Pinned Python dependencies
│   ├── ml/
│   │   ├── inspect_data.py      # Pandas CSV validation & cleaning
│   │   ├── preprocess.py        # Chronological split & lag engineering
│   │   ├── train.py             # Ridge + Random Forest training & Joblib export
│   │   ├── evaluate.py          # MAE, RMSE, R2 & permutation importance
│   │   └── predict.py           # Schema-checked inference & bounds warnings
│   └── tests/
│       └── test_ml_pipeline.py  # Pytest verification suite
├── data/                        # Runtime SQLite DB, demo CSVs & saved model JSONs (gitignored)
├── docs/
│   ├── DATASET_SCHEMA.md        # Expected CSV columns & physical bounds
│   └── MODEL_EVALUATION_TEMPLATE.md
├── server/                      # Integrated Node.js/TypeScript backend & ML engine
│   ├── db.ts                    # node:sqlite persistence & initial seeding
│   ├── recommendations.ts       # Deterministic rule-based recommendation engine
│   ├── routes.ts                # Express REST endpoints (/api/*)
│   ├── stations.ts              # Station coordinate lookup & demo dataset generator
│   └── ml/                      # Inspect, preprocess, CART Random Forest & Ridge
├── src/                         # React + TypeScript Frontend
│   ├── components/              # AppShell, EnvironmentalMap, reusable Primitives
│   ├── context/                 # WorkspaceContext state & persistent settings
│   ├── lib/                     # Typed API client & PDF/CSV export utilities
│   ├── pages/                   # All 9 functional workspace modules
│   ├── types/                   # Strict TypeScript interfaces
│   └── __tests__/               # Vitest automated test suite
├── server.ts                    # Unified Express + Vite entry point (Port 3000)
├── package.json
└── .env.example
```

## 8. Prerequisites

- **Node.js** `v22.5+` (includes native `node:sqlite`) and `npm`
- **Python** `3.11+` (optional, for running the standalone `backend/` FastAPI + Scikit-learn scripts)
- **Visual Studio Code** (recommended IDE)

## 9. Windows Installation Instructions

Clone or extract the project folder and open it in **Visual Studio Code**:

```powershell
cd ecotwin-ai
Copy-Item .env.example .env
```

## 10. Virtual Environment Setup (Python Backend Option)

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

*Windows PowerShell ExecutionPolicy Troubleshooting*: If PowerShell blocks `Activate.ps1`, run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## 11. Dependency Installation

**Frontend & Integrated Full-Stack Server (Root Directory):**

```powershell
npm install
```

**Python FastAPI + Scikit-Learn Backend (`backend/` Directory):**

```powershell
cd backend
pip install -r requirements.txt
```

## 12. Dataset Preparation

On initial startup, EcoTwin AI automatically generates two clearly labeled sample datasets in `data/datasets/`:
- `demo_regional_air_quality_2025_2026.csv` (1,080 records across 6 stations)
- `demo_compact_station_test.csv` (120 records across 2 stations)

Both are explicitly flagged:
> `"DEMO DATA — Illustrative or sample data, not live environmental observations."`

To analyze real observations, download daily station CSVs from **CPCB CAAQMS** or **OpenAQ**, format columns per `docs/DATASET_SCHEMA.md`, and upload them via **Dataset Explorer**.

## 13. Model Training

- **Via UI**: Open **Model Laboratory**, select any dataset, choose features and Random Forest hyperparameters, and click **Run Chronological Training**.
- **Via Python CLI**:
  ```powershell
  cd backend
  python -m ml.train
  ```

## 14. Backend Startup

- **Integrated Mode (Recommended — Single Command from Root)**:
  `npm run dev` starts both the REST API (`/api/*`) and React frontend on `http://localhost:3000`.
- **Standalone Python FastAPI Mode**:
  ```powershell
  cd backend
  uvicorn main:app --reload --port 8000
  ```
  (Set `VITE_API_BASE_URL=http://127.0.0.1:8000` in `.env` when routing the frontend to FastAPI on port 8000.)

## 15. Frontend Startup

```powershell
npm run dev
```

Open `http://localhost:3000` in your browser.

## 16. Database Initialization

Both `server/db.ts` (SQLite at `data/ecotwin.sqlite`) and `backend/database.py` (SQLAlchemy SQLite at `backend/ecotwin.db`) automatically create all required tables, foreign keys, and indexes on startup.

## 17. API Documentation Access

- Health verification: `GET http://localhost:3000/api/health`
- When running Python FastAPI (`uvicorn main:app --reload --port 8000`): Interactive Swagger OpenAPI UI is served at `http://127.0.0.1:8000/docs`.

## 18. Testing Instructions

Run the automated TypeScript ML, preprocessing, and recommendation tests:

```powershell
npm test
```

Run the Python Scikit-learn pipeline tests (inside activated `.venv`):

```powershell
cd backend
pytest
```

## 19. Known Limitations

1. **Bundled Sample Data**: Out-of-the-box CSV archives are deterministic demonstration datasets for software validation and must not be cited as regulatory measurements.
2. **Tree Extrapolation Bounds**: Random Forest models partition feature space within historical `[min, max]` bounds and cannot extrapolate linear trends for extreme unseen inputs.
3. **Conditional Scenario Estimates**: Scenario Lab computes conditional statistical associations (`Scenario Estimate`) rather than atmospheric chemical-transport dispersion physics (e.g., WRF-Chem / CMAQ).

## 20. Future Enhancements

- Spatial kriging / inverse-distance weighting across dense urban sensor grids.
- Dedicated multi-output water-quality (`pH`, `DO`, `turbidity`) and satellite `NDVI` time-series modules.
- Optional PostgreSQL + PostGIS adapter for multi-institution research deployments.

## 21. Dataset Citations, Standards & Licensing

- **WHO (2021)**: *WHO Global Air Quality Guidelines: Particulate matter (PM2.5 and PM10), ozone, nitrogen dioxide, sulfur dioxide and carbon monoxide.* World Health Organization (24-hr PM2.5 guideline: `15 ug/m3`).
- **CPCB NAAQS**: Central Pollution Control Board, India — *National Ambient Air Quality Standards* (24-hr PM2.5 standard: `60 ug/m3`; 24-hr PM10 standard: `100 ug/m3`).
- **Base Map Tiles**: © OpenStreetMap contributors, © CARTO (free attribution-compliant raster tiles).
