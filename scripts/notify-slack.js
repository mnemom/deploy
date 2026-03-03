// Slack Deploy Notification
//
// Sends a formatted Slack message via incoming webhook.
//
// Inputs (env vars):
//   SLACK_WEBHOOK_URL  — incoming webhook URL
//   DEPLOY_EVENT       — one of: staging_start, production_approval,
//                        deploy_complete, deploy_failure,
//                        rollback_triggered, rollback_complete
//   DEPLOY_SERVICES    — comma-separated service names
//   DEPLOY_ENVIRONMENT — staging or production
//   DEPLOY_STATUS      — success, failure, pending
//   DEPLOY_CONFIDENCE  — confidence score (optional)
//   DEPLOY_RUN_URL     — link to the GitHub Actions run

const EVENT_LABELS = {
  staging_start: "Deploy Started",
  production_approval: "Awaiting Production Approval",
  deploy_complete: "Deploy Complete",
  deploy_failure: "Deploy Failed",
  rollback_triggered: "Rollback Triggered",
  rollback_complete: "Rollback Complete",
};

const STATUS_COLORS = {
  success: "#2eb67d",
  failure: "#e01e5a",
  pending: "#ecb22e",
};

function buildMessage() {
  const event = process.env.DEPLOY_EVENT || "deploy_complete";
  const services = process.env.DEPLOY_SERVICES || "unknown";
  const environment = process.env.DEPLOY_ENVIRONMENT || "staging";
  const status = process.env.DEPLOY_STATUS || "pending";
  const confidence = process.env.DEPLOY_CONFIDENCE || "";
  const runUrl = process.env.DEPLOY_RUN_URL || "";

  const title = `${EVENT_LABELS[event] || event} — ${environment}`;
  const color = STATUS_COLORS[status] || STATUS_COLORS.pending;

  const fields = [
    {
      type: "mrkdwn",
      text: `*Services:*\n${services}`,
    },
    {
      type: "mrkdwn",
      text: `*Environment:*\n${environment}`,
    },
  ];

  if (confidence) {
    fields.push({
      type: "mrkdwn",
      text: `*Confidence:*\n${confidence}/100`,
    });
  }

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${title}*`,
      },
    },
    {
      type: "section",
      fields,
    },
  ];

  if (runUrl) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<${runUrl}|View Run>`,
        },
      ],
    });
  }

  return {
    attachments: [
      {
        color,
        blocks,
      },
    ],
  };
}

async function main() {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("SLACK_WEBHOOK_URL not set — skipping notification");
    return;
  }

  const payload = buildMessage();

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Slack webhook failed (${res.status}): ${body}`);
    process.exitCode = 1;
  } else {
    console.log(`Slack notification sent: ${process.env.DEPLOY_EVENT}`);
  }
}

main().catch((err) => {
  console.error("Slack notification error:", err.message);
  process.exitCode = 1;
});
