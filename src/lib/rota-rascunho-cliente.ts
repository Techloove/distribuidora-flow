/** Rota é opcional no rascunho apenas enquanto o cadastro do cliente aguarda revisão. */
export async function conferirRotaRascunhoCliente(
  rota: unknown,
  pessoaId: unknown,
  consultarPendentes: () => Promise<readonly { id?: unknown }[]>,
): Promise<void> {
  if (rota) return;
  if (!pessoaId) throw new Error("Atualize a lista de clientes e selecione o cliente novamente.");
  let pendentes: readonly { id?: unknown }[];
  try {
    pendentes = await consultarPendentes();
  } catch {
    throw new Error(
      "Não foi possível conferir a aprovação do cadastro. Tente criar o pedido novamente.",
    );
  }
  if (!pendentes.some((p) => p.id === pessoaId))
    throw new Error("Informe a rota de entrega (cadastre no cliente para vir automático)");
}
