/** Convert an unknown caught value to a human-readable error message. */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
