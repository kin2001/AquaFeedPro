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
    if (s === "react-native" && c.parentURL?.endsWith("/device-updates.tsx"))
      return { url: "offline:updates-native", shortCircuit: true };
    if (c.parentURL?.endsWith("/device-changes.ts")) {
      if (s === "@/lib/supabase")
        return { url: "offline:updates-supabase", shortCircuit: true };
      if (s === "react-native")
        return { url: "offline:updates-native", shortCircuit: true };
    }
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
    if (url === "offline:updates-supabase")
      return {
        format: "module",
        shortCircuit: true,
        source:
          "export const supabase={channel:(...args)=>globalThis.__updatesSupabase.channel(...args),removeChannel:(...args)=>globalThis.__updatesSupabase.removeChannel(...args)};",
      };
    if (url === "offline:updates-native")
      return {
        format: "module",
        shortCircuit: true,
        source:
          "export const AppState={get currentState(){return globalThis.__updatesNative.currentState},addEventListener:(...args)=>globalThis.__updatesNative.addEventListener(...args)};",
      };
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

const changes = await import("../src/lib/device-changes.ts");
const changesSource = readFileSync(
  new URL("../src/lib/device-changes.ts", import.meta.url),
  "utf8",
);
assert.equal(
  sha(
    changesSource
      .slice(changesSource.indexOf("/** Refetch hints"))
      .split("\nconst leavingDeviceChannels")[0],
  ),
  "b70e078054e759a212127d46b1d888b469627d3865f0c09741e0e22079ce1deb",
  "legacy helper implementation remains byte-identical",
);
assert.equal(
  typeof changes.subscribeDeviceUpdates,
  "function",
  "actual module exports the unwired native transport",
);
const nativeId = (number = 1) =>
  `aaaaaaaa-aaaa-4aaa-8aaa-${String(number).padStart(12, "0")}`;
const nativeFrame = (domain = hint(), id = nativeId()) => ({
  type: "broadcast",
  event: "resource_update",
  payload: { ...domain, id },
});
function nativeFixture() {
  const channels = [],
    removals = [],
    listeners = new Set();
  let appStateReads = 0,
    appState = "active";
  globalThis.__updatesNative = {
    get currentState() {
      appStateReads++;
      return appState;
    },
    addEventListener(event, callback) {
      assert.equal(event, "change");
      listeners.add(callback);
      return { remove: () => listeners.delete(callback) };
    },
  };
  globalThis.__updatesSupabase = {
    channel(topic, options) {
      const channel = {
        topic,
        options,
        bindings: [],
        subscriptions: 0,
        on(type, filter, callback) {
          this.bindings.push({ type, filter, callback });
          return this;
        },
        subscribe(callback) {
          this.subscriptions++;
          this.status = callback;
          return this;
        },
        emit(value) {
          for (const binding of this.bindings) binding.callback(value);
        },
      };
      channels.push(channel);
      return channel;
    },
    removeChannel(channel) {
      removals.push(channel);
      // Real removal may synchronously report CLOSED; active must retire first.
      channel.status("CLOSED");
      channel.emit(nativeFrame(hint(["do"], { do: 9999 })));
      return Promise.resolve("ok");
    },
  };
  return {
    channels,
    removals,
    listeners,
    appStateReads: () => appStateReads,
    setAppState(value) {
      appState = value;
      for (const callback of listeners) callback(value);
    },
  };
}

