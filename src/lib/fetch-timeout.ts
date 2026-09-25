/** Bound external requests; never retry bank mutations automatically. */
export function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) });
}
