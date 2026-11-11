// Creates (or finds) the Stripe TEST-mode products and prices for plans and top-up packs.
// Idempotent via price lookup_keys. Refuses to run against live mode.
// Usage: STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs
import Stripe from "stripe";

// fetch-based client honours HTTPS_PROXY when NODE_USE_ENV_PROXY=1
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
const bal = await stripe.balance.retrieve();
if (bal.livemode) throw new Error("Refusing to run: this is a LIVE Stripe key");

const ITEMS = [
  { product: "AI Character Studio Creator", key: "acs_creator_monthly", env: "STRIPE_PRICE_CREATOR_MONTHLY", amount: 1900, interval: "month" },
  { product: "AI Character Studio Creator", key: "acs_creator_annual", env: "STRIPE_PRICE_CREATOR_ANNUAL", amount: 19000, interval: "year" },
  { product: "AI Character Studio Pro", key: "acs_pro_monthly", env: "STRIPE_PRICE_PRO_MONTHLY", amount: 4900, interval: "month" },
  { product: "AI Character Studio Pro", key: "acs_pro_annual", env: "STRIPE_PRICE_PRO_ANNUAL", amount: 49000, interval: "year" },
  { product: "AI Character Studio Agency", key: "acs_agency_monthly", env: "STRIPE_PRICE_AGENCY_MONTHLY", amount: 9900, interval: "month" },
  { product: "AI Character Studio Agency", key: "acs_agency_annual", env: "STRIPE_PRICE_AGENCY_ANNUAL", amount: 99000, interval: "year" },
  { product: "100 credits (top-up)", key: "acs_topup_small", env: "STRIPE_PRICE_TOPUP_SMALL", amount: 1200 },
  { product: "500 credits (top-up)", key: "acs_topup_growth", env: "STRIPE_PRICE_TOPUP_GROWTH", amount: 4900 },
  { product: "1,200 credits (top-up)", key: "acs_topup_studio", env: "STRIPE_PRICE_TOPUP_STUDIO", amount: 9900 },
];

const existing = await stripe.prices.list({ lookup_keys: ITEMS.map((i) => i.key), limit: 100 });
const byKey = new Map(existing.data.map((p) => [p.lookup_key, p]));
const products = new Map();
const out = [];
for (const it of ITEMS) {
  let price = byKey.get(it.key);
  if (!price) {
    let productId = products.get(it.product);
    if (!productId) {
      const found = await stripe.products.search({ query: `name:'${it.product}' AND active:'true'` });
      productId = found.data[0]?.id ?? (await stripe.products.create({ name: it.product, metadata: { app: "ai-character-studio" } })).id;
      products.set(it.product, productId);
    }
    price = await stripe.prices.create({
      product: productId, currency: "usd", unit_amount: it.amount, lookup_key: it.key,
      ...(it.interval ? { recurring: { interval: it.interval } } : {}),
      tax_behavior: "exclusive",
      metadata: { app: "ai-character-studio" },
    });
  }
  out.push(`${it.env}=${price.id}`);
}
console.log(out.join("\n"));
