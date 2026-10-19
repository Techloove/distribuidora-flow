# Centros e comissão — confirmação administrativa (fase239)

Execute **todo** `db/fase239_configuracao_representantes_admin.sql` no SQL Editor do projeto correto, depois da fase238 já aplicada. Publique a atualização correspondente no Lovable. A migração é transacional e reaplicável; não é necessário repetir a fase238.

## Novas solicitações

Em Usuários e papéis, a autorização exige carteira, pelo menos um centro ativo e comissão padrão de 0 a 100%, com até duas casas decimais. A comissão começa em branco para que o administrador tome uma decisão. **0% é permitido, mas deve ser informado explicitamente.** A nova RPC239 mantém a confirmação de e-mail e todas as demais validações da aprovação221. Um gatilho impede aprovar pela RPC antiga se a comissão ainda não tiver confirmação administrativa. Uma falha reverte toda a operação, incluindo criação de representante, comissão e centros.

Depois, o representante continua obrigado a concluir seus dados pessoais no primeiro acesso, conforme a fase238. Ele não escolhe os próprios centros, percentual ou confirmação da comissão.

## Revisão dos representantes existentes

Em **Usuários e papéis → Centros de custo e comissão dos representantes**, revise os representantes ativos vinculados a um usuário. O filtro inicial mostra somente pendências. A lista completa fica disponível ao desmarcá-lo. O botão Definir configuração abre centros ativos e comissão, com confirmação explícita dos dois em uma transação administrativa auditada.

Os percentuais atuais são preservados. A migração não presume que um zero preexistente ou mesmo um percentual positivo foi confirmado deliberadamente: todos começam precisando dessa revisão. Não há desativação retroativa de usuários nem recálculo de comissões geradas. Clientes, carteira, pedidos e identificadores permanecem vinculados ao mesmo representante.

A **Central de Pendências**, somente para administradores, indica Definir centros de custo e/ou Definir e confirmar comissão e conduz a Usuários e papéis. Essas pendências administrativas são globais ao usuário e não desaparecem ao filtrar outro centro. Ter acesso geral a todos os centros, conforme configuração existente, conta como acesso definido se houver centros ativos; salvar nesta nova área passa a registrar explicitamente os centros selecionados.

Alterar o percentual em Cadastro Unificado ou no representante invalida a confirmação anterior, exigindo nova revisão administrativa. Alterar outros dados pessoais sem modificar o percentual mantém a confirmação. Se os centros de um usuário forem removidos ou desativados posteriormente e não restar centro acessível, a pendência reaparece. Novas solicitações públicas também aparecem nessa categoria da Central de Pendências e continuam aguardando aprovação na área de primeiros cadastros.

## Verificações

- `NODE_PATH=<instalação do PGlite>/node_modules node scripts/check-configuracao-representantes-database.cjs`: funções reais de aprovação221, complemento238 e espelhamento198; exclusividade administrativa, centros ativos obrigatórios, comissão explícita inclusive zero, antiga aprovação protegida, rollback, pendências, revisão após alteração, espelhamento e reexecução.
- Teste de navegador com dados simulados: pendência, revisão com campos obrigatórios, confirmação de 0%, nova aprovação com comissão e resolução na central; tela móvel sem transbordamento.
- Testes do aplicativo, tipos, lint, compilação e verificações de segurança SQL/servidor/interface.

Essas verificações são locais. A fase239 deve ser aplicada no Supabase para ativar os controles.
