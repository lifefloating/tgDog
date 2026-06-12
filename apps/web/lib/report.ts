import { prisma } from "@tgdog/db";
import type { Prisma } from "@tgdog/db";
import { complete, loadAiConfig, type AiConfig } from "./ai";
import { tgChatLink } from "./utils";

export interface Topic {
  title: string;
  summary: string;
  count: number;
}

/** 单条报价（已回填发言人/群的头像与链接，可直接渲染） */
export interface QuoteItem {
  product: string; // 归一化品类名，同名才可比价
  priceText: string; // 原始报价文字，如 "85u" / "550R" / "70刀"
  priceCNY: number | null; // 折合人民币；null = 无法换算，进「无法比价」列表
  channel: string; // 渠道/交付方式：直登、代充、合租、发票…
  seller: string;
  sellerUsername: string | null;
  sellerAvatarKey: string | null;
  sourceTitle: string;
  sourceAvatarKey: string | null;
  sourceLink: string | null;
  messageLink: string | null;
}

export interface QuoteStats {
  /** 可比价品类：组内按折合价升序（最便宜在前），组间按报价条数降序 */
  groups: { product: string; items: QuoteItem[] }[];
  /** 无法换算比较的报价，原样列出 */
  others: QuoteItem[];
}

export interface ReportStats {
  messageCount: number;
  sourceCount: number;
  topSources: { title: string; count: number }[];
  quotes?: QuoteStats;
}

interface MsgRow {
  text: string;
  sourceTitle: string;
  senderName: string | null;
  timestamp: Date;
}

// 每批喂给模型的消息条数。模型上下文很大（≥200k），用大批次减少串行调用次数。
const CHUNK = 150;
// 批次并发上限：并行发若干批 AI 请求，别一次全发把网关打挂。
const AI_CONCURRENCY = Number(process.env.AI_CONCURRENCY) || 4;

/**
 * 限并发地 map：最多 AI_CONCURRENCY 个任务同时跑，保持结果与输入同序。
 * 每完成一个调用一次 onDone（用于上报进度），count 是已完成总数。
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onDone?: (count: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
      done++;
      onDone?.(done);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/** 报告生成阶段，供前端展示进度 */
export type ReportPhase =
  | "loading" // 拉取消息
  | "summarize" // 汇总分批
  | "quotes" // 报价提取
  | "saving"; // 落库

export interface ReportProgress {
  phase: ReportPhase;
  done: number; // 当前阶段已完成步数
  total: number; // 当前阶段总步数（loading/saving 为 1）
  message: string; // 可直接展示的中文说明
}

type OnProgress = (p: ReportProgress) => void;

