# Shared native foundation — ART-118

Parent: [ART-117](https://linear.app/artkin/issue/ART-117)  
Issue: [ART-118](https://linear.app/artkin/issue/ART-118/ui4-01-shared-native-theme-floating-navigation-branding-and-motion)

## Approved reference

Follow revision 10 of the parent attachment: revision 07 neutral surfaces, the supplied revision 09 mascot, and the selected revision 10 app icon. The source HTML is design evidence only, not an application implementation. Preserved contract and issue notes are in [the reference folder](ui4-native-foundation/README.md). The reference HTML SHA-256 is 31ddbda7fd982db74fee0fcdf13c3c6c94cf584ee2c4d2b19e8ff0256e2ad26c.

## Semantic colors

| Token | Light | Dark |
| --- | --- | --- |
| background | #F4F5F6 | #161A1D |
| surface | #FFFFFF | #22282C |
| surfaceMuted | #ECEFF0 | #2B3236 |
| text / ink | #20272A | #F4F6F7 |
| textSecondary | #58646B | #B6C0C5 |
| textTertiary | #738087 | #8D9AA0 |
| primary | #22292C | #22292C |
| border | #DDE3E6 | #343D42 |
| controlBorder | #849197 | #748087 |
| chartLine | #126782 | #18B7B0 |
| chartGrid | #DFE8EA | #394348 |
| plotBackground | #F0F6F6 | #20272B |
| accent | #18B7B0 | #18B7B0 |

Blue and aqua stay localized to chart details and brand art. Warning, failure, loading, connection, and stale states retain their labels and icons in both themes. Cards use meaningful groups and restrained borders; there are no gradients or full-screen color washes.

## Appearance and motion preferences

useAppTheme() resolves Light, Dark, or System and exposes the local motion preference to the Settings child. Initial appearance is System and motion is on. Values are stored under aquafeedpro.ui.appearance and aquafeedpro.ui.motion using the app's existing local storage support. Missing, invalid, unavailable, or unreadable storage falls back safely. These values never enter feeder configuration or backend requests.

System mode follows OS changes through React Native Appearance without an app restart. Motion is reduced if the local preference is off, the OS requests reduced motion, or the app is backgrounded. Existing entrances, presses, sheets, and skeleton feedback stop or settle on preference/scope changes and unmount. Numeric animation frames are finite and remain separate from semantic readings.

## Shared native navigation and components

The dock keeps the current Home, Schedule, History, and Settings labels, the Settings /device route, and backBehavior="history". It floats above the bottom safe area, reserves scene space for scrollable content, keeps at least 48 logical units for each target, and announces the selected tab. Selection and press feedback are short and follow reduced-motion settings. It does not call device actions.

AppPage, BentoCard, buttons, text fields, grouped rows, chips, status labels, notices, skeletons, segmented controls, Sheet, and shared progress elements use the same semantic palette. Shared Text, View, Pressable, and icon wrappers let existing screen and sheet content inherit the selected palette without changing screen data, forms, route handlers, validation, or command behavior.

| Route group | Existing routes | Foundation coverage |
| --- | --- | --- |
| Home | / | Shared shell and controls; chart uses current chart tokens |
| Schedule | /schedule, /schedules/new, /schedules/[scheduleId] | Shared shell, forms, segmented and grouped controls |
| Manual feed | /feed/confirm | Shared shell, form, notices, and confirmation surface |
| History and alerts | /history, /history/[runId], /notifications | Shared shell, filters, date/status controls, and rows |
| Settings and devices | /device, /devices/add, /devices/[deviceId], /settings/[field] | Shared shell, form controls, notices, and sheets |
| Shared transient states | Sheets and dialogs from existing routes | Current surface, text, borders, scrim, and OS appearance |

The development component gallery can switch between light and dark previews and demonstrates button, disabled, loading, error, selected, form, status, chart-progress, empty, skeleton, and sheet states. Later UI4 children own their screen layouts and visible appearance controls.

## Branding and platform configuration

| Asset | Source SHA-256 | Use |
| --- | --- | --- |
| aquafeedpro-mascot.png | e0a68ef1b21c11d65e45163c21ab8cdfd5a54659f8e2a4ce5d215c31076c3c82 | Loading/large placements and splash |
| v2 three-quarter app icon | de235391b25e43d81423423e47f072c1b65f8355f317818892516f497f071829 | Header, app icon, Android foreground, and favicon |

The Android adaptive icon uses the supplied square icon and mint background color. The app splash uses the mascot on a neutral background. The existing iOS icon path, app identity, scheme, notification settings, permissions, and EAS project ID are preserved.

## Validation and evidence

The required checks are npm run lint, npm run typecheck, npm run check:motion, npm run check:button-state, and npm run check:error-text, plus the focused UI preference check. The Android launcher, dock safe-area clearance, large text, theme change, and reduced-motion flow still require physical Android development-build evidence. No emulator or feeder actuation is part of this work.
