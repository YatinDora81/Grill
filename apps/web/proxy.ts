import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

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
  url.pathname = "/";
  url.search = "";
  url.searchParams.set("auth", "login");
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/new/:path*",
    "/session/:path*",
    "/report/:path*",
    "/profile/:path*",
    "/starred/:path*",
    "/questions/:path*",
    "/drill/:path*",
    "/api/interview/:path*",
    "/api/report/:path*",
    "/api/starred/:path*",
    "/api/profile/:path*",
    "/api/questions/:path*",
    "/api/drill/:path*",
    "/api/company/:path*",
    "/api/dashboard",
  ],
};
