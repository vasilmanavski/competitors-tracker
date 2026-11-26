# Runs TypeScript directly: Node >= 22.18 strips types natively, so there is
# no build step and no dist/ folder. Type checking is a separate concern
# (`npm run typecheck`), not part of starting the app.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY drizzle ./drizzle

USER node
EXPOSE 3000
CMD ["node", "src/main.ts"]
