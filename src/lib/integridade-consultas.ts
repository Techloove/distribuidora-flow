type Row = Record<string, unknown>;

export function saldoTitulo(row: Row) {
  return Number(
    row["saldo"] ??
      Number(row["valor"] ?? 0) +
        Number(row["juros"] ?? 0) +
        Number(row["multa"] ?? 0) +
        Number(row["acrescimo"] ?? 0) -
        Number(row["desconto"] ?? 0) -
        Number(row["valor_pago"] ?? 0),
  );
}

export function tituloNoStatus(row: Row, status: string) {
  const efetivo = String(row["status_efetivo"] ?? row["status"]);
  if (status === "aberto")
    return (
      row["venda_aprovada"] !== false &&
      ["aberto", "vencido", "parcial", "vencido_parcial"].includes(efetivo)
    );
  return (
    status === "todos" ||
    efetivo === status ||
    (efetivo === "vencido_parcial" && ["vencido", "parcial"].includes(status))
  );
}

/** Usa apenas saldos que o servidor permitiu ler; ausência no centro significa zero. */
export function saldosPorProduto(rows: readonly Row[], centro: string) {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (centro && row["centro_id"] !== centro) continue;
    const id = String(row["produto_id"]);
    map.set(id, (map.get(id) ?? 0) + Number(row["quantidade"] ?? 0));
  }
  return map;
}

/** Os cartões respeitam o mesmo centro da listagem, sem esconder valores pagos. */
export function totaisTitulos(rows: readonly Row[], centro: string, hoje: string) {
  const permitidos = rows.filter((r) => !centro || r["centro_id"] === centro);
  const abertos = permitidos.filter(
    (r) => r["status"] !== "pago" && r["status"] !== "cancelado" && r["venda_aprovada"] !== false,
  );
  const somar = (list: readonly Row[]) => list.reduce((sum, r) => sum + saldoTitulo(r), 0);
  return {
    aberto: somar(abertos),
    vencido: somar(abertos.filter((r) => String(r["vencimento"]) < hoje)),
    pago: permitidos.reduce((sum, r) => sum + Number(r["valor_pago"] ?? 0), 0),
    hoje: somar(abertos.filter((r) => r["vencimento"] === hoje)),
    futuros: somar(abertos.filter((r) => String(r["vencimento"]) > hoje)),
  };
}

/** Operações em lote nunca incluem títulos que desapareceram dos filtros atuais. */
export function selecaoVisivel(ids: readonly string[], rows: readonly Row[]) {
  const visiveis = new Set(
    rows
      .filter((r) => !["pago", "cancelado"].includes(String(r["status"])))
      .map((r) => String(r["id"])),
  );
  return ids.filter((id) => visiveis.has(id));
}

/** Data de calendário: não usa meia-noite local, que muda conforme o navegador. */
export function deslocarDataISO(data: string, dias: number) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
