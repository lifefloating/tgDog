import type { NextRequest } from "next/server";
import { getMessagesSince, type MessageFilters } from "@/lib/queries";

export const dynamic = "force-dynamic";

const POLL_MS = 3000;
const HEARTBEAT_MS = 25000;

/**
 * SSE 实时消息流：按过滤条件轮询 DB，把新命中/被刷屏顶起的消息推给页面。
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const filters: MessageFilters = {
    sourceId: sp.get("sourceId") ?? undefined,
    accountId: sp.get("accountId") ?? undefined,
    ruleId: sp.get("ruleId") ?? undefined,
    keyword: sp.get("keyword") ?? undefined,
  };

  const encoder = new TextEncoder();
  // 初始游标：优先用页面传来的渲染时间，覆盖「页面渲染 → SSE 建连」之间的消息
  //（可能与首屏列表少量重叠，客户端按 id 合并去重）
  const since = sp.get("since");
  const sinceDate = since ? new Date(since) : null;
  let cursor =
    sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : new Date();
  let closed = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  const cleanup = () => {
    closed = true;
    if (pollTimer) clearTimeout(pollTimer);
    if (pingTimer) clearInterval(pingTimer);
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });

      send(`: connected\n\n`);

      // 递归 setTimeout：上一次查询完成后再排下一次，DB 变慢时不会叠加并发查询
      const poll = async () => {
        if (closed) return;
        try {
          const { messages, nextCursor } = await getMessagesSince(
            cursor,
            filters,
          );
          if (messages.length > 0) {
            cursor = nextCursor;
            send(`data: ${JSON.stringify(messages)}\n\n`);
          }
        } catch (err) {
          console.error("[sse] 拉取增量失败:", (err as Error).message);
        }
        if (!closed) pollTimer = setTimeout(poll, POLL_MS);
      };
      pollTimer = setTimeout(poll, POLL_MS);

      pingTimer = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
