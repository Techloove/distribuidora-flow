export type VersaoPublicada = { versao: string; data: string; titulo: string };
function partes(v: string) {
  if (v.length > 32 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v)) return null;
  return v.split(".").map(BigInt);
}
export function versaoMaisNova(disponivel: string, atual: string) {
  const a = partes(disponivel),
    b = partes(atual);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! > b[i]!) return true;
    if (a[i]! < b[i]!) return false;
  }
  return false;
}
export async function consultarAtualizacao(
  atual: string,
  transport: typeof fetch = fetch,
): Promise<VersaoPublicada | null> {
  try {
    const r = await transport(`/versao.json?consulta=${Date.now()}`, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok || !r.headers.get("content-type")?.toLowerCase().includes("application/json"))
      return null;
    const tamanho = Number(r.headers.get("content-length") ?? 0);
    if (tamanho > 4096) return null;
    const texto = await r.text();
    if (texto.length > 4096) return null;
    const v = JSON.parse(texto);
    if (
      !v ||
      typeof v.versao !== "string" ||
      typeof v.data !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(v.data) ||
      typeof v.titulo !== "string" ||
      v.titulo.length > 250 ||
      !versaoMaisNova(v.versao, atual)
    )
      return null;
    return { versao: v.versao, data: v.data, titulo: v.titulo };
  } catch {
    return null;
  }
}
export function urlDaAtualizacao(atual: string, versao: string) {
  if (!partes(versao)) throw new Error("Versão inválida.");
  const url = new URL(atual);
  url.searchParams.set("_atualizacao", versao);
  return url.toString();
}

/** Limita a uma tentativa automática por versão e usa a URL como proteção se storage falhar. */
export function podeAtualizarNaEntrada(
  urlAtual: string,
  atual: string,
  nova: string,
  tentativa: string | null,
) {
  if (!versaoMaisNova(nova, atual)) return false;
  return (
    tentativa !== `${atual}->${nova}` && new URL(urlAtual).searchParams.get("_atualizacao") !== nova
  );
}
