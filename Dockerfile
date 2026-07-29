FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json .
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY src/admin/dashboard.html ./dist/admin/dashboard.html
EXPOSE 8080
HEALTHCHECK --interval=5s --retries=10 \
  CMD wget -qO- http://localhost:8080/rest/api/2/serverInfo || exit 1
CMD ["node", "dist/index.js"]
