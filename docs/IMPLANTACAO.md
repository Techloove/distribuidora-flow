# Homologação e implantação

Esta proposta está preparada para revisão. As migrations não foram executadas no Supabase real e não houve publicação no Lovable/produção.

1. Obter o schema atual do Supabase e reconciliar as fases ausentes. Confirmar `profiles`, `user_roles`, `centros`, `usuario_centros`, `pessoas`, `pedidos`, `produtos`, `clientes`, `contas_receber`, `contas_pagar`, `comissoes`, `boletos` e respectivos helpers. A aplicação já existente depende de outras estruturas descritas na auditoria.
2. Restaurar uma cópia isolada para homologação. Preservar um administrador ativo existente. Se o projeto for novo, o primeiro administrador precisa ser provisionado pelo operador; novos cadastros não recebem privilégios automaticamente.
3. Fazer backup verificável e testar a restauração. Aplicar `db/fase79_seguranca_acesso.sql`, `db/fase80_dashboard_resumo.sql` e `db/fase81_liquidacao_boleto.sql`, nessa ordem, com o operador do banco. Não executar scripts de limpeza ou promoção de administradores sem revisar os parâmetros.
4. Revisar `todos_centros` já atribuídos: valores existentes são preservados. Usuários restritos precisam de atribuições em `usuario_centros`. Novos perfis têm `todos_centros = false`.
5. Validar login de administrador, financeiro, estoque e dois representantes; usuário sem papel/inativo; edição própria; centro negado; carteira de outro representante; menus vazios; troca de usuário; token expirado. As policies restritivas podem revelar operações antigas que dependiam de permissões amplas.
6. Configurar variáveis de servidor a partir de `.env.example`. A chave pública anon é usada com JWT/RLS; service role deve ficar exclusivamente no servidor. Manter Sicredi em homologação e tratar as pendências bancárias da auditoria antes de qualquer uso real.
7. Usar Node 24 e `npm ci`, depois `npm run check`. O `package-lock.json` é o lock usado no CI. O `bun.lock` histórico permanece para compatibilidade com o projeto Lovable; ao usar Bun, sincronize o lock a partir do `package.json` e repita os checks.
8. Publicar a aplicação somente depois das migrations: o dashboard agora depende de `dashboard_resumo`. O ambiente Lovable deve receber as mudanças pelo fluxo normal de revisão/merge da branch conectada, sem reescrever histórico.

## Critérios de aceite

- Indicadores reconciliados com consultas SQL e filtro de centro, incluindo mais de 1.000 pedidos.
- Acesso direto à API nega usuário anônimo/inativo e operações bancárias a papéis não financeiros.
- Consultar duas vezes o mesmo boleto liquidado não altera novamente `valor_pago`.
- Fluxos de pedido, saldo de estoque, comissões, devoluções e financeiro conferidos no banco real.
- Emissão bancária com reserva/idempotência e conciliação implementadas antes de produção; não repetir automaticamente emissão com resultado desconhecido.
- Tenant/empresa isolado integralmente ou uma base/projeto separado por distribuidora.

## Reversão

Reverter o frontend não deve remover as proteções de acesso. As migrations são transacionais e podem ser reaplicadas, mas não há downgrade automático que reabra permissões. Em falha de homologação, identificar a função/policy incompatível usando o schema salvo e preparar ajuste específico; em incidente de dados, usar o backup cuja restauração foi validada. Não desabilitar RLS como solução.
