import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Auth gate — Next 16 `proxy` convention (formerly `middleware`); verified
 * against next@16.2.0, which always runs this file on the Node.js runtime and
 * forbids route segment config here.
 * Only verifies the cookie JWT for protected route groups — hashing/DB stay in
 * the route handlers, which re-check auth themselves (this is UX, not the
 * security boundary).
 * Unauthenticated: browser → redirect to the landing page with the auth modal
 * open (/?auth=login&next=…); API → 401 JSON.
 */
const COOKIE = process.env.AUTH_COOKIE_NAME || "grill_session";
const secret = new TextEncoder().encode(process.env.JWT_SECRET);

async function isValid(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest) {
  const ok = await isValid(req.cookies.get(COOKIE)?.value);
  if (ok) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "auth", message: "Not authenticated." } },
      { status: 401 },
    );
  }
  // The sign-in form is a modal on the landing page, not a route of its own —
  // the page reads ?auth= and ?next= on mount and opens it.
  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  url.searchParams.set("auth", "login");
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // Every signed-in surface belongs here. Missing one isn't a hole — each route
  // re-checks auth itself, and this gate is UX — but it's the difference between
  // a clean redirect to the sign-in modal and an error page.
  //
  // NOT listed on purpose: /api/cron/* (bearer-token auth, no user cookie) and
  // /api/health/* (deliberately unauthenticated, so the sign-in page can keep
  // the acoustics service warm).
  matcher: [
    "/dashboard/:path*",
    "/new/:path*",
    "/session/:path*",
    "/report/:path*",
    "/profile/:path*",
    "/starred/:path*",
    "/questions/:path*",
    "/api/interview/:path*",
    "/api/report/:path*",
    "/api/starred/:path*",
    "/api/profile/:path*",
    "/api/questions/:path*",
    "/api/dashboard",
  ],
};
