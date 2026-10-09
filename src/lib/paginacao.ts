/** Leitura ordenada em páginas para não depender do limite de resposta do PostgREST. */
export async function lerPaginas<T>(
  buscar: (
    inicio: number,
    fim: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  tamanho = 500,
  maximo = 100_000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let inicio = 0; inicio < maximo; inicio += tamanho) {
    const { data, error } = await buscar(inicio, inicio + tamanho - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < tamanho) return rows;
  }
  throw new Error("Consulta excede 100 mil registros; restrinja o período ou centro.");
}
