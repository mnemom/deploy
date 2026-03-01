// Post-Deploy Monitor
//
// Runs after canary promotion to 100%. Polls error rates every 30s
// for 5 minutes. If an error spike is detected, automatically dispatches
// the rollback workflow.
//
// Inputs (env vars):
//   CLOUDFLARE_API_TOKEN      — API token with Analytics:Read
//   CLOUDFLARE_ACCOUNT_ID     — Cloudflare account ID
//   SCRIPT_NAME               — Worker script name (e.g. "smoltbot-gateway")
//   SERVICE_NAME              — Service name matching rollback.yml choices
//   ENVIRONMENT               — "staging" or "production"
//   ERROR_THRESHOLD           — Max error rate before triggering rollback (default: 0.05)
//   MONITOR_DURATION_SECONDS  — Total monitoring time (default: 300)
//   POLL_INTERVAL_SECONDS     — Time between checks (default: 30)
//   GITHUB_TOKEN              — Token for dispatching rollback workflow
//
// Behavior:
//   - Polls error rates at the configured interval
//   - If error rate exceeds threshold, dispatches rollback.yml and exits 1
//   - If monitoring infrastructure fails, logs but continues (fail-open)
//   - Only an actual detected error spike causes exit code 1

const fs = require("fs");

const SUMMARY_FILE = process.env.GITHUB_STEP_SUMMARY;

function writeSummary(content) {
  if (SUMMARY_FILE) {
    fs.appendFileSync(SUMMARY_FILE, content + "\n");
  }
  console.log(content);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryErrorRate(scriptName, windowSeconds) {
  const now = new Date();
  const since = new Date(now.getTime() - windowSeconds * 1000);

  const query = `
    query WorkerErrorRate($accountTag: String!, $scriptName: String!, $since: Time!, $until: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(
            filter: {
              scriptName: $scriptName
              datetime_geq: $since
              datetime_leq: $until
            }
            limit: 1
          ) {
            sum {
              requests
              errors
            }
          }
        }
      }
    }
  `;

  const variables = {
    accountTag: process.env.CLOUDFLARE_ACCOUNT_ID,
    scriptName,
    since: since.toISOString(),
    until: now.toISOString(),
  };

  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Cloudflare GraphQL API returned ${res.status}`);
  }

  const data = await res.json();

  if (data.errors && data.errors.length > 0) {
    throw new Error(
      `GraphQL errors: ${data.errors.map((e) => e.message).join(", ")}`
    );
  }

  const invocations =
    data.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
  if (!invocations || invocations.length === 0) {
    return { requests: 0, errors: 0, errorRate: 0 };
  }

  const { requests, errors } = invocations[0].sum;
  const errorRate = requests > 0 ? errors / requests : 0;

  return { requests, errors, errorRate };
}

async function dispatchRollback(serviceName, environment) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN not set — cannot dispatch rollback");
    return false;
  }

  const res = await fetch(
    "https://api.github.com/repos/mnemom/deploy/actions/workflows/rollback.yml/dispatches",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          service: serviceName,
          environment,
        },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`Failed to dispatch rollback: ${res.status} ${body}`);
    return false;
  }

  console.log(
    `Rollback dispatched for ${serviceName} (${environment})`
  );
  return true;
}

async function main() {
  const scriptName = process.env.SCRIPT_NAME;
  const serviceName = process.env.SERVICE_NAME;
  const environment = process.env.ENVIRONMENT || "production";
  const errorThreshold = parseFloat(process.env.ERROR_THRESHOLD || "0.05");
  const monitorDuration = parseInt(
    process.env.MONITOR_DURATION_SECONDS || "300",
    10
  );
  const pollInterval = parseInt(
    process.env.POLL_INTERVAL_SECONDS || "30",
    10
  );

  if (!scriptName || !serviceName) {
    console.error("SCRIPT_NAME and SERVICE_NAME are required");
    process.exit(1);
  }

  const checks = [];
  const startTime = Date.now();
  const endTime = startTime + monitorDuration * 1000;
  let iteration = 0;

  console.log(
    `Monitoring ${scriptName} for ${monitorDuration}s (polling every ${pollInterval}s, threshold: ${(errorThreshold * 100).toFixed(1)}%)`
  );

  while (Date.now() < endTime) {
    iteration++;
    await sleep(pollInterval * 1000);

    let result;
    try {
      result = await queryErrorRate(scriptName, pollInterval);
    } catch (err) {
      // Fail-open: monitoring infra errors are logged but don't trigger rollback
      console.log(
        `  [${iteration}] Analytics query failed: ${err.message} (continuing)`
      );
      checks.push({
        iteration,
        status: "error",
        message: err.message,
      });
      continue;
    }

    const errorPct = (result.errorRate * 100).toFixed(2);
    console.log(
      `  [${iteration}] requests=${result.requests} errors=${result.errors} rate=${errorPct}%`
    );

    checks.push({
      iteration,
      status: "ok",
      requests: result.requests,
      errors: result.errors,
      errorRate: result.errorRate,
    });

    // Only trigger rollback if there's actual traffic AND error rate exceeds threshold
    if (result.requests > 0 && result.errorRate > errorThreshold) {
      console.error(
        `Error rate ${errorPct}% exceeds threshold ${(errorThreshold * 100).toFixed(1)}% — triggering rollback`
      );

      writeSummary("## Post-Deploy Monitor");
      writeSummary("");
      writeSummary(
        `**ROLLBACK TRIGGERED** for \`${serviceName}\` (\`${environment}\`)`
      );
      writeSummary("");
      writeSummary(
        `Error rate ${errorPct}% exceeded threshold ${(errorThreshold * 100).toFixed(1)}% at check ${iteration}.`
      );
      writeSummary("");
      writeSummary("| Check | Requests | Errors | Rate |");
      writeSummary("|-------|----------|--------|------|");
      for (const c of checks) {
        if (c.status === "ok") {
          writeSummary(
            `| ${c.iteration} | ${c.requests} | ${c.errors} | ${(c.errorRate * 100).toFixed(2)}% |`
          );
        } else {
          writeSummary(`| ${c.iteration} | — | — | _${c.message}_ |`);
        }
      }

      await dispatchRollback(serviceName, environment);
      process.exit(1);
    }
  }

  // Monitoring complete — no error spike detected
  writeSummary("## Post-Deploy Monitor");
  writeSummary("");
  writeSummary(
    `**PASS** — \`${scriptName}\` monitored for ${monitorDuration}s with no error spike.`
  );
  writeSummary("");
  writeSummary("| Check | Requests | Errors | Rate |");
  writeSummary("|-------|----------|--------|------|");
  for (const c of checks) {
    if (c.status === "ok") {
      writeSummary(
        `| ${c.iteration} | ${c.requests} | ${c.errors} | ${(c.errorRate * 100).toFixed(2)}% |`
      );
    } else {
      writeSummary(`| ${c.iteration} | — | — | _${c.message}_ |`);
    }
  }
}

main().catch((err) => {
  // Fail-open: script-level errors don't fail the job
  console.error("post-deploy-monitor.js error:", err.message);
  writeSummary("## Post-Deploy Monitor");
  writeSummary("");
  writeSummary(`> **PASS** (fail-open) — script error: ${err.message}`);
});
