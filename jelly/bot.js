/**
 * Office Hours bot — notifies Jelly hosts after a paid intake.
 *
 * Jelly's public API (https://jellyjelly.com/firehose) only documents jelly
 * search/retrieve. There is no published DM endpoint. This module:
 *   - resolves a host via /v3/jelly/search (public)
 *   - formats the intake message
 *   - delivers via dry-run (default), webhook, or a configurable HTTP DM URL
 *     once Jelly exposes messaging for the OH bot account token.
 */

const API_BASE = process.env.JELLY_API_BASE || "https://api.jellyjelly.com";

function config(env = process.env) {
  const mode = (env.JELLY_NOTIFY_MODE || "dry-run").toLowerCase();
  return {
    mode,
    botUsername: env.JELLY_BOT_USERNAME || "officehours",
    token: env.JELLY_BOT_TOKEN || "",
    dmUrl: env.JELLY_DM_API_URL || "",
    webhookUrl: env.JELLY_NOTIFY_WEBHOOK_URL || "",
  };
}

function formatMessage(order) {
  const lines = [
    `Office Hours request (${order.kind})`,
    `Order: ${order.id}`,
    `From: @${order.asker_username}`,
    `To: @${order.host_username}`,
    `Amount: $${(order.price_cents / 100).toFixed(2)} ${order.currency || "USD"} (paid to @${order.payment?.paid_to || "officehours"} bot)`,
  ];
  if (order.slot_start) lines.push(`Slot: ${order.slot_start}`);
  lines.push("", "Question:", order.question);
  lines.push("", "Reply to the asker on Jelly when you accept, or tell the OH bot if you decline. Mark delivered in Office Hours after you post the answer jelly.");
  return lines.join("\n");
}

function formatDeclineMessage(order) {
  const amount = `$${(order.price_cents / 100).toFixed(2)} ${order.currency || "USD"}`;
  const lines = [
    `Office Hours update`,
    `Order: ${order.id}`,
    `@${order.host_username} declined your ${order.kind} request.`,
    `Your ${amount} payment to @${order.payment?.paid_to || "officehours"} is marked refunded (local stub until real pay-to-bot is wired).`,
  ];
  if (order.decline_reason) lines.push(`Reason: ${order.decline_reason}`);
  lines.push("", "You can submit another request anytime on Office Hours.");
  return lines.join("\n");
}

async function resolveHost(username) {
  const url = new URL("/v3/jelly/search", API_BASE);
  url.searchParams.set("username", username);
  url.searchParams.set("page_size", "5");
  url.searchParams.set("sort_by", "date");
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Jelly search failed (${response.status})`);
  const body = await response.json();
  const jellies = Array.isArray(body.jellies) ? body.jellies : [];
  const needle = String(username).toLowerCase();
  for (const jelly of jellies) {
    const people = Array.isArray(jelly.participants) ? jelly.participants : [];
    const match = people.find((p) => String(p.username || "").toLowerCase() === needle);
    if (match) {
      return {
        user_id: match.id || jelly.started_by_id || null,
        username: match.username,
        full_name: match.full_name || null,
        pfp_url: match.pfp_url || null,
      };
    }
  }
  return { user_id: null, username, full_name: null, pfp_url: null, unresolved: true };
}

async function deliver(payload, env = process.env) {
  const c = config(env);
  if (c.mode === "dry-run") {
    return { channel: "dry-run", status: "recorded", bot: c.botUsername, at: new Date().toISOString() };
  }
  if (c.mode === "webhook") {
    if (!c.webhookUrl) throw new Error("JELLY_NOTIFY_WEBHOOK_URL is required when JELLY_NOTIFY_MODE=webhook");
    const response = await fetch(c.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`notify webhook returned ${response.status}`);
    return { channel: "webhook", status: "sent", bot: c.botUsername, at: new Date().toISOString() };
  }
  if (c.mode === "http") {
    if (!c.dmUrl) throw new Error("JELLY_DM_API_URL is required when JELLY_NOTIFY_MODE=http");
    if (!c.token) throw new Error("JELLY_BOT_TOKEN is required when JELLY_NOTIFY_MODE=http");
    const response = await fetch(c.dmUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Token ${c.token}`,
      },
      body: JSON.stringify({
        to_username: payload.host.username,
        to_user_id: payload.host.user_id,
        text: payload.text,
        metadata: { order_id: payload.order.id, kind: payload.order.kind },
      }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Jelly DM API returned ${response.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`);
    }
    let body = null;
    try { body = await response.json(); } catch (_) { /* non-JSON ok */ }
    return { channel: "http", status: "sent", bot: c.botUsername, at: new Date().toISOString(), response: body };
  }
  throw new Error(`Unknown JELLY_NOTIFY_MODE: ${c.mode} (use dry-run, webhook, or http)`);
}

async function notifyHost(order, env = process.env) {
  const c = config(env);
  const host = await resolveHost(order.host_username);
  const text = formatMessage(order);
  const payload = {
    type: "office_hours.intake",
    bot_username: c.botUsername,
    host,
    order: {
      id: order.id,
      kind: order.kind,
      asker_username: order.asker_username,
      host_username: order.host_username,
      price_cents: order.price_cents,
      currency: order.currency,
      question: order.question,
      slot_start: order.slot_start || null,
    },
    text,
  };
  const delivery = await deliver(payload, env);
  return { ...delivery, text, host };
}

module.exports = { config, formatMessage, formatDeclineMessage, resolveHost, notifyHost };
