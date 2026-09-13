const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createWindowsDiagnostics,
  normalizeResult,
  SCRIPT,
} = require("../electron/mining/windowsDiagnostics");
test("Windows diagnostics are read-only, path scoped, cached and bounded", async () => {
  let calls = 0,
    invocation;
  const target = "C:\\Users\\Miner's PC\\xmrig.exe";
  const diagnose = createWindowsDiagnostics({
    platform: "win32",
    run: async (...args) => {
      calls++;
      invocation = args;
      return {
        stdout: JSON.stringify({
          status: "available",
          signatureStatus: "NotSigned",
          detections: [
            {
              resource: target.toUpperCase(),
              threatName: "Test:Miner",
              detectedAt: "2026-09-13T00:00:00Z",
              actionSuccess: true,
            },
            {
              resource: "C:\\unrelated.exe",
              threatName: "Unrelated private history",
            },
          ],
        }),
      };
    },
  });
  const [a, b] = await Promise.all([diagnose([target]), diagnose([target])]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.equal(a.detections.length, 1);
  assert.equal(a.signatureStatus, "NotSigned");
  assert.equal(invocation[2].timeout, 10000);
  assert.deepEqual(JSON.parse(invocation[2].env.MINEMASTER_DIAGNOSTIC_PATHS), [
    target,
  ]);
  assert.ok(!invocation[1].join(" ").includes(target));
  assert.doesNotMatch(
    SCRIPT,
    /Set-Mp|Add-Mp|Remove-Mp|Start-Mp|ExecutionPolicy|EncodedCommand/i,
  );
  await diagnose([target]);
  assert.equal(calls, 1);
});
test("unavailable Defender history is never reported as clean or as proof of a current block", async () => {
  const diagnose = createWindowsDiagnostics({
    platform: "win32",
    run: async () => {
      throw Error("Denied");
    },
  });
  assert.equal((await diagnose(["C:\\miner.exe"])).status, "unavailable");
  assert.equal(await createWindowsDiagnostics({ platform: "linux" })([]), null);
  assert.equal(
    normalizeResult({ status: "available", detections: null }, []).detections
      .length,
    0,
  );
});
