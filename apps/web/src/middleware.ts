/**
 * middleware.ts — Route protection for HealosBench web app.
 *
 * Protects all routes except /login and /signup by checking
 * the Better Auth session via a server-side fetch to the Hono backend.
 *
 * Better Auth stores sessions in cookies. We forward the cookie header
 * from the incoming request so the auth server can validate it.
 */

import { betterFetch } from "@better-fetch/fetch";
import { NextResponse, type NextRequest } from "next/server";

interface Session {
  user: { id: string; email: string; name: string };
  session: { id: string; expiresAt: string };
}

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8787";

/** Public routes that never require auth */
const PUBLIC_PATHS = ["/login", "/signup"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths through immediately
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow Next.js internal paths and static assets
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".") // static files (favicon.ico, etc.)
  ) {
    return NextResponse.next();
  }

  // Check session with Better Auth
  const { data: session, error } = await betterFetch<Session>(
    "/api/auth/get-session",
    {
      baseURL: SERVER_URL,
      headers: {
        // Forward cookies so the auth server can read the session cookie
        cookie: request.headers.get("cookie") ?? "",
      },
    },
  );

  if (error || !session?.user) {
    // No valid session → redirect to login, preserving the intended URL
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  /*
   * Match everything except:
   *   - /login and /signup (public)
   *   - /_next/* (Next.js internals)
   *   - /api/* (API routes)
   *   - Files with extensions (favicon.ico, etc.)
   */
  matcher: [
    "/((?!login|signup|api|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
