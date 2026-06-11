"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/input";
import { Avatar } from "@/components/avatar";
import { deleteAccount, relabelAccount } from "./actions";

export interface AccountItem {
  id: string;
  label: string;
  tgUsername: string | null;
  avatarKey: string | null;
  status: string;
}

const statusLabel: Record<string, string> = {
  ACTIVE: "已连接",
  PENDING: "待登录",
  DISCONNECTED: "已断开",
};

export function AccountList({ accounts }: { accounts: AccountItem[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function rename(a: AccountItem) {
    const label = window.prompt("账号标签：", a.label);
    if (!label || label === a.label) return;
    setError(null);
    startTransition(async () => {
      try {
        await relabelAccount(a.id, label);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function remove(a: AccountItem) {
    if (
      !window.confirm(
        `确定删除账号「${a.label}」？其下的监控源与已采集消息会一并删除。`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await deleteAccount(a.id);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  if (accounts.length === 0) return null;

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-danger">{error}</p>}
      {accounts.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
        >
          <Avatar avatarKey={a.avatarKey} name={a.label} />
          <span className="flex-1 truncate">{a.label}</span>
          {a.tgUsername && (
            <a
              href={`https://t.me/${a.tgUsername}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground hover:text-primary"
            >
              @{a.tgUsername}
            </a>
          )}
          <Badge>{statusLabel[a.status] ?? a.status}</Badge>
          <button
            disabled={pending}
            onClick={() => rename(a)}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            改名
          </button>
          <button
            disabled={pending}
            onClick={() => remove(a)}
            className="text-xs text-danger hover:underline"
          >
            删除
          </button>
        </div>
      ))}
    </div>
  );
}
