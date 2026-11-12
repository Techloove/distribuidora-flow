import type { BuscaReferencias } from "./referencias-registros";
import { hojeSaoPaulo } from "./painel-trabalho";
type Row = Record<string, unknown>;
type Filtros = Record<string, string>;

/** A lista abre em aberto; atalhos para um registro preservam seu contexto, mesmo se já pago. */
export function filtrosIniciaisBoletos(referencia?: BuscaReferencias): Filtros {
  return { status: referencia && Object.values(referencia).some(Boolean) ? "" : "registrado" };
}

/** Zero é o valor padrão de títulos sem valor de liquidação recebido do banco. */
export function valorRecebidoBoleto(boleto: Row): number | null {
  const valor = Number(boleto["valor_liquidado"]);
  return boleto["status"] === "liquidado" && Number.isFinite(valor) && valor > 0 ? valor : null;
}

/** Total de títulos liquidados: usa valor nominal quando o recebido não foi informado. */
export function totalBoletosLiquidados(rows: Row[]): number {
  return (
    rows
      .filter((b) => b["status"] === "liquidado")
      .reduce((centavos, b) => {
        const valor = valorRecebidoBoleto(b) ?? Number(b["valor"] ?? 0);
        return centavos + (Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) : 0);
      }, 0) / 100
  );
}

/** As três datas de boleto são campos SQL date, sem conversão de fuso. */
export function dataBoleto(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : "";
}

/** Somente baixas e cancelamentos confirmados; uma solicitação pendente continua em aberto. */
export function boletoCancelado(boleto: Row): boolean {
  return ["baixado", "cancelado"].includes(String(boleto["status"]));
}

/** Atraso é informação visual; não muda o estado bancário nem movimenta o financeiro. */
export function boletoVencido(boleto: Row, hoje = hojeSaoPaulo()): boolean {
  if (!["registrado", "vencido"].includes(String(boleto["status"]))) return false;
  if (boleto["data_liquidacao"]) return false;
  const retorno = boleto["retorno"];
  const dados =
    retorno && typeof retorno === "object" && !Array.isArray(retorno) ? (retorno as Row) : {};
  const situacao = normalizar(dados["situacao"] ?? dados["situacaoBoleto"] ?? "");
  if (/liquidad|baixad|cancelad|^pago$/.test(situacao)) return false;
  if (/vencid/.test(situacao) || boleto["status"] === "vencido") return true;
  const vencimento = dataBoleto(boleto["vencimento"]);
  return !!vencimento && vencimento < hoje;
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
    if (f["status"] === "cancelados") {
      if (!boletoCancelado(b)) return false;
    } else if (
      f["status"] === "vencido" ? !boletoVencido(b) : f["status"] && b["status"] !== f["status"]
    )
      return false;
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
  if (b["banco"] === "sicoob")
    return (
      b["status"] === "registrado" &&
      Array.isArray(b["operacoes_sicoob"]) &&
      (b["operacoes_sicoob"] as Row[]).some(
        (o) =>
          o["id"] === b["sicoob_pendente_316"] &&
          o["tipo"] === "baixar" &&
          ["reservado", "enviado", "incerto"].includes(String(o["estado"])),
      )
    );
  const retorno = b["retorno"];
  return (
    b["status"] === "registrado" &&
    !!retorno &&
    typeof retorno === "object" &&
    !Array.isArray(retorno) &&
    (retorno as Row)["cancelamento_sicredi_pendente"] === true
  );
}

/** Apenas confirmações bancárias: solicitações enviadas, incertas ou recusadas não são alterações. */
export function alteracoesVencimentoConfirmadas(boleto: Row) {
  const historico = boleto["alteracoes_vencimento"];
  if (!Array.isArray(historico)) return [];
  return historico
    .filter((r): r is Row => !!r && typeof r === "object" && !Array.isArray(r))
    .filter((r) => r["estado"] === "confirmado")
    .map((r) => ({
      id: String(r["id"] ?? ""),
      anterior: dataBoleto(r["vencimento_anterior"]),
      novo: dataBoleto(r["vencimento_novo"]),
      confirmadoEm: String(r["updated_at"] ?? r["created_at"] ?? ""),
    }))
    .filter((r) => r.id && r.anterior && r.novo && r.anterior !== r.novo)
    .sort(
      (a, b) =>
        (Date.parse(b.confirmadoEm) || 0) - (Date.parse(a.confirmadoEm) || 0) ||
        b.id.localeCompare(a.id),
    );
}

/** Tarifa individual confirmada no recebimento LIQUI; não soma o débito agrupado do extrato. */
export function tarifaLiquiBoleto(boleto: Row): number | null {
  if (
    boleto["banco"] !== "sicoob" ||
    boleto["canal"] !== "api" ||
    boleto["ambiente"] !== "producao"
  )
    return null;
  const recebimento = boleto["sicoob_recebimento_359"];
  if (!recebimento || typeof recebimento !== "object" || Array.isArray(recebimento)) return null;
  const valor = (recebimento as Row)["tarifa"];
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? valor : null;
}
