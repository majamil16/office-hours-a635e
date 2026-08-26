#!/usr/bin/env node

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const jellyBot = require("./jelly/bot");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || process.env.OH_PORT || 4173);
const DB_FILE = path.join(ROOT, ".data", "orders.json");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };
const OH_BOT_USERNAME = process.env.JELLY_BOT_USERNAME || "officehours";

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

async function api(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, 200, {
      ok: true,
      service: "office-hours",
      bot: OH_BOT_USERNAME,
      notify_mode: jellyBot.config().mode,
      time: new Date().toISOString(),
    });
  }
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const match = url.pathname.match(/^\/api\/(checkout|orders\/([^/]+)\/(accept|deliver))$/);
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

      // Payment goes to the Office Hours bot account (local stub until wallet/tip wiring).
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
      if (order.kind !== "jelly" || order.state !== "submitted") throw new Error("order cannot be accepted");
      order.state = "accepted"; order.accepted_at = new Date().toISOString();
    } else {
      if (order.state !== "accepted" && order.state !== "confirmed") throw new Error("order is not deliverable");
      order.state = "delivered"; order.payment.state = "captured"; order.delivered_at = new Date().toISOString();
    }
    writeOrders(orders); return json(res, 200, { order });
  } catch (e) { return json(res, 400, { error: e.message || "bad_request" }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) return api(req, res, url);
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method_not_allowed" });
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
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
