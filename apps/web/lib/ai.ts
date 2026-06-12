import OpenAI from "openai";
import { prisma } from "@tgdog/db";
import { tryDecrypt } from "@tgdog/core";

export interface AiConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

/** 从 Setting 行（优先）或 env 读取 AI 配置 */
export async function loadAiConfig(): Promise<AiConfig | null> {
  const s = await prisma.setting.findUnique({ where: { id: "singleton" } });
  const baseURL = s?.aiBaseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const apiKey = tryDecrypt(s?.aiApiKeyEnc) || process.env.OPENAI_API_KEY || "";
  const model = s?.aiModel || process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!apiKey) return null;
  return { baseURL, apiKey, model };
}

/**
 * 规范化 baseURL（与 Cherry Studio 行为一致）：
 * - 末尾带 `#` → 强制按原样使用（去掉 # 和尾部斜杠）
 * - 已以 /v1、/v2 等版本路径结尾 → 原样使用
 * - 其他情况自动补 `/v1`（多数 OpenAI 兼容网关的标准路径）
 */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return url;
  if (url.endsWith("#")) return url.slice(0, -1).replace(/\/+$/, "");
  url = url.replace(/\/+$/, "");
  if (/\/v\d+[a-z]*$/i.test(url)) return url;
  return `${url}/v1`;
}

// 单次 AI 请求的超时（毫秒）。SDK 默认 10 分钟 + 2 次重试，最坏会卡住 ~30 分钟；
// 报告生成会串行发起多次调用，一个卡死的网关会让整个 HTTP 请求长时间挂起，故收紧。
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 90_000;
const AI_MAX_RETRIES = 1;

export function makeClient(cfg: AiConfig): OpenAI {
  return new OpenAI({
    baseURL: normalizeBaseUrl(cfg.baseURL),
    apiKey: cfg.apiKey,
    timeout: AI_TIMEOUT_MS,
    maxRetries: AI_MAX_RETRIES,
  });
}

/** 单次对话补全，返回文本 */
export async function complete(
  cfg: AiConfig,
  system: string,
  user: string,
): Promise<string> {
  const client = makeClient(cfg);
  const t0 = Date.now();
  let res;
  try {
    res = await client.chat.completions.create({
      model: cfg.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
    });
  } catch (err) {
    console.warn(`[ai] 调用失败 (${Date.now() - t0}ms): ${(err as Error).message}`);
    // OpenAI SDK 对非 2xx 会抛错，带上状态码/信息转成可读提示
    throw new Error(`AI 请求失败: ${(err as Error).message}`);
  }
  console.log(
    `[ai] 单次补全 ${Date.now() - t0}ms (in≈${user.length}字, out≈${res?.choices?.[0]?.message?.content?.length ?? 0}字)`,
  );

  const content = res?.choices?.[0]?.message?.content;
  if (!content) {
    // 部分兼容网关出错时返回 200 + 非标准结构（无 choices），把原始响应带出来便于排查
    const raw = JSON.stringify(res ?? null).slice(0, 300);
    throw new Error(
      `AI 返回异常（无 choices，请检查设置页的 baseUrl/model 是否正确）: ${raw}`,
    );
  }
  return content;
}
