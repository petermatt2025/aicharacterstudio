import { NextResponse, type NextRequest } from "next/server";
import { handleStripeEvent, verifyWebhook } from "@/server/billing";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";

/** Signature-verified, idempotent. Returns 500 on processing failure so Stripe retries. */
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const event = verifyWebhook(raw, req.headers.get("stripe-signature"));
    const result = await handleStripeEvent(event, raw);
    return NextResponse.json({ received: true, result });
  } catch (e) {
    return errorResponse(e);
  }
}
