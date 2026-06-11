import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "tgDog",
  description: "监控、汇总、分析你关注的 Telegram 消息",
};

// 首帧前根据 localStorage / 系统偏好设置主题，避免闪烁
// 注意：判定逻辑须与 components/theme-toggle.tsx 的 applyTheme 保持一致
const themeInit = `(function(){try{var t=localStorage.getItem("theme")||"auto";var d=t==="dark"||(t==="auto"&&matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark")}catch(e){}})()`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
