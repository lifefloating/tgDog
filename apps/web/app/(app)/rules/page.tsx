import { prisma } from "@tgdog/db";
import { RuleForm } from "./rule-form";
import { RuleList } from "./rule-list";
import { RuleTest } from "./rule-test";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const [rules, sources] = await Promise.all([
    prisma.rule.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        sources: { select: { id: true, title: true } },
        _count: { select: { hits: true } },
      },
    }),
    prisma.source.findMany({
      where: { enabled: true },
      orderBy: { title: "asc" },
    }),
  ]);

  const sourceOptions = sources.map((s) => ({ id: s.id, title: s.title }));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <h1 className="text-lg font-semibold">规则 / 主题</h1>
      <RuleForm sources={sourceOptions} />
      <RuleTest />
      <RuleList
        sources={sourceOptions}
        rules={rules.map((r) => ({
          id: r.id,
          name: r.name,
          keyword: r.keyword,
          matchType: r.matchType,
          enabled: r.enabled,
          mediaOnly: r.mediaOnly,
          caseSensitive: r.caseSensitive,
          scopeMode: r.scopeMode,
          sourceIds: r.sources.map((s) => s.id),
          sourceTitles: r.sources.map((s) => s.title),
          hitCount: r._count.hits,
        }))}
      />
    </div>
  );
}
