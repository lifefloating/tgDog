// .env 由入口的 ./load-env.ts 统一加载（必须在 @tgdog/db 之前），此处不再重复加载。
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  encryptionKey: required("ENCRYPTION_KEY"),
  internalApiSecret: process.env.INTERNAL_API_SECRET ?? "",
  loginPort: Number.parseInt(process.env.COLLECTOR_LOGIN_PORT ?? "8787", 10),
  // 规则/源热加载轮询间隔（毫秒）。只查本地 Postgres，不打 Telegram API，
  // 可以放心调低；10s 让新规则/新账号更快生效。
  reloadIntervalMs: Number.parseInt(
    process.env.COLLECTOR_RELOAD_MS ?? "10000",
    10,
  ),
  // 源头像补抓间隔（毫秒）。每次会对缺头像的源调 Telegram getEntity/下载头像，
  // 属于真实 API 调用，频率过高会触发 420 FLOOD_WAIT，默认 10 分钟一轮。
  avatarBackfillMs: Number.parseInt(
    process.env.COLLECTOR_AVATAR_BACKFILL_MS ?? "600000",
    10,
  ),
};
