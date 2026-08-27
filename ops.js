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

  function card(o) {
    const hostDm = o.host_dm_text || o.host_notification?.text || "";
    const askerDm = o.asker_dm_text || o.asker_notification?.text || "";
    const dmSent = o.host_dm_sent_at ? ` · host DM marked ${o.host_dm_sent_at}` : "";
    return `<article class="ops-card" data-id="${o.id}">
      <h2><span class="ops-badge is-${o.state}">${o.state}</span> ${o.kind} · ${money(o.price_cents / 100)} · @${o.host_username}</h2>
      <p>Asker <strong>@${o.asker_username}</strong> · ${o.id}${dmSent}</p>
      <p>${escapeHtml(o.question)}</p>
      <label>Host DM (paste as @officehours on Jelly)</label>
      <pre class="ops-meta">${escapeHtml(hostDm)}</pre>
      ${askerDm ? `<label>Asker DM (after decline)</label><pre class="ops-meta">${escapeHtml(askerDm)}</pre>` : ""}
      <div class="ops-actions">
        <button class="btn btn-sm" type="button" data-act="copy-host">Copy host DM</button>
        <button class="btn btn-sm btn-ghost" type="button" data-act="mark-dm-sent">Mark host DM sent</button>
        ${o.kind === "jelly" && o.state === "submitted" ? `
          <button class="btn btn-sm" type="button" data-act="accept">Accept</button>
          <button class="btn btn-sm btn-ghost" type="button" data-act="decline">Decline + refund</button>` : ""}
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

  async function load() {
    const status = $("#inboxStatus");
    status.textContent = "";
    try {
      const data = await api("/api/ops/orders?status=open", { headers: headers() });
      $("#botLabel").textContent = `Bot service account: @${data.bot || "officehours"}`;
      const list = $("#list");
      list.innerHTML = (data.orders || []).map(card).join("");
      $("#empty").hidden = (data.orders || []).length > 0;
      $("#login").hidden = true;
      $("#inbox").hidden = false;
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
        reason = window.prompt("Optional decline reason (shown to asker)", "") || undefined;
      }
      const path = `/api/ops/orders/${encodeURIComponent(id)}/${act}`;
      await api(path, {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify(reason !== undefined ? { reason } : {}),
      });
      status.textContent = `${act} ok.`;
      await load();
    } catch (err) {
      status.textContent = err.message;
    }
  });

  if (token()) load();
})();
