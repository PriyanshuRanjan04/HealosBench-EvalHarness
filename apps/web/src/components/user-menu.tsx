"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { authClient } from "@/lib/auth-client";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

export default function UserMenu() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  // ── Dev mode: show badge instead of sign-in ──────────────────────────────
  if (SKIP_AUTH) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-400">
        <FlaskConical className="h-3 w-3" />
        Dev Mode
      </span>
    );
  }

  // ── Loading state ────────────────────────────────────────────────────────
  if (isPending) {
    return (
      <div className="h-8 w-20 animate-pulse rounded-lg bg-white/[0.06]" />
    );
  }

  // ── Not signed in ────────────────────────────────────────────────────────
  if (!session) {
    return (
      <Link
        href="/login"
        className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-300 transition-all hover:bg-white/[0.08] hover:text-white"
      >
        Sign In
      </Link>
    );
  }

  // ── Signed in: show email + sign out ─────────────────────────────────────
  return (
    <div className="flex items-center gap-2">
      <span className="max-w-[140px] truncate text-xs text-slate-400">
        {session.user.email}
      </span>
      <button
        onClick={() => {
          authClient.signOut({
            fetchOptions: {
              onSuccess: () => router.push("/"),
            },
          });
        }}
        className="rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-400 transition-all hover:bg-red-500/20"
      >
        Sign Out
      </button>
    </div>
  );
}
