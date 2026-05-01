"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain, BarChart3, GitCompare } from "lucide-react";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

const NAV_LINKS = [
  { href: "/",             label: "Runs",    icon: BarChart3 },
  { href: "/runs/compare", label: "Compare", icon: GitCompare },
] as const;

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur-md dark:border-white/[0.08] dark:bg-black/80">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5">
        {/* Logo */}
        <Link href="/" className="group flex items-center gap-2 transition-opacity hover:opacity-80">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/20">
            <Brain className="h-4 w-4 text-white" />
          </div>
          <span className="text-gradient-brand text-sm font-bold tracking-widest">
            HEALOSBENCH
          </span>
        </Link>

        {/* Nav */}
        <nav className="flex items-center gap-0.5">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => {
            const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                  isActive
                    ? "bg-blue-50 text-blue-600 dark:bg-white/[0.08] dark:text-white"
                    : "text-slate-500 hover:bg-gray-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/[0.04] dark:hover:text-slate-200"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Right */}
        <div className="flex items-center gap-2.5">
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
