import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireServerAuth, requestAccessToken, enforceRateLimit } from "./server-auth";
import { fetchWithTimeout } from "./fetch-timeout";
import {
  baixarDocumentoForecast,
  conferirXmlHomologacao,
  conferirPdfHomologacao,
  bytesBase64,
  base64Bytes,
  hashDocumento,
  type IdentidadeDocumentoHml,
} from "./server-forecast-documentos";

const entrada = z.object({ accessToken: z.string().optional(), nota: z.string().uuid() });
const arquivo = z.object({
  tipo: z.enum(["xml", "pdf"]),
  mime: z.enum(["application/xml", "application/pdf"]),
  nome: z.string().regex(/^CPRHML[a-f0-9]{32}-HOMOLOGACAO\.(xml|pdf)$/),
  base64: z.string().max(7_000_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
async function rpc<T>(
  token: string,
  nome: string,
  args: Record<string, unknown>,
  service = false,
): Promise<T> {
  const url = process.env["EXT_SUPABASE_URL"]?.replace(/\/$/, ""),
    anon = process.env["EXT_SUPABASE_ANON_KEY"];
  const key = service ? process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"] : anon;
  if (!url || !key) throw new Error("Configuração segura do Supabase indisponível no servidor.");
  const r = await fetchWithTimeout(`${url}/rest/v1/rpc/${nome}`, {
    method: "POST",
    redirect: "error",
    headers: {
      apikey: key,
      Authorization: `Bearer ${service ? key : token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!r.ok)
    throw new Error(
      "Documento indisponível. Confira permissões, loja/carteira, credencial original e aplicação da fase267. O estado da nota não foi alterado.",
    );
  return (await r.json().catch(() => {
    throw new Error("Resposta interna do documento inválida.");
  })) as T;
}
async function auth(data: z.infer<typeof entrada>) {
  const token = data.accessToken || requestAccessToken() || "";
  const user = await requireServerAuth(token, ["admin", "gestor", "financeiro"]);
  await enforceRateLimit(token, "forecast_documentos", 10, 60);
  return { token, actor: user.id };
}
type Contexto = IdentidadeDocumentoHml & { token: string };
async function conferirArquivo(a: z.infer<typeof arquivo>) {
  const bytes = base64Bytes(a.base64);
  if ((await hashDocumento(bytes)) !== a.sha256)
    throw new Error("A integridade do arquivo armazenado não foi confirmada.");
  return a;
}
async function ler(token: string, nota: string, tipo: "xml" | "pdf") {
  const a = arquivo
    .nullable()
    .parse(await rpc(token, "ler_documento_hml_267", { _nota: nota, _tipo: tipo }));
  return a ? conferirArquivo(a) : null;
}

export const forecastDocumentosHml = createServerFn({ method: "POST" })
  .validator((d: unknown) => entrada.parse(d))
  .handler(async ({ data }) => {
    const { token } = await auth(data);
    return z
      .object({
        ref: z.string().nullable(),
        cnpj: z.string().nullable(),
        envio_iniciado: z.boolean(),
        documentos: z.array(
          z.object({
            tipo: z.enum(["xml", "pdf"]),
            sha256: z.string(),
            bytes: z.number(),
            created_at: z.string(),
            prova: z.record(z.string()),
          }),
        ),
      })
      .parse(await rpc(token, "documentos_hml_forecast_267", { _nota: data.nota }));
  });
export const forecastBaixarDocumentoHml = createServerFn({ method: "POST" })
  .validator((d: unknown) => entrada.extend({ tipo: z.enum(["xml", "pdf"]) }).parse(d))
  .handler(async ({ data }) => {
    const { token, actor } = await auth(data);
    const cache = await ler(token, data.nota, data.tipo);
    if (cache) return cache;
    let contexto: Contexto | null = null;
    const obterContexto = async () =>
      (contexto ??= await rpc<Contexto>(
        token,
        "contexto_documento_hml_267",
        { _actor: actor, _nota: data.nota },
        true,
      ));
    // PDF novo depende de XML conferido e persistido para esta mesma referência.
    let xml = await ler(token, data.nota, "xml");
    if (!xml) {
      const c = await obterContexto();
      const bytes = await baixarDocumentoForecast(c.token, c.ref, "xml");
      const prova = conferirXmlHomologacao(bytes, c);
      await rpc(
        token,
        "registrar_documento_hml_267",
        {
          _actor: actor,
          _nota: data.nota,
          _tipo: "xml",
          _base64: bytesBase64(bytes),
          _prova: prova,
        },
        true,
      );
      xml = await ler(token, data.nota, "xml");
      if (!xml) throw new Error("XML não encontrado após armazenamento.");
    }
    if (data.tipo === "xml") return xml;
    const c = await obterContexto();
    conferirXmlHomologacao(base64Bytes(xml.base64), c);
    const bytes = await baixarDocumentoForecast(c.token, c.ref, "pdf");
    await conferirPdfHomologacao(bytes);
    await rpc(
      token,
      "registrar_documento_hml_267",
      { _actor: actor, _nota: data.nota, _tipo: "pdf", _base64: bytesBase64(bytes), _prova: {} },
      true,
    );
    // Reautorização com a sessão atual antes de entregar o conteúdo ao navegador.
    const pdf = await ler(token, data.nota, "pdf");
    if (!pdf) throw new Error("DANFE não encontrado após armazenamento.");
    return pdf;
  });
