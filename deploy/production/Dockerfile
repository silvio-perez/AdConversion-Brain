# syntax=docker/dockerfile:1
# Brain application image: gateway, admin CLI and ingestion. Built from source;
# base image pinned by digest (SEC-SUP-3). Runs TypeScript directly on Node 22.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a

ENV NODE_ENV=production \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN corepack enable

# Dependency layer: manifests only, so code changes don't reinstall packages.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/gateway/package.json apps/gateway/
COPY apps/ingest/package.json apps/ingest/
COPY packages/knowledge/package.json packages/knowledge/
COPY tools/skills-sync/package.json tools/skills-sync/
# Optional build secret `extra_ca`: an extra CA certificate for builds behind a
# TLS-inspecting proxy. It is mounted only for this step and never stored in
# the image. Production builds don't need it.
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm install --frozen-lockfile --prod --ignore-scripts \
      --filter @brain/gateway... --filter @brain/ingest...

COPY apps/gateway/src apps/gateway/src
COPY apps/ingest/src apps/ingest/src
COPY packages/knowledge/src packages/knowledge/src
COPY config config

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
ENV BRAIN_DB=/data/gateway.db \
    INGEST_STATE=/data/ingest.db \
    BRAIN_HOST=0.0.0.0
EXPOSE 8787
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/gateway/src/main.ts"]
