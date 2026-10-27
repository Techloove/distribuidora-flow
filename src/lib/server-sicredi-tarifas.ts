import { fetchWithTimeout } from "./fetch-timeout";
import { tokenSicredi } from "./sicredi-token";
import { lerFrancesinhaCompleta, type ConvenioFrancesinha } from "./sicredi-francesinha";
import { dataBoleto } from "./boletos-lista";

type Rpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;
type Reserva = Partial<ConvenioFrancesinha> & { lease?: string; dia?: string };
type Banco = {
  base: string;
  apiKey: string;
  username: string;
  password: string;
  cooperativa: string;
  posto: string;
  beneficiario: string;
  ambiente: string;
};
export async function executarTarifasSicredi(
  secret: string,
  io: {
    rpc: Rpc;
    config: () => Promise<Banco>;
    consultar: (c: Banco, dia: string, pagina: number) => Promise<unknown>;
  },
) {
  const r = await io.rpc<Reserva>("sicredi_tarifas_reservar_280", { _segredo: secret });
  if (!r.lease) return { boletos: 0 };
  try {
    if (!r.dia || !dataBoleto(r.dia)) throw new Error("RETORNO_INVALIDO");
    const c = await io.config();
    if (
      c.ambiente !== "producao" ||
      c.cooperativa !== r.cooperativa ||
      c.posto !== r.posto ||
      c.beneficiario !== r.beneficiario
    )
      throw new Error("CONVENIO_DIVERGENTE");
    const movimentos = await lerFrancesinhaCompleta(c, r.dia, (p) => io.consultar(c, r.dia!, p));
    const boletos = await io.rpc<number>("sicredi_tarifas_finalizar_280", {
      _lease: r.lease,
      _movimentos: movimentos,
    });
    return { boletos };
  } catch (e) {
    const codigo =
      e instanceof Error &&
      ["HTTP", "TIMEOUT", "RETORNO_INVALIDO", "CONVENIO_DIVERGENTE"].includes(e.message)
        ? e.message
        : "CONSULTA_FALHOU";
    await io.rpc("sicredi_tarifas_finalizar_280", { _lease: r.lease, _erro: codigo });
    throw new Error(codigo);
  }
}

/** Endpoint independente da liquidação: apenas GET bancário e cache privado no ERP. */
export async function atenderTarifasSicredi(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
  const secret = request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!secret) return new Response(null, { status: 401, headers });
  const url = process.env["EXT_SUPABASE_URL"]?.replace(/\/$/, ""),
    key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) return new Response(null, { status: 503, headers });
  const dbHeaders = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const rpc: Rpc = async <T>(name: string, args: Record<string, unknown>) => {
    const res = await fetchWithTimeout(
      `${url}/rest/v1/rpc/${name}`,
      { method: "POST", headers: dbHeaders, body: JSON.stringify(args) },
      8_000,
    );
    const body = await res.text();
    if (!res.ok) throw new Error("PERSISTENCIA");
    return (body.trim() ? JSON.parse(body) : null) as T;
  };
  let token: string | undefined;
  const inicio = Date.now();
  try {
    return Response.json(
      await executarTarifasSicredi(secret, {
        rpc,
        config: async () => {
          const res = await fetchWithTimeout(
            `${url}/rest/v1/sicredi_config?select=api_key,username,password,cooperativa,posto,codigo_beneficiario,ambiente&limit=2`,
            { headers: dbHeaders },
            8_000,
          );
          if (!res.ok) throw new Error("CONVENIO_DIVERGENTE");
          const rows = (await res.json()) as Record<string, string>[];
          const c = rows[0];
          if (
            rows.length !== 1 ||
            !c ||
            !c["api_key"] ||
            !c["password"] ||
            c["username"] !== `${c["codigo_beneficiario"]}${c["cooperativa"]}`
          )
            throw new Error("CONVENIO_DIVERGENTE");
          return {
            base: "https://api-parceiro.sicredi.com.br",
            apiKey: c["api_key"]!,
            username: c["username"]!,
            password: c["password"]!,
            cooperativa: c["cooperativa"]!,
            posto: c["posto"]!,
            beneficiario: c["codigo_beneficiario"]!,
            ambiente: c["ambiente"]!,
          };
        },
        consultar: async (c, dia, pagina) => {
          if (Date.now() - inicio > 40_000) throw new Error("TIMEOUT");
          token ??= await tokenSicredi(c, rpc);
          const params = new URLSearchParams({
            codigoBeneficiario: c.beneficiario,
            cooperativa: c.cooperativa,
            posto: c.posto,
            dataLancamento: dia.split("-").reverse().join("/"),
            tipoMovimento: "DEBITO",
            pagina: String(pagina),
          });
          const buscar = () =>
            fetchWithTimeout(
              `${c.base}/cobranca/v1/cobranca-financeiro/movimentacoes/?${params}`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "x-api-key": c.apiKey,
                  "Content-Type": "application/x-www-form-urlencoded",
                },
              },
              5_000,
            );
          let res = await buscar();
          // O quadro do manual usa barras; o Postman da mesma seção usa hífens.
          // Somente em400 tenta uma vez a outra representação documentada do mesmo dia.
          if (res.status === 400) {
            await res.body?.cancel();
            if (Date.now() - inicio > 40_000) throw new Error("TIMEOUT");
            params.set("dataLancamento", dia.split("-").reverse().join("-"));
            res = await buscar();
          }
          if (!res.ok) throw new Error("HTTP");
          return await res.json().catch(() => {
            throw new Error("RETORNO_INVALIDO");
          });
        },
      }),
      { headers },
    );
  } catch {
    return Response.json(
      { erro: "Consulta de tarifas não concluída; haverá nova tentativa pelo agendamento." },
      { status: 503, headers },
    );
  }
}
