"""Offline actual SQLite ACK checks; no DeviceApi, credentials or hardware."""
import importlib.util
import tempfile
import sys
from pathlib import Path
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('simulator', Path(__file__).resolve().parents[1] / 'scripts' / 'art31_simulator.py')
sim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sim)
with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / 'reporting.sqlite3'
    engine = sim.Simulator(path, '22222222-2222-4222-8222-222222222222')
    try:
        snapshot = {'revision': 1, 'based_on_revision': 0, 'timezone': 'Asia/Manila', 'monitoring_limits': {'do_low_mg_l': None, 'do_high_mg_l': None}, 'low_feed_threshold_pct': None, 'schedules': [], 'oxygen_report_interval_seconds': 30}
        for interval in (15, 30, 60, 3600, 7200, 14400, 28800):
            assert engine._configuration_snapshot_is_valid({**snapshot, 'oxygen_report_interval_seconds': interval}) is None, interval
        for interval in (0, 14, 31, -1, '30', False, float('nan')):
            assert engine._configuration_snapshot_is_valid({**snapshot, 'oxygen_report_interval_seconds': interval}) == 'VALIDATION_FAILED'
        assert engine.apply_configuration(snapshot)['applied_revision'] == 1
        wire = sim.metric_sync_payload(engine.sync_payload(), engine.applied_reporting_interval())
        assert wire['configuration']['oxygen_report_interval_seconds'] == 30
        assert 'oxygen_report_interval_seconds' not in engine.configuration_report(), 'legacy report shape unchanged'
        assert engine.apply_configuration(snapshot)['applied_revision'] == 1
        rejected = engine.apply_configuration({**snapshot, 'revision': 2, 'based_on_revision': 1, 'oxygen_report_interval_seconds': 31})
        assert rejected['last_attempt_status'] == 'rejected' and rejected['applied_revision'] == 1
        assert sim.metric_sync_payload(engine.sync_payload(), engine.applied_reporting_interval())['configuration']['oxygen_report_interval_seconds'] == 30, 'rejection echoes previous applied value'
    finally:
        engine.close()
    engine = sim.Simulator(path, '22222222-2222-4222-8222-222222222222')
    try:
        assert sim.metric_sync_payload(engine.sync_payload(), engine.applied_reporting_interval())['configuration']['oxygen_report_interval_seconds'] == 30, 'applied cadence survives restart'
    finally:
        engine.close()
print('PASS reporting SQLite allowlist/exact applied ACK/rejected revision/replay/restart; no physical cadence claim')
