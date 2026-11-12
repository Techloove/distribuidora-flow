import { consultarPagadorSicoob } from "./sicoob-consulta";
import { erroOperacaoSicoob, consultaVaziaSicoob } from "./sicoob-erros";
import { validarEmissaoSicoob, condicoesEmissaoSicoob, type EmissaoSicoob } from "./sicoob-emissao";
import { createServerFn } from "@tanstack/react-start";
import { enforceRateLimit, requireServerAuth } from "./server-auth";
import { fetchWithTimeout } from "./fetch-timeout";
import {
  clienteSicoob,
  validarCertificadoSicoob,
  testarSandboxSicoob,
  type CertificadoSicoob,
} from "./server-sicoob-http";
import {
  condicoesSicoob,
  camposDivergentesBoletoSicoob,
  linhaDigitavelSicoob,
  respostaSimuladaSicoob,
  dataSicoob,
  dinheiroSicoob,
  instrucaoSicoob,
  type CondicoesSicoob,
  type InstrucaoSicoob,
  type SicoobConfig,
} from "./sicoob-api";
import { hojeSaoPaulo } from "./painel-trabalho";

type Row = Record<string, unknown>;
type Ambiente = "producao" | "homologacao";
type Sessao = { accessToken: string };
type Alvo = Sessao & { boletoId: string; sandbox?: boolean };
const uuid = (s: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))
    throw Error("Identificador inválido.");
  return s;
};
const ambiente = (s: string): Ambiente => {
  if (s !== "producao" && s !== "homologacao") throw Error("Ambiente inválido.");
  return s;
};
const obj = (x: unknown): Row => {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw Error("Retorno bancário incompleto.");
  return x as Row;
};
async function acesso(token: string, acao: string, admin = false) {
  const user = await requireServerAuth(
    token,
    admin ? ["admin"] : ["admin", "gestor", "financeiro"],
  );
  await enforceRateLimit(token, acao, 30, 60);
  const { url, anon } = env();
  const permissoes =
    acao === "sicoob_config_get"
      ? ["sicoob_operar", "centros_cobranca_configurar"]
      : acao.startsWith("sicoob_config_")
        ? ["centros_cobranca_configurar"]
        : ["sicoob_operar"];
  let permitido = false;
  for (const codigo of permissoes) {
    const r = await fetchWithTimeout(url + "/rest/v1/rpc/pode_rotina", {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ _acao: codigo }),
    });
    if (r.ok && (await r.json()) === true) {
      permitido = true;
      break;
    }
  }
  if (!permitido) throw Error("Rotina Sicoob não liberada para seu perfil e módulo.");
  return user;
}
function env() {
  const url = process.env["EXT_SUPABASE_URL"]?.replace(/\/$/, ""),
    anon = process.env["EXT_SUPABASE_ANON_KEY"],
    key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !anon || !key) throw Error("Configuração segura do servidor indisponível.");
  return { url, anon, key };
}
async function rpc<T>(fn: string, args: Row): Promise<T> {
  const { url, key } = env();
  const r = await fetchWithTimeout(url + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = await r.text();
  if (!r.ok) {
    try {
      const e = JSON.parse(body) as Row;
      if (e["code"] === "P0001") throw Error(String(e["message"]).slice(0, 700));
    } catch (e) {
      if (e instanceof Error && !(e instanceof SyntaxError)) throw e;
    }
    throw Error("Não foi possível persistir a operação Sicoob. Consulte antes de repetir.");
  }
  return (body ? JSON.parse(body) : null) as T;
}
async function ler<T = Row>(token: string, path: string): Promise<T[]> {
  const { url, anon } = env();
  const r = await fetchWithTimeout(url + "/rest/v1/" + path, {
    headers: { apikey: anon, Authorization: "Bearer " + token },
  });
  if (!r.ok) throw Error("Registro indisponível ou sem acesso nesta loja.");
  return (await r.json()) as T[];
}
async function privado(actor: string, loja: string, modo: Ambiente) {
  const p = await rpc<{ config: SicoobConfig; certificado: CertificadoSicoob }>(
    "sicoob_privado_316",
    { _actor: actor, _centro: uuid(loja), _ambiente: modo },
  );
  return { ...p, api: await clienteSicoob(p.config.client_id, p.certificado, undefined, modo) };
}
function numero(v: unknown, opcional = false) {
  if (opcional && (v === "" || v === null || v === undefined)) return null;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw Error("Informe os números do convênio sem pontuação.");
  return n;
}
export const sicoobConfigGet = createServerFn({ method: "POST" })
  .inputValidator((d: Sessao & { centroId: string; ambiente: Ambiente }) => d)
  .handler(async ({ data: d }) => {
    const actor = await acesso(d.accessToken, "sicoob_config_get");
    await rpc("validar_sicoob_316", { _actor: actor.id, _centro: uuid(d.centroId), _admin: false });
    const rows = await ler(
      d.accessToken,
      `sicoob_config_316?select=centro_id,ambiente,client_id,numero_cliente,numero_conta,numero_contrato,versao,autenticado_em,autenticado_versao,segredo_id,ativo,condicoes_emissao&centro_id=eq.${uuid(d.centroId)}&ambiente=eq.${ambiente(d.ambiente)}`,
    );
    const r = rows[0];
    return {
      centro_id: d.centroId,
      ambiente: d.ambiente,
      condicoes_emissao: validarEmissaoSicoob(r?.["condicoes_emissao"]),
      client_id: String(r?.["client_id"] ?? ""),
      numero_cliente: Number(r?.["numero_cliente"] ?? 0),
      numero_conta: Number(r?.["numero_conta"] ?? 0),
      numero_contrato: r?.["numero_contrato"] ? Number(r["numero_contrato"]) : null,
      versao: Number(r?.["versao"] ?? 0),
      ativo: r?.["ativo"] === true,
      certificado_configurado: !!r?.["segredo_id"],
      autenticado_em: r?.["autenticado_em"] ? String(r["autenticado_em"]) : null,
      autenticado_versao: r?.["autenticado_versao"] ? Number(r["autenticado_versao"]) : null,
    };
  });
export const sicoobConfigSalvar = createServerFn({ method: "POST" })
  .inputValidator(
    (
      d: Sessao & {
        centroId: string;
        ambiente: Ambiente;
        clientId: string;
        numeroCliente: string;
        numeroConta: string;
        numeroContrato: string;
        condicoesEmissao?: EmissaoSicoob;
        contaId: string;
        ativo: boolean;
        versao: number;
        tokenSandbox?: string;
        pfx?: string;
        senha?: string;
      },
    ) => d,
  )
  .handler(async ({ data: d }) => {
    const actor = await acesso(d.accessToken, "sicoob_config_save", true),
      modo = ambiente(d.ambiente);
    const client = d.clientId.trim();
    if (client && !/^[A-Za-z0-9._-]{1,150}$/.test(client)) throw Error("Client ID inválido.");
    let segredo: CertificadoSicoob | null = null;
    if (modo === "homologacao" && d.tokenSandbox?.trim()) {
      const token = d.tokenSandbox.trim().replace(/^Bearer\s+/i, "");
      if (!/^[A-Za-z0-9._~+/=:-]{8,16000}$/.test(token)) throw Error("Token de sandbox inválido.");
      segredo = { sandbox_token: token };
    }
    if (modo === "producao" && d.senha && !d.pfx)
      throw Error("Envie novamente o certificado para alterar sua senha.");
    if (modo === "producao" && d.pfx) {
      segredo = { pfx: d.pfx, senha: d.senha ?? "" };
      validarCertificadoSicoob(segredo);
    }
    if ((modo === "producao" && d.tokenSandbox) || (modo === "homologacao" && d.pfx))
      throw Error("Credencial não corresponde ao ambiente selecionado.");
    await rpc("sicoob_config_salvar_351", {
      _actor: actor.id,
      _centro: uuid(d.centroId),
      _ambiente: modo,
      _config: {
        condicoes_emissao: validarEmissaoSicoob(d.condicoesEmissao),
        client_id: client,
        numero_cliente: numero(d.numeroCliente, true),
        numero_conta: numero(d.numeroConta, true),
        numero_contrato: numero(d.numeroContrato, true),
      },
      _conta: modo === "producao" && d.contaId ? uuid(d.contaId) : null,
      _ativo: d.ativo,
      _esperada: d.versao,
      _segredo: segredo,
    });
    return { mensagem: "Configuração Sicoob salva. As credenciais permanecem no cofre." };
  });
export const sicoobTestarConexao = createServerFn({ method: "POST" })
  .inputValidator((d: Sessao & { centroId: string; ambiente: Ambiente }) => d)
  .handler(async ({ data: d }) => {
    const actor = await acesso(d.accessToken, "sicoob_config_test", true),
      modo = ambiente(d.ambiente),
      p = await privado(actor.id, d.centroId, modo);
    if (modo === "homologacao") {
      await testarSandboxSicoob(p.api, p.config.numero_cliente);
    }
    await rpc("sicoob_autenticado_316", {
      _actor: actor.id,
      _centro: uuid(d.centroId),
      _versao: p.config.versao,
      _ambiente: modo,
    });
    return {
      mensagem:
        modo === "homologacao"
          ? "Acesso ao sandbox testado. Isso não ativa nem homologa a produção."
          : "Autenticação de produção validada. Confira as permissões do aplicativo e os dados do convênio antes de emitir.",
    };
  });
async function contexto(d: Alvo, actor: string) {
  const tabela = d.sandbox ? "sicoob_sandbox_316" : "boletos",
    b = (await ler(d.accessToken, `${tabela}?select=*&id=eq.${uuid(d.boletoId)}&limit=1`))[0];
  if (!b || b["banco"] !== "sicoob" || b["canal"] !== "api")
    throw Error("Boleto Sicoob indisponível nesta loja.");
  const modo: Ambiente = d.sandbox ? "homologacao" : "producao";
  if (b["ambiente"] !== modo) throw Error("Ambiente do boleto divergente.");
  const p = await privado(actor, String(b["centro_id"]), modo),
    snap = obj(b["sicoob_snapshot_316"]);
  if (
    Number(snap["numero_cliente"]) !== p.config.numero_cliente ||
    Number(snap["numero_conta"]) !== p.config.numero_conta ||
    (snap["numero_contrato"] ?? null) !== p.config.numero_contrato
  )
    throw Error(
      "Registro vinculado a outro convênio. Preserve a configuração original para consultá-lo.",
    );
  return { b, ...p };
}
function validaIdentidade(c: CondicoesSicoob, b: Row, cfg: SicoobConfig, raw: Row) {
  const campos = camposDivergentesBoletoSicoob(c, b, cfg, raw);
  if (campos.length)
    throw Error(
      `Retorno Sicoob divergente em: ${campos.join(", ")}. Consulte a tentativa sem emitir novamente.`,
    );
  const snap = obj(b["sicoob_snapshot_316"]);
  if (
    cfg.numero_contrato &&
    raw["numeroContratoCobranca"] !== undefined &&
    Number(raw["numeroContratoCobranca"]) !== cfg.numero_contrato
  )
    throw Error("Contrato de cobrança divergente no retorno bancário.");
  const pagador = raw["pagador"];
  if (pagador && typeof pagador === "object" && !Array.isArray(pagador)) {
    const recebido = String((pagador as Row)["numeroCpfCnpj"] ?? "")
      .replace(/[^0-9A-Za-z]/g, "")
      .toUpperCase();
    const esperado = String(snap["pagador_documento"] ?? "")
      .replace(/[^0-9A-Za-z]/g, "")
      .toUpperCase();
    if (recebido && esperado && recebido !== esperado)
      throw Error("Pagador divergente no retorno bancário.");
  }
}
function queryBanco(cfg: SicoobConfig, b: Row, pdf = false) {
  const q = new URLSearchParams({
    numeroCliente: String(cfg.numero_cliente),
    codigoModalidade: "1",
    nossoNumero: String(b["nosso_numero"]),
  });
  if (cfg.numero_contrato) q.set("numeroContratoCobranca", String(cfg.numero_contrato));
  if (pdf) {
    q.set("gerarPdf", "true");
    const snapshot = obj(b["sicoob_snapshot_316"]);
    const condicoes = validarEmissaoSicoob(snapshot["condicoes_emissao"]);
    q.set("tipoFormularioImpressaoPDF", String(condicoes.formulario));
  }
  return q.toString();
}
const mensagemMock =
  "Resposta simulada recebida do Sicoob. O sandbox devolve dados fixos; isso não confirma registro ou alteração de um boleto.";
async function registrarMock(actor: string, testeId: string, raw: Row) {
  await rpc("sicoob_mock_recebido_320", { _actor: actor, _teste: uuid(testeId), _resposta: raw });
  return {
    situacao: "simulado",
    confirmado: false,
    pendente: false,
    nota: mensagemMock,
    condicoes: null,
  };
}
async function consultarContexto(
  d: Alvo & { linhaDigitavel?: string },
  actor: string,
  p: Awaited<ReturnType<typeof contexto>>,
) {
  let raw: Row;
  if (
    d.sandbox &&
    !p.b["nosso_numero"] &&
    ["em_processamento", "simulado"].includes(String(p.b["status"]))
  ) {
    const r = await p.api("/boletos?" + queryBanco(p.config, { nosso_numero: "1" }));
    if (r.status === 200) {
      const mock = obj(r.json["resultado"]);
      if (respostaSimuladaSicoob(mock)) return registrarMock(actor, String(p.b["id"]), mock);
    }
  }
  if (d.linhaDigitavel !== undefined) {
    if (d.sandbox) throw Error("Consulta por linha digitável disponível somente em produção.");
    const q = new URLSearchParams({
      numeroCliente: String(p.config.numero_cliente),
      codigoModalidade: "1",
      linhaDigitavel: linhaDigitavelSicoob(d.linhaDigitavel),
    });
    if (p.config.numero_contrato) q.set("numeroContratoCobranca", String(p.config.numero_contrato));
    const r = await p.api("/boletos?" + q);
    if (r.status === 204) return consultaVaziaSicoob(!!p.b["sicoob_pendente_316"]);
    if (r.status !== 200) throw Error(erroOperacaoSicoob("Consulta", r.status, r.motivo));
    raw = obj(r.json["resultado"]);
  } else if (p.b["nosso_numero"]) {
    const r = await p.api("/boletos?" + queryBanco(p.config, p.b));
    if (r.status === 204) return consultaVaziaSicoob(!!p.b["sicoob_pendente_316"]);
    if (r.status !== 200) throw Error(erroOperacaoSicoob("Consulta", r.status, r.motivo));
    raw = obj(r.json["resultado"]);
  } else {
    const ops = await ler(
      d.accessToken,
      `sicoob_operacoes_316?select=requisicao&${d.sandbox ? "teste_id" : "boleto_id"}=eq.${uuid(d.boletoId)}&tipo=eq.emissao&order=created_at.desc&limit=1`,
    );
    const req = obj(ops[0]?.["requisicao"]),
      pagador = obj(req["pagador"]),
      doc = String(pagador["numeroCpfCnpj"] ?? "");
    if (!/^[0-9A-Za-z]{11,14}$/.test(doc))
      throw Error("Documento do pagador indisponível para recuperar a emissão.");
    const registros = await consultarPagadorSicoob(
      p.api,
      p.config.numero_cliente,
      doc,
      req["dataVencimento"],
    );
    const encontrados = registros
      .map(obj)
      .filter(
        (x) =>
          String(x["seuNumero"]) === String(p.b["seu_numero"]) &&
          Number(x["numeroCliente"]) === p.config.numero_cliente &&
          Number(x["codigoModalidade"]) === 1,
      );
    if (encontrados.length === 0) return consultaVaziaSicoob(!!p.b["sicoob_pendente_316"], 200);
    if (encontrados.length !== 1)
      throw Error(
        "Banco ainda não confirmou uma única emissão para este identificador. Consulte novamente; não houve reenvio.",
      );
    const encontrado = encontrados[0]!;
    const nossoNumero = String(encontrado["nossoNumero"] ?? "");
    if (!/^[0-9]{1,18}$/.test(nossoNumero) || /^0+$/.test(nossoNumero))
      throw Error(
        "Registro localizado sem nosso número válido. Confira no Sicoob antes de prosseguir.",
      );
    // A lista identifica o título; a consulta individual confirma seus dados atuais.
    const detalhe = await p.api(
      "/boletos?" + queryBanco(p.config, { ...p.b, nosso_numero: nossoNumero }),
    );
    if (detalhe.status === 204) return consultaVaziaSicoob(!!p.b["sicoob_pendente_316"]);
    if (detalhe.status !== 200)
      throw Error(erroOperacaoSicoob("Consulta", detalhe.status, detalhe.motivo));
    raw = obj(detalhe.json["resultado"]);
    if (String(raw["nossoNumero"]) !== nossoNumero)
      throw Error("Consulta individual diverge do registro localizado. Confira no Sicoob.");
  }
  const c = condicoesSicoob(raw);
  validaIdentidade(c, p.b, p.config, raw);
  if (d.linhaDigitavel !== undefined && c.linhaDigitavel !== linhaDigitavelSicoob(d.linhaDigitavel))
    throw Error("Linha digitável retornada diverge da consulta. Nenhum vínculo foi alterado.");
  const resultado = await rpc<{
    situacao: string;
    confirmado: boolean;
    nota: string | null;
    pendente: boolean;
  }>(d.sandbox ? "sicoob_sandbox_sincronizar_316" : "sicoob_sincronizar_316", {
    _actor: actor,
    _boleto: uuid(d.boletoId),
    _banco: c,
  });
  return { condicoes: c, ...resultado };
}
export const sicoobConsultarBoleto = createServerFn({ method: "POST" })
  .inputValidator((d: Alvo & { linhaDigitavel?: string }) => d)
  .handler(async ({ data: d }) => {
    const actor = await acesso(d.accessToken, "sicoob_consultar"),
      p = await contexto(d, actor.id);
    return consultarContexto(d, actor.id, p);
  });
export const sicoobPreviaBoleto = createServerFn({ method: "POST" })
  .inputValidator((d: Alvo) => d)
  .handler(async ({ data: d }) => {
    const actor = await acesso(d.accessToken, "sicoob_previa"),
      p = await contexto(d, actor.id);
    return consultarContexto(d, actor.id, p);
  });
export const sicoobAlterarBoleto = createServerFn({ method: "POST" })
  .inputValidator(
    (
      d: Alvo & {
        chave: string;
        anterior: CondicoesSicoob;
        instrucao: InstrucaoSicoob;
        motivo: string;
      },
    ) => d,
  )
  .handler(async ({ data: d }) => {
    const actor = await acesso(d.accessToken, "sicoob_alterar", d.instrucao.tipo !== "vencimento"),
      p = await contexto(d, actor.id);
    if (p.b["sicoob_pendente_316"]) {
      const c = await consultarContexto(d, actor.id, p);
      return {
        mensagem:
          c.nota ??
          (c.pendente
            ? "Solicitação pendente: a consulta ainda não confirmou o resultado. Nenhuma instrução foi reenviada."
            : "Situação atualizada no banco. Confira o histórico antes de nova alteração."),
      };
    }
    const atual = await consultarContexto(d, actor.id, p);
    if (!atual.condicoes) throw Error(atual.nota ?? mensagemMock);
    if (JSON.stringify(atual.condicoes) !== JSON.stringify(d.anterior))
      throw Error("As condições bancárias mudaram. Atualize a prévia antes de confirmar.");
    const i = instrucaoSicoob(
        atual.condicoes,
        d.instrucao,
        hojeSaoPaulo(),
        p.config.numero_contrato,
      ),
      opRetorno = await rpc<Row | Row[]>(
        d.sandbox ? "sicoob_sandbox_alterar_316" : "sicoob_reservar_alteracao_316",
        {
          _actor: actor.id,
          _boleto: uuid(d.boletoId),
          _chave: uuid(d.chave),
          _tipo: d.instrucao.tipo,
          _anterior: atual.condicoes,
          _esperado: i.esperado,
          _payload: i.body,
          _motivo: d.motivo,
        },
      );
    const op = Array.isArray(opRetorno) ? opRetorno[0] : opRetorno;
    if (!op?.["id"])
      throw Error(
        "Reserva da solicitação não foi confirmada. Consulte o histórico antes de repetir.",
      );
    const enviar = await rpc<boolean>("sicoob_enviar_316", {
      _actor: actor.id,
      _operacao: op["id"],
    });
    if (!enviar)
      return { mensagem: "Solicitação já registrada. Use Consultar para conferir o resultado." };
    try {
      const r = await p.api(
        `/boletos/${encodeURIComponent(atual.condicoes.nossoNumero)}` +
          (d.instrucao.tipo === "baixar" ? "/baixar" : ""),
        d.instrucao.tipo === "baixar" ? "POST" : "PATCH",
        i.body,
      );
      if (r.status !== 204) {
        const recusado = [400, 401, 403, 404, 405, 406, 422].includes(r.status);
        await rpc("sicoob_estado_operacao_316", {
          _actor: actor.id,
          _operacao: op["id"],
          _estado: recusado ? "recusado" : "incerto",
          _nota: `Sicoob retornou HTTP ${r.status}. Confira os dados e permissões do aplicativo.`,
        });
        throw Error(
          `Sicoob retornou HTTP ${r.status}. Consulte a situação antes de tentar novamente.`,
        );
      }
    } catch (e) {
      await rpc("sicoob_estado_operacao_316", {
        _actor: actor.id,
        _operacao: op["id"],
        _estado: "incerto",
        _nota: "Resposta bancária não confirmada. Não reenviar automaticamente.",
      });
      throw e;
    }
    const atualizado = await contexto(d, actor.id);
    try {
      const c = await consultarContexto(d, actor.id, atualizado);
      return {
        mensagem: c.pendente
          ? "Solicitação enviada. Aguarde e consulte novamente para confirmar."
          : (c.nota ?? "Alteração confirmada pelo Sicoob."),
      };
    } catch {
      return {
        mensagem:
          "Solicitação enviada; confirmação pendente. Use Consultar antes de outra alteração.",
      };
    }
  });
function payloadEmissao(
  cfg: SicoobConfig,
  valor: number,
  vencimento: string,
  parcela: number,
  pagador: Row,
): Row {
  if (!cfg.numero_cliente || !cfg.numero_conta)
    throw Error("Informe número do cliente e conta do convênio.");
  const doc = String(pagador["numeroCpfCnpj"] ?? "").replace(/[./\-\s]/g, "");
  if (!/^(?:\d{11}|[A-Za-z0-9]{12}\d{2})$/.test(doc)) throw Error("Confira CPF/CNPJ do pagador.");
  for (const k of ["nome", "endereco", "bairro", "cidade", "uf", "cep"])
    if (!String(pagador[k] ?? "").trim())
      throw Error("Complete nome e endereço do pagador antes de emitir.");
  if (!/^\d{8}$/.test(String(pagador["cep"])) || !/^[A-Z]{2}$/.test(String(pagador["uf"])))
    throw Error("Confira CEP e UF do pagador.");
  if (!Number.isInteger(parcela) || parcela < 1 || parcela > 99)
    throw Error("Parcela fora do limite Sicoob (1 a 99).");
  dataSicoob(vencimento);
  if (valor <= 0) throw Error("Informe um valor positivo para o boleto.");
  return {
    numeroCliente: cfg.numero_cliente,
    codigoModalidade: 1,
    numeroContaCorrente: cfg.numero_conta,
    ...(cfg.numero_contrato ? { numeroContratoCobranca: cfg.numero_contrato } : {}),
    codigoEspecieDocumento: "DM",
    identificacaoEmissaoBoleto: 2,
    identificacaoDistribuicaoBoleto: 2,
    dataEmissao: hojeSaoPaulo(),
    valor: dinheiroSicoob(valor),
    dataVencimento: vencimento,
    tipoDesconto: 0,
    valorAbatimento: 0,
    tipoMulta: 0,
    tipoJurosMora: 3,
    numeroParcela: parcela,
    aceite: false,
    codigoProtesto: 3,
    codigoNegativacao: 3,
    gerarPdf: true,
    codigoCadastrarPIX: 2,
    ...condicoesEmissaoSicoob(cfg.condicoes_emissao, vencimento, valor, hojeSaoPaulo()),
    pagador: { ...pagador, numeroCpfCnpj: doc },
  };
}
async function emitirReserva(
  d: Sessao,
  actor: string,
  reserva: { boleto: Row; operacao: Row; recuperar: boolean },
  sandbox: boolean,
) {
  const b = reserva.boleto,
    alvo: Alvo = { accessToken: d.accessToken, boletoId: String(b["id"]), sandbox },
    p = await contexto(alvo, actor);
  if (
    reserva.recuperar ||
    !(await rpc<boolean>("sicoob_enviar_316", { _actor: actor, _operacao: reserva.operacao["id"] }))
  ) {
    const c = await consultarContexto(alvo, actor, p);
    if (c.situacao === "SEM_RESULTADO")
      throw Error(c.nota ?? "Registro ainda não confirmado no banco.");
    return {
      boletoId: String(b["id"]),
      mensagem: "Registro recuperado por consulta; não houve reenvio.",
      ...c,
    };
  }
  let retornoRegistrado = false;
  try {
    const r = await p.api("/boletos", "POST", obj(reserva.operacao["requisicao"]));
    if (r.status !== 200) {
      await rpc("sicoob_estado_operacao_316", {
        _actor: actor,
        _operacao: reserva.operacao["id"],
        _estado: [400, 401, 403, 404, 405, 406, 422].includes(r.status) ? "recusado" : "incerto",
        _nota: erroOperacaoSicoob("Emissão", r.status, r.motivo),
      });
      retornoRegistrado = true;
      throw Error(erroOperacaoSicoob("Emissão", r.status, r.motivo));
    }
    const raw = obj(r.json["resultado"]);
    if (sandbox && respostaSimuladaSicoob(raw)) {
      await registrarMock(actor, String(b["id"]), raw);
      return { boletoId: String(b["id"]), mensagem: mensagemMock };
    }
    const c = condicoesSicoob({ ...raw, situacaoBoleto: raw["situacaoBoleto"] ?? "Em Aberto" });
    validaIdentidade(c, b, p.config, raw);
    await rpc(sandbox ? "sicoob_sandbox_sincronizar_316" : "sicoob_sincronizar_316", {
      _actor: actor,
      _boleto: b["id"],
      _banco: c,
    });
    return {
      boletoId: String(b["id"]),
      mensagem: sandbox
        ? "Boleto de sandbox registrado, sem efeito no financeiro real."
        : "Boleto registrado no Sicoob.",
    };
  } catch (e) {
    if (!retornoRegistrado)
      await rpc("sicoob_estado_operacao_316", {
        _actor: actor,
        _operacao: reserva.operacao["id"],
        _estado: "incerto",
        _nota: "Registro sem confirmação local. Recuperar por consulta antes de nova emissão.",
      });
    throw e;
  }
}
export const sicoobEmitirBoleto = createServerFn({ method: "POST" })
  .inputValidator((d: Sessao & { contaId: string }) => d)
  .handler(async ({ data: d }) => {
    const actor = await acesso(d.accessToken, "sicoob_emitir"),
      t = (await ler(d.accessToken, `contas_receber?select=*&id=eq.${uuid(d.contaId)}&limit=1`))[0];
    if (!t) throw Error("Título indisponível.");
    const p = await privado(actor.id, String(t["centro_id"]), "producao"),
      cli = (
        await ler(
          d.accessToken,
          `clientes?select=razao_social,cnpj_cpf,logradouro,numero,complemento,bairro,cidade,uf,cep,email&id=eq.${uuid(String(t["cliente_id"]))}&limit=1`,
        )
      )[0];
    if (!cli) throw Error("Cliente indisponível.");
    if (!String(cli["logradouro"] ?? "").trim())
      throw Error("Complete o logradouro do cliente antes de emitir o boleto.");
    const saldo =
      Math.round(
        (Number(t["valor"] ?? 0) +
          Number(t["juros"] ?? 0) +
          Number(t["multa"] ?? 0) +
          Number(t["acrescimo"] ?? 0) -
          Number(t["desconto"] ?? 0) -
          Number(t["valor_pago"] ?? 0)) *
          100,
      ) / 100;
    const payload = payloadEmissao(
      p.config,
      saldo,
      String(t["vencimento"]),
      Number(t["parcela"] ?? 1),
      {
        numeroCpfCnpj: cli["cnpj_cpf"],
        nome: String(cli["razao_social"] ?? "").slice(0, 50),
        endereco: [cli["logradouro"], cli["numero"], cli["complemento"]].filter(Boolean).join(", "),
        bairro: cli["bairro"],
        cidade: cli["cidade"],
        uf: String(cli["uf"] ?? "").toUpperCase(),
        cep: String(cli["cep"] ?? "").replace(/\D/g, ""),
      },
    );
    const r = await rpc<{ boleto: Row; operacao: Row; recuperar: boolean }>(
      "sicoob_reservar_emissao_351",
      { _actor: actor.id, _conta: uuid(d.contaId), _payload: payload, _versao: p.config.versao },
    );
    return emitirReserva(d, actor.id, r, false);
  });
export const sicoobEmitirSandbox = createServerFn({ method: "POST" })
  .inputValidator(
    (
      d: Sessao & {
        centroId: string;
        chave: string;
        valor: string;
        vencimento: string;
        pagador: Row;
      },
    ) => d,
  )
  .handler(async ({ data: d }) => {
    const actor = await acesso(d.accessToken, "sicoob_sandbox_emitir"),
      p = await privado(actor.id, d.centroId, "homologacao"),
      payload = payloadEmissao(
        p.config,
        dinheiroSicoob(d.valor),
        dataSicoob(d.vencimento),
        1,
        d.pagador,
      );
    const r = await rpc<{ boleto: Row; operacao: Row; recuperar: boolean }>(
      "sicoob_sandbox_reservar_316",
      { _actor: actor.id, _centro: uuid(d.centroId), _chave: uuid(d.chave), _payload: payload },
    );
    return emitirReserva(d, actor.id, r, true);
  });
export const sicoobPdfBoleto = createServerFn({ method: "POST" })
  .inputValidator((d: Alvo) => d)
  .handler(async ({ data: d }) => {
    const actor = await acesso(d.accessToken, "sicoob_pdf"),
      p = await contexto(d, actor.id);
    if (!p.b["nosso_numero"] || !["registrado", "liquidado"].includes(String(p.b["status"])))
      throw Error("Confirme o registro antes de imprimir.");
    const r = await p.api("/boletos/segunda-via?" + queryBanco(p.config, p.b, true));
    if (r.status !== 200) throw Error("Sicoob não disponibilizou a segunda via.");
    const raw = obj(r.json["resultado"]);
    if (
      String(raw["nossoNumero"]) !== String(p.b["nosso_numero"]) ||
      Number(raw["numeroCliente"]) !== p.config.numero_cliente ||
      Number(raw["codigoModalidade"]) !== 1 ||
      (raw["seuNumero"] !== undefined && String(raw["seuNumero"]) !== String(p.b["seu_numero"])) ||
      Number(raw["valor"]) !== Number(p.b["valor"])
    )
      throw Error("A segunda via não corresponde ao boleto solicitado.");
    const pdf = String(raw["pdfBoleto"] ?? "");
    if (
      pdf.length > 11000000 ||
      !pdf ||
      !Buffer.from(pdf, "base64").subarray(0, 5).equals(Buffer.from("%PDF-"))
    )
      throw Error("PDF bancário inválido.");
    return { base64: pdf };
  });

/** Conta Corrente é outro aplicativo e só oferece consulta nesta integração. */
export const sicoobExtratoConfig = createServerFn({ method: "POST" })
  .inputValidator((d: Sessao & { centroId: string }) => d)
  .handler(async ({ data: d }) => {
    const actor = await acesso(d.accessToken, "sicoob_config_extrato_get", true);
    return rpc<{ clientId: string; numeroConta: string; certificado: boolean; versao: number }>(
      "sicoob_extrato_config_352",
      { _actor: actor.id, _centro: uuid(d.centroId) },
    );
  });
export const sicoobExtratoSalvar = createServerFn({ method: "POST" })
  .inputValidator(
    (
      d: Sessao & {
        centroId: string;
        clientId: string;
        numeroConta: string;
        versao: number;
        pfx?: string;
        senha?: string;
      },
    ) => d,
  )
  .handler(async ({ data: d }) => {
    const actor = await acesso(d.accessToken, "sicoob_config_extrato_save", true);
    if (
      !/^[A-Za-z0-9._-]{1,150}$/.test(d.clientId) ||
      !/^\d{1,18}$/.test(d.numeroConta) ||
      !Number.isSafeInteger(Number(d.numeroConta)) ||
      Number(d.numeroConta) <= 0
    )
      throw Error("Confira Client ID de Conta Corrente e conta sem pontuação.");
    if (!Number.isInteger(d.versao) || d.versao < 0)
      throw Error("Versão da configuração inválida.");
    if (d.senha && !d.pfx) throw Error("Para substituir a senha, envie também o certificado.");
    const segredo = d.pfx ? { pfx: d.pfx, senha: d.senha ?? "" } : null;
    if (segredo) validarCertificadoSicoob(segredo);
    await rpc("sicoob_extrato_salvar_352", {
      _actor: actor.id,
      _centro: uuid(d.centroId),
      _client: d.clientId,
      _conta: d.numeroConta,
      _versao: d.versao,
      _segredo: segredo,
    });
    return {
      mensagem: "Aplicativo de Conta Corrente salvo. A configuração dos boletos foi preservada.",
    };
  });
export const sicoobConsultarExtrato = createServerFn({ method: "POST" })
  .inputValidator(
    (d: Sessao & { centroId: string; mes: string; diaInicial: number; diaFinal: number }) => d,
  )
  .handler(async ({ data: d }) => {
    const actor = await acesso(d.accessToken, "sicoob_config_extrato_read", true);
    const { consultaExtratoSicoob, extratoParaConferenciaSicoob } =
      await import("./sicoob-extrato");
    consultaExtratoSicoob("1", d.mes, d.diaInicial, d.diaFinal, hojeSaoPaulo());
    const c = await rpc<{ clientId: string; numeroConta: string; certificado: CertificadoSicoob }>(
      "sicoob_extrato_reservar_352",
      { _actor: actor.id, _centro: uuid(d.centroId) },
    );
    const { consultarExtratoContaSicoob } = await import("./server-sicoob-http");
    const raw = await consultarExtratoContaSicoob(
      c.clientId,
      c.certificado,
      consultaExtratoSicoob(c.numeroConta, d.mes, d.diaInicial, d.diaFinal, hojeSaoPaulo()),
    );
    return {
      transacoes: extratoParaConferenciaSicoob(raw),
      consultadoEm: new Date().toISOString(),
    };
  });

export type ConfigTarifasSicoob = {
  ultimaLiqui?: string | null;
  erroLiqui?: string | null;
  ativo: boolean;
  inicio: string;
  categoriaId: string | null;
  versao: number;
  ultimaConsulta: string | null;
  erro: string | null;
  conta: { id: string; nome: string } | null;
  categorias: { id: string; nome: string }[];
  lancados: number;
  conferir: number;
};
export const sicoobTarifasConfig = createServerFn({ method: "POST" })
  .inputValidator((d: Sessao & { centroId: string }) => d)
  .handler(async ({ data: d }) => {
    const actor = await acesso(d.accessToken, "sicoob_config_tarifas_get", true);
    return rpc<ConfigTarifasSicoob>("sicoob_tarifas_get_355", {
      _actor: actor.id,
      _centro: uuid(d.centroId),
    });
  });
export const sicoobTarifasSalvar = createServerFn({ method: "POST" })
  .inputValidator(
    (
      d: Sessao & {
        centroId: string;
        categoriaId: string;
        inicio: string;
        ativo: boolean;
        versao: number;
      },
    ) => d,
  )
  .handler(async ({ data: d }) => {
    const actor = await acesso(d.accessToken, "sicoob_config_tarifas_save", true);
    dataSicoob(d.inicio);
    if (typeof d.ativo !== "boolean" || !Number.isInteger(d.versao) || d.versao < 0)
      throw Error("Configuração de tarifas inválida.");
    await rpc("sicoob_tarifas_salvar_355", {
      _actor: actor.id,
      _centro: uuid(d.centroId),
      _categoria: uuid(d.categoriaId),
      _inicio: d.inicio,
      _ativo: d.ativo,
      _versao: d.versao,
    });
    return {
      mensagem:
        "Configuração salva. Apenas tarifas vinculadas a boletos emitidos pelo sistema serão contabilizadas.",
    };
  });
export const sicoobTarifasSincronizar = createServerFn({ method: "POST" })
  .inputValidator((d: Sessao & { centroId: string }) => d)
  .handler(async ({ data: d }) => {
    const actor = await acesso(d.accessToken, "sicoob_config_tarifas_sync", true);
    const { executarTarifasSicoob } = await import("./server-sicoob-tarifas");
    const r = await rpc<import("./server-sicoob-tarifas").ReservaTarifasSicoob>(
      "sicoob_tarifas_reservar_355",
      { _actor: actor.id, _centro: uuid(d.centroId) },
    );
    return executarTarifasSicoob(r, rpc);
  });

export const sicoobStatusAutomatico = createServerFn({ method: "POST" })
  .inputValidator((d: Sessao & { centroId: string }) => d)
  .handler(async ({ data: d }) => {
    const actor = await acesso(d.accessToken, "sicoob_auto_status");
    return rpc<{
      ativo: boolean;
      ultimaConsulta: string | null;
      falhas: number;
      baixarFinanceiro: boolean;
      ultimaLiqui?: string | null;
      erroLiqui?: string | null;
      pendenciasLiqui?: number;
    }>("sicoob_auto_status_358", { _actor: actor.id, _centro: uuid(d.centroId) });
  });
