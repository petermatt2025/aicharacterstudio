import { route } from "@/server/http";
import { listPlans } from "@/server/entitlements";
import { q } from "@/server/db";

export const GET = route(async () => {
  const plans = await listPlans();
  const packs = await q(`SELECT key, display_name, price_cents, currency, credits FROM topup_packs WHERE active ORDER BY price_cents`);
  const rules = await q(`SELECT key, label, credits, per_outputs FROM credit_rules ORDER BY credits`);
  return {
    plans: plans.map((p) => ({ key: p.key, name: p.display_name, description: p.description, monthlyCents: p.monthly_price_cents, annualCents: p.annual_price_cents, monthlyCredits: p.monthly_credits, purchasable: !!(p.stripe_price_monthly || p.stripe_price_annual) })),
    packs, rules,
  };
});
