FROM oven/bun:1.3.5 AS agent-build
WORKDIR /build
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts && bun run --cwd packages/agent-runner build

FROM node:22-bookworm-slim
LABEL zlayer.agent-runner="1"
RUN apt-get update && apt-get install -y --no-install-recommends tini python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/zlayer
RUN npm install --omit=dev --save-exact playwright@1.65.1 ipaddr.js@2.5.0 @modelcontextprotocol/client@2.4.0 && npx playwright install --with-deps chromium && mv /root/.cache/ms-playwright /opt/zlayer/browsers && chmod -R a+rX /opt/zlayer/browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/zlayer/browsers
ENV HOME=/workspace PYTHONUTF8=1 TMPDIR=/tmp
COPY packages/sandbox/image/helper.mjs /opt/zlayer/helper.mjs
COPY packages/sandbox/image/filesystem.py /opt/zlayer/filesystem.py
COPY --from=agent-build /build/packages/agent-runner/dist/agent-runner.mjs /opt/zlayer/agent-runner.mjs
USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]
