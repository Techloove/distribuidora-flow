import { clienteSicoob, type CertificadoSicoob, type RespostaSicoob } from "./server-sicoob-http";
import type { SicoobConfig } from "./sicoob-api";
import {
  registrosZipSicoob,
  normalizarLiquiSicoob,
  referenciaLiquiSicoob,
} from "./server-sicoob-liqui";
import { fetchWithTimeout } from "./fetch-timeout";
type Rpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;
export type JobLiquiSicoob = {
  id: string;
  lease: string;
  centro_id: string;
  actor: string;
  versao: number;
  numero_cliente: number;
  numero_conta: number;
  contrato: number | null;
  inicio: string;
  fim: string;
  estado: "solicitar" | "aguardar" | "baixar";
  codigo: number | null;
  arquivos: number[];
  feitos: number[];
};
type Api = (
  path: string,
  method?: string,
  body?: Record<string, unknown>,
) => Promise<RespostaSicoob>;
const idBanco = (v: unknown, zero = false) => {
  if (!["string", "number"].includes(typeof v) || !/^[0-9]{1,15}$/.test(String(v)))
    throw Error("LIQUI_ID_INVALIDO");
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < (zero ? 0 : 1)) throw Error("LIQUI_ID_INVALIDO");
  return n;
};
export async function executarLiquidacoesSicoob(
  segredo: string,
  rpc: Rpc,
  criarApi: (j: JobLiquiSicoob) => Promise<Api>,
) {
  const j = await rpc<Partial<JobLiquiSicoob>>("sicoob_liqui_reservar_359", { _segredo: segredo });
  if (!j.id) return { semConsulta: true };
  const job = j as JobLiquiSicoob;
  const etapa = (_acao: string, _dados: Record<string, unknown> = {}) =>
    rpc("sicoob_liqui_etapa_359", { _job: job.id, _lease: job.lease, _acao, _dados });
  let campos: string[] = [];
  let valores: Record<string, unknown>[] = [];
  let respostaHttp: Record<string, unknown> | null = null;
  const verificarHttp = (
    r: RespostaSicoob,
    permitidos: number[],
    recurso: string,
    metodo: string,
  ) => {
    if (permitidos.includes(r.status)) return;
    respostaHttp = {
      etapa: job.estado,
      metodo,
      recurso,
      status: r.status,
      motivo: r.motivo ?? null,
      rastreio: r.rastreio ?? {},
      camposResposta:
        r.json && typeof r.json === "object"
          ? Object.keys(r.json)
              .filter((k) => /^[a-zA-Z][a-zA-Z0-9_]{0,60}$/.test(k))
              .slice(0, 40)
          : [],
    };
    throw Error("HTTP_" + r.status);
  };
  try {
    const api = await criarApi(job);
    const q = new URLSearchParams({
      numeroCliente: String(job.numero_cliente),
      codigoSolicitacao: String(job.codigo),
    });
    if (job.estado === "solicitar") {
      const r = await api("/boletos/movimentacoes", "POST", {
        numeroCliente: job.numero_cliente,
        tipoMovimento: 5,
        dataInicial: job.inicio,
        dataFinal: job.fim,
      });
      verificarHttp(r, [200, 201, 202], "/boletos/movimentacoes", "POST");
      const codigo = idBanco(
        (r.json["resultado"] as Record<string, unknown> | undefined)?.["codigoSolicitacao"],
      );
      if (!Number.isSafeInteger(codigo) || Number(codigo) <= 0)
        throw Error("LIQUI_CODIGO_INVALIDO");
      await etapa("solicitacao", { codigo });
    } else if (job.estado === "aguardar") {
      const r = await api("/boletos/movimentacoes?" + q);
      if (r.status === 204) {
        await etapa("aguardar");
        return { aguardando: true };
      }
      verificarHttp(r, [200], "/boletos/movimentacoes", "GET");
      const resultado = r.json["resultado"] as Record<string, unknown> | undefined;
      if (!resultado || !Array.isArray(resultado["idArquivos"]))
        throw Error("LIQUI_LISTA_INCOMPLETA");
      const quantidade = idBanco(resultado["quantidadeArquivo"], true);
      const ids = (resultado["idArquivos"] as unknown[]).map((id) => idBanco(id));
      if (ids.length > 20 || ids.length !== quantidade || new Set(ids).size !== ids.length)
        throw Error("LIQUI_LISTA_INVALIDA");
      if (
        !ids.length &&
        ![0, "0"].includes(resultado["quantidadeTotalRegistros"] as number | string)
      ) {
        await etapa("aguardar");
        return { aguardando: true };
      }
      await etapa("arquivos", { ids });
    } else if (job.estado === "baixar") {
      const arquivo = job.arquivos.find((id) => !job.feitos.includes(id));
      if (!arquivo) throw Error("LIQUI_ARQUIVO_AUSENTE");
      q.set("idArquivo", String(arquivo));
      const r = await api("/boletos/movimentacoes/download?" + q);
      verificarHttp(r, [200], "/boletos/movimentacoes/download", "GET");
      const base64 = (r.json["resultado"] as Record<string, unknown> | undefined)?.["arquivo"];
      const registros = registrosZipSicoob(base64);
      campos = [
        ...new Set(
          registros
            .slice(0, 2)
            .flatMap((r) =>
              r && typeof r === "object" && !Array.isArray(r) ? Object.keys(r) : [],
            ),
        ),
      ]
        .filter((k) => /^[a-zA-Z][a-zA-Z0-9]{0,60}$/.test(k))
        .slice(0, 100);
      const referencias = registros.map(referenciaLiquiSicoob);
      const permitidos = await rpc<
        { nossoNumero: string; seuNumero: string; codigoBarras: string }[]
      >("sicoob_liqui_identificar_360", {
        _job: job.id,
        _lease: job.lease,
        _referencias: referencias,
      });
      const numeros = new Set(permitidos.map((r) => r.seuNumero));
      const codigos = new Set(permitidos.map((r) => r.codigoBarras).filter(Boolean));
      const selecionados = registros.filter(
        (_r, i) =>
          (referencias[i]!.seuNumero !== null && numeros.has(referencias[i]!.seuNumero!)) ||
          (referencias[i]!.codigoBarras !== null && codigos.has(referencias[i]!.codigoBarras!)),
      );
      valores = selecionados
        .slice(0, 2)
        .map((r) =>
          Object.fromEntries(
            Object.entries(r as Record<string, unknown>).filter(
              ([k, v]) =>
                /^(?:valor[A-Za-z]{0,45}|data[A-Za-z]{0,45}|numeroTitulo|numeroCliente|numeroContaCorrente|modalidade|numeroContratoCobranca)$/.test(
                  k,
                ) &&
                ((typeof v === "number" && Number.isFinite(v)) ||
                  (typeof v === "string" && v.length <= 40 && /^[0-9T:+., Z/-]+$/.test(v))),
            ),
          ),
        );
      const normalizados = selecionados.map((r) => normalizarLiquiSicoob(r, job.inicio, job.fim));
      return await rpc("sicoob_liqui_arquivo_359", {
        _job: job.id,
        _lease: job.lease,
        _arquivo: arquivo,
        _registros: normalizados,
      });
    } else throw Error("LIQUI_ETAPA_INVALIDA");
    return { etapa: job.estado };
  } catch (e) {
    const codigo =
      e instanceof Error && /^(?:HTTP_[0-9]{3}|LIQUI_[A-Z_]+|CONFIG_ALTERADA)$/.test(e.message)
        ? e.message
        : "LIQUI_RETORNO_INVALIDO";
    await etapa("erro", { codigo, diagnostico: { campos, valores, respostaHttp } });
    throw Error(codigo);
  }
}
export async function atenderLiquidacoesSicoob(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "POST") return new Response(null, { status: 405, headers });
  const segredo = request.headers.get("X-Sicoob-Automacao");
  if (!segredo || !/^[a-f0-9]{64}$/.test(segredo))
    return new Response(null, { status: 401, headers });
  const url = process.env["EXT_SUPABASE_URL"]?.replace(/\/$/, ""),
    key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) return new Response(null, { status: 503, headers });
  const rpc: Rpc = async <T>(nome: string, args: Record<string, unknown>) => {
    const r = await fetchWithTimeout(
      url + "/rest/v1/rpc/" + nome,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      },
      15000,
    );
    if (!r.ok) {
      if (r.status === 404 && nome === "sicoob_liqui_identificar_360")
        throw Error("LIQUI_ATUALIZAR_REFERENCIAS");
      throw Error("Persistência indisponível");
    }
    return (await r.json()) as T;
  };
  try {
    const resultado = await executarLiquidacoesSicoob(segredo, rpc, async (j) => {
      const p = await rpc<{ config: SicoobConfig; certificado: CertificadoSicoob }>(
        "sicoob_privado_316",
        { _actor: j.actor, _centro: j.centro_id, _ambiente: "producao" },
      );
      if (
        !p.config.ativo ||
        p.config.ambiente !== "producao" ||
        p.config.versao !== j.versao ||
        p.config.numero_cliente !== j.numero_cliente ||
        p.config.numero_conta !== j.numero_conta ||
        p.config.numero_contrato !== j.contrato
      )
        throw Error("CONFIG_ALTERADA");
      return clienteSicoob(p.config.client_id, p.certificado);
    });
    return Response.json(resultado, { headers });
  } catch {
    return Response.json(
      { erro: "Liquidação não concluída; retorno preservado para nova tentativa ou conferência." },
      { status: 503, headers },
    );
  }
}
