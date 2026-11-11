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

1. Create a Google Sheet (any name).
2. In the Sheet: Extensions > Apps Script (the script must be opened from the Sheet, so it's bound to it).
   Replace `Code.gs` with this folder's `Code.gs`.
3. Project Settings > Script properties, add `SHARED_SECRET` = a long random string (e.g. `openssl rand -hex 24`).
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
| `Payments_Raw` | every delivery for our landing-page forms exactly as received (audit, includes duplicates and subscription events) |
| `Payments` | one row per `order_id` + `status` (`SUCCESS` is stored as `PAID`), parsed, with the tag columns |

The form webhook and the PG success webhook report the same payment, so they merge into one row; the
later one only fills cells the earlier one left blank (e.g. the tags).

Cashfree sends every form and payment on the client's account. Only our landing-page forms are kept
(`LP_NAMES` in `Code.gs`, mirrored by `LP_FORM_IDS` in `lib/apps-script.js`: the current `*-offer` forms plus the
previous `am-ads-yearly-basic-plan`, `am-yearly-basic-plan-ga`, `am-yearly-basic-plan-meta`). Order ids embed only
the first 25 characters of the form id (`am-ads-yearly-basic-plan-offer` -> `CFPay_am-ads-yearly-basic-plan-_…`);
everything else gets a 200 and is not stored anywhere. Their subscription events (autopay auth
success/failed) go to `Payments_Raw` only, because they carry no customer details. Adding a landing page
means adding its form id to `LP_FORMS` and redeploying.

Rows written before this filter existed: run `removeOtherForms()` once from the Apps Script editor.

## Payment details

Each sale also sends a `SUBSCRIPTION_PAYMENT_SUCCESS` (autopay auth) event. It joins the order on
`cf_txn_id` = `transaction_id` and fills `payment_method`, `payment_channel`, `upi_id`, `paid_at`,
`cf_subscription_id`, plus `failed_attempts` / `last_failure` from earlier `SUBSCRIPTION_PAYMENT_FAILED`
events of the same subscription. `lp_name` comes from the form id (`LP_NAMES` in `Code.gs`).

## Attribution (UTMs) — how it actually works

Cashfree keeps the URL params as order tags but **never sends them in any webhook** (verified on
real deliveries and by inspecting the form's submit request). So we record them ourselves:

1. `src/components/Attribution.astro` (every page): on landing, stores the ad params (`utm_*`, `ad_id`,
   `adset_content`, `device`, `gclid`, `gbraid`, `wbraid`, `fbclid`), landing page and referrer in
   localStorage. Latest ad click wins; a plain visit only counts when nothing is stored; 30-day expiry.
2. On `/thank-you` and `/thank-you-ga`, Cashfree's return URL carries `?id=<order_id>`; the script sends
   the stored record with that id (once per order, `sendBeacon`) to `api/attribution.js`.
3. `api/attribution.js` accepts only our three forms' order ids and known fields, then forwards to
   Apps Script with the shared secret.
4. Apps Script appends to the `Attribution` tab (first record per order wins) and copies it into the
   order's `Payments` row, whichever arrives first. `attribution` column: `ad` (ad params present),
   `organic` (landing seen, no ad params), `unknown` (thank-you reached with nothing stored), blank
   (buyer never reached the thank-you page).

Match rate (paid orders with UTMs): `=COUNTIFS(Payments!E:E,"PAID",Payments!AQ:AQ,"ad")/COUNTIF(Payments!E:E,"PAID")`
(`E` = status, `AQ` = attribution).

Gap: buyers who never return to the thank-you page (e.g. pay in a UPI app and close the browser) get
no attribution. If the match rate is low, add a visible prefilled field on the Cashfree forms.

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
- The form webhook does **not** include `order_tags` (checked on 265 real deliveries), and these forms are
  subscription checkouts, so no PG events arrive for them. UTMs need another route back (thank-you page or a
  prefilled form field).
- Someone who opens the Cashfree form and leaves without pressing Pay creates no order, so no event.

## Tests

`npm test` runs `tests/` (the function, and `Code.gs` in a VM against fake Google services).
