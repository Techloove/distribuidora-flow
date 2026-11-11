import { fetchWithTimeout } from "./fetch-timeout";
import { consultarExtratoContaSicoob, type CertificadoSicoob } from "./server-sicoob-http";
import { consultaExtratoSicoob } from "./sicoob-extrato";
import { movimentosTarifasSicoob } from "./sicoob-tarifas";
import { hojeSaoPaulo } from "./painel-trabalho";
export type ReservaTarifasSicoob = {
  lease?: string;
  mes?: string;
  inicio?: string;
  fim?: string;
  clientId?: string;
  numeroConta?: string;
  certificado?: CertificadoSicoob;
};
type Rpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;
export async function executarTarifasSicoob(
  r: ReservaTarifasSicoob,
  rpc: Rpc,
  consultar = consultarExtratoContaSicoob,
) {
  if (!r.lease) return { lancados: 0, ignorados: 0, conferir: 0, semConsulta: true };
  try {
    if (!r.clientId || !r.numeroConta || !r.certificado || !r.mes || !r.inicio || !r.fim)
      throw Error("Reserva incompleta");
    const path = consultaExtratoSicoob(
      r.numeroConta,
      r.mes,
      Number(r.inicio.slice(8, 10)),
      Number(r.fim.slice(8, 10)),
      hojeSaoPaulo(),
    );
    const raw = await consultar(r.clientId, r.certificado, path);
    return await rpc<{ lancados: number; ignorados: number; conferir: number }>(
      "sicoob_tarifas_finalizar_355",
      { _lease: r.lease, _movimentos: movimentosTarifasSicoob(raw) },
    );
  } catch {
    await rpc("sicoob_tarifas_finalizar_355", { _lease: r.lease, _erro: "CONSULTA_FALHOU" }).catch(
      () => {},
    );
    throw Error(
      "Tarifas Sicoob não contabilizadas nesta tentativa. Confira a configuração e a consulta do extrato.",
    );
  }
}
export async function atenderTarifasSicoob(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
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
      8000,
    );
    if (!r.ok) throw Error("Persistência indisponível");
    return (await r.json()) as T;
  };
  try {
    const r = await rpc<ReservaTarifasSicoob>("sicoob_tarifas_reservar_355", { _segredo: segredo });
    return Response.json(await executarTarifasSicoob(r, rpc), { headers });
  } catch {
    return Response.json(
      { erro: "Consulta de tarifas não concluída; nova tentativa agendada." },
      { status: 503, headers },
    );
  }
}
