import { NextResponse, type NextRequest } from "next/server";
import { checkPassword, issueToken, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({ password: "" }));
  if (!checkPassword(String(password ?? ""))) {
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }
  // 仅在请求确实走 HTTPS 时才加 Secure；否则用 http://<ip>:3000 访问时
  // 浏览器会静默丢弃该 cookie，导致“密码对了却进不去”的死循环。
  // 反向代理（Nginx/Caddy）会用 x-forwarded-proto 透传真实协议。
  const isHttps =
    req.nextUrl.protocol === "https:" ||
    req.headers.get("x-forwarded-proto") === "https";
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, issueToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
