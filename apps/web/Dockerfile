# Next.js web —— standalone 产物
FROM node:24-alpine AS builder
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile || pnpm install

COPY packages ./packages
COPY apps/web ./apps/web

# 保证 public 目录存在（即使源仓库未提供），供运行阶段 COPY 使用
RUN mkdir -p apps/web/public

# 构建时不连库（generate 与 next build 均不需要真实连接），用占位 DATABASE_URL
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
# 生成 Prisma client 后构建
RUN cd packages/db && pnpm exec prisma generate
RUN pnpm --filter @tgdog/web build

# ===== 运行阶段 =====
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# standalone 产物（含最小 node_modules + workspace 依赖）
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
