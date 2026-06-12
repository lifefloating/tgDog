import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { prisma } from "@tgdog/db";
import { encrypt } from "@tgdog/core";
import { env } from "./env.js";
import type { ClientManager } from "./client-manager.js";

/** 进行中的登录会话 */
interface PendingLogin {
  client: TelegramClient;
  apiId: number;
  apiHash: string;
  // QR 登录
  qrToken?: string; // tg://login?token=... 的 base64url token
  qrExpires?: number;
  // phone 登录
  phoneCodeResolver?: (code: string) => void;
  passwordResolver?: (pwd: string) => void;
  status: "waiting" | "done" | "error";
  error?: string;
  accountId?: string;
}

const pending = new Map<string, PendingLogin>();

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function authed(req: IncomingMessage): boolean {
  if (!env.internalApiSecret) return true; // 未设置则不校验（仅本地开发）
  return req.headers["x-internal-secret"] === env.internalApiSecret;
}

/** 登录成功：加密保存 session + account，并触发 manager 接入 */
async function persistSession(
  p: PendingLogin,
  user: Api.User,
): Promise<string> {
  const sessionStr = (p.client.session.save() as unknown as string) ?? "";
  const tgUserId = String(user.id);
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");

  const account = await prisma.account.create({
    data: {
      label: name || user.username || tgUserId,
      phone: user.phone ?? null,
      apiId: p.apiId,
      apiHashEnc: encrypt(p.apiHash),
      sessionEnc: encrypt(sessionStr),
      tgUserId,
      tgUsername: user.username ?? null,
      status: "ACTIVE",
      lastConnectedAt: new Date(),
    },
  });
  return account.id;
}

