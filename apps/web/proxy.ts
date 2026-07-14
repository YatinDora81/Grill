import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Auth gate — Next 16 `proxy` convention (formerly `middleware`); verified
 * against next@16.2.0, which always runs this file on the Node.js runtime and
 * forbids route segment config here.
 * Only verifies the cookie JWT for protected route groups — hashing/DB stay in
 * the route handlers, which re-check auth themselves (this is UX, not the
 * security boundary).
 * Unauthenticated: browser → redirect to /login; API → 401 JSON.
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
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/new/:path*",
    "/session/:path*",
    "/report/:path*",
    "/api/interview/:path*",
    "/api/report/:path*",
    "/api/dashboard",
  ],
};
