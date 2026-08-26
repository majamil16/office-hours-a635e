# Office Hours

Live site: https://office-hours-a635e.genie.jellyjelly.com

Built with [Genie](https://jellyjelly.com).

## Run locally

```sh
npm start
```

Open `http://127.0.0.1:4173`. The server serves the site and exposes the local checkout API. Orders are persisted in `.data/orders.json` (ignored by git).

`POST /api/checkout` creates a booking or jelly request. `POST /api/orders/:id/accept` and `POST /api/orders/:id/deliver` advance a jelly request and capture its payment.

### Jelly wallet payments

Jelly's public documentation exposes content APIs and describes wallet-based SOL/JELLY event payments, but does not expose a public hosted checkout API. This project therefore uses a wallet-transfer adapter. Copy [.env.example](/workspace/.env.example), set `JELLY_PAYMENT_MODE=jelly`, provide `JELLY_PAYMENT_WALLET_ADDRESS`, `HELIUS_RPC_URL`, and a `JELLY_PAYMENT_AMOUNT_LAMPORTS`, then restart the server. Checkout creates a payment intent; the UI asks the payer to send SOL on Solana and paste the transaction signature. The backend verifies the finalized transaction recipient and amount through the configured RPC before activating the order.

Without those credentials, `JELLY_PAYMENT_MODE=local` keeps the deterministic development processor enabled.

### Provider accounts

The Provider Console supports local account creation/login and one active payment connection per provider. Accounts and connections are stored in `.data/state.json`; sessions are HttpOnly cookies held in server memory. Checkout matches `host_username` to the provider account and routes to its active connection, falling back to local mode only when no connection is configured.

This is a foundation, not production identity infrastructure: add email verification, password reset, CSRF protection, a durable session store, encryption/key management for connection credentials, rate limiting, and a real database before exposing it publicly. The Jelly connection stores a wallet address and RPC URL, not a Jelly API token.
