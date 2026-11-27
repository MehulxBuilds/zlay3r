import { SandboxError } from "./contracts";

const fileErrors: Record<string, string> = {
  IsADirectoryError:
    "This path is a directory. Choose a file path to read or save text.",
  NotADirectoryError: "A component of this path is a file, not a directory.",
  FileNotFoundError: "The path or its parent directory does not exist.",
  FileExistsError: "A file or directory already exists at this path.",
  PermissionError: "The sandbox does not have permission to access this path.",
  PATH_OUTSIDE_WORKSPACE: "Choose a path inside /workspace.",
  WORKSPACE_ROOT_PROTECTED:
    "The workspace root cannot be changed. Choose a file or subdirectory.",
  SYMLINK_NOT_ALLOWED: "Symbolic links cannot be accessed by file operations.",
  NOT_REGULAR_FILE: "This operation requires a regular file.",
  FILE_TOO_LARGE: "The file exceeds the 8 MB file-operation limit.",
  INVALID_PATH: "Enter a valid workspace path.",
};

export function helperError(code: string) {
  const message = fileErrors[code];
  return message ? new SandboxError(code, message, 400) : new Error(code);
}
