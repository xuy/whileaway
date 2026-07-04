FROM node:20-slim
WORKDIR /app
# better-sqlite3 compiles from source when no matching prebuilt binary is fetched; node:20-slim
# ships without a toolchain, so provide python3/make/g++ for node-gyp.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Full install INCLUDING devDeps: the boot-time `auth:migrate` needs @better-auth/cli (a devDep).
# --include=dev is explicit so a future NODE_ENV=production can't silently drop it and crash-loop
# the container. better-sqlite3 ships a prebuilt binary for this platform (no toolchain needed).
RUN npm ci --include=dev
COPY src ./src
COPY clients ./clients
COPY public ./public
COPY scripts ./scripts
ENV PORT=8080
EXPOSE 8080
# Migrate Better Auth's schema onto the mounted volume, THEN boot. Run at container start (not a
# Fly release_command) because release VMs don't mount the app volume — the auth DB lives on /data.
# `auth:migrate` is idempotent, so re-running on every restart is safe.
CMD ["sh", "-c", "npm run auth:migrate && node src/index.js"]
