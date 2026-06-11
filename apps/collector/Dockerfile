# Collector worker —— 常驻 GramJS 进程
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

# 安装依赖（利用 layer 缓存）
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY apps/collector/package.json apps/collector/
RUN pnpm install --frozen-lockfile || pnpm install

# 拷贝源码
COPY packages ./packages
COPY apps/collector ./apps/collector

# 生成 Prisma client（generate 不连库，占位 DATABASE_URL 仅为通过 prisma.config.ts 的 env 校验；
# 运行时由 compose 注入真实值覆盖）
RUN cd packages/db && DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm exec prisma generate

EXPOSE 8787
CMD ["pnpm", "--filter", "@tgdog/collector", "start"]
