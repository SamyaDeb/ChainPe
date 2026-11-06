# Build with this folder as the context. Files are copied by name, so no .env can reach the image.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY drizzle ./drizzle
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
