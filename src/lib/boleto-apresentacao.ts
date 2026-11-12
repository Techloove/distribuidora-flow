import { alteracoesVencimentoConfirmadas, dataBoleto } from "./boletos-lista";
type Row = Record<string, unknown>;
export type EventoBoleto = {
  id: string;
  tipo: string;
  titulo: string;
  estado: string;
  motivo: string;
  nota: string;
  criadoEm: string;
  atualizadoEm: string;
  anterior: Row;
  esperado: Row;
};
const obj = (v: unknown): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
const lista = (v: unknown): Row[] =>
  Array.isArray(v)
    ? (v.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Row[])
    : [];
function evento(r: Row, tipo = String(r["tipo"] ?? "")): EventoBoleto {
  const esperado = obj(r["esperado"]);
  const cancelar =
    tipo === "cancelar_abatimento" ||
    (tipo === "abatimento" && Number(esperado["abatimento"]) === 0);
  return {
    id: String(r["id"] ?? ""),
    tipo: cancelar ? "abatimento" : tipo,
    titulo: cancelar
      ? "Cancelar abatimento"
      : ((
          {
            emissao: "Emissão",
            vencimento: "Alterar vencimento",
            abatimento: "Conceder abatimento",
            desconto: "Alterar desconto",
            data_desconto: "Alterar prazo do desconto",
            baixar: "Baixa / cancelamento",
          } as Record<string, string>
        )[tipo] ?? "Operação bancária"),
    estado:
      ({ reservado: "solicitado", recusado: "rejeitado" } as Record<string, string>)[
        String(r["estado"])
      ] ?? String(r["estado"] ?? ""),
    motivo: String(r["motivo"] ?? ""),
    nota: String(r["nota"] ?? ""),
    criadoEm: String(r["created_at"] ?? ""),
    atualizadoEm: String(r["updated_at"] ?? r["created_at"] ?? ""),
    anterior: obj(r["anterior"]),
    esperado,
  };
}
/** Adaptadores só interpretam o retorno de cada banco. Regras visuais e histórico são compartilhados. */
const adaptadores = {
  sicredi(b: Row) {
    return {
      nome: "Sicredi",
      condicoes: obj(b["condicoes_sicredi_292"]),
      alteracoes: alteracoesVencimentoConfirmadas(b),
      eventos: [
        ...lista(b["historico_condicoes"] ?? b["abatimentos_confirmados"]).map((r) => evento(r)),
        ...lista(b["alteracoes_vencimento"]).map((r) =>
          evento(
            {
              ...r,
              anterior: { vencimento: r["vencimento_anterior"] },
              esperado: { vencimento: r["vencimento_novo"] },
            },
            "vencimento",
          ),
        ),
      ],
    };
  },
  sicoob(b: Row) {
    const eventos = lista(b["operacoes_sicoob"]).map((r) => evento(r));
    return {
      nome: "Sicoob",
      condicoes: obj(b["retorno"]),
      eventos,
      alteracoes: eventos
        .filter((e) => e.tipo === "vencimento" && e.estado === "confirmado")
        .map((e) => ({
          id: e.id,
          anterior: dataBoleto(e.anterior["vencimento"]),
          novo: dataBoleto(e.esperado["vencimento"]),
          confirmadoEm: e.atualizadoEm,
        }))
        .filter((e) => e.anterior && e.novo && e.anterior !== e.novo)
        .sort(
          (a, b) =>
            (Date.parse(b.confirmadoEm) || 0) - (Date.parse(a.confirmadoEm) || 0) ||
            b.id.localeCompare(a.id),
        ),
    };
  },
};
export function apresentacaoBoleto(b: Row) {
  const banco = String(b["banco"]);
  const a = adaptadores[banco as keyof typeof adaptadores]?.(b) ?? {
    nome: "Banco",
    condicoes: {},
    eventos: [],
    alteracoes: [],
  };
  const abatimento = Number(a.condicoes["abatimento"] ?? 0);
  const eventos = a.eventos.sort(
    (a, b) =>
      (Date.parse(b.criadoEm) || 0) - (Date.parse(a.criadoEm) || 0) || b.id.localeCompare(a.id),
  );
  const historicoAbatimento = eventos.find(
    (e) =>
      e.tipo === "abatimento" &&
      e.estado === "confirmado" &&
      Number(e.esperado["abatimento"]) === abatimento,
  );
  const descontos = lista(a.condicoes["descontos"]).filter(
    (d) => Number.isFinite(Number(d["valor"])) && Number(d["valor"]) > 0 && !!dataBoleto(d["data"]),
  );
  const tipoDesconto = a.condicoes["tipoDesconto"];
  const unidadeDesconto =
    tipoDesconto === "PERCENTUAL" || tipoDesconto === 2
      ? "percentual"
      : tipoDesconto === "VALOR" || tipoDesconto === 1
        ? "valor"
        : "regra";
  return {
    ...a,
    eventos,
    descontos,
    unidadeDesconto,
    abatimento: Number.isFinite(abatimento) && abatimento > 0 ? abatimento : 0,
    historicoAbatimento,
  };
}
export const estadosEventoBoleto: Record<string, string> = {
  solicitado: "Solicitada",
  enviado: "Enviada",
  incerto: "Aguardando confirmação",
  confirmado: "Confirmada",
  rejeitado: "Recusada",
  encerrado: "Encerrada",
};
