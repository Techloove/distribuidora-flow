-- Fase 48: permissão por papel para alterar o preço unitário dos itens.
-- Idempotente; não altera dados existentes além do padrão do papel representante.

alter table public.papeis
  add column if not exists pode_alterar_preco boolean not null default true;

-- Representante nasce sem permissão de alterar preço (regra pedida pelo cliente).
update public.papeis set pode_alterar_preco = false where codigo = 'representante';
update public.papeis set pode_alterar_preco = true where codigo = 'admin';

-- Verdadeiro quando o usuário tem pelo menos um papel autorizado a mexer no preço.
create or replace function public.pode_alterar_preco(_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select bool_or(coalesce(p.pode_alterar_preco, true))
      from public.user_roles ur
      left join public.papeis p on p.codigo = ur.role::text
      where ur.user_id = _user_id
    ),
    true
  )
$$;

grant execute on function public.pode_alterar_preco(uuid) to authenticated;

-- Define a permissão de um papel (somente admin).
create or replace function public.papel_definir_preco(_codigo text, _pode boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Apenas administradores podem alterar permissões de papéis';
  end if;
  update public.papeis set pode_alterar_preco = coalesce(_pode, true) where codigo = _codigo;
  if not found then
    raise exception 'Papel % não encontrado', _codigo;
  end if;
end;
$$;

grant execute on function public.papel_definir_preco(text, boolean) to authenticated;

-- Bloqueia alteração do preço unitário para quem não tem permissão.
create or replace function public.trg_item_preco_permitido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_preco numeric;
begin
  if public.pode_alterar_preco(auth.uid()) then
    return new;
  end if;

  select coalesce(nullif(preco_venda, 0), 0) into v_preco
  from public.produtos where id = new.produto_id;

  if tg_op = 'INSERT' then
    -- força o preço de tabela do produto
    new.preco_unitario := coalesce(v_preco, new.preco_unitario);
    return new;
  end if;

  if new.preco_unitario is distinct from old.preco_unitario then
    raise exception 'Seu perfil não permite alterar o preço unitário dos itens';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pedido_itens_preco_permitido on public.pedido_itens;
create trigger trg_pedido_itens_preco_permitido
  before insert or update of preco_unitario on public.pedido_itens
  for each row execute function public.trg_item_preco_permitido();
