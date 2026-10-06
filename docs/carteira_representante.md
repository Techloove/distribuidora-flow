# Carteira dos representantes

Aplicar o conteúdo de `db/fase206_carteira_representante.sql` no SQL Editor do Supabase, depois da fase205. O código publicado no GitHub não executa essa migração automaticamente.

A carteira usa `clientes.representante_id` e `pessoas.representante_id`, associados ao login por `representantes.profile_id`. O administrador mantém esse vínculo em **Usuários e papéis**. Um representante sem vínculo não recebe clientes; clientes sem representante não pertencem a nenhuma carteira.

Representantes, inclusive quando também possuem o papel gestor ou financeiro, ficam restritos à carteira. O papel admin dispensa essa restrição. As permissões de módulo, financeiro e centro existentes continuam necessárias para abrir as respectivas áreas. Usuários que não possuem o papel representante mantêm as regras atuais.

A fase206 acrescenta políticas RLS restritivas aos clientes, cadastro unificado, representantes e tabelas com referências a cliente, pedido, representante ou conta a receber. Os detalhes de devoluções, preços, pagamentos de comissão, créditos e boletos herdam a visibilidade do documento pai. Views públicas usam `security_invoker`; consultas por documento respeitam RLS. Funções PL/pgSQL SECURITY DEFINER executáveis por authenticated recebem verificações explícitas dos identificadores de clientes e documentos conhecidos, preservando suas assinaturas e controles existentes.

“Clientes sem comprar” também filtra a consulta pelo representante do login e não oferece o filtro de outros representantes. Seu cache inclui o usuário e o tipo de escopo.

Preços e regras de comissão gerais continuam compartilhados. Arquivos CNAB e auditoria, que podem conter diversas carteiras num único registro, não são expostos aos representantes. Cargas e ondas de separação só exibem o cabeçalho quando todos os pedidos são da carteira; detalhes individuais continuam sujeitos ao escopo de pedido.

Validação local:

```sh
NODE_PATH=/workspace/.onboarding-tools/node_modules node scripts/check-carteira-database.cjs
npm run typecheck
npm run build
```

O teste usa PostgreSQL local via PGlite com dois representantes, representante+gestor, representante sem vínculo e admin+representante. Confere consultas diretas, views, boletos, títulos manuais, detalhes, cargas mistas, preços compartilhados, alterações fora da carteira, consultas por documento e corpos reais das RPCs de pedidos da fase81. Confere também reaplicação da fase206.

Após aplicar em produção, validar com logins reais de dois representantes e um administrador. A validação local não confirma os vínculos nem a aplicação da migração no Supabase de produção. Futuras migrações que recriem RPCs ou novas tabelas com dados de clientes devem preservar estas verificações e suas políticas de carteira.
