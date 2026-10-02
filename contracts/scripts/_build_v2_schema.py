import copy
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
s = copy.deepcopy(json.loads((root / "schemas/v1.schema.json").read_text(encoding="utf-8")))
d = s["$defs"]
s.update({"$id": "https://aquafeedpro.example/contracts/v2.schema.json", "title": "AquaFeed Pro wire contract 2.0.0", "description": "Breaking major 2 contract. Major 1 has no nozzle targeting and is rejected with PROTOCOL_UNSUPPORTED; no fallback or silent default nozzle."})
d["ProtocolMajor"] = {"type": "integer", "const": 2}
d["CommandState"]["enum"].insert(4, "partial")
d["RunEventOutcome"]["enum"].append("not_started")
d["NozzleNumber"] = {"type": "integer", "enum": [1, 2]}
d["NozzleCapability"] = {
    "type": "object", "required": ["enabled", "dose_modes", "fixed_portion_ids", "min_dose_g", "max_dose_g", "dose_step_g", "measured_dispensed_g", "max_actuation_ms", "minimum_cooldown_ms"],
    "properties": {"enabled": {"type": "boolean"}, "dose_modes": {"type": "array", "uniqueItems": True, "items": {"$ref": "#/$defs/DoseMode"}}, "fixed_portion_ids": {"type": "array", "uniqueItems": True, "items": {"$ref": "#/$defs/FixedPortionDose/properties/fixed_portion_id"}}, "min_dose_g": {"$ref": "#/$defs/NullableFiniteNonNegativeNumber"}, "max_dose_g": {"$ref": "#/$defs/NullableFiniteNonNegativeNumber"}, "dose_step_g": {"$ref": "#/$defs/NullableFiniteNonNegativeNumber"}, "measured_dispensed_g": {"type": "boolean"}, "max_actuation_ms": {"$ref": "#/$defs/NullablePositiveInteger"}, "minimum_cooldown_ms": {"$ref": "#/$defs/NullableNonNegativeInteger"}},
    "allOf": [
        {"if": {"properties": {"dose_modes": {"contains": {"const": "grams"}}}, "required": ["dose_modes"]}, "then": {"properties": {"min_dose_g": {"type": "number", "exclusiveMinimum": 0}, "max_dose_g": {"type": "number", "exclusiveMinimum": 0}, "dose_step_g": {"type": "number", "exclusiveMinimum": 0}}}, "else": {"properties": {"min_dose_g": {"type": "null"}, "max_dose_g": {"type": "null"}, "dose_step_g": {"type": "null"}}}},
        {"if": {"properties": {"dose_modes": {"contains": {"const": "fixed_portion"}}}, "required": ["dose_modes"]}, "then": {"properties": {"fixed_portion_ids": {"minItems": 1}}}, "else": {"properties": {"fixed_portion_ids": {"maxItems": 0}}}},
        {"if": {"properties": {"enabled": {"const": True}}, "required": ["enabled"]}, "then": {"properties": {"dose_modes": {"minItems": 1}}}, "else": {"properties": {"dose_modes": {"maxItems": 0}, "measured_dispensed_g": {"const": False}}}},
    ], "description": "Approved capability for one nozzle. Null limits are unknown, not zero."}
