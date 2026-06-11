"use client";

import { useEffect, useState } from "react";

const MODES = ["light", "dark", "auto"] as const;
type Mode = (typeof MODES)[number];

const MODE_META: Record<Mode, { icon: string; label: string }> = {
  light: { icon: "☀️", label: "浅色" },
  dark: { icon: "🌙", label: "深色" },
  auto: { icon: "🌓", label: "Auto" },
};

// 注意：判定逻辑须与 app/layout.tsx 的 themeInit 内联脚本保持一致
function applyTheme(mode: Mode) {
  const dark =
    mode === "dark" ||
    (mode === "auto" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** 右上角主题切换：浅色 → 深色 → 跟随系统 循环 */
export function ThemeToggle() {
  // 初始渲染固定 auto，挂载后读 localStorage，避免 SSR/CSR 不一致
  const [mode, setMode] = useState<Mode>("auto");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theme") as Mode | null;
    if (saved && MODES.includes(saved)) setMode(saved);
    setMounted(true);
  }, []);

  // auto 模式下跟随系统切换
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const current = (localStorage.getItem("theme") as Mode) ?? "auto";
      if (current === "auto") applyTheme("auto");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function cycle() {
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    setMode(next);
    localStorage.setItem("theme", next);
    applyTheme(next);
  }

  const meta = MODE_META[mode];
  return (
    <button
      onClick={cycle}
      title={`主题：${meta.label}（点击切换）`}
      aria-label={`切换主题，当前${meta.label}`}
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <span aria-hidden>{mounted ? meta.icon : "🌓"}</span>
      <span className="hidden sm:inline">{mounted ? meta.label : "Auto"}</span>
    </button>
  );
}
