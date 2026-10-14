import { createServerFn } from "@tanstack/react-start";
import { documentoFiscal, validateConfig, type CnabConfig } from "./sicredi-cnab";
import { fetchWithTimeout } from "./fetch-timeout";

import { enforceRateLimit, requestAccessToken, requireServerAuth } from "./server-auth";

const CONFIG_ROLES = ["admin", "gestor"] as const;

type DbRow = Record<string, unknown>;

export type SicrediConfigInput = {
  accessToken?: string;
  cnab?: CnabConfig | null;
  confirmar_unificacao?: boolean;
  api_key?: string;
  username?: string;
  password?: string;
  cooperativa?: string;
  posto?: string;
  codigo_beneficiario?: string;
  ambiente?: string;
  tipo_cobranca?: string;
  especie_documento?: string;
  tipo_juro?: string;
  juros?: number;
  multa?: number;
  dias_multa?: number;
  tipo_desconto?: string;
  valor_desconto1?: number;
  dias_desconto1?: number;
  tipo_protesto?: string;
  dias_protesto?: number;
  validade_apos_vencimento?: number;
  informativo?: string;
  mensagem?: string;
};

async function requireConfigAccess(action: string, explicitAccessToken?: string) {
  const accessToken = String(explicitAccessToken ?? "").trim() || requestAccessToken();
  const actor = await requireServerAuth(
    accessToken,
    action === "sicredi_config_save" ? ["admin"] : CONFIG_ROLES,
  );
  await enforceRateLimit(accessToken, action, 30, 60);
  return actor;
}

function env() {
  const url = process.env["EXT_SUPABASE_URL"]?.replace(/\/$/, "");
  const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    throw new Error("Configuração segura do Supabase não disponível no servidor.");
  }
  return { url, key };
}

async function serviceRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, key } = env();
  const res = await fetchWithTimeout(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.text();
  if (!res.ok) {
    let message = "Não foi possível salvar o convênio. Confira a migração fase223 no Supabase.";
    try {
      const error = JSON.parse(body);
      if (error.code === "P0001") message = String(error.message);
    } catch {
      /* resposta externa não exposta */
    }
    throw new Error(message);
  }
  return (body ? JSON.parse(body) : null) as T;
}

async function currentConfig(): Promise<DbRow | null> {
  const rows = await serviceRequest<DbRow[]>(
    "sicredi_config?select=*&order=created_at.asc&limit=1",
  );
  return rows[0] ?? null;
}

function text(v: unknown) {
  return v === null || v === undefined ? "" : String(v);
}

function numberValue(v: unknown, name: string, integer = false) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) {
    throw new Error(`Valor inválido para ${name}.`);
  }
  return n;
}

function oneOf(value: string, allowed: readonly string[], name: string) {
  if (!allowed.includes(value)) throw new Error(`Valor inválido para ${name}.`);
  return value;
}

function publicConfig(row: DbRow | null) {
  return {
    id: row?.["id"] ? String(row["id"]) : null,
    api_key: "",
    api_key_configurada: Boolean(text(row?.["api_key"]).trim()),
    username: text(row?.["username"]),
    password: "",
    password_configurada: Boolean(text(row?.["password"]).trim()),
    cooperativa: text(row?.["cooperativa"]),
    posto: text(row?.["posto"]),
    codigo_beneficiario: text(row?.["codigo_beneficiario"]),
    ambiente: text(row?.["ambiente"]) || "homologacao",
    tipo_cobranca: text(row?.["cooperativa"]) ? text(row?.["tipo_cobranca"]) || "NORMAL" : "NORMAL",
    especie_documento: text(row?.["especie_documento"]) || "DUPLICATA_MERCANTIL_INDICACAO",
    tipo_juro: text(row?.["tipo_juro"]) || "ISENTO",
    juros: Number(row?.["juros"] ?? 0),
    multa: Number(row?.["multa"] ?? 0),
    dias_multa: Number(row?.["dias_multa"] ?? 0),
    tipo_desconto: text(row?.["tipo_desconto"]) || "NAO_TEM_DESCONTO",
    valor_desconto1: Number(row?.["valor_desconto1"] ?? 0),
    dias_desconto1: Number(row?.["dias_desconto1"] ?? 0),
    tipo_protesto: text(row?.["tipo_protesto"]) || "SEM_PROTESTO",
    dias_protesto: Number(row?.["dias_protesto"] ?? 0),
    validade_apos_vencimento: Number(row?.["validade_apos_vencimento"] ?? 0),
    informativo: text(row?.["informativo"]),
    mensagem: text(row?.["mensagem"]),
  };
}

