# ART-46 / H1 checkpoint

Recorded October 10, 2026, Asia/Manila. Status: local inspection started;
authoritative Pi inspection and physical characterization blocked because the
owner does not have the Pi available. This is a hardware-access blocker, not a
quota stop. Do not schedule retries or mark H1 complete.

## Authorization and live scope

The owner selected “Start ART-46, the next task in sequence.” This resumes H1
only. ART-48 / H2 and ART-52 / R1 remain dependent work, outside this assignment.
The earlier hardware deferral in the repository plan is historical; current H1
authorization does not establish physical readiness or measured limits.

- Live issue: https://linear.app/artkin/issue/ART-46/h1-physical-inspection-and-characterization
- Issue UUID: `7dd499ae-29d5-4044-9991-b66724e2e4cf`.
- Assigned to Kin, In Progress for the started local inspection. The team has
  no Blocked state; the unavailable-Pi blocker is explicit in its description.
  Evidence comment: `405308a9-c4d1-4d99-bdb8-1f2f8b563e2f`.
- ART-5, its sole recorded predecessor, was read live and is Done.
- Read-only Notion plan: https://app.notion.com/p/3ec224a56ef381668a7ce7fa63c02bcd
- Read-only Notion hardware handoff: https://app.notion.com/p/3ec224a56ef38117967fccea6611e02f

## Current evidence and preserved state

Canonical app checkout: `D:\thesis commision\Automated Fish Feeding System\AquaFeedPro`.
Local main: `ea5e6281f6ed9fdbfb20769963f72abbcd4e3862`; remote main verified
with `git ls-remote`: `47eb3f126ed3808cb02c65bacc7d34b3e5b09031`.
Owner changes and original checkpoints are preserved. This coordinator-only
checkpoint is not an implementation candidate or a PR.

Prior ART-45 Orca task `task_85a62656a3e0`, dispatch `ctx_0f8f7a81ba47`, is
settled succeeded. Exact recorded native/launcher PIDs 21348/5060 and earlier
quota PIDs 12012/14208 were absent on fresh inspection. No new writer or H1
dispatch was started. Keep original Codex home/account and required actual
Luna Max implementation plus independent Sol High review when implementation
becomes ready; apply Ponytail full. No UI work is assigned.

The Windows mirror is `D:\thesis commision\Automated Fish Feeding System\fishFeeder`.
Only its six Python files were read as text; no driver was imported or executed.
Hashes are retained in `D:\DevCache\aquafeed-art46-20261010\local-source-manifest.json`.
Neither the Windows mirror nor the September 5 PC tracker proves current Pi
source, wiring, installed components or calibration.

- `loadcell.py` initializes and resets HX711 on import, uses BCM5/6, and loads
  adjacent `loadcell_calibration.json`. `calibrateLoadcell.py` writes calibration.
  The calibration JSON is absent from the inspected Windows mirror; preserve
  the actual device file and never replace it with PC data.
- `servo.py` uses AngularServo with a 0..90 command range and detach/cleanup.
  `test/hardwaretest.py` calls a 0..90..0 sweep. Earlier owner evidence recorded
  a continuous-rotation MG996R; that history is not a fresh hardware finding.
  Do not use this positional sweep on an unverified unit. Current neutral,
  stop behavior and fail-safe behavior must be established on the actual unit;
  detach or a historical command value is not proof of safe physical stop.
- `motor.py` implements one configurable DRV8871 motor. The menu uses BCM18/13
  and a two-second run. These are source defaults, not validated current wiring,
  per-nozzle mappings or approved runtime limits.
- `main.py` is a load-cell monitor, not the integrated two-nozzle device agent.

## Concrete access blocker

Codex project inventory exposed no connected Pi project. Orca host inventory
listed only the local Windows host and no saved remote environments.
The sole address in the existing SSH known-host inventory was `192.168.8.115`.
One bounded, read-only SSH attempt with the existing key, BatchMode and strict
host-key checking timed out at port 22 after eight seconds. No remote command
executed, credential was changed or network scan performed. The owner then
confirmed: “i dont have pi right now.”

Unblocking condition: the owner has the Pi/feeder available with its current SSH
address and relevant physical components, references and operator access.

## Resume inspection and characterization checklist

1. Re-read live ART-46 scope/status/owner/blockers, read-only Notion and fresh
   allowance. Check previous exact worker state and prevent a competing writer.
2. Verify SSH host identity and actual source directory, historically
   `/home/pi/fishFeeder`. Inventory current files, SHA-256 hashes, runtime,
   installed dependency versions, services and any active feeder process without
   importing GPIO drivers. Preserve a private calibration backup and compare
   relevant PC/Pi files before editing. Do not assume historical paths are current.
3. Record actual Pi model, both nozzle actuators, servo variant, driver, pin map,
   supply/common ground, hopper/load-cell mounting, capacity and cable forces.
   Identify current stop/neutral and safe isolation procedure before actuation.
4. Inventory the DO probe/controller and actual units/interface, calibration,
   warmup/compensation, sample interval, resolution and failure indications;
   inventory RTC/NTP/timezone, clock validity, drift and cold-start behavior.
   Keep unsupported mg/L, feed-percentage and biological thresholds unknown.
5. Agree reference masses, independent catch scale, trial count, requested dose
   range, representative feed/hopper conditions and acceptable error before an
   acceptance run. Preserve original calibration; do not copy old values.
6. Use the existing per-nozzle record in `ANDROID-HARDWARE-HANDOFF.md` to retain
   raw observations, operator/date, uncertainty and evidence locations. Measure
   shared-hopper tare/refill/drift/stability and each nozzle separately. Establish
   repeatability, settle criteria, stop/fault observations and defensible limits.
7. Reserve the entire device for operation and settling. When both nozzles are
   involved, run nozzle 1 then nozzle 2; never in parallel. Uncertain stop, invalid
   weight or a fault halts later legs. Never repeat or resume uncertain actuation.
8. Dispatch any necessary source implementation only after current hardware and
   ownership make the scope concrete, using actual Luna Max through Orca;
   independently review with Sol High and run focused checks. H1 completion
   requires recorded physical evidence. H2 integration/recovery bench acceptance
   and R1 pilot/release remain separately gated.

No hardware accuracy, safe-stop limit, production readiness or physical
acceptance is claimed. No migrations, cloud deployment, app tests or unchanged
CI reruns were needed for this read-only inspection and coordinator checkpoint.
