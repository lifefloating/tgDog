import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 本地时区的 YYYY-MM-DD。报告按服务器本地午夜存储，
 * 列表链接与详情查询必须用同一时区取日期，否则跨时区会差一天导致 404。
 */
export function localDateKey(d: Date): string {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 生成跳转到 Telegram 频道/群/用户的链接：
 * 公开实体用 username，私有频道/超级群用 t.me/c/<内部id>，
 * 无 username 的用户用 tg:// 深链（仅装了客户端可用）。
 */
export function tgChatLink(opts: {
  username?: string | null;
  tgChatId: string;
  type?: string;
}): string | null {
  if (opts.username) return `https://t.me/${opts.username}`;
  if (opts.tgChatId.startsWith("-100")) {
    return `https://t.me/c/${opts.tgChatId.slice(4)}`;
  }
  if (opts.type === "USER") return `tg://user?id=${opts.tgChatId}`;
  return null;
}