function dayWindow(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function formatMsgs(rows: MsgRow[]): string {
  return rows
    .map(
      (m) =>
        `[${m.sourceTitle}]${m.senderName ? ` ${m.senderName}:` : ""} ${m.text.replace(/\n/g, " ").slice(0, 300)}`,
    )
    .join("\n");
}

// map 阶段：把一批消息压成「给下游汇总用的草稿要点」，不是给用户看的成品。
// 刻意要求紧凑——草稿越短，模型生成越快；信息点保全即可，措辞不必展开。
// 最终报告的丰富度由 SYSTEM_FINAL（reduce 阶段）保证，与此处长度无关。
const SYSTEM_CHUNK =
  "你是消息要点提取器。把下面一批 Telegram 消息压成精简的中文 bullet 要点，供后续汇总使用（不是最终报告，不必展开成句）。" +
  "每条要点尽量短，只保留关键事件、数字、价格、链接含义；同类信息合并成一条。不要解释、不要寒暄、不要复述原文。";

const SYSTEM_FINAL =
  "你是一个情报汇总助手。基于多批消息要点，输出一份当日报告（中文 Markdown），包含：1) 总体概述（3-5 句）；2) 按主题分组的要点（用 ## 小标题）；3) 值得关注的重点。简洁、信息密度高，不要寒暄。";

async function summarizeChunks(
  cfg: AiConfig,
  rows: MsgRow[],
  onProgress?: OnProgress,
): Promise<string> {
  if (rows.length <= CHUNK) {
    onProgress?.({
      phase: "summarize",
      done: 0,
      total: 1,
      message: "正在汇总消息…",
    });
    const out = await complete(cfg, SYSTEM_FINAL, formatMsgs(rows));
    onProgress?.({
      phase: "summarize",
      done: 1,
      total: 1,
      message: "汇总完成",
    });
    return out;
  }
  // map：分批要点（限并发并行跑，按已完成数上报进度）
  const chunks: MsgRow[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) chunks.push(rows.slice(i, i + CHUNK));
  const total = chunks.length;
  onProgress?.({
    phase: "summarize",
    done: 0,
    total,
    message: `正在汇总消息 0/${total} 批…`,
  });
  const partials = await mapLimit(
    chunks,
    AI_CONCURRENCY,
    (chunk) => complete(cfg, SYSTEM_CHUNK, formatMsgs(chunk)),
    (done) =>
      onProgress?.({
        phase: "summarize",
        done,
        total,
        message: `正在汇总消息 ${done}/${total} 批…`,
      }),
  );
  // reduce：合并成最终报告
  onProgress?.({
    phase: "summarize",
    done: total,
    total,
    message: "正在生成最终汇总…",
  });
  return complete(
    cfg,
    SYSTEM_FINAL,
    `以下是当日各批消息的要点，请汇总：\n\n${partials.join("\n\n---\n\n")}`,
  );
}

// ---------- 报价提取 ----------

/**
 * 折人民币汇率，只用于同品类内排序比价（不是精确记账），
 * 刀(USD) 和 U(USDT) 粗略按同价处理。
 */
const CNY_RATES: Record<string, number> = { CNY: 1, USD: 7.2, USDT: 7.2 };

const QUOTE_GROUP_LIMIT = 6; // 每个品类最多展示几条（最便宜的在前）
const OTHERS_LIMIT = 30; // 无法比价列表上限

const SYSTEM_QUOTES = `你是报价信息提取器。输入是一批 Telegram 群消息，每条以 #序号 开头。
找出所有「出售 AI 产品/会员/账号」的报价，只输出 JSON 数组（不要 markdown 代码块、不要任何解释）。
每个报价一个对象：
{"i": 消息序号, "product": "归一化品类", "amount": 数字或null, "currency": "CNY"|"USD"|"USDT"|null, "priceText": "原始价格文字", "channel": "渠道/交付方式"}

规则：
- product 必须归一化成「厂商 产品档位 周期」，只有同名品类才会被拿来比价。例如：
  "ChatGPT Plus 月" / "ChatGPT Plus 年" / "ChatGPT Pro 月" / "ChatGPT Pro 年" / "ChatGPT Team 月"
  "Claude Pro 月" / "Claude Pro Team 月" / "Claude Max 5x 月" / "Claude Max 20x 月"
  "Gemini Pro 月" / "Gemini Pro 3个月" / "Gemini Pro 年" / "Gemini Ultra 月"
  "Kiro Pro 月" / "Kiro Power 月" / "Cursor Pro 月" / "Grok SuperGrok 月" 等。
  周期看不出来的写 "周期不明"。
- 货币：刀/$/usd/美元 → "USD"；u/U/usdt → "USDT"；R/r/rmb/¥/元/块 → "CNY"；判断不了 → null。
- amount 只填数字（"85u"→85，"550R"→550）；区间价取下限；没有明确数字 → null。
- channel 是交付方式/渠道，例如：直登 / 成品号 / 代充 / 合租上车 / 拼车 / 礼品卡 / 官方发票 / 独享 / 共享；看不出来填 "未注明"。
- 一条消息报多个产品就输出多个对象；同一产品不同周期/档位分别输出。
- 只提取卖家报价；求购（收）、问价、行情讨论一律跳过。
- 没有任何报价时输出 []。`;

interface RawQuote {
  i: number;
  product: string;
  amount: number | null;
  currency: string | null;
  priceText: string;
  channel: string;
}

/** 兼容模型把 JSON 包进代码块/前后带话的情况 */
function parseQuoteJson(text: string): RawQuote[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (q): q is RawQuote =>
      !!q &&
      typeof (q as RawQuote).i === "number" &&
      typeof (q as RawQuote).product === "string" &&
      typeof (q as RawQuote).priceText === "string",
  );
}

