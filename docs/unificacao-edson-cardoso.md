# Unificação pontual de Edson Cardoso / Édson Luiz Cardoso

Executar **todo** `db/unificar_representantes_edson_cardoso.sql` no SQL Editor do projeto CaparaoSystem como administrador. Não é migração estrutural nem cria uma função pública. O código não foi executado no banco real pelo agente, pois não há conexão administrativa disponível no ambiente.

O cadastro de nome completo é mantido como principal. A identificação exige exatamente um registro para cada nome, ignorando acentos, caixa e espaços repetidos. A operação é transacional, com bloqueios curtos e sem desativar RLS ou triggers:

- transfere todas as referências declaradas por FK para o representante principal, incluindo clientes e seus cadastros unificados, pedidos, comissões, pagamentos, metas e rotas;
- conserva os valores, status e identificadores dos registros transferidos, com verificação após os gatilhos; não recalcula nem paga comissões;
- reúne rotas repetidas no mesmo vínculo e arquiva os registros anteriores em auditoria;
- mantém o login vinculado ao principal, sem excluir ou criar usuário de autenticação;
- marca o representante antigo como inativo e retira a função Representante da pessoa antiga, preservando outras funções e seus registros;
- grava em auditoria os dois representantes, pessoas e vínculos anteriores.

Se houver dois logins diferentes, metas coincidentes por competência, regras ativas nos dois cadastros, nomes ambíguos ou um gatilho rejeitar/mudar dados além do vínculo, a transação falha e deve ser revertida integralmente. Não remover os bloqueios para forçar o resultado: conferir a mensagem antes de prosseguir. Orçamentos protegidos e outras restrições instaladas continuam sujeitos aos gatilhos existentes. Se a sessão ficar em transação abortada após algum erro, executar `ROLLBACK;` antes de tentar novamente.

Ao concluir, a consulta final mostra os dois IDs, estado ativo, login e número de clientes: o principal deve reunir a carteira e o antigo ter zero clientes. Atualizar o Lovable e recarregar a tela após publicar o ajuste que remove inativos das opções de vínculo em Usuários e papéis. A reexecução não duplica os vínculos nem valores; a auditoria registra cada execução concluída.

Validação: `NODE_PATH=<dependências de validação> node scripts/check-unificacao-edson.cjs` executa o SQL real em PostgreSQL/PGlite, com schema/identidade de teste e sem banco externo. Exercita transferência, rotas repetidas, preservação de comissões pagas, login e reexecução, além de rollback por login conflitante, metas sobrepostas, nomes duplicados e gatilho que altera valor. O teste não reproduz todos os gatilhos do ERP; o script verifica os resultados e conserva esses bloqueios no banco real.

## Execução sem tabela temporária

O arquivo atualizado mantém os snapshots de conferência em uma variável JSONB local ao bloco DO, sem depender de tabela temporária ou comando preparatório em outra sessão. O teste também executa o bloco isoladamente. Use sempre o arquivo completo atualizado para obter a consulta final e os limites locais de execução.

## Principal sem Pessoa vinculada

Se a consulta do principal retornar `NULL` nos campos de Pessoas, executar **todo** `db/vincular_edson_cadastro_unificado.sql`. A correção é específica para o ID principal confirmado na consulta real. Reaproveita pessoa existente por login/nome completo quando identificada sem ambiguidade; cria uma Pessoa apenas quando nenhuma existe. Na criação, a função Representante só é ativada depois de vincular o representante existente, para não acionar a criação de outro representante pelo gatilho. Marca Representante e Usuário do sistema, preserva o perfil e os atributos do representante. Não cria usuário de autenticação, não altera papéis de acesso nem transfere novamente a carteira.

Validação adicional: `scripts/check-vinculo-edson-pessoa.cjs` executa o SQL em PGlite com gatilho de sincronização de representante simulado; verifica um único representante/Pessoa, ambas as funções, login e 12 clientes/comissão preservados e reexecução. A execução no Supabase real continua sendo necessária.
