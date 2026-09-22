FROM golang:1.26.6-bookworm AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-w -s" -o /out/google-maps-scraper . \
    && CGO_ENABLED=0 go build -o /out/playwright github.com/mxschmitt/playwright-go/cmd/playwright

FROM node:22-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
ENV PLAYWRIGHT_DRIVER_PATH=/opt/ms-playwright-go
ENV PLAYWRIGHT_NODEJS_PATH=/usr/local/bin/node
ENV DISABLE_TELEMETRY=1
ENV APIFY_LOCAL_STORAGE_DIR=/app/storage
COPY --from=builder /out/google-maps-scraper /usr/bin/google-maps-scraper
COPY --from=builder /out/playwright /usr/bin/playwright
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && playwright install chromium --with-deps \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY apify/package.json apify/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY apify/core.mjs apify/run.mjs apify/main.mjs ./
COPY LICENSE ./LICENSE
ENTRYPOINT ["node", "main.mjs"]
