import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** 可选：自定义 endpoint；默认用 accountId 拼 Cloudflare R2 endpoint */
  endpoint?: string;
  /** 公开访问域名，如 https://media.example.com 或 r2.dev 域名 */
  publicUrl: string;
}

function buildClient(cfg: R2Config): S3Client {
  const endpoint =
    cfg.endpoint ?? `https://${cfg.accountId}.r2.cloudflarestorage.com`;
  // 自定义 endpoint（如本地 MinIO）用 path-style 寻址；R2 也兼容 path-style
  const forcePathStyle = !!cfg.endpoint;
  return new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

/**
 * 上传 Buffer 到 R2，返回可公开访问的 URL。
 */
export async function uploadBuffer(
  cfg: R2Config,
  key: string,
  body: Buffer,
  contentType?: string,
): Promise<string> {
  const client = buildClient(cfg);
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  const base = cfg.publicUrl.replace(/\/$/, "");
  return `${base}/${key}`;
}

/** 生成媒体存储 key：messages/<date>/<messageId>/<filename> */
export function buildMediaKey(
  messageId: string,
  fileName: string,
  isoDate: string,
): string {
  const day = isoDate.slice(0, 10);
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `messages/${day}/${messageId}/${safeName}`;
}

/**
 * 读取 R2 对象（私有桶代理读取用）。不存在/出错返回 null。
 */
export async function getObject(
  cfg: R2Config,
  key: string,
): Promise<{ body: Buffer; contentType?: string } | null> {
  const client = buildClient(cfg);
  try {
    const res = await client.send(
      new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
    );
    if (!res.Body) return null;
    const bytes = await res.Body.transformToByteArray();
    return { body: Buffer.from(bytes), contentType: res.ContentType };
  } catch {
    return null;
  }
}

/** 生成头像存储 key：avatars/<kind>/<id>.jpg */
export function buildAvatarKey(
  kind: "account" | "source" | "sender",
  id: string,
): string {
  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `avatars/${kind}/${safeId}.jpg`;
}
