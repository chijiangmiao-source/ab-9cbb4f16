# syntax=docker/dockerfile:1
# 应用镜像：编译后端与前端，运行 HTTP 服务（页面 + /health + /api/*）

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/web-dist ./web-dist
ENV PORT=8080
ENV WEB_ROOT=/app/web-dist
EXPOSE 8080
USER node
CMD ["node", "dist/server/index.js"]