export function startLoginServer(manager: ClientManager): void {
  const server = createServer(async (req, res) => {
    try {
      if (!authed(req)) return send(res, 401, { error: "unauthorized" });
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;

      // 健康检查
      if (path === "/health") return send(res, 200, { ok: true });

      // ===== QR 登录：开始 =====
      if (path === "/login/qr/start" && req.method === "POST") {
        const { apiId, apiHash } = await readJson(req);
        if (!apiId || !apiHash)
          return send(res, 400, { error: "缺少 apiId / apiHash" });

        const id = newId();
        const client = new TelegramClient(
          new StringSession(""),
          Number(apiId),
          String(apiHash),
          { connectionRetries: 5 },
        );
        await client.connect();
        const p: PendingLogin = {
          client,
          apiId: Number(apiId),
          apiHash: String(apiHash),
          status: "waiting",
        };
        pending.set(id, p);

        // 后台启动 QR 登录流程；qrCode 回调更新 token
        client
          .signInUserWithQrCode(
            { apiId: Number(apiId), apiHash: String(apiHash) },
            {
              qrCode: async (code) => {
                p.qrToken = Buffer.from(code.token).toString("base64url");
                p.qrExpires = code.expires;
              },
              password: async () =>
                new Promise<string>((resolve) => {
                  p.passwordResolver = resolve;
                }),
              onError: async (err) => {
                p.status = "error";
                p.error = err.message;
                return true;
              },
            },
          )
          .then(async (user) => {
            if (user instanceof Api.User) {
              p.accountId = await persistSession(p, user);
              p.status = "done";
              await manager.syncAccounts();
            }
          })
          .catch((err) => {
            p.status = "error";
            p.error = (err as Error).message;
          });

        // 等一小会儿拿到首个 token
        await new Promise((r) => setTimeout(r, 800));
        return send(res, 200, {
          loginId: id,
          token: p.qrToken,
          expires: p.qrExpires,
        });
      }

      // ===== QR / phone 登录：轮询状态 =====
      if (path === "/login/status" && req.method === "GET") {
        const id = url.searchParams.get("loginId") ?? "";
        const p = pending.get(id);
        if (!p) return send(res, 404, { error: "登录会话不存在" });
        return send(res, 200, {
          status: p.status,
          token: p.qrToken,
          expires: p.qrExpires,
          needsPassword: !!p.passwordResolver && p.status === "waiting",
          accountId: p.accountId,
          error: p.error,
        });
      }

      // ===== 提交二步验证密码 =====
      if (path === "/login/password" && req.method === "POST") {
        const { loginId, password } = await readJson(req);
        const p = pending.get(loginId);
        if (!p?.passwordResolver)
          return send(res, 400, { error: "当前不需要密码" });
        p.passwordResolver(String(password));
        p.passwordResolver = undefined;
        return send(res, 200, { ok: true });
      }

      // ===== 手机号登录：发送验证码 =====
      if (path === "/login/code/start" && req.method === "POST") {
        const { apiId, apiHash, phone } = await readJson(req);
        if (!apiId || !apiHash || !phone)
          return send(res, 400, { error: "缺少 apiId / apiHash / phone" });

        const id = newId();
        const client = new TelegramClient(
          new StringSession(""),
          Number(apiId),
          String(apiHash),
          { connectionRetries: 5 },
        );
        await client.connect();
        const p: PendingLogin = {
          client,
          apiId: Number(apiId),
          apiHash: String(apiHash),
          status: "waiting",
        };
        pending.set(id, p);

        client
          .start({
            phoneNumber: async () => String(phone),
            phoneCode: async () =>
              new Promise<string>((resolve) => {
                p.phoneCodeResolver = resolve;
              }),
            password: async () =>
              new Promise<string>((resolve) => {
                p.passwordResolver = resolve;
              }),
            onError: (err) => {
              p.status = "error";
              p.error = err.message;
            },
          })
          .then(async () => {
            const me = await client.getMe();
            if (me instanceof Api.User) {
              p.accountId = await persistSession(p, me);
              p.status = "done";
              await manager.syncAccounts();
            }
          })
          .catch((err) => {
            p.status = "error";
            p.error = (err as Error).message;
          });

        return send(res, 200, { loginId: id });
      }

      // ===== 手机号登录：提交验证码 =====
      if (path === "/login/code/submit" && req.method === "POST") {
        const { loginId, code } = await readJson(req);
        const p = pending.get(loginId);
        if (!p?.phoneCodeResolver)
          return send(res, 400, { error: "当前不需要验证码" });
        p.phoneCodeResolver(String(code));
        p.phoneCodeResolver = undefined;
        return send(res, 200, { ok: true });
      }

      // ===== 拉取对话列表（供 web 选监控源）=====
      if (path === "/dialogs" && req.method === "GET") {
        const accountId = url.searchParams.get("accountId") ?? "";
        if (!accountId) return send(res, 400, { error: "缺少 accountId" });
        const dialogs = await manager.listDialogs(accountId);
        return send(res, 200, { dialogs });
      }

      // ===== 规则回测：用各监控源最近历史消息验证规则命中（不入库）=====
      if (path === "/backtest" && req.method === "GET") {
        const accountId = url.searchParams.get("accountId") ?? "";
        if (!accountId) return send(res, 400, { error: "缺少 accountId" });
        const limit = Math.min(
          Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20,
          100,
        );
        const result = await manager.backtestRules(accountId, limit);
        return send(res, 200, result);
      }

      // ===== 历史回填：把各监控源最近历史消息走完整入库管线 =====
      if (path === "/backfill" && req.method === "POST") {
        const { accountId, limit } = await readJson(req);
        if (!accountId) return send(res, 400, { error: "缺少 accountId" });
        const result = await manager.backfillHistory(
          String(accountId),
          Math.min(Number(limit) || 200, 1000),
        );
        return send(res, 200, result);
      }

      // ===== 单源回填：新源添加时只回填该源的历史 =====
      if (path === "/backfill-source" && req.method === "POST") {
        const { accountId, tgChatId, limit } = await readJson(req);
        if (!accountId || !tgChatId) {
          return send(res, 400, { error: "缺少 accountId 或 tgChatId" });
        }
        const result = await manager.backfillSource(
          String(accountId),
          String(tgChatId),
          Math.min(Number(limit) || 200, 1000),
        );
        return send(res, 200, result);
      }

      return send(res, 404, { error: "not found" });
    } catch (err) {
      console.error("[login] 出错:", (err as Error).message);
      return send(res, 500, { error: (err as Error).message });
    }
  });

  server.listen(env.loginPort, () => {
    console.log(`[login] 登录服务监听 :${env.loginPort}`);
  });
}
