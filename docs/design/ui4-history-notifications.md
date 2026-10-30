# ART-121 — History, filters, run details and notifications

Uses [ART-117 revision 10](ui4-native-foundation/README.md) and the ART-118 shared native theme. The delivery is stacked on ART-118 PR #62 at `d57cac1`; no backend, notification-controller, package or lockfile changes.

## Route/state coverage

| Surface | Presentation and retained contract | Evidence |
| --- | --- | --- |
| `/history` summary | Neutral theme-aware summary tiles, visible timezone and active-filter count; existing date range/counts | Types/lint and existing filter checks |
| History groups/rows | Time first, source, each targeted nozzle, saved status and valid measured/simulated summary; stable group/sequence keys | Render/action check; feed-status check |
| History loading/error/load more | Existing skeletons, retry, stale-results notice, cursor/loading behavior and selected-device scope preserved | Existing motion/device-access checks; render check retains Load more |
| No history / no matches | Separate neutral cards; Clear filters retains its existing handler | Source review and existing filter checks |
| Full filter sheet | Muted date/source/status groups; white/dark surface controls; native date bounds/status selection, Reset/Apply/Cancel retained | Existing motion check exercises invalid/inverted dates and retained selections |
| `/history/[runId]` | Matching fixed back header, feeder context, status below source, separate nozzle results, wrapping status heading and stacked phone/large-text values | Render check covers large text, unavailable measurement, simulator measured/estimated values, lockout warning and revoked scope |
| Detail loading/unavailable | Existing skeletons and unavailable message, scope cancellation and read-only behavior retained | Render check and device-access checks |
| `/notifications` | Grouped neutral alert rows, severity/unknown icons, visible Read/Unread, day plus event time, explicit phone timezone, descriptive delete labels and empty state | Render check plus existing alerts/motion checks |
| Notification actions | Mark read/all-read, delete confirmation, select feeder then navigate with original run/device IDs, close/back retained | Render/action check and existing alert/device-access checks |
| Permissions / app-open / remote delivery | Notification controller and permission UI unchanged | No delivery or physical-runtime claim |

## Validation

Run from `mobile/`:

```text
npm run lint
npm run typecheck
node scripts/check-history-presentation.mjs
npm run check:feed-status
npm run check:alerts
npm run check:error-text
npm run check:motion
npm run check:device-access
```

The focused render check uses synthetic fixtures and the existing TypeScript/VM pattern; it does not contact a feeder. It first failed on the missing visible unread state before implementation. Existing motion checks now find notification rows by component rather than a fixed child position, and require the retained event time beside the day.

All commands above passed on October 30, 2026. Metro also compiled the Android development bundle successfully (HTTP 200, 6,855,114 bytes). The initial unrestricted-worker attempt hit the Windows paging-file limit; the successful retry and retained development server use `--max-workers 2`. Bundle compilation does not prove physical rendering or notification delivery.

## Remaining acceptance gates

No physical Android device was connected (`adb devices` was empty). Physical captures of history/filter/detail/alerts in both themes, small phone and large text, reduced motion, TalkBack, native calendar/menu and keyboard/back/close behavior remain unverified. The app's existing portrait orientation is preserved; no landscape-support claim. No emulator, iOS validation, physical feeding, cloud notification delivery, merge or deployment is included.

The native source still uses the shared semantic theme and existing motion behavior. No entrances were added to result rows, so pagination does not introduce animation replay or a new scroll/focus reset.
