"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/sites", "Sites"],
  ["/tools", "Tools"],
  ["/record", "Record"],
  ["/runs", "Runs"],
  ["/repairs", "Repairs"],
  ["/receipts", "Receipts"],
  ["/audit", "Audit"],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap gap-2">
      {LINKS.map(([href, label]) => {
        const active = path === href || path.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={`border-[3px] border-ink px-3 py-1 font-bold no-underline ${active ? "bg-orange shadow-[3px_3px_0_#1a1a1a]" : "bg-white hover:bg-cream"}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
