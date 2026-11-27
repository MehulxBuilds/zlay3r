"""Host-only vsock supervisor. Workloads always execute as UID/GID 1000."""

import fcntl
import json
import os
import resource
import selectors
import signal
import socket
import struct
import subprocess
import threading

SLOTS = threading.BoundedSemaphore(64)
RUNNER = threading.Lock()
COMMANDS = {
  "runner": ["node", "/opt/zlayer/agent-runner.mjs"],
  "helper": ["node", "/opt/zlayer/helper.mjs", "--stdin"],
  "filesystem": ["python3", "/opt/zlayer/filesystem.py"],
}


def first_line(connection):
  data = bytearray()
  while len(data) < 1024:
    part = connection.recv(1)
    if not part:
      raise ValueError("CONNECTION_CLOSED")
    if part == b"\n":
      return json.loads(data)
    data.extend(part)
  raise ValueError("REQUEST_TOO_LARGE")


def handle(connection, address):
  child = None
  locked = False
  try:
    if address[0] != socket.VMADDR_CID_HOST:
      raise ValueError("HOST_ONLY")
    connection.settimeout(5)
    request = first_line(connection)
    if not isinstance(request, dict) or set(request) != {"kind"}:
      raise ValueError("INVALID_REQUEST")
    kind = request["kind"]
    if kind == "sync":
      os.sync()
      connection.sendall(b"OK\n")
      return
    if kind == "ping":
      connection.sendall(b"OK\n")
      return
    if kind not in COMMANDS:
      raise ValueError("INVALID_COMMAND")
    if kind == "runner":
      locked = RUNNER.acquire(blocking=False)
      if not locked:
        raise ValueError("RUNNER_BUSY")
    child = subprocess.Popen(
      ["/usr/bin/setpriv", "--no-new-privs", "--bounding-set=-all",
       "--reuid=1000", "--regid=1000", "--clear-groups", "--"] + COMMANDS[kind],
      cwd="/workspace",
      env={
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": "/workspace", "TMPDIR": "/tmp", "PYTHONUTF8": "1",
        "PLAYWRIGHT_BROWSERS_PATH": "/opt/zlayer/browsers",
        "HTTP_PROXY": "http://127.0.0.1:8080",
        "HTTPS_PROXY": "http://127.0.0.1:8080",
        "http_proxy": "http://127.0.0.1:8080",
        "https_proxy": "http://127.0.0.1:8080",
      },
      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
      start_new_session=True, bufsize=0,
    )
    connection.sendall(b"OK\n")
    connection.settimeout(None)
    with selectors.DefaultSelector() as selector:
      selector.register(connection, selectors.EVENT_READ)
      selector.register(child.stdout, selectors.EVENT_READ)
      while True:
        for key, _ in selector.select():
          if key.fileobj is connection:
            data = connection.recv(65536)
            if not data:
              return
            child.stdin.write(data)
          else:
            data = os.read(child.stdout.fileno(), 65536)
            if not data:
              return
            connection.sendall(data)
  except (OSError, ValueError, TypeError, KeyError):
    pass
  finally:
    if child is not None:
      try:
        os.killpg(child.pid, signal.SIGKILL)
      except ProcessLookupError:
        pass
      child.wait()
      child.stdin.close()
      child.stdout.close()
    if locked:
      RUNNER.release()
    connection.close()
    SLOTS.release()


def forward_proxy(client):
  upstream = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
  try:
    upstream.settimeout(5)
    upstream.connect((socket.VMADDR_CID_HOST, 1024))
    upstream.settimeout(None)
    with selectors.DefaultSelector() as selector:
      selector.register(client, selectors.EVENT_READ, upstream)
      selector.register(upstream, selectors.EVENT_READ, client)
      while True:
        events = selector.select(timeout=60)
        if not events:
          return
        for key, _ in events:
          data = key.fileobj.recv(65536)
          if not data:
            return
          key.data.sendall(data)
  except OSError:
    pass
  finally:
    upstream.close()
    client.close()
    SLOTS.release()


def proxy_server():
  server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
  server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
  server.bind(("127.0.0.1", 8080))
  server.listen(32)
  while True:
    client, _ = server.accept()
    if SLOTS.acquire(blocking=False):
      threading.Thread(target=forward_proxy, args=(client,), daemon=True).start()
    else:
      client.close()


def main():
  resource.setrlimit(resource.RLIMIT_NOFILE, (1024, 1024))
  resource.setrlimit(resource.RLIMIT_NPROC, (128, 128))
  # There is no guest NIC. Bring up loopback for the local proxy and browser.
  with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as control:
    fcntl.ioctl(control, 0x8914, struct.pack("16sh", b"lo", 0x49))
  threading.Thread(target=proxy_server, daemon=True).start()
  server = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
  server.bind((socket.VMADDR_CID_ANY, 52))
  server.listen(32)
  while True:
    connection, address = server.accept()
    if SLOTS.acquire(blocking=False):
      threading.Thread(target=handle, args=(connection, address), daemon=True).start()
    else:
      connection.close()


if __name__ == "__main__":
  main()
