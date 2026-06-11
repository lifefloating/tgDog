"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@tgdog/db";
import { encrypt } from "@tgdog/core";
import { loadAiConfig, complete, normalizeBaseUrl } from "@/lib/ai";

export interface SettingsInput {
  // R2
  r2AccountId?: string;
  r2AccessKey?: string; // 明文，提交时加密；留空表示不修改
  r2SecretKey?: string;
  r2Bucket?: string;
  r2Endpoint?: string;
  r2PublicUrl?: string;
  // AI
  aiBaseUrl?: string;
  aiApiKey?: string; // 明文，提交时加密；留空表示不修改
  aiModel?: string;
}

export async function saveSettings(input: SettingsInput) {
  const existing = await prisma.setting.findUnique({
    where: { id: "singleton" },
  });

  const data = {
    r2AccountId: input.r2AccountId || null,
    r2Bucket: input.r2Bucket || null,
    r2Endpoint: input.r2Endpoint || null,
    r2PublicUrl: input.r2PublicUrl || null,
    aiBaseUrl: input.aiBaseUrl || null,
    aiModel: input.aiModel || null,
    // 密钥：仅在提供了新值时更新（避免被空值覆盖）
    r2AccessKeyEnc: input.r2AccessKey
      ? encrypt(input.r2AccessKey)
      : (existing?.r2AccessKeyEnc ?? null),
    r2SecretKeyEnc: input.r2SecretKey
      ? encrypt(input.r2SecretKey)
      : (existing?.r2SecretKeyEnc ?? null),
    aiApiKeyEnc: input.aiApiKey
      ? encrypt(input.aiApiKey)
      : (existing?.aiApiKeyEnc ?? null),
  };

  await prisma.setting.upsert({
    where: { id: "singleton" },
    update: data,
    create: { id: "singleton", ...data },
  });
  revalidatePath("/settings");
}

export interface AiTestResult {
  model: string;
  baseURL: string;
  latencyMs: number;
  reply: string;
}

/**
 * 测试 AI 接口连通性：优先用表单里当前填写的值（无需先保存），
 * API Key 留空时回退到已保存/环境变量的配置。
 */
export async function testAiConnection(input: {
  aiBaseUrl?: string;
  aiApiKey?: string;
  aiModel?: string;
}): Promise<AiTestResult> {
  const baseUrlIn = input.aiBaseUrl?.trim();
  const apiKeyIn = input.aiApiKey?.trim();
  const modelIn = input.aiModel?.trim();
  // 表单三项都填了就不读库，缺哪项再回退已保存/环境变量配置
  const saved = baseUrlIn && apiKeyIn && modelIn ? null : await loadAiConfig();
  const baseURL = baseUrlIn || saved?.baseURL || "https://api.openai.com/v1";
  const apiKey = apiKeyIn || saved?.apiKey || "";
  const model = modelIn || saved?.model || "gpt-4o-mini";

  if (!apiKey) {
    throw new Error("没有可用的 API Key：请在上方填写，或先保存设置");
  }

  const started = Date.now();
  const reply = await complete(
    { baseURL, apiKey, model },
    "你是接口连通性测试助手。",
    "收到请只回复两个字：正常",
  );
  return {
    model,
    baseURL: normalizeBaseUrl(baseURL), // 返回实际请求的地址（自动补 /v1 后）
    latencyMs: Date.now() - started,
    reply: reply.trim().slice(0, 50),
  };
}
