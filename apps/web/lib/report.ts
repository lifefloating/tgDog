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

const CHUNK = 60; // 每批喂给模型的消息条数

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

const SYSTEM_CHUNK =
  "你是一个 Telegram 消息分析助手。请把下面一批消息浓缩成要点（中文），保留关键事件、数字、链接含义。输出简洁的 bullet 列表，不要寒暄。";

const SYSTEM_FINAL =
  "你是一个情报汇总助手。基于多批消息要点，输出一份当日报告（中文 Markdown），包含：1) 总体概述（3-5 句）；2) 按主题分组的要点（用 ## 小标题）；3) 值得关注的重点。简洁、信息密度高，不要寒暄。";

async function summarizeChunks(
  cfg: AiConfig,
  rows: MsgRow[],
): Promise<string> {
  if (rows.length <= CHUNK) {
    return complete(cfg, SYSTEM_FINAL, formatMsgs(rows));
  }
  // map：分批要点
  const partials: string[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    partials.push(await complete(cfg, SYSTEM_CHUNK, formatMsgs(chunk)));
  }
  // reduce：合并成最终报告
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
): Promise<QuoteStats> {
  const raw: RawQuote[] = [];
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    const body = chunk
      .map((m, j) => `#${i + j} ${m.text.replace(/\n/g, " ").slice(0, 400)}`)
      .join("\n");
    try {
      raw.push(...parseQuoteJson(await complete(cfg, SYSTEM_QUOTES, body)));
    } catch {
      // 单批提取失败跳过，不影响其余批次和报告主体
    }
  }

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
): Promise<{ ok: boolean; error?: string; reportId?: string }> {
  const cfg = await loadAiConfig();
  if (!cfg) return { ok: false, error: "AI 未配置（请在设置里填写 API Key）" };

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

  let summaryMarkdown: string;
  try {
    summaryMarkdown = await summarizeChunks(cfg, rows);
  } catch (e) {
    return { ok: false, error: `AI 调用失败：${(e as Error).message}` };
  }

  // 报价提取：失败只丢掉报价表，不影响报告主体
  try {
    const quotes = await extractQuotes(cfg, messages);
    if (quotes.groups.length > 0 || quotes.others.length > 0) {
      stats.quotes = quotes;
    }
  } catch {
    // ignore
  }

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