d["CapabilityProfile"] = {
    "type": "object", "required": ["do_monitoring", "feed_remaining_monitoring", "nozzles", "max_schedules", "local_schedule_execution", "max_clock_uncertainty_ms", "scheduler_wake_grace_ms", "maximum_settling_ms"],
    "properties": {"do_monitoring": {"type": "boolean"}, "feed_remaining_monitoring": {"type": "boolean", "description": "One shared container/load-cell inventory, never per-nozzle stock."}, "nozzles": {"type": "object", "required": ["1", "2"], "properties": {"1": {"$ref": "#/$defs/NozzleCapability"}, "2": {"$ref": "#/$defs/NozzleCapability"}}, "additionalProperties": False}, "max_schedules": {"$ref": "#/$defs/NullablePositiveInteger"}, "local_schedule_execution": {"type": "boolean"}, "max_clock_uncertainty_ms": {"$ref": "#/$defs/NullableNonNegativeInteger"}, "scheduler_wake_grace_ms": {"$ref": "#/$defs/NullableNonNegativeInteger"}, "maximum_settling_ms": {"$ref": "#/$defs/NullablePositiveInteger", "description": "Device-wide maximum settling interval; null means no verified bound."}},
    "allOf": [{"if": {"properties": {"local_schedule_execution": {"const": True}}, "required": ["local_schedule_execution"]}, "then": {"properties": {"max_schedules": {"$ref": "#/$defs/PositiveInteger"}, "scheduler_wake_grace_ms": {"$ref": "#/$defs/NonNegativeInteger"}}}, "else": {"properties": {"max_schedules": {"type": "null"}}}}], "description": "Shared device monitoring and schedule limits plus exactly two independent nozzle capabilities."}

def target(nozzle=None):
    props = {"nozzle_number": {"$ref": "#/$defs/NozzleNumber"}, "dose": {"$ref": "#/$defs/Dose"}}
    if nozzle is not None:
        props["nozzle_number"] = {"const": nozzle}
    return {"type": "object", "required": ["nozzle_number", "dose"], "properties": props}

def targets(item):
    return {"oneOf": [{"type": "array", "minItems": 1, "maxItems": 1, "items": {"$ref": f"#/$defs/{item}"}}, {"type": "array", "minItems": 2, "maxItems": 2, "prefixItems": [target(1), target(2)], "items": False}], "description": "One selected nozzle, or exactly nozzle 1 followed by nozzle 2."}

