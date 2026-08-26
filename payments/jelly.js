const crypto = require("node:crypto");

function config(env = process.env) {
  const mode = env.JELLY_PAYMENT_MODE || "local";
  return {
    mode,
    recipient: env.JELLY_PAYMENT_WALLET_ADDRESS || "",
    rpcUrl: env.HELIUS_RPC_URL || env.SOLANA_RPC_URL || "",
    asset: (env.JELLY_PAYMENT_ASSET || "SOL").toUpperCase(),
    amountLamports: Number(env.JELLY_PAYMENT_AMOUNT_LAMPORTS || 0),
  };
}

function createIntent(order, env = process.env) {
  const c = config(env);
  if (c.mode !== "jelly") return { provider: "local", state: "authorized" };
  if (!c.recipient || !c.rpcUrl) throw new Error("Jelly payments require JELLY_PAYMENT_WALLET_ADDRESS and HELIUS_RPC_URL");
  if (c.asset !== "SOL") throw new Error("Jelly payment verification currently supports SOL; set JELLY_PAYMENT_ASSET=SOL");
  if (!Number.isInteger(c.amountLamports) || c.amountLamports <= 0) throw new Error("JELLY_PAYMENT_AMOUNT_LAMPORTS must be a positive integer");
  return {
    provider: "jelly", state: "awaiting_payment", intent_id: `jelly_pi_${crypto.randomUUID()}`,
    recipient: c.recipient, asset: c.asset, amount_lamports: c.amountLamports,
    order_amount_cents: order.price_cents,
  };
}

async function rpc(url, method, params) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
  if (!response.ok) throw new Error(`Jelly RPC returned ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message || "Jelly RPC error");
  return body.result;
}

async function verifyTransfer(intent, signature, env = process.env) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(signature)) throw new Error("payment signature is invalid");
  const c = config(env);
  const tx = await rpc(c.rpcUrl, "getTransaction", [signature, { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
  if (!tx || !tx.meta || tx.meta.err) throw new Error("payment transaction is not finalized");
  const keys = tx.transaction.message.accountKeys || [];
  const recipientIndex = keys.findIndex((key) => (key.pubkey || key) === intent.recipient);
  if (recipientIndex < 0) throw new Error("payment recipient does not match the Office Hours wallet");
  const received = (tx.meta.postBalances[recipientIndex] || 0) - (tx.meta.preBalances[recipientIndex] || 0);
  if (received < intent.amount_lamports) throw new Error("payment amount is below the requested Jelly amount");
  return { state: "paid", signature, paid_at: new Date().toISOString(), amount_lamports: received };
}

module.exports = { config, createIntent, verifyTransfer };
