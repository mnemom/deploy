const { describe, it } = require("node:test");
const assert = require("node:assert");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SCRIPT_PATH = path.resolve(__dirname, "../check-error-rate.js");

function tmpFile() {
  const p = path.join(
    os.tmpdir(),
    `gh-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.writeFileSync(p, "");
  return p;
}

function runScript(env, fetchMock) {
  const outputFile = tmpFile();
  const summaryFile = tmpFile();

  return new Promise((resolve) => {
    const code = `
      global.fetch = ${fetchMock};
      require(${JSON.stringify(SCRIPT_PATH)});
    `;
    const childEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
      ...env,
    };
    execFile(
      process.execPath,
      ["-e", code],
      { env: childEnv, timeout: 10000 },
      (error, stdout, stderr) => {
        let output = "";
        let summary = "";
        try {
          output = fs.readFileSync(outputFile, "utf8");
        } catch {}
        try {
          summary = fs.readFileSync(summaryFile, "utf8");
        } catch {}
        try {
          fs.unlinkSync(outputFile);
        } catch {}
        try {
          fs.unlinkSync(summaryFile);
        } catch {}

        resolve({
          exitCode: error ? error.code || 1 : 0,
          stdout,
          stderr,
          output,
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

describe("check-error-rate", () => {
  it("passes with low error rate", async () => {
    const fetchMock = `async () => ({
      ok: true,
      json: async () => (${cfResponse(1000, 10)})
    })`;

    const result = await runScript(
      {
        SCRIPT_NAME: "test-worker",
        OBSERVATION_SECONDS: "60",
        ERROR_THRESHOLD: "0.05",
        CLOUDFLARE_API_TOKEN: "test-token",
        CLOUDFLARE_ACCOUNT_ID: "test-account",
      },
      fetchMock
    );

    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.output.includes("canary-passed=true"));
    assert.ok(result.summary.includes("PASS"));
  });

  it("fails with high error rate", async () => {
    const fetchMock = `async () => ({
      ok: true,
      json: async () => (${cfResponse(1000, 200)})
    })`;

    const result = await runScript(
      {
        SCRIPT_NAME: "test-worker",
        OBSERVATION_SECONDS: "60",
        ERROR_THRESHOLD: "0.05",
        CLOUDFLARE_API_TOKEN: "test-token",
        CLOUDFLARE_ACCOUNT_ID: "test-account",
      },
      fetchMock
    );

    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.output.includes("canary-passed=false"));
    assert.ok(result.summary.includes("FAIL"));
  });

  it("passes with zero traffic (fail-open)", async () => {
    const fetchMock = `async () => ({
      ok: true,
      json: async () => (${cfResponse(0, 0)})
    })`;

    const result = await runScript(
      {
        SCRIPT_NAME: "test-worker",
        OBSERVATION_SECONDS: "60",
        ERROR_THRESHOLD: "0.05",
        CLOUDFLARE_API_TOKEN: "test-token",
        CLOUDFLARE_ACCOUNT_ID: "test-account",
      },
      fetchMock
    );

    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.output.includes("canary-passed=true"));
    assert.ok(result.summary.includes("No traffic observed"));
  });

  it("passes on API error (fail-open)", async () => {
    const fetchMock = `async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => "Internal Server Error"
    })`;

    const result = await runScript(
      {
        SCRIPT_NAME: "test-worker",
        OBSERVATION_SECONDS: "60",
        ERROR_THRESHOLD: "0.05",
        CLOUDFLARE_API_TOKEN: "test-token",
        CLOUDFLARE_ACCOUNT_ID: "test-account",
      },
      fetchMock
    );

    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.output.includes("canary-passed=true"));
    assert.ok(result.summary.includes("fail-open"));
  });

  it("exits 1 when SCRIPT_NAME is missing", async () => {
    const fetchMock = `async () => ({ ok: true, json: async () => ({}) })`;

    const result = await runScript(
      {
        CLOUDFLARE_API_TOKEN: "test-token",
        CLOUDFLARE_ACCOUNT_ID: "test-account",
      },
      fetchMock
    );

    assert.strictEqual(result.exitCode, 1);
    assert.ok(result.stderr.includes("SCRIPT_NAME is required"));
  });
});
