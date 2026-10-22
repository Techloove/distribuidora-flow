import { fetchWithTimeout } from "./fetch-timeout";
import { chamarFaznotas, FalhaFaznotas, type RetornoNfe } from "./server-faznotas-nfe";

type Job = {
  nota: string;
  actor: string;
  lease: string;
  centro: string;
  cnpj: string;
  recibo: string;
};
type Rpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;
export async function consultarNfeAutomatica(
  segredo: string,
  io: {
    rpc: Rpc;
    credencial: (centro: string) => Promise<{ cnpj: string; token: string }>;
    consultar: (token: string, path: string) => Promise<RetornoNfe>;
  },
) {
  const job = await io.rpc<Job | null>("faznotas_auto_reservar_260", { _segredo: segredo });
  if (!job) return { consultadas: 0 };
  const registrar = (acao: string, retorno: unknown) =>
    io.rpc("registrar_etapa_nfe_259", {
      _actor: job.actor,
      _nota: job.nota,
      _lease: job.lease,
      _acao: acao,
      _retorno: retorno,
      _pronto: null,
    });
  try {
    if (!job.recibo) throw new Error("Recibo ausente");
    const cred = await io.credencial(job.centro);
    if (!cred.token || cred.cnpj !== job.cnpj) throw new Error("Credencial divergente");
    const retorno = await io.consultar(
      cred.token,
      `/nfe/nota/${encodeURIComponent(job.recibo)}/completa`,
    );
    await registrar("consulta", retorno);
    return { consultadas: 1 };
  } catch (e) {
    await registrar(
      "falha",
      e instanceof FalhaFaznotas
        ? e.retorno
        : { descricao: "Consulta automática indisponível. Confira acesso e credencial da loja." },
    ).catch(() => undefined);
    throw new Error("Consulta fiscal automática não concluída");
  }
}

export async function atenderFaznotasAutomatico(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
  const segredo = request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!segredo) return new Response(null, { status: 401, headers });
  const url = process.env["EXT_SUPABASE_URL"]?.replace(/\/$/, "");
  const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) return new Response(null, { status: 503, headers });
  const dbHeaders = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const rpc: Rpc = async <T>(name: string, args: Record<string, unknown>) => {
    const r = await fetchWithTimeout(
      `${url}/rest/v1/rpc/${name}`,
      { method: "POST", headers: dbHeaders, body: JSON.stringify(args) },
      8000,
    );
    if (!r.ok) throw new Error("Operação fiscal indisponível");
    return (await r.json()) as T;
  };
  try {
    const result = await consultarNfeAutomatica(segredo, {
      rpc,
      credencial: async (centro) => {
        const r = await fetchWithTimeout(
          `${url}/rest/v1/faznotas_credenciais_257?select=cnpj,token&centro_id=eq.${encodeURIComponent(centro)}&limit=1`,
          { headers: dbHeaders },
          8000,
        );
        if (!r.ok) throw new Error("Credencial indisponível");
        const rows = (await r.json()) as { cnpj: string; token: string }[];
        if (!rows[0]) throw new Error("Credencial ausente");
        return rows[0];
      },
      consultar: (token, path) => chamarFaznotas(token, path, "GET"),
    });
    return Response.json(result, { headers });
  } catch {
    return Response.json(
      { erro: "Consulta automática não concluída; confira o acompanhamento da nota." },
      { status: 503, headers },
    );
  }
}
