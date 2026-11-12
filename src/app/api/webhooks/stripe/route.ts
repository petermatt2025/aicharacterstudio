import { NextResponse, type NextRequest } from "next/server";
import { handleStripeEvent, verifyWebhook } from "@/server/billing";
import { errorResponse } from "@/server/http";
import { raiseAlert } from "@/server/alerts";

export const runtime = "nodejs";

/** Signature-verified, idempotent. Returns 500 on processing failure so Stripe retries. */
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const event = verifyWebhook(raw, req.headers.get("stripe-signature"));
    const result = await handleStripeEvent(event, raw);
    return NextResponse.json({ received: true, result });
  } catch (e) {
    const res = errorResponse(e);
    // Signature failures are usually probes; processing failures mean paid customers may be missing credits.
    if (res.status >= 500) void raiseAlert("stripe_webhook", "Stripe payment event failed to process", `A Stripe webhook could not be processed (${(e as Error)?.message?.slice(0, 200) ?? "error"}). Stripe will retry automatically; check the worker/web logs if this repeats.`);
    return res;
  }
}
