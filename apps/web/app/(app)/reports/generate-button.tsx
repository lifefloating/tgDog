"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function GenerateButton({ hasToday }: { hasToday: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    // 今日报告已存在时需用户确认才重新生成（覆盖旧报告，重新消耗 AI 调用）
    if (hasToday && !window.confirm("今日报告已存在，确定要重新生成并覆盖吗？")) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "global", force: hasToday }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "生成失败");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button onClick={generate} disabled={loading}>
        {loading
          ? "生成中…（可能需要几十秒）"
          : hasToday
            ? "重新生成今日报告"
            : "生成今日报告"}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
