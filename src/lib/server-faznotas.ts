import { fetchWithTimeout } from "./fetch-timeout";
import { FAZNOTAS_BASE_URL } from "./faznotas";

/** Somente leitura; não testa autorização de NF-e nem retorna o corpo remoto. */
export async function testarAcessoFaznotas(
  token: string,
  transporte: typeof fetchWithTimeout = fetchWithTimeout,
) {
  // Endpoint autenticado, paginado e somente leitura. /health não valida token.
  const resposta = await transporte(`${FAZNOTAS_BASE_URL}/produtos?page=1&page_size=1`, {
    headers: { Authorization: `Token ${token}`, Accept: "application/json" },
    redirect: "error",
  });
  // Nunca devolver corpo remoto, produtos ou credencial ao navegador.
  if (resposta.status === 401 || resposta.status === 403)
    throw new Error("A FAZNOTAS recusou o token. Confira a credencial e a liberação da conta.");
  if (resposta.status === 429)
    throw new Error("Limite de consultas da FAZNOTAS atingido. Aguarde antes de testar novamente.");
  if (!resposta.ok)
    throw new Error(`Não foi possível validar o acesso à FAZNOTAS (HTTP ${resposta.status}).`);
  const body = (await resposta.json().catch(() => null)) as { status?: string } | null;
  if (body?.status !== "005")
    throw new Error(
      "A FAZNOTAS não confirmou o resultado da consulta. Confira a conta com o provedor.",
    );
  return {
    sucesso: true,
    verificado_em: new Date().toISOString(),
    mensagem:
      "Acesso autenticado confirmado em consulta de leitura. Nenhuma nota foi emitida. Confirme no painel FAZNOTAS se este token pertence ao CNPJ da loja; a consulta não comprova o vínculo cadastral nem o ambiente fiscal.",
  };
}
