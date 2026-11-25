import base64
import json
import os
import stat
import sys

LIMIT = 8 * 1024 * 1024


def parts(value):
  if not isinstance(value, str) or "\x00" in value:
    raise ValueError("INVALID_PATH")
  if value.startswith("/"):
    if value != "/workspace" and not value.startswith("/workspace/"):
      raise ValueError("PATH_OUTSIDE_WORKSPACE")
    value = value[len("/workspace"):]
  result = []
  for item in value.split("/"):
    if item in ("", "."):
      continue
    if item == "..":
      if not result:
        raise ValueError("PATH_OUTSIDE_WORKSPACE")
      result.pop()
    else:
      result.append(item)
  return result


def parent(value):
  segments = parts(value)
  descriptor = os.open("/workspace", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
  try:
    for segment in segments[:-1]:
      child = os.open(segment, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
      os.close(descriptor)
      descriptor = child
    return descriptor, segments[-1] if segments else "."
  except Exception:
    os.close(descriptor)
    raise


def main(request):
  descriptor, name = parent(request.get("path", "."))
  operation = request["op"]
  try:
    if name == "." and operation not in ("list", "stat"):
      raise ValueError("WORKSPACE_ROOT_PROTECTED")
    if operation == "mkdir":
      os.mkdir(name, mode=0o700, dir_fd=descriptor)
      return {"created": True}
    if operation == "write":
      data = base64.b64decode(request["data"], validate=True)
      if len(data) > LIMIT:
        raise ValueError("FILE_TOO_LARGE")
      file = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=descriptor)
      with os.fdopen(file, "wb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
          raise ValueError("NOT_REGULAR_FILE")
        stream.truncate(0)
        stream.write(data)
      return {"size": len(data)}
    info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
    if stat.S_ISLNK(info.st_mode):
      raise ValueError("SYMLINK_NOT_ALLOWED")
    if operation == "read":
      file = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptor)
      with os.fdopen(file, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
          raise ValueError("NOT_REGULAR_FILE")
        data = stream.read(LIMIT + 1)
        if len(data) > LIMIT:
          raise ValueError("FILE_TOO_LARGE")
      return {"data": base64.b64encode(data).decode(), "size": len(data)}
    if operation == "list":
      directory = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
      try:
        entries = []
        for entry in sorted(os.listdir(directory))[:1000]:
          item = os.stat(entry, dir_fd=directory, follow_symlinks=False)
          entries.append({"name": entry, "directory": stat.S_ISDIR(item.st_mode), "symlink": stat.S_ISLNK(item.st_mode)})
        return {"entries": entries}
      finally:
        os.close(directory)
    if operation == "stat":
      return {"size": info.st_size, "directory": stat.S_ISDIR(info.st_mode), "modifiedAt": info.st_mtime}
    if operation == "delete":
      if stat.S_ISDIR(info.st_mode):
        os.rmdir(name, dir_fd=descriptor)
      else:
        os.unlink(name, dir_fd=descriptor)
      return {"deleted": True}
    if operation == "move":
      target, destination = parent(request["destination"])
      try:
        if destination == ".":
          raise ValueError("WORKSPACE_ROOT_PROTECTED")
        os.rename(name, destination, src_dir_fd=descriptor, dst_dir_fd=target)
        return {"moved": True}
      finally:
        os.close(target)
    raise ValueError("UNSUPPORTED_OPERATION")
  finally:
    os.close(descriptor)


try:
  request = json.loads(sys.stdin.read(12 * 1024 * 1024))
  print(json.dumps({"result": main(request)}))
except Exception as error:
  print(json.dumps({"error": str(error) if isinstance(error, ValueError) else type(error).__name__}))
