import Link from "next/link";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";

const links = [
  { href: "/", label: "消息流" },
  { href: "/reports", label: "报告" },
  { href: "/sources", label: "监控源" },
  { href: "/rules", label: "规则" },
  { href: "/accounts", label: "账号" },
  { href: "/settings", label: "设置" },
];

export function Nav() {
  return (
    <nav className="border-b border-border bg-card">
      <div className="mx-auto grid max-w-[1440px] grid-cols-[1fr_auto_1fr] items-center px-4 py-2 sm:px-6">
        <Link
          href="/"
          className="justify-self-start font-semibold tracking-tight"
        >
          🐕 tgDog
        </Link>
        <div className="flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              )}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="justify-self-end">
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
