// Offline: real update modules/readers; only React host, timers, transport and API are doubles.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const base = "1b808cffa7ecf7098f3816df67702dd4e4ef0e1a";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const repo = new URL("../../", import.meta.url);
function oldFixtureFiles(directory) {
  return readdirSync(new URL(directory + "/", repo), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const path = directory + "/" + entry.name;
    if (path === "contracts/fixtures/app-device-updates-v1") return [];
    return entry.isDirectory() ? oldFixtureFiles(path) : [path];
  });
}
const frozen = [
  "contracts/schemas/v1.schema.json",
  "contracts/schemas/v2.schema.json",
  "contracts/openapi.yaml",
  "contracts/openapi-v1.yaml",
  ...oldFixtureFiles("contracts/fixtures"),
].sort();
let bytes = 0;
const pins = frozen.map((path) => {
  const value = readFileSync(new URL(path, repo));
  bytes += value.length;
  return `${path}\0${value.length}\0${sha(value)}\n`;
});
assert.equal(frozen.length, 222);
assert.equal(bytes, 666936);
assert.equal(
  sha(pins.join("")),
  "330f1555b75dc13bb383b4a3dee5ec6b4e980bb58806d4b0cfbc66b63cb52f98",
);
if (process.argv.includes("--frozen-details"))
  for (const pin of pins) console.log(pin.trimEnd().replaceAll("\0", " | "));
console.log(
  `PASS frozen baseline ${base}: 222 files / 666936 bytes; sorted per-file path+bytes+SHA256 digest 330f1555b75dc13bb383b4a3dee5ec6b4e980bb58806d4b0cfbc66b63cb52f98`,
);

