import { prisma } from "@tgdog/db";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const s = await prisma.setting.findUnique({ where: { id: "singleton" } });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <h1 className="text-lg font-semibold">设置</h1>
      <SettingsForm
        initial={{
          r2AccountId: s?.r2AccountId ?? process.env.R2_ACCOUNT_ID ?? "",
          r2Bucket: s?.r2Bucket ?? process.env.R2_BUCKET ?? "",
          r2Endpoint: s?.r2Endpoint ?? process.env.R2_ENDPOINT ?? "",
          r2PublicUrl: s?.r2PublicUrl ?? process.env.R2_PUBLIC_URL ?? "",
          hasR2AccessKey: !!s?.r2AccessKeyEnc || !!process.env.R2_ACCESS_KEY_ID,
          hasR2SecretKey:
            !!s?.r2SecretKeyEnc || !!process.env.R2_SECRET_ACCESS_KEY,
          aiBaseUrl: s?.aiBaseUrl ?? process.env.OPENAI_BASE_URL ?? "",
          aiModel: s?.aiModel ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
          hasAiApiKey: !!s?.aiApiKeyEnc || !!process.env.OPENAI_API_KEY,
        }}
      />
    </div>
  );
}
