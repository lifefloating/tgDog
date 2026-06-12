"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@tgdog/db";
import type { SourceType } from "@tgdog/db";
import { collector } from "@/lib/collector";

/** 从 collector 拉取账号的对话列表 */
export async function fetchDialogs(accountId: string) {
  const { dialogs } = await collector.dialogs(accountId);
  return dialogs as {
    tgChatId: string;
    title: string;
    username?: string;
    type: string;
    avatarKey?: string;
  }[];
}

/** 添加/更新一个监控源 */
export async function addSource(input: {
  accountId: string;
  tgChatId: string;
  title: string;
  username?: string;
  type: SourceType;
  avatarKey?: string;
}) {
  await prisma.source.upsert({
    where: {
      accountId_tgChatId: {
        accountId: input.accountId,
        tgChatId: input.tgChatId,
      },
    },
    update: {
      enabled: true,
      title: input.title,
      username: input.username,
      ...(input.avatarKey ? { avatarKey: input.avatarKey } : {}),
    },
    create: {
      accountId: input.accountId,
      tgChatId: input.tgChatId,
      title: input.title,
      username: input.username,
      type: input.type,
      enabled: true,
      avatarKey: input.avatarKey ?? null,
    },
  });

  // 新源自动回填一次历史：实时监听只抓上线后的新消息，先把最近历史补进来，
  // 让消息流不至于一开始是空的。fire-and-forget，失败不影响加源。
  void collector
    .backfillSource(input.accountId, input.tgChatId, 200)
    .catch((err) =>
      console.warn(
        `[sources] 源 ${input.tgChatId} 自动回填失败:`,
        (err as Error).message,
      ),
    );

  revalidatePath("/sources");
}

export async function toggleSource(id: string, enabled: boolean) {
  await prisma.source.update({ where: { id }, data: { enabled } });
  revalidatePath("/sources");
}

export async function deleteSource(id: string) {
  await prisma.source.delete({ where: { id } });
  revalidatePath("/sources");
}
