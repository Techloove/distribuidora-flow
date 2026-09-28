# Fase 96 — Checklist de homologação de segurança e integridade

> Executar primeiro em um projeto Supabase de homologação. Este arquivo não aplica alterações de dados.

## 1. Diagnóstico de RLS

```sql
select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
and c.relname in ('pedidos','pedido_itens','estoque_movimentos','estoque_saldos','transferencias_estoque','contas_receber','contas_pagar','comissoes','contas_financeiras','movimentos_financeiros','boletos','creditos_clientes','creditos_clientes_aplicacoes','expedicoes','pedido_separacoes','cargas','carga_pedidos')
order by c.relname;
```

## 2. Diagnóstico de policies

```sql
select schemaname, tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' order by tablename, policyname;
```

## 3. Diagnóstico de funções críticas

```sql
select n.nspname as schema_name, p.proname, pg_get_function_identity_arguments(p.oid) as arguments, p.prosecdef as security_definer, p.proconfig as configuration
from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by p.proname;
```

Para funções SECURITY DEFINER, confirmar que search_path está explicitamente controlado.

## 4. Diagnóstico de privilégios

```sql
select grantee, table_schema, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated') order by table_name, grantee, privilege_type;
```

Atenção especial para INSERT/UPDATE/DELETE nas tabelas protegidas.

## 5. Diagnóstico de índices de integridade

```sql
select schemaname, tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and (indexname ilike '%idempot%' or indexname ilike '%pedido%' or indexname ilike '%parcela%' or indexname ilike '%comiss%') order by tablename, indexname;
```

## 6. Testes funcionais obrigatórios

- usuário Centro A não pode manipular Centro B;
- usuário sem permissão de preço não pode alterar preço via RPC;
- duas confirmações simultâneas não podem duplicar efeitos;
- duas baixas simultâneas não podem liquidar o mesmo título duas vezes;
- mesma chave de idempotência + mesmo payload deve ser repetível;
- mesma chave + payload diferente deve ser rejeitada;
- duas aplicações simultâneas não podem consumir crédito acima do saldo;
- transferência concorrente não pode gerar saldo negativo;
- pedido com expedição em rota não pode ser cancelado;
- expedição entregue não pode sofrer alteração operacional;
- escrita direta em tabelas protegidas deve ser recusada.

## 7. Evidências

Para cada teste registrar usuário, centro, data/hora, operação, resultado esperado, resultado obtido e mensagem de erro quando bloqueado.

## 8. Critério de liberação

Não considerar a branch pronta para produção apenas pelo CI.

Liberação somente após migrations aplicadas sem erro em homologação, RLS/privilégios revisados, testes de concorrência e idempotência executados, estoque/financeiro/logística validados e backup/ponto de restauração confirmado.

## 9. Auditoria de EXECUTE implícito em funções

No PostgreSQL, novas funções podem herdar EXECUTE para PUBLIC. Antes da produção, listar funções SECURITY DEFINER acessíveis por PUBLIC/anon e confirmar que somente os RPCs externos necessários estão liberados.

```sql
select
  n.nspname as schema_name,
  p.proname,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  has_function_privilege('public', p.oid, 'EXECUTE') as public_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
order by p.proname, arguments;
```

Qualquer SECURITY DEFINER com PUBLIC/anon EXECUTE deve ser tratado como achado de segurança até confirmar que é intencional. Não fazer revogação global sem validar a lista de RPCs consumidos pelo frontend.


## 9. Supabase Auth e advisors

Após aplicar as migrations de hardening em homologação, executar novamente os Security Advisors do Supabase.

Bloqueadores adicionais de produção:

- nenhum helper do schema public pode permanecer com `search_path` mutável sem justificativa;
- funções de trigger `SECURITY DEFINER` não devem ser executáveis diretamente por `anon` ou `authenticated`;
- revisar individualmente as RPCs `SECURITY DEFINER` expostas a `authenticated` e manter apenas as que fazem parte da API intencional do ERP;
- habilitar **Leaked Password Protection** no Supabase Auth antes da liberação de produção.

O último diagnóstico independente do projeto CaparaoSystem ainda apontava o aviso `auth_leaked_password_protection`. Esse item é uma configuração do Auth e não é corrigido por migration SQL do schema.
