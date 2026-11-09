FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/paylink-solana/package.json apps/paylink-solana/package.json
COPY packages/paylink-core/package.json packages/paylink-core/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter paylink-solana build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/apps/paylink-solana/.next/standalone ./
COPY --from=build /app/apps/paylink-solana/.next/static ./apps/paylink-solana/.next/static
COPY --from=build /app/apps/paylink-solana/public ./apps/paylink-solana/public
COPY --from=build /app/apps/paylink-solana/app/fonts ./apps/paylink-solana/app/fonts
EXPOSE 3000
WORKDIR /app/apps/paylink-solana
CMD ["node", "server.js"]
