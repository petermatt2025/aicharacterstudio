// Local stand-in for `stripe listen --forward-to`: polls Stripe TEST-mode events and forwards them,
// signed with STRIPE_WEBHOOK_SECRET, to the app's webhook route. For local/sandbox development only.
// Usage: set -a; . ./.env.local; set +a; npm run -s stripe:relay
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
const secret = process.env.STRIPE_WEBHOOK_SECRET;
const target = process.env.STRIPE_RELAY_TARGET ?? "http://localhost:3000/api/webhooks/stripe";
if (!key || !secret) throw new Error("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required");

const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
if ((await stripe.balance.retrieve()).livemode) throw new Error("Refusing to relay LIVE events");

let since = Math.floor(Date.now() / 1000) - 60;
const seen = new Set();
console.log(`[stripe-relay] forwarding test-mode events to ${target}`);

for (;;) {
  try {
    const events = (await stripe.events.list({ created: { gte: since }, limit: 100 })).data.sort((a, b) => a.created - b.created);
    for (const ev of events) {
      if (seen.has(ev.id)) continue;
      const payload = JSON.stringify(ev);
      const sig = Stripe.webhooks.generateTestHeaderString({ payload, secret });
      const r = await fetch(target, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": sig }, body: payload });
      if (r.ok) {
        seen.add(ev.id);
        console.log(`[stripe-relay] ${ev.type} → ${(await r.json()).result}`);
      } else {
        console.log(`[stripe-relay] ${ev.type} → HTTP ${r.status} (will retry)`);
      }
      since = Math.max(since, ev.created - 5);
    }
  } catch (e) {
    console.log(`[stripe-relay] ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
