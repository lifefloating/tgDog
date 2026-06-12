"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/input";
import { Avatar } from "@/components/avatar";
import { tgChatLink } from "@/lib/utils";
import type { StreamMessage } from "@/lib/queries";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 超过该长度或行数的消息默认折叠 */
const COLLAPSE_CHARS = 220;
const COLLAPSE_LINES = 5;

export function MessageCard({
  message,
  showAccount,
}: {
  message: StreamMessage;
  showAccount: boolean;
}) {
  const text = message.text ?? "";
  const isLong =
    text.length > COLLAPSE_CHARS ||
    text.split("\n").length > COLLAPSE_LINES;
  const [expanded, setExpanded] = useState(false);
  /** 当前在 lightbox 中查看的图片代理地址，null 表示关闭 */
  const [lightbox, setLightbox] = useState<string | null>(null);
  /** SSR 阶段无 document，挂载后才允许 portal */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // 打开 lightbox 时监听 ESC 关闭
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const images = message.media.filter(
    (m) => m.type === "PHOTO" || m.mimeType?.startsWith("image/"),
  );
  const imageIds = new Set(images.map((m) => m.id));
  const files = message.media.filter((m) => !imageIds.has(m.id));

  const sourceLink = tgChatLink({
    username: message.source.username,
    tgChatId: message.source.tgChatId,
    type: message.source.type,
  });
  const senderName =
    message.senderName ?? message.senderUsername ?? "未知发送人";

  return (
    <Card className="p-4">
      {/* 头部：发送人 + 来源 + 时间 */}
      <div className="mb-2 flex items-center gap-2">
        <Avatar avatarKey={message.senderAvatarKey} name={senderName} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{senderName}</span>
            {message.senderUsername && (
              <a
                href={`https://t.me/${message.senderUsername}`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs font-normal text-muted-foreground hover:text-primary"
              >
                @{message.senderUsername}
              </a>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {sourceLink ? (
              <a
                href={sourceLink}
                target="_blank"
                rel="noreferrer"
                className="truncate hover:text-primary hover:underline"
              >
                {message.source.title}
              </a>
            ) : (
              <span className="truncate">{message.source.title}</span>
            )}
            {showAccount && <span>· {message.account.label}</span>}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {message.dupCount > 1 && (
            <Badge className="border-danger/40 text-danger">
              刷屏 ×{message.dupCount}
            </Badge>
          )}
          {message.isForwarded && <Badge>转发</Badge>}
          <span className="text-xs tabular-nums text-muted-foreground">
            {fmtTime(message.lastSeenAt ?? message.timestamp)}
          </span>
        </div>
      </div>

      {text && (
        <div>
          <p
            className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${
              isLong && !expanded ? "line-clamp-4" : ""
            }`}
          >
            {text}
          </p>
          {isLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-xs text-primary hover:underline"
            >
              {expanded ? "收起 ▲" : "展开全文 ▼"}
            </button>
          )}
        </div>
      )}

      {images.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {images.map((m) => (
            // 点击在页面内弹出 lightbox，不新开 tab
            // eslint-disable-next-line @next/next/no-img-element
            <button
              key={m.id}
              type="button"
              onClick={() => setLightbox(`/api/media/${m.r2Key}`)}
              className="cursor-zoom-in"
            >
              <img
                src={`/api/media/${m.r2Key}`}
                alt={m.fileName ?? "media"}
                loading="lazy"
                className="h-28 w-28 rounded-md border border-border object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {files.map((m) => (
            <a
              key={m.id}
              href={`/api/media/${m.r2Key}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline"
            >
              📎 {m.fileName ?? m.type}
            </a>
          ))}
        </div>
      )}

      {/* 底部：命中规则 + 操作 */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
        {message.rules.map((r) => (
          <Badge key={r.id} className="border-primary/40 text-primary">
            {r.name}
          </Badge>
        ))}
        <div className="ml-auto flex items-center gap-3">
          {message.messageLink && (
            <a
              href={message.messageLink}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground hover:text-primary hover:underline"
            >
              查看原消息 ↗
            </a>
          )}
        </div>
      </div>

      {/* 图片 lightbox：portal 到 body，遮罩覆盖整页，点遮罩 / X / ESC 关闭 */}
      {lightbox &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4"
            onClick={() => setLightbox(null)}
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              onClick={() => setLightbox(null)}
              aria-label="关闭"
              className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-2xl leading-none text-white hover:bg-white/20"
            >
              ×
            </button>
            {/* 阻止点击图片本身冒泡到遮罩导致关闭 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox}
              alt="预览"
              onClick={(e) => e.stopPropagation()}
              className="max-h-[95vh] max-w-[95vw] object-contain"
            />
          </div>,
          document.body,
        )}
    </Card>
  );
}
