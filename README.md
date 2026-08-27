# Office Hours

Live site: https://office-hours-a635e.genie.jellyjelly.com

Built with [Genie](https://jellyjelly.com).

## Run locally

```sh
npm start
```

Open `http://127.0.0.1:4173`. The server serves the site and exposes the checkout API. Orders are persisted in `.data/orders.json` (ignored by git).

## Flow (OH bot intake)

1. Asker uses the web UI to request a jelly or book a live slot.
2. Asker pays the **Office Hours bot** (local stub today: `processor: oh_bot_local`).
3. The bot resolves the host on Jelly (`GET /v3/jelly/search?username=…`) and sends them the intake details (question, asker handle, amount, order id).

`POST /api/checkout` requires `asker_username`, `host_username`, `question`, `price_cents`, and `kind` (`jelly` | `live`).  
`POST /api/orders/:id/accept` and `POST /api/orders/:id/deliver` still advance jelly request state.

### Notify modes

Copy [`.env.example`](.env.example). Default `JELLY_NOTIFY_MODE=dry-run` records the outbound message on the order without calling Jelly.

| Mode | Behavior |
| --- | --- |
| `dry-run` | Store `host_notification` on the order (safe default) |
| `webhook` | `POST` the payload to `JELLY_NOTIFY_WEBHOOK_URL` |
| `http` | `POST` to `JELLY_DM_API_URL` with `Authorization: Token $JELLY_BOT_TOKEN` |

Jelly’s public API documents content search only ([firehose](https://jellyjelly.com/firehose)) — there is no published DM endpoint yet. Point `http` / `webhook` at whatever bridge the OH bot account can use once messaging access exists.
