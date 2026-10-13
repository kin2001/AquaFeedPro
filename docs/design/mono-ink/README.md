# Mono Ink — design reference

This folder is the visual source of truth for the mobile app redesign tracked in Linear
ART-56 and its sub-issues. Every screen issue names one file here. Match it exactly.

Exported October 12, 2026 from the owner's Claude Design canvas
(<https://claude.ai/artifact/WnqsgsnHGkZY7fvLuEBAyx>, version `1791793011-1a2b`).
The only edits made to the export: image URLs point at `assets/`, links point at the
renamed files, and the canvas runtime `<script>` line is removed so each file opens on
its own in a browser.

## Files

| File | Shows | App code it defines |
| --- | --- | --- |
| `Kit.html` | Brand, colours, type scale, every component and state | `mobile/src/constants/theme.ts`, `mobile/src/components/bento-kit.tsx` |
| `Launch.html` | Launch / installation-restore screen | loading branch of `mobile/src/app/_layout.tsx` |
| `Home.html` | Home tab | `mobile/src/app/(tabs)/index.tsx` |
| `FeedNow.html` | Feed now confirmation and progress | `mobile/src/app/feed/confirm.tsx` |
| `Schedule.html` | Schedule tab | `mobile/src/app/(tabs)/schedule.tsx` |
| `History.html` | History tab | `mobile/src/app/(tabs)/history.tsx` |
| `Device.html` | Device tab | `mobile/src/app/(tabs)/device.tsx` |
| `assets/aquafeed-pro-app-icon-v1.png` | App icon (white fish on `#18181B`) | Launch screen, Home header |
| `assets/aquafeed-pro-logo-v1.png` | Horizontal lockup | Shown on the Kit only; not used in the app |

Screens without an artboard (schedule form, feeding details, device details, pairing,
the device-picker sheet, the history filter sheet, the schedule action sheet) are built
from the Kit components exactly as their Linear issue describes.

## How to read a file

Each file is plain HTML with inline `style="…"` attributes. Those inline styles are the
specification. Read the file top to bottom; it is in screen order.

- **1 px = 1 dp.** Use the numbers as written.
- The root `width: 390px` and `min-height` are the artboard size. Do not copy them.
- The `<nav aria-label="Main">` at the bottom is the tab bar. It is built once in
  `(tabs)/_layout.tsx`, never per screen.
- Sample values (Feeder A, 5.8 mg/L, 72%, 6:00 PM, Asia/Manila) are illustrative. Real
  values come from the existing screen code. Never ship sample values.
- The dashed divider with the caption "After Confirm feed · replaces the button" in
  `FeedNow.html` is an annotation, not UI.
- To look at a screen, open the file in a browser. To get exact numbers, read the source.

## CSS to React Native

| In the reference | In React Native |
| --- | --- |
| `font-weight: 400 / 500 / 600` | `fontFamily: InterFamilies.regular / medium / semibold`. Never set `fontWeight`. |
| `font-size: A; line-height: B` | `fontSize: A, lineHeight: B`. Prefer the matching `Typography.*` token. |
| `letter-spacing: 0.8px` | `letterSpacing: 0.8` |
| `font-variant-numeric: tabular-nums` | `fontVariant: ["tabular-nums"]` on every number, time and quantity |
| Uppercase overline text | Write the string in normal case and use `Typography.overline` (it sets `textTransform: "uppercase"`) |
| `display: flex` (row by default) | `flexDirection: "row"`. React Native defaults to column. |
| `display: flex; flex-direction: column` | default `View` |
| `display: grid; grid-template-columns: repeat(N, minmax(0, 1fr))` | `flexDirection: "row"` and each child `flex: 1, minWidth: 0` |
| `gap`, `padding`, `margin`, negative margins | same property names and numbers |
| `padding: A B C D` | `paddingTop: A, paddingRight: B, paddingBottom: C, paddingLeft: D` |
| `border: 1px solid #X` | `borderWidth: 1, borderColor: …` using a `Colors.light.*` token |
| `border-top: 1px solid #X` | `borderTopWidth: 1, borderTopColor: …` |
| `border-radius: 999px` | `Radii.pill` |
| `flex: none` | `flexShrink: 0` |
| `min-width: 0` on a text column | `minWidth: 0, flex: 1` so text wraps instead of overflowing |
| `align-items: baseline` | `alignItems: "baseline"` |
| `overflow: hidden` on a rounded card | same; needed so row ripples and dividers clip to the radius |
| `<button>` / `<a>` | `Pressable` with `accessibilityRole="button"` (or `"link"`), through a kit component |
| `aria-label`, `aria-checked`, `aria-expanded` | `accessibilityLabel`, `accessibilityState={{ checked / expanded }}` |
| `white-space: nowrap` spans | ignore; let text wrap |
| `cursor`, `text-decoration`, `box-sizing`, `list-style`, `margin: 0` resets, `:hover` | web only; ignore |
| Any `#RRGGBB` | the `Colors.light.*` token with that value. Never a literal in a screen. |

Colour tokens (all in `mobile/src/constants/theme.ts`):

| Hex | Token |
| --- | --- |
| `#FAFAFA` as a background | `background` |
| `#FAFAFA` as text or icon on black | `onInk` |
| `#FFFFFF` | `surface` |
| `#F4F4F5` | `surfaceMuted` |
| `#18181B` | `ink` |
| `#52525B` | `textSecondary` |
| `#71717A` | `textTertiary` |
| `#E4E4E7` | `border` (also `progressTrack`, `chartGrid`) |
| `#8A8A93` | `controlBorder` |
| `#A1A1AA` | `onInkSecondary` |

## Icons

Every `<svg>` in the reference is a Lucide icon. Use `Lucide` from
`@react-native-vector-icons/lucide` with these names (all verified to exist in the
installed package). Sizes: 24 in the tab bar and the Feed now close button, 20 in cards,
rows and buttons, 16 inside status pills and field errors.

| Where it appears | Lucide name |
| --- | --- |
| Tab bar | `house`, `calendar-clock`, `history`, `cpu` |
| Device picker, device rows | `cpu`, `chevron-down` |
| Dissolved oxygen overline | `waves` |
| Feed tile | `container` |
| Next tile | `calendar-clock` |
| Manual feeding, Confirm feed | `utensils` |
| Row chevron, chart next | `chevron-right` |
| Chart previous | `chevron-left` |
| Disclosure | `chevron-down` |
| Header Add | `plus` |
| History Filter | `sliders-horizontal` |
| Schedule card menu | `ellipsis` |
| Feed now close | `x` |
| Stack screen back | `arrow-left` |
| Check status | `refresh-cw` |
| Selected chip, Selected pill | `check` |
| Info notice | `info` |
| Pending notice and pill | `clock` |
| Warning notice, Needs attention, Low feed | `triangle-alert` |
| Error notice, Failed, field error | `circle-x` |
| Completed, Within limits, Applied | `circle-check` |
| In progress | `loader` |
| Unknown outcome | `circle-help` |
| Not started | `circle-dashed` |
| Online, Contact recent | `wifi` |
| Offline | `wifi-off` |
| Enabled | `circle-play` |
| Paused | `circle-pause` |
| Simulator | `flask-conical` |

## Precedence

For anything visual (size, spacing, colour, icon, order on screen) these files win over
`DESIGN.md` and over prose in an issue. For behaviour, state handling, safety wording
and accessibility wiring, the existing code, `AGENTS.md` and the issue's Invariants win.
If the reference and an invariant conflict, keep the invariant and report the conflict.

## Round 2 overrides (ART-77)

For these elements the Linear issue wins over the HTML files in this folder.

| Element | Round 2 rule | Issue |
| --- | --- | --- |
| Tab header | Logo (32) at the right on all four tabs; an optional icon button sits to its left; an optional status line sits under the title | UI2-01 |
| Device picker | Removed from Home, Schedule and History | UI2-02, 04, 05 |
| Primary action of a tab | 56 px round ink button, bottom right, 16 above the tab bar: `utensils` on Home, `plus` on Schedule and Settings | UI2-01 |
| Notices | No outlined box; muted background for every tone | UI2-01 |
| Full-screen error | Centered icon, title, one sentence, Try again | UI2-01 |
| Oxygen card | Range is a dropdown pill in the card header; smooth line; times in the phone's time zone | UI2-02 |
| Feed now | Bottom sheet over Home | UI2-03 |
| Device tab | Replaced by Settings (`settings` icon in the tab bar) | UI2-06 |
