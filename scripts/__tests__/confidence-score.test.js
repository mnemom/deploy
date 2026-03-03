const { describe, it } = require("node:test");
const assert = require("node:assert");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SCRIPT_PATH = path.resolve(__dirname, "../confidence-score.js");

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
      { env: childEnv, timeout: 10000 },
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

function ghApiFetchMock(opts = {}) {
  const totalChanges = opts.totalChanges || 10;
  const files = opts.files || [{ filename: "src/index.ts", additions: 5, deletions: 5 }];
  const deployDaysAgo = opts.deployDaysAgo || 1;

  const commitResponse = JSON.stringify({
    parents: [{ sha: "parent-sha-123" }],
  });
  const compareResponse = JSON.stringify({
    files: files.map((f) => ({
      filename: f.filename,
      additions: f.additions || 0,
      deletions: f.deletions || 0,
    })),
  });
  const deploymentsResponse = JSON.stringify([
    {
      created_at: new Date(
        Date.now() - deployDaysAgo * 24 * 60 * 60 * 1000
      ).toISOString(),
    },
  ]);

  return `async (url) => {
    if (url.includes("/commits/")) {
      return { ok: true, json: async () => (${commitResponse}) };
    }
    if (url.includes("/compare/")) {
      return { ok: true, json: async () => (${compareResponse}) };
    }
    if (url.includes("/deployments")) {
      return { ok: true, json: async () => (${deploymentsResponse}) };
    }
    return { ok: true, json: async () => ({}) };
  }`;
}

function extractScore(summary) {
  const match = summary.match(/\*\*Score:\s*(\d+)\*\*/);
  return match ? parseInt(match[1], 10) : null;
}

describe("confidence-score", () => {
  it("gives high score for small change", async () => {
    const fetchMock = ghApiFetchMock({
      totalChanges: 10,
      files: [{ filename: "src/index.ts", additions: 5, deletions: 5 }],
      deployDaysAgo: 1,
    });

    const result = await runScript(
      {
        SOURCE_REPO: "smoltbot",
        SOURCE_REF: "abc1234567890",
        GITHUB_TOKEN: "test-token",
        DEPLOY_FLAGS: JSON.stringify({ smoltbot: true }),
      },
      fetchMock
    );

    assert.strictEqual(result.exitCode, 0);
    const score = extractScore(result.summary);
    assert.ok(score !== null, "Should have a score in summary");
    assert.ok(score >= 100, `Small change should score 100, got ${score}`);
  });

  it("reduces score for large change with dependency changes", async () => {
    const files = [];
    for (let i = 0; i < 30; i++) {
      files.push({ filename: `src/file${i}.ts`, additions: 10, deletions: 10 });
    }
    files.push({ filename: "package.json", additions: 5, deletions: 2 });
    files.push({ filename: "package-lock.json", additions: 100, deletions: 50 });

    const fetchMock = ghApiFetchMock({
      files,
      deployDaysAgo: 1,
    });

    const result = await runScript(
      {
        SOURCE_REPO: "smoltbot",
        SOURCE_REF: "abc1234567890",
        GITHUB_TOKEN: "test-token",
        DEPLOY_FLAGS: JSON.stringify({ smoltbot: true }),
      },
      fetchMock
    );

    assert.strictEqual(result.exitCode, 0);
    const score = extractScore(result.summary);
    assert.ok(score !== null, "Should have a score in summary");
    // Large change (-20) + dep changes (-15) + files outside src/ (-10 for package files)
    assert.ok(score < 80, `Large change + deps should reduce score, got ${score}`);
  });

  it("reduces score for multiple services", async () => {
    const fetchMock = ghApiFetchMock({
      files: [{ filename: "src/index.ts", additions: 5, deletions: 5 }],
      deployDaysAgo: 1,
    });

    const result = await runScript(
      {
        SOURCE_REPO: "smoltbot",
        SOURCE_REF: "abc1234567890",
        GITHUB_TOKEN: "test-token",
        DEPLOY_FLAGS: JSON.stringify({
          smoltbot: true,
          "mnemom-api": true,
          "mnemom-reputation": true,
          "mnemom-risk": true,
        }),
      },
      fetchMock
    );

    assert.strictEqual(result.exitCode, 0);
    const score = extractScore(result.summary);
    assert.ok(score !== null, "Should have a score in summary");
    // >3 services: -15
    assert.ok(score < 100, `Multiple services should reduce score, got ${score}`);
  });

  it("returns neutral score 50 when SOURCE_REPO is missing", async () => {
    const fetchMock = `async () => ({ ok: true, json: async () => ({}) })`;

    const result = await runScript(
      {
        GITHUB_TOKEN: "test-token",
      },
      fetchMock
    );

    assert.strictEqual(result.exitCode, 0);
    const score = extractScore(result.summary);
    assert.strictEqual(score, 50);
  });

  it("returns neutral score 50 on API error", async () => {
    const fetchMock = `async () => {
      throw new Error("Network error");
    }`;

    const result = await runScript(
      {
        SOURCE_REPO: "smoltbot",
        SOURCE_REF: "abc1234567890",
        GITHUB_TOKEN: "test-token",
        DEPLOY_FLAGS: "{}",
      },
      fetchMock
    );

    assert.strictEqual(result.exitCode, 0);
    const score = extractScore(result.summary);
    assert.strictEqual(score, 50);
  });
});
