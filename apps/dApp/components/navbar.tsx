"use client";

import { ConnectButton } from "@mysten/dapp-kit";
import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/studio", label: "Studio" },
  { href: "/chat", label: "Chat" },
  { href: "/stake", label: "Protocol" },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="sticky top-0 z-50 border-b border-r3mes-border/80 bg-r3mes-bg/85 backdrop-blur-md"
    >
      <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2 sm:flex-nowrap">
        <Link href="/" className="group flex items-center gap-2">
          <span className="text-lg font-semibold tracking-tight text-white">
            R3MES
          </span>
          <span className="hidden text-xs text-r3mes-muted sm:inline">
            Knowledge OS
          </span>
        </Link>

        <nav className="order-3 flex w-full items-center gap-1 overflow-x-auto pb-0.5 sm:order-none sm:w-auto sm:flex-1 sm:justify-center sm:gap-2 sm:overflow-visible sm:pb-0">
          {links.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-white/10 text-white"
                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center">
          <ConnectButton connectText="Cüzdan bağla" />
        </div>
      </div>
    </motion.header>
  );
}
