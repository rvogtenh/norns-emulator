# norns-emulator — Node gateway + real Lua 5.3 (matron-shim)
FROM node:24-bookworm-slim

# Lua 5.3 runs the matron-shim (the real norns scripts execute here).
RUN apt-get update \
    && apt-get install -y --no-install-recommends lua5.3 git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install node deps first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# App sources
COPY server ./server
COPY matron ./matron
COPY web ./web

ENV PORT=5151
ENV SCRIPTS_DIR=/scripts
EXPOSE 5151

CMD ["node", "server/index.js"]
