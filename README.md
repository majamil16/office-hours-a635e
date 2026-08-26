# Office Hours

Live site: https://office-hours-a635e.genie.jellyjelly.com

Built with [Genie](https://jellyjelly.com).

## Run locally

```sh
npm start
```

Open `http://127.0.0.1:4173`. The server serves the site and exposes the local checkout API. Orders are persisted in `.data/orders.json` (ignored by git).

`POST /api/checkout` creates a held booking or jelly request. `POST /api/orders/:id/accept` and `POST /api/orders/:id/deliver` advance a jelly request and capture its local payment hold. The local processor is intentionally deterministic for development; connect a payment provider before production use.
