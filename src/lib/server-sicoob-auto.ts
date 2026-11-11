import { clienteSicoob, type CertificadoSicoob } from "./server-sicoob-http";
import { condicoesSicoob, type SicoobConfig } from "./sicoob-api";
import { fetchWithTimeout } from "./fetch-timeout";

type Rpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;
export type ItemSicoobAuto = {
  id: string;
  centro_id: string;
  actor: string;
  nosso_numero: string;
  versao: number;
  pagador_documento?: string;
};
type Reserva = { lease?: string; itens: ItemSicoobAuto[] };
/** Somente campos financeiros escalares; nunca persiste pagador, credenciais ou corpo bruto. */
export function diagnosticoPagamentoSicoob(raw: Record<string, unknown>) {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^(?:valor[A-Za-z]{0,45}|data[A-Za-z]{0,45})$/.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    if (typeof v === "string" && v.length <= 40 && /^[0-9T:+., Z/-]+$/.test(v)) out[k] = v;
  }
  // Apenas nomes dos demais campos: permite identificar o schema sem copiar dados pessoais.
  return {
    campos: Object.keys(raw)
      .filter((k) => /^[a-zA-Z][a-zA-Z0-9]{0,60}$/.test(k))
      .slice(0, 100),
    valores: out,
  };
}
export async function executarSicoobAutomatico(
  segredo: string,
  rpc: Rpc,
  consultar: (item: ItemSicoobAuto) => Promise<Record<string, unknown>>,
  agora = Date.now,
) {
  const r = await rpc<Reserva>("sicoob_auto_reservar_358", { _segredo: segredo });
  const limite = agora() + 40_000;
  let consultados = 0;
  for (const item of r.itens) {
    let banco: ReturnType<typeof condicoesSicoob> | null = null;
    let diagnostico: ReturnType<typeof diagnosticoPagamentoSicoob> | null = null;
    let erro: string | null = null;
    if (agora() >= limite) erro = "ADIADO";
    else
      try {
        const raw = await consultar(item);
        diagnostico = diagnosticoPagamentoSicoob(raw);
        banco = condicoesSicoob(raw);
        if (banco.nossoNumero !== item.nosso_numero) throw Error("Identificação divergente");
        consultados++;
      } catch (e) {
        banco = null;
        erro =
          e instanceof Error && /^HTTP_[0-9]{3}$/.test(e.message)
            ? e.message
            : "CONSULTA_NAO_CONFIRMADA";
      }
    await rpc("sicoob_auto_finalizar_358", {
      _lease: r.lease,
      _boleto: item.id,
      _banco: banco,
      _diagnostico: diagnostico,
      _erro: erro,
    });
  }
  return { consultados };
}
export async function atenderSicoobAutomatico(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "POST") return new Response(null, { status: 405, headers });
  const segredo = request.headers.get("X-Sicoob-Automacao");
  if (!segredo || !/^[a-f0-9]{64}$/.test(segredo))
    return new Response(null, { status: 401, headers });
  const url = process.env["EXT_SUPABASE_URL"]?.replace(/\/$/, ""),
    key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) return new Response(null, { status: 503, headers });
  const rpc: Rpc = async <T>(name: string, args: Record<string, unknown>) => {
    const r = await fetchWithTimeout(
      url + "/rest/v1/rpc/" + name,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      },
      8000,
    );
    if (!r.ok) throw Error("Persistência indisponível");
    return (await r.json()) as T;
  };
  try {
    const cache = new Map<
      string,
      { config: SicoobConfig; api: Awaited<ReturnType<typeof clienteSicoob>> }
    >();
    const resultado = await executarSicoobAutomatico(segredo, rpc, async (item) => {
      const chave = item.centro_id + ":" + item.actor + ":" + item.versao;
      let c = cache.get(chave);
      if (!c) {
        const p = await rpc<{ config: SicoobConfig; certificado: CertificadoSicoob }>(
          "sicoob_privado_316",
          { _actor: item.actor, _centro: item.centro_id, _ambiente: "producao" },
        );
        if (!p.config.ativo || p.config.versao !== item.versao || p.config.ambiente !== "producao")
          throw Error("Configuração mudou");
        c = { config: p.config, api: await clienteSicoob(p.config.client_id, p.certificado) };
        cache.set(chave, c);
      }
      const q = new URLSearchParams({
        numeroCliente: String(c.config.numero_cliente),
        codigoModalidade: "1",
        nossoNumero: item.nosso_numero,
      });
      if (c.config.numero_contrato)
        q.set("numeroContratoCobranca", String(c.config.numero_contrato));
      const r = await c.api("/boletos?" + q);
      if (
        r.status !== 200 ||
        !r.json["resultado"] ||
        typeof r.json["resultado"] !== "object" ||
        Array.isArray(r.json["resultado"])
      )
        throw Error(r.status !== 200 ? "HTTP_" + r.status : "Resposta não confirmada");
      const raw = r.json["resultado"] as Record<string, unknown>;
      if (
        raw["numeroContaCorrente"] !== undefined &&
        Number(raw["numeroContaCorrente"]) !== c.config.numero_conta
      )
        throw Error("Conta divergente");
      if (
        raw["numeroContratoCobranca"] !== undefined &&
        c.config.numero_contrato &&
        Number(raw["numeroContratoCobranca"]) !== c.config.numero_contrato
      )
        throw Error("Contrato divergente");
      const pagador = raw["pagador"] as Record<string, unknown> | undefined;
      const recebido = String(pagador?.["numeroCpfCnpj"] ?? "")
        .replace(/[^0-9A-Za-z]/g, "")
        .toUpperCase();
      const esperado = String(item.pagador_documento ?? "")
        .replace(/[^0-9A-Za-z]/g, "")
        .toUpperCase();
      if (recebido && esperado && recebido !== esperado) throw Error("Pagador divergente");
      return raw;
    });
    return Response.json(resultado, { headers });
  } catch {
    return Response.json(
      { erro: "Consulta automática não concluída; nova tentativa agendada." },
      { status: 503, headers },
    );
  }
}
