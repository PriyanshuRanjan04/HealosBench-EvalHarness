"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FlaskConical, LogIn } from "lucide-react";
import { authClient } from "@/lib/auth-client";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

export default function UserMenu() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  // ── Loading state ────────────────────────────────────────────────────────
  if (isPending && !SKIP_AUTH) {
    return (
      <div className="h-8 w-20 animate-pulse rounded-lg bg-slate-200 dark:bg-white/[0.06]" />
    );
  }

  // ── Signed in: show email + sign out (regardless of SKIP_AUTH) ──────────
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

  // ── Not signed in: show Dev Mode badge (if applicable) + Sign In ────────
  return (
    <div className="flex items-center gap-2">
      {SKIP_AUTH && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
          <FlaskConical className="h-3 w-3" />
          Dev Mode
        </span>
      )}
      <Link
        href="/login"
        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/40 px-3 py-1.5 text-xs font-medium text-blue-600 transition-all hover:bg-blue-500 hover:text-white dark:text-blue-400 dark:hover:bg-blue-500 dark:hover:text-white"
      >
        <LogIn className="h-3.5 w-3.5" />
        Sign In
      </Link>
    </div>
  );
}
