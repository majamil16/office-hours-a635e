/**
 * Integration API spec + auth for Jelly team / external hooks.
 */

function integrationToken(env = process.env) {
  return env.JELLY_INTEGRATION_TOKEN || env.OPS_TOKEN || "";
}

function integrationSpec(baseUrl, env = process.env) {
  const tokenConfigured = Boolean(integrationToken(env));
  return {
    name: "Office Hours Integration API",
    version: "0.1",
    description: "Read orders and subscribe to outbound events. Built for Jelly platform hooks (DM delivery, payments, host/asker dashboards).",
    auth: {
      header: "Authorization: Bearer <token>",
      alt_header: "X-Integration-Token: <token>",
      token_env: "JELLY_INTEGRATION_TOKEN (falls back to OPS_TOKEN if unset)",
      configured: tokenConfigured,
    },
    outbound_webhooks: {
      env: "JELLY_NOTIFY_WEBHOOK_URL",
      mode_env: "JELLY_NOTIFY_MODE=webhook",
      events: [
        {
          type: "office_hours.intake",
          when: "After POST /api/checkout creates a jelly or live request",
          payload_fields: ["type", "bot_username", "host", "order", "text"],
        },
      ],
    },
    endpoints: [
      { method: "GET", path: "/api/integrations", auth: false, description: "This document" },
      { method: "GET", path: "/api/health", auth: false, description: "Liveness + bot username" },
      { method: "GET", path: "/api/v1/orders", auth: true, query: { status: "open | all", limit: "1-100" }, description: "List orders" },
      { method: "GET", path: "/api/v1/orders/:id", auth: true, description: "Single order with host_dm_text / asker_dm_text" },
      { method: "POST", path: "/api/v1/orders/:id/accept", auth: true, description: "Jelly: submitted → accepted" },
      { method: "POST", path: "/api/v1/orders/:id/decline", auth: true, body: { reason: "optional string" }, description: "Jelly: submitted → declined, payment refunded (stub)" },
      { method: "POST", path: "/api/v1/orders/:id/deliver", auth: true, description: "accepted|confirmed → delivered, payment captured (stub)" },
      { method: "POST", path: "/api/v1/orders/:id/mark-host-notified", auth: true, description: "Record that host was messaged on Jelly" },
    ],
    order_states: {
      jelly: ["submitted", "accepted", "declined", "delivered"],
      live: ["confirmed", "delivered"],
    },
    payment_note: "processor oh_bot_local is bookkeeping only until pay-to-bot is wired (#18).",
    base_url: baseUrl,
  };
}

function requireIntegration(req, res, env = process.env) {
  const token = integrationToken(env);
  if (!token) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "integration_disabled", message: "Set JELLY_INTEGRATION_TOKEN or OPS_TOKEN" }));
    return false;
  }
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  const got = (m && m[1].trim()) || req.headers["x-integration-token"] || "";
  if (got !== token) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return false;
  }
  return true;
}

module.exports = { integrationToken, integrationSpec, requireIntegration };
