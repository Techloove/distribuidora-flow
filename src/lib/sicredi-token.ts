import { FalhaConsultaSicredi } from "./sicredi-diagnostico";
import { fetchWithTimeout } from "./fetch-timeout";
type TokenConfig = {
  base: string;
  apiKey: string;
  username: string;
  password: string;
  cooperativa: string;
  posto: string;
  beneficiario: string;
};
type Rpc = <T>(name: string, data: Record<string, unknown>) => Promise<T>;
type Claim = { access_token?: string; refresh_token?: string; lease?: string; busy?: boolean };
/** Tokens ficam na tabela privada do servidor, compartilhada entre instâncias. */
export async function tokenSicredi(c: TokenConfig, rpc: Rpc) {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      c.base,
      c.apiKey,
      c.username,
      c.password,
      c.cooperativa,
      c.posto,
      c.beneficiario,
    ]),
  );
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const key = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
  let claim: Claim | null = null;
  for (let i = 0; i < 20; i++) {
    claim = await rpc<Claim>("sicredi_token_reservar_224", { _chave: key });
    if (claim?.access_token) return claim.access_token;
    if (claim?.lease) break;
    if (!claim?.busy)
      throw new Error("Cache seguro Sicredi indisponível. Aplique a migração fase224.");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!claim?.lease)
    throw new Error("Autenticação Sicredi em andamento. Tente novamente em alguns segundos.");
  const lease = claim.lease;
  const request = async (refresh?: string) => {
    const body = new URLSearchParams(
      refresh
        ? { grant_type: "refresh_token", refresh_token: refresh }
        : { username: c.username, password: c.password, scope: "cobranca", grant_type: "password" },
    );
    return fetchWithTimeout(`${c.base}/auth/openapi/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-api-key": c.apiKey,
        context: "COBRANCA",
      },
      body,
    });
  };
  try {
    let response = await request(claim.refresh_token);
    // Renovação definitivamente recusada: volta ao fluxo de usuário/senha uma vez.
    if (claim.refresh_token && [400, 401].includes(response.status)) response = await request();
    if (!response.ok)
      throw new FalhaConsultaSicredi(
        { etapa: "token", tipo: "http", http_status: response.status },
        `Autenticação Sicredi recusada (${response.status}). Confira as credenciais do ambiente selecionado.`,
      );
    const data = (await response.json().catch(() => {
      throw new FalhaConsultaSicredi({ etapa: "token", tipo: "retorno_invalido" });
    })) as Record<string, unknown>;
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      typeof data["access_token"] !== "string" ||
      !data["access_token"] ||
      !Number.isFinite(Number(data["expires_in"])) ||
      Number(data["expires_in"]) <= 15
    )
      throw new FalhaConsultaSicredi(
        { etapa: "token", tipo: "retorno_invalido" },
        "Sicredi retornou token ou prazo de validade inválido.",
      );
    await rpc("sicredi_token_concluir_224", { _chave: key, _lease: lease, _dados: data });
    return data["access_token"];
  } catch (e) {
    try {
      await rpc("sicredi_token_concluir_224", { _chave: key, _lease: lease, _dados: null });
    } catch {
      /* Lease expira mesmo se o banco de dados estiver indisponível. */
    }
    throw e instanceof Error ? e : new Error("Falha na autenticação Sicredi.");
  }
}
