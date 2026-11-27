#!/bin/sh
set -eu
if [ ! -c /dev/null ]; then
  mount -t devtmpfs devtmpfs /dev
fi
mkdir -p /dev/pts /dev/shm
mount -t devpts devpts /dev/pts -o nosuid,noexec
mount -t proc proc /proc -o nosuid,nodev,noexec
mount -t sysfs sysfs /sys -o ro,nosuid,nodev,noexec
mount -t tmpfs tmpfs /run -o size=8m,nosuid,nodev,mode=0755
mount -t tmpfs tmpfs /tmp -o size=128m,nosuid,nodev,mode=1777
mount -t tmpfs tmpfs /dev/shm -o size=128m,nosuid,nodev,mode=1777
mount -t ext4 /dev/vdb /workspace -o nosuid,nodev
chown 1000:1000 /workspace
chmod 0700 /workspace
exec /usr/bin/tini -- python3 /opt/zlayer/guest-supervisor.py
