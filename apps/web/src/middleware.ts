/**
 * middleware.ts — Route protection for HealosBench web app.
 *
 * Protects all routes except /login and /signup by checking
 * the Better Auth session via a server-side fetch to the Hono backend.
 *
 * Dev bypass: set NEXT_PUBLIC_SKIP_AUTH=true in apps/web/.env.local
 * to skip auth entirely (useful when running the web app without
 * the Hono server running).
 *
 * Note: proxy.ts is NOT a Next.js convention — middleware.ts is the
 * correct and only supported filename for Next.js route interception.
 */

import { betterFetch } from "@better-fetch/fetch";
import { NextResponse, type NextRequest } from "next/server";

interface Session {
  user: { id: string; email: string; name: string };
  session: { id: string; expiresAt: string };
}

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8787";

/** Set NEXT_PUBLIC_SKIP_AUTH=true in .env.local to bypass auth in dev */
const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

/** Public routes that never require auth */
const PUBLIC_PATHS = ["/login", "/signup"];

export async function middleware(request: NextRequest) {
  // ── Dev bypass ────────────────────────────────────────────────────────────
  if (SKIP_AUTH) {
    return NextResponse.next();
  }

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
  // Wrapped in try/catch so a downed server redirects to /login
  // rather than throwing an unhandled error in the middleware.
  try {
    const { data: session } = await betterFetch<Session>(
      "/api/auth/get-session",
      {
        baseURL: SERVER_URL,
        headers: {
          // Forward cookies so the auth server can read the session cookie
          cookie: request.headers.get("cookie") ?? "",
        },
      },
    );

    if (!session?.user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }
  } catch {
    // Server unreachable — redirect to login rather than crashing
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
