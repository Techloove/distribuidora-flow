import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { enforceRateLimit, requestAccessToken, requireServerAuth } from "./server-auth";
import { fetchWithTimeout } from "./fetch-timeout";
import {
  hashPreviaNfe,
  prepararDocumentoNfe,
  type ContextoNfe,
  type SnapshotNfe,
} from "./faznotas-documento";
import {
  chamarFaznotas,
  FalhaFaznotas,
  sincronizarProdutoNfe,
  type RetornoNfe,
} from "./server-faznotas-nfe";
const basico = z.object({ accessToken: z.string().optional(), nota: z.string().uuid() });
const opcoes = z.object({
  cfop: z
    .string()
    .regex(/^[56]\d{3}$/)
    .optional(),
  consumidor: z.enum(["0", "1"]),
  indicadorIe: z.enum(["1", "2", "9"]),
  modalidade: z.enum(["0", "1", "2", "3", "4", "9"]),
});
const previa = basico.extend({ opcoes });
const envio = previa.extend({ hash: z.string().regex(/^[a-f0-9]{64}$/) });
export type StatusNfe = {
  vinculada: boolean;
  estado: string | null;
  recibo: string | null;
  numero_origem: string | null;
  produtos_prontos: number;
  total_produtos: number;
  ambiente: string | null;
  mensagem: string | null;
  request_id: string | null;
  chave: string | null;
  protocolo: string | null;
  nf_numero: string | null;
  serie: string | null;
  danfe_url: string | null;
  xml_url: string | null;
};
function config() {
  const url = process.env["EXT_SUPABASE_URL"]?.replace(/\/$/, "");
  const anon = process.env["EXT_SUPABASE_ANON_KEY"];
  if (!url || !anon) throw new Error("Supabase não configurado no servidor");
  return { url, anon };
}
async function rest<T>(path: string, token: string, key: string, body?: unknown): Promise<T> {
  const { url } = config();
  const r = await fetchWithTimeout(`${url}/rest/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new Error(
      e.code === "P0001"
        ? String(e.message)
        : "Não foi possível concluir a operação fiscal no Supabase. Confira a fase259.",
    );
  }
  return (await r.json()) as T;
}
async function acesso(data: z.infer<typeof basico>) {
  const token = data.accessToken || requestAccessToken() || "";
  const actor = await requireServerAuth(token, ["admin", "gestor", "financeiro"]);
  await enforceRateLimit(token, "faznotas_nfe", 90, 60);
  const { anon } = config();
  const status = await rest<StatusNfe>("rpc/status_nfe_259", token, anon, { _nota: data.nota });
  return { token, actor, status, anon };
}
function service() {
  const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) throw new Error("Configure a chave segura do Supabase no servidor antes de emitir.");
  return key;
}
async function preparar(data: z.infer<typeof previa>, token: string, anon: string) {
  const contexto = await rest<ContextoNfe>("rpc/contexto_nfe_259", token, anon, {
    _nota: data.nota,
  });
  const c = { ...contexto.dados.cliente, ...(contexto.dados.pessoa ?? {}) };
  const cep = String(c["cep"] ?? "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(cep)) throw new Error("Complete o CEP do cliente no cadastro unificado");
  let endereco: { erro?: boolean; uf?: string; localidade?: string };
  try {
    const r = await fetchWithTimeout(
      `https://viacep.com.br/ws/${cep}/json/`,
      { redirect: "error" },
      10000,
    );
    if (!r.ok) throw new Error();
    endereco = (await r.json()) as typeof endereco;
  } catch {
    throw new Error("Não foi possível conferir o CEP agora. Nenhuma nota foi enviada.");
  }
  if (endereco.erro || !endereco.uf || !endereco.localidade)
    throw new Error("CEP não encontrado. Corrija o endereço antes de emitir.");
  const snapshot = prepararDocumentoNfe(contexto, data.opcoes, {
    uf: endereco.uf,
    localidade: endereco.localidade,
  });
  return { snapshot, contexto, hash: hashPreviaNfe(snapshot) };
}
export const faznotasPreviaNfe = createServerFn({ method: "POST" })
  .validator((data: unknown) => previa.parse(data))
  .handler(async ({ data }) => {
    const a = await acesso(data);
    service();
    const p = await preparar(data, a.token, a.anon);
    return { snapshot: p.snapshot, hash: p.hash };
  });
