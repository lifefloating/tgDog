import { prisma } from "@tgdog/db";
import { AccountList } from "./account-list";
import { AddAccount } from "./add-account";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const accounts = await prisma.account.findMany({
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <h1 className="text-lg font-semibold">账号</h1>

      <AccountList
        accounts={accounts.map((a) => ({
          id: a.id,
          label: a.label,
          tgUsername: a.tgUsername,
          avatarKey: a.avatarKey,
          status: a.status,
        }))}
      />

      <AddAccount
        defaultApiId={process.env.TELEGRAM_API_ID ?? ""}
        defaultApiHash={process.env.TELEGRAM_API_HASH ?? ""}
      />
    </div>
  );
}
