# Scheduled missed feeding alerts — unverified SQL gate

Migration: `supabase/migrations/20261103120000_scheduled_missed_feeding_alerts.sql`.

No local PostgreSQL client/runtime was available to this worker. PATH has no `psql`, Docker or Supabase CLI; the discovered `C:/Program Files/PostgreSQL/17` contains data only, not client binaries. No installation, service startup, database access or remote migration was attempted. **The migration and SQL assertions are authored, NOT executed or accepted.** Mocked sender/API tests do not validate SQL.

On an authorized isolated, quiescent local clone with all versioned migrations applied and reserved simulator fixtures 222/333 clean, execute using an explicitly local connection (never cloud credentials):

```sh
psql "$LOCAL_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/art95_server_alerts.sql
psql "$LOCAL_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/art96_push_delivery.sql
```

Each suite uses a transaction and rolls back. ART95 now covers scheduled rejected/expired insert, repeated status, later failed same-kind deduplication, null measurement facts, existing enqueue pipeline, revoked token/membership suppression; its prior manual refusal and failed/partial/unknown/unmeasured cases remain. ART96 covers final send access/token-generation revalidation and queue/lease behavior. Do not run a sender or emit real pushes to validate these tests.

`feeding_failed` is intentionally reused for failed AND missed scheduled outcomes, with neutral shared phone/push copy: **Feeding needs attention / No completed feeding confirmed**. It never asserts measured zero, attempted physical dispensing, or that an unknown/partial outcome failed. Manual rejected/expired remain excluded. Existing trigger function lock, ordering, security and unique event identity are unchanged; there is no historical backfill or client-created event. Raw status/reason remain in read-only feeding details.

Deployment, real phone notification permission/token/sender configuration, iOS push support and physical feeding remain separate unverified gates.
