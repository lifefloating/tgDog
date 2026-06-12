// 服务端调用 collector 内置登录/对话服务的封装。
// 仅在 server actions / route handlers 中使用（带 INTERNAL_API_SECRET）。

const BASE = process.env.COLLECTOR_LOGIN_URL ?? "http://localhost:8787";
const SECRET = process.env.INTERNAL_API_SECRET ?? "";

async function call(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-internal-secret": SECRET,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error ?? `collector 请求失败 (${res.status})`);
  }
  return data;
}

export const collector = {
  qrStart: (apiId: number, apiHash: string) =>
    call("/login/qr/start", {
      method: "POST",
      body: JSON.stringify({ apiId, apiHash }),
    }),
  status: (loginId: string) =>
    call(`/login/status?loginId=${encodeURIComponent(loginId)}`),
  submitPassword: (loginId: string, password: string) =>
    call("/login/password", {
      method: "POST",
      body: JSON.stringify({ loginId, password }),
    }),
  codeStart: (apiId: number, apiHash: string, phone: string) =>
    call("/login/code/start", {
      method: "POST",
      body: JSON.stringify({ apiId, apiHash, phone }),
    }),
  codeSubmit: (loginId: string, code: string) =>
    call("/login/code/submit", {
      method: "POST",
      body: JSON.stringify({ loginId, code }),
    }),
  dialogs: (accountId: string) =>
    call(`/dialogs?accountId=${encodeURIComponent(accountId)}`),
  backtest: (accountId: string, limit = 50) =>
    call(`/backtest?accountId=${encodeURIComponent(accountId)}&limit=${limit}`),
  backfill: (accountId: string, limit = 200) =>
    call("/backfill", {
      method: "POST",
      body: JSON.stringify({ accountId, limit }),
    }),
  backfillSource: (accountId: string, tgChatId: string, limit = 200) =>
    call("/backfill-source", {
      method: "POST",
      body: JSON.stringify({ accountId, tgChatId, limit }),
    }),
  health: () => call("/health"),
};
