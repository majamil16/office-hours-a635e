(() => {
  const $ = (s) => document.querySelector(s);
  const money = (n) => `$${Number(n).toFixed(2)}`;
  const KEY = "oh_ops_token";

  function token() { return sessionStorage.getItem(KEY) || ""; }
  function setToken(t) { sessionStorage.setItem(KEY, t); }
  function headers(jsonBody) {
    const h = { authorization: `Bearer ${token()}` };
    if (jsonBody) h["content-type"] = "application/json";
    return h;
  }
  async function api(path, opts = {}) {
    const response = await fetch(path, opts);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || body.message || `HTTP ${response.status}`);
    return body;
  }
  async function copy(text) {
    await navigator.clipboard.writeText(text);
  }

  function paymentLabel(o) {
    if (o.payment?.processor === "oh_bot_local") {
      return `<span class="ops-pay-stub">STUB hold</span> · ${o.payment?.state || "authorized"} (no real charge)`;
    }
    return `${o.payment?.state || "unknown"} · real processor`;
  }

  function nextStep(o) {
    if (o.state === "submitted" && !o.host_dm_sent_at) return "Step 2: DM host on Jelly, then mark notified";
    if (o.state === "submitted") return "Step 3: Accept or decline when host replies";
    if (o.state === "accepted" || o.state === "confirmed") return "Step 4: Mark delivered after answer jelly posts";
    if (o.state === "declined") return "Done — DM asker with refund text if you haven't";
    return "";
  }

  function card(o) {
    const hostDm = o.host_dm_text || o.host_notification?.text || "";
    const askerDm = o.asker_dm_text || o.asker_notification?.text || "";
    const dmSent = o.host_dm_sent_at ? ` · host notified ${new Date(o.host_dm_sent_at).toLocaleString()}` : "";
    const step = nextStep(o);
    return `<article class="ops-card" data-id="${o.id}">
      <p class="ops-step-num">${step}</p>
      <h3><span class="ops-badge is-${o.state}">${o.state}</span> ${o.kind} · ${money(o.price_cents / 100)} · host @${o.host_username}</h3>
      <p>Asker <strong>@${o.asker_username}</strong> · <span class="ops-kv">${o.id}</span>${dmSent}</p>
      <p>${paymentLabel(o)}</p>
      <p>${escapeHtml(o.question)}</p>
      <label>1. Host DM — send as @officehours on Jelly</label>
      <pre class="ops-meta">${escapeHtml(hostDm)}</pre>
      ${askerDm ? `<label>2. Asker DM — after decline</label><pre class="ops-meta">${escapeHtml(askerDm)}</pre>` : ""}
      <div class="ops-actions">
        <button class="btn btn-sm" type="button" data-act="copy-host">Copy host DM</button>
        <button class="btn btn-sm btn-ghost" type="button" data-act="mark-dm-sent">Mark host notified</button>
        ${o.kind === "jelly" && o.state === "submitted" ? `
          <button class="btn btn-sm" type="button" data-act="accept">Host accepted</button>
          <button class="btn btn-sm btn-ghost" type="button" data-act="decline">Host declined · refund</button>` : ""}
        ${(o.state === "accepted" || o.state === "confirmed") ? `
          <button class="btn btn-sm" type="button" data-act="deliver">Mark delivered</button>` : ""}
        ${askerDm ? `<button class="btn btn-sm btn-ghost" type="button" data-act="copy-asker">Copy asker DM</button>` : ""}
      </div>
    </article>`;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function loadApiPreview() {
    try {
      const spec = await fetch("/api/integrations").then((r) => r.json());
      $("#apiPreview").textContent = JSON.stringify(spec, null, 2);
      if (spec.base_url) $("#apiSpecLink").href = `${spec.base_url}/api/integrations`;
    } catch (_) {
      $("#apiPreview").textContent = "Could not load /api/integrations";
    }
  }

  async function load() {
    const status = $("#inboxStatus");
    status.textContent = "";
    try {
      const data = await api("/api/ops/orders?status=open", { headers: headers() });
      $("#botLabel").textContent = `Service account @${data.bot || "officehours"} · open requests: ${(data.orders || []).length}`;
      const list = $("#list");
      list.innerHTML = (data.orders || []).map(card).join("");
      $("#empty").hidden = (data.orders || []).length > 0;
      $("#login").hidden = true;
      $("#inbox").hidden = false;
      loadApiPreview();
    } catch (e) {
      status.textContent = e.message;
      if (e.message === "unauthorized" || e.message === "ops_disabled") {
        sessionStorage.removeItem(KEY);
        $("#login").hidden = false;
        $("#inbox").hidden = true;
      }
    }
  }

  $("#tokenForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = e.target.token.value.trim();
    setToken(t);
    $("#loginStatus").textContent = "";
    await load();
  });
  $("#refresh").addEventListener("click", () => load());

  $("#list").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    const cardEl = e.target.closest("[data-id]");
    if (!btn || !cardEl) return;
    const id = cardEl.dataset.id;
    const act = btn.dataset.act;
    const status = $("#inboxStatus");
    status.textContent = "";
    try {
      if (act === "copy-host") {
        const text = cardEl.querySelector("pre.ops-meta")?.textContent || "";
        await copy(text);
        status.textContent = "Host DM copied.";
        return;
      }
      if (act === "copy-asker") {
        const blocks = cardEl.querySelectorAll("pre.ops-meta");
        await copy(blocks[1]?.textContent || "");
        status.textContent = "Asker DM copied.";
        return;
      }
      let reason;
      if (act === "decline") {
        reason = window.prompt("Optional reason for the asker", "") || undefined;
      }
      const path = `/api/ops/orders/${encodeURIComponent(id)}/${act}`;
      await api(path, {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify(reason !== undefined ? { reason } : {}),
      });
      status.textContent = "Updated.";
      await load();
    } catch (err) {
      status.textContent = err.message;
    }
  });

  if (token()) load();
})();
