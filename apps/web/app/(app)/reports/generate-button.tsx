"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Phase = "loading" | "summarize" | "quotes" | "saving";

interface Progress {
  phase: Phase;
  done: number;
  total: number;
  message: string;
}

// 各阶段在总进度条中占的权重。summarize 与 quotes 现在并行执行，
// 它们的进度各自独立累加（互不依赖），故按各自 fraction 分别计权。
const PHASE_WEIGHT: Record<Phase, number> = {
  loading: 0.05,
  summarize: 0.5,
  quotes: 0.4,
  saving: 0.05,
};

/** 由各阶段最新 fraction 算总百分比；只增不减，避免并行事件让进度条回退 */
function combinedPercent(fractions: Partial<Record<Phase, number>>): number {
  let acc = 0;
  for (const ph of Object.keys(PHASE_WEIGHT) as Phase[]) {
    acc += PHASE_WEIGHT[ph] * (fractions[ph] ?? 0);
  }
  return Math.round(acc * 100);
}

export function GenerateButton({ hasToday }: { hasToday: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  // 各阶段最新 fraction（0~1）。并行阶段各算各的，合成时只增不减。
  const fractionsRef = useRef<Partial<Record<Phase, number>>>({});

  function generate() {
    // 今日报告已存在时需用户确认才重新生成（覆盖旧报告，重新消耗 AI 调用）
    if (hasToday && !window.confirm("今日报告已存在，确定要重新生成并覆盖吗？")) {
      return;
    }
    setLoading(true);
    setError(null);
    setPercent(0);
    setMessage("正在准备…");
    fractionsRef.current = {};

    const params = new URLSearchParams({
      scope: "global",
      force: String(hasToday),
    });
    const es = new EventSource(`/api/reports/generate/stream?${params}`);
    esRef.current = es;

    const cleanup = () => {
      es.close();
      esRef.current = null;
      setLoading(false);
    };

    es.addEventListener("progress", (e) => {
      try {
        const p = JSON.parse((e as MessageEvent).data) as Progress;
        const frac = p.total > 0 ? Math.min(p.done / p.total, 1) : 0;
        // 同阶段 fraction 只增不减（并行批次完成顺序不定）
        const prev = fractionsRef.current[p.phase] ?? 0;
        fractionsRef.current[p.phase] = Math.max(prev, frac);
        setPercent((cur) => Math.max(cur, combinedPercent(fractionsRef.current)));
        setMessage(p.message);
      } catch {
        // 忽略坏帧
      }
    });

    es.addEventListener("done", () => {
      cleanup();
      router.refresh();
    });

    es.addEventListener("error", (e) => {
      // 服务端主动发的 error 事件带 data；网络/连接中断则没有 data
      let msg = "生成失败（连接中断）";
      const data = (e as MessageEvent).data;
      if (data) {
        try {
          msg = (JSON.parse(data) as { error?: string }).error ?? msg;
        } catch {
          // keep default
        }
      }
      cleanup();
      setError(msg);
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3">
        <Button onClick={generate} disabled={loading}>
          {loading
            ? "生成中…"
            : hasToday
              ? "重新生成今日报告"
              : "生成今日报告"}
        </Button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>

      {loading && (
        <div className="w-64 max-w-[70vw]">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span className="truncate">{message ?? "正在准备…"}</span>
            <span className="tabular-nums">{percent}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${Math.max(percent, 4)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
