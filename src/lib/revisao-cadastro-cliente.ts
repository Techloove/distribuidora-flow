/** Mantém o cadastro bloqueado até a liberação administrativa já protegida no servidor. */
export async function salvarRevisaoCadastroCliente({
  payload,
  pendente,
  admin,
  salvar,
  liberar,
}: {
  payload: Record<string, unknown>;
  pendente: boolean;
  admin: boolean;
  salvar: (dados: Record<string, unknown>, exigirPendente: boolean) => Promise<void>;
  liberar: (limite: number) => Promise<void>;
}) {
  const limite = Number(payload["limite_credito"]);
  if (!pendente || !admin || !Number.isFinite(limite) || limite <= 0) {
    await salvar(payload, false);
    return;
  }
  if (!payload["rota_id"]) throw new Error("Defina uma rota ativa antes de aprovar o cadastro.");
  if (payload["ativo"] === false || payload["is_cliente"] === false)
    throw new Error("Mantenha o cadastro ativo e identificado como cliente antes de aprovar.");
  await salvar({ ...payload, limite_credito: 0, status: "bloqueado" }, true);
  try {
    await liberar(limite);
  } catch (error) {
    throw new Error(
      `Os dados foram salvos, mas o cadastro continua pendente de aprovação: ${error instanceof Error ? error.message : "não foi possível liberar o limite"}`,
    );
  }
}
