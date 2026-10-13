# Demo data

## 1. What this is

Simulator data in the development project, so you can look at the app with a
populated feeder. Everything comes from the existing simulator
([art31_simulator.py](../supabase/scripts/art31_simulator.py)) through the real
device API. It is not hardware evidence, not calibration, and it never touches
GPIO. The app labels it "Simulator data · not a hardware measurement".

## 2. Before you start

- The credential files are in the `.device-secrets` folder of the checkout that
  provisioned the simulators (on this PC: the Orca worktree
  `D:\Workflow\Orca-workspaces\workspaces\AquaFeedPro\art38-device-access\.device-secrets`).
  Pass that folder as `-SecretsDir`. Never copy the files into chat, commits or
  logs.
- A feeder that has synced before must keep its own journal. The server already
  holds its applied configuration, and a new journal is refused on every sync
  with `device sync failed (422 VALIDATION_FAILED)`. Device 1 (`2222…`) is in
  that state. Before its first demo run, with no simulator running, copy its last
  journal to where `run-demo.ps1` looks. Do this once only: after the first run
  the copy is the feeder's journal, and copying again would roll it back. Leave
  the original where it is. Device 2 (`3333…`) has never synced and starts with a
  new journal.

  ```powershell
  New-Item -ItemType Directory -Force "$HOME\.aquafeedpro" | Out-Null; Copy-Item "D:\DevCache\aquafeed-art27-20261009\live-d5-ff46ab10-d3d0-4b41-b5a3-e3e41952e1e1.sqlite3" "$HOME\.aquafeedpro\demo-22222222-2222-4222-8222-222222222222.sqlite3"
  ```

- `run-demo.ps1` reads the public Supabase URL and publishable key from
  `mobile\.env.local` in the checkout you run it from. A fresh worktree does not
  have that file; copy it from the main checkout.
- Run one simulator process per device.
- Stop it with Ctrl+C when you finish. It writes about one telemetry row per
  second while it runs.

## 3. Start Device 1 with a day of history

First demo run for Device 1: do the journal copy in section 2 before this.

```powershell
.\supabase\scripts\run-demo.ps1 -SecretsDir "<path to .device-secrets>" -BackfillHours 24
```

Use `-BackfillHours` on the first start of a session only. Later restarts: the
same command without it.

## 4. Start Device 2

In a second terminal:

```powershell
.\supabase\scripts\run-demo.ps1 -SecretsDir "<path to .device-secrets>" -DeviceId 33333333-3333-4333-8333-333333333333 -BackfillHours 24
```

Use `-BackfillHours` on the first start of a session only. Later restarts: the
same command without it.

## 5. What you should see on Home

Within about 15 seconds:

- "Online · last contact … ago"
- a dissolved-oxygen value between about 4.1 and 7.1 mg/L
- the 1H graph with one break about 23 minutes back; the 6H and 24H graphs filled
- Feed 50 %
- the "Simulator data · not a hardware measurement" pill

## 6. Make schedules

Schedule tab → Add:

1. Nozzle 1, 50 g, five minutes from now.
2. Nozzle 2, 30 g, the same time.
3. One more later today.

Wait for "Applied". Home's Next tile now shows the time. When the time comes,
History gets two scheduled runs, Nozzle 1 before Nozzle 2.

## 7. Make a manual feeding

Home → Feed now → Both, 50 g and 30 g → Confirm. It appears in Recent activity
and History as "Manual feeding · Completed" with measured grams.

## 8. Make a failed feeding (optional)

Stop the simulator, start it again with `-Scenario fault-nozzle1`, do one manual
feeding on Nozzle 1, then restart with no `-Scenario`.

```powershell
.\supabase\scripts\run-demo.ps1 -SecretsDir "<path to .device-secrets>" -Scenario fault-nozzle1
```

## 9. See the offline state

Stop the simulator. After 45 seconds Home shows "Offline", readings show
"Outdated", and the Device tab shows "Offline · last contact is out of date".
The Device tab part needs ART-73.

## 10. Unknown outcome: do not run it

Do not run `-Scenario unknown-nozzle2` (or `unknown-nozzle1`). I found no
supported way to clear it. The simulator keeps an unknown feeding as an active
reservation, and nothing in it releases that reservation: not a restart, not a
late acknowledgment from the server (the self-test `run_self_test` asserts both
stay locked), and not a schedule lockout (`schedule_lockout_sequence` is only
ever set, never cleared). The app has no control for it either, so the feeder
would stay in a safety lockout and refuse every later feeding on that device.

## 11. If something is wrong

- "Online but the reading never updates": this journal is behind the server's
  cursor. The feeder was last run with a different journal. Use that journal;
  report it if it is lost.
- "Feed now says the device is busy": an earlier feeding was left open. Report
  it. Do not edit the database.
- `device sync failed (422 VALIDATION_FAILED)` on the first sync: this journal
  does not match the feeder's state on the server, usually a new journal for a
  feeder that already applied a configuration. Stop. Use the feeder's own journal
  as described in section 2. Do not edit the database.
- An authentication error on the first sync: the credential file may not be the
  active one. Re-provisioning is `supabase/scripts/provision-d2-devices.mjs
  resume`, run by the operator; do not rotate credentials from here.
- Running with `-BackfillHours` again adds a second set of samples. The graph
  shows the latest sample per bucket, so the picture stays the same, but the
  rows accumulate.