d["ManualFeedTarget"] = target()
d["ManualFeedTargets"] = targets("ManualFeedTarget")
d["ManualFeedRequest"] = {"type": "object", "required": ["protocol_major", "request_id", "device_id", "idempotency_key", "targets", "capabilities_revision"], "properties": {"protocol_major": {"$ref": "#/$defs/ProtocolMajor"}, "request_id": {"$ref": "#/$defs/Uuid"}, "device_id": {"$ref": "#/$defs/Uuid"}, "idempotency_key": {"$ref": "#/$defs/Uuid"}, "targets": {"$ref": "#/$defs/ManualFeedTargets"}, "capabilities_revision": {"$ref": "#/$defs/PositiveInteger"}}, "description": "Confirmation binds the route device and ordered nozzle+dose targets. Idempotency includes target order, each dose and capabilities_revision; request_id is correlation only."}
d["CommandAcceptedResponse"] = {"type": "object", "required": ["request_id", "device_id", "command_id", "sequence_id", "idempotency_key", "targets", "status", "created_at", "start_before"], "properties": {"request_id": {"$ref": "#/$defs/Uuid"}, "device_id": {"$ref": "#/$defs/Uuid"}, "command_id": {"$ref": "#/$defs/Uuid"}, "sequence_id": {"$ref": "#/$defs/Uuid"}, "idempotency_key": {"$ref": "#/$defs/Uuid"}, "targets": {"$ref": "#/$defs/ManualFeedTargets"}, "status": {"const": "queued"}, "created_at": {"$ref": "#/$defs/UtcDateTime"}, "start_before": {"$ref": "#/$defs/UtcDateTime"}}, "description": "start_before gates only the first nozzle; the device-wide reservation remains through later stops and settling."}
d["NozzleResultStatus"] = {"type": "string", "enum": ["not_started", "queued", "accepted", "running", "completed", "failed", "rejected", "expired", "unknown"]}
d["NozzleResult"] = {"type": "object", "required": ["nozzle_number", "status", "requested_dose", "estimated_dispensed_g", "measured_dispensed_g", "measurement_quality"], "properties": {"nozzle_number": {"$ref": "#/$defs/NozzleNumber"}, "status": {"$ref": "#/$defs/NozzleResultStatus"}, "requested_dose": {"$ref": "#/$defs/Dose"}, "estimated_dispensed_g": {"$ref": "#/$defs/NullableFiniteNonNegativeNumber"}, "measured_dispensed_g": {"$ref": "#/$defs/NullableFiniteNonNegativeNumber"}, "measurement_quality": {"$ref": "#/$defs/MeasurementQuality"}}, "allOf": [{"if": {"properties": {"measurement_quality": {"const": "valid"}}, "required": ["measurement_quality"]}, "then": {"properties": {"measured_dispensed_g": {"type": "number"}}}, "else": {"properties": {"measured_dispensed_g": {"type": "null"}}}}, {"if": {"properties": {"status": {"enum": ["not_started", "queued", "accepted", "rejected", "expired", "unknown"]}}, "required": ["status"]}, "then": {"properties": {"measured_dispensed_g": {"type": "null"}, "measurement_quality": {"enum": ["unavailable", "uncalibrated", "error"]}}}}], "description": "Requested, estimated and measured amounts stay separate. Unknown and not_started results never invent measurements."}
d["NozzleResults"] = {"oneOf": [{"type": "array", "minItems": 1, "maxItems": 1, "items": {"$ref": "#/$defs/NozzleResult"}}, {"type": "array", "minItems": 2, "maxItems": 2, "prefixItems": [{"allOf": [{"$ref": "#/$defs/NozzleResult"}, {"properties": {"nozzle_number": {"const": 1}}}]}, {"allOf": [{"$ref": "#/$defs/NozzleResult"}, {"properties": {"nozzle_number": {"const": 2}}}]}], "items": False}], "description": "Results retain target order and include not_started steps."}
d["CommandStatusDTO"] = {"type": "object", "required": ["command_id", "sequence_id", "device_id", "request_id", "idempotency_key", "status", "status_sequence", "created_at", "start_before", "targets", "nozzle_results", "safety_lockout", "lockout_resolution"], "properties": {"command_id": {"$ref": "#/$defs/Uuid"}, "sequence_id": {"$ref": "#/$defs/Uuid"}, "device_id": {"$ref": "#/$defs/Uuid"}, "request_id": {"$ref": "#/$defs/Uuid"}, "idempotency_key": {"$ref": "#/$defs/Uuid"}, "status": {"$ref": "#/$defs/CommandState"}, "status_sequence": {"$ref": "#/$defs/PositiveInteger"}, "created_at": {"$ref": "#/$defs/UtcDateTime"}, "start_before": {"$ref": "#/$defs/UtcDateTime"}, "targets": {"$ref": "#/$defs/ManualFeedTargets"}, "nozzle_results": {"$ref": "#/$defs/NozzleResults"}, "safety_lockout": {"type": "boolean"}, "lockout_resolution": {"oneOf": [{"$ref": "#/$defs/LockoutResolution"}, {"type": "null"}]}}, "description": "Sequence status aggregates ordered nozzle results. partial retains completed plus failed, unknown or not_started results."}

d["Schedule"]["required"].append("nozzle_number")
d["Schedule"]["properties"]["nozzle_number"] = {"$ref": "#/$defs/NozzleNumber"}
d["ActuatorReport"]["required"] = ["state", "active_sequence_id", "fault_code"]
d["ActuatorReport"]["properties"].pop("active_run_id", None)
d["ActuatorReport"]["properties"]["active_sequence_id"] = {"oneOf": [{"$ref": "#/$defs/Uuid"}, {"type": "null"}]}
d["EventAcknowledgement"]["required"] = ["sequence_id", "event_sequence"]
d["EventAcknowledgement"]["properties"].pop("run_id", None)
d["EventAcknowledgement"]["properties"]["sequence_id"] = {"$ref": "#/$defs/Uuid"}
d["CommandDelivery"] = {"type": "object", "required": ["command_type", "command_id", "sequence_id", "device_id", "request_id", "idempotency_key", "targets", "capabilities_revision", "created_at", "start_before", "status"], "properties": {"command_type": {"const": "feed"}, "command_id": {"$ref": "#/$defs/Uuid"}, "sequence_id": {"$ref": "#/$defs/Uuid"}, "device_id": {"$ref": "#/$defs/Uuid"}, "request_id": {"$ref": "#/$defs/Uuid"}, "idempotency_key": {"$ref": "#/$defs/Uuid"}, "targets": {"$ref": "#/$defs/ManualFeedTargets"}, "capabilities_revision": {"$ref": "#/$defs/PositiveInteger"}, "created_at": {"$ref": "#/$defs/UtcDateTime"}, "start_before": {"$ref": "#/$defs/UtcDateTime"}, "status": {"enum": ["queued", "accepted"]}}, "description": "One durable ordered sequence; later nozzles require prior stop and a valid settled shared-weight baseline."}

