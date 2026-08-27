# Office Hours

Live site: https://office-hours-a635e.genie.jellyjelly.com

Built with [Genie](https://jellyjelly.com).

## Run locally

```sh
npm start
```

Open `http://127.0.0.1:4173`. The server serves the site and exposes the checkout API. Orders are persisted in `.data/orders.json` (ignored by git).

Copy [`.env.example`](.env.example). For the operator inbox, set `OPS_TOKEN` and open `/ops`.

## POC flow (OH bot as service account)

`@officehours` (or `JELLY_BOT_USERNAME`) is a **service account** — payment + messaging identity, not a host profile.

1. Asker uses the web UI to request a jelly or book a live slot (includes their Jelly username).
2. Asker pays the **Office Hours bot** (local stub: `processor: oh_bot_local`).
3. Intake is recorded; notify modes: `dry-run` (default), `webhook`, or `http`.
4. An operator opens `/ops`, copies the host DM, sends it from the OH Jelly account, then accept / decline / deliver.
5. If the host declines, payment is marked `refunded` (bookkeeping until real pay-to-bot) and ops gets asker DM text.

Full asker/host self-serve dashboards are future work with Jelly.

### API

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
