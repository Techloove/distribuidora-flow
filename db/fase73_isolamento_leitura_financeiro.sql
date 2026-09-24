-- Fase 73: isolamento de leitura e administração financeira por centro.

begin;

-- Contas financeiras: acesso por centro. Contas globais (centro_id null)
-- permanecem visíveis ao financeiro porque são recursos compartilhados.
drop policy if exists "contas_financeiras_select" on public.contas_financeiras;
create policy "contas_financeiras_select" on public.contas_financeiras
for select to authenticated
using (
  public.can_finance(auth.uid())
  and (centro_id is null or public.usuario_pode_acessar_centro(centro_id))
);

drop policy if exists "contas_financeiras_write" on public.contas_financeiras;
create policy "contas_financeiras_write" on public.contas_financeiras
for insert to authenticated
with check (
  public.can_finance(auth.uid())
  and (centro_id is null or public.usuario_pode_acessar_centro(centro_id))
);

drop policy if exists "contas_financeiras_update" on public.contas_financeiras;
create policy "contas_financeiras_update" on public.contas_financeiras
for update to authenticated
using (
  public.can_finance(auth.uid())
  and (centro_id is null or public.usuario_pode_acessar_centro(centro_id))
)
with check (
  public.can_finance(auth.uid())
  and (centro_id is null or public.usuario_pode_acessar_centro(centro_id))
);

drop policy if exists "contas_financeiras_delete" on public.contas_financeiras;

-- Movimento financeiro: leitura limitada ao centro da conta/movimento.
drop policy if exists "movimentos_financeiros_select" on public.movimentos_financeiros;
create policy "movimentos_financeiros_select" on public.movimentos_financeiros
for select to authenticated
using (
  public.can_finance(auth.uid())
  and (
    public.usuario_pode_acessar_conta_financeira(conta_id)
    and (centro_id is null or public.usuario_pode_acessar_centro(centro_id))
  )
);

-- Transferências: somente entre contas que o usuário pode consultar.
drop policy if exists "transferencias_select" on public.transferencias;
create policy "transferencias_select" on public.transferencias
for select to authenticated
using (
  public.can_finance(auth.uid())
  and public.usuario_pode_acessar_conta_financeira(conta_origem_id)
  and public.usuario_pode_acessar_conta_financeira(conta_destino_id)
);

-- A tabela de boletos já possui política de leitura por centro na Fase 72.

commit;
