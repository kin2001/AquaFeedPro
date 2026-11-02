# AquaFeed Pro mobile app

The Git repository root is the parent `AquaFeedPro/` directory; this folder is the Expo application. See the [repository README](../README.md) for setup, environment boundaries, and platform status. The shared protocol baseline and exact validator commands are in [`contracts/README.md`](../contracts/README.md).

## Install and start

This checkout targets Expo SDK 58. Use Expo Go for SDK 58 on the physical Android
test phone. The SDK upgrade also requires rebuilding any existing development
client before using it with this checkout.

From this directory, install the committed dependency graph and open Expo Go:

```powershell
npm.cmd ci
npm.cmd run start -- --go
```

On other platforms, use the same commands with `npm` instead of `npm.cmd`.

## Checks

```powershell
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
```

Use `npm` in place of `npm.cmd` outside Windows. TypeScript loads Expo's `expo/types` declarations directly, so typechecking does not depend on the ignored, generated `expo-env.d.ts` file. CI runs these checks on pull requests and pushes to `main`.
