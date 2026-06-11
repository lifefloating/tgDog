/**
 * 规则匹配逻辑 —— 从参考项目 telegram-monitor/monitors/keyword_monitor.py 移植。
 * 支持 EXACT（精确）/ PARTIAL（模糊包含，默认）/ REGEX（正则）。
 */

export type MatchType = "EXACT" | "PARTIAL" | "REGEX";

export interface SenderFilter {
  mode: "whitelist" | "blacklist";
  ids: string[]; // tg user id 或 username（不含 @）
}

export type ScopeMode = "ALL" | "SELECTED";

export interface RuleLike {
  id: string;
  keyword: string | null;
  matchType: MatchType;
  caseSensitive: boolean;
  senderFilter: unknown; // Json，运行时校验
  mediaOnly: boolean;
  // 作用域：ALL=全部启用源；SELECTED=仅 sourceIds 内的源
  scopeMode: ScopeMode;
  sourceIds: string[];
}

export interface MessageLike {
  text: string;
  hasMedia: boolean;
  senderId?: string | null;
  senderUsername?: string | null;
  sourceId: string;
}

/**
 * 关键词匹配（不含发送人/媒体过滤）。keyword 为空表示匹配全部。
 *
 * EXACT / PARTIAL 支持多关键词组合：
 * - 用 `|`、`,`、`，`、`、` 或换行分隔多组词 → 任一组命中即命中（OR）
 * - 组内用 `+` 连接多个词 → 该组要求全部出现（AND）
 *   例：`gemini+拼车|出kiro|卡网` 命中「gemini 12个月拼车」「出kiro 25块」「联系卡网」
 * REGEX 模式下 keyword 原样作为正则使用。
 */
export function matchesKeyword(rule: RuleLike, text: string): boolean {
  const keyword = rule.keyword?.trim();
  if (!keyword) return true; // 无关键词 = 匹配该源全部消息

  if (rule.matchType === "REGEX") {
    try {
      const re = new RegExp(keyword, rule.caseSensitive ? "" : "i");
      return re.test(text);
    } catch {
      return false; // 非法正则不匹配
    }
  }

  // OR 组：任意一组命中即可
  const groups = keyword
    .split(/[|,，、\n]/)
    .map((g) => g.trim())
    .filter(Boolean);
  if (groups.length === 0) return true;

  return groups.some((group) => {
    // AND 词：组内全部出现才算命中
    const terms = group
      .split("+")
      .map((t) => t.trim())
      .filter(Boolean);
    return terms.every((term) => matchesSingleTerm(rule, text, term));
  });
}

/** 单个词按 matchType 匹配 */
function matchesSingleTerm(
  rule: RuleLike,
  text: string,
  term: string,
): boolean {
  const haystack = rule.caseSensitive ? text : text.toLowerCase();
  const needle = rule.caseSensitive ? term : term.toLowerCase();

  switch (rule.matchType) {
    case "EXACT": {
      // 整词匹配：用单词边界；中文无边界时退化为整段相等
      if (/^[\w\s]+$/.test(needle)) {
        const re = new RegExp(
          `(^|\\W)${escapeRegExp(needle)}(\\W|$)`,
          rule.caseSensitive ? "" : "i",
        );
        return re.test(text);
      }
      return haystack === needle;
    }
    case "PARTIAL":
      return haystack.includes(needle);
    default:
      return false;
  }
}

function parseSenderFilter(raw: unknown): SenderFilter | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Partial<SenderFilter>;
  if (
    (f.mode === "whitelist" || f.mode === "blacklist") &&
    Array.isArray(f.ids)
  ) {
    return { mode: f.mode, ids: f.ids.map(String) };
  }
  return null;
}

/** 发送人是否通过过滤 */
export function passesSenderFilter(
  rule: RuleLike,
  msg: MessageLike,
): boolean {
  const filter = parseSenderFilter(rule.senderFilter);
  if (!filter || filter.ids.length === 0) return true;

  const candidates = [msg.senderId, msg.senderUsername]
    .filter((v): v is string => !!v)
    .map((v) => v.replace(/^@/, ""));

  const inList = filter.ids.some((id) =>
    candidates.includes(id.replace(/^@/, "")),
  );
  return filter.mode === "whitelist" ? inList : !inList;
}

/**
 * 完整判定一条消息是否命中某规则（关键词 + 发送人 + 媒体 + 作用域）。
 */
export function ruleMatches(rule: RuleLike, msg: MessageLike): boolean {
  // 作用域：SELECTED 时消息源必须在勾选列表内；ALL 时对所有源生效
  if (rule.scopeMode === "SELECTED" && !rule.sourceIds.includes(msg.sourceId)) {
    return false;
  }
  if (rule.mediaOnly && !msg.hasMedia) return false;
  if (!passesSenderFilter(rule, msg)) return false;
  return matchesKeyword(rule, msg.text);
}

/** 返回命中的规则 id 列表 */
export function matchedRuleIds(rules: RuleLike[], msg: MessageLike): string[] {
  return rules.filter((r) => ruleMatches(r, msg)).map((r) => r.id);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
