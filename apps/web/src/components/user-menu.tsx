"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export default function UserMenu() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  // ── Loading state ────────────────────────────────────────────────────────
  if (isPending) {
    return (
      <div className="h-8 w-20 animate-pulse rounded-lg bg-slate-200 dark:bg-white/[0.06]" />
    );
  }

  // ── Signed in: show email + sign out ─────────────────────────────────────
  if (session) {
    return (
      <div className="flex items-center gap-2">
        <span className="max-w-[140px] truncate text-xs text-slate-500 dark:text-slate-400">
          {session.user.email}
        </span>
        <button
          onClick={() => {
            authClient.signOut({
              fetchOptions: {
                onSuccess: () => router.push("/login"),
              },
            });
          }}
          className="rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-500 transition-all hover:bg-red-500/20 dark:text-red-400"
        >
          Sign Out
        </button>
      </div>
    );
  }

  // ── Not signed in: show Sign In button ───────────────────────────────────
  return (
    <Link
      href="/login"
      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/40 px-3 py-1.5 text-xs font-medium text-blue-600 transition-all hover:bg-blue-500 hover:text-white dark:text-blue-400 dark:hover:bg-blue-500 dark:hover:text-white"
    >
      <LogIn className="h-3.5 w-3.5" />
      Sign In
    </Link>
  );
}
