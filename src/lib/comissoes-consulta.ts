/** Distingue timeout de erro de implantação, sem recomendar reinstalar rotinas antigas. */
export function mensagemErroComissoes(erro: { message?: string; code?: string }) {
  const mensagem = erro.message ?? "Não foi possível consultar as comissões.";
  if (erro.code === "57014" || /statement timeout|canceling statement/i.test(mensagem))
    return "A consulta de comissões excedeu o tempo limite. Tente novamente ou reduza o período e os filtros.";
  if (
    ["42P01", "42703", "PGRST202", "PGRST205"].includes(erro.code ?? "") ||
    /does not exist|schema cache/i.test(mensagem)
  )
    return "A consulta de comissões precisa de atualização no banco. Contate o administrador do sistema.";
  return mensagem;
}
