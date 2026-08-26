#!/usr/bin/env node

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const jellyPayment = require("./payments/jelly");

const ROOT = __dirname;
const PORT = Number(process.env.OH_PORT || 4173);
const DB_FILE = path.join(ROOT, ".data", "state.json");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };

function readState() {
  try {
    const value = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    return Array.isArray(value) ? { orders: value, providers: [] } : { orders: [], providers: [], ...value };
  } catch (e) { return { orders: [], providers: [] }; }
}
function writeState(state) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tmp, DB_FILE);
}
const sessions = new Map();
function cookie(req, name) { const raw = req.headers.cookie || ""; return raw.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1); }
function session(req) { const token = cookie(req, "oh_session"); return token && sessions.get(token); }
function setSession(res, provider) { const token = crypto.randomBytes(32).toString("hex"); sessions.set(token, provider.id); res.setHeader("set-cookie", `oh_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`); }
function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) { return `${salt}:${crypto.scryptSync(password, salt, 32).toString("hex")}`; }
function passwordMatches(password, stored) { const [salt, hash] = String(stored).split(":"); return salt && crypto.timingSafeEqual(Buffer.from(hash, "hex"), crypto.scryptSync(password, salt, 32)); }
function publicProvider(p) { return { id: p.id, email: p.email, username: p.username, payment_connections: (p.payment_connections || []).map(({ secret: _, ...safe }) => safe) }; }
function authProvider(req, state) { const id = session(req); return id && state.providers.find((p) => p.id === id); }
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
  if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, service: "office-hours", time: new Date().toISOString() });
  const state = readState();
  if (req.method === "GET" && url.pathname === "/api/auth/me") { const provider = authProvider(req, state); return json(res, 200, { provider: provider ? publicProvider(provider) : null }); }
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const match = url.pathname.match(/^\/api\/(auth\/(register|login|logout)|providers\/me\/payment-connections|checkout|orders\/([^/]+)\/(accept|deliver|payment))$/);
  if (!match) return json(res, 404, { error: "not_found" });
  try {
    const body = await readBody(req);
    if (match[1] === "auth/register" || match[1] === "auth/login") {
      const email = requiredString(body.email, "email", 160).toLowerCase(); const password = requiredString(body.password, "password", 200);
      if (password.length < 8) throw new Error("password must be at least 8 characters");
      let provider = state.providers.find((p) => p.email === email);
      if (match[2] === "register") {
        if (provider) throw new Error("email already registered");
        provider = { id: id("provider"), email, username: requiredString(body.username || email.split("@")[0], "username", 80), password_hash: passwordHash(password), payment_connections: [], created_at: new Date().toISOString() }; state.providers.push(provider); writeState(state);
      } else if (!provider || !passwordMatches(password, provider.password_hash)) throw new Error("invalid email or password");
      setSession(res, provider); return json(res, 200, { provider: publicProvider(provider) });
    }
    if (match[1] === "auth/logout") { const token = cookie(req, "oh_session"); if (token) sessions.delete(token); res.setHeader("set-cookie", "oh_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"); return json(res, 200, { ok: true }); }
    if (match[1] === "providers/me/payment-connections") {
      const provider = authProvider(req, state); if (!provider) return json(res, 401, { error: "login_required" });
      const type = body.type === "jelly" ? "jelly" : null; if (!type) throw new Error("unsupported payment provider");
      const wallet = requiredString(body.wallet_address, "wallet_address", 120); const rpcUrl = requiredString(body.rpc_url, "rpc_url", 500); const amount = Number(body.amount_lamports);
      if (!Number.isInteger(amount) || amount <= 0) throw new Error("amount_lamports must be a positive integer");
      provider.payment_connections = [{ id: id("connection"), type, status: "active", wallet_address: wallet, rpc_url: rpcUrl, asset: "SOL", amount_lamports: amount, created_at: new Date().toISOString() }]; writeState(state);
      return json(res, 201, { provider: publicProvider(provider) });
    }
    const orders = state.orders;
    if (match[1] === "checkout") {
      const kind = body.kind === "live" || body.kind === "jelly" ? body.kind : null;
      if (!kind) throw new Error("kind must be live or jelly");
      const host = requiredString(body.host_username, "host_username", 80);
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
        id: id(kind === "live" ? "booking" : "jreq"), kind, host_username: host,
        question, price_cents: price, currency: "USD", slot_start: slot && slot.toISOString(),
        payment: null, state: "pending_payment", idempotency_key: key || null,
        created_at: new Date().toISOString(),
      };
      const provider = state.providers.find((p) => p.username.toLowerCase() === host.toLowerCase());
      const connection = provider && (provider.payment_connections || []).find((c) => c.status === "active");
      order.provider_id = provider ? provider.id : null;
      order.payment = connection ? jellyPayment.createIntent(order, { JELLY_PAYMENT_MODE: "jelly", JELLY_PAYMENT_WALLET_ADDRESS: connection.wallet_address, HELIUS_RPC_URL: connection.rpc_url, JELLY_PAYMENT_ASSET: connection.asset, JELLY_PAYMENT_AMOUNT_LAMPORTS: connection.amount_lamports }) : jellyPayment.createIntent(order);
      if (order.payment.state === "authorized") order.state = kind === "live" ? "confirmed" : "submitted";
      orders.unshift(order); writeState(state);
      return json(res, 201, { order });
    }
    const order = orders.find((o) => o.id === match[3]);
    if (!order) return json(res, 404, { error: "order_not_found" });
    if (match[4] === "payment") {
      if (order.payment.provider !== "jelly" || order.payment.state !== "awaiting_payment") throw new Error("order is not awaiting a Jelly payment");
      const payment = await jellyPayment.verifyTransfer(order.payment, requiredString(body.signature, "signature", 120));
      order.payment = { ...order.payment, ...payment };
      order.state = order.kind === "live" ? "confirmed" : "submitted";
      writeState(state); return json(res, 200, { order });
    }
    if (match[4] === "accept") {
      if (order.kind !== "jelly" || order.state !== "submitted") throw new Error("order cannot be accepted");
      order.state = "accepted"; order.accepted_at = new Date().toISOString();
    } else {
      if (order.state !== "accepted" && order.state !== "confirmed") throw new Error("order is not deliverable");
      order.state = "delivered"; order.payment.state = "captured"; order.delivered_at = new Date().toISOString();
    }
    writeState(state); return json(res, 200, { order });
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
server.listen(PORT, "127.0.0.1", () => console.log(`Office Hours running at http://127.0.0.1:${PORT}`));
