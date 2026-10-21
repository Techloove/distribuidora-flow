export type CidadeFrete = { cidade: string; uf: string };
export type TarifaFrete = CidadeFrete & {
  produto_id: string;
  valor_unitario: number;
  ativo: boolean;
};
export function chaveLocal(c: CidadeFrete) {
  return JSON.stringify([c.cidade, c.uf]);
}
export function chaveGrupo(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("pt-BR");
}
/** Não escolhe arbitrariamente um preço quando a seleção contém tarifas diferentes. */
export function tarifaComum(cidade: CidadeFrete, produtos: string[], tarifas: TarifaFrete[]) {
  const mapa = new Map(
    tarifas.filter((t) => chaveLocal(t) === chaveLocal(cidade)).map((t) => [t.produto_id, t]),
  );
  const linhas = produtos.map((id) => mapa.get(id));
  if (!linhas.some(Boolean)) return { valor: "", ativo: true, situacao: "Sem tarifa" };
  const primeira = linhas[0];
  if (
    primeira &&
    linhas.every(
      (t) =>
        t &&
        Number(t.valor_unitario) === Number(primeira.valor_unitario) &&
        t.ativo === primeira.ativo,
    )
  ) {
    return {
      valor: String(primeira.valor_unitario),
      ativo: primeira.ativo,
      situacao: primeira.ativo ? "Ativa" : "Inativa",
    };
  }
  return { valor: "", ativo: true, situacao: "Tarifas diferentes ou parciais" };
}
