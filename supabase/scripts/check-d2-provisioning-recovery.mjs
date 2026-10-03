import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ensureResumeCredentials } from "./provision-d2-devices.mjs";

const deviceIds = [
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
const tempParent = await realpath(os.tmpdir());
const privateDir = await mkdtemp(
  path.join(tempParent, "aquafeed-d2-recovery-"),
);

try {
  const partial = await ensureResumeCredentials(privateDir, [deviceIds[0]]);
  const firstCredential = partial[0].credential;
  assert.match(firstCredential, /^[A-Za-z0-9_-]{43}$/);

  const resumed = await ensureResumeCredentials(privateDir, deviceIds);
  const secondCredential = resumed[1].credential;
  assert.equal(resumed[0].credential, firstCredential);
  assert.match(resumed[1].credential, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(resumed[0].credential, resumed[1].credential);
  assert.equal(
    JSON.parse(
      await readFile(
        path.join(privateDir, `device-${deviceIds[0]}-credential.json`),
        "utf8",
      ),
    ).credential,
    firstCredential,
  );

  await writeFile(
    path.join(privateDir, `device-${deviceIds[0]}.provisioned.json`),
    JSON.stringify({ device_id: deviceIds[0], provisioned: true }),
    { mode: 0o600 },
  );
  const secondCredentialPath = path.join(
    privateDir,
    `device-${deviceIds[1]}-credential.json`,
  );
  await rm(secondCredentialPath);
  await assert.rejects(
    ensureResumeCredentials(privateDir, deviceIds),
    /refusing automatic rotation/,
  );

  await writeFile(
    secondCredentialPath,
    JSON.stringify({ device_id: deviceIds[1], credential: secondCredential }),
    { mode: 0o600 },
  );
  await rm(path.join(privateDir, `device-${deviceIds[0]}-credential.json`));
  await assert.rejects(
    ensureResumeCredentials(privateDir, deviceIds),
    /refusing automatic rotation/,
  );
} finally {
  const cleanupTarget = await realpath(privateDir);
  assert.equal(path.dirname(cleanupTarget), tempParent);
  assert.match(path.basename(cleanupTarget), /^aquafeed-d2-recovery-/);
  await rm(cleanupTarget, { recursive: true, force: true });
}

process.stdout.write("D2 provisioning recovery checks passed.\n");
