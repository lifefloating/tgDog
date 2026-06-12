import { NextResponse, type NextRequest } from "next/server";
import { getObject } from "@tgdog/core";
import { loadR2Config } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * 私有 R2 桶媒体代理读取：/api/media/messages/<date>/<messageId>/<filename>
 * 仅允许 messages/ 前缀，禁止目录穿越。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key: segments } = await params;
  const key = segments.join("/");

  // 安全校验：必须以 messages/ 开头，且不含路径穿越
  if (!key.startsWith("messages/") || key.includes("..")) {
    return NextResponse.json({ error: "非法 key" }, { status: 400 });
  }

  const cfg = await loadR2Config();
  if (!cfg) {
    return NextResponse.json({ error: "R2 未配置" }, { status: 404 });
  }

  const obj = await getObject(cfg, key);
  if (!obj) {
    return NextResponse.json({ error: "媒体不存在" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(obj.body), {
    status: 200,
    headers: {
      "content-type": obj.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=86400",
    },
  });
}
