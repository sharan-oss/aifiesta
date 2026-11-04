# Cashfree webhook -> Google Sheet

```
Cashfree  --POST-->  /api/cashfree-webhook?t=TOKEN  (Vercel)  --POST-->  Apps Script web app  -->  Google Sheet
          <--200/500--                                         <--ok:true/false--
```

The Vercel function answers `200` only after the Sheet confirms the write, otherwise `500`,
so Cashfree retries (default: 2, 10, 30 min). Apps Script de-duplicates, so retries are safe.
Apps Script can't set a status code, which is why it never faces Cashfree directly.

`Code.gs` is the source of truth. Apps Script has no git, so after editing it here, paste it into the
Apps Script editor and redeploy.

## One-time setup

1. Create a Google Sheet (any name). Copy its id (the long string in the URL).
2. In the Sheet: Extensions > Apps Script. Replace `Code.gs` with this folder's `Code.gs`.
3. Project Settings > Script properties, add:
   - `SHEET_ID` = the sheet id
   - `SHARED_SECRET` = a long random string (e.g. `openssl rand -hex 24`)
4. Deploy > New deployment > type **Web app**. Execute as **Me**, access **Anyone**. Copy the `/exec` URL.
   After later code changes use Deploy > Manage deployments > edit > New version (the URL stays the same).
5. Vercel > Project > Settings > Environment Variables (Production):
   - `APPS_SCRIPT_URL` = the `/exec` URL
   - `APPS_SCRIPT_SECRET` = the same value as `SHARED_SECRET`
   - `CASHFREE_WEBHOOK_TOKEN` = another long random string
   Redeploy so the function sees them.
6. Give the client this URL to add in Cashfree (Payment Gateway > Developers > Webhooks):

   `https://<production-domain>/api/cashfree-webhook?t=<CASHFREE_WEBHOOK_TOKEN>`

   Events to enable:
   - `payment_form_order_webhook` (Payment Forms): paid orders
   - Payment success, Payment failed, Payment user dropped (PG): these carry `order_tags` and show
     who dropped off at payment

## Tabs the script creates

| Tab | Contents |
|---|---|
| `Payments_Raw` | every delivery exactly as received (audit, includes duplicates and non-landing-page events) |
| `Payments` | one row per `order_id` + `status` (`SUCCESS` is stored as `PAID`), parsed, with the tag columns |

The form webhook and the PG success webhook report the same payment, so they merge into one row; the
later one only fills cells the earlier one left blank (e.g. the tags).

PG webhooks are account-wide, so they include app checkout payments too. Those are kept in
`Payments_Raw` only; `Payments` gets an order only if it has our tags (`lead_id`/`lp_name`) or a
payment-form order id (`CFPay_…`).

## Landing-page params (order_tags)

The Cashfree form turns URL params that don't match a form field into `order_tags` on the order,
**max 10** (undocumented; seen in Cashfree's form JS, build `20261030183237`). The landing pages
append exactly these 10, which become the tag columns:

`lead_id, lp_name, utm_source, utm_medium, utm_campaign, utm_content, utm_term, ad_id, gclid, fbclid`

Anything else (e.g. `adset_content`, `device`) stays in our own Leads log, joined by `lead_id`.
If Cashfree changes this behaviour, the tag columns go blank; `lead_id` + our Leads log is the backup.

## Known limits

- No Cashfree API keys, so `x-webhook-signature` is not verified. The secret token in the URL is the only gate; treat
  it like a password and rotate it (change the Vercel env var and the URL in Cashfree) if it leaks.
- If every retry fails, the raw body is in the Vercel function logs (search `cashfree-webhook failed`).
- Cashfree's docs conflict on whether form webhooks fire for failed payments, not just paid ones.
  The PG failed / user-dropped events cover that either way.
- Whether the form webhook itself includes `order_tags` is unknown; the PG events do (per their docs).
- Someone who opens the Cashfree form and leaves without pressing Pay creates no order, so no event.

## Tests

`npm test` runs `tests/` (the function, and `Code.gs` in a VM against fake Google services).
