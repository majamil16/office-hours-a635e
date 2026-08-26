/* Office Hours <- JellyJelly firehose
 * Reads public jellies from the firehose and turns them into Office Hours
 * material: who could host, what they'd be asked about, what to charge.
 *
 *   GET https://api.jellyjelly.com/v3/jelly/search?sort_by=date&page_size=50
 *
 * The page tries the firehose live on load. The endpoint currently sends no
 * Access-Control-Allow-Origin header, so a browser on another domain gets
 * blocked; when that happens we fall back to a real snapshot pulled with the
 * same query and say so in the status pill. A server-side call (backend, token)
 * has no such problem, which is how the shipped feature would read it.
 */
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
  const today = new Date().toISOString().slice(0, 10);

  const BASES = [
    "https://jellyjelly.com/api-proxy/v3/jelly/search",
    "https://api.jellyjelly.com/v3/jelly/search",
  ];
  const PAGES = 4;
  const PAGE_SIZE = 50;
  const CACHE_KEY = "oh-firehose-" + today;

  /* ---- pricing heuristic (documented in the spec section) ---- */
  const RATE = {
    startups: 180, business: 160, tech: 150, finance: 170, career: 130,
    "mental-health": 120, health: 120, education: 120, beauty: 110,
    fashion: 110, relationships: 110, fitness: 100, art: 100, music: 100,
    storytelling: 100, food: 95, travel: 95, spirituality: 95, lifestyle: 90,
    home: 90, family: 90, gaming: 90, comedy: 85, misc: 85,
  };
  const suggestLive = (topics, vol) => {
    const base = Math.max(...(topics.length ? topics.map((t) => RATE[t] || 95) : [95]));
    return Math.round((base + Math.min(60, vol * 2)) / 5) * 5;
  };
  const suggestJelly = (live) => Math.max(15, Math.round((live * 0.28) / 5) * 5);

  /* ---- shape a raw /search response list into our model ---- */
  function build(jellies) {
    const topicCount = new Map();
    const byUser = new Map();
    jellies.forEach((j) => {
      (j.topics || []).forEach((t) => topicCount.set(t, (topicCount.get(t) || 0) + 1));
      const p = (j.participants || [])[0];
      if (!p || !p.username) return;
      if (!byUser.has(p.username)) byUser.set(p.username, { p, js: [] });
      byUser.get(p.username).js.push(j);
    });

    const hosts = [];
    [...byUser.values()]
      .sort((a, b) => b.js.length - a.js.length)
      .forEach(({ p, js }) => {
        if (hosts.length >= 6) return;
        const tc = new Map();
        js.forEach((j) => (j.topics || []).forEach((t) => tc.set(t, (tc.get(t) || 0) + 1)));
        const titled = js.filter((j) => j.title && j.summary);
        if (tc.size < 2 || titled.length < 3) return;
        const topics = [...tc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map((e) => e[0]);
        const live = suggestLive(topics, js.length);
        hosts.push({
          username: p.username,
          full_name: (p.full_name || p.username).trim(),
          pfp_url: p.pfp_url,
          badge: p.wobbles_badge_no,
          jelly_count: js.length,
          topics,
          live_price: live,
          jelly_price: suggestJelly(live),
          jellies: titled.slice(0, 3).map((j) => ({
            id: j.id, title: j.title, summary: j.summary,
            thumb: j.thumbnail_url, posted_at: j.posted_at, topics: j.topics || [],
          })),
        });
      });

    const recent = jellies
      .filter((j) => j.title && j.summary && (j.participants || []).length)
      .slice(0, 14)
      .map((j) => ({
        id: j.id, title: j.title, summary: j.summary, thumb: j.thumbnail_url,
        username: j.participants[0].username, pfp_url: j.participants[0].pfp_url,
        posted_at: j.posted_at, topics: j.topics || [],
      }));

    return {
      pulled_at: today,
      window: jellies.length,
      topics: [...topicCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
        .map(([name, count]) => ({ name, count })),
      hosts,
      recent,
    };
  }

  /* ---- live read, with cache + snapshot fallback ---- */
  async function fetchLive() {
    let cached = null;
    try { cached = localStorage.getItem(CACHE_KEY); } catch (e) { /* storage can be disabled */ }
    if (cached) { try { return { model: JSON.parse(cached), source: "live-cached" }; } catch (e) {} }

    for (const base of BASES) {
      try {
        const timeout = (promise, ms) => Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("request timeout")), ms)),
        ]);
        const reqs = Array.from({ length: PAGES }, (_, i) =>
          timeout(fetch(`${base}?sort_by=date&ascending=false&page=${i + 1}&page_size=${PAGE_SIZE}`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))), 8000)
        );
        const pages = await Promise.all(reqs);
        const jellies = pages.flatMap((p) => p.jellies || []);
        if (jellies.length < 20) throw new Error("thin response");
        const model = build(jellies);
        model.total_public_jellies = pages[0].total;
        model.endpoint = base;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(model)); } catch (e) { /* storage can be disabled */ }
        return { model, source: "live" };
      } catch (e) { /* try next base, then fall back */ }
    }
    return { model: FIREHOSE_SNAPSHOT, source: "snapshot" };
  }

  /* ---- render ---- */
  const initials = (n) => n.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "JJ";
  const chip = (t) => `<span class="topic">${esc(t)}</span>`;
  const ago = (iso) => {
    const d = Math.max(0, Math.round((Date.now() - new Date(iso)) / 86400000));
    return d === 0 ? "today" : d === 1 ? "1d ago" : d + "d ago";
  };

  function statusLine(source, m) {
    const total = m.total_public_jellies ? Number(m.total_public_jellies).toLocaleString("en-US") : "33,000+";
    if (source === "snapshot") {
      return `<span class="fh-dot dot-amber"></span><strong>snapshot</strong> \u00b7 ${m.window} jellies pulled ${esc(m.pulled_at)} \u00b7 live read needs a server call`;
    }
    return `<span class="fh-dot dot-live"></span><strong>live</strong> \u00b7 ${m.window} newest of ${total} public jellies${source === "live-cached" ? " \u00b7 cached today" : ""}`;
  }

  function bars(m) {
    const topics = Array.isArray(m.topics) ? m.topics : [];
    const max = topics[0] ? topics[0].count : 1;
    if (!topics.length) return `<li class="fh-empty">No topic data available right now.</li>`;
    return topics.slice(0, 10).map((t, i) => `
      <li class="bar-row">
        <span class="bar-name">${esc(t.name)}</span>
        <span class="bar-track"><span class="bar-fill f${i % 5}" style="width:${Math.max(6, (t.count / max) * 100)}%"></span></span>
        <span class="bar-num">${t.count}</span>
        <span class="bar-rate">${money(RATE[t.name] || 95)} base</span>
      </li>`).join("");
  }

  function hostCards(m) {
    const hosts = Array.isArray(m.hosts) ? m.hosts : [];
    if (!hosts.length) return `<p class="fh-empty">No host drafts are available in this snapshot.</p>`;
    return hosts.map((h) => `
      <article class="card host">
        <div class="host-top">
          ${h.pfp_url ? `<img class="host-pfp" src="${esc(h.pfp_url)}" alt="" loading="lazy">`
                      : `<div class="host-pfp host-pfp-fb">${esc(initials(h.full_name))}</div>`}
          <div class="host-id">
            <h3>${esc(h.full_name)}</h3>
            <p class="handle">@${esc(h.username)}${h.badge ? ` \u00b7 wobble #${h.badge}` : ""}</p>
          </div>
          <span class="host-vol">${h.jelly_count}<span>jellies</span></span>
        </div>
        <p class="pc-label">Firehose says ask about</p>
        <div class="topic-row">${h.topics.map(chip).join("")}</div>
        <div class="host-prices">
          <span><em>Live 1:1</em>${money(h.live_price)}<small>/30 min</small></span>
          <span><em>Jelly answer</em>${money(h.jelly_price)}<small>/question</small></span>
        </div>
        <p class="pc-label">Proof of work <span class="tap-hint">tap to play</span></p>
        <ul class="reel">
          ${h.jellies.map((j) => `
            <li class="reel-item" data-play="${esc(j.id)}" data-title="${esc(j.title)}" data-user="${esc(h.username)}" tabindex="0" role="button">
              ${j.thumb ? `<img src="${esc(j.thumb)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'reel-fb'}))">` : `<div class="reel-fb"></div>`}
              <div class="reel-txt"><strong>${esc(j.title)}</strong><span>${ago(j.posted_at)}</span></div>
              <span class="reel-play">\u25B6</span>
            </li>`).join("")}
        </ul>
        <button class="btn btn-block btn-pink btn-sm2" data-ask="${esc(h.username)}">Request a jelly \u00b7 ${money(h.jelly_price)}</button>
      </article>`).join("");
  }

  function ticker(m) {
    const items = (Array.isArray(m.recent) ? m.recent : []).map((j) => `
      <li class="reel-item" data-play="${esc(j.id)}" data-title="${esc(j.title)}" data-user="${esc(j.username)}" tabindex="0" role="button">
        ${j.thumb ? `<img src="${esc(j.thumb)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
        <div><strong>@${esc(j.username)}</strong><span>${esc(j.title)}</span></div>
      </li>`).join("");
    return items ? items + items : "";
  }

  /* ---- play a real jelly in JellyJelly's own embed player ----
   * /embed?ids=<id>&bg=<hex>&subs=karaoke is framable from any origin
   * (frame-ancestors *), so this part of the firehose is live even when the
   * JSON read is CORS-blocked: the video, captions, and thumbnail all come
   * from JellyJelly at view time.
   */
  const EMBED = "https://jellyjelly.com/embed";
  function embedUrl(ids) {
    return `${EMBED}?ids=${[].concat(ids).map(encodeURIComponent).join(",")}&bg=%230A0A0A&subs=karaoke`;
  }

  const openModal = (html) =>
    window.OHModal ? window.OHModal.open(html) : (($("#modalBody").innerHTML = html), ($("#modal").hidden = false));

  function play(id, title, user) {
    openModal(`
      <h3 id="modalTitle">${title ? esc(title) : "Jelly"}</h3>
      <p class="modal-sub">@${esc(user)} \u00b7 played through JellyJelly's own embed</p>
      <div class="embed-wrap"><iframe class="embed-frame" src="${esc(embedUrl(id))}"
        title="JellyJelly player" allow="autoplay; fullscreen; picture-in-picture"
        allowfullscreen loading="lazy"></iframe></div>
      <div class="receipt" tabindex="0">GET /embed?ids=${esc(id)}&amp;bg=%230A0A0A&amp;subs=karaoke
 jelly_id ${esc(id)} \u00b7 host @${esc(user)} \u00b7 captions from transcript_overlay</div>
      <p class="modal-note">The real jelly, live from JellyJelly. An answer renders in exactly this frame, attached to the paid request.</p>`);
  }

  function bindPlay() {
    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-play]");
      if (el) play(el.dataset.play, el.dataset.title, el.dataset.user);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const el = e.target.closest && e.target.closest("[data-play]");
      if (el) { e.preventDefault(); play(el.dataset.play, el.dataset.title, el.dataset.user); }
    });
  }

  function bindAsk(m) {
    document.querySelectorAll("[data-ask]").forEach((b) => {
      b.addEventListener("click", () => {
        const h = m.hosts.find((x) => x.username === b.dataset.ask);
        if (!h) return;
        if (window.OHCheckout) return window.OHCheckout.open("jelly", h.username, h.jelly_price, `Request a jelly from @${h.username}`);
        openModal(`
          <h3 id="modalTitle">Request a jelly from @${esc(h.username)}</h3>
          <ol>
            <li>Question capped at 600 characters, one topic tag from ${h.topics.map((t) => esc(t)).join(", ")}.</li>
            <li>${money(h.jelly_price)} authorized now, captured when the answer jelly posts.</li>
            <li>Host has 3 days to answer or the hold is released automatically.</li>
            <li>Answer lands as a jelly, linked to the request, visible to you first.</li>
          </ol>
          <div class="receipt" tabindex="0">jelly_request \u00b7 host @${esc(h.username)} \u00b7 ${money(h.jelly_price)} held
 price_snapshot ${money(h.jelly_price)} \u00b7 sla 3d \u00b7 status awaiting_answer
 topics ${h.topics.join(" / ")} \u00b7 seeded from ${h.jelly_count} public jellies</div>
          <p class="modal-note">Illustrative. Real requests need auth, payments, and a queue.</p>`);
      });
    });
  }

  async function init() {
    const { model, source } = await fetchLive();
    model.topics = Array.isArray(model.topics) ? model.topics : [];
    model.hosts = Array.isArray(model.hosts) ? model.hosts : [];
    model.recent = Array.isArray(model.recent) ? model.recent : [];
    model.hosts = (model.hosts || []).slice(0, 6);
    $("#fhStatus").innerHTML = statusLine(source, model);
    $("#fhBars").innerHTML = bars(model);
    $("#fhHosts").innerHTML = hostCards(model);
    $("#fhTicker").innerHTML = ticker(model);
    if (model.total_public_jellies) {
      $("#heroFh").textContent = Number(model.total_public_jellies).toLocaleString("en-US");
    }
    $("#fhReq").textContent =
      (model.endpoint || "https://api.jellyjelly.com/v3/jelly/search") +
      "?sort_by=date&ascending=false&page=1&page_size=50";
    bindAsk(model);
    bindPlay();

    const strip = $("#fhFeatured");
    if (strip && model.recent.length) {
      strip.innerHTML = `<iframe class="embed-frame embed-frame-strip" src="${esc(
        embedUrl(model.recent.slice(0, 6).map((j) => j.id))
      )}" title="JellyJelly firehose player" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
