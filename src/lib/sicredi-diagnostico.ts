export type DiagnosticoConsultaSicredi = {
  etapa: "token" | "consulta";
  tipo: "http" | "timeout" | "rede" | "retorno_invalido" | "nao_identificada";
  http_status?: number;
};

/** Apenas códigos técnicos; nunca inclui mensagens, URLs, respostas ou credenciais. */
export class FalhaConsultaSicredi extends Error {
  readonly diagnostico: DiagnosticoConsultaSicredi;
  constructor(
    diagnostico: DiagnosticoConsultaSicredi,
    mensagem = "Consulta Sicredi não concluída.",
  ) {
    super(mensagem);
    this.name = "FalhaConsultaSicredi";
    const status = diagnostico.http_status;
    this.diagnostico = {
      etapa: diagnostico.etapa === "token" ? "token" : "consulta",
      tipo: ["http", "timeout", "rede", "retorno_invalido"].includes(diagnostico.tipo)
        ? diagnostico.tipo
        : "nao_identificada",
      ...(diagnostico.tipo === "http" &&
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 400 &&
      status <= 599
        ? { http_status: status }
        : {}),
    };
  }
}

export function diagnosticoConsultaSicredi(
  erro: unknown,
  etapa: DiagnosticoConsultaSicredi["etapa"] = "consulta",
): DiagnosticoConsultaSicredi {
  if (erro instanceof FalhaConsultaSicredi)
    return new FalhaConsultaSicredi(erro.diagnostico).diagnostico;
  const tipo =
    erro instanceof Error && ["TimeoutError", "AbortError"].includes(erro.name)
      ? "timeout"
      : erro instanceof TypeError
        ? "rede"
        : "nao_identificada";
  return { etapa, tipo };
}
