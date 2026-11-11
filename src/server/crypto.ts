import "server-only";
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const N = 2 ** 15, R = 8, P = 1, KEYLEN = 64;

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(pw, Buffer.from(salt, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return crypto.timingSafeEqual(key, expected);
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");

/** Lowercase, trim, strip +tags, and for gmail strip dots: used only for trial-abuse control. */
export function canonicalEmail(email: string): string {
  const [localRaw, domainRaw] = email.trim().toLowerCase().split("@");
  if (!localRaw || !domainRaw) return email.trim().toLowerCase();
  let local = localRaw.split("+")[0] ?? localRaw;
  const domain = domainRaw === "googlemail.com" ? "gmail.com" : domainRaw;
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}