export const faznotasStatusNfe = createServerFn({ method: "POST" })
  .validator((data: unknown) => basico.parse(data))
  .handler(async ({ data }) => (await acesso(data)).status);
async function executarEtapa(
  data: z.infer<typeof basico>,
  a: Awaited<ReturnType<typeof acesso>>,
  recuperar = false,
) {
  const key = service();
  const rpc = <T>(nome: string, params: Record<string, unknown>) =>
    rest<T>(`rpc/${nome}`, key, key, params);
  const job = await rpc<{
    lease: string;
    centro_id: string;
    snapshot: SnapshotNfe;
    recibo: string | null;
    produtos_prontos: string[];
  } | null>("assumir_nfe_259", { _actor: a.actor.id, _nota: data.nota, _recuperar: recuperar });
  if (!job)
    return await rest<StatusNfe>("rpc/status_nfe_259", a.token, a.anon, { _nota: data.nota });
  const registrar = (
    acao: string,
    retorno: RetornoNfe | Record<string, unknown>,
    pronto: string | null = null,
  ) =>
    rpc("registrar_etapa_nfe_259", {
      _actor: a.actor.id,
      _nota: data.nota,
      _lease: job.lease,
      _acao: acao,
      _retorno: retorno,
      _pronto: pronto,
    });
  try {
    const cred = await rest<{ token: string; cnpj: string }[]>(
      `faznotas_credenciais_257?select=token,cnpj&centro_id=eq.${job.centro_id}&limit=1`,
      key,
      key,
    );
    const token = cred[0]?.token;
    if (!token || cred[0]?.cnpj !== job.snapshot.cnpj)
      throw new Error("Credencial fiscal não corresponde à empresa do documento.");
    if (job.recibo) {
      const r = await chamarFaznotas(
        token,
        `/nfe/nota/${encodeURIComponent(job.recibo)}/completa`,
        "GET",
      );
      await registrar("consulta", r);
    } else {
      const pendentes = job.snapshot.produtos.filter(
        (p) => !job.produtos_prontos.includes(p.referencia),
      );
      const cadastros = await Promise.allSettled(
        pendentes.slice(0, 2).map(async (p) => {
          const r = await sincronizarProdutoNfe(token, p);
          await registrar("produto", r, p.referencia);
        }),
      );
      const falhaCadastro = cadastros.find((r) => r.status === "rejected");
      if (falhaCadastro?.status === "rejected") throw falhaCadastro.reason;
      if (pendentes.length > 2) await registrar("liberar", {});
      else {
        await registrar("iniciar_envio", {});
        const r = await chamarFaznotas(token, "/nfe/emissao", "POST", job.snapshot.emissao);
        await registrar("envio", r);
      }
    }
  } catch (e) {
    // Falhas não viram quitação/autorização nem disparam outro número de origem.
    const retorno =
      e instanceof FalhaFaznotas
        ? e.retorno
        : {
            descricao: e instanceof Error ? e.message : "Não foi possível concluir a etapa fiscal",
          };
    await registrar("falha", retorno).catch(() => undefined);
    throw e;
  }
  return await rest<StatusNfe>("rpc/status_nfe_259", a.token, a.anon, { _nota: data.nota });
}
export const faznotasEnviarNfe = createServerFn({ method: "POST" })
  .validator((data: unknown) => envio.parse(data))
  .handler(async ({ data }) => {
    const a = await acesso(data);
    const key = service();
    const p = await preparar(data, a.token, a.anon);
    if (p.hash !== data.hash)
      throw new Error("A prévia mudou. Confira os dados novamente antes de emitir.");
    await rest("rpc/reservar_nfe_259", key, key, {
      _actor: a.actor.id,
      _nota: data.nota,
      _versao: p.contexto.versao,
      _snapshot: p.snapshot,
    });
    return await executarEtapa(data, a);
  });
export const faznotasProcessarNfe = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    basico.extend({ recuperar: z.boolean().default(false) }).parse(data),
  )
  .handler(async ({ data }) => executarEtapa(data, await acesso(data), data.recuperar));
