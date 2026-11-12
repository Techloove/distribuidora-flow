import { consultarPagadorSicoob } from "./sicoob-consulta";
import { erroOperacaoSicoob } from "./sicoob-erros";

type Row = Record<string, unknown>;
type Consulta = (path: string) => Promise<{ status: number; json: Row; motivo?: string | null }>;

/** A resposta de inclusão pode não confirmar o registro local. Recupera apenas por GET. */
export async function confirmarRespostaEmissaoSicoob<T>(
  raw: Row,
  aceitar: (retorno: Row) => Promise<T>,
  consultar: (nossoNumero: string) => Promise<T>,
): Promise<T> {
  try {
    return await aceitar(raw);
  } catch (erroInicial) {
    const nn = String(raw["nossoNumero"] ?? "");
    if (!/^[0-9]{1,18}$/.test(nn) || /^0+$/.test(nn)) throw erroInicial;
    // Este número serve só de filtro: a consulta deve validar todos os dados antes de vincular.
    return consultar(nn);
  }
}

/** Recuperação assíncrona da inclusão enviada pelo ERP; nunca registra uma segunda cobrança. */
export async function consultarEmissaoPendenteSicoob(
  api: Consulta,
  numeroCliente: number,
  documento: string,
  vencimento: string,
  seuNumero: string,
  contrato: number | null,
  identificacaoEmpresa?: string,
): Promise<Row> {
  if (!/^[0-9A-Za-z]{11,14}$/.test(documento) || !seuNumero)
    throw Error("Identificação da emissão pendente indisponível");
  const lista = await consultarPagadorSicoob(api, numeroCliente, documento, vencimento);
  const encontrados = lista
    .filter((x): x is Row => !!x && typeof x === "object" && !Array.isArray(x))
    .filter(
      (x) =>
        String(x["seuNumero"]) === seuNumero &&
        Number(x["numeroCliente"]) === numeroCliente &&
        Number(x["codigoModalidade"]) === 1 &&
        (!identificacaoEmpresa ||
          x["identificacaoBoletoEmpresa"] === undefined ||
          String(x["identificacaoBoletoEmpresa"]) === identificacaoEmpresa),
    );
  if (encontrados.length !== 1) throw Error("Emissão ainda não confirmada de forma única");
  const nn = String(encontrados[0]!["nossoNumero"] ?? "");
  if (!/^[0-9]{1,18}$/.test(nn) || /^0+$/.test(nn)) throw Error("Nosso número não confirmado");
  const q = new URLSearchParams({
    numeroCliente: String(numeroCliente),
    codigoModalidade: "1",
    nossoNumero: nn,
  });
  if (contrato) q.set("numeroContratoCobranca", String(contrato));
  const r = await api("/boletos?" + q);
  if (r.status !== 200) throw Error(erroOperacaoSicoob("Consulta", r.status, r.motivo));
  const raw = r.json["resultado"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("Detalhe bancário incompleto");
  const dados = raw as Row;
  if (
    String(dados["nossoNumero"]) !== nn ||
    String(dados["seuNumero"]) !== seuNumero ||
    Number(dados["numeroCliente"]) !== numeroCliente ||
    Number(dados["codigoModalidade"]) !== 1
  )
    throw Error("Detalhe bancário divergente da emissão pendente");
  if (
    identificacaoEmpresa &&
    String(dados["identificacaoBoletoEmpresa"] ?? "") !== identificacaoEmpresa
  )
    throw Error("Identificador da empresa divergente; não vincular apenas pelo documento");
  return dados;
}
