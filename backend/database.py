"""SQLAlchemy ORM database schema for local SQLite (and PostgreSQL-ready) storage."""
from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

SQLALCHEMY_DATABASE_URL = "sqlite:///./ecotwin.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False} if SQLALCHEMY_DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Dataset(Base):
    __tablename__ = "datasets"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(160), nullable=False)
    source = Column(String(240), nullable=False)
    file_path = Column(String(400), nullable=False)
    uploaded_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    row_count = Column(Integer, nullable=False)
    column_schema = Column(Text, nullable=False)
    date_range = Column(Text, nullable=False)
    validation_status = Column(String(40), nullable=False)


class ModelVersion(Base):
    __tablename__ = "model_versions"
    id = Column(Integer, primary_key=True, index=True)
    dataset_id = Column(Integer, ForeignKey("datasets.id"), nullable=False)
    model_name = Column(String(160), nullable=False)
    version = Column(String(40), nullable=False)
    target = Column(String(60), nullable=False)
    features = Column(Text, nullable=False)
    training_period = Column(Text, nullable=False)
    test_period = Column(Text, nullable=False)
    metrics = Column(Text, nullable=False)
    artifact_path = Column(String(400), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    is_active = Column(Boolean, default=False, index=True)


class Prediction(Base):
    __tablename__ = "predictions"
    id = Column(Integer, primary_key=True, index=True)
    model_version_id = Column(Integer, ForeignKey("model_versions.id"), nullable=False)
    location = Column(String(140), nullable=False, index=True)
    input_payload = Column(Text, nullable=False)
    predicted_value = Column(Float, nullable=False)
    unit = Column(String(24), default="ug/m3")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class Scenario(Base):
    __tablename__ = "scenarios"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(180), nullable=False)
    baseline_inputs = Column(Text, nullable=False)
    modified_inputs = Column(Text, nullable=False)
    baseline_output = Column(Float, nullable=False)
    modified_output = Column(Float, nullable=False)
    model_version_id = Column(Integer, ForeignKey("model_versions.id"), nullable=False)
    assumptions = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class Report(Base):
    __tablename__ = "reports"
    id = Column(Integer, primary_key=True, index=True)
    report_name = Column(String(180), nullable=False)
    report_type = Column(String(40), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    file_path = Column(String(400), nullable=False)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
