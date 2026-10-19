# Cadastros incompletos na Central de pendências

A categoria **Clientes com cadastro incompleto**, também exibida no painel resumido, informa por cliente quais campos estão ausentes: CNPJ/CPF, inscrição estadual quando aplicável, rota, representante e endereço (logradouro, número, bairro, cidade, UF e CEP). Complemento não é obrigatório; `S/N` é aceito como número. Campos vazios ou contendo apenas espaços são considerados ausentes. A verificação indica ausência, sem substituir validação fiscal ou consulta cadastral.

Pessoas físicas e cadastros explicitamente isentos/não contribuintes não geram falsa pendência de IE. A situação fiscal do cadastro unificado tem preferência sobre a cópia do cliente quando o vínculo está disponível. O botão **Revisar** abre a pessoa vinculada, usando seu identificador e uma leitura autenticada do registro, mesmo que ele não esteja na primeira página da listagem. Sem vínculo, abre o módulo normalmente para revisão.

Contadores abrangem os clientes acessíveis pela sessão/RLS, com leitura paginada; a lista mantém até40 exemplos por categoria. O filtro de centro inclui cadastros compartilhados. Não há service role no navegador, concessão de acesso a outras carteiras ou alteração de políticas RLS. Sem permissão de gestão, a abertura direta do registro permanece somente para consulta, com gravação bloqueada. Salvar alterações em Pessoas invalida as pendências e os clientes; a Central também atualiza periodicamente.

Implantação: publicar a atualização do código no Lovable e recarregar a página. **Não exige migração SQL.**

Validação: testes automatizados de campos faltantes, CPF/CNPJ, IE isenta/não contribuinte e situação fiscal do cadastro unificado. Conferência no Chromium com respostas simuladas: cliente incompleto discriminado, clientes completos/isentos sem alerta, link para pessoa correta, correção da IE refletida e visualização móvel. Não altera cadastros do banco real durante a validação.
