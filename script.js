(function () {
  const D = window.OH;
  const $ = (s) => document.querySelector(s);
  const money = (n) => "$" + Math.round(n).toLocaleString("en-US");

  /* ---------- modes ---------- */
  $("#modeGrid").innerHTML = D.modes.map((m) => `
    <article class="card mode" style="--tint:${m.tint}">
      <span class="tag">${m.tag}</span>
      <h3>${m.title}</h3>
      <p>${m.blurb}</p>
      <ul>${m.points.map((p) => `<li>${p}</li>`).join("")}</ul>
      <p class="price-hint">${m.priceHint}</p>
    </article>`).join("");

  /* ---------- flows (real tabs) ---------- */
  const steps = $("#steps");
  const tabs = [...document.querySelectorAll(".tab")];

  function renderSteps(which) {
    steps.innerHTML = D.flows[which].map((s, i) => `
      <li style="animation-delay:${i * 35}ms"><h4>${s.h}</h4><p>${s.p}</p></li>`).join("");
  }

  function selectTab(tab, focus) {
    tabs.forEach((t) => {
      const on = t === tab;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
    steps.setAttribute("aria-labelledby", tab.id);
    renderSteps(tab.dataset.flow);
    if (focus) tab.focus();
  }

  tabs.forEach((t, i) => {
    t.addEventListener("click", () => selectTab(t, false));
    t.addEventListener("keydown", (e) => {
      const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      selectTab(tabs[(i + dir + tabs.length) % tabs.length], true);
    });
  });
  renderSteps("host");

  /* ---------- profile ---------- */
  $("#topicRow").innerHTML = D.topics
    .map((t) => `<span class="topic ${t.cls}">${t.label}</span>`).join("");
  $("#anno").innerHTML = D.anno.map((a) => `
    <li><strong>${a.t}</strong><span>${a.d}</span></li>`).join("");

  /* ---------- fees, policies, roadmap ---------- */
  $("#feeGrid").innerHTML = D.fees
    .map((f) => `<div class="fee"><h4>${f.h}</h4><p>${f.p}</p></div>`).join("");

  $("#policyGrid").innerHTML = D.policies.map((p) => `
    <div class="policy"><span class="pill ${p.pill}">policy</span><h3>${p.h}</h3><p>${p.p}</p></div>`).join("");

  $("#road").innerHTML = D.roadmap.map((r) => `
    <div class="phase"><span class="pill ${r.pill}">${r.label}</span><h3>${r.title}</h3>
      <ul>${r.items.map((i) => `<li>${i}</li>`).join("")}</ul></div>`).join("");

  /* ---------- spec accordion ---------- */
  $("#specList").innerHTML = D.specs.map((s, i) => {
    const open = i === 0;
    return `
    <section class="spec${open ? " open" : ""}">
      <h3 class="spec-h">
        <button class="spec-head" aria-expanded="${open}" aria-controls="spec-body-${i}">
          <span class="spec-num">${String(i + 1).padStart(2, "0")}</span>
          <span class="spec-title">${s.title}</span>
          <span class="chev" aria-hidden="true"></span>
        </button>
      </h3>
      <div class="spec-body" id="spec-body-${i}">
        <div class="spec-inner">
          ${s.body ? `<p>${s.body}</p>` : ""}
          ${s.list ? `<ul>${s.list.map((l) => `<li>${l}</li>`).join("")}</ul>` : ""}
          ${s.code ? `<div class="mono-block" tabindex="0" role="region" aria-label="${s.title} schema">${s.code.replace(/</g, "&lt;")}</div>` : ""}
        </div>
      </div>
    </section>`;
  }).join("");

  document.querySelectorAll(".spec-head").forEach((h) => {
    h.addEventListener("click", () => {
      const sec = h.closest(".spec");
      const open = sec.classList.toggle("open");
      h.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });

  /* ---------- calculator ---------- */
  const inputs = ["inLive", "inLiveQty", "inJelly", "inJellyQty"].map((id) => document.getElementById(id));
  function calc() {
    const [live, liveQty, jelly, jellyQty] = inputs.map((i) => +i.value);
    $("#outLive").textContent = money(live);
    $("#outLiveQty").textContent = liveQty;
    $("#outJelly").textContent = money(jelly);
    $("#outJellyQty").textContent = jellyQty;

    const weekly = live * liveQty + jelly * jellyQty;
    const gross = weekly * 4.33;
    const txns = (liveQty + jellyQty) * 4.33;
    const net = Math.max(0, gross * 0.9 - (gross * 0.029 + txns * 0.3));
    $("#outGross").textContent = money(gross);
    $("#outNet").textContent = money(net);
    const hrs = (liveQty * 30) / 60;
    $("#outHours").textContent = `\u2248 ${hrs % 1 ? hrs.toFixed(1) : hrs} hrs of live time + ${jellyQty} jellies a week`;
  }
  inputs.forEach((i) => i.addEventListener("input", calc));
  calc();

  /* ---------- shared modal ---------- */
  const modal = $("#modal");
  const card = modal.querySelector(".modal-card");
  let lastFocus = null;

  function openModal(html) {
    lastFocus = document.activeElement;
    $("#modalBody").innerHTML = html;
    modal.hidden = false;
    document.body.classList.add("is-locked");
    $("#modalX").focus();
  }

  function closeModal() {
    if (modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove("is-locked");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* keep tab focus inside the dialog */
  modal.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const f = [...card.querySelectorAll('button,[href],iframe,input,[tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  $("#modalX").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  /* shared with firehose.js */
  window.OHModal = { open: openModal, close: closeModal };

  /* ---------- checkout ---------- */
  function checkout(kind, host, price, title) {
    const isLive = kind === "live";
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000);
    future.setMinutes(Math.ceil(future.getMinutes() / 15) * 15, 0, 0);
    const localSlot = new Date(future.getTime() - future.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    openModal(`
      <h3 id="modalTitle">${title || (isLive ? "Book a live 1:1" : "Request a jelly")}</h3>
      <p class="modal-sub">${host ? `with @${host} · ` : ""}${money(price)} ${isLive ? "· 30 min" : "· per question"} · paid to the Office Hours bot</p>
      <form class="checkout-form" data-kind="${kind}" data-host="${host || "maja"}" data-price="${price}">
        <label>Your Jelly username<input name="asker_username" required autocomplete="username" placeholder="@you"></label>
        ${isLive ? `<label>Choose a time<input name="slot_start" type="datetime-local" value="${localSlot}" required></label>` : ""}
        <label>${isLive ? "What do you want to get out of it?" : "Your question"}<textarea name="question" maxlength="600" rows="4" required placeholder="Be specific — context gets a better answer."></textarea><small>Up to 600 characters. The OH bot messages @${host || "the host"} on Jelly with these details.</small></label>
        <button class="btn btn-block" type="submit">${isLive ? "Pay OH bot and book " : "Pay OH bot and request "}${money(price)}</button>
        <p class="form-status" role="status" aria-live="polite"></p>
      </form>`);
    const form = document.querySelector(".checkout-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const button = form.querySelector("button");
      const status = form.querySelector(".form-status");
      button.disabled = true; status.textContent = "Taking payment for the Office Hours bot…";
      try {
        const payload = {
          kind: form.dataset.kind,
          host_username: form.dataset.host,
          asker_username: form.asker_username.value,
          price_cents: Number(form.dataset.price) * 100,
          question: form.question.value,
        };
        if (isLive) payload.slot_start = form.slot_start.value;
        const response = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) }, body: JSON.stringify(payload) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Checkout failed");
        const o = result.order;
        const n = o.host_notification || {};
        const notifyLine = n.status === "failed"
          ? `NOTIFY   failed · ${n.error || "unknown error"}`
          : `NOTIFY   ${n.status || "ok"} · ${n.channel || "dry-run"} → @${o.host_username}`;
        $("#modalBody").innerHTML = `<h3 id="modalTitle">${isLive ? "Booking sent" : "Request sent"}</h3><p class="modal-sub">Paid to the Office Hours bot. ${n.status === "failed" ? "Host notify failed — check server logs." : "The bot messaged the host on Jelly (or recorded a dry-run)."}</p><div class="receipt" tabindex="0">${o.id}\nASKER    @${o.asker_username}\nHOST     @${o.host_username}\nAMOUNT   ${money(o.price_cents / 100)}\nSTATE    ${o.state}\nPAYMENT  ${o.payment.state} · @${o.payment.paid_to}\n${notifyLine}</div><p class="modal-note">Hosts reply on Jelly. Delivery is confirmed back in Office Hours when the answer jelly is posted.</p>`;
      } catch (error) { button.disabled = false; status.textContent = error.message; }
    });
  }
  window.OHCheckout = { open: checkout };

  /* ---------- demo receipts ---------- */
  document.querySelectorAll("[data-demo]").forEach((b) => {
    b.addEventListener("click", () => {
      const d = D.demos[b.dataset.demo];
      checkout(b.dataset.demo, "maja", b.dataset.demo === "live" ? 120 : 35, d.title);
    });
  });
})();