export const sicrediConfigGet = createServerFn({ method: "POST" })
  .inputValidator((data: { accessToken?: string } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    await requireConfigAccess("sicredi_config_get", data?.accessToken);
    const cnab = await serviceRequest<CnabConfig[]>("sicredi_cnab_config?select=*&limit=2");
    if (cnab.length > 1) throw new Error("Aplique a fase208 para compartilhar o convênio.");
    return { ...publicConfig(await currentConfig()), cnab: cnab[0] ?? null };
  });

export const sicrediConfigSave = createServerFn({ method: "POST" })
  .inputValidator((data: SicrediConfigInput) => data)
  .handler(async ({ data }) => {
    const actor = await requireConfigAccess("sicredi_config_save", data.accessToken);

    const atual = await currentConfig();

    const cooperativa = text(data.cooperativa).trim();
    const posto = text(data.posto).trim();
    const beneficiario = text(data.codigo_beneficiario).trim();

    if (!/^\d{4}$/.test(cooperativa)) {
      throw new Error("Cooperativa deve ter 4 dígitos.");
    }
    if (!/^\d{2}$/.test(posto)) {
      throw new Error("Posto deve ter 2 dígitos.");
    }
    if (!/^\d{5}$/.test(beneficiario)) {
      throw new Error("Código do beneficiário deve ter 5 dígitos.");
    }

    const payload: Record<string, unknown> = {
      username: text(data.username).trim() || null,
      cooperativa: cooperativa || null,
      posto: posto || null,
      codigo_beneficiario: beneficiario || null,
      ambiente: oneOf(
        text(data.ambiente || "homologacao"),
        ["homologacao", "producao"],
        "ambiente",
      ),
      tipo_cobranca: oneOf(
        text(data.tipo_cobranca || "NORMAL"),
        ["HIBRIDO", "NORMAL"],
        "tipo de cobrança",
      ),
      especie_documento: text(data.especie_documento).trim() || "DUPLICATA_MERCANTIL_INDICACAO",
      tipo_juro: oneOf(
        text(data.tipo_juro || "ISENTO"),
        ["ISENTO", "PERCENTUAL", "VALOR"],
        "tipo de juros",
      ),
      juros: numberValue(data.juros, "juros"),
      multa: numberValue(data.multa, "multa"),
      dias_multa: numberValue(data.dias_multa, "dias da multa", true),
      tipo_desconto: oneOf(
        text(data.tipo_desconto || "NAO_TEM_DESCONTO"),
        ["NAO_TEM_DESCONTO", "PERCENTUAL", "VALOR"],
        "tipo de desconto",
      ),
      valor_desconto1: numberValue(data.valor_desconto1, "desconto"),
      dias_desconto1: numberValue(data.dias_desconto1, "dias do desconto", true),
      tipo_protesto: oneOf(
        text(data.tipo_protesto || "SEM_PROTESTO"),
        ["SEM_PROTESTO", "PROTESTAR", "NEGATIVAR"],
        "instrução de protesto/negativação",
      ),
      dias_protesto: numberValue(data.dias_protesto, "dias de protesto", true),
      validade_apos_vencimento: numberValue(
        data.validade_apos_vencimento,
        "validade após vencimento",
        true,
      ),
      informativo: text(data.informativo).trim() || null,
      mensagem: text(data.mensagem).trim() || null,
    };

    const apiKey = text(data.api_key).trim();
    const password = text(data.password);
    if (apiKey) payload["api_key"] = apiKey;
    else if (!atual) payload["api_key"] = null;

    if (password) payload["password"] = password;
    else if (!atual) payload["password"] = null;

    let cnab = data.cnab ?? null;
    if (cnab) {
      if (payload["tipo_juro"] === "VALOR")
        throw new Error("Para compartilhar juros com CNAB, use percentual mensal ou isento.");
      cnab = {
        ...cnab,
        documento: documentoFiscal(cnab.documento),
        cooperativa,
        posto,
        beneficiario,
        tipo_cobranca: payload["tipo_cobranca"] as "NORMAL" | "HIBRIDO",
        juros_mensal: payload["tipo_juro"] === "ISENTO" ? 0 : Number(payload["juros"]),
        multa_percentual: Number(payload["multa"]),
      };
      validateConfig(cnab);
    }
    await serviceRequest("rpc/sicredi_salvar_convenio_223", {
      method: "POST",
      body: JSON.stringify({
        _actor: actor.id,
        _api: payload,
        _cnab: cnab,
        _confirmar: data.confirmar_unificacao === true,
      }),
    });

    return publicConfig(await currentConfig());
  });
