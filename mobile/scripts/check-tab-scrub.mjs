import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";
const path = new URL("../src/components/tab-presentation.tsx", import.meta.url);
const exports = {};
if (existsSync(path))
  vm.runInNewContext(
    ts.transpile(readFileSync(path, "utf8"), {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      require: (name) =>
        name === "react"
          ? { createContext: () => ({}), useCallback: (fn) => fn }
          : name === "react-native"
            ? {
                StyleSheet: { create: (x) => x },
                useWindowDimensions: () => ({ width: 375 }),
              }
            : name === "@/constants/theme"
              ? { Colors: { light: {} } }
              : {},
    },
  );
assert.equal(
  typeof exports.releaseTab,
  "function",
  "dock release policy must commit real destination exactly once",
);
assert.equal(
  typeof exports.declaredTabs,
  "function",
  "sparse Router indices must map to declared slot positions",
);
for (const [name, index] of [
  ["device", 3],
  ["history", 2],
]) {
  const state = {
    routeNames: ["index", "schedule", "history", "device"],
    routes: [{ name, key: `actual-${name}`, params: { deviceId: "fixture" } }],
    index: 0,
    history: [{ type: "route", key: `actual-${name}` }],
  };
  const display = exports.declaredTabs(state);
  assert.equal(display.index, index);
  assert.equal(display.routes[index].key, `actual-${name}`);
  assert.equal(display.routes[index].params.deviceId, "fixture");
  assert.equal(state.index, 0);
  assert.equal(state.routes.length, 1);
}
const commits = [];
const commit = (index) => {
  commits.push(index);
  return true;
};
assert.equal(exports.releaseTab(3, 0, 4, commit), 3);
assert.deepEqual(commits, [3]);
assert.equal(exports.releaseTab(1, 3, 4, commit), 1);
assert.deepEqual(commits, [3, 1]);
assert.equal(exports.releaseTab(1.49, 1, 4, commit), 1);
assert.equal(commits.length, 2);
assert.equal(exports.releaseTab(9, 0, 4, commit), 3);
assert.equal(exports.releaseTab(-9, 3, 4, commit), 0);
assert.equal(
  exports.releaseTab(2, 0, 4, () => false),
  0,
  "prevented release restores committed tab",
);
assert.equal(exports.scrubPosition(0, 320), 0);
assert.equal(exports.scrubPosition(320, 320), 3);
assert.equal(
  exports.scrubPosition(160, 320),
  1.5,
  "held midway stays fractional",
);
assert.equal(
  exports.scrubPosition(120, 320),
  1,
  "reversal follows current finger coordinate",
);
console.log(
  "Dock scrub release/clamp/fractional/reversal/prevention policy checks passed; rendered real-scene and gesture lifecycle require browser/native evidence.",
);
