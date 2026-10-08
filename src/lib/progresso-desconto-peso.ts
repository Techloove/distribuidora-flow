export type FaixaPeso = {
  id: string;
  nome: string;
  categoria: string | null;
  peso_min: number;
  peso_max: number | null;
  percentual: number;
  ordem: number;
  ativo: boolean;
};
export type ItemPeso = { quantidade: number; peso_kg: number; categoria: string | null };

/** Replica o escopo e a precisão (numeric 14,3) da rotina desconto_peso_pedido. */
export function progressoDescontoPeso(itens: ItemPeso[], faixas: FaixaPeso[]) {
  const peso = (categoria: string | null) =>
    Math.round(
      itens.reduce(
        (s, i) =>
          s +
          (categoria === null || (i.categoria ?? "").toLowerCase() === categoria.toLowerCase()
            ? Number(i.quantidade) * Number(i.peso_kg)
            : 0),
        0,
      ) * 1000,
    ) / 1000;
  const ativas = faixas
    .filter((f) => f.ativo)
    .sort((a, b) => Number(a.ordem) - Number(b.ordem) || Number(a.peso_min) - Number(b.peso_min));
  const elegiveis = ativas.filter(
    (f) =>
      peso(f.categoria) > 0 &&
      peso(f.categoria) >= Number(f.peso_min) &&
      (f.peso_max === null || peso(f.categoria) <= Number(f.peso_max)),
  );
  const atual = elegiveis.reduce<FaixaPeso | null>(
    (melhor, f) => (!melhor || Number(f.percentual) > Number(melhor.percentual) ? f : melhor),
    null,
  );
  const categorias = [
    ...new Map(ativas.map((f) => [f.categoria?.toLowerCase() ?? null, f.categoria])).values(),
  ].filter(
    (c) => c === null || itens.some((i) => (i.categoria ?? "").toLowerCase() === c.toLowerCase()),
  );
  const proximas = categorias.flatMap((categoria) => {
    const pesoAtual = peso(categoria);
    const faixa = ativas
      .filter(
        (f) =>
          (f.categoria?.toLowerCase() ?? null) === (categoria?.toLowerCase() ?? null) &&
          Number(f.percentual) > Number(atual?.percentual ?? 0) &&
          Math.max(Number(f.peso_min), 0.001) > pesoAtual &&
          (f.peso_max === null || Number(f.peso_max) >= Math.max(Number(f.peso_min), 0.001)),
      )
      .sort(
        (a, b) =>
          Number(a.peso_min) - Number(b.peso_min) ||
          Number(b.percentual) - Number(a.percentual) ||
          Number(a.ordem) - Number(b.ordem),
      )[0];
    if (!faixa) return [];
    const meta = Math.max(Number(faixa.peso_min), 0.001);
    return [{ faixa, pesoAtual, meta, falta: Math.round((meta - pesoAtual) * 1000) / 1000 }];
  });
  const maiorAtingida =
    !!atual &&
    ativas
      .filter((f) =>
        categorias.some((c) => (c?.toLowerCase() ?? null) === (f.categoria?.toLowerCase() ?? null)),
      )
      .every((f) => Number(f.percentual) <= Number(atual.percentual));
  return { pesoTotal: peso(null), atual, proximas, maiorAtingida, temFaixas: ativas.length > 0 };
}
