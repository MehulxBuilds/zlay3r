FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tini python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/zlayer
RUN npm install --omit=dev --save-exact playwright@1.65.1 ipaddr.js@2.5.0 && npx playwright install --with-deps chromium && mv /root/.cache/ms-playwright /opt/zlayer/browsers && chmod -R a+rX /opt/zlayer/browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/zlayer/browsers
ENV HOME=/workspace PYTHONUTF8=1 TMPDIR=/tmp
COPY helper.mjs /opt/zlayer/helper.mjs
COPY filesystem.py /opt/zlayer/filesystem.py
USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]
