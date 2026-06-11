"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCard } from "@/components/message-card";
import type { StreamMessage } from "@/lib/queries";

const MAX_MESSAGES = 100;

function sortKey(m: StreamMessage): number {
  return Date.parse(m.lastSeenAt ?? m.timestamp);
}

/**
 * 实时消息流：SSE 订阅新命中的消息，前插到列表；
 * 刷屏去重的消息（dupCount 增加）会更新计数并被顶到最前。
 * 筛选/翻页变化由父组件通过 key 重挂载本组件来重置列表。
 */
export function MessageStream({
  initial,
  streamQuery,
  since,
  live,
  showAccount,
}: {
  initial: StreamMessage[];
  /** 透传给 SSE 接口的过滤参数（已含 ?，可为空串） */
  streamQuery: string;
  /** 服务端渲染时间（ISO），作为 SSE 初始游标，覆盖渲染→建连之间的消息 */
  since: string;
  /** 仅第一页开启实时订阅 */
  live: boolean;
  showAccount: boolean;
}) {
  const [messages, setMessages] = useState(initial);
  const [connected, setConnected] = useState(false);
  // 固定首次挂载时的值，父组件重渲染不触发 SSE 重连
  const sinceRef = useRef(since);

  useEffect(() => {
    if (!live) return;
    const sep = streamQuery ? "&" : "?";
    const es = new EventSource(
      `/api/messages/stream${streamQuery}${sep}since=${encodeURIComponent(sinceRef.current)}`,
    );
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      const incoming: StreamMessage[] = JSON.parse(ev.data);
      setMessages((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        for (const m of incoming) byId.set(m.id, m);
        const merged = Array.from(byId.values());
        // 预先算好排序键，避免比较器里反复 Date.parse
        const keys = new Map(merged.map((m) => [m.id, sortKey(m)]));
        return merged
          .sort((a, b) => keys.get(b.id)! - keys.get(a.id)!)
          .slice(0, MAX_MESSAGES);
      });
    };
    return () => {
      es.close();
      setConnected(false);
    };
  }, [streamQuery, live]);

  return (
    <div className="space-y-3">
      {live && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={`h-2 w-2 rounded-full ${
              connected ? "animate-pulse bg-success" : "bg-muted-foreground"
            }`}
            aria-hidden
          />
          {connected ? "实时监听中，新命中的消息会自动出现" : "连接中…"}
        </div>
      )}

      {messages.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          还没有命中的消息。确认 collector 已连接、监控源与规则已配置。
        </p>
      ) : (
        messages.map((m) => (
          // content-visibility 跳过视口外卡片的渲染，长列表滚动更顺
          <div
            key={m.id}
            className="[contain-intrinsic-size:auto_150px] [content-visibility:auto]"
          >
            <MessageCard message={m} showAccount={showAccount} />
          </div>
        ))
      )}
    </div>
  );
}