// Drive the actual adapter. A native ID is not permission to project arbitrary extra keys.
{
  const f = nativeFixture(),
    received = [],
    statuses = [];
  const timerNames = [
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
  ];
  const savedTimers = timerNames.map((name) => globalThis[name]);
  for (const name of timerNames)
    globalThis[name] = () => assert.fail(`native adapter must not use ${name}`);
  try {
    const stop = changes.subscribeDeviceUpdates(
      "diagnostic-name-only",
      device,
      (value) => received.push(value),
      (value) => statuses.push(value),
    );
    assert.equal(f.channels.length, 1, "one native channel per invocation");
    const channel = f.channels[0];
    assert.equal(channel.topic, `device:${device}:updates`);
    assert.deepEqual(channel.options, { config: { private: true } });
    assert.equal(channel.subscriptions, 1);
    assert.equal(channel.bindings.length, 1);
    assert.equal(channel.bindings[0].type, "broadcast");
    assert.deepEqual(channel.bindings[0].filter, { event: "resource_update" });
    assert.deepEqual(statuses, [], "construction is not a successful join");
    for (const status of [
      "SUBSCRIBED",
      "CHANNEL_ERROR",
      "TIMED_OUT",
      "CLOSED",
      "JOINING",
      "SUBSCRIBED",
    ])
      channel.status(status);
    assert.deepEqual(statuses, [
      "joined",
      "degraded",
      "degraded",
      "degraded",
      "joined",
    ]);
    assert.equal(
      f.channels.length,
      1,
      "status failures do not create retries/channels",
    );
    assert.equal(
      f.removals.length,
      0,
      "future owner, not adapter, decides failed-channel replacement",
    );

    for (const fixture of manifest.fixtures) {
      const domain = JSON.parse(
        readFileSync(new URL(fixture.file, hintDir), "utf8"),
      );
      const frame = nativeFrame(domain);
      const before = received.length;
      channel.emit(frame);
      assert.equal(
        received.length - before,
        fixture.expect === "valid" ? 1 : 0,
        `actual native transport fixture ${fixture.file}`,
      );
      if (fixture.expect === "valid") {
        assert.deepEqual(received.at(-1), domain);
        assert.equal(Object.hasOwn(received.at(-1), "id"), false);
        assert.equal(
          state.parseDeviceUpdateHint(frame.payload, device),
          null,
          "native four-key payload remains invalid for closed domain parser",
        );
      }
    }
    for (const [version, variant] of [
      ["1", "8"],
      ["4", "9"],
      ["7", "a"],
      ["8", "b"],
    ]) {
      const before = received.length;
      channel.emit(
        nativeFrame(
          hint(),
          `aaaaaaaa-aaaa-${version}aaa-${variant}aaa-aaaaaaaaaaaa`,
        ),
      );
      assert.equal(
        received.length,
        before + 1,
        "canonical RFC native UUID versions/variants accepted",
      );
    }
    const accepted = received.length;
    const badIds = [
      undefined,
      null,
      false,
      1,
      {},
      [],
      "bad",
      nativeId().toUpperCase(),
      "aaaaaaaa-aaaa-0aaa-8aaa-aaaaaaaaaaaa",
      "aaaaaaaa-aaaa-9aaa-8aaa-aaaaaaaaaaaa",
      "aaaaaaaa-aaaa-4aaa-7aaa-aaaaaaaaaaaa",
      "aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa",
      ` ${nativeId()}`,
      `${nativeId()} `,
      `${nativeId()}\n`,
      `${nativeId()}\r\n`,
      `${nativeId()}\u2028`,
      `${nativeId()}\u2029`,
    ];
    for (const id of badIds)
      channel.emit({
        type: "broadcast",
        event: "resource_update",
        payload: { ...hint(), id },
      });
    for (const frame of [
      null,
      [],
      "broadcast",
      {},
      { ...nativeFrame(), type: "postgres_changes" },
      { ...nativeFrame(), event: "other" },
      { ...nativeFrame(), payload: null },
      { ...nativeFrame(), payload: [] },
      { ...nativeFrame(), payload: "{}" },
      { ...nativeFrame(), payload: false },
      { ...nativeFrame(), payload: 1 },
      { ...nativeFrame(), payload: { ...nativeFrame().payload, extra: true } },
      { ...nativeFrame(), payload: hint(), meta: { id: nativeId() } },
      nativeFrame(hint(["do"], { do: 1 }, otherDevice)),
      nativeFrame(hint(["do"], { do: NaN })),
      nativeFrame(hint(["do"], { do: Infinity })),
    ])
      channel.emit(frame);
    assert.equal(
      received.length,
      accepted,
      "malformed envelope/id/domain/scope cannot reach owner",
    );
    for (const key of ["id", "device_id", "resources", "revisions"]) {
      const frame = nativeFrame();
      delete frame.payload[key];
      channel.emit(frame);
      const inherited = Object.create({ [key]: nativeFrame().payload[key] });
      for (const other of ["id", "device_id", "resources", "revisions"].filter(
        (item) => item !== key,
      ))
        inherited[other] = nativeFrame().payload[other];
      inherited.unexpected = true; // Four own keys cannot substitute for the four required own keys.
      channel.emit({ ...nativeFrame(), payload: inherited });
    }
    assert.equal(
      received.length,
      accepted,
      "all four native keys must be own properties",
    );
    channel.emit({
      ...nativeFrame(),
      meta: { id: "not-authority", replayed: true },
      sdk_extension: true,
    });
    assert.equal(
      received.length,
      accepted + 1,
      "optional SDK outer metadata never becomes domain data",
    );
    assert.equal(f.appStateReads(), 0);
    assert.equal(f.listeners.size, 0);
    const counts = [received.length, statuses.length];
    stop();
    stop();
    assert.deepEqual(
      f.removals,
      [channel],
      "cleanup removes exact channel once",
    );
    channel.emit(nativeFrame());
    for (const status of ["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"])
      channel.status(status);
    assert.deepEqual(
      [received.length, statuses.length],
      counts,
      "intentional removal and all late callbacks are silent",
    );
    const nextHints = [],
      nextStatuses = [];
    const stopNext = changes.subscribeDeviceUpdates(
      "different-diagnostic",
      device,
      (value) => nextHints.push(value),
      (value) => nextStatuses.push(value),
    );
    assert.equal(
      f.channels.length,
      1,
      "the SDK's old topic must finish leaving",
    );
    for (let i = 0; i < 4; i++) await Promise.resolve();
    const next = f.channels[1];
    assert.equal(
      next.topic,
      channel.topic,
      "diagnostic name cannot alter canonical topic",
    );
    stop();
    channel.emit(nativeFrame());
    channel.status("SUBSCRIBED");
    next.status("SUBSCRIBED");
    next.emit(nativeFrame());
    assert.deepEqual(nextStatuses, ["joined"]);
    assert.deepEqual(nextHints, [hint()]);
    assert.deepEqual(
      f.removals,
      [channel],
      "old cleanup cannot remove replacement channel",
    );
    stopNext();
    stopNext();
    assert.deepEqual(f.removals, [channel, next]);
  } finally {
    for (let index = 0; index < timerNames.length; index++)
      globalThis[timerNames[index]] = savedTimers[index];
  }
}
console.log(
  "PASS actual native adapter: exact envelope + all22 domain fixtures, UUID/scope/SDK metadata boundaries, statuses, no timers/AppState/retry, exact once-only cleanup and retired callbacks",
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
  const owner = updates.createDeviceUpdates(
    options.scope ?? scope,
    subscribe,
    options.recovery,
  );
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

// Recovery compares authorized revisions, and retry never acknowledges deferred reads.
{
  const native = nativeFixture();
  let revision = 0,
    contactRevision = 0,
    snapshots = 0,
    monitor = 0,
    contacts = 0,
    canRead = false;
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  const f = fixture({
    recovery: {
      readRevisions: async () => {
        snapshots++;
        return {
          do: revision,
          feed: 0,
          history: 0,
          configuration: 0,
          feeding: 0,
          contact: contactRevision,
          alerts: 0,
        };
      },
    },
  });
  try {
    f.owner.registerDeviceUpdateReader(
      "monitoring",
      ["do", "feed"],
      binding("home"),
      async () => {
        monitor++;
        return canRead ? undefined : "deferred";
      },
    );
    f.owner.registerDeviceUpdateReader(
      "contact",
      ["contact"],
      binding("contact"),
      async () => {
        contacts++;
      },
    );
    f.owner.start();
    f.channels[0].onConnection("joined");
    await advance();
    assert.deepEqual([snapshots, monitor, contacts], [1, 1, 1]);
    canRead = true;
    await advance(29_999);
    assert.equal(monitor, 1, "deferred does not immediately spin");
    await advance(1);
    assert.equal(monitor, 2, "deferred stays dirty until bounded retry");
    assert.equal(contacts, 1, "failure retry does not refetch a clean owner");
    const afterRetry = snapshots;
    revision++;
    await advance(300_000);
    assert.ok(
      snapshots > afterRetry,
      "healthy recovery checks durable revisions",
    );
    assert.equal(monitor, 3, "missed hint is recovered from durable revision");
    assert.equal(contacts, 1, "healthy recovery compares resource revisions");
    f.emit(hint(["contact"], { contact: ++contactRevision }));
    await advance(250);
    assert.deepEqual(
      [monitor, contacts],
      [3, 2],
      "heartbeat only wakes contact",
    );
    f.channels[0].onConnection("degraded");
    assert.equal(
      f.channels[0].removed,
      true,
      "failed channel is removed before retry",
    );
    await advance(999);
    assert.equal(f.channels.length, 1, "first retry waits one second");
    await advance(1);
    assert.equal(f.channels.length, 2, "one replacement channel starts");
    native.setAppState("background");
    const beforeBackground = [snapshots, monitor, contacts];
    await advance(900_000);
    assert.deepEqual([snapshots, monitor, contacts], beforeBackground);
    assert.equal(f.channels[1].removed, true, "background removes the channel");
    assert.equal(tasks.size, 0);
    native.setAppState("active");
    f.channels[2].onConnection("joined");
    await advance();
    assert.deepEqual(
      [snapshots, monitor, contacts],
      [beforeBackground[0] + 1, 4, 3],
      "foreground revalidates membership and forces current readers",
    );
  } finally {
    f.owner.stop();
    Math.random = originalRandom;
  }
}
console.log(
  "PASS authorized recovery, deferred retry, resource budgets and foreground scope",
);

{
  nativeFixture();
  const originalRandom = Math.random;
  Math.random = () => 0;
  const opened = time;
  const snapshots = [];
  const connections = [];
  const f = fixture({
    onSubscribe(channel) {
      connections.push(time - opened);
      channel.onConnection("degraded");
    },
    recovery: {
      readRevisions: async () => {
        snapshots.push(time - opened);
        throw new Error("offline");
      },
    },
  });
  try {
    f.owner.start();
    await advance(460_000);
    assert.deepEqual(snapshots, [0, 27_000, 81_000, 189_000, 459_000]);
    assert.deepEqual(
      connections.slice(0, 8),
      [0, 900, 2700, 6300, 13_500, 27_900, 54_900, 81_900],
    );
    assert.ok(f.channels.every((channel) => channel.removed));
  } finally {
    f.owner.stop();
    Math.random = originalRandom;
  }
}

{
  const native = nativeFixture();
  let settleMembership,
    settleReader,
    readerCurrent,
    stored = false;
  const f = fixture({
    recovery: {
      readRevisions: () =>
        new Promise((resolve) => {
          settleMembership = resolve;
        }),
    },
  });
  f.owner.registerDeviceUpdateReader(
    "monitoring",
    ["do"],
    binding("home"),
    async ({ isCurrent }) => {
      readerCurrent = isCurrent;
      await new Promise((resolve) => {
        settleReader = resolve;
      });
      if (isCurrent()) stored = true;
    },
  );
  f.owner.start();
  await advance();
  assert.ok(readerCurrent());
  settleMembership("denied");
  await drain();
  assert.equal(readerCurrent(), false);
  assert.equal(f.channels[0].removed, true);
  settleReader();
  await drain();
  native.setAppState("background");
  native.setAppState("active");
  await advance(300_000);
  assert.equal(
    f.channels.length,
    1,
    "revoked scope does not rejoin on foreground",
  );
  assert.equal(stored, false, "pending read cannot restore revoked view");
  assert.equal(tasks.size, 0);
  f.owner.stop();
}
console.log(
  "PASS capped jittered fallback, reconnect and revoked scope retirement",
);

// The unchanged legacy helper still joins/refetches, polls only failed foreground channels,
// resumes, and cleans its own timer/listener/channel; the new adapter does not replace it.
{
  const f = nativeFixture(),
    intervals = new Map();
  const savedSetInterval = globalThis.setInterval,
    savedClearInterval = globalThis.clearInterval;
  let intervalId = 0,
    reads = 0;
  globalThis.setInterval = (run, delay) => {
    assert.equal(delay, 15_000);
    const id = ++intervalId;
    intervals.set(id, run);
    return id;
  };
  globalThis.clearInterval = (id) => intervals.delete(id);
  try {
    const stop = changes.subscribeDeviceChanges(
      "legacy-settings",
      device,
      ["devices"],
      () => reads++,
    );
    const channel = f.channels[0],
      poll = [...intervals.values()][0];
    assert.equal(channel.topic, `legacy-settings-${device}`);
    assert.equal(channel.options, undefined);
    assert.equal(channel.bindings[0].type, "postgres_changes");
    assert.deepEqual(channel.bindings[0].filter, {
      event: "*",
      schema: "public",
      table: "devices",
      filter: "device_id=eq." + device,
    });
    assert.equal(intervals.size, 1);
    assert.equal(f.listeners.size, 1);
    channel.status("SUBSCRIBED");
    channel.emit({});
    await advance(249);
    assert.equal(reads, 0);
    await advance(1);
    assert.equal(reads, 1);
    poll();
    await advance(1000);
    assert.equal(reads, 1, "healthy legacy channel does not fallback poll");
    channel.status("CHANNEL_ERROR");
    poll();
    await advance(250);
    assert.equal(reads, 2, "failed legacy channel retains foreground fallback");
    f.setAppState("background");
    channel.emit({});
    poll();
    await advance(1000);
    assert.equal(reads, 2);
    f.setAppState("active");
    await advance(250);
    assert.equal(reads, 3, "legacy resume still refetches");
    stop();
    channel.emit({});
    channel.status("SUBSCRIBED");
    poll();
    await advance(1000);
    assert.equal(reads, 3);
    assert.equal(intervals.size, 0);
    assert.equal(f.listeners.size, 0);
    assert.deepEqual(f.removals, [channel]);
    assert.equal(tasks.size, 0);
  } finally {
    globalThis.setInterval = savedSetInterval;
    globalThis.clearInterval = savedClearInterval;
  }
}
console.log(
  "PASS actual unchanged legacy helper: join coalescing, healthy/failed foreground poll, background/resume, cleanup",
);

// Exercise the actual native adapter -> unchanged A coordinator -> real protected reader/parser.
{
  const native = nativeFixture(),
    f = fixture();
  const owner = updates.createDeviceUpdates(
    scope,
    changes.subscribeDeviceUpdates,
  );
  owner.registerDeviceUpdateReader(
    "monitoring",
    ["do"],
    binding("native"),
    f.reader("metric", "native"),
  );
  owner.start();
  const first = native.channels[0];
  first.status("SUBSCRIBED");
  await advance();
  assert.equal(f.calls.length, 1);
  f.answer(0);
  await advance();
  first.emit(nativeFrame(hint(["do"], { do: 5 })));
  await advance(250);
  assert.equal(f.calls.length, 2);
  f.answer(1);
  await advance();
  for (let id = 2; id <= 101; id++)
    first.emit(nativeFrame(hint(["do"], { do: id % 2 ? 5 : 4 }), nativeId(id)));
  await advance(1000);
  assert.equal(
    f.calls.length,
    2,
    "100 changed native IDs with duplicate/lower revisions cause zero extra reads",
  );
  first.emit(nativeFrame(hint(["do"], { do: 6 }), nativeId()));
  await advance(250);
  assert.equal(
    f.calls.length,
    3,
    "reusing the original native ID cannot suppress a newer resource revision",
  );
  f.answer(2);
  await advance();
  owner.stop();
  owner.start();
  await drain();
  const current = native.channels[1];
  first.emit(nativeFrame(hint(["do"], { do: 999 })));
  first.status("SUBSCRIBED");
  await advance();
  assert.equal(
    f.calls.length,
    4,
    "only the forced current restart read survives retired SDK callbacks",
  );
  f.answer(3);
  await advance(1000);
  assert.equal(f.calls.length, 4);
  assert.equal(f.view.native.result.resources.do.quality, "valid");
  owner.stop();
  assert.deepEqual(native.removals, [first, current]);
  assert.equal(tasks.size, 0);
}
console.log(
  "PASS actual native adapter/A coordinator/real metric reader: changed native IDs never bypass revision dedup; restart drops old callbacks",
);

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
  await advance(1100);
  assert.equal(f.calls.length, 2);
  f.channels[0].onConnection("joined");
  await advance();
  assert.equal(f.calls.length, 2, "retired join cannot restart a dirty reader");
  f.channels[1].onConnection("joined");
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
  const firstChannel = f.channels[0];
  props = { ...props, scope: { ...props.scope } };
  assert.equal(
    h.render(props),
    registration,
    "equivalent primitive scope tuple retains the exact coordinator",
  );
  await advance(1000);
  assert.equal(f.channels.length, 1, "equivalent scope must not resubscribe");
  assert.equal(
    f.calls.length,
    1,
    "equivalent scope retains the pending flight",
  );
  assert.equal(firstChannel.removed, false);
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
}
declare module "react-native" {
  export const AppState: { currentState: string; addEventListener(event: string, callback: (state: string) => void): { remove(): void } };
}
declare module "@/lib/supabase" {
  type Channel = {
    on(event: "broadcast" | "postgres_changes", filter: Record<string, unknown>, callback: (value: unknown) => void): Channel;
    subscribe(callback: (status: "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED") => void): Channel;
  };
  export const supabase: { channel(topic: string, options?: { config: { private: true } }): Channel; removeChannel(channel: Channel): Promise<unknown> };
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
// Resolve only the tested relative source modules. The declared host above
// owns the framework types even in a checkout with its app dependencies installed.
compilerHost.resolveModuleNames = (names, containingFile) =>
  names.map((name) =>
    name.startsWith(".")
      ? ts.resolveModuleName(
          name,
          containingFile,
          compilerOptions,
          compilerHost,
        ).resolvedModule
      : undefined,
  );
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
    fileURLToPath(new URL("../src/lib/device-changes.ts", import.meta.url)),
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
  `PASS focused strict semantic check TypeScript ${ts.version}; React/RN/Supabase ambient test-host contracts including actual adapter, NOT canonical app/SDK typecheck`,
);
