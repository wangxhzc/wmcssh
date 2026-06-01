export type AppErrorCode =
  | "host_not_found"
  | "host_invalid"
  | "secret_not_found"
  | "secret_store_error"
  | "auth_failed"
  | "network_unreachable"
  | "timeout"
  | "session_not_found"
  | "session_closed"
  | "input_buffer_full"
  | "io_error"
  | "database_error"
  | "unsupported"
  | "unknown";

export type AppErrorDto = {
  code: AppErrorCode;
  message: string;
  details?: string;
  retryable: boolean;
};

export function normalizeAppError(error: unknown): AppErrorDto {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  ) {
    console.error("[wmcssh][invoke error]", error);
    return error as AppErrorDto;
  }

  console.error("[wmcssh][invoke error]", error);
  return {
    code: "unknown",
    message: String(error),
    retryable: false
  };
}
