// Cloudflare Worker Error Rate Check
//
// Queries the Cloudflare GraphQL Analytics API for worker error rates
// over a recent time window. Used during canary deploys to detect
// error spikes before promoting to 100% traffic.
//
// Inputs (env vars):
//   CLOUDFLARE_API_TOKEN   — API token with Analytics:Read
//   CLOUDFLARE_ACCOUNT_ID  — Cloudflare account ID
//   SCRIPT_NAME            — Worker script name (e.g. "smoltbot-gateway")
//   OBSERVATION_SECONDS    — Time window to check (default: 60)
//   ERROR_THRESHOLD        — Max error rate before failing (default: 0.05)
//
// Output: sets canary-passed=true|false via $GITHUB_OUTPUT
//         writes summary table to $GITHUB_STEP_SUMMARY

const fs = require("fs");

const SUMMARY_FILE = process.env.GITHUB_STEP_SUMMARY;
const OUTPUT_FILE = process.env.GITHUB_OUTPUT;

function writeSummary(content) {
  if (SUMMARY_FILE) {
    fs.appendFileSync(SUMMARY_FILE, content + "\n");
  }
  console.log(content);
}

function setOutput(key, value) {
  if (OUTPUT_FILE) {
    fs.appendFileSync(OUTPUT_FILE, `${key}=${value}\n`);
  }
  console.log(`${key}=${value}`);
}

async function queryErrorRate(scriptName, observationSeconds) {
  const now = new Date();
  const since = new Date(now.getTime() - observationSeconds * 1000);

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

async function main() {
  const scriptName = process.env.SCRIPT_NAME;
  const observationSeconds = parseInt(
    process.env.OBSERVATION_SECONDS || "60",
    10
  );
  const errorThreshold = parseFloat(process.env.ERROR_THRESHOLD || "0.05");

  if (!scriptName) {
    console.error("SCRIPT_NAME is required");
    process.exit(1);
  }

  let result;
  try {
    result = await queryErrorRate(scriptName, observationSeconds);
  } catch (err) {
    // Fail-open: monitoring infrastructure errors should never block deploys
    console.error(`Error querying analytics: ${err.message}`);
    writeSummary("## Canary Error Rate Check");
    writeSummary("");
    writeSummary(
      `> **PASS** (fail-open) — analytics query failed: ${err.message}`
    );
    setOutput("canary-passed", "true");
    return;
  }

  const passed =
    result.requests === 0 || result.errorRate <= errorThreshold;

  writeSummary("## Canary Error Rate Check");
  writeSummary("");
  writeSummary(`| Metric | Value |`);
  writeSummary(`|--------|-------|`);
  writeSummary(`| Script | \`${scriptName}\` |`);
  writeSummary(`| Window | ${observationSeconds}s |`);
  writeSummary(`| Requests | ${result.requests} |`);
  writeSummary(`| Errors | ${result.errors} |`);
  writeSummary(
    `| Error Rate | ${(result.errorRate * 100).toFixed(2)}% |`
  );
  writeSummary(`| Threshold | ${(errorThreshold * 100).toFixed(2)}% |`);
  writeSummary(`| Result | **${passed ? "PASS" : "FAIL"}** |`);

  if (result.requests === 0) {
    writeSummary("");
    writeSummary(
      "_No traffic observed during window — passing (fail-open)._"
    );
  }

  setOutput("canary-passed", passed ? "true" : "false");
}

main().catch((err) => {
  // Fail-open: never block deploys due to monitoring script errors
  console.error("check-error-rate.js error:", err.message);
  writeSummary("## Canary Error Rate Check");
  writeSummary("");
  writeSummary(
    `> **PASS** (fail-open) — script error: ${err.message}`
  );
  setOutput("canary-passed", "true");
});
