"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

/** 当前路径是否落在某个导航项下（"/" 仅精确匹配，其余按前缀匹配子页面） */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const pathname = usePathname();

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
          {links.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-1 justify-self-end">
          <a
            href="https://github.com/lifefloating"
            target="_blank"
            rel="noopener noreferrer"
            title="GitHub @lifefloating"
            aria-label="访问 GitHub @lifefloating"
            className="flex items-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <img
              src="https://github.com/lifefloating.png"
              alt="lifefloating 的 GitHub 头像"
              width={28}
              height={28}
              className="size-7 rounded-full"
            />
          </a>
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