registerHooks({
  resolve(s, c, next) {
    if (s === "./device-access")
      return { url: "offline:updates-api", shortCircuit: true };
    if (s === "expo-secure-store")
      return { url: "offline:updates-storage", shortCircuit: true };
    if (s === "react")
      return { url: "offline:updates-react", shortCircuit: true };
    if (s.startsWith("./") && c.parentURL?.includes("/src/lib/"))
      return next(new URL(s + ".ts", c.parentURL).href, c);
    return next(s, c);
  },
  load(url, c, next) {
    if (url === "offline:updates-api")
      return {
        format: "module",
        shortCircuit: true,
        source:
          "export const requestAppApi=(...args)=>globalThis.__updatesApi(...args);",
      };
    if (url === "offline:updates-storage")
      return {
        format: "module",
        shortCircuit: true,
        source:
          "export const getItemAsync=async()=>null;export const setItemAsync=async()=>{};export const deleteItemAsync=async()=>{};",
      };
    if (url === "offline:updates-react")
      return {
        format: "module",
        shortCircuit: true,
        source: [
          "createContext",
          "createElement",
          "useContext",
          "useMemo",
          "useEffect",
        ]
          .map(
            (key) =>
              `export const ${key}=(...args)=>globalThis.__updatesReact.${key}(...args);`,
          )
          .join("\n"),
      };
    if (url.endsWith("/device-updates.tsx"))
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText,
      };
    return next(url, c);
  },
});
const state = await import("../src/lib/device-update-state.ts");
const device = "11111111-1111-4111-8111-111111111111";
const otherDevice = "22222222-2222-4222-8222-222222222222";
const hint = (resources = ["do"], revisions = { do: 1 }, id = device) => ({
  device_id: id,
  resources,
  revisions,
});
assert.deepEqual(
  state.parseDeviceUpdateHint(hint(), device),
  hint(),
  "closed hint accepts valid canonical scope",
);
for (const value of [
  null,
  [],
  "{}",
  {},
  { ...hint(), extra: true },
  { ...hint(), device_id: otherDevice },
  { ...hint(), device_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
  hint([], {}),
  hint(["do", "do"]),
  hint(["row"], { row: 1 }),
  hint(["do"], {}),
  hint(["do"], { do: 1, feed: 2 }),
  ...[
    "1",
    -1,
    0.5,
    NaN,
    Infinity,
    -Infinity,
    9007199254740992,
    null,
    {},
    true,
  ].map((n) => hint(["do"], { do: n })),
]) {
  assert.equal(
    state.parseDeviceUpdateHint(value, device),
    null,
    "closed hint rejects malformed/unsafe/out-of-scope input",
  );
}
assert.equal(state.parseDeviceUpdateHint(hint(), "bad"), null);
assert.deepEqual(
  state.parseDeviceUpdateHint(
    hint(["feed", "do"], { do: 0, feed: 9007199254740991 }),
    device,
  ),
  hint(["feed", "do"], { do: 0, feed: 9007199254740991 }),
);
console.log(
  "PASS closed runtime hint boundaries (including nonfinite JS numbers)",
);
const hintDir = new URL(
  "../../contracts/fixtures/app-device-updates-v1/",
  import.meta.url,
);
const manifest = JSON.parse(
  readFileSync(new URL("manifest.json", hintDir), "utf8"),
);
for (const fixture of manifest.fixtures) {
  assert.equal(
    state.parseDeviceUpdateHint(
      JSON.parse(readFileSync(new URL(fixture.file, hintDir), "utf8")),
      manifest.device_id,
    ) !== null,
    fixture.expect === "valid",
    `runtime fixture parity ${fixture.file}`,
  );
}
console.log(
  `PASS ${manifest.fixtures.length} separate app hint fixtures through real runtime parser`,
);

// Losing a generation or comparing revisions without initial dirty must fail these assertions.
let r = state.createResourceUpdateState(["do", "feed"]);
const reduce = (event) => (r = state.reduceResourceUpdate(r, event));
reduce({ type: "hint", hint: hint(["do", "feed"], { do: 0, feed: 0 }) });
assert.ok(
  r.generation > r.completed,
  "zero/equal hints cannot skip required initial read",
);
reduce({ type: "start" });
assert.equal(
  r.flight?.generation,
  1,
  "start captures initial dirty generation",
);
reduce({ type: "hint", hint: hint(["do", "feed"], { do: 3, feed: 5 }) });
reduce({ type: "success" });
assert.ok(
  r.generation > r.completed,
  "first-fetch hint remains dirty after old success",
);
assert.equal(r.highest.do, 3);
assert.equal(r.highest.feed, 5);
reduce({ type: "start" });
const captured = r.flight;
reduce({ type: "start" });
assert.equal(
  r.flight,
  captured,
  "second start cannot replace in-flight capture",
);
reduce({ type: "hint", hint: hint(["do", "feed"], { do: 2, feed: 8 }) });
assert.equal(r.highest.do, 3, "mixed lower/new hint retains highest do");
assert.equal(r.highest.feed, 8);
reduce({ type: "success" });
assert.equal(r.read.feed, 5, "success acknowledges only captured revisions");
assert.ok(r.generation > r.completed);
reduce({ type: "start" });
reduce({ type: "failure" });
assert.ok(r.generation > r.completed, "rejection retains dirty");
assert.equal(r.flight, null);
reduce({ type: "start" });
reduce({ type: "success" });
assert.equal(r.completed, r.generation);
assert.equal(r.read.feed, 8);
const settled = r;
for (const event of [
  hint(["do", "feed"], { do: 3, feed: 8 }),
  hint(["do", "feed"], { do: 0, feed: 2 }),
  hint(["contact"], { contact: 99 }),
])
  reduce({ type: "hint", hint: event });
assert.equal(
  r,
  settled,
  "duplicate/lower/unrelated hints do not dirty or change state",
);
reduce({ type: "invalidate" });
assert.ok(
  r.generation > r.completed,
  "focus/rejoin invalidates even equal revisions",
);
reduce({ type: "reset" });
assert.deepEqual(r, state.createResourceUpdateState(["do", "feed"]));
console.log(
  "PASS reducer initial/read/hint race, max counters, captured success, rejection, duplicate/lower/mixed, invalidate/reset",
);

const tasks = new Map();
let time = 0,
  nextTask = 0,
  rendering;
globalThis.setTimeout = (run, delay = 0) => {
  const id = ++nextTask;
  tasks.set(id, { run, at: time + delay });
  return id;
};
globalThis.clearTimeout = (id) => tasks.delete(id);
const drain = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
async function advance(ms = 0) {
  await drain();
  const end = time + ms;
  for (let turns = 0; ; turns++) {
    assert.ok(turns < 1000, "no timer hot loop");
    const next = [...tasks]
      .filter(([, task]) => task.at <= end)
      .sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    time = next[1].at;
    tasks.delete(next[0]);
    next[1].run();
    await drain();
  }
  time = end;
  await drain();
}
globalThis.__updatesReact = {
  createContext: (value) => {
    const context = { current: value };
    context.Provider = { context };
    return context;
  },
  createElement: (type, props, children) => ({
    type,
    props: { ...props, children },
  }),
  useContext: (context) => context.current,
  useMemo: (...args) => rendering.useMemo(...args),
  useEffect: (...args) => rendering.useEffect(...args),
};
const updates = await import("../src/lib/device-updates.tsx");
const monitoring = await import("../src/lib/monitoring.ts");
const schedules = await import("../src/lib/schedules.ts");
const metric = JSON.parse(
  readFileSync(
    new URL(
      "../../contracts/fixtures/examples/v2/metric-280-snapshot-valid.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const legacy = JSON.parse(
  readFileSync(
    new URL(
      "../../contracts/fixtures/examples/v2/monitoring-snapshot-valid.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const scope = {
  installationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  deviceId: device,
  scopeRevision: 1,
};
const binding = (focus, query = "day") => ({ focus, query });
function fixture(options = {}) {
  const calls = [],
    channels = [],
    view = {};
  globalThis.__updatesApi = (installation, path, method, body, headers) =>
    new Promise((resolve, reject) => {
      assert.equal(method, "GET");
      assert.equal(body, undefined);
      calls.push({ installation, path, headers, resolve, reject });
    });
  const subscribe = (name, id, onHint, onConnection) => {
    assert.equal(name, "device-updates");
    const channel = { id, onHint, onConnection, removed: false };
    channels.push(channel);
    options.onSubscribe?.(channel);
    return () => {
      channel.removed = true;
    };
  };
  const owner = updates.createDeviceUpdates(options.scope ?? scope, subscribe);
  const reader = (kind, label) => async (context) => {
    try {
      const result = await {
        metric: monitoring.readMetricSnapshot,
        legacy: monitoring.readMonitoringSnapshot,
        configuration: schedules.readConfiguration,
      }[kind](context.scope.installationId, context.scope.deviceId);
      if (context.isCurrent())
        view[label] = {
          result,
          binding: context.binding,
          scope: context.scope,
        };
    } catch (error) {
      if (context.isCurrent()) view[label] = { error: error.message };
      throw error;
    }
  };
  const answer = (index, kind = "metric", mutate = (value) => value) => {
    assert.ok(calls[index], `real API request ${index} exists`);
    const response = structuredClone(
      kind === "metric"
        ? metric
        : kind === "legacy"
          ? legacy
          : metric.configuration,
    );
    response.request_id = calls[index].headers["X-Request-Id"];
    if (kind !== "configuration")
      response.device_id = /\/devices\/([^/]+)/.exec(calls[index].path)[1];
    calls[index].resolve(mutate(response));
  };
  return {
    owner,
    reader,
    calls,
    channels,
    view,
    subscribe,
    answer,
    emit: (value) => channels.at(-1).onHint(value),
  };
}

// Regression: moving in-flight ownership to the registering token lets B overlap A.
{
  const f = fixture();
  f.owner.start();
  const cancelA = f.owner.registerDeviceUpdateReader(
    "monitoring",
    ["do", "feed"],
    binding("home-A"),
    f.reader("metric", "A"),
  );
  await advance();
  assert.equal(f.calls.length, 1, "registration starts one real initial read");
  assert.equal(f.calls[0].path, `/devices/${device}/monitoring/metrics`);
  assert.equal(f.calls[0].headers["X-Contract-Version"], "2.8.0");
  f.owner.registerDeviceUpdateReader(
    "monitoring",
    ["do", "feed"],
    binding("schedule-B", "week"),
    f.reader("metric", "B"),
  );
  cancelA();
  cancelA();
  f.emit(hint(["do", "feed"], { do: 10, feed: 11 }));
  await advance(250);
  assert.equal(
    f.calls.length,
    1,
    "replacement shares slot budget while A is pending",
  );
  f.answer(0);
  await advance(250);
  assert.equal(
    f.view.A,
    undefined,
    "old success never applies after replacement",
  );
  assert.equal(
    f.calls.length,
    2,
    "exactly one latest-binding follow-up survives old cleanup",
  );
  f.answer(1);
  await advance(1000);
  assert.equal(f.view.B.result.resources.do.latest.observation.do_mg_l, 5.8);
  assert.equal(
    f.view.B.result.resources.feed.latest.observation.feed_remaining_g,
    18000,
  );
  assert.deepEqual(f.view.B.binding, binding("schedule-B", "week"));
  assert.equal(f.calls.length, 2);
  f.owner.stop();
}
console.log(
  "PASS real reader replacement: slot budget, token cleanup, old success suppression, newest binding",
);

// Subscribe before first read; subscribe-time and in-flight hints cannot disappear.
{
  const f = fixture({
    onSubscribe: (channel) =>
      channel.onHint(hint(["do", "feed"], { do: 1, feed: 1 })),
  });
  f.owner.registerDeviceUpdateReader(
    "monitoring",
    ["do", "feed"],
    binding("home"),
    f.reader("metric", "metric"),
  );
  f.owner.start();
  await advance();
  assert.equal(f.calls.length, 1);
  for (let revision = 2; revision <= 101; revision++)
    f.emit(hint(["do", "feed"], { do: revision, feed: revision }));
  await advance(250);
  assert.equal(f.calls.length, 1);
  f.answer(0);
  await advance(250);
  assert.equal(
    f.calls.length,
    2,
    "100 in-flight hints yield one combined do/feed follow-up",
  );
  f.answer(1);
  await advance(250);
  f.emit(hint(["do", "feed"], { do: 101, feed: 101 }));
  f.emit(hint(["do", "feed"], { do: 100, feed: 1 }));
  f.emit(hint(["do"], { do: 999 }, otherDevice));
  f.emit({ ...hint(), extra: "rejected" });
  await advance(1000);
  assert.equal(
    f.calls.length,
    2,
    "duplicate/lower/rejected hints perform zero reads",
  );
  f.emit(hint(["do", "feed"], { do: 100, feed: 102 }));
  await advance(249);
  assert.equal(f.calls.length, 2);
  await advance(1);
  assert.equal(
    f.calls.length,
    3,
    "mixed lower/new revision triggers at bounded first-burst deadline",
  );
  f.answer(2);
  await advance();
  f.emit(hint(["contact"], { contact: 10 }));
  f.emit(hint(["history"], { history: 10 }));
  await advance(1000);
  assert.equal(
    f.calls.length,
    3,
    "contact/sensor history do not fan out into metrics",
  );
  assert.equal(f.view.metric.result.resources.do.quality, "valid");
  f.owner.stop();
}
{
  const f = fixture();
  f.owner.start();
  f.owner.registerDeviceUpdateReader(
    "monitoring",
    ["do", "feed"],
    binding("legacy"),
    f.reader("legacy", "legacy"),
  );
  await advance();
  assert.equal(f.calls[0].path, `/devices/${device}/monitoring`);
  f.answer(0, "legacy");
  await advance();
  assert.equal(f.view.legacy.result.device_id, device);
  f.emit(hint(["do", "feed"], { do: 1, feed: 1 }));
  for (let i = 2; i <= 100; i++) {
    await advance(2);
    f.emit(hint(["do", "feed"], { do: i, feed: i }));
  }
  await advance(51);
  assert.equal(f.calls.length, 1);
  await advance(1);
  assert.equal(
    f.calls.length,
    2,
    "continuous legacy burst cannot indefinitely postpone 250ms first deadline",
  );
  f.answer(1, "legacy");
  await advance();
  f.owner.stop();
}
console.log(
  "PASS subscribe/initial race, 100-hint budget, max-250ms coalescing, shared real metric+legacy requests, targeted interests",
);

// Retired errors cannot replace the new view; current parser failures stay dirty, not a hot loop.
{
  const f = fixture();
  f.owner.start();
  const cancel = f.owner.registerDeviceUpdateReader(
    "monitoring",
    ["do"],
    binding("old"),
    f.reader("metric", "old"),
  );
  await advance();
  f.owner.registerDeviceUpdateReader(
    "monitoring",
    ["do"],
    binding("new"),
    f.reader("metric", "new"),
  );
  cancel();
  f.calls[0].reject(new Error("retired request error"));
  await advance(250);
  assert.equal(f.view.old, undefined);
  assert.equal(f.calls.length, 2);
  f.answer(1, "metric", (value) => ({ ...value, resources: {} }));
  await advance(600_000);
  assert.match(f.view.new.error, /invalid independent monitoring/);
  assert.equal(
    f.calls.length,
    2,
    "failed parse stays dirty without an autonomous retry loop",
  );
  f.channels[0].onConnection("degraded");
  await advance(1000);
  assert.equal(f.calls.length, 2);
  f.channels[0].onConnection("joined");
  await advance(250);
  assert.equal(
    f.calls.length,
    3,
    "rejoin forces dirty read even with equal/no hints",
  );
  f.answer(2);
  await advance();
  assert.equal(f.view.new.result.resources.do.latest.observation.do_mg_l, 5.8);
  f.owner.stop();
}
console.log(
  "PASS retired error suppression; real parser rejection retains dirty; no hot loop; forced rejoin read",
);

// Completing a snapshot with embedded configuration/contact must not acknowledge their own reads.
{
  const f = fixture();
  f.owner.start();
  f.owner.registerDeviceUpdateReader(
    "monitoring",
    ["do", "feed"],
    binding("monitor"),
    f.reader("metric", "monitor"),
  );
  f.owner.registerDeviceUpdateReader(
    "configuration",
    ["configuration"],
    binding("settings"),
    f.reader("configuration", "configuration"),
  );
  const contacts = [];
  f.owner.registerDeviceUpdateReader(
    "contact",
    ["contact"],
    binding("access"),
    (context) =>
      new Promise((resolve) =>
        contacts.push(() => {
          if (context.isCurrent())
            f.view.contact = "own guarded contact result";
          resolve();
        }),
      ),
  );
  await advance();
  assert.equal(f.calls.length, 2);
  assert.equal(contacts.length, 1);
  f.emit(hint(["configuration", "contact"], { configuration: 2, contact: 2 }));
  f.answer(0, "metric", (value) => ({
    ...value,
    revisions: { ...value.revisions, configuration: 999, contact: 999 },
  }));
  await advance(250);
  assert.equal(
    f.view.monitor.result.configuration.current_state.desired_revision,
    3,
  );
  assert.equal(f.view.configuration, undefined);
  assert.equal(f.view.contact, undefined);
  f.answer(1, "configuration");
  contacts[0]();
  await advance(250);
  assert.equal(
    f.calls.length,
    3,
    "embedded config did not consume independently dirty configuration generation",
  );
  assert.equal(
    contacts.length,
    2,
    "embedded contact did not consume independently dirty contact generation",
  );
  assert.equal(f.calls[2].path, `/devices/${device}/configuration`);
  f.answer(2, "configuration");
  contacts[1]();
  await advance();
  assert.equal(f.view.configuration.result.current_state.desired_revision, 3);
  f.owner.stop();
}
console.log(
  "PASS embedded monitoring config/contact never cross-ack independent owner generations (contact reader boundary only; real contact deferred)",
);

// Immutable binding replacement covers graph windows, history filters and detail/command identities.
for (const [key, resource, before, after] of [
  ["graph", "history", "day", "week"],
  ["history", "feeding", "all", "failed"],
  ["detail", "feeding", "run-A", "run-B"],
  ["command", "feeding", "command-A", "command-B"],
]) {
  const f = fixture();
  f.owner.start();
  f.owner.registerDeviceUpdateReader(
    key,
    [resource],
    binding("focus-A", before),
    f.reader("metric", "old"),
  );
  await advance();
  const changed = binding("focus-B", after);
  const cancel = f.owner.registerDeviceUpdateReader(
    key,
    [resource],
    changed,
    f.reader("metric", "new"),
  );
  changed.focus = "mutated";
  changed.query = "mutated";
  f.answer(0);
  await advance(250);
  assert.equal(f.view.old, undefined);
  f.answer(1);
  await advance();
  assert.deepEqual(f.view.new.binding, binding("focus-B", after));
  cancel();
  f.emit(hint([resource], { [resource]: 99 }));
  await advance(1000);
  assert.equal(
    f.calls.length,
    2,
    "blur unregisters and suppresses eager reads",
  );
  f.owner.stop();
}
console.log(
  "PASS immutable focus/query/window/filter/detail/command binding replacement (real snapshot loader; screen integration deferred)",
);

function host() {
  const hooks = [];
  let index = 0,
    pending = [],
    output;
  const same = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]));
  const runtime = {
    useMemo(create, deps) {
      const at = index++;
      if (!same(hooks[at]?.deps, deps)) hooks[at] = { deps, value: create() };
      return hooks[at].value;
    },
    useEffect(create, deps) {
      const at = index++;
      if (!same(hooks[at]?.deps, deps)) {
        const old = hooks[at];
        hooks[at] = { deps, create };
        pending.push(() => {
          old?.cleanup?.();
          hooks[at].cleanup = create();
        });
      }
    },
  };
  return {
    render(props) {
      index = 0;
      rendering = runtime;
      output = updates.DeviceUpdatesProvider(props);
      output.type.context.current = output.props.value;
      while (pending.length) pending.shift()();
      assert.equal(updates.useDeviceUpdates(), output.props.value);
      return output.props.value;
    },
    replayEffects() {
      for (const hook of hooks)
        if (hook.create) {
          hook.cleanup?.();
          hook.cleanup = hook.create();
        }
    },
    unmount() {
      for (const hook of hooks) hook.cleanup?.();
    },
  };
}
// Run actual provider hooks through a stateful effect host, not no-op hook replacements.
{
  const f = fixture(),
    h = host();
  let props = {
    scope: { ...scope },
    active: true,
    subscribe: f.subscribe,
    children: null,
  };
  let registration = h.render(props);
  const cancel = registration.registerDeviceUpdateReader(
    "monitoring",
    ["do"],
    binding("strict-A"),
    f.reader("metric", "A"),
  );
  await advance();
  assert.equal(f.calls.length, 1);
  h.replayEffects();
  cancel();
  registration.registerDeviceUpdateReader(
    "monitoring",
    ["do"],
    binding("strict-B"),
    f.reader("metric", "B"),
  );
  await advance(250);
  assert.equal(
    f.calls.length,
    1,
    "StrictMode cleanup/setup cannot free pending slot",
  );
  assert.ok(f.channels[0].removed);
  assert.equal(f.channels.length, 2);
  f.channels[0].onHint(hint(["do"], { do: 999 }));
  f.answer(0);
  await advance(250);
  assert.equal(f.calls.length, 2);
  assert.equal(f.view.A, undefined);
  f.answer(1);
  await advance();
  assert.ok(f.view.B.result);
  for (const nextScope of [
    { ...scope, installationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    {
      installationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      deviceId: otherDevice,
      scopeRevision: 1,
    },
    {
      installationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      deviceId: otherDevice,
      scopeRevision: 2,
    },
  ]) {
    f.emit(hint(["do"], { do: 1000 }, f.channels.at(-1).id));
    await advance(250);
    const oldIndex = f.calls.length - 1,
      oldChannel = f.channels.at(-1);
    props = { ...props, scope: nextScope };
    registration = h.render(props);
    registration.registerDeviceUpdateReader(
      "monitoring",
      ["do"],
      binding("new-scope"),
      f.reader("metric", "scope"),
    );
    await advance();
    const newIndex = f.calls.length - 1;
    assert.ok(oldChannel.removed);
    assert.equal(f.calls[newIndex].installation, nextScope.installationId);
    assert.equal(
      f.calls[newIndex].path,
      `/devices/${nextScope.deviceId}/monitoring/metrics`,
    );
    f.answer(newIndex);
    await advance();
    const accepted = f.view.scope;
    assert.notEqual(
      oldIndex,
      newIndex,
      "new scope starts an independent read while old one is pending",
    );
    if (nextScope.scopeRevision === 2 || nextScope.deviceId === device)
      f.answer(oldIndex);
    else f.calls[oldIndex].reject(new Error("late old-scope denial"));
    oldChannel.onConnection("joined");
    oldChannel.onHint(hint(["do"], { do: 9999 }));
    await advance(1000);
    assert.equal(
      f.view.scope,
      accepted,
      "old scope success/error/hint cannot overwrite current scope",
    );
  }
  const count = f.calls.length;
  props = { ...props, active: false };
  assert.equal(h.render(props), null);
  assert.ok(f.channels.at(-1).removed);
  assert.equal(tasks.size, 0);
  await advance(600_000);
  assert.equal(
    f.calls.length,
    count,
    "inactive provider has no timers or eager reads",
  );
  props = { ...props, active: true };
  registration = h.render(props);
  registration.registerDeviceUpdateReader(
    "monitoring",
    ["do"],
    binding("resume"),
    f.reader("metric", "resume"),
  );
  await advance();
  assert.equal(f.calls.length, count + 1);
  f.answer(count);
  await advance();
  assert.ok(f.view.resume.result);
  h.unmount();
  assert.equal(tasks.size, 0);
  assert.ok(f.channels.at(-1).removed);
}
assert.equal(tasks.size, 0);
console.log(
  "PASS actual unwired provider: StrictMode-like replay, installation/device/scope replacement, old callback retirement, inactive/resume/unmount",
);

// Parent effect replay can retire a run before child registrations are replaced.
{
  const f = fixture(),
    h = host();
  const registration = h.render({
    scope,
    active: true,
    subscribe: f.subscribe,
    children: null,
  });
  registration.registerDeviceUpdateReader(
    "monitoring",
    ["do"],
    binding("retained"),
    f.reader("metric", "retained"),
  );
  await advance();
  h.replayEffects();
  f.answer(0);
  await advance(250);
  assert.equal(
    f.view.retained,
    undefined,
    "retired epoch cannot apply even if token was retained",
  );
  assert.equal(
    f.calls.length,
    2,
    "restart retains slot budget then forces exactly one fresh read",
  );
  f.answer(1);
  await advance(1000);
  assert.equal(
    f.calls.length,
    2,
    "retired flight capture cannot force a third read",
  );
  assert.equal(
    f.view.retained.result.resources.do.latest.observation.do_mg_l,
    5.8,
  );
  h.unmount();
}
console.log(
  "PASS retained-token effect restart discards old capture without extra read",
);

// Exact subset rules must hold for EVERY resource, not just do/feed fixtures.
const schemaCases = [];
for (let mask = 1; mask < 128; mask++) {
  const resources = state.DEVICE_RESOURCES.filter(
    (_, index) => mask & (1 << index),
  );
  const revisions = Object.fromEntries(
    resources.map((resource) => [resource, 0]),
  );
  schemaCases.push([hint(resources, revisions), true]);
  for (const resource of resources) {
    const missing = { ...revisions };
    delete missing[resource];
    schemaCases.push([hint(resources, missing), false]);
  }
  for (const resource of state.DEVICE_RESOURCES.filter(
    (resource) => !resources.includes(resource),
  ))
    schemaCases.push([hint(resources, { ...revisions, [resource]: 0 }), false]);
}
for (const [value, valid] of schemaCases)
  assert.equal(state.parseDeviceUpdateHint(value, device) !== null, valid);
const schemaPath = fileURLToPath(
  new URL(
    "../../contracts/schemas/app-device-updates.v1.schema.json",
    import.meta.url,
  ),
);
const pythonResult = execFileSync(
  "python",
  [
    "-c",
    `import json,sys
from jsonschema import Draft202012Validator
schema=json.load(open(sys.argv[1], encoding='utf-8'))
Draft202012Validator.check_schema(schema)
validator=Draft202012Validator(schema)
cases=json.load(sys.stdin)
for value,want in cases:
    assert validator.is_valid(value) == want, value
print('PASS', len(cases), 'all-subset/missing/extra revision cases through actual JSON Schema')`,
    schemaPath,
  ],
  { input: JSON.stringify(schemaCases), encoding: "utf8" },
);
console.log(pythonResult.trim());

const nodeValidator = readFileSync(
  new URL("../../contracts/scripts/validate.ts", import.meta.url),
  "utf8",
);
assert.equal(
  sha(nodeValidator.split("\n// Separate app hint transport;")[0]),
  "6e4eca2b6a4e6ac818421807965b3aadc624ef62db5ecbfa38c4257797dac748",
  "old Node validator bytes/loops remain exactly intact",
);
const pythonValidator = readFileSync(
  new URL("../../contracts/scripts/validate.py", import.meta.url),
  "utf8",
);
const withoutSection = pythonValidator
  .replace(
    /def check_app_device_updates\(\) -> None:[\s\S]*?(?=def main\(\) -> int:)/,
    "",
  )
  .replace("    check_app_device_updates()\n", "");
assert.equal(
  sha(withoutSection),
  "ae4ca34015831732f6a4f2c8131b4f34fa3daa117d446f68cc1fc37f4869cb0f",
  "old Python validator bytes/loops remain exactly intact",
);
console.log(
  "PASS existing validator byte preservation outside separate named hint sections",
);

// Focused semantic check only: current React hook signatures below are a test host,
// not the missing canonical Expo/React dependency tree or a substitute full app typecheck.
const virtual = fileURLToPath(
  new URL("../t08-react-contract.d.ts", import.meta.url),
).replaceAll("\\", "/");
const reactContract = `declare module "react" {
  export type ReactNode = unknown;
  export type Context<T> = { Provider: (props: { value: T; children?: ReactNode }) => ReactNode };
  export function createContext<T>(value: T): Context<T>;
  export function useContext<T>(context: Context<T>): T;
  export function createElement<P>(component: (props: P) => ReactNode, props: P, ...children: ReactNode[]): ReactNode;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useEffect(effect: () => void | (() => void), deps: readonly unknown[]): void;
}`;
const compilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  types: [],
};
const compilerHost = ts.createCompilerHost(compilerOptions);
const originalSource = compilerHost.getSourceFile.bind(compilerHost);
compilerHost.getSourceFile = (path, version, ...args) =>
  path.replaceAll("\\", "/") === virtual
    ? ts.createSourceFile(path, reactContract, version)
    : originalSource(path, version, ...args);
const program = ts.createProgram(
  [
    fileURLToPath(
      new URL("../src/lib/device-update-state.ts", import.meta.url),
    ),
    fileURLToPath(new URL("../src/lib/device-updates.tsx", import.meta.url)),
    virtual,
  ],
  compilerOptions,
  compilerHost,
);
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(
  diagnostics.length,
  0,
  ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  }),
);
console.log(
  `PASS focused strict semantic check TypeScript ${ts.version}; React hook ambient test-host contract, NOT canonical app typecheck`,
);
