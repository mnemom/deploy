// BetterStack Uptime Monitor Setup
//
// One-time script that provisions uptime monitors via the BetterStack REST API.
// Idempotent — safe to run multiple times. Checks existing monitors first
// to avoid duplicates.
//
// Input (env var):
//   BETTERSTACK_API_TOKEN — BetterStack API token
//
// Usage:
//   BETTERSTACK_API_TOKEN=xxx node scripts/setup-betterstack.js

const MONITORS = [
  {
    name: "Gateway",
    url: "https://gateway.mnemom.ai/health",
    check_frequency: 60,
  },
  {
    name: "API",
    url: "https://api.mnemom.ai/health",
    check_frequency: 60,
  },
  {
    name: "Reputation",
    url: "https://reputation.mnemom.ai/health",
    check_frequency: 60,
  },
  {
    name: "Risk",
    url: "https://risk.mnemom.ai/health",
    check_frequency: 60,
  },
  {
    name: "Website",
    url: "https://www.mnemom.ai",
    check_frequency: 60,
  },
  {
    name: "Prover",
    url: "https://mnemom--mnemom-prover-prover-service.modal.run/health",
    check_frequency: 300,
  },
];

const API_BASE = "https://uptime.betterstack.com/api/v2";

async function apiRequest(path, options = {}) {
  const token = process.env.BETTERSTACK_API_TOKEN;
  if (!token) {
    throw new Error("BETTERSTACK_API_TOKEN is required");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`BetterStack API ${res.status}: ${body}`);
  }

  return res.json();
}

async function getExistingMonitors() {
  const monitors = [];
  let page = 1;

  while (true) {
    const data = await apiRequest(`/monitors?page=${page}`);
    if (!data.data || data.data.length === 0) break;
    monitors.push(...data.data);
    if (!data.pagination?.next) break;
    page++;
  }

  return monitors;
}

async function createMonitor(monitor) {
  return apiRequest("/monitors", {
    method: "POST",
    body: JSON.stringify({
      monitor_type: "status",
      url: monitor.url,
      pronounceable_name: monitor.name,
      check_frequency: monitor.check_frequency,
      email: true,
    }),
  });
}

async function main() {
  console.log("Fetching existing monitors...");
  const existing = await getExistingMonitors();
  const existingUrls = new Set(
    existing.map((m) => m.attributes?.url).filter(Boolean)
  );

  console.log(`Found ${existing.length} existing monitor(s)\n`);

  for (const monitor of MONITORS) {
    if (existingUrls.has(monitor.url)) {
      console.log(`  SKIP  ${monitor.name} — already exists (${monitor.url})`);
      continue;
    }

    try {
      await createMonitor(monitor);
      console.log(
        `  CREATE  ${monitor.name} — ${monitor.url} (every ${monitor.check_frequency}s)`
      );
    } catch (err) {
      console.error(
        `  ERROR  ${monitor.name} — ${err.message}`
      );
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("setup-betterstack.js error:", err.message);
  process.exit(1);
});