run = d["RunEvent"]
run["required"] = ["sequence_id" if x == "run_id" else x for x in run["required"]] + ["nozzle_number", "step_index"]
run["properties"]["sequence_id"] = run["properties"].pop("run_id")
run["properties"]["nozzle_number"] = {"$ref": "#/$defs/NozzleNumber"}
run["properties"]["step_index"] = {"type": "integer", "enum": [1, 2]}
run["properties"]["event_type"]["enum"].append("not_started")
for rule in run["allOf"]:
    if "if" in rule and "outcome_status" in rule["if"].get("properties", {}):
        rule["if"]["properties"]["outcome_status"].get("enum", []).append("not_started")
run["allOf"][-2]["oneOf"].append({"properties": {"event_type": {"const": "not_started"}, "outcome_status": {"const": "not_started"}}})
run["allOf"].append({"if": {"properties": {"event_type": {"const": "not_started"}}, "required": ["event_type"]}, "then": {"properties": {"reason_code": {"type": "string", "minLength": 1}, "measured_dispensed_g": {"type": "null"}, "measurement_quality": {"enum": ["unavailable", "uncalibrated", "error"]}}}})
run["description"] = "Each event is one nozzle step in a stable sequence_id/event_sequence stream; device reservation spans actuation and settling."
d["ScheduledOccurrenceTarget"] = {"type": "object", "required": ["schedule_id", "nozzle_number", "occurrence_local_date", "configuration_revision", "dose"], "properties": {"schedule_id": {"$ref": "#/$defs/Uuid"}, "nozzle_number": {"$ref": "#/$defs/NozzleNumber"}, "occurrence_local_date": {"$ref": "#/$defs/LocalDate"}, "configuration_revision": {"$ref": "#/$defs/PositiveInteger"}, "dose": {"$ref": "#/$defs/Dose"}}, "description": "Occurrence identity is device_id + schedule_id + local date; nozzle, dose and revision are not identity."}
d["ScheduledSequenceAdmission"] = {"type": "object", "required": ["protocol_major", "device_id", "sequence_id", "due_at", "admitted_at", "first_start_before", "targets"], "properties": {"protocol_major": {"$ref": "#/$defs/ProtocolMajor"}, "device_id": {"$ref": "#/$defs/Uuid"}, "sequence_id": {"$ref": "#/$defs/Uuid"}, "due_at": {"$ref": "#/$defs/UtcDateTime"}, "admitted_at": {"$ref": "#/$defs/UtcDateTime"}, "first_start_before": {"$ref": "#/$defs/UtcDateTime"}, "targets": {"oneOf": [{"type": "array", "minItems": 1, "maxItems": 1, "items": {"$ref": "#/$defs/ScheduledOccurrenceTarget"}}, {"type": "array", "minItems": 2, "maxItems": 2, "prefixItems": [{"allOf": [{"$ref": "#/$defs/ScheduledOccurrenceTarget"}, {"properties": {"nozzle_number": {"const": 1}}}]}, {"allOf": [{"$ref": "#/$defs/ScheduledOccurrenceTarget"}, {"properties": {"nozzle_number": {"const": 2}}}]}], "items": False}]}}, "description": "Admit same-time due occurrences atomically under one device reservation. first_start_before gates target 1 only; target 2 starts only after nozzle 1 stops and a valid settled shared-weight baseline. Its deadline is baseline_ready_at + scheduler_wake_grace_ms. A null settling limit is unknown, never zero."}
(root / "schemas/v2.schema.json").write_text(json.dumps(s, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
