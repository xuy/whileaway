FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
# Full install (incl. @better-auth/cli): the release migration below needs it. better-sqlite3
# ships a prebuilt binary for this platform, so no compiler toolchain is required.
RUN npm ci
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
