import {
  FalhaConsultaSicredi,
  diagnosticoConsultaSicredi,
  type DiagnosticoConsultaSicredi,
} from "./sicredi-diagnostico";
import { fetchWithTimeout } from "./fetch-timeout";
import { liquidacaoSicredi } from "./sicredi-api";
import { tokenSicredi } from "./sicredi-token";

type Boleto = {
  id: string;
  nosso_numero: string;
  cooperativa: string;
  posto: string;
  codigo_beneficiario: string;
  responsavel: string | null;
};
type Reserva = { lease?: string; itens: Boleto[] };
type Config = { ambiente: string; cooperativa: string; posto: string; codigo_beneficiario: string };
type Rpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;
type IO = {
  rpc: Rpc;
  config: () => Promise<Config>;
  consultar: (b: Boleto) => Promise<Record<string, unknown>>;
  agora?: () => number;
};
/** Orquestrador sem efeitos de emissão: somente consulta e conciliação validada no banco. */
export async function executarConsultaAutomatica(secret: string, io: IO) {
  const reserva = await io.rpc<Reserva>("sicredi_auto_reservar_247", { _segredo: secret });
  if (!reserva.itens.length) return { consultados: 0, processados: 0 };
  const agora = io.agora ?? Date.now;
  const limite = agora() + 40_000;
  let config: Config | null = null;
  try {
    config = await io.config();
  } catch {
    /* Sinaliza a configuração sem expor credenciais. */
  }
  let consultados = 0,
    processados = 0;
  for (const b of reserva.itens) {
    let situacao = "adiado";
    let dados: ReturnType<typeof liquidacaoSicredi> | null = null;
    let diagnostico: DiagnosticoConsultaSicredi | null = null;
    if (agora() < limite) {
      if (!b.responsavel) situacao = "sem_responsavel";
      else if (
        !config ||
        config.ambiente !== "producao" ||
        b.cooperativa !== config.cooperativa ||
        b.posto !== config.posto ||
        b.codigo_beneficiario !== config.codigo_beneficiario
      )
        situacao = "convenio_divergente";
      else {
        try {
          const retorno = await io.consultar(b);
          consultados++;
          const estado = String(retorno["situacao"] ?? retorno["situacaoBoleto"] ?? "")
            .trim()
            .toUpperCase();
          if (["LIQUIDADO", "LIQUIDADA"].includes(estado)) {
            try {
              dados = liquidacaoSicredi(retorno);
              situacao = "liquidado";
            } catch {
              situacao = "dados_incompletos";
            }
          } else if (["BAIXADO", "BAIXADA", "CANCELADO", "CANCELADA"].includes(estado))
            situacao = "baixado";
          else situacao = estado ? "pendente" : "dados_incompletos";
        } catch (erro) {
          diagnostico = diagnosticoConsultaSicredi(erro);
          situacao = "consulta_falhou";
        }
      }
    }
    // Falha na persistência aborta o lote: a reserva expira e será consultada novamente.
    // Não se interpreta timeout como confirmação de baixa.
    const resultado = await io.rpc<string>("sicredi_auto_finalizar_247", {
      _lease: reserva.lease,
      _boleto: b.id,
      _situacao: situacao,
      _dados: diagnostico ? { diagnostico } : dados,
    });
    if (resultado === "liquidado") processados++;
  }
  return { consultados, processados };
}

export async function atenderSicrediAutomatico(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
  const secret = request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!secret) return new Response(null, { status: 401, headers });
  const url = process.env["EXT_SUPABASE_URL"]?.replace(/\/$/, "");
  const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
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
    if (!res.ok) throw new Error("Operação de conciliação não concluída");
    return (await res.json()) as T;
  };
  let banco: {
    base: string;
    apiKey: string;
    username: string;
    password: string;
    cooperativa: string;
    posto: string;
    beneficiario: string;
  };
  let token: string | undefined;
  try {
    const resultado = await executarConsultaAutomatica(secret, {
      rpc,
      config: async () => {
        const res = await fetchWithTimeout(
          `${url}/rest/v1/sicredi_config?select=api_key,username,password,cooperativa,posto,codigo_beneficiario,ambiente&limit=2`,
          { headers: dbHeaders },
          8_000,
        );
        if (!res.ok) throw new Error("Configuração indisponível");
        const rows = (await res.json()) as Record<string, string>[];
        const c = rows[0];
        if (
          rows.length !== 1 ||
          !c ||
          c["ambiente"] !== "producao" ||
          !c["api_key"] ||
          !c["password"] ||
          c["username"] !== `${c["codigo_beneficiario"]}${c["cooperativa"]}`
        )
          throw new Error("Convênio indisponível");
        banco = {
          base: "https://api-parceiro.sicredi.com.br",
          apiKey: c["api_key"],
          username: c["username"]!,
          password: c["password"],
          cooperativa: c["cooperativa"]!,
          posto: c["posto"]!,
          beneficiario: c["codigo_beneficiario"]!,
        };
        return {
          ambiente: c["ambiente"],
          cooperativa: banco.cooperativa,
          posto: banco.posto,
          codigo_beneficiario: banco.beneficiario,
        };
      },
      consultar: async (b) => {
        try {
          token ??= await tokenSicredi(banco, rpc);
        } catch (erro) {
          throw new FalhaConsultaSicredi(diagnosticoConsultaSicredi(erro, "token"));
        }
        const res = await fetchWithTimeout(
          `${banco.base}/cobranca/boleto/v2/boletos?codigoBeneficiario=${encodeURIComponent(banco.beneficiario)}&nossoNumero=${encodeURIComponent(b.nosso_numero)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "x-api-key": banco.apiKey,
              cooperativa: banco.cooperativa,
              posto: banco.posto,
              "data-movimento": "true",
            },
          },
          5_000,
        );
        if (!res.ok)
          throw new FalhaConsultaSicredi({
            etapa: "consulta",
            tipo: "http",
            http_status: res.status,
          });
        const retorno: unknown = await res.json().catch(() => {
          throw new FalhaConsultaSicredi({ etapa: "consulta", tipo: "retorno_invalido" });
        });
        if (!retorno || typeof retorno !== "object" || Array.isArray(retorno))
          throw new FalhaConsultaSicredi({ etapa: "consulta", tipo: "retorno_invalido" });
        return retorno as Record<string, unknown>;
      },
    });
    return Response.json(resultado, { headers });
  } catch {
    return Response.json(
      { erro: "Consulta automática não concluída; haverá nova tentativa pelo agendamento." },
      { status: 503, headers },
    );
  }
}
