type Row = Record<string, unknown>;
type Filtros = Record<string, string>;

/** As três datas de boleto são campos SQL date, sem conversão de fuso. */
export function dataBoleto(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : "";
}

const periodos = [
  ["vencimento", "de", "ate"],
  ["data_emissao", "emissao_de", "emissao_ate"],
  ["data_liquidacao", "liquidacao_de", "liquidacao_ate"],
] as const;

export function periodoBoletosInvalido(f: Filtros): boolean {
  return periodos.some(([, de, ate]) => !!f[de] && !!f[ate] && f[de]! > f[ate]!);
}

function normalizar(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function filtrarBoletos(rows: Row[], f: Filtros, cliente: (id: unknown) => string): Row[] {
  if (periodoBoletosInvalido(f)) return [];
  const termo = normalizar(f["busca"]).trim();
  return rows.filter((b) => {
    if (f["cliente"] && String(b["cliente_id"]) !== f["cliente"]) return false;
    if (f["status"] && b["status"] !== f["status"]) return false;
    for (const [campo, de, ate] of periodos) {
      if (!f[de] && !f[ate]) continue;
      const data = dataBoleto(b[campo]);
      // Sem liquidação não pertence a nenhum intervalo de liquidação.
      if (!data || (f[de] && data < f[de]!) || (f[ate] && data > f[ate]!)) return false;
    }
    const valor = Number(b["valor"] ?? 0);
    if (f["min"] && valor < Number(f["min"])) return false;
    if (f["max"] && valor > Number(f["max"])) return false;
    return (
      !termo ||
      [
        cliente(b["cliente_id"]),
        b["nosso_numero"],
        b["seu_numero"],
        b["documento"],
        b["linha_digitavel"],
      ].some((value) => normalizar(value).includes(termo))
    );
  });
}

export function agruparTarifasApi(rows: Row[]) {
  const mapa = new Map<
    string,
    { valor: number; outros: number; itens: { dia: string; descricao: string; valor: number }[] }
  >();
  for (const row of rows) {
    const id = String(row["boleto_id"]);
    const atual = mapa.get(id) ?? { valor: 0, outros: 0, itens: [] };
    atual.valor =
      (Math.round(atual.valor * 100) + Math.round(Number(row["tarifa_total"]) * 100)) / 100;
    atual.outros += Number(row["outros_debitos"] ?? 0);
    if (Array.isArray(row["debitos"])) {
      for (const d of row["debitos"] as Row[])
        atual.itens.push({
          dia: String(row["data_lancamento"]),
          descricao: String(d["descricao"]),
          valor: Number(d["valor"]),
        });
    }
    mapa.set(id, atual);
  }
  return mapa;
}

export function ordenarBoletos(rows: Row[], ordem: string): Row[] {
  const opcoes: Record<string, [string, number]> = {
    emissao_asc: ["data_emissao", 1],
    emissao_desc: ["data_emissao", -1],
    vencimento_asc: ["vencimento", 1],
    vencimento_desc: ["vencimento", -1],
  };
  const [campo, sentido] = opcoes[ordem] ?? opcoes["vencimento_asc"]!;
  return [...rows].sort((a, b) => {
    const da = dataBoleto(a[campo]),
      db = dataBoleto(b[campo]);
    if (!da || !db) return da ? -1 : db ? 1 : String(a["id"]).localeCompare(String(b["id"]));
    return da.localeCompare(db) * sentido || String(a["id"]).localeCompare(String(b["id"]));
  });
}

export function cancelamentoBoletoPendente(b: Row): boolean {
  const retorno = b["retorno"];
  return (
    b["status"] === "registrado" &&
    !!retorno &&
    typeof retorno === "object" &&
    !Array.isArray(retorno) &&
    (retorno as Row)["cancelamento_sicredi_pendente"] === true
  );
}
