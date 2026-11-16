/** Índices por leitura, sem cache global: preservam tipos, ordem e o primeiro registro duplicado. */
export function indexarPrimeiro<T, K>(rows: readonly T[], chave: (row: T) => K): Map<K, T> {
  const indice = new Map<K, T>();
  for (const row of rows) {
    const key = chave(row);
    if (!indice.has(key)) indice.set(key, row);
  }
  return indice;
}
export function agruparPorChave<T, K>(rows: readonly T[], chave: (row: T) => K): Map<K, T[]> {
  const indice = new Map<K, T[]>();
  for (const row of rows) {
    const key = chave(row),
      grupo = indice.get(key);
    if (grupo) grupo.push(row);
    else indice.set(key, [row]);
  }
  return indice;
}
