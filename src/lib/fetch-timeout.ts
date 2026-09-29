/** Limita chamadas externas para evitar requisições penduradas indefinidamente. */
export function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 20_000) {
  return fetch(input, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
  });
}
