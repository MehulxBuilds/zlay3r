#!/bin/sh
# Run in Ubuntu/Linux. Produces an ext4 image without modifying the database.
set -eu
if [ "$(uname -s)" != Linux ]; then
  echo "Run this script inside Ubuntu WSL or a Linux host." >&2
  exit 1
fi
as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo -n "$@"
  fi
}
as_root true
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output_path=${1:-"$repo_dir/packages/sandbox/dist/rootfs.ext4"}
case "$output_path" in
  /*) ;;
  *) echo "Output path must be absolute." >&2; exit 1 ;;
esac
if [ -e "$output_path" ] || [ -L "$output_path" ]; then
  echo "Output already exists. Choose a new versioned output path." >&2
  exit 1
fi
task_dir=$(mktemp -d)
container_id=
temporary_output=
cleanup() {
  if [ -n "$container_id" ]; then docker rm -f "$container_id" >/dev/null; fi
  if [ -n "$temporary_output" ]; then as_root rm -f -- "$temporary_output"; fi
  case "$task_dir" in /tmp/tmp.*) as_root rm -rf -- "$task_dir" ;; esac
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cd "$repo_dir"
docker build -f packages/sandbox/image/firecracker/Dockerfile -t zlayer-firecracker-rootfs:local .
container_id=$(docker create zlayer-firecracker-rootfs:local)
docker export "$container_id" -o "$task_dir/rootfs.tar"
mkdir "$task_dir/rootfs"
# Preserve root ownership and file modes when populating ext4. No host mount needed.
as_root tar --numeric-owner -xf "$task_dir/rootfs.tar" -C "$task_dir/rootfs"
mkdir -p "$(dirname -- "$output_path")"
temporary_output=$(mktemp "$output_path.build.XXXXXX")
truncate -s 4G "$temporary_output"
as_root mkfs.ext4 -q -F -d "$task_dir/rootfs" "$temporary_output"
as_root chown "$(id -u):$(id -g)" "$temporary_output"
# A hard link publishes the completed image and atomically refuses overwrites.
ln "$temporary_output" "$output_path"
sha256sum "$output_path"
