import { motivoRecusaSicredi } from "./sicredi-api";

/** Lê somente campos de mensagem conhecidos; nunca devolve corpo bruto ou credenciais. */
export function motivoRecusaSicoob(raw: unknown, segredos: readonly string[] = []) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const mensagem = (x: unknown) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    const v = x as Record<string, unknown>;
    const m = [
      v["mensagem"],
      v["message"],
      v["error_description"],
      v["detail"],
      v["httpMessage"],
      typeof v["error"] === "string" ? v["error"] : null,
    ].find((x) => typeof x === "string" && x.trim());
    if (typeof m !== "string") return null;
    const codigo =
      typeof v["codigo"] === "string" && /^[A-Za-z0-9_.:-]{1,40}$/.test(v["codigo"])
        ? `[${v["codigo"]}] `
        : "";
    return { message: codigo + m.slice(0, 3000) };
  };
  const partes = [
    mensagem(r),
    mensagem(r["error"]),
    typeof r["moreInformation"] === "string" ? mensagem({ message: r["moreInformation"] }) : null,
    ...[r["mensagens"], r["erros"], r["errors"]].flatMap((a) =>
      Array.isArray(a) ? a.slice(0, 3).map(mensagem) : [],
    ),
  ].filter(Boolean);
  return motivoRecusaSicredi(JSON.stringify({ errors: partes.slice(0, 3) }), segredos);
}
export function erroOperacaoSicoob(
  operacao: "Emissão" | "Consulta",
  status: number,
  motivo?: string | null,
) {
  return `${operacao} Sicoob retornou HTTP ${status}.${motivo ? ` Motivo do banco: ${motivo}.` : " O banco não forneceu um motivo reconhecido."}${status === 403 ? (/not registered to plan/i.test(motivo ?? "") ? " O gateway recusou o vínculo do aplicativo com o plano da API. Confirme com o Sicoob a associação e a publicação do aplicativo na API de produção." : " Confira a liberação do aplicativo de Cobrança Bancária v3, certificado vinculado e permissão da operação.") : ""} Consulte a tentativa antes de emitir novamente.`;
}

/** Consulta sem conteúdo não confirma registro, rejeição ou permissão de emissão. */
export function consultaVaziaSicoob(pendente: boolean, status = 204) {
  return {
    situacao: "SEM_RESULTADO",
    confirmado: false,
    pendente,
    condicoes: null,
    nota: `Consulta concluída (HTTP ${status}), sem boleto localizado para os filtros informados. Nenhuma nova emissão foi enviada. Isso não confirma a inexistência do boleto nem resolve uma recusa anterior de emissão; confira o registro e a autorização do aplicativo com o Sicoob antes de reenviar.`,
  };
}
