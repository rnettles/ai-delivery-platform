"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

function usePrGateCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    async function fetch_() {
      try {
        const res = await fetch("/api/pr-gates");
        if (!res.ok) return;
        const data = (await res.json()) as unknown[];
        setCount(Array.isArray(data) ? data.length : 0);
      } catch {
        // silent — sidebar badge is best-effort
      }
    }
    void fetch_();
    const id = setInterval(() => { void fetch_(); }, 30_000);
    return () => clearInterval(id);
  }, []);
  return count;
}

export function Sidebar() {
  const pathname = usePathname();
  const prGateCount = usePrGateCount();

  const navItems = [
    { label: "Projects", href: "/projects" },
    { label: "PR Gates", href: "/pr-gates", badge: prGateCount > 0 ? prGateCount : null },
    { label: "Logs", href: "/logs" },
  ];

  return (
    <nav className="flex w-56 flex-shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="px-4 py-5 border-b border-gray-100">
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          AI Delivery Platform
        </span>
      </div>
      <ul className="flex flex-col gap-1 p-2">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`flex items-center justify-between rounded px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                {item.label}
                {"badge" in item && item.badge != null && (
                  <span className="ml-2 rounded-full bg-amber-500 px-1.5 py-px text-[10px] font-bold text-white">
                    {item.badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
