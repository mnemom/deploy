const { describe, it } = require("node:test");
const assert = require("node:assert");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SCRIPT_PATH = path.resolve(__dirname, "../post-deploy-monitor.js");

function tmpFile() {
  const p = path.join(
    os.tmpdir(),
    `gh-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.writeFileSync(p, "");
  return p;
}

function runScript(env, fetchMock) {
  const summaryFile = tmpFile();

  return new Promise((resolve) => {
    const code = `
      global.fetch = ${fetchMock};
      require(${JSON.stringify(SCRIPT_PATH)});
    `;
    const childEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      GITHUB_STEP_SUMMARY: summaryFile,
      ...env,
    };
    execFile(
      process.execPath,
      ["-e", code],
      { env: childEnv, timeout: 15000 },
      (error, stdout, stderr) => {
        let summary = "";
        try {
          summary = fs.readFileSync(summaryFile, "utf8");
        } catch {}
        try {
          fs.unlinkSync(summaryFile);
        } catch {}

        resolve({
          exitCode: error ? error.code || 1 : 0,
          stdout,
          stderr,
          summary,
        });
      }
    );
  });
}

function cfResponse(requests, errors) {
  return JSON.stringify({
    data: {
      viewer: {
        accounts: [
          {
            workersInvocationsAdaptive: [{ sum: { requests, errors } }],
          },
        ],
      },
    },
  });
}

describe("post-deploy-monitor", () => {
  it("passes when monitoring completes with no error spike", async () => {
    // MONITOR_DURATION_SECONDS=0 means the while loop never executes
    const fetchMock = `async () => ({
      ok: true,
      json: async () => (${cfResponse(1000, 1)})
    })`;

    const result = await runScript(
      {
        SCRIPT_NAME: "test-worker",
        SERVICE_NAME: "test-service",
        ENVIRONMENT: "staging",
        ERROR_THRESHOLD: "0.05",
        MONITOR_DURATION_SECONDS: "0",
        POLL_INTERVAL_SECONDS: "0",
        GITHUB_TOKEN: "test-token",
        CLOUDFLARE_API_TOKEN: "test-token",
        CLOUDFLARE_ACCOUNT_ID: "test-account",
      },
      fetchMock
    );

    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.summary.includes("PASS"));
  });

  it("triggers rollback when error rate exceeds threshold", async () => {
    // High error rate triggers rollback on first poll
    let callCount = 0;
    const fetchMock = `(function() {
      let callCount = 0;
      return async (url) => {
        callCount++;
        if (url.includes("github.com")) {
          return { ok: true, json: async () => ({}), text: async () => "" };
        }
        return {
          ok: true,
          json: async () => (${cfResponse(1000, 500)})
        };
      };
    })()`;

    const result = await runScript(
      {
        SCRIPT_NAME: "test-worker",
        SERVICE_NAME: "test-service",
        ENVIRONMENT: "staging",
        ERROR_THRESHOLD: "0.05",
        MONITOR_DURATION_SECONDS: "10",
        POLL_INTERVAL_SECONDS: "0",
        GITHUB_TOKEN: "test-token",
        CLOUDFLARE_API_TOKEN: "test-token",
        CLOUDFLARE_ACCOUNT_ID: "test-account",
      },
      fetchMock
    );

    assert.strictEqual(result.exitCode, 1);
    assert.ok(result.summary.includes("ROLLBACK TRIGGERED"));
  });

  it("continues on API errors (fail-open)", async () => {
    // All API calls fail, but monitoring completes successfully
    const fetchMock = `async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => "error"
    })`;

    const result = await runScript(
      {
        SCRIPT_NAME: "test-worker",
        SERVICE_NAME: "test-service",
        ENVIRONMENT: "staging",
        ERROR_THRESHOLD: "0.05",
        MONITOR_DURATION_SECONDS: "1",
        POLL_INTERVAL_SECONDS: "0",
        GITHUB_TOKEN: "test-token",
        CLOUDFLARE_API_TOKEN: "test-token",
        CLOUDFLARE_ACCOUNT_ID: "test-account",
      },
      fetchMock
    );

    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.summary.includes("PASS"));
  });

  it("exits 1 when required env vars are missing", async () => {
    const fetchMock = `async () => ({ ok: true, json: async () => ({}) })`;

    const result = await runScript(
      {
        ENVIRONMENT: "staging",
      },
      fetchMock
    );

    assert.strictEqual(result.exitCode, 1);
    assert.ok(
      result.stderr.includes("SCRIPT_NAME") &&
        result.stderr.includes("SERVICE_NAME")
    );
  });
});
