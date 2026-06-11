"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@tgdog/db";

/** 删除账号（级联删除其监控源与消息） */
export async function deleteAccount(id: string) {
  await prisma.account.delete({ where: { id } });
  revalidatePath("/accounts");
  revalidatePath("/sources");
}

/** 重命名账号标签 */
export async function relabelAccount(id: string, label: string) {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("标签不能为空");
  await prisma.account.update({ where: { id }, data: { label: trimmed } });
  revalidatePath("/accounts");
}
