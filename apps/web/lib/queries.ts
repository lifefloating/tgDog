import { prisma } from "@tgdog/db";
import type { Prisma } from "@tgdog/db";

const PAGE_SIZE = 30;

export interface MessageFilters {
  sourceId?: string;
  accountId?: string;
  ruleId?: string;
  keyword?: string;
  page?: number;
}

/** 传给客户端组件的消息结构（日期已序列化为 ISO 字符串） */
export interface StreamMessage {
  id: string;
  text: string;
  timestamp: string;
  lastSeenAt: string | null;
  dupCount: number;
  messageLink: string | null;
  isForwarded: boolean;
  senderName: string | null;
  senderUsername: string | null;
  senderAvatarKey: string | null;
  source: {
    id: string;
    title: string;
    username: string | null;
    tgChatId: string;
    type: string;
    avatarKey: string | null;
  };
  account: { id: string; label: string };
  rules: { id: string; name: string }[];
  media: {
    id: string;
    type: string;
    r2Key: string;
    r2Url: string;
    fileName: string | null;
    mimeType: string | null;
  }[];
}

const messageInclude = {
  media: {
    select: {
      id: true,
      type: true,
      r2Key: true,
      r2Url: true,
      fileName: true,
      mimeType: true,
    },
  },
  source: {
    select: {
      id: true,
      title: true,
      username: true,
      tgChatId: true,
      type: true,
      avatarKey: true,
    },
  },
  account: { select: { id: true, label: true } },
  ruleHits: { select: { rule: { select: { id: true, name: true } } } },
} satisfies Prisma.MessageInclude;

type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

function serializeMessage(m: MessageRow): StreamMessage {
  return {
    id: m.id,
    text: m.text,
    timestamp: m.timestamp.toISOString(),
    lastSeenAt: m.lastSeenAt?.toISOString() ?? null,
    dupCount: m.dupCount,
    messageLink: m.messageLink,
    isForwarded: m.isForwarded,
    senderName: m.senderName,
    senderUsername: m.senderUsername,
    senderAvatarKey: m.senderAvatarKey,
    source: m.source,
    account: m.account,
    rules: m.ruleHits.map((h) => h.rule),
    media: m.media,
  };
}

function buildWhere(filters: MessageFilters): Prisma.MessageWhereInput {
  const where: Prisma.MessageWhereInput = {};
  if (filters.sourceId) where.sourceId = filters.sourceId;
  if (filters.accountId) where.accountId = filters.accountId;
  if (filters.ruleId) where.ruleHits = { some: { ruleId: filters.ruleId } };
  if (filters.keyword) {
    where.text = { contains: filters.keyword, mode: "insensitive" };
  }
  return where;
}

/** 列表排序：刷屏被顶起（lastSeenAt 优先），老数据回落到消息时间 */
const messageOrderBy: Prisma.MessageOrderByWithRelationInput[] = [
  { lastSeenAt: { sort: "desc", nulls: "last" } },
  { timestamp: "desc" },
];

export async function getMessages(filters: MessageFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const where = buildWhere(filters);

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: messageOrderBy,
      include: messageInclude,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.message.count({ where }),
  ]);

  return {
    messages: messages.map(serializeMessage),
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/** 增量拉取：cursor 之后新建或被刷屏顶起的消息（SSE 轮询用） */
export async function getMessagesSince(cursor: Date, filters: MessageFilters) {
  const where: Prisma.MessageWhereInput = {
    AND: [
      buildWhere(filters),
      {
        OR: [
          { createdAt: { gt: cursor } },
          { lastSeenAt: { gt: cursor } },
        ],
      },
    ],
  };

  const rows = await prisma.message.findMany({
    where,
    orderBy: messageOrderBy,
    include: messageInclude,
    take: 50,
  });

  let nextCursor = cursor;
  for (const m of rows) {
    const seen = m.lastSeenAt && m.lastSeenAt > m.createdAt ? m.lastSeenAt : m.createdAt;
    if (seen > nextCursor) nextCursor = seen;
  }

  return { messages: rows.map(serializeMessage), nextCursor };
}

export async function getEnabledSources() {
  return prisma.source.findMany({
    where: { enabled: true },
    orderBy: { title: "asc" },
  });
}

export async function getDashboardStats() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [today, sources, rules] = await Promise.all([
    prisma.message.count({ where: { timestamp: { gte: since } } }),
    prisma.source.count({ where: { enabled: true } }),
    prisma.rule.count({ where: { enabled: true } }),
  ]);
  return { today, sources, rules };
}
