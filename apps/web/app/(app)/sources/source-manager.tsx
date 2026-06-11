"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/input";
import { Avatar } from "@/components/avatar";
import { tgChatLink } from "@/lib/utils";
import {
  addSource,
  deleteSource,
  fetchDialogs,
  toggleSource,
} from "./actions";

interface Account {
  id: string;
  label: string;
}
interface ExistingSource {
  id: string;
  tgChatId: string;
  title: string;
  username?: string | null;
  type: string;
  enabled: boolean;
  avatarKey?: string | null;
  accountLabel: string;
}
interface Dialog {
  tgChatId: string;
  title: string;
  username?: string;
  type: string;
  avatarKey?: string;
}

export function SourceManager({
  accounts,
  existing,
}: {
  accounts: Account[];
  existing: ExistingSource[];
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [dialogs, setDialogs] = useState<Dialog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [acting, startAct] = useTransition();

  const existingChatIds = new Set(existing.map((s) => s.tgChatId));

  function loadDialogs() {
    if (!accountId) return;
    setError(null);
    startLoad(async () => {
      try {
        setDialogs(await fetchDialogs(accountId));
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="space-y-5">
      {accounts.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          还没有已登录账号。先去{" "}
          <a href="/login" className="text-primary hover:underline">
            登录
          </a>{" "}
          一个 Telegram 账号。
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="h-9 rounded-md border border-border bg-muted px-2 text-sm"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <Button onClick={loadDialogs} disabled={loading} variant="outline">
            {loading ? "拉取中…" : "拉取对话列表"}
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}

      {/* 可添加的对话 */}
      {dialogs.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-sm font-semibold">选择要监控的对话</div>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {dialogs.map((d) => {
              const added = existingChatIds.has(d.tgChatId);
              return (
                <div
                  key={d.tgChatId}
                  className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
                >
                  <Avatar avatarKey={d.avatarKey} name={d.title} />
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  <Badge>{d.type}</Badge>
                  <button
                    disabled={added || acting}
                    onClick={() =>
                      startAct(() =>
                        addSource({
                          accountId,
                          tgChatId: d.tgChatId,
                          title: d.title,
                          username: d.username,
                          type: d.type as never,
                          avatarKey: d.avatarKey,
                        }).then(() => {})
                      )
                    }
                    className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-40"
                  >
                    {added ? "已添加" : "添加"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 已监控源 */}
      <div className="space-y-1.5">
        <div className="text-sm font-semibold">已监控源</div>
        {existing.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">还没有监控源。</p>
        ) : (
          existing.map((s) => {
            const link = tgChatLink({
              username: s.username,
              tgChatId: s.tgChatId,
              type: s.type,
            });
            return (
              <div
                key={s.id}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <Avatar avatarKey={s.avatarKey} name={s.title} />
                {link ? (
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate hover:text-primary hover:underline"
                    title="在 Telegram 中打开"
                  >
                    {s.title} ↗
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                )}
                <Badge>{s.type}</Badge>
                {accounts.length > 1 && <Badge>{s.accountLabel}</Badge>}
                <button
                  disabled={acting}
                  onClick={() =>
                    startAct(() => toggleSource(s.id, !s.enabled).then(() => {}))
                  }
                  className={`rounded-md px-2 py-1 text-xs ${
                    s.enabled
                      ? "bg-success/20 text-success"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {s.enabled ? "监控中" : "已暂停"}
                </button>
                <button
                  disabled={acting}
                  onClick={() =>
                    startAct(() => deleteSource(s.id).then(() => {}))
                  }
                  className="text-xs text-danger hover:underline"
                >
                  删除
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
