FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget git ca-certificates golang-go \
    && rm -rf /var/lib/apt/lists/*

ARG HUGO_VERSION=0.147.0
ARG TARGETARCH
RUN wget -qO- "https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_linux-${TARGETARCH}.tar.gz" \
    | tar xz -C /usr/local/bin hugo

WORKDIR /app

COPY site/go.mod site/go.sum ./site/
COPY site/hugo.yaml ./site/
COPY site/content/ ./site/content/

WORKDIR /app/site
RUN hugo mod get

WORKDIR /app
COPY scripts/package.json ./scripts/
RUN cd scripts && npm install --omit=dev

COPY scripts/export-hugo.mjs ./scripts/
COPY scripts/rebuild-site.mjs ./scripts/

ENV NODE_PATH=/app/scripts/node_modules

ENTRYPOINT ["node", "scripts/rebuild-site.mjs"]
