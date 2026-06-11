"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TgLogin } from "./tg-login";

/** 默认只显示「+ 添加账号」按钮，点击后展开登录表单 */
export function AddAccount({
  defaultApiId,
  defaultApiHash,
}: {
  defaultApiId: string;
  defaultApiHash: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>＋ 添加账号</Button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">添加账号</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          收起
        </button>
      </div>
      <TgLogin defaultApiId={defaultApiId} defaultApiHash={defaultApiHash} />
    </div>
  );
}
