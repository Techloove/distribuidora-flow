import { FAZNOTAS_BASE_URL } from "./faznotas";
import { fetchWithTimeout } from "./fetch-timeout";
import type { SnapshotNfe } from "./faznotas-documento";
export type RetornoNfe = {
  status?: string;
  descricao?: string;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};
export class FalhaFaznotas extends Error {
  constructor(public retorno: RetornoNfe) {
    super(retorno.descricao || "Falha na comunicação com a FAZNOTAS");
  }
}
export function ocultarToken<T>(body: T, token: string): T {
  return JSON.parse(JSON.stringify(body).split(token).join("[oculto]")) as T;
}
export async function chamarFaznotas(
  token: string,
  path: string,
  method: "GET" | "POST",
  payload?: unknown,
  transporte: typeof fetchWithTimeout = fetchWithTimeout,
): Promise<RetornoNfe> {
  let r: Response;
  try {
    r = await transporte(
      `${FAZNOTAS_BASE_URL}${path}`,
      {
        method,
        headers: {
          Authorization: `Token ${token}`,
          Accept: "application/json",
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        redirect: "error",
      },
      15000,
    );
  } catch {
    throw new FalhaFaznotas({
      descricao:
        "A comunicação foi interrompida. Acompanhe ou recupere o protocolo existente antes de tentar outra emissão.",
    });
  }
  const requestId = r.headers.get("X-Request-Id")?.slice(0, 200);
  const meta = requestId ? { request_id: requestId } : {};
  if (!r.ok)
    throw new FalhaFaznotas({
      status: `HTTP_${r.status}`,
      descricao:
        r.status === 401 || r.status === 403
          ? "A FAZNOTAS recusou a credencial. Confira o token da loja."
          : r.status === 429
            ? "Aguarde: limite de consultas da FAZNOTAS atingido."
            : `FAZNOTAS indisponível para esta operação (HTTP ${r.status}).`,
      meta,
    });
  const text = await r.text();
  if (text.length > 2000000)
    throw new FalhaFaznotas({
      descricao: "Resposta da FAZNOTAS excedeu o limite de processamento.",
      meta,
    });
  let body: RetornoNfe;
  try {
    body = JSON.parse(text) as RetornoNfe;
  } catch {
    throw new FalhaFaznotas({
      descricao: "A FAZNOTAS retornou uma resposta que não pôde ser interpretada.",
      meta,
    });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.status !== "string")
    throw new FalhaFaznotas({ descricao: "A FAZNOTAS não informou um status válido.", meta });
  return ocultarToken({ ...body, meta: { ...(body.meta ?? {}), ...meta } }, token);
}
const canon = (v: unknown): string =>
  JSON.stringify(v, (_, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
/** Cria referências próprias e imutáveis. Nunca sobrescreve produto remoto usado por outra nota. */
export async function sincronizarProdutoNfe(
  token: string,
  produto: SnapshotNfe["produtos"][number],
  chamada: typeof chamarFaznotas = chamarFaznotas,
) {
  let consulta: RetornoNfe;
  try {
    consulta = await chamada(token, `/produtos/${encodeURIComponent(produto.referencia)}`, "GET");
  } catch (erro) {
    if (erro instanceof FalhaFaznotas && erro.retorno.status === "HTTP_404")
      consulta = { status: "500" };
    else throw erro;
  }
  const p = consulta.data;
  if (consulta.status === "005" && p?.["referencia"] === produto.referencia) {
    for (const k of ["nome", "medida", "ncm", "origem", "configuracoes-fiscais"] as const)
      if (canon(p[k]) !== canon(produto[k]))
        throw new FalhaFaznotas({
          descricao:
            "O produto fiscal remoto diverge do snapshot aprovado. Confira a referência com a FAZNOTAS; a tributação não foi sobrescrita.",
          meta: consulta.meta ?? {},
        });
    return consulta;
  }
  if (!["005", "500", "999"].includes(consulta.status ?? ""))
    throw new FalhaFaznotas({
      descricao: "A consulta do produto fiscal não foi confirmada. Aguarde antes de continuar.",
      meta: consulta.meta ?? {},
    });
  const criado = await chamada(token, "/produtos", "POST", produto);
  if (criado.status !== "001")
    throw new FalhaFaznotas({
      ...criado,
      descricao: `Cadastro fiscal do produto não confirmado: ${String(criado.descricao ?? criado.status).slice(0, 300)}`,
    });
  return criado;
}
