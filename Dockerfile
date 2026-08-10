#Build stage 
FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies first (separate layer — only re-runs if package.json changes)
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

#Production stage 
FROM node:20-slim

WORKDIR /app

# Only copy what's needed to run — not dev dependencies or source TS files
COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Xenova/transformers caches the downloaded model here — persisting this
# as a volume (see docker-compose.yml) avoids re-downloading on restarts
ENV TRANSFORMERS_CACHE=/app/.cache

EXPOSE 3000

CMD ["node", "dist/main.js"]