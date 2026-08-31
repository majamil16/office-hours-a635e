# Office Hours

Live site: https://office-hours-a635e.genie.jellyjelly.com

Built with [Genie](https://jellyjelly.com).

## Run locally

```sh
npm start
```

Open `http://127.0.0.1:4173`. The server serves the site and exposes the checkout API. Orders are persisted in `.data/orders.json` (ignored by git).

Copy [`.env.example`](.env.example). For the operator inbox, set `OPS_TOKEN` and open `/ops`.

### Operator token (`OPS_TOKEN`)

`OPS_TOKEN` is a random secret that gates `/ops` and `/api/ops/*`. It is **not** tied to Jelly or GitHub — generate it yourself:

```sh
openssl rand -hex 24
```

Use the output as `OPS_TOKEN` in `.env` locally or in Railway:

```sh
railway variable set OPS_TOKEN="$(openssl rand -hex 24)" --service web
```

On `/ops`, paste the token once; the browser stores it in `sessionStorage` and sends `Authorization: Bearer <token>` on ops API calls. **Rotate** by generating a new value, updating Railway, and unlocking `/ops` again. Do not commit the token or paste it in public channels.

## POC flow (OH bot as service account)

`@officehours` (or `JELLY_BOT_USERNAME`) is a **service account** — payment + messaging identity, not a host profile.

**Messaging today:** askers come in on the web site; an **operator** (you) federates requests out by DMing hosts from the OH Jelly account via `/ops`. Automated Jelly DMs are not wired yet.

**Payments today:** same POC level — **no real money moves**. Checkout records a hold as if the asker paid the OH bot; capture/refund are bookkeeping only until pay-to-bot is implemented ([#18](https://github.com/majamil16/office-hours-a635e/issues/18)).

1. Asker uses the web UI to request a jelly or book a live slot (includes their Jelly username).
2. Checkout records payment to the OH bot (`processor: oh_bot_local`, `payment.state: authorized`). **No wallet charge yet.**
3. Intake is recorded; notify modes: `dry-run` (default), `webhook`, or `http`.
4. An operator opens `/ops`, copies the host DM, sends it from the OH Jelly account, then accept / decline / deliver.
5. If the host declines, payment is marked `refunded` in our store (stub). If delivered, marked `captured` (stub). Operator may need to handle any real refund manually until automated pay-to-bot exists.

Full asker/host self-serve dashboards and real escrow are future work with Jelly ([#4](https://github.com/majamil16/office-hours-a635e/issues/4)–[#5](https://github.com/majamil16/office-hours-a635e/issues/5), [#18](https://github.com/majamil16/office-hours-a635e/issues/18)).

### Payments roadmap

| Stage | What happens | Status |
| --- | --- | --- |
| **POC (now)** | `oh_bot_local` — authorized → captured/refunded in `.data/orders.json` only | Shipped |
| **Next** | Real pay-to `@officehours` on Jelly (tip / wallet / SOL transfer); decline triggers real refund | [#18](https://github.com/majamil16/office-hours-a635e/issues/18) |
| **Later** | Escrow, platform fee, host payout, Stripe Connect or Jelly-native holds | [#5](https://github.com/majamil16/office-hours-a635e/issues/5) |

Until [#18](https://github.com/majamil16/office-hours-a635e/issues/18) lands, treat checkout as **intake + state tracking**, not a payment processor. Do not tell users money has actually moved unless you collected it outside this app.

## What users see vs what you run

| | Public site (`/`) | Operator console (`/ops`) |
| --- | --- | --- |
| **Audience** | Askers booking hosts | You (operator) + Jelly team |
| **Experience** | Normal checkout: hold payment, request sent, hear back on Jelly | Step-by-step playbook, copy-paste DMs, payment stub warnings |
| **Backend exposed?** | No — no bots, tokens, or dry-run | Yes — full order state, integration API |

The public copy intentionally hides operator federation. `/ops` explains the real flow.

### Integration API (Jelly team)

**Spec (no auth):** `GET /api/integrations` — lists endpoints, webhook events, auth requirements.

**Read/write orders (auth):** `Authorization: Bearer <JELLY_INTEGRATION_TOKEN>` or `OPS_TOKEN` if integration token is unset.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/v1/orders?status=open\|all&limit=50` | List orders |
| `GET` | `/api/v1/orders/:id` | Single order + DM text fields |
| `POST` | `/api/v1/orders/:id/accept` | Jelly accept |
| `POST` | `/api/v1/orders/:id/decline` | Jelly decline + refund stub |
| `POST` | `/api/v1/orders/:id/deliver` | Capture stub + delivered |
| `POST` | `/api/v1/orders/:id/mark-host-notified` | Host DM sent on Jelly |

**Outbound webhooks:** set `JELLY_NOTIFY_MODE=webhook` and `JELLY_NOTIFY_WEBHOOK_URL` to receive `office_hours.intake` on each checkout.

Give Jelly a dedicated `JELLY_INTEGRATION_TOKEN` (same generation as `OPS_TOKEN`) so you can rotate ops access independently.

### Public + ops API

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/checkout` | Requires `asker_username`, `host_username`, `question`, `price_cents`, `kind` |
| `POST` | `/api/orders/:id/accept` | Jelly: `submitted` → `accepted` |
| `POST` | `/api/orders/:id/decline` | Jelly: `submitted` → `declined`, payment `refunded` |
| `POST` | `/api/orders/:id/deliver` | Capture + delivered |
| `GET` | `/api/ops/orders` | Bearer `OPS_TOKEN` |
| `POST` | `/api/ops/orders/:id/{mark-dm-sent\|accept\|decline\|deliver}` | Bearer `OPS_TOKEN` |

### Notify modes

| Mode | Behavior |
| --- | --- |
| `dry-run` | Store `host_notification` on the order (safe default) |
| `webhook` | `POST` JSON to `JELLY_NOTIFY_WEBHOOK_URL` (Slack/email bridge) |
| `http` | `POST` to `JELLY_DM_API_URL` with `Authorization: Token $JELLY_BOT_TOKEN` |

#### Webhook payload (`office_hours.intake`)

```json
{
  "type": "office_hours.intake",
  "bot_username": "officehours",
  "host": { "user_id": "...", "username": "maja" },
  "order": {
    "id": "jreq_…",
    "kind": "jelly",
    "asker_username": "alice",
    "host_username": "maja",
    "price_cents": 3500,
    "currency": "USD",
    "question": "…",
    "slot_start": null
  },
  "text": "Office Hours request (jelly)\n…"
}
```

Point `JELLY_NOTIFY_WEBHOOK_URL` at Slack Incoming Webhooks, email workers, or [webhook.site](https://webhook.site) while testing. Jelly’s public API documents content search only ([firehose](https://jellyjelly.com/firehose)) — no published DM endpoint yet.
