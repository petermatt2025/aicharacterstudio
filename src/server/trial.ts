import "server-only";
import { one } from "./db";
import { getSetting } from "./seed";
import { sha256 } from "./crypto";

/**
 * Free-trial protection ("option B"): a small trial on selected tools, cheapest engine, with abuse limits:
 * - one trial per real inbox (canonical email, existing),
 * - no throwaway email services,
 * - at most N trials per network (hashed IP) per 30 days,
 * - a shared daily AI budget for all free accounts together.
 */

// Common disposable / temporary email domains. Extend in Admin → Operations (blocked_email_domains).
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "guerrillamailblock.com", "sharklasers.com", "grr.la",
  "10minutemail.com", "10minutemail.net", "temp-mail.org", "temp-mail.io", "tempmail.com", "tempmailo.com", "tempmail.net", "tempmail.dev",
  "yopmail.com", "yopmail.fr", "yopmail.net", "trashmail.com", "trashmail.de", "getnada.com", "nada.email", "dispostable.com", "maildrop.cc",
  "mintemail.com", "throwawaymail.com", "fakeinbox.com", "emailondeck.com", "mohmal.com", "tempr.email", "discard.email", "mailnesia.com",
  "mytemp.email", "tmpmail.org", "tmpmail.net", "tmail.ws", "moakt.com", "burnermail.io", "1secmail.com", "1secmail.net", "1secmail.org",
  "inboxkitten.com", "mailpoof.com", "emailfake.com", "fakemail.net", "mailcatch.com", "mail.tm", "tempinbox.com", "spambox.us",
  "getairmail.com", "harakirimail.com", "linshiyouxiang.net", "spam4.me", "tempmailaddress.com", "emailtemporanea.net", "crazymailing.com",
  "byom.de", "trbvm.com", "dropmail.me", "10mail.org", "zetmail.com", "vomoto.com", "mailsac.com", "mail7.io", "tempm.com", "minuteinbox.com",
]);

export async function isDisposableEmail(email: string): Promise<boolean> {
  const domain = email.split("@")[1]?.trim().toLowerCase() ?? "";
  if (!domain) return false;
  const extra = await getSetting<string[]>("blocked_email_domains").catch(() => [] as string[]);
  const blocked = (d: string) => DISPOSABLE.has(d) || (Array.isArray(extra) && extra.map((x) => String(x).toLowerCase()).includes(d));
  // Match the domain and its parents (e.g. "x.mailinator.com").
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) if (blocked(parts.slice(i).join("."))) return true;
  return false;
}

export function networkHash(ip: string | null | undefined): string | null {
  if (!ip || ip === "unknown") return null;
  return sha256(`net:${ip.trim()}`);
}

/** May this verified user receive trial credits, given how many trials their network already claimed? */
export async function trialAllowedForNetwork(ipHash: string | null): Promise<boolean> {
  if (!ipHash) return true;
  const max = Number(await getSetting<number>("trial_max_per_network_30d").catch(() => 2));
  if (!(max > 0)) return false;
  const r = await one<{ n: number }>(`SELECT count(*)::int AS n FROM trial_claims WHERE ip_hash=$1 AND claimed_at > now() - interval '30 days'`, [ipHash]);
  return (r?.n ?? 0) < max;
}

/** Tools a free (trial) account may use. ["*"] = every tool. */
export async function trialFeatures(): Promise<string[]> {
  const v = await getSetting<string[]>("trial_features").catch(() => ["*"]);
  return Array.isArray(v) ? v.map(String) : ["*"];
}

export async function isTrialFeature(key: string): Promise<boolean> {
  const list = await trialFeatures();
  return list.includes("*") || list.includes(key);
}

/** Shared 24h AI budget for all free-plan workspaces. */
export async function trialBudgetExhausted(): Promise<boolean> {
  const budget = Number(await getSetting<number>("trial_daily_budget_usd").catch(() => 2));
  const r = await one<{ usd: string }>(
    `SELECT COALESCE(sum(u.cost_usd),0) AS usd FROM usage_events u JOIN workspaces w ON w.id=u.workspace_id
      WHERE w.plan_key='free' AND u.created_at > now() - interval '24 hours'`,
  );
  return Number(r!.usd) >= budget;
}