/** 报价提取需要的消息字段（prisma include source 的行天然满足） */
interface QuoteMsg {
  text: string;
  senderId: string | null;
  senderName: string | null;
  senderUsername: string | null;
  senderAvatarKey: string | null;
  messageLink: string | null;
  source: {
    title: string;
    username: string | null;
    tgChatId: string;
    type: string;
    avatarKey: string | null;
  };
}

/**
 * 用 AI 从当日消息里提取报价并比价。
 * AI 只负责识别/归一化品类和金额；头像、链接等按消息序号从库里的原始行回填，避免模型抄错。
 */
async function extractQuotes(
  cfg: AiConfig,
  messages: QuoteMsg[],
  onProgress?: OnProgress,
): Promise<QuoteStats> {
  // 分批并发提取（限并发）。#序号用全局下标，回填时按 q.i 在原数组里取行，故每批要带起始偏移。
  const batches: { offset: number; chunk: QuoteMsg[] }[] = [];
  for (let i = 0; i < messages.length; i += CHUNK) {
    batches.push({ offset: i, chunk: messages.slice(i, i + CHUNK) });
  }
  const total = batches.length;
  onProgress?.({
    phase: "quotes",
    done: 0,
    total,
    message: `正在提取报价 0/${total} 批…`,
  });
  const perBatch = await mapLimit(
    batches,
    AI_CONCURRENCY,
    async ({ offset, chunk }) => {
      const body = chunk
        .map(
          (m, j) => `#${offset + j} ${m.text.replace(/\n/g, " ").slice(0, 400)}`,
        )
        .join("\n");
      try {
        return parseQuoteJson(await complete(cfg, SYSTEM_QUOTES, body));
      } catch {
        // 单批提取失败跳过，不影响其余批次和报告主体
        return [] as RawQuote[];
      }
    },
    (done) =>
      onProgress?.({
        phase: "quotes",
        done,
        total,
        message: `正在提取报价 ${done}/${total} 批…`,
      }),
  );
  const raw: RawQuote[] = perBatch.flat();
  onProgress?.({
    phase: "quotes",
    done: total,
    total,
    message: "报价提取完成",
  });

  // 回填发言人/群信息 + 刷屏去重（同人同品同价只留一条）
  const seen = new Set<string>();
  const items: QuoteItem[] = [];
  for (const q of raw) {
    const m = messages[q.i];
    if (!m) continue;
    const dedupeKey = `${m.senderId ?? m.senderName ?? "?"}|${q.product}|${q.amount}|${q.currency}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const rate = q.currency ? CNY_RATES[q.currency.toUpperCase()] : undefined;
    const priceCNY =
      typeof q.amount === "number" && q.amount > 0 && rate
        ? Math.round(q.amount * rate)
        : null;

    items.push({
      product: q.product.trim() || "未知产品",
      priceText: q.priceText,
      priceCNY,
      channel: q.channel?.trim() || "未注明",
      seller: m.senderName ?? m.senderUsername ?? "未知发言人",
      sellerUsername: m.senderUsername,
      sellerAvatarKey: m.senderAvatarKey,
      sourceTitle: m.source.title,
      sourceAvatarKey: m.source.avatarKey,
      sourceLink: tgChatLink({
        username: m.source.username,
        tgChatId: m.source.tgChatId,
        type: m.source.type,
      }),
      messageLink: m.messageLink,
    });
  }

  // 可比价的按品类分组，组内升序取最便宜的几条；组间按报价条数降序
  const byProduct = new Map<string, QuoteItem[]>();
  const others: QuoteItem[] = [];
  for (const it of items) {
    if (it.priceCNY === null) {
      others.push(it);
      continue;
    }
    const list = byProduct.get(it.product) ?? [];
    list.push(it);
    byProduct.set(it.product, list);
  }
  const groups = [...byProduct.entries()]
    .map(([product, list]) => ({
      product,
      items: list
        .sort((a, b) => (a.priceCNY ?? 0) - (b.priceCNY ?? 0))
        .slice(0, QUOTE_GROUP_LIMIT),
    }))
    .sort(
      (a, b) =>
        b.items.length - a.items.length ||
        (a.items[0]?.priceCNY ?? 0) - (b.items[0]?.priceCNY ?? 0),
    );

  return { groups, others: others.slice(0, OTHERS_LIMIT) };
}

/**
 * 生成某日报告。scope = "global" 或 source id。
 */
export async function generateReport(
  date: Date,
  scope = "global",
  onProgress?: OnProgress,
): Promise<{ ok: boolean; error?: string; reportId?: string }> {
  const cfg = await loadAiConfig();
  if (!cfg) return { ok: false, error: "AI 未配置（请在设置里填写 API Key）" };

  onProgress?.({
    phase: "loading",
    done: 0,
    total: 1,
    message: "正在拉取当日消息…",
  });

  const { start, end } = dayWindow(date);
  const where = {
    timestamp: { gte: start, lt: end },
    ...(scope !== "global" ? { sourceId: scope } : {}),
  };

  const messages = await prisma.message.findMany({
    where,
    orderBy: { timestamp: "asc" },
    include: { source: true },
  });

  if (messages.length === 0) {
    return { ok: false, error: "该日没有消息可汇总" };
  }

  onProgress?.({
    phase: "loading",
    done: 1,
    total: 1,
    message: `共 ${messages.length} 条消息，开始分析…`,
  });

  const rows: MsgRow[] = messages.map((m) => ({
    text: m.text,
    sourceTitle: m.source.title,
    senderName: m.senderName,
    timestamp: m.timestamp,
  }));

  // 统计
  const bySource = new Map<string, number>();
  for (const m of messages) {
    bySource.set(m.source.title, (bySource.get(m.source.title) ?? 0) + 1);
  }
  const topSources = [...bySource.entries()]
    .map(([title, count]) => ({ title, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const stats: ReportStats = {
    messageCount: messages.length,
    sourceCount: bySource.size,
    topSources,
  };

  // 汇总与报价提取互不依赖，并行跑（各自内部还有 AI_CONCURRENCY 限并发）。
  // summarize 失败要整体报错；quotes 失败只丢报价表，故分别 catch。
  const summaryPromise = summarizeChunks(cfg, rows, onProgress);
  const quotesPromise = extractQuotes(cfg, messages, onProgress).then(
    (quotes) => {
      if (quotes.groups.length > 0 || quotes.others.length > 0) {
        stats.quotes = quotes;
      }
    },
    () => {
      // 报价提取失败：忽略，不影响报告主体
    },
  );

  let summaryMarkdown: string;
  try {
    [summaryMarkdown] = await Promise.all([summaryPromise, quotesPromise]);
  } catch (e) {
    return { ok: false, error: `AI 调用失败：${(e as Error).message}` };
  }

  onProgress?.({
    phase: "saving",
    done: 0,
    total: 1,
    message: "正在保存报告…",
  });

  const report = await prisma.report.upsert({
    where: { date_scope: { date: start, scope } },
    update: {
      summaryMarkdown,
      stats: stats as unknown as Prisma.InputJsonValue,
      model: cfg.model,
      windowStart: start,
      windowEnd: end,
    },
    create: {
      date: start,
      windowStart: start,
      windowEnd: end,
      scope,
      summaryMarkdown,
      topics: [],
      stats: stats as unknown as Prisma.InputJsonValue,
      model: cfg.model,
    },
  });

  // 标记已汇总
  await prisma.message.updateMany({
    where,
    data: { needsSummary: false },
  });

  return { ok: true, reportId: report.id };
}
