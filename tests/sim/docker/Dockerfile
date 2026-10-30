# Multi-provider simulation in a container: the same orchestrator as `npm run sim:small`, on the Playwright image that
# matches the pinned `playwright` (1.64.0). No secrets, no deploy: keys and the CA are generated per run inside it.
#   docker compose -f tests/sim/docker/compose.yaml run --rm sim            # small scale, gate checks
#   docker compose -f tests/sim/docker/compose.yaml run --rm sim --screenshots
FROM mcr.microsoft.com/playwright:v1.64.0-noble
# package.json engines require Node >= 24; the image ships an older Node.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl openssl xz-utils \
 && curl -fsSL https://nodejs.org/dist/v24.6.0/node-v24.6.0-linux-$(dpkg --print-architecture | sed 's/amd64/x64/').tar.xz -o /tmp/node.tar.xz \
 && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
 && rm -rf /tmp/node.tar.xz /var/lib/apt/lists/*
WORKDIR /work
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build:assets
# The proxy listens on all interfaces inside the container only so `compose.yaml` can publish it on the host's
# loopback (127.0.0.1:3128) for a headed browser during `--keep`; nothing else is exposed.
ENV SIM_PROXY_HOST=0.0.0.0 SIM_PROXY_PORT=3128
ENTRYPOINT ["node","scripts/sim.mjs"]
CMD ["--scale","small"]
