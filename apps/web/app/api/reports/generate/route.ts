import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@tgdog/db";
import { generateReport } from "@/lib/report";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const dateStr = body.date as string | undefined;
  const scope = (body.scope as string | undefined) ?? "global";
  const force = body.force === true;
  // YYYY-MM-DD 按服务器本地午夜解析，与报告存储/详情页查询保持同一时区
  const date = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "日期格式不正确" }, { status: 400 });
  }

  // 同一天同 scope 已有报告时，必须显式 force 才允许重新生成（避免重复消耗 AI 调用）
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const existing = await prisma.report.findUnique({
    where: { date_scope: { date: dayStart, scope } },
    select: { id: true },
  });
  if (existing && !force) {
    return NextResponse.json(
      { error: "该日报告已存在，如需覆盖请使用重新生成" },
      { status: 409 },
    );
  }

  const result = await generateReport(date, scope);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
