#!/usr/bin/env node

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const jellyBot = require("./jelly/bot");
const { integrationSpec, requireIntegration } = require("./integrations");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || process.env.OH_PORT || 4173);
const DB_FILE = path.join(ROOT, ".data", "orders.json");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };
const OH_BOT_USERNAME = process.env.JELLY_BOT_USERNAME || "officehours";
const OPS_TOKEN = process.env.OPS_TOKEN || "";

function readOrders() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch (e) { return []; }
}
function writeOrders(orders) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(orders, null, 2) + "\n");
  fs.renameSync(tmp, DB_FILE);
}
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; if (raw.length > 100_000) reject(new Error("request too large")); });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(new Error("invalid JSON")); } });
    req.on("error", reject);
  });
}
function requiredString(value, name, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${name} is required`);
  return value.trim();
}
function bearer(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return (m && m[1].trim()) || req.headers["x-ops-token"] || "";
}
function requireOps(req, res) {
  if (!OPS_TOKEN) {
    json(res, 503, { error: "ops_disabled", message: "Set OPS_TOKEN to enable the operator inbox" });
    return false;
  }
  if (bearer(req) !== OPS_TOKEN) {
    json(res, 401, { error: "unauthorized" });
    return false;
  }
  return true;
}
function enrichOrder(order) {
  const paymentReal = order.payment?.processor !== "oh_bot_local";
  return {
    ...order,
    payment_real: paymentReal,
    asker_dm_text: order.state === "declined" ? jellyBot.formatDeclineMessage(order) : null,
    host_dm_text: order.host_notification?.text || jellyBot.formatMessage(order),
  };
}
function applyOrderAction(order, action, body = {}) {
  if (action === "mark-dm-sent" || action === "mark-host-notified") {
    order.host_dm_sent_at = new Date().toISOString();
    return;
  }
  if (action === "accept") {
    if (order.kind !== "jelly" || order.state !== "submitted") throw new Error("order cannot be accepted");
    order.state = "accepted";
    order.accepted_at = new Date().toISOString();
    return;
  }
  if (action === "decline") {
    if (order.kind !== "jelly" || order.state !== "submitted") throw new Error("order cannot be declined");
    order.state = "declined";
    order.declined_at = new Date().toISOString();
    if (typeof body.reason === "string" && body.reason.trim()) {
      order.decline_reason = body.reason.trim().slice(0, 400);
    }
    order.payment = { ...order.payment, state: "refunded", refunded_at: new Date().toISOString() };
    order.asker_notification = {
      status: "ready",
      text: jellyBot.formatDeclineMessage(order),
      at: new Date().toISOString(),
    };
    return;
  }
  if (action === "deliver") {
    if (order.state !== "accepted" && order.state !== "confirmed") throw new Error("order is not deliverable");
    order.state = "delivered";
    order.payment = { ...order.payment, state: "captured" };
    order.delivered_at = new Date().toISOString();
  }
}

async function api(req, res, url) {
  const baseUrl = `${url.protocol}//${url.host}`;

  if (req.method === "GET" && url.pathname === "/api/integrations") {
    return json(res, 200, integrationSpec(baseUrl));
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, 200, {
      ok: true,
      service: "office-hours",
      bot: OH_BOT_USERNAME,
      notify_mode: jellyBot.config().mode,
      ops_enabled: Boolean(OPS_TOKEN),
      integration_api: "/api/integrations",
      time: new Date().toISOString(),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/v1/orders") {
    if (!requireIntegration(req, res)) return;
    const status = url.searchParams.get("status") || "open";
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
    const orders = readOrders();
    const open = new Set(["submitted", "confirmed", "accepted"]);
    const filtered = status === "all" ? orders : orders.filter((o) => open.has(o.state));
    return json(res, 200, { orders: filtered.slice(0, limit).map(enrichOrder), bot: OH_BOT_USERNAME });
  }

  const v1OrderMatch = url.pathname.match(/^\/api\/v1\/orders\/([^/]+)(?:\/(accept|decline|deliver|mark-host-notified))?$/);
  if (v1OrderMatch) {
    if (!requireIntegration(req, res)) return;
    const orders = readOrders();
    const order = orders.find((o) => o.id === v1OrderMatch[1]);
    if (!order) return json(res, 404, { error: "order_not_found" });
    if (req.method === "GET" && !v1OrderMatch[2]) {
      return json(res, 200, { order: enrichOrder(order) });
    }
    if (req.method === "POST" && v1OrderMatch[2]) {
      const body = await readBody(req).catch(() => ({}));
      const action = v1OrderMatch[2] === "mark-host-notified" ? "mark-host-notified" : v1OrderMatch[2];
      try {
        applyOrderAction(order, action, body);
        writeOrders(orders);
        return json(res, 200, { order: enrichOrder(order) });
      } catch (e) {
        return json(res, 400, { error: e.message || "bad_request" });
      }
    }
    return json(res, 405, { error: "method_not_allowed" });
  }

  if (req.method === "GET" && url.pathname === "/api/ops/orders") {
    if (!requireOps(req, res)) return;
    const status = url.searchParams.get("status") || "open";
    const orders = readOrders();
    const open = new Set(["submitted", "confirmed", "accepted"]);
    const filtered = status === "all"
      ? orders
      : orders.filter((o) => open.has(o.state));
    return json(res, 200, { orders: filtered.map(enrichOrder), bot: OH_BOT_USERNAME });
  }

  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const opsMatch = url.pathname.match(/^\/api\/ops\/orders\/([^/]+)\/(mark-dm-sent|accept|decline|deliver)$/);
  if (opsMatch) {
    if (!requireOps(req, res)) return;
    const body = await readBody(req).catch(() => ({}));
    const orders = readOrders();
    const order = orders.find((o) => o.id === opsMatch[1]);
    if (!order) return json(res, 404, { error: "order_not_found" });
    const action = opsMatch[2];
    try {
      applyOrderAction(order, action, body);
      writeOrders(orders);
      return json(res, 200, { order: enrichOrder(order) });
    } catch (e) {
      return json(res, 400, { error: e.message || "bad_request" });
    }
  }

  const match = url.pathname.match(/^\/api\/(checkout|orders\/([^/]+)\/(accept|decline|deliver))$/);
  if (!match) return json(res, 404, { error: "not_found" });
  try {
    const body = await readBody(req);
    const orders = readOrders();
    if (match[1] === "checkout") {
      const kind = body.kind === "live" || body.kind === "jelly" ? body.kind : null;
      if (!kind) throw new Error("kind must be live or jelly");
      const host = requiredString(body.host_username, "host_username", 80).replace(/^@/, "");
      const asker = requiredString(body.asker_username, "asker_username", 80).replace(/^@/, "");
      const question = requiredString(body.question, "question", 600);
      const price = Number(body.price_cents);
      if (!Number.isInteger(price) || price < 100 || price > 1_000_000) throw new Error("price_cents must be between 100 and 1000000");
      let slot = null;
      if (kind === "live") {
        slot = new Date(body.slot_start);
        if (Number.isNaN(slot.getTime()) || slot.getTime() <= Date.now()) throw new Error("slot_start must be a future date");
      }
      const key = req.headers["idempotency-key"];
      const prior = key && orders.find((o) => o.idempotency_key === key);
      if (prior) return json(res, 200, { order: prior, replayed: true });

      const order = {
        id: id(kind === "live" ? "booking" : "jreq"),
        kind,
        host_username: host,
        asker_username: asker,
        question,
        price_cents: price,
        currency: "USD",
        slot_start: slot && slot.toISOString(),
        payment: {
          state: "authorized",
          processor: "oh_bot_local",
          paid_to: OH_BOT_USERNAME,
          authorized_at: new Date().toISOString(),
        },
        state: kind === "live" ? "confirmed" : "submitted",
        host_notification: null,
        idempotency_key: key || null,
        created_at: new Date().toISOString(),
      };

      try {
        order.host_notification = await jellyBot.notifyHost(order);
      } catch (err) {
        order.host_notification = {
          status: "failed",
          error: err.message || String(err),
          at: new Date().toISOString(),
        };
      }

      orders.unshift(order); writeOrders(orders);
      return json(res, 201, { order });
    }
    const order = orders.find((o) => o.id === match[2]);
    if (!order) return json(res, 404, { error: "order_not_found" });
    if (match[3] === "accept") {
      applyOrderAction(order, "accept");
    } else if (match[3] === "decline") {
      applyOrderAction(order, "decline", body);
    } else {
      applyOrderAction(order, "deliver");
    }
    writeOrders(orders); return json(res, 200, { order: enrichOrder(order) });
  } catch (e) { return json(res, 400, { error: e.message || "bad_request" }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) return api(req, res, url);
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method_not_allowed" });
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname === "/ops" ? "/ops.html" : url.pathname);
  const file = path.normalize(path.join(ROOT, requested));
  if (!file.startsWith(ROOT + path.sep)) return json(res, 403, { error: "forbidden" });
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return json(res, 404, { error: "not_found" });
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
});
server.listen(PORT, "0.0.0.0", () => console.log(`Office Hours running at http://0.0.0.0:${PORT}`));
