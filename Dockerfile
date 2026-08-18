# Run the target without a Node toolchain:
#   docker build -t scraping-guards .
#   docker run --rm -p 8080:8080 scraping-guards
FROM node:20-slim

# openssl is only needed for guard 60 (mutual TLS); the server degrades
# gracefully without it, but the mTLS listener is skipped.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
# No runtime dependencies — Playwright is dev-only — so this stays empty and fast.
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

EXPOSE 8080 8081
ENV PORT=8080
CMD ["node", "bin/scraping-guards.js", "serve"]
