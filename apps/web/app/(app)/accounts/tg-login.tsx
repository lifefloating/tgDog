"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Mode = "qr" | "phone";

async function post(body: unknown) {
  const res = await fetch("/api/tg-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "请求失败");
  return data;
}

export function TgLogin({
  defaultApiId = "",
  defaultApiHash = "",
}: {
  defaultApiId?: string;
  defaultApiHash?: string;
}) {
  const [mode, setMode] = useState<Mode>("qr");
  const [apiId, setApiId] = useState(defaultApiId);
  const [apiHash, setApiHash] = useState(defaultApiHash);
  const [showHash, setShowHash] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [loginId, setLoginId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [needsCode, setNeedsCode] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => () => stopPoll(), [stopPoll]);

  const renderQr = useCallback(async (token: string) => {
    // qrcode 只在真正生成二维码时按需加载，不进首屏 bundle
    const QRCode = (await import("qrcode")).default;
    const url = `tg://login?token=${token}`;
    setQrDataUrl(await QRCode.toDataURL(url, { width: 240, margin: 1 }));
  }, []);

  const startPoll = useCallback(
    (id: string) => {
      stopPoll();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/tg-login?loginId=${id}`);
          const d = await res.json();
          if (d.error) return;
          // 仅在值变化时 setState，避免每 2s 轮询都触发重渲染
          setStatus((prev) => (prev === d.status ? prev : d.status));
          if (d.token) await renderQr(d.token);
          if (d.needsPassword) setNeedsPassword(true);
          if (d.status === "done") {
            stopPoll();
            setStatus("done");
            setTimeout(() => {
              window.location.href = "/sources";
            }, 800);
          }
          if (d.status === "error") {
            stopPoll();
            setError(d.error ?? "登录失败");
          }
        } catch {
          // 忽略瞬时错误，继续轮询
        }
      }, 2000);
    },
    [renderQr, stopPoll],
  );

  async function startQr() {
    setError(null);
    setBusy(true);
    try {
      const d = await post({ action: "qrStart", apiId, apiHash });
      setLoginId(d.loginId);
      if (d.token) await renderQr(d.token);
      setStatus("waiting");
      startPoll(d.loginId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function startPhone() {
    setError(null);
    setBusy(true);
    try {
      const d = await post({ action: "codeStart", apiId, apiHash, phone });
      setLoginId(d.loginId);
      setNeedsCode(true);
      setStatus("waiting");
      startPoll(d.loginId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    if (!loginId) return;
    setBusy(true);
    try {
      await post({ action: "codeSubmit", loginId, code });
      setNeedsCode(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword() {
    if (!loginId) return;
    setBusy(true);
    try {
      await post({ action: "password", loginId, password });
      setNeedsPassword(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex gap-2">
        <Button
          variant={mode === "qr" ? "primary" : "outline"}
          onClick={() => setMode("qr")}
        >
          扫码登录
        </Button>
        <Button
          variant={mode === "phone" ? "primary" : "outline"}
          onClick={() => setMode("phone")}
        >
          手机号登录
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">API ID</span>
          <Input value={apiId} onChange={(e) => setApiId(e.target.value)} placeholder="my.telegram.org 获取" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">API Hash</span>
          <div className="relative">
            <Input
              type={showHash ? "text" : "password"}
              value={apiHash}
              onChange={(e) => setApiHash(e.target.value)}
              placeholder="my.telegram.org 获取"
              className="pr-9"
            />
            <button
              type="button"
              onClick={() => setShowHash((v) => !v)}
              className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
              aria-label={showHash ? "隐藏 API Hash" : "显示 API Hash"}
              title={showHash ? "隐藏" : "显示"}
            >
              {showHash ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </label>
      </div>

      {mode === "qr" ? (
        <div className="space-y-3">
          {!qrDataUrl ? (
            <Button onClick={startQr} disabled={busy || !apiId || !apiHash}>
              {busy ? "生成中…" : "生成二维码"}
            </Button>
          ) : (
            <div className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="登录二维码" className="rounded-lg bg-white p-2" />
              <p className="text-xs text-muted-foreground">
                用手机 Telegram → 设置 → 设备 → 扫描二维码
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">手机号（含国家码，如 +86…）</span>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+8613800138000" />
          </label>
          {!needsCode ? (
            <div className="pt-1">
              <Button onClick={startPhone} disabled={busy || !apiId || !apiHash || !phone}>
                {busy ? "发送中…" : "发送验证码"}
              </Button>
            </div>
          ) : (
            <div className="flex gap-2 pt-1">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="验证码" />
              <Button onClick={submitCode} disabled={busy || !code}>
                提交
              </Button>
            </div>
          )}
        </div>
      )}

      {needsPassword && (
        <div className="space-y-2 rounded-lg border border-border bg-muted p-3">
          <span className="text-xs text-muted-foreground">检测到两步验证，请输入密码</span>
          <div className="flex gap-2">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="二步验证密码"
            />
            <Button onClick={submitPassword} disabled={busy || !password}>
              提交
            </Button>
          </div>
        </div>
      )}

      {status === "done" && (
        <p className="text-sm text-success">登录成功，正在跳转…</p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}
