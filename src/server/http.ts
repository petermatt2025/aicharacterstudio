import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { ZodError } from "zod";
import { AppError, isAppError } from "./errors";
import { userFromSessionToken, type SessionUser } from "./accounts";
import { env } from "./env";
import { log } from "./audit";

export const SESSION_COOKIE = "acs_session";

type Ctx<P> = { params: Promise<P> };

/** Wraps a route handler: CSRF origin check on mutations, structured error codes, no stack traces to clients. */
export function route<P = Record<string, string>>(fn: (req: NextRequest, ctx: Ctx<P>) => Promise<Response | unknown>, opts: { csrf?: boolean } = {}) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      if (opts.csrf !== false && !["GET", "HEAD", "OPTIONS"].includes(req.method)) assertSameOrigin(req);
      const out = await fn(req, ctx);
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (isAppError(e)) return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
  if (e instanceof ZodError) {
    const issues = e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return NextResponse.json({ error: { code: "validation_failed", message: issues[0]?.message ?? "Invalid input", details: issues } }, { status: 400 });
  }
  log("error", "http.unhandled", { error: (e as Error)?.message, stack: (e as Error)?.stack?.split("\n").slice(0, 4).join(" | ") });
  return NextResponse.json({ error: { code: "internal", message: "Something went wrong. Please try again." } }, { status: 500 });
}

/** Cookie is SameSite=Lax; additionally require same-origin Origin/Referer on state-changing requests. */
export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin") ?? (req.headers.get("referer") ? new URL(req.headers.get("referer")!).origin : null);
  const allowed = new Set([new URL(env().APP_URL).origin, req.nextUrl.origin]);
  if (!origin || !allowed.has(origin)) throw new AppError("forbidden", "Cross-origin request blocked");
}

export async function optionalUser(req: NextRequest): Promise<SessionUser | null> {
  return userFromSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

export async function requireUser(req: NextRequest): Promise<SessionUser> {
  const u = await optionalUser(req);
  if (!u) throw new AppError("unauthenticated", "Please sign in.");
  return u;
}

/** For server components. */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return userFromSessionToken(jar.get(SESSION_COOKIE)?.value);
}

export function setSessionCookie(res: NextResponse, token: string, maxAge: number) {
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: env().APP_URL.startsWith("https://"), sameSite: "lax", path: "/", maxAge });
  return res;
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: env().APP_URL.startsWith("https://"), sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}

export function clientIp(req: NextRequest) {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim();
}
