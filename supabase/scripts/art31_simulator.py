"""Durable, explicitly synthetic protocol-v2 feeder used by ART-31 development."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.request
import uuid
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Callable
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


DEVICE_IDS = {
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
}
DEVELOPMENT_HOST = "giilhohmrytpgyeyysir.supabase.co"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
FIXED_PORTION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
ACTIVE_STATES = ("accepted", "running", "settling", "unknown")
SIMULATOR_MAX_CLOCK_UNCERTAINTY_MS = 1_000
SIMULATOR_MAX_SETTLING_MS = 1_000
SIMULATOR_SCHEDULER_WAKE_GRACE_MS = 30_000
SIMULATOR_PROFILE = {
    "max_schedules": 8,
    "max_clock_uncertainty_ms": SIMULATOR_MAX_CLOCK_UNCERTAINTY_MS,
    "maximum_settling_ms": SIMULATOR_MAX_SETTLING_MS,
    "scheduler_wake_grace_ms": SIMULATOR_SCHEDULER_WAKE_GRACE_MS,
    "nozzles": {
        1: {"enabled": True, "dose_modes": ["grams"], "fixed_portion_ids": [], "min_dose_g": 5.0, "max_dose_g": 100.0, "dose_step_g": 1.0, "max_actuation_ms": 15_000},
        2: {"enabled": True, "dose_modes": ["grams"], "fixed_portion_ids": [], "min_dose_g": 5.0, "max_dose_g": 100.0, "dose_step_g": 1.0, "max_actuation_ms": 15_000},
    },
}


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def valid_uuid(value: object) -> bool:
    return isinstance(value, str) and UUID_RE.fullmatch(value) is not None


def parse_time(value: object) -> dt.datetime:
    if not isinstance(value, str):
        raise ValueError("trusted UTC timestamp is missing")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("trusted UTC timestamp is invalid") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("trusted UTC timestamp must include a timezone")
    return parsed.astimezone(dt.timezone.utc)


def format_time(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def validated_targets(value: object) -> list[dict]:
    if not isinstance(value, list) or not 1 <= len(value) <= 2:
        raise ValueError("invalid command targets")
    targets: list[dict] = []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("invalid command target")
        if not {"nozzle_number", "dose"}.issubset(item):
            raise ValueError("invalid command target")
        nozzle = item["nozzle_number"]
        dose = item["dose"]
        if isinstance(nozzle, bool) or nozzle not in (1, 2) or not isinstance(dose, dict):
            raise ValueError("invalid command target")
        if dose.get("mode") == "grams" and "amount_g" in dose:
            amount = dose["amount_g"]
            if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not math.isfinite(amount) or amount <= 0:
                raise ValueError("invalid gram dose")
            normalized_dose = {"mode": "grams", "amount_g": amount}
        elif dose.get("mode") == "fixed_portion" and "fixed_portion_id" in dose:
            portion = dose["fixed_portion_id"]
            if not isinstance(portion, str) or not FIXED_PORTION_RE.fullmatch(portion):
                raise ValueError("invalid fixed portion")
            normalized_dose = {"mode": "fixed_portion", "fixed_portion_id": portion}
        else:
            raise ValueError("unsupported dose")
        targets.append({"nozzle_number": nozzle, "dose": normalized_dose})
    numbers = [target["nozzle_number"] for target in targets]
    if numbers not in ([1], [2], [1, 2]):
        raise ValueError("targets must be unique and ordered nozzle 1 then nozzle 2")
    return targets


def command_semantic(command: dict, device_id: str) -> dict:
    targets = validated_targets(command.get("targets"))
    if command.get("device_id", "").lower() != device_id:
        raise ValueError("command belongs to a different device")
    for key in ("command_id", "sequence_id", "request_id", "idempotency_key"):
        if not valid_uuid(command.get(key)):
            raise ValueError("command identity is invalid")
    if command["command_id"].lower() != command["sequence_id"].lower():
        raise ValueError("command and sequence identities differ")
    revision = command.get("capabilities_revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise ValueError("command capability revision is invalid")
    if command.get("status") != "queued":
        raise ValueError("command is not ready for delivery")
    start_before = format_time(parse_time(command.get("start_before")))
    created_at = format_time(parse_time(command["created_at"])) if command.get("created_at") is not None else None
    wake_grace = command.get("scheduler_wake_grace_ms")
    if (isinstance(wake_grace, bool) or
            (wake_grace is not None and (not isinstance(wake_grace, int) or wake_grace < 0)) or
            (len(targets) == 2 and wake_grace is None)):
        raise ValueError("command sequence deadline is invalid")
    return {
        "device_id": device_id,
        "sequence_id": command["sequence_id"].lower(),
        "idempotency_key": command["idempotency_key"].lower(),
        "capabilities_revision": revision,
        "created_at": created_at,
        "start_before": start_before,
        "scheduler_wake_grace_ms": wake_grace,
        "targets": targets,
    }


class Simulator:
    def __init__(self, db_path: Path, device_id: str, capabilities_revision: int = 2, settle_ms: int = 50):
        self.device_id = device_id.lower()
        if self.device_id not in DEVICE_IDS:
            raise ValueError("only the two approved development simulator fixtures are supported")
        if not 0 <= settle_ms <= 5000:
            raise ValueError("settle interval must be between 0 and 5000 ms")
        self.capabilities_revision = capabilities_revision
        self.settle_seconds = settle_ms / 1000
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(db_path, isolation_level=None, timeout=30)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS intents (
              device_id TEXT NOT NULL,
              sequence_id TEXT PRIMARY KEY,
              command_id TEXT NOT NULL,
              request_id TEXT NOT NULL,
              idempotency_key TEXT NOT NULL,
              capabilities_revision INTEGER NOT NULL,
              scheduler_wake_grace_ms INTEGER,
              next_event_sequence INTEGER NOT NULL DEFAULT 1,
              start_before TEXT NOT NULL,
              targets_json TEXT NOT NULL,
              semantic_json TEXT NOT NULL,
              state TEXT NOT NULL,
              current_step_index INTEGER,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(device_id, idempotency_key)
            );
            CREATE UNIQUE INDEX IF NOT EXISTS one_simulated_reservation
              ON intents(device_id) WHERE state IN ('accepted', 'running', 'settling', 'unknown');
            CREATE TABLE IF NOT EXISTS results (
              sequence_id TEXT NOT NULL REFERENCES intents(sequence_id),
              step_index INTEGER NOT NULL,
              nozzle_number INTEGER NOT NULL,
              requested_dose_json TEXT NOT NULL,
              status TEXT NOT NULL,
              measurement_quality TEXT NOT NULL,
              measured_dispensed_g REAL,
              start_before TEXT,
              PRIMARY KEY(sequence_id, step_index)
            );
            CREATE TABLE IF NOT EXISTS outbox (
              sequence_id TEXT NOT NULL,
              event_sequence INTEGER NOT NULL,
              payload_json TEXT NOT NULL,
              PRIMARY KEY(sequence_id, event_sequence)
            );
            CREATE TABLE IF NOT EXISTS telemetry_outbox (
              row_id INTEGER PRIMARY KEY AUTOINCREMENT,
              boot_id TEXT NOT NULL,
              sample_sequence INTEGER NOT NULL,
              sample_json TEXT NOT NULL,
              UNIQUE(boot_id, sample_sequence)
            );
            CREATE TABLE IF NOT EXISTS configuration_state (
              device_id TEXT PRIMARY KEY,
              desired_revision INTEGER,
              applied_revision INTEGER,
              desired_json TEXT,
              applied_json TEXT,
              last_attempt_revision INTEGER,
              last_attempt_status TEXT,
              error_code TEXT
            );
            CREATE TABLE IF NOT EXISTS scheduled_runs (
              device_id TEXT NOT NULL,
              sequence_id TEXT PRIMARY KEY,
              configuration_revision INTEGER NOT NULL,
              due_at TEXT NOT NULL,
              occurrence_local_date TEXT NOT NULL,
              targets_json TEXT NOT NULL,
              state TEXT NOT NULL,
              current_step_index INTEGER,
              next_event_sequence INTEGER NOT NULL DEFAULT 1,
              started_at TEXT,
              completed_at TEXT,
              reason_code TEXT,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS scheduled_run_steps (
              sequence_id TEXT NOT NULL REFERENCES scheduled_runs(sequence_id),
              step_index INTEGER NOT NULL,
              schedule_id TEXT NOT NULL,
              occurrence_local_date TEXT NOT NULL,
              configuration_revision INTEGER NOT NULL,
              nozzle_number INTEGER NOT NULL,
              requested_dose_json TEXT NOT NULL,
              status TEXT NOT NULL,
              measurement_quality TEXT NOT NULL,
              measured_dispensed_g REAL,
              start_before TEXT,
              baseline_ready_at TEXT,
              PRIMARY KEY(sequence_id, step_index)
            );
            CREATE TABLE IF NOT EXISTS scheduled_occurrences (
              device_id TEXT NOT NULL,
              schedule_id TEXT NOT NULL,
              occurrence_local_date TEXT NOT NULL,
              sequence_id TEXT NOT NULL REFERENCES scheduled_runs(sequence_id),
              configuration_revision INTEGER NOT NULL,
              outcome TEXT NOT NULL,
              PRIMARY KEY(device_id, schedule_id, occurrence_local_date)
            );
            """
        )
        self._ensure_column("intents", "scheduler_wake_grace_ms", "INTEGER")
        added_event_counter = self._ensure_column(
            "intents", "next_event_sequence", "INTEGER NOT NULL DEFAULT 1"
        )
        self._ensure_column("results", "start_before", "TEXT")
        if added_event_counter:
            self.db.execute(
                """UPDATE intents SET next_event_sequence = COALESCE(
                     (SELECT MAX(event_sequence) + 1 FROM outbox WHERE outbox.sequence_id=intents.sequence_id),
                     CASE state WHEN 'accepted' THEN 2 WHEN 'running' THEN 3
                       WHEN 'settling' THEN 4 ELSE next_event_sequence END)"""
            )
        self._set_meta("boot_id", str(uuid.uuid4()))
        self._set_meta("live_sequence", self._get_meta("live_sequence") or "0")
        self._trusted_server_time: dt.datetime | None = None
        self._trusted_server_monotonic: float | None = None
        self._scheduler_boot_started_at = dt.datetime.now(dt.timezone.utc)
        self._scheduler_clock_valid = True
        self._scheduler_clock_pair = (self._scheduler_boot_started_at, time.monotonic())

    def _ensure_column(self, table: str, name: str, definition: str) -> bool:
        columns = {row["name"] for row in self.db.execute(f"PRAGMA table_info({table})")}
        if name in columns:
            return False
        self.db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
        return True

    def observe_server_time(
        self,
        server_time: object,
        round_trip_seconds: float = 0,
        monotonic_now: float | None = None,
    ):
        if not math.isfinite(round_trip_seconds) or not 0 <= round_trip_seconds <= 15:
            raise ValueError("server time observation exceeded its bounded request window")
        self._trusted_server_time = parse_time(server_time) + dt.timedelta(seconds=round_trip_seconds)
        self._trusted_server_monotonic = time.monotonic() if monotonic_now is None else monotonic_now

    def trusted_now(self) -> dt.datetime:
        if self._trusted_server_time is None or self._trusted_server_monotonic is None:
            raise ValueError("simulator has no fresh server-time observation")
        elapsed = time.monotonic() - self._trusted_server_monotonic
        if not 0 <= elapsed <= 60:
            raise ValueError("simulator server-time observation is stale")
        return self._trusted_server_time + dt.timedelta(seconds=elapsed)

    @contextmanager
    def transaction(self):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            yield
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise

    def close(self):
        self.db.close()

    def _get_meta(self, key: str) -> str | None:
        row = self.db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row["value"] if row else None

    def _set_meta(self, key: str, value: str):
        self.db.execute("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))

    def configuration_report(self) -> dict:
        row = self.db.execute(
            "SELECT applied_revision,last_attempt_revision,last_attempt_status,error_code FROM configuration_state WHERE device_id=?",
            (self.device_id,),
        ).fetchone()
        return {
            "applied_revision": row["applied_revision"] if row else None,
            "last_attempt_revision": row["last_attempt_revision"] if row else None,
            "last_attempt_status": row["last_attempt_status"] if row else None,
            "error_code": row["error_code"] if row else None,
        }

    def _configuration_snapshot_is_valid(self, snapshot: object) -> str | None:
        if not isinstance(snapshot, dict) or set(snapshot) != {
            "revision", "based_on_revision", "timezone", "monitoring_limits", "low_feed_threshold_pct", "schedules"
        }:
            return "VALIDATION_FAILED"
        revision = snapshot["revision"]
        base = snapshot["based_on_revision"]
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1 or isinstance(base, bool) or not isinstance(base, int) or base < 0:
            return "VALIDATION_FAILED"
        timezone = snapshot["timezone"]
        try:
            ZoneInfo(timezone)
        except (TypeError, ZoneInfoNotFoundError):
            return "VALIDATION_FAILED"
        limits = snapshot["monitoring_limits"]
        if not isinstance(limits, dict) or set(limits) != {"do_low_mg_l", "do_high_mg_l"}:
            return "VALIDATION_FAILED"
        for value in limits.values():
            if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0):
                return "VALIDATION_FAILED"
        threshold = snapshot["low_feed_threshold_pct"]
        if threshold is not None and (isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not math.isfinite(threshold) or not 0 <= threshold <= 100):
            return "VALIDATION_FAILED"
        schedules = snapshot["schedules"]
        if not isinstance(schedules, list) or len(schedules) > SIMULATOR_PROFILE["max_schedules"]:
            return "CAPABILITY_MISMATCH"
        seen: set[str] = set()
        parsed: list[dict] = []
        for schedule in schedules:
            if not isinstance(schedule, dict) or set(schedule) != {"schedule_id", "local_time", "weekdays", "enabled", "dose", "nozzle_number"}:
                return "VALIDATION_FAILED"
            schedule_id = schedule["schedule_id"]
            nozzle_number = schedule["nozzle_number"]
            local_time = schedule["local_time"]
            weekdays = schedule["weekdays"]
            if not valid_uuid(schedule_id) or schedule_id.lower() in seen or isinstance(nozzle_number, bool) or nozzle_number not in (1, 2):
                return "VALIDATION_FAILED"
            seen.add(schedule_id.lower())
            if not isinstance(schedule["enabled"], bool) or not isinstance(local_time, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", local_time):
                return "VALIDATION_FAILED"
            if not isinstance(weekdays, list) or not 1 <= len(weekdays) <= 7 or any(isinstance(day, bool) or not isinstance(day, int) or not 1 <= day <= 7 for day in weekdays) or len(set(weekdays)) != len(weekdays):
                return "VALIDATION_FAILED"
            nozzle = SIMULATOR_PROFILE["nozzles"][nozzle_number]
            if not nozzle["enabled"]:
                return "CAPABILITY_MISMATCH"
            dose = schedule["dose"]
            if not isinstance(dose, dict):
                return "VALIDATION_FAILED"
            if dose.get("mode") == "grams" and set(dose) == {"mode", "amount_g"}:
                amount = dose["amount_g"]
                if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not math.isfinite(amount):
                    return "VALIDATION_FAILED"
                step_count = (amount - nozzle["min_dose_g"]) / nozzle["dose_step_g"]
                if amount < nozzle["min_dose_g"] or amount > nozzle["max_dose_g"] or abs(step_count - round(step_count)) > 1e-8:
                    return "DOSE_OUT_OF_RANGE"
            elif dose.get("mode") == "fixed_portion" and set(dose) == {"mode", "fixed_portion_id"}:
                if dose["fixed_portion_id"] not in nozzle["fixed_portion_ids"]:
                    return "DOSE_UNSUPPORTED"
            else:
                return "DOSE_UNSUPPORTED"
            parsed.append(schedule)
        for index, left in enumerate(parsed):
            for right in parsed[index + 1:]:
                if left["nozzle_number"] == right["nozzle_number"] and left["local_time"] == right["local_time"] and set(left["weekdays"]) & set(right["weekdays"]):
                    return "VALIDATION_FAILED"
        return None

    def apply_configuration(self, snapshot: object) -> dict:
        row = self.db.execute("SELECT * FROM configuration_state WHERE device_id=?", (self.device_id,)).fetchone()
        current_applied = json.loads(row["applied_json"]) if row and row["applied_json"] else None
        current_attempt = row["last_attempt_revision"] if row else None
        snapshot_record = snapshot if isinstance(snapshot, dict) else {}
        revision = snapshot_record.get("revision")
        based_on = snapshot_record.get("based_on_revision")
        desired_json = canonical_json(snapshot_record)
        if isinstance(revision, int) and row and current_attempt == revision:
            if row["desired_json"] == desired_json:
                return self.configuration_report()
            error_code = "IDEMPOTENCY_CONFLICT"
        else:
            error_code = self._configuration_snapshot_is_valid(snapshot)
            expected_base = current_attempt if current_attempt is not None else (row["applied_revision"] if row else 0)
            if error_code is None and based_on != expected_base:
                error_code = "CONFIG_CONFLICT"
            if error_code is None and current_applied is not None and (
                snapshot_record["monitoring_limits"] != current_applied["monitoring_limits"] or
                snapshot_record["low_feed_threshold_pct"] != current_applied["low_feed_threshold_pct"]
            ):
                error_code = "VALIDATION_FAILED"
        if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
            return {**self.configuration_report(), "last_attempt_status": "rejected", "error_code": "VALIDATION_FAILED"}
        status = "rejected" if error_code else "applied"
        applied_json = desired_json if error_code is None else (row["applied_json"] if row else None)
        applied_revision = revision if error_code is None else (row["applied_revision"] if row else None)
        with self.transaction():
            self.db.execute(
                """INSERT INTO configuration_state(device_id,desired_revision,applied_revision,desired_json,applied_json,last_attempt_revision,last_attempt_status,error_code)
                   VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET
                   desired_revision=excluded.desired_revision,applied_revision=excluded.applied_revision,
                   desired_json=excluded.desired_json,applied_json=excluded.applied_json,
                   last_attempt_revision=excluded.last_attempt_revision,last_attempt_status=excluded.last_attempt_status,error_code=excluded.error_code""",
                (self.device_id, revision, applied_revision, desired_json, applied_json, revision, status, error_code),
            )
        return self.configuration_report()

    def _append_event(
        self,
        sequence_id: str,
        step_index: int,
        nozzle_number: int,
        dose: dict,
        event_type: str,
        quality: str = "unavailable",
        measured: float | None = None,
        reason: str | None = None,
    ):
        row = self.db.execute("SELECT command_id FROM intents WHERE sequence_id=?", (sequence_id,)).fetchone()
        if not row:
            raise ValueError("intent missing before event creation")
        event_sequence = self.db.execute(
            "SELECT next_event_sequence FROM intents WHERE sequence_id=?", (sequence_id,)
        ).fetchone()["next_event_sequence"]
        self.db.execute(
            "UPDATE intents SET next_event_sequence=? WHERE sequence_id=?",
            (event_sequence + 1, sequence_id),
        )
        trusted = self._trusted_server_time is not None and self._trusted_server_monotonic is not None
        event = {
            "sequence_id": sequence_id,
            "event_sequence": event_sequence,
            "event_type": event_type,
            "outcome_status": event_type,
            "source": "manual",
            "device_at": format_time(self.trusted_now()) if trusted else utc_now(),
            "time_quality": "synced" if trusted else "uncertain",
            "command_id": row["command_id"],
            "schedule_id": None,
            "configuration_revision": None,
            "occurrence_local_date": None,
            "requested_dose": dose,
            "estimated_dispensed_g": None,
            "measured_dispensed_g": measured,
            "measurement_quality": quality,
            "reason_code": reason,
            "maintenance_resolution": None,
            "lockout_cleared": False,
            "nozzle_number": nozzle_number,
            "step_index": step_index,
        }
        self.db.execute(
            "INSERT INTO outbox(sequence_id,event_sequence,payload_json) VALUES(?,?,?)",
            (sequence_id, event_sequence, canonical_json(event)),
        )
        return event

    def _append_schedule_event(
        self,
        sequence_id: str,
        step_index: int,
        target: dict,
        event_type: str,
        revision: int,
        occurrence_date: str,
        reason: str | None = None,
        quality: str = "unavailable",
        measured: float | None = None,
        now: dt.datetime | None = None,
        clock_valid: bool = True,
    ):
        row = self.db.execute("SELECT next_event_sequence FROM scheduled_runs WHERE sequence_id=?", (sequence_id,)).fetchone()
        if not row:
            raise ValueError("scheduled run is missing before event creation")
        event_sequence = row["next_event_sequence"]
        self.db.execute("UPDATE scheduled_runs SET next_event_sequence=? WHERE sequence_id=?", (event_sequence + 1, sequence_id))
        event = {
            "sequence_id": sequence_id,
            "event_sequence": event_sequence,
            "event_type": event_type,
            "outcome_status": event_type,
            "source": "scheduled",
            "device_at": format_time(now) if clock_valid and now else None,
            "time_quality": "rtc" if clock_valid else "invalid",
            "command_id": None,
            "schedule_id": target["schedule_id"],
            "configuration_revision": revision,
            "occurrence_local_date": occurrence_date,
            "requested_dose": target["dose"],
            "estimated_dispensed_g": None,
            "measured_dispensed_g": measured if quality == "valid" else None,
            "measurement_quality": quality,
            "reason_code": reason,
            "maintenance_resolution": None,
            "lockout_cleared": False,
            "nozzle_number": target["nozzle_number"],
            "step_index": step_index,
        }
        self.db.execute("INSERT INTO outbox(sequence_id,event_sequence,payload_json) VALUES(?,?,?)", (sequence_id, event_sequence, canonical_json(event)))
        return event

    def _simulator_clock(self, explicit_now: dt.datetime | None = None):
        if explicit_now is not None:
            instant = explicit_now.astimezone(dt.timezone.utc)
            return instant, self._scheduler_clock_valid, SIMULATOR_MAX_CLOCK_UNCERTAINTY_MS // 4
        wall = dt.datetime.now(dt.timezone.utc)
        monotonic = time.monotonic()
        previous_wall, previous_monotonic = self._scheduler_clock_pair
        drift_ms = abs((wall - previous_wall).total_seconds() - (monotonic - previous_monotonic)) * 1000
        if drift_ms > SIMULATOR_MAX_CLOCK_UNCERTAINTY_MS:
            self._scheduler_clock_valid = False
        self._scheduler_clock_pair = (wall, monotonic)
        # This bounded wall-clock profile is for the local simulator only.
        return wall, self._scheduler_clock_valid, SIMULATOR_MAX_CLOCK_UNCERTAINTY_MS // 4

    @staticmethod
    def _resolve_local_occurrence(local_date: dt.date, local_time: str, zone: ZoneInfo):
        naive = dt.datetime.combine(local_date, dt.time.fromisoformat(local_time))
        candidates: list[dt.datetime] = []
        for fold in (0, 1):
            candidate = naive.replace(tzinfo=zone, fold=fold).astimezone(dt.timezone.utc)
            if candidate.astimezone(zone).replace(tzinfo=None) == naive and candidate not in candidates:
                candidates.append(candidate)
        return sorted(candidates)

    def _schedule_occurrence_exists(self, schedule_id: str, occurrence_date: str):
        return self.db.execute(
            "SELECT 1 FROM scheduled_occurrences WHERE device_id=? AND schedule_id=? AND occurrence_local_date=?",
            (self.device_id, schedule_id.lower(), occurrence_date),
        ).fetchone() is not None

    def _create_schedule_group(
        self,
        revision: int,
        occurrence_date: str,
        due_at: dt.datetime,
        targets: list[dict],
        now: dt.datetime,
        clock_valid: bool,
        skip_reason: str | None = None,
    ):
        ordered = sorted(targets, key=lambda item: (item["nozzle_number"], item["schedule_id"]))
        if not 1 <= len(ordered) <= 2 or len({target["nozzle_number"] for target in ordered}) != len(ordered):
            raise ValueError("scheduled target group is not a single ordered nozzle sequence")
        sequence_id = str(uuid.uuid4())
        start_before = due_at + dt.timedelta(milliseconds=SIMULATOR_SCHEDULER_WAKE_GRACE_MS)
        with self.transaction():
            if any(self._schedule_occurrence_exists(target["schedule_id"], occurrence_date) for target in ordered):
                return None
            manual_busy = self.db.execute(
                "SELECT 1 FROM intents WHERE device_id=? AND state IN ('accepted','running','settling','unknown') LIMIT 1",
                (self.device_id,),
            ).fetchone() is not None
            schedule_busy = self.db.execute(
                "SELECT 1 FROM scheduled_runs WHERE device_id=? AND state IN ('accepted','running','settling','unknown') LIMIT 1",
                (self.device_id,),
            ).fetchone() is not None
            lockout = self._get_meta("schedule_lockout_sequence") is not None
            reason = skip_reason or ("SIMULATOR_SAFETY_LOCKOUT" if lockout else "SIMULATOR_DEVICE_BUSY" if manual_busy or schedule_busy else None)
            state = "skipped" if reason else "accepted"
            self.db.execute(
                """INSERT INTO scheduled_runs(device_id,sequence_id,configuration_revision,due_at,occurrence_local_date,
                   targets_json,state,current_step_index,next_event_sequence,updated_at,reason_code)
                   VALUES(?,?,?,?,?,?,?,1,1,?,?)""",
                (self.device_id, sequence_id, revision, format_time(due_at), occurrence_date,
                 canonical_json(ordered), state, utc_now(), reason),
            )
            for step_index, target in enumerate(ordered, start=1):
                step_deadline = format_time(start_before) if step_index == 1 else None
                step_state = "not_started" if reason else "accepted"
                self.db.execute(
                    """INSERT INTO scheduled_run_steps(sequence_id,step_index,schedule_id,occurrence_local_date,
                       configuration_revision,nozzle_number,requested_dose_json,status,measurement_quality,start_before)
                       VALUES(?,?,?,?,?,?,?,?,?,?)""",
                    (sequence_id, step_index, target["schedule_id"], occurrence_date, revision,
                     target["nozzle_number"], canonical_json(target["dose"]), step_state, "unavailable", step_deadline),
                )
                self.db.execute(
                    """INSERT INTO scheduled_occurrences(device_id,schedule_id,occurrence_local_date,sequence_id,configuration_revision,outcome)
                       VALUES(?,?,?,?,?,?)""",
                    (self.device_id, target["schedule_id"], occurrence_date, sequence_id, revision, "skipped" if reason else "admitted"),
                )
                if reason:
                    self._append_schedule_event(sequence_id, step_index, target, "skipped", revision, occurrence_date,
                        reason=reason, now=now, clock_valid=clock_valid)
                else:
                    self._append_schedule_event(sequence_id, step_index, target, "accepted", revision, occurrence_date,
                        now=now, clock_valid=clock_valid)
            if reason:
                self.db.execute("UPDATE scheduled_runs SET completed_at=?,updated_at=? WHERE sequence_id=?", (utc_now(), utc_now(), sequence_id))
        return sequence_id if not skip_reason and not manual_busy and not schedule_busy and not lockout else None

    def _finish_schedule(self, sequence_id: str, state: str, reason: str | None = None):
        self.db.execute(
            "UPDATE scheduled_runs SET state=?,reason_code=coalesce(?,reason_code),completed_at=?,updated_at=? WHERE sequence_id=?",
            (state, reason, utc_now(), utc_now(), sequence_id),
        )
        outcome = state if state in ("completed", "unknown", "partial", "failed", "skipped") else "failed"
        self.db.execute("UPDATE scheduled_occurrences SET outcome=? WHERE device_id=? AND sequence_id=?", (outcome, self.device_id, sequence_id))
        if state == "unknown":
            self._set_meta("schedule_lockout_sequence", sequence_id)

    def _stop_schedule(self, sequence_id: str, step_index: int, status: str, reason: str, now: dt.datetime, clock_valid: bool):
        run = self.db.execute("SELECT configuration_revision,occurrence_local_date,targets_json FROM scheduled_runs WHERE sequence_id=?", (sequence_id,)).fetchone()
        targets = json.loads(run["targets_json"])
        current = targets[step_index - 1]
        self.db.execute(
            "UPDATE scheduled_run_steps SET status=?,measurement_quality='unavailable',measured_dispensed_g=NULL WHERE sequence_id=? AND step_index=?",
            (status, sequence_id, step_index),
        )
        self._append_schedule_event(sequence_id, step_index, current, status, run["configuration_revision"],
            run["occurrence_local_date"], reason=reason, now=now, clock_valid=clock_valid)
        for later_index, target in enumerate(targets[step_index:], start=step_index + 1):
            self.db.execute("UPDATE scheduled_run_steps SET status='not_started',measurement_quality='unavailable',measured_dispensed_g=NULL WHERE sequence_id=? AND step_index=?", (sequence_id, later_index))
            self._append_schedule_event(sequence_id, later_index, target, "not_started", run["configuration_revision"],
                run["occurrence_local_date"], reason="SIMULATOR_SEQUENCE_STOPPED", now=now, clock_valid=clock_valid)
        if status == "unknown":
            self._finish_schedule(sequence_id, "unknown", reason)
        elif status == "not_started":
            self._finish_schedule(sequence_id, "partial" if step_index > 1 else "skipped", reason)
        elif step_index == 1 and len(targets) == 2:
            self._finish_schedule(sequence_id, "failed", reason)
        elif step_index > 1:
            self._finish_schedule(sequence_id, "partial", reason)
        else:
            self._finish_schedule(sequence_id, "failed", reason)

    def _execute_schedule_group(self, sequence_id: str, scenario: str, on_actuation: Callable[[str, int], None] | None, explicit_now: dt.datetime | None = None):
        run = self.db.execute("SELECT * FROM scheduled_runs WHERE sequence_id=?", (sequence_id,)).fetchone()
        if not run or run["state"] != "accepted":
            return
        targets = json.loads(run["targets_json"])
        due_at = parse_time(run["due_at"])
        first_deadline = parse_time(self.db.execute("SELECT start_before FROM scheduled_run_steps WHERE sequence_id=? AND step_index=1", (sequence_id,)).fetchone()["start_before"])
        if self.settle_seconds * 1000 > SIMULATOR_MAX_SETTLING_MS:
            self._stop_schedule(sequence_id, 1, "not_started", "SIMULATOR_SETTLING_LIMIT", due_at, False)
            return
        for step_index, target in enumerate(targets, start=1):
            now, clock_valid, uncertainty = self._simulator_clock(explicit_now)
            if not clock_valid or uncertainty > SIMULATOR_MAX_CLOCK_UNCERTAINTY_MS:
                self._stop_schedule(sequence_id, step_index, "not_started", "SIMULATOR_CLOCK_UNTRUSTED", now, False)
                return
            if step_index == 1:
                deadline = first_deadline
            else:
                deadline_value = self.db.execute("SELECT start_before FROM scheduled_run_steps WHERE sequence_id=? AND step_index=?", (sequence_id, step_index)).fetchone()["start_before"]
                if not deadline_value:
                    self._stop_schedule(sequence_id, step_index, "not_started", "SIMULATOR_SETTLED_BASELINE_UNAVAILABLE", now, clock_valid)
                    return
                deadline = parse_time(deadline_value)
            if now > deadline:
                self._stop_schedule(sequence_id, step_index, "expired" if step_index == 1 else "not_started", "SIMULATOR_START_DEADLINE_EXPIRED", now, clock_valid)
                return
            with self.transaction():
                self.db.execute("UPDATE scheduled_runs SET state='running',current_step_index=?,started_at=coalesce(started_at,?),updated_at=? WHERE sequence_id=? AND state IN ('accepted','settling')", (step_index, format_time(now), utc_now(), sequence_id))
                self.db.execute("UPDATE scheduled_run_steps SET status='running' WHERE sequence_id=? AND step_index=?", (sequence_id, step_index))
                self._append_schedule_event(sequence_id, step_index, target, "running", run["configuration_revision"], run["occurrence_local_date"], now=now, clock_valid=True)
            started = time.monotonic()
            if on_actuation:
                on_actuation(sequence_id, step_index)
            elapsed_ms = (time.monotonic() - started) * 1000
            nozzle_capability = SIMULATOR_PROFILE["nozzles"][target["nozzle_number"]]
            if elapsed_ms > nozzle_capability["max_actuation_ms"]:
                now, _, _ = self._simulator_clock(explicit_now)
                self._stop_schedule(sequence_id, step_index, "unknown", "SIMULATOR_ACTUATION_LIMIT_EXCEEDED", now, False)
                return
            if self.settle_seconds:
                time.sleep(self.settle_seconds)
            now, clock_valid, uncertainty = self._simulator_clock(explicit_now)
            if not clock_valid or uncertainty > SIMULATOR_MAX_CLOCK_UNCERTAINTY_MS:
                self._stop_schedule(sequence_id, step_index, "unknown", "SIMULATOR_CLOCK_UNTRUSTED", now, False)
                return
            nozzle = target["nozzle_number"]
            if scenario == f"unknown-nozzle{nozzle}":
                self._stop_schedule(sequence_id, step_index, "unknown", "SIMULATOR_STOP_UNCERTAIN", now, clock_valid)
                return
            if scenario == f"fault-nozzle{nozzle}":
                self.db.execute("UPDATE scheduled_run_steps SET status='failed',measurement_quality='error' WHERE sequence_id=? AND step_index=?", (sequence_id, step_index))
                self._append_schedule_event(sequence_id, step_index, target, "failed", run["configuration_revision"], run["occurrence_local_date"], reason="SIMULATOR_FAULT", quality="error", now=now, clock_valid=clock_valid)
                if step_index < len(targets):
                    self.db.execute("UPDATE scheduled_run_steps SET status='not_started' WHERE sequence_id=? AND step_index=?", (sequence_id, step_index + 1))
                    self._append_schedule_event(sequence_id, step_index + 1, targets[step_index], "not_started", run["configuration_revision"], run["occurrence_local_date"], reason="SIMULATOR_SEQUENCE_STOPPED", now=now, clock_valid=clock_valid)
                self._finish_schedule(sequence_id, "partial" if step_index > 1 else "failed", "SIMULATOR_FAULT")
                return
            dose = target["dose"]
            invalid_measurement = scenario == f"invalid-weighing-nozzle{nozzle}"
            measured = None if invalid_measurement else round(float(dose["amount_g"]) * 0.98, 2)
            quality = "error" if invalid_measurement else "valid"
            with self.transaction():
                self.db.execute("UPDATE scheduled_run_steps SET status='completed',measurement_quality=?,measured_dispensed_g=?,baseline_ready_at=? WHERE sequence_id=? AND step_index=?", (quality, measured, format_time(now) if quality == "valid" else None, sequence_id, step_index))
                self._append_schedule_event(sequence_id, step_index, target, "completed", run["configuration_revision"], run["occurrence_local_date"], reason="SIMULATOR_MEASUREMENT_INVALID" if invalid_measurement else None, quality=quality, measured=measured, now=now, clock_valid=True)
                if step_index < len(targets) and quality == "valid":
                    second_deadline = now + dt.timedelta(milliseconds=SIMULATOR_SCHEDULER_WAKE_GRACE_MS)
                    self.db.execute("UPDATE scheduled_run_steps SET start_before=?,baseline_ready_at=? WHERE sequence_id=? AND step_index=?", (format_time(second_deadline), format_time(now), sequence_id, step_index + 1))
                    self.db.execute("UPDATE scheduled_runs SET state='settling',updated_at=? WHERE sequence_id=?", (utc_now(), sequence_id))
                elif step_index < len(targets):
                    self.db.execute("UPDATE scheduled_run_steps SET status='not_started' WHERE sequence_id=? AND step_index=?", (sequence_id, step_index + 1))
                    self._append_schedule_event(sequence_id, step_index + 1, targets[step_index], "not_started", run["configuration_revision"], run["occurrence_local_date"], reason="SIMULATOR_MEASUREMENT_INVALID", now=now, clock_valid=True)
                    self._finish_schedule(sequence_id, "partial", "SIMULATOR_MEASUREMENT_INVALID")
                    return
                else:
                    self._finish_schedule(sequence_id, "completed")

    def run_due_schedules(self, scenario: str = "normal", on_actuation: Callable[[str, int], None] | None = None, now: dt.datetime | None = None):
        row = self.db.execute("SELECT applied_json FROM configuration_state WHERE device_id=?", (self.device_id,)).fetchone()
        if not row or not row["applied_json"]:
            return
        snapshot = json.loads(row["applied_json"])
        zone = ZoneInfo(snapshot["timezone"])
        instant, clock_valid, uncertainty = self._simulator_clock(now)
        local_now = instant.astimezone(zone)
        occurrence_date = local_now.date().isoformat()
        groups: dict[dt.datetime, list[dict]] = {}
        missed: dict[str, tuple[dt.datetime, list[dict], str]] = {}
        for schedule in snapshot["schedules"]:
            if not schedule["enabled"] or local_now.isoweekday() not in schedule["weekdays"]:
                continue
            schedule_id = schedule["schedule_id"].lower()
            if self._schedule_occurrence_exists(schedule_id, occurrence_date):
                continue
            candidates = self._resolve_local_occurrence(local_now.date(), schedule["local_time"], zone)
            target = {"schedule_id": schedule_id, "nozzle_number": schedule["nozzle_number"], "dose": schedule["dose"]}
            if not candidates:
                if local_now.strftime("%H:%M") >= schedule["local_time"]:
                    missed.setdefault(dt.datetime.combine(local_now.date(), dt.time.fromisoformat(schedule["local_time"]), zone).astimezone(dt.timezone.utc), (dt.datetime.combine(local_now.date(), dt.time.fromisoformat(schedule["local_time"]), zone).astimezone(dt.timezone.utc), [], "SIMULATOR_DST_GAP"))[1].append(target)
                continue
            # PostgreSQL resolves ambiguous local times using the post-transition standard offset.
            due = candidates[-1]
            if due < self._scheduler_boot_started_at:
                missed.setdefault(due, (due, [], "SIMULATOR_RESTART_NO_CATCH_UP"))[1].append(target)
            elif instant > due + dt.timedelta(milliseconds=SIMULATOR_SCHEDULER_WAKE_GRACE_MS):
                missed.setdefault(due, (due, [], "SIMULATOR_START_DEADLINE_EXPIRED"))[1].append(target)
            elif due <= instant:
                groups.setdefault(due, []).append(target)
        if not clock_valid or uncertainty > SIMULATOR_MAX_CLOCK_UNCERTAINTY_MS:
            for due, targets in groups.items():
                missed[due] = (due, targets, "SIMULATOR_CLOCK_UNTRUSTED")
            groups.clear()
        for due, targets, reason in missed.values():
            remaining = [target for target in targets if not self._schedule_occurrence_exists(target["schedule_id"], occurrence_date)]
            if remaining:
                self._create_schedule_group(snapshot["revision"], occurrence_date, due, remaining, instant, clock_valid, reason)
        for due, targets in sorted(groups.items()):
            consumed = [target for target in targets if self._schedule_occurrence_exists(target["schedule_id"], occurrence_date)]
            if consumed:
                targets = [target for target in targets if not self._schedule_occurrence_exists(target["schedule_id"], occurrence_date)]
                if not targets:
                    continue
            if self.settle_seconds * 1000 > SIMULATOR_MAX_SETTLING_MS:
                self._create_schedule_group(snapshot["revision"], occurrence_date, due, targets, instant, clock_valid, "SIMULATOR_SETTLING_LIMIT")
                continue
            sequence_id = self._create_schedule_group(snapshot["revision"], occurrence_date, due, targets, instant, clock_valid)
            if sequence_id:
                self._execute_schedule_group(sequence_id, scenario, on_actuation, now)

    def accept_command(self, command: dict) -> bool:
        semantic = command_semantic(command, self.device_id)
        sequence_id = semantic["sequence_id"]
        targets = semantic["targets"]
        semantic_json = canonical_json(semantic)
        existing = self.db.execute(
            "SELECT sequence_id,semantic_json FROM intents WHERE device_id=? AND idempotency_key=?",
            (self.device_id, semantic["idempotency_key"]),
        ).fetchone()
        if existing:
            if existing["sequence_id"] == sequence_id and existing["semantic_json"] == semantic_json:
                return False
            raise ValueError("IDEMPOTENCY_CONFLICT")
        existing = self.db.execute("SELECT semantic_json FROM intents WHERE sequence_id=?", (sequence_id,)).fetchone()
        if existing:
            if existing["semantic_json"] == semantic_json:
                return False
            raise ValueError("IDEMPOTENCY_CONFLICT")
        if self.db.execute(
            "SELECT 1 FROM intents WHERE device_id=? AND state IN ('accepted','running','settling','unknown')",
            (self.device_id,),
        ).fetchone():
            raise ValueError("DEVICE_BUSY")

        schedule_collision = self.db.execute(
            "SELECT 1 FROM scheduled_runs WHERE device_id=? AND state IN ('accepted','running','settling','unknown') LIMIT 1",
            (self.device_id,),
        ).fetchone() is not None or self._get_meta("schedule_lockout_sequence") is not None
        if semantic["created_at"] is not None:
            schedule_collision = schedule_collision or self.db.execute(
                """SELECT 1 FROM scheduled_runs WHERE device_id=? AND state NOT IN ('skipped','failed','expired')
                   AND due_at>=? AND due_at<=? LIMIT 1""",
                (self.device_id, semantic["created_at"], semantic["start_before"]),
            ).fetchone() is not None

        now = utc_now()
        with self.transaction():
            self.db.execute(
                """INSERT INTO intents(device_id,sequence_id,command_id,request_id,idempotency_key,
                   capabilities_revision,scheduler_wake_grace_ms,start_before,targets_json,semantic_json,
                   state,current_step_index,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?, 'accepted',1,?,?)""",
                (
                    self.device_id,
                    sequence_id,
                    command["command_id"].lower(),
                    command["request_id"].lower(),
                    semantic["idempotency_key"],
                    semantic["capabilities_revision"],
                    semantic["scheduler_wake_grace_ms"],
                    semantic["start_before"],
                    canonical_json(targets),
                    semantic_json,
                    now,
                    now,
                ),
            )
            for step_index, target in enumerate(targets, start=1):
                self.db.execute(
                    "INSERT INTO results(sequence_id,step_index,nozzle_number,requested_dose_json,status,measurement_quality,start_before) VALUES(?,?,?,?, 'accepted','unavailable',?)",
                    (sequence_id, step_index, target["nozzle_number"], canonical_json(target["dose"]),
                     semantic["start_before"] if step_index == 1 else None),
                )
                self._append_event(
                    sequence_id, step_index, target["nozzle_number"], target["dose"], "accepted"
                )
            if schedule_collision:
                for step_index, target in enumerate(targets, start=1):
                    self._set_step(sequence_id, step_index, "rejected", "unavailable", None)
                    self._append_event(
                        sequence_id, step_index, target["nozzle_number"], target["dose"], "rejected",
                        reason="SIMULATOR_SCHEDULE_COLLISION",
                    )
                self._set_intent(sequence_id, "failed", None)
        return True

    def _set_step(self, sequence_id: str, step_index: int, status: str, quality: str, measured: float | None):
        self.db.execute(
            "UPDATE results SET status=?,measurement_quality=?,measured_dispensed_g=? WHERE sequence_id=? AND step_index=?",
            (status, quality, measured, sequence_id, step_index),
        )

    def _set_intent(self, sequence_id: str, state: str, step_index: int | None):
        self.db.execute(
            "UPDATE intents SET state=?,current_step_index=?,updated_at=? WHERE sequence_id=?",
            (state, step_index, utc_now(), sequence_id),
        )

    def _current_targets(self, sequence_id: str) -> list[dict]:
        row = self.db.execute("SELECT targets_json FROM intents WHERE sequence_id=?", (sequence_id,)).fetchone()
        return json.loads(row["targets_json"])

    def _record_stop_before_start(self, sequence_id: str, step_index: int, target: dict, reason: str):
        targets = self._current_targets(sequence_id)
        status = "expired" if step_index == 1 else "not_started"
        self._set_step(sequence_id, step_index, status, "unavailable", None)
        self._append_event(
            sequence_id,
            step_index,
            target["nozzle_number"],
            target["dose"],
            "expired" if reason == "SIMULATOR_START_DEADLINE_EXPIRED" else "not_started",
            reason=reason,
        )
        for later_index, later in enumerate(targets[step_index:], start=step_index + 1):
            self._set_step(sequence_id, later_index, "not_started", "unavailable", None)
            self._append_event(
                sequence_id,
                later_index,
                later["nozzle_number"],
                later["dose"],
                "not_started",
                reason="SIMULATOR_SEQUENCE_STOPPED",
            )
        self._set_intent(sequence_id, "expired" if step_index == 1 else "partial", step_index)

    def execute(self, scenario: str = "normal", on_actuation: Callable[[str, int], None] | None = None):
        with self.transaction():
            intent = self.db.execute(
                "SELECT sequence_id FROM intents WHERE device_id=? AND state='accepted' ORDER BY created_at LIMIT 1",
                (self.device_id,),
            ).fetchone()
            if not intent:
                return
            sequence_id = intent["sequence_id"]
            targets = self._current_targets(sequence_id)
            first = targets[0]
            deadline_row = self.db.execute(
                "SELECT start_before FROM results WHERE sequence_id=? AND step_index=1",
                (sequence_id,),
            ).fetchone()
            if not deadline_row or not deadline_row["start_before"]:
                raise ValueError("first nozzle start deadline is unavailable")
            if self.trusted_now() > parse_time(deadline_row["start_before"]):
                self._record_stop_before_start(
                    sequence_id, 1, first, "SIMULATOR_START_DEADLINE_EXPIRED"
                )
                return
            claimed = self.db.execute(
                "UPDATE intents SET state='running',current_step_index=1,updated_at=? "
                "WHERE sequence_id=? AND state='accepted' AND current_step_index=1",
                (utc_now(), sequence_id),
            ).rowcount
            if claimed != 1:
                return
            self._set_step(sequence_id, 1, "running", "unavailable", None)
            self._append_event(
                sequence_id, 1, first["nozzle_number"], first["dose"], "running"
            )

        for step_index, target in enumerate(targets, start=1):
            nozzle = target["nozzle_number"]
            dose = target["dose"]
            if step_index > 1:
                with self.transaction():
                    current = self.db.execute(
                        "SELECT state,current_step_index FROM intents WHERE sequence_id=?",
                        (sequence_id,),
                    ).fetchone()
                    if not current or current["state"] != "settling" or current["current_step_index"] != step_index - 1:
                        return
                    deadline_row = self.db.execute(
                        "SELECT start_before FROM results WHERE sequence_id=? AND step_index=?",
                        (sequence_id, step_index),
                    ).fetchone()
                    if not deadline_row or not deadline_row["start_before"]:
                        self._record_stop_before_start(
                            sequence_id, step_index, target, "SIMULATOR_DEADLINE_UNAVAILABLE"
                        )
                        return
                    if self.trusted_now() > parse_time(deadline_row["start_before"]):
                        self._record_stop_before_start(
                            sequence_id, step_index, target, "SIMULATOR_START_DEADLINE_EXPIRED"
                        )
                        return
                    claimed = self.db.execute(
                        "UPDATE intents SET state='running',current_step_index=?,updated_at=? "
                        "WHERE sequence_id=? AND state='settling' AND current_step_index=?",
                        (step_index, utc_now(), sequence_id, step_index - 1),
                    ).rowcount
                    if claimed != 1:
                        return
                    self._set_step(sequence_id, step_index, "running", "unavailable", None)
                    self._append_event(sequence_id, step_index, nozzle, dose, "running")
            if on_actuation:
                on_actuation(sequence_id, step_index)
            if self.settle_seconds:
                time.sleep(self.settle_seconds)

            fault = scenario == f"fault-nozzle{nozzle}"
            uncertain = scenario == f"unknown-nozzle{nozzle}"
            invalid_measurement = scenario == f"invalid-weighing-nozzle{nozzle}"
            if fault or uncertain:
                status = "unknown" if uncertain else "failed"
                quality = "unavailable" if uncertain else "error"
                reason = "SIMULATOR_STOP_UNCERTAIN" if uncertain else "SIMULATOR_FAULT"
                with self.transaction():
                    self._set_step(sequence_id, step_index, status, quality, None)
                    self._append_event(sequence_id, step_index, nozzle, dose, status, quality, reason=reason)
                    for later_index, later in enumerate(targets[step_index:], start=step_index + 1):
                        self._set_step(sequence_id, later_index, "not_started", "unavailable", None)
                        self._append_event(
                            sequence_id,
                            later_index,
                            later["nozzle_number"],
                            later["dose"],
                            "not_started",
                            reason="SIMULATOR_SEQUENCE_STOPPED",
                        )
                    self._set_intent(sequence_id, "unknown" if uncertain else ("partial" if step_index > 1 else "failed"), step_index)
                return

            if invalid_measurement:
                quality, measured = "error", None
            elif dose["mode"] == "grams":
                # Deterministic synthetic scale fixture, never a hardware or calibration claim.
                quality, measured = "valid", round(float(dose["amount_g"]) * 0.98, 2)
            else:
                quality, measured = "valid", 1.0

            with self.transaction():
                self._set_step(sequence_id, step_index, "completed", quality, measured)
                completed_event = self._append_event(
                    sequence_id, step_index, nozzle, dose, "completed", quality, measured
                )
                if invalid_measurement and step_index < len(targets):
                    for later_index, later in enumerate(targets[step_index:], start=step_index + 1):
                        self._set_step(sequence_id, later_index, "not_started", "unavailable", None)
                        self._append_event(
                            sequence_id,
                            later_index,
                            later["nozzle_number"],
                            later["dose"],
                            "not_started",
                            reason="SIMULATOR_MEASUREMENT_INVALID",
                        )
                    self._set_intent(sequence_id, "partial", step_index)
                elif step_index < len(targets):
                    deadline = parse_time(completed_event["device_at"]) + dt.timedelta(
                        milliseconds=int(self.db.execute(
                            "SELECT scheduler_wake_grace_ms FROM intents WHERE sequence_id=?",
                            (sequence_id,),
                        ).fetchone()["scheduler_wake_grace_ms"])
                    )
                    self.db.execute(
                        "UPDATE results SET start_before=? WHERE sequence_id=? AND step_index=?",
                        (format_time(deadline), sequence_id, step_index + 1),
                    )
                    self._set_intent(sequence_id, "settling", step_index)
                else:
                    self._set_intent(sequence_id, "completed", step_index)
            if invalid_measurement:
                return

    def recover_after_restart(self):
        rows = self.db.execute(
            "SELECT sequence_id,state,current_step_index FROM intents WHERE device_id=? AND state IN ('accepted','running','settling')",
            (self.device_id,),
        ).fetchall()
        for intent in rows:
            sequence_id = intent["sequence_id"]
            targets = self._current_targets(sequence_id)
            step_index = intent["current_step_index"] or 1
            with self.transaction():
                if intent["state"] == "accepted":
                    for index, target in enumerate(targets, start=1):
                        if index >= step_index:
                            self._set_step(sequence_id, index, "not_started", "unavailable", None)
                            self._append_event(
                                sequence_id,
                                index,
                                target["nozzle_number"],
                                target["dose"],
                                "not_started",
                                reason="SIMULATOR_RESTART_BEFORE_ACTUATION",
                            )
                    self._set_intent(sequence_id, "expired", None)
                elif intent["state"] == "settling":
                    for index, target in enumerate(targets, start=1):
                        if index > step_index:
                            self._set_step(sequence_id, index, "not_started", "unavailable", None)
                            self._append_event(
                                sequence_id,
                                index,
                                target["nozzle_number"],
                                target["dose"],
                                "not_started",
                                reason="SIMULATOR_RESTART_BEFORE_NEXT_NOZZLE",
                            )
                    self._set_intent(sequence_id, "partial", step_index)
                else:
                    target = targets[step_index - 1]
                    self._set_step(sequence_id, step_index, "unknown", "unavailable", None)
                    self._append_event(
                        sequence_id,
                        step_index,
                        target["nozzle_number"],
                        target["dose"],
                        "unknown",
                        reason="SIMULATOR_RESTART_DURING_OPERATION",
                    )
                    for index, later in enumerate(targets[step_index:], start=step_index + 1):
                        self._set_step(sequence_id, index, "not_started", "unavailable", None)
                        self._append_event(
                            sequence_id,
                            index,
                            later["nozzle_number"],
                            later["dose"],
                            "not_started",
                            reason="SIMULATOR_RESTART_STOPPED_SEQUENCE",
                        )
                    self._set_intent(sequence_id, "unknown", step_index)

        scheduled_rows = self.db.execute(
            "SELECT sequence_id,state,current_step_index FROM scheduled_runs WHERE device_id=? AND state IN ('accepted','running','settling')",
            (self.device_id,),
        ).fetchall()
        for run in scheduled_rows:
            sequence_id = run["sequence_id"]
            targets = json.loads(self.db.execute(
                "SELECT targets_json FROM scheduled_runs WHERE sequence_id=?", (sequence_id,)
            ).fetchone()["targets_json"])
            if run["state"] == "accepted":
                saved = self.db.execute(
                    "SELECT configuration_revision,occurrence_local_date FROM scheduled_runs WHERE sequence_id=?",
                    (sequence_id,),
                ).fetchone()
                with self.transaction():
                    for index, target in enumerate(targets, start=1):
                        self.db.execute(
                            "UPDATE scheduled_run_steps SET status='not_started',measurement_quality='unavailable',measured_dispensed_g=NULL WHERE sequence_id=? AND step_index=?",
                            (sequence_id, index),
                        )
                        self._append_schedule_event(sequence_id, index, target, "not_started",
                            saved["configuration_revision"], saved["occurrence_local_date"],
                            reason="SIMULATOR_RESTART_BEFORE_ACTUATION", clock_valid=False)
                    self._finish_schedule(sequence_id, "skipped", "SIMULATOR_RESTART_BEFORE_ACTUATION")
            elif run["state"] == "settling":
                step_index = (run["current_step_index"] or 1) + 1
                saved = self.db.execute(
                    "SELECT configuration_revision,occurrence_local_date FROM scheduled_runs WHERE sequence_id=?",
                    (sequence_id,),
                ).fetchone()
                with self.transaction():
                    for index, target in enumerate(targets[step_index - 1:], start=step_index):
                        self.db.execute(
                            "UPDATE scheduled_run_steps SET status='not_started',measurement_quality='unavailable',measured_dispensed_g=NULL WHERE sequence_id=? AND step_index=?",
                            (sequence_id, index),
                        )
                        self._append_schedule_event(sequence_id, index, target, "not_started",
                            saved["configuration_revision"], saved["occurrence_local_date"],
                            reason="SIMULATOR_RESTART_BEFORE_NEXT_NOZZLE", clock_valid=False)
                    self._finish_schedule(sequence_id, "partial", "SIMULATOR_RESTART_BEFORE_NEXT_NOZZLE")
            else:
                with self.transaction():
                    self._stop_schedule(sequence_id, run["current_step_index"] or 1, "unknown",
                        "SIMULATOR_RESTART_DURING_OPERATION", self._scheduler_boot_started_at, False)

    def pending_events(self, limit: int = 100) -> list[dict]:
        rows = self.db.execute(
            "SELECT payload_json FROM outbox ORDER BY rowid LIMIT ?", (limit,)
        ).fetchall()
        return [json.loads(row["payload_json"]) for row in rows]

    def acknowledge(self, acknowledgements: object, sent_events: list[dict]):
        sent = {(event["sequence_id"], event["event_sequence"]) for event in sent_events}
        if not isinstance(acknowledgements, list):
            raise ValueError("device sync acknowledgment list is invalid")
        keys: set[tuple[str, int]] = set()
        for item in acknowledgements:
            if not isinstance(item, dict) or not valid_uuid(item.get("sequence_id")) or isinstance(item.get("event_sequence"), bool) or not isinstance(item.get("event_sequence"), int):
                raise ValueError("device sync acknowledgment is invalid")
            key = (item["sequence_id"].lower(), item["event_sequence"])
            if key not in sent:
                raise ValueError("device sync acknowledged an event that was not sent")
            keys.add(key)
        with self.transaction():
            for sequence_id, event_sequence in keys:
                self.db.execute(
                    "DELETE FROM outbox WHERE sequence_id=? AND event_sequence=?",
                    (sequence_id, event_sequence),
                )

    def acknowledge_samples(self, acknowledgements: object, sent_samples: list[dict]):
        sent = {
            (sample["boot_id"].lower(), sample["sequence"]): sample
            for sample in sent_samples
        }
        if not isinstance(acknowledgements, list):
            raise ValueError("device sync sample acknowledgment list is invalid")
        keys: set[tuple[str, int]] = set()
        for item in acknowledgements:
            if (not isinstance(item, dict) or not valid_uuid(item.get("boot_id")) or
                    isinstance(item.get("sequence"), bool) or not isinstance(item.get("sequence"), int) or item["sequence"] < 0):
                raise ValueError("device sync sample acknowledgment is invalid")
            key = (item["boot_id"].lower(), item["sequence"])
            if key not in sent:
                raise ValueError("device sync acknowledged a sample that was not sent")
            keys.add(key)
        with self.transaction():
            for key in keys:
                sample = sent[key]
                self.db.execute(
                    "DELETE FROM telemetry_outbox WHERE boot_id=? AND sample_sequence=?",
                    key,
                )
                self._set_meta("last_acknowledged_sample", canonical_json(sample))

    def _make_telemetry_sample(self, sequence: int, scenario: str, sample_time: dt.datetime | None):
        clock_valid = self._simulator_clock()[1]
        now = sample_time or dt.datetime.now(dt.timezone.utc)
        if now.tzinfo is None or now.utcoffset() is None:
            raise ValueError("simulated telemetry time must be timezone-aware")
        measured_at = format_time(now)
        time_quality = "rtc" if clock_valid else "uncertain"
        if scenario == "invalid-time":
            measured_at, time_quality = None, "invalid"
        elif scenario == "uncertain-time":
            time_quality = "uncertain"

        do_quality = scenario.removeprefix("do-") if scenario.startswith("do-") else "valid"
        feed_quality = scenario.removeprefix("feed-") if scenario.startswith("feed-") else "valid"
        allowed = {"valid", "unavailable", "uncalibrated", "error"}
        if do_quality not in allowed or feed_quality not in allowed:
            do_quality = feed_quality = "valid"
        return {
            "sequence": sequence,
            "measured_at": measured_at,
            "time_quality": time_quality,
            "do_mg_l": 5.8 if do_quality == "valid" else None,
            "do_quality": do_quality,
            "feed_remaining_g": 500.0 if feed_quality == "valid" else None,
            "feed_percent": 50.0 if feed_quality == "valid" else None,
            "feed_quality": feed_quality,
            "calibration_revision": 2 if feed_quality == "valid" else None,
        }

    def _trim_telemetry_outbox(self):
        rows = self.db.execute(
            "SELECT row_id,sample_sequence FROM telemetry_outbox ORDER BY row_id"
        ).fetchall()
        lost = rows[:max(0, len(rows) - 100)]
        if not lost:
            return
        self.db.executemany("DELETE FROM telemetry_outbox WHERE row_id=?", [(row["row_id"],) for row in lost])
        previous = int(self._get_meta("telemetry_lost_count") or "0")
        self._set_meta("telemetry_lost_count", str(previous + len(lost)))
        first = self._get_meta("telemetry_lost_from")
        self._set_meta("telemetry_lost_from", min(int(first), int(lost[0]["sample_sequence"])) if first else str(lost[0]["sample_sequence"]))
        self._set_meta("telemetry_lost_to", str(lost[-1]["sample_sequence"]))

    def _active_intent(self) -> sqlite3.Row | None:
        return self.db.execute(
            "SELECT sequence_id,state FROM intents WHERE device_id=? AND state IN ('accepted','running','settling','unknown') ORDER BY created_at LIMIT 1",
            (self.device_id,),
        ).fetchone()

    def _active_schedule(self) -> sqlite3.Row | None:
        return self.db.execute(
            "SELECT sequence_id,state FROM scheduled_runs WHERE device_id=? AND state IN ('accepted','running','settling','unknown') ORDER BY updated_at LIMIT 1",
            (self.device_id,),
        ).fetchone()

    def sync_payload(self, telemetry_scenario: str = "valid", sample_time: dt.datetime | None = None) -> dict:
        sequence = int(self._get_meta("live_sequence") or "0") + 1
        latest_sample = self._make_telemetry_sample(sequence, telemetry_scenario, sample_time)
        boot_id = self._get_meta("boot_id")
        current_row = {**latest_sample, "boot_id": boot_id}
        with self.transaction():
            self._set_meta("live_sequence", str(sequence))
            self.db.execute(
                "INSERT INTO telemetry_outbox(boot_id,sample_sequence,sample_json) VALUES(?,?,?)",
                (boot_id, sequence, canonical_json(current_row)),
            )
            self._trim_telemetry_outbox()
            self._set_meta("latest_telemetry_sample", canonical_json(current_row))
        backlog_samples = [
            json.loads(row["sample_json"])
            for row in self.db.execute(
                "SELECT sample_json FROM telemetry_outbox WHERE NOT (boot_id=? AND sample_sequence=?) ORDER BY row_id",
                (boot_id, sequence),
            ).fetchall()
        ]
        if telemetry_scenario == "replay" and len(backlog_samples) < 99:
            replay = self._get_meta("last_acknowledged_sample")
            if replay:
                value = json.loads(replay)
                identity = (value["boot_id"], value["sequence"])
                if identity not in {(item["boot_id"], item["sequence"]) for item in backlog_samples} and identity != (boot_id, sequence):
                    backlog_samples.insert(0, value)
        active = self._active_intent()
        active_schedule = self._active_schedule() if active is None else None
        state = "idle"
        active_sequence_id = None
        if active and active["state"] == "running":
            state, active_sequence_id = "feeding", active["sequence_id"]
        elif active and active["state"] == "unknown":
            state, active_sequence_id = "unknown", active["sequence_id"]
        elif active_schedule and active_schedule["state"] in ("running", "settling"):
            state, active_sequence_id = "feeding", active_schedule["sequence_id"]
        elif active_schedule and active_schedule["state"] == "unknown":
            state, active_sequence_id = "unknown", active_schedule["sequence_id"]
        _, clock_valid, uncertainty = self._simulator_clock()
        return {
            "protocol_major": 2,
            "request_id": str(uuid.uuid4()),
            "boot_id": boot_id,
            "live_sequence": sequence,
            "firmware_version": "sim-2.0.0",
            "capabilities_revision": self.capabilities_revision,
            "clock": {"quality": "rtc", "uncertainty_ms": uncertainty} if clock_valid else {"quality": "invalid", "uncertainty_ms": None},
            "actuator": {"state": state, "active_sequence_id": active_sequence_id, "fault_code": None},
            "configuration": self.configuration_report(),
            "latest_sample": latest_sample,
            "backlog_samples": backlog_samples,
            "events": self.pending_events(),
        }


class DeviceApi:
    def __init__(self, base_url: str, publishable_key: str, credential: str):
        parsed = urlparse(base_url)
        if parsed.scheme != "https" or parsed.hostname != DEVELOPMENT_HOST or parsed.path not in ("", "/"):
            raise ValueError("SUPABASE_URL must be the authorized AquaFeed development project")
        if not publishable_key or "service_role" in publishable_key.lower():
            raise ValueError("SUPABASE_PUBLISHABLE_KEY must be set to the public client key")
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", credential):
            raise ValueError("simulator credential file is invalid")
        self.url = f"{parsed.scheme}://{parsed.netloc}/functions/v1/device-api/v2/sync"
        self.publishable_key = publishable_key
        self.credential = credential

    def sync(self, body: dict) -> dict:
        request = urllib.request.Request(
            self.url,
            data=json.dumps(body, separators=(",", ":")).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.credential}",
                "apikey": self.publishable_key,
                "Content-Type": "application/json",
                "X-Protocol-Major": "2",
                "X-Request-Id": body["request_id"],
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                value = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            payload = error.read(4096).decode("utf-8", errors="replace")
            try:
                code = json.loads(payload).get("error", {}).get("code", "SERVICE_UNAVAILABLE")
            except (json.JSONDecodeError, AttributeError):
                code = "SERVICE_UNAVAILABLE"
            raise RuntimeError(f"device sync failed ({error.code} {code})") from None
        if (not isinstance(value, dict) or value.get("protocol_major") != 2 or
                value.get("request_id") != body["request_id"]):
            raise RuntimeError("device sync returned an invalid response")
        parse_time(value.get("server_time"))
        if not isinstance(value.get("acknowledged_events"), list):
            raise RuntimeError("device sync returned invalid acknowledgments")
        if not isinstance(value.get("acknowledged_samples"), list):
            raise RuntimeError("device sync returned invalid sample acknowledgments")
        return value


def read_credential(path: Path, device_id: str) -> str:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("device_id") != device_id or not isinstance(value.get("credential"), str):
        raise ValueError("private simulator credential file does not match the selected fixture")
    return value["credential"]


def run_self_test():
    with TemporaryDirectory(prefix="aquafeed-art31-sim-") as directory:
        db_path = Path(directory) / "simulator.sqlite3"
        device_id = "22222222-2222-4222-8222-222222222222"

        def command(sequence: str, key: str, targets: list[dict]) -> dict:
            return {
                "command_id": sequence,
                "sequence_id": sequence,
                "device_id": device_id,
                "request_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                "idempotency_key": key,
                "status": "queued",
                "capabilities_revision": 1,
                "start_before": "2099-01-01T00:00:00.000Z",
                "scheduler_wake_grace_ms": 1000,
                "targets": targets,
            }

        both = [
            {"nozzle_number": 1, "dose": {"mode": "grams", "amount_g": 20}},
            {"nozzle_number": 2, "dose": {"mode": "grams", "amount_g": 30}},
        ]
        for nozzle in (1, 2):
            single = Simulator(Path(directory) / f"single-{nozzle}.sqlite3", device_id, settle_ms=0)
            single_command = command(
                f"10000000-0000-4000-8000-00000000000{nozzle}",
                f"20000000-0000-4000-8000-00000000000{nozzle}",
                [{"nozzle_number": nozzle, "dose": {"mode": "grams", "amount_g": 25}}],
            )
            single.observe_server_time("2098-12-31T23:00:00Z")
            single.accept_command(single_command)
            single.execute()
            result = single.db.execute("SELECT status,measured_dispensed_g FROM results").fetchone()
            assert result["status"] == "completed" and result["measured_dispensed_g"] == 24.5
            single.close()

        engine = Simulator(db_path, device_id, settle_ms=0)
        engine.observe_server_time("2098-12-31T23:00:00Z")
        for invalid_targets in (
            [{"nozzle_number": 1, "dose": {"mode": "grams"}}],
            [{"nozzle_number": 1, "dose": {"mode": "fixed_portion"}}],
            [{"dose": {"mode": "grams", "amount_g": 20}}],
        ):
            try:
                validated_targets(invalid_targets)
            except ValueError:
                pass
            else:
                raise AssertionError("missing used command fields were accepted")
        first = command("10000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000001", [
            {"nozzle_number": 1, "tracking_hint": "ignored", "dose": {"mode": "grams", "amount_g": 20, "label": "ignored"}},
            both[1],
        ])
        assert engine.accept_command(first)
        assert not engine.accept_command(command(first["sequence_id"], first["idempotency_key"], [
            {"dose": {"label": "reordered", "amount_g": 20, "mode": "grams"}, "nozzle_number": 1, "tracking_hint": "new"},
            both[1],
        ])), "additive or reordered fields must reuse the durable intent"
        order: list[str] = []
        engine.execute(on_actuation=lambda _sequence, step: order.append(f"start:{step}"))
        rows = engine.db.execute("SELECT step_index,status,measurement_quality,measured_dispensed_g FROM results ORDER BY step_index").fetchall()
        assert order == ["start:1", "start:2"]
        assert [(row["step_index"], row["status"]) for row in rows] == [(1, "completed"), (2, "completed")]
        assert all(row["measurement_quality"] == "valid" and row["measured_dispensed_g"] is not None for row in rows)
        try:
            engine.accept_command(command(first["sequence_id"], first["idempotency_key"], [
                {"nozzle_number": 1, "dose": {"mode": "grams", "amount_g": 21}},
                both[1],
            ]))
            raise AssertionError("changed targets reused a command key")
        except ValueError as error:
            assert str(error) == "IDEMPOTENCY_CONFLICT"
        outbox = engine.pending_events()
        assert [event["nozzle_number"] for event in outbox if event["event_type"] == "running"] == [1, 2]
        assert [event["event_type"] for event in outbox] == [
            "accepted", "accepted", "running", "completed", "running", "completed"
        ]
        engine.acknowledge(
            [{"sequence_id": event["sequence_id"], "event_sequence": event["event_sequence"]} for event in outbox],
            outbox,
        )
        assert engine.pending_events() == [], "outbox removes only server-acknowledged events"
        engine.close()

        fault_engine = Simulator(Path(directory) / "fault.sqlite3", device_id, settle_ms=0)
        fault_engine.observe_server_time("2098-12-31T23:00:00Z")
        fault_command = command("10000000-0000-4000-8000-000000000002", "20000000-0000-4000-8000-000000000002", both)
        fault_engine.accept_command(fault_command)
        started: list[int] = []
        fault_engine.execute("fault-nozzle1", lambda _sequence, step: started.append(step))
        fault_rows = fault_engine.db.execute("SELECT step_index,status,measured_dispensed_g FROM results ORDER BY step_index").fetchall()
        assert started == [1]
        assert [(row["step_index"], row["status"]) for row in fault_rows] == [(1, "failed"), (2, "not_started")]
        assert all(row["measured_dispensed_g"] is None for row in fault_rows)
        fault_engine.close()

        invalid_engine = Simulator(Path(directory) / "invalid-weighing.sqlite3", device_id, settle_ms=0)
        invalid_engine.observe_server_time("2098-12-31T23:00:00Z")
        invalid_command = command("10000000-0000-4000-8000-000000000005", "20000000-0000-4000-8000-000000000005", both)
        invalid_engine.accept_command(invalid_command)
        invalid_started: list[int] = []
        invalid_engine.execute("invalid-weighing-nozzle1", lambda _sequence, step: invalid_started.append(step))
        invalid_rows = invalid_engine.db.execute("SELECT step_index,status,measurement_quality,measured_dispensed_g FROM results ORDER BY step_index").fetchall()
        assert invalid_started == [1]
        assert [(row["step_index"], row["status"]) for row in invalid_rows] == [(1, "completed"), (2, "not_started")]
        assert invalid_rows[0]["measurement_quality"] == "error" and invalid_rows[0]["measured_dispensed_g"] is None
        invalid_engine.close()

        uncertain_path = Path(directory) / "restart.sqlite3"
        restart_engine = Simulator(uncertain_path, device_id, settle_ms=0)
        restart_engine.observe_server_time("2098-12-31T23:00:00Z")
        restart_command = command("10000000-0000-4000-8000-000000000003", "20000000-0000-4000-8000-000000000003", both)
        restart_engine.accept_command(restart_command)
        with restart_engine.transaction():
            restart_engine._set_intent(restart_command["sequence_id"], "running", 1)
            restart_engine._set_step(restart_command["sequence_id"], 1, "running", "unavailable", None)
            restart_engine._append_event(restart_command["sequence_id"], 1, 1, both[0]["dose"], "running")
        restart_engine.close()
        restarted = Simulator(uncertain_path, device_id, settle_ms=0)
        restarted.recover_after_restart()
        recovered = restarted.db.execute("SELECT state FROM intents WHERE sequence_id=?", (restart_command["sequence_id"],)).fetchone()
        recovered_rows = restarted.db.execute("SELECT step_index,status,measured_dispensed_g FROM results ORDER BY step_index").fetchall()
        assert recovered["state"] == "unknown"
        assert [(row["step_index"], row["status"]) for row in recovered_rows] == [(1, "unknown"), (2, "not_started")]
        assert all(row["measured_dispensed_g"] is None for row in recovered_rows)
        delayed = restarted.pending_events()
        assert [event["event_type"] for event in delayed] == [
            "accepted", "accepted", "running", "unknown", "not_started"
        ]
        assert [event["event_sequence"] for event in delayed] == [1, 2, 3, 4, 5]
        assert restarted._active_intent()["state"] == "unknown", "unknown work keeps the local reservation"
        try:
            restarted.accept_command(command("10000000-0000-4000-8000-000000000004", "20000000-0000-4000-8000-000000000004", [{"nozzle_number": 1, "dose": {"mode": "grams", "amount_g": 20}}]))
            raise AssertionError("unknown intent released its device reservation")
        except ValueError as error:
            assert str(error) == "DEVICE_BUSY"
        restarted.acknowledge(
            [{"sequence_id": event["sequence_id"], "event_sequence": event["event_sequence"]} for event in delayed],
            delayed,
        )
        assert restarted.pending_events() == [], "late server acknowledgment drains the same journal entries"
        assert restarted._active_intent()["state"] == "unknown", "late acknowledgment does not release the uncertain reservation"
        assert [(row["step_index"], row["status"]) for row in restarted.db.execute(
            "SELECT step_index,status FROM results ORDER BY step_index"
        )] == [(1, "unknown"), (2, "not_started")]
        restarted.close()

        expired_engine = Simulator(Path(directory) / "expired-first.sqlite3", device_id, settle_ms=0)
        expired_engine.observe_server_time("2098-12-31T23:00:00Z")
        expired_command = command(
            "10000000-0000-4000-8000-000000000006",
            "20000000-0000-4000-8000-000000000006",
            both,
        )
        expired_command["start_before"] = "2098-12-31T22:59:59Z"
        expired_engine.accept_command(expired_command)
        expired_started: list[int] = []
        expired_engine.execute(on_actuation=lambda _sequence, step: expired_started.append(step))
        expired_rows = expired_engine.db.execute(
            "SELECT step_index,status FROM results ORDER BY step_index"
        ).fetchall()
        assert expired_started == []
        assert [(row["step_index"], row["status"]) for row in expired_rows] == [
            (1, "expired"), (2, "not_started")
        ]
        assert [event["event_type"] for event in expired_engine.pending_events()] == [
            "accepted", "accepted", "expired", "not_started"
        ]
        expired_engine.close()

        expired_second = Simulator(Path(directory) / "expired-second.sqlite3", device_id, settle_ms=0)
        expired_second.observe_server_time("2098-12-31T23:59:59Z")
        second_deadline_command = command(
            "10000000-0000-4000-8000-000000000007",
            "20000000-0000-4000-8000-000000000007",
            both,
        )
        second_deadline_command["scheduler_wake_grace_ms"] = 0
        expired_second.accept_command(second_deadline_command)
        second_started: list[int] = []
        expired_second.execute(on_actuation=lambda _sequence, step: second_started.append(step))
        second_rows = expired_second.db.execute(
            "SELECT step_index,status FROM results ORDER BY step_index"
        ).fetchall()
        assert second_started == [1], "nozzle 2 waits until the first valid result sets its deadline"
        assert [(row["step_index"], row["status"]) for row in second_rows] == [
            (1, "completed"), (2, "not_started")
        ]
        assert [event["event_type"] for event in expired_second.pending_events()] == [
            "accepted", "accepted", "running", "completed", "expired"
        ]
        expired_second.close()

        accepted_path = Path(directory) / "accepted-restart.sqlite3"
        accepted_engine = Simulator(accepted_path, device_id, settle_ms=0)
        accepted_engine.observe_server_time("2098-12-31T23:00:00Z")
        accepted_command = command(
            "10000000-0000-4000-8000-000000000008",
            "20000000-0000-4000-8000-000000000008",
            both,
        )
        accepted_engine.accept_command(accepted_command)
        accepted_outbox = accepted_engine.pending_events()
        assert [event["event_sequence"] for event in accepted_outbox] == [1, 2]
        accepted_engine.acknowledge(
            [{"sequence_id": event["sequence_id"], "event_sequence": event["event_sequence"]} for event in accepted_outbox],
            accepted_outbox,
        )
        assert accepted_engine.pending_events() == []
        accepted_engine.close()
        accepted_restarted = Simulator(accepted_path, device_id, settle_ms=0)
        accepted_restarted.recover_after_restart()
        accepted_events = accepted_restarted.pending_events()
        assert [event["event_sequence"] for event in accepted_events] == [3, 4]
        assert [event["event_type"] for event in accepted_events] == ["not_started", "not_started"]
        assert all(row["status"] == "not_started" for row in accepted_restarted.db.execute(
            "SELECT status FROM results ORDER BY step_index"
        ))
        accepted_restarted.close()

        race_path = Path(directory) / "competing-start.sqlite3"
        race_setup = Simulator(race_path, device_id, settle_ms=0)
        race_setup.observe_server_time("2098-12-31T23:00:00Z")
        race_command = command(
            "10000000-0000-4000-8000-000000000009",
            "20000000-0000-4000-8000-000000000009",
            [{"nozzle_number": 1, "dose": {"mode": "grams", "amount_g": 25}}],
        )
        race_setup.accept_command(race_command)
        race_setup.close()
        start_barrier = threading.Barrier(3)
        actuation_lock = threading.Lock()
        actuations: list[tuple[str, int]] = []
        race_errors: list[BaseException] = []

        def record_actuation(sequence: str, step: int):
            with actuation_lock:
                actuations.append((sequence, step))

        def compete_for_start():
            engine = Simulator(race_path, device_id, settle_ms=0)
            engine.observe_server_time("2098-12-31T23:00:00Z")
            try:
                start_barrier.wait()
                engine.execute(on_actuation=record_actuation)
            except BaseException as error:
                race_errors.append(error)
            finally:
                engine.close()

        competitors = [threading.Thread(target=compete_for_start) for _ in range(2)]
        for competitor in competitors:
            competitor.start()
        start_barrier.wait()
        for competitor in competitors:
            competitor.join(timeout=5)
        assert all(not competitor.is_alive() for competitor in competitors)
        assert not race_errors, f"competing simulator start failed: {race_errors}"
        assert actuations == [(race_command["sequence_id"], 1)]
        race_inspect = Simulator(race_path, device_id, settle_ms=0)
        race_results = race_inspect.db.execute("SELECT status FROM results").fetchall()
        race_events = race_inspect.pending_events()
        assert [row["status"] for row in race_results] == ["completed"]
        assert [event["event_type"] for event in race_events] == ["accepted", "running", "completed"]
        race_inspect.close()

    print("ART-31 simulator ordering, idempotency, atomic competing starts, deadline stops, durable event sequence, late acknowledgment, and restart lockout checks passed.")


def _art33_schedule(schedule_id: str, nozzle: int, dose: int, weekday: int = 6, local_time: str = "12:00") -> dict:
    return {
        "schedule_id": schedule_id,
        "local_time": local_time,
        "weekdays": [weekday],
        "enabled": True,
        "dose": {"mode": "grams", "amount_g": dose},
        "nozzle_number": nozzle,
    }


def _art33_snapshot(revision: int, based_on_revision: int, schedules: list[dict], timezone: str = "UTC") -> dict:
    return {
        "revision": revision,
        "based_on_revision": based_on_revision,
        "timezone": timezone,
        "monitoring_limits": {"do_low_mg_l": 3.0, "do_high_mg_l": 10.0},
        "low_feed_threshold_pct": 25.0,
        "schedules": schedules,
    }


def run_self_test_telemetry():
    device_id = "22222222-2222-4222-8222-222222222222"
    instant = dt.datetime(2026, 10, 9, 5, 0, tzinfo=dt.timezone.utc)

    def sent_samples(body: dict) -> list[dict]:
        return body["backlog_samples"] + [{**body["latest_sample"], "boot_id": body["boot_id"]}]

    with TemporaryDirectory(prefix="aquafeed-art27-telemetry-") as directory:
        path = Path(directory) / "telemetry.sqlite3"
        engine = Simulator(path, device_id, settle_ms=0)
        first = engine.sync_payload("valid", instant)
        assert first["latest_sample"]["sequence"] == first["live_sequence"]
        assert first["latest_sample"]["do_quality"] == "valid" and first["latest_sample"]["do_mg_l"] == 5.8
        assert first["latest_sample"]["feed_quality"] == "valid" and first["latest_sample"]["feed_percent"] == 50.0
        first_sample = sent_samples(first)[-1]
        engine.acknowledge_samples([{"boot_id": first_sample["boot_id"], "sequence": first_sample["sequence"]}], sent_samples(first))

        replay = engine.sync_payload("replay", instant + dt.timedelta(seconds=1))
        assert replay["live_sequence"] == replay["latest_sample"]["sequence"]
        assert any(item["boot_id"] == first_sample["boot_id"] and item["sequence"] == first_sample["sequence"] for item in replay["backlog_samples"])
        assert len(replay["backlog_samples"]) + 1 <= 100
        engine.acknowledge_samples([{"boot_id": item["boot_id"], "sequence": item["sequence"]} for item in sent_samples(replay)], sent_samples(replay))

        faulty = engine.sync_payload("do-error", instant + dt.timedelta(seconds=2))["latest_sample"]
        assert faulty["do_quality"] == "error" and faulty["do_mg_l"] is None
        assert faulty["feed_quality"] == "valid" and faulty["feed_remaining_g"] == 500.0
        invalid_time = engine.sync_payload("invalid-time", instant + dt.timedelta(seconds=3))["latest_sample"]
        assert invalid_time["time_quality"] == "invalid" and invalid_time["measured_at"] is None
        uncertain_time = engine.sync_payload("uncertain-time", instant + dt.timedelta(seconds=4))["latest_sample"]
        assert uncertain_time["time_quality"] == "uncertain" and uncertain_time["measured_at"] is not None

        for offset in range(105):
            body = engine.sync_payload("valid", instant + dt.timedelta(minutes=offset + 1))
            assert len(body["backlog_samples"]) <= 99
            assert len(body["backlog_samples"]) + 1 <= 100
        assert int(engine._get_meta("telemetry_lost_count") or "0") >= 8
        assert int(engine._get_meta("telemetry_lost_to") or "0") >= int(engine._get_meta("telemetry_lost_from") or "0")
        engine.close()

        resumed = Simulator(path, device_id, settle_ms=0)
        resumed_body = resumed.sync_payload("valid", instant + dt.timedelta(hours=2))
        assert len(resumed_body["backlog_samples"]) == 99
        assert len(resumed_body["backlog_samples"]) + 1 == 100
        assert int(resumed._get_meta("telemetry_lost_count") or "0") >= 9
        assert resumed_body["latest_sample"]["sequence"] == resumed_body["live_sequence"]
        resumed.close()

    print("ART-27 simulator telemetry checks passed: deterministic valid/faulty readings, untrusted time, stable replay ACKs, durable backlog cap 100 including live, and persisted lost-sequence interval evidence.")


def run_self_test_art33():
    device_id = "22222222-2222-4222-8222-222222222222"
    schedule1 = "11111111-1111-4111-8111-111111111111"
    schedule2 = "22222222-2222-4222-8222-222222222223"
    schedule1_row = _art33_schedule(schedule1, 1, 12)
    schedule2_row = _art33_schedule(schedule2, 2, 19)
    due = dt.datetime(2099, 1, 3, 12, 0, tzinfo=dt.timezone.utc)

    with TemporaryDirectory(prefix="aquafeed-art33-sim-") as directory:
        root = Path(directory)
        engine = Simulator(root / "two-nozzles.sqlite3", device_id, settle_ms=0)
        baseline = _art33_snapshot(1, 0, [schedule1_row, schedule2_row])
        assert engine.apply_configuration(baseline)["applied_revision"] == 1
        order: list[tuple[int, int]] = []
        engine.run_due_schedules(on_actuation=lambda _sequence, step: order.append((step, 1 if step == 1 else 2)), now=due)
        steps = engine.db.execute("SELECT step_index,nozzle_number,requested_dose_json,status,measurement_quality,measured_dispensed_g FROM scheduled_run_steps ORDER BY step_index").fetchall()
        assert [(row["nozzle_number"], json.loads(row["requested_dose_json"])['amount_g'], row["status"]) for row in steps] == [(1, 12, "completed"), (2, 19, "completed")]
        assert order == [(1, 1), (2, 2)] and all(row["measurement_quality"] == "valid" and row["measured_dispensed_g"] is not None for row in steps)
        events = engine.pending_events()
        assert [event["event_type"] for event in events] == ["accepted", "accepted", "running", "completed", "running", "completed"]
        assert [event["requested_dose"]["amount_g"] for event in events if event["event_type"] == "completed"] == [12, 19]

        edited = _art33_snapshot(2, 1, [_art33_schedule(schedule1, 1, 13), _art33_schedule(schedule2, 2, 20)])
        assert engine.apply_configuration(edited)["applied_revision"] == 2
        assert engine.db.execute("SELECT json_extract(applied_json,'$.monitoring_limits.do_low_mg_l') FROM configuration_state WHERE device_id=?", (device_id,)).fetchone()[0] == 3.0
        engine.run_due_schedules(on_actuation=lambda *_: (_ for _ in ()).throw(AssertionError("same-day schedule repeated")), now=due)
        assert engine.db.execute("SELECT count(*) FROM scheduled_runs").fetchone()[0] == 1
        assert engine.configuration_report()["applied_revision"] == 2

        sent = engine.pending_events()
        engine.acknowledge([{"sequence_id": event["sequence_id"], "event_sequence": event["event_sequence"]} for event in sent], sent)
        engine.close()
        restarted = Simulator(root / "two-nozzles.sqlite3", device_id, settle_ms=0)
        restarted.recover_after_restart()
        restarted.run_due_schedules(now=due)
        assert restarted.pending_events() == [] and restarted.db.execute("SELECT count(*) FROM scheduled_runs").fetchone()[0] == 1
        restarted.close()

        invalid_cases = [
            ("invalid weekday", [_art33_schedule(schedule1, 1, 12, weekday=8)], "VALIDATION_FAILED"),
            ("invalid time", [{**schedule1_row, "local_time": "25:61"}], "VALIDATION_FAILED"),
            ("duplicate same-nozzle time", [schedule1_row, {**schedule1_row, "schedule_id": "33333333-3333-4333-8333-333333333333"}], "VALIDATION_FAILED"),
            ("unsupported dose", [_art33_schedule(schedule1, 1, 101)], "DOSE_OUT_OF_RANGE"),
        ]
        too_many = [_art33_schedule(f"40000000-0000-4000-8000-{index:012d}", 1 + index % 2, 10 + index, weekday=index % 7 + 1, local_time=f"{index:02d}:00") for index in range(9)]
        invalid_cases.append(("schedule count", too_many, "CAPABILITY_MISMATCH"))
        invalid_cases.append(("unknown timezone", [schedule1_row], "VALIDATION_FAILED"))
        for index, (label, schedules, expected) in enumerate(invalid_cases, start=1):
            case = Simulator(root / f"invalid-{index}.sqlite3", device_id, settle_ms=0)
            snapshot = _art33_snapshot(1, 0, schedules, "Mars/Olympus" if label == "unknown timezone" else "UTC")
            report = case.apply_configuration(snapshot)
            assert report["last_attempt_status"] == "rejected" and report["error_code"] == expected, label
            assert report["applied_revision"] is None and case.db.execute("SELECT applied_json FROM configuration_state").fetchone()[0] is None, label
            case.close()

        collision = Simulator(root / "manual-collision.sqlite3", device_id, settle_ms=0)
        collision.apply_configuration(_art33_snapshot(1, 0, [schedule1_row]))
        collision.observe_server_time(format_time(due))
        manual_id = "50000000-0000-4000-8000-000000000001"
        manual = {
            "command_id": manual_id, "sequence_id": manual_id, "device_id": device_id,
            "request_id": "60000000-0000-4000-8000-000000000001", "idempotency_key": "70000000-0000-4000-8000-000000000001",
            "status": "queued", "capabilities_revision": 1,
            "created_at": format_time(due - dt.timedelta(seconds=1)), "start_before": format_time(due + dt.timedelta(seconds=30)),
            "scheduler_wake_grace_ms": 1000,
            "targets": [{"nozzle_number": 2, "dose": {"mode": "grams", "amount_g": 15}}],
        }
        assert collision.accept_command(manual)
        collision.run_due_schedules(now=due)
        assert collision.db.execute("SELECT state FROM scheduled_runs").fetchone()[0] == "skipped"
        assert any(event["reason_code"] == "SIMULATOR_DEVICE_BUSY" for event in collision.pending_events() if event["source"] == "scheduled")
        collision.execute(on_actuation=lambda *_: None)
        assert collision.db.execute("SELECT state FROM intents").fetchone()[0] == "completed"
        collision.close()

        delayed = Simulator(root / "offline-collision.sqlite3", device_id, settle_ms=0)
        delayed.apply_configuration(_art33_snapshot(1, 0, [schedule1_row]))
        delayed.run_due_schedules(now=due)
        stale_manual = {**manual, "command_id": "50000000-0000-4000-8000-000000000002", "sequence_id": "50000000-0000-4000-8000-000000000002", "request_id": "60000000-0000-4000-8000-000000000002", "idempotency_key": "70000000-0000-4000-8000-000000000002"}
        assert delayed.accept_command(stale_manual)
        assert delayed.db.execute("SELECT state FROM intents").fetchone()[0] == "failed"
        assert [event["event_type"] for event in delayed.pending_events() if event["source"] == "manual"] == ["accepted", "rejected"]
        assert all(event["reason_code"] == "SIMULATOR_SCHEDULE_COLLISION" for event in delayed.pending_events() if event["source"] == "manual" and event["event_type"] == "rejected")
        delayed.close()

        gap = Simulator(root / "dst-gap.sqlite3", device_id, settle_ms=0)
        gap.apply_configuration(_art33_snapshot(1, 0, [_art33_schedule(schedule1, 1, 12, weekday=7, local_time="02:30")], "America/New_York"))
        gap_calls: list[str] = []
        gap.run_due_schedules(on_actuation=lambda *_: gap_calls.append("actuated"), now=dt.datetime(2026, 3, 8, 7, 1, tzinfo=dt.timezone.utc))
        assert gap_calls == [] and any(event["reason_code"] == "SIMULATOR_DST_GAP" for event in gap.pending_events())
        gap.close()

        fold = Simulator(root / "dst-fold.sqlite3", device_id, settle_ms=0)
        fold.apply_configuration(_art33_snapshot(1, 0, [_art33_schedule(schedule1, 1, 12, weekday=7, local_time="01:30")], "America/New_York"))
        fold_calls: list[str] = []
        fold.run_due_schedules(on_actuation=lambda *_: fold_calls.append("actuated"), now=dt.datetime(2026, 11, 1, 5, 30, tzinfo=dt.timezone.utc))
        fold.run_due_schedules(on_actuation=lambda *_: fold_calls.append("actuated"), now=dt.datetime(2026, 11, 1, 6, 30, tzinfo=dt.timezone.utc))
        assert fold_calls == ["actuated"] and fold.db.execute("SELECT count(*) FROM scheduled_runs").fetchone()[0] == 1
        fold.close()

        for direction in ("forward", "backward"):
            clock = Simulator(root / f"clock-{direction}.sqlite3", device_id, settle_ms=0)
            clock.apply_configuration(_art33_snapshot(1, 0, [schedule1_row]))
            wall = dt.datetime.now(dt.timezone.utc)
            jump = dt.timedelta(hours=1 if direction == "backward" else -1)
            clock._scheduler_clock_pair = (wall + jump, time.monotonic())
            clock._simulator_clock()
            clock_calls: list[str] = []
            clock.run_due_schedules(on_actuation=lambda *_: clock_calls.append("actuated"), now=due)
            assert clock_calls == [] and any(event["reason_code"] == "SIMULATOR_CLOCK_UNTRUSTED" for event in clock.pending_events())
            assert all(event["time_quality"] == "invalid" and event["device_at"] is None for event in clock.pending_events())
            clock.close()

        interrupted_path = root / "interrupted.sqlite3"
        interrupted = Simulator(interrupted_path, device_id, settle_ms=0)
        interrupted.apply_configuration(baseline)
        try:
            interrupted.run_due_schedules(on_actuation=lambda *_: (_ for _ in ()).throw(RuntimeError("simulated power loss")), now=due)
        except RuntimeError:
            pass
        else:
            raise AssertionError("interruption fixture did not stop during actuation")
        interrupted.close()
        resumed = Simulator(interrupted_path, device_id, settle_ms=0)
        resumed.recover_after_restart()
        resumed.run_due_schedules(on_actuation=lambda *_: (_ for _ in ()).throw(AssertionError("schedule resumed after restart")), now=due)
        resumed_steps = resumed.db.execute("SELECT nozzle_number,status,measured_dispensed_g FROM scheduled_run_steps ORDER BY step_index").fetchall()
        assert [(row["nozzle_number"], row["status"]) for row in resumed_steps] == [(1, "unknown"), (2, "not_started")]
        assert all(row["measured_dispensed_g"] is None for row in resumed_steps) and resumed._get_meta("schedule_lockout_sequence") is not None
        resumed.close()

    print("ART-33 simulator checks passed: atomic configuration apply/reject, independent offline nozzles and doses, stable daily occurrence/outbox, invalid schedule/profile inputs, explicit manual collisions, DST gap/fold, clock jumps, and restart lockout.")


def main():
    parser = argparse.ArgumentParser(description="Durable synthetic ART-31 device simulator. Fixture sensor values are simulated, never physical calibration evidence.")
    parser.add_argument("--self-test", action="store_true", help="run the local SQLite durability and recovery assertions")
    parser.add_argument("--self-test-art33", action="store_true", help="run focused offline nozzle schedule safety assertions")
    parser.add_argument("--self-test-telemetry", action="store_true", help="check deterministic telemetry, bounded replay/backlog, and lost interval evidence")
    parser.add_argument("--once", action="store_true", help="perform one device sync cycle")
    parser.add_argument("--device-id", default=os.environ.get("AQUAFEED_DEVICE_ID", "22222222-2222-4222-8222-222222222222"))
    parser.add_argument("--credential-file", type=Path)
    parser.add_argument("--db", type=Path)
    parser.add_argument("--capabilities-revision", type=int, default=1)
    parser.add_argument("--settle-ms", type=int, default=50)
    parser.add_argument(
        "--telemetry-scenario",
        choices=("valid", "do-unavailable", "do-uncalibrated", "do-error", "feed-unavailable", "feed-uncalibrated", "feed-error", "uncertain-time", "invalid-time", "replay"),
        default="valid",
    )
    parser.add_argument(
        "--scenario",
        choices=("normal", "fault-nozzle1", "fault-nozzle2", "unknown-nozzle1", "unknown-nozzle2", "invalid-weighing-nozzle1", "invalid-weighing-nozzle2"),
        default="normal",
    )
    args = parser.parse_args()
    if args.self_test:
        run_self_test()
        return
    if args.self_test_art33:
        run_self_test_art33()
        return
    if args.self_test_telemetry:
        run_self_test_telemetry()
        return

    root = Path(__file__).resolve().parents[2]
    device_id = args.device_id.lower()
    credential_file = args.credential_file or root / ".device-secrets" / f"device-{device_id}-credential.json"
    db_path = args.db or Path(os.environ.get("AQUAFEED_SIMULATOR_DB", str(Path.home() / ".aquafeedpro" / "art31-simulator.sqlite3")))
    credential = read_credential(credential_file, device_id)
    client = DeviceApi(
        os.environ.get("SUPABASE_URL", ""),
        os.environ.get("SUPABASE_PUBLISHABLE_KEY", ""),
        credential,
    )
    engine = Simulator(db_path, device_id, args.capabilities_revision, args.settle_ms)
    try:
        engine.recover_after_restart()

        def sync_once():
            body = engine.sync_payload(args.telemetry_scenario)
            sent = body["events"]
            sent_samples = body["backlog_samples"] + [{**body["latest_sample"], "boot_id": body["boot_id"]}]
            started = time.monotonic()
            response = client.sync(body)
            engine.observe_server_time(response["server_time"], time.monotonic() - started)
            engine.acknowledge(response["acknowledged_events"], sent)
            engine.acknowledge_samples(response["acknowledged_samples"], sent_samples)
            desired_configuration = response.get("desired_configuration")
            if desired_configuration is not None:
                engine.apply_configuration(desired_configuration)
            command = response.get("command")
            if command is not None:
                if not isinstance(command, dict):
                    raise ValueError("device sync command is invalid")
                engine.accept_command(command)
            return response

        next_sync_at = time.monotonic()
        while True:
            response = None
            if time.monotonic() >= next_sync_at:
                try:
                    response = sync_once()
                    delay_ms = response.get("next_sync_after_ms", 1000)
                    delay = min(max(delay_ms, 250), 10000) / 1000 if isinstance(delay_ms, int) else 1
                    next_sync_at = time.monotonic() + delay
                except (OSError, TimeoutError, RuntimeError) as error:
                    print(f"Simulator sync pending; durable events will be retried ({error}).")
                    if args.once:
                        raise
                    next_sync_at = time.monotonic() + 3

            # Local schedule execution continues while the cloud is unavailable.
            engine.run_due_schedules(args.scenario, lambda _sequence, _step: None)
            try:
                engine.trusted_now()
            except ValueError:
                pass
            else:
                engine.execute(args.scenario, lambda _sequence, _step: None)

            if args.once:
                if response is not None and engine.pending_events():
                    sync_once()
                break
            time.sleep(min(0.5, max(0.05, next_sync_at - time.monotonic())))
    finally:
        engine.close()


if __name__ == "__main__":
    main()
