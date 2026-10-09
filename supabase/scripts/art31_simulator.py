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


DEVICE_IDS = {
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
}
DEVELOPMENT_HOST = "giilhohmrytpgyeyysir.supabase.co"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
FIXED_PORTION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
ACTIVE_STATES = ("accepted", "running", "settling", "unknown")


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
        "start_before": start_before,
        "scheduler_wake_grace_ms": wake_grace,
        "targets": targets,
    }


class Simulator:
    def __init__(self, db_path: Path, device_id: str, capabilities_revision: int = 1, settle_ms: int = 50):
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

    def _active_intent(self) -> sqlite3.Row | None:
        return self.db.execute(
            "SELECT sequence_id,state FROM intents WHERE device_id=? AND state IN ('accepted','running','settling','unknown') ORDER BY created_at LIMIT 1",
            (self.device_id,),
        ).fetchone()

    def sync_payload(self) -> dict:
        sequence = int(self._get_meta("live_sequence") or "0") + 1
        self._set_meta("live_sequence", str(sequence))
        active = self._active_intent()
        state = "idle"
        active_sequence_id = None
        if active and active["state"] == "running":
            state, active_sequence_id = "feeding", active["sequence_id"]
        elif active and active["state"] == "unknown":
            state, active_sequence_id = "unknown", active["sequence_id"]
        return {
            "protocol_major": 2,
            "request_id": str(uuid.uuid4()),
            "boot_id": self._get_meta("boot_id"),
            "live_sequence": sequence,
            "firmware_version": "sim-2.0.0",
            "capabilities_revision": self.capabilities_revision,
            "clock": {"quality": "synced", "uncertainty_ms": 5},
            "actuator": {"state": state, "active_sequence_id": active_sequence_id, "fault_code": None},
            "configuration": {
                "applied_revision": None,
                "last_attempt_revision": None,
                "last_attempt_status": None,
                "error_code": None,
            },
            "latest_sample": None,
            "backlog_samples": [],
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


def main():
    parser = argparse.ArgumentParser(description="Durable synthetic ART-31 device simulator. Fixture sensor values are simulated, never physical calibration evidence.")
    parser.add_argument("--self-test", action="store_true", help="run the local SQLite durability and recovery assertions")
    parser.add_argument("--once", action="store_true", help="perform one device sync cycle")
    parser.add_argument("--device-id", default=os.environ.get("AQUAFEED_DEVICE_ID", "22222222-2222-4222-8222-222222222222"))
    parser.add_argument("--credential-file", type=Path)
    parser.add_argument("--db", type=Path)
    parser.add_argument("--capabilities-revision", type=int, default=1)
    parser.add_argument("--settle-ms", type=int, default=50)
    parser.add_argument(
        "--scenario",
        choices=("normal", "fault-nozzle1", "fault-nozzle2", "unknown-nozzle1", "unknown-nozzle2", "invalid-weighing-nozzle1", "invalid-weighing-nozzle2"),
        default="normal",
    )
    args = parser.parse_args()
    if args.self_test:
        run_self_test()
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
            body = engine.sync_payload()
            sent = body["events"]
            started = time.monotonic()
            response = client.sync(body)
            engine.observe_server_time(response["server_time"], time.monotonic() - started)
            engine.acknowledge(response["acknowledged_events"], sent)
            command = response.get("command")
            if command is not None:
                if not isinstance(command, dict):
                    raise ValueError("device sync command is invalid")
                engine.accept_command(command)
            return response

        while True:
            try:
                response = sync_once()
                engine.execute(args.scenario, lambda _sequence, _step: None)
                if args.once:
                    if engine.pending_events():
                        sync_once()
                    break
                delay_ms = response.get("next_sync_after_ms", 1000)
                time.sleep(min(max(delay_ms, 250), 10000) / 1000 if isinstance(delay_ms, int) else 1)
            except (OSError, TimeoutError, RuntimeError) as error:
                print(f"Simulator sync pending; durable events will be retried ({error}).")
                if args.once:
                    raise
                time.sleep(3)
    finally:
        engine.close()


if __name__ == "__main__":
    main()
