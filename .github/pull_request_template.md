## Task and acceptance

- Task / approved scope:
- Acceptance criteria and evidence:
- PR base: `feat/backend-improvement` for backend task PRs (verify before opening).
- Exact implementation commit reviewed by orchestrator:

## Behavior and compatibility

- What changed / user-visible behavior:
- App / API / device / contract compatibility and preserved safety guarantees:

## Observed checks

| Check                                                            | Exact commit / command or CI link | Observed result |
| ---------------------------------------------------------------- | --------------------------------- | --------------- |
| Formatting, lint, types / mobile behavior                        |                                   |                 |
| Contracts                                                        |                                   |                 |
| Isolated migrations, SQL suites and deliberate assertion failure |                                   |                 |
| Offline simulator checks                                         |                                   |                 |

Distinguish PASS, FAIL, SKIP and NOT RUN. Mock/simulator success is not real SQL, push, native-device or physical feeding acceptance.

## Migration and recovery impact

- New forward migrations (or none), verified target / backup / isolated restore evidence:
- Compatibility, lock/data impact and nondestructive recovery record: see `supabase/migrations/BACKEND_RECOVERY.md`.
- Compatible app/API rollback or feature/enrollment pause; evidence preserved:

## Remaining gates

- Unverified checks, blockers and risks:
- Orchestrator review verdict and reviewed SHA (not worker self-approval):

PR creation does not authorize merge, deployment, shared-data cleanup or hardware operation.
