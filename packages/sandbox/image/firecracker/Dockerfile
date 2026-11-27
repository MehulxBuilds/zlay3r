ARG SANDBOX_IMAGE=zlayer-sandbox:local
FROM ${SANDBOX_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends util-linux \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /proc /sys /dev /run /tmp /workspace
COPY packages/sandbox/image/firecracker/init.sh /sbin/zlayer-init
COPY packages/sandbox/image/firecracker/guest-supervisor.py /opt/zlayer/guest-supervisor.py
COPY packages/sandbox/image/filesystem.py /opt/zlayer/filesystem.py
RUN chmod 0755 /sbin/zlayer-init && chmod 0644 /opt/zlayer/guest-supervisor.py
ENTRYPOINT ["/sbin/zlayer-init"]
