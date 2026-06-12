import { type NextRequest } from "next/server";
import { prisma } from "@tgdog/db";
import { generateReport, type ReportProgress } from "@/lib/report";

// AI 串行调用较多，给足执行时间（秒）。部署在有超时限制的平台时按需调整。
export const maxDuration = 300;

/**
 * SSE 流式生成报告：边生成边推送进度，前端用 EventSource 消费。
 * 用 GET（EventSource 只支持 GET），参数走 query。
 * 事件：
 *   event: progress  data: ReportProgress
 *   event: done      data: { ok, reportId }
 *   event: error     data: { error }
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get("date") ?? undefined;
  const scope = searchParams.get("scope") ?? "global";
  const force = searchParams.get("force") === "true";

  // 与非流式路由保持一致：YYYY-MM-DD 按服务器本地午夜解析
  const date = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        if (Number.isNaN(date.getTime())) {
          send("error", { error: "日期格式不正确" });
          return;
        }

        // 同一天同 scope 已有报告时，必须显式 force 才允许重新生成
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const existing = await prisma.report.findUnique({
          where: { date_scope: { date: dayStart, scope } },
          select: { id: true },
        });
        if (existing && !force) {
          send("error", { error: "该日报告已存在，如需覆盖请使用重新生成" });
          return;
        }

        const result = await generateReport(date, scope, (p: ReportProgress) =>
          send("progress", p),
        );

        if (!result.ok) {
          send("error", { error: result.error ?? "生成失败" });
          return;
        }
        send("done", { ok: true, reportId: result.reportId });
      } catch (e) {
        send("error", { error: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 禁用 Nginx 等反代缓冲，保证进度实时到达
      "X-Accel-Buffering": "no",
    },
  });
}
