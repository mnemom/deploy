// Deployment Confidence Score
//
// Computes a 0-100 confidence score after staging passes, posted to
// GitHub Step Summary to inform the human before they approve production.
//
// Inputs (env vars):
//   SOURCE_REPO  — repo name (e.g. "smoltbot")
//   SOURCE_REF   — commit SHA
//   GITHUB_TOKEN — app token for cross-repo API access
//   DEPLOY_FLAGS — JSON object of which services are being deployed
//
// Output: score + breakdown table written to $GITHUB_STEP_SUMMARY

const fs = require("fs");

const SUMMARY_FILE = process.env.GITHUB_STEP_SUMMARY;

async function ghApi(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);
  return res.json();
}

async function getDiffStats(repo, sha) {
  const commit = await ghApi(`/repos/mnemom/${repo}/commits/${sha}`);
  const parentSha = commit.parents?.[0]?.sha;
  if (!parentSha) return { totalChanges: 0, files: [] };

  const compare = await ghApi(
    `/repos/mnemom/${repo}/compare/${parentSha}...${sha}`
  );
  return {
    totalChanges: (compare.files || []).reduce(
      (sum, f) => sum + f.additions + f.deletions,
      0
    ),
    files: (compare.files || []).map((f) => f.filename),
  };
}

async function getDaysSinceLastProdDeploy(repo) {
  const deployments = await ghApi(
    `/repos/mnemom/${repo}/deployments?environment=production&per_page=1`
  );
  if (!deployments.length) return Infinity;
  const lastDeploy = new Date(deployments[0].created_at);
  return (Date.now() - lastDeploy.getTime()) / (1000 * 60 * 60 * 24);
}

function countServicesAffected(deployFlags) {
  // Count services (exclude SDK/package-only flags)
  const serviceKeys = [
    "smoltbot",
    "mnemom-api",
    "mnemom-reputation",
    "mnemom-risk",
    "mnemom-website",
    "mnemom-prover",
    "hunter",
  ];
  return serviceKeys.filter((k) => deployFlags[k] === true).length;
}

function writeSummary(content) {
  if (SUMMARY_FILE) {
    fs.appendFileSync(SUMMARY_FILE, content + "\n");
  }
  console.log(content);
}

async function main() {
  const repo = process.env.SOURCE_REPO;
  const sha = process.env.SOURCE_REF;
  let deployFlags = {};

  try {
    deployFlags = JSON.parse(process.env.DEPLOY_FLAGS || "{}");
  } catch {
    deployFlags = {};
  }

  let score = 100;
  const factors = [];

  // If no SHA, we can't analyze the diff — output a neutral score
  if (!repo || !sha) {
    writeSummary("## Deployment Confidence Score");
    writeSummary("");
    writeSummary("**Score: 50** / 100");
    writeSummary("");
    writeSummary(
      "_No source commit available for analysis (manual dispatch without ref)._"
    );
    return;
  }

  try {
    // 1. Diff stats
    const { totalChanges, files } = await getDiffStats(repo, sha);

    if (totalChanges < 50) {
      score += 10;
      factors.push({ signal: "Small change (<50 lines)", impact: "+10" });
    }
    if (totalChanges > 500) {
      score -= 20;
      factors.push({ signal: "Large change (>500 lines)", impact: "-20" });
    }

    // 2. Config file changes
    const configFiles = files.filter(
      (f) =>
        !f.startsWith("src/") &&
        !f.endsWith(".test.ts") &&
        !f.endsWith(".test.js") &&
        !f.endsWith(".spec.ts") &&
        !f.endsWith(".spec.js")
    );
    if (configFiles.length > 0) {
      score -= 10;
      factors.push({
        signal: `Files outside src/ (${configFiles.slice(0, 3).join(", ")}${configFiles.length > 3 ? "..." : ""})`,
        impact: "-10",
      });
    }

    // 3. Dependency changes
    const depFiles = files.filter(
      (f) =>
        f.endsWith("package.json") ||
        f.endsWith("package-lock.json") ||
        f.endsWith("pnpm-lock.yaml")
    );
    if (depFiles.length > 0) {
      score -= 15;
      factors.push({
        signal: `Dependency changes (${depFiles.join(", ")})`,
        impact: "-15",
      });
    }

    // 4. Services affected
    const serviceCount = countServicesAffected(deployFlags);
    if (serviceCount > 3) {
      score -= 15;
      factors.push({
        signal: `${serviceCount} services affected (>3)`,
        impact: "-15",
      });
    } else if (serviceCount >= 2) {
      score -= 5;
      factors.push({
        signal: `${serviceCount} services affected (2-3)`,
        impact: "-5",
      });
    }

    // 5. Time since last prod deploy
    try {
      const daysSince = await getDaysSinceLastProdDeploy(repo);
      if (daysSince > 7) {
        score -= 5;
        factors.push({
          signal: `>7 days since last prod deploy (${Math.round(daysSince)}d)`,
          impact: "-5",
        });
      }
    } catch {
      factors.push({
        signal: "Last prod deploy time unavailable",
        impact: "n/a",
      });
    }
  } catch (err) {
    // If API calls fail, output neutral score
    writeSummary("## Deployment Confidence Score");
    writeSummary("");
    writeSummary("**Score: 50** / 100");
    writeSummary("");
    writeSummary(`_Analysis unavailable: ${err.message}_`);
    return;
  }

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));

  // Write summary
  writeSummary("## Deployment Confidence Score");
  writeSummary("");
  writeSummary(`**Score: ${score}** / 100`);
  writeSummary("");
  writeSummary(`> Source: \`${repo}\` @ \`${sha.slice(0, 7)}\``);
  writeSummary("");

  if (factors.length > 0) {
    writeSummary("| Signal | Impact |");
    writeSummary("|--------|--------|");
    for (const f of factors) {
      writeSummary(`| ${f.signal} | ${f.impact} |`);
    }
  } else {
    writeSummary("_No risk signals detected._");
  }
}

main().catch((err) => {
  // Never fail the job
  console.error("Confidence score error:", err.message);
  const content = [
    "## Deployment Confidence Score",
    "",
    "**Score: 50** / 100",
    "",
    `_Error computing score: ${err.message}_`,
  ].join("\n");
  if (SUMMARY_FILE) {
    fs.appendFileSync(SUMMARY_FILE, content + "\n");
  }
  console.log(content);
});
