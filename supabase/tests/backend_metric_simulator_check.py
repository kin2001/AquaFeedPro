"""Offline, real SQLite simulator checks; never constructs DeviceApi or reads credentials."""
import copy
import importlib.util
import json
import tempfile
import sys
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("simulator", Path(__file__).resolve().parents[1] / "scripts" / "art31_simulator.py")
sim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sim)
assert callable(getattr(sim, "metric_sync_payload", None)), "metric wire conversion is missing"
with tempfile.TemporaryDirectory() as directory:
    db = Path(directory) / "metrics.sqlite3"
    engine = sim.Simulator(db, "22222222-2222-4222-8222-222222222222")
    try:
        legacy = engine.sync_payload()
        original = copy.deepcopy(legacy)
        wire = sim.metric_sync_payload(legacy)
        assert legacy == original, "conversion cannot mutate source evidence"
        assert wire["latest_sample"] is None and wire["backlog_samples"] == []
        observations = list(wire["metric_telemetry"]["live"].values())
        assert len(observations) == 2
        for observation in observations:
            assert observation["measured_at"] == legacy["latest_sample"]["measured_at"]
            assert observation["captured_at"] is None, "never invent capture provenance"
            assert observation["sequence"] == wire["live_sequence"]
            assert observation["boot_id"] == wire["boot_id"]
        acks = [{key: item[key] for key in ("metric", "boot_id", "sequence")} for item in observations]
        engine.acknowledge_metric_samples(acks[:1], wire)
        assert engine.db.execute("select count(*) from telemetry_outbox").fetchone()[0] == 1, "partial metric ACK must retain combined immutable source"
        for invalid in [acks + [acks[0]], [{**acks[0], "sequence": "1"}], [{**acks[0], "sequence": 999}], [{**acks[0], "metric": "other"}]]:
            try:
                engine.acknowledge_metric_samples(invalid, wire)
                raise AssertionError("invalid metric ACK accepted")
            except ValueError:
                pass
        engine.acknowledge_metric_samples(acks, wire)
        assert engine.db.execute("select count(*) from telemetry_outbox").fetchone()[0] == 0
        for _ in range(60):
            legacy = engine.sync_payload()
        wire = sim.metric_sync_payload(legacy)
        assert len(wire["metric_telemetry"]["backlog"]) == 98, "cap total observations at 100"
        historical = wire["metric_telemetry"]["backlog"][0]
        stored = json.loads(engine.db.execute("select sample_json from telemetry_outbox where boot_id=? and sample_sequence=?", (historical["boot_id"], historical["sequence"])).fetchone()[0])
        assert historical["measured_at"] == stored["measured_at"], "never relabel backlog to now"
        saved_wire = copy.deepcopy(wire)
    finally:
        engine.close()
    reopened = sim.Simulator(db, "22222222-2222-4222-8222-222222222222")
    try:
        assert reopened.db.execute("select count(*) from telemetry_outbox").fetchone()[0] == 60, "outbox persists across restart"
        newer = sim.metric_sync_payload(reopened.sync_payload())
        assert newer["live_sequence"] > saved_wire["live_sequence"], "global counter persists across boot"
        saved = {(o["metric"], o["boot_id"], o["sequence"]): o for o in saved_wire["metric_telemetry"]["backlog"]}
        for observation in newer["metric_telemetry"]["backlog"]:
            key = (observation["metric"], observation["boot_id"], observation["sequence"])
            if key in saved:
                assert observation == saved[key], "reconnect preserves original observations"
    finally:
        reopened.close()
print("PASS metric simulator conversion/SQLite durable outbox/ACK bounds/restart identity; synthetic paired readings only, no hardware or SQL proof")
