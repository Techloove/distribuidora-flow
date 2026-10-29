# Pendências e filtros comerciais de clientes — 1.16.0

A Central de pendências acrescenta quatro categorias: sem loja, sem rota, sem representante e sem limite de crédito. Limite não informado ou zero é ausência de limite cadastrado; não se calcula o saldo disponível após compras. Os clientes continuam na categoria geral de cadastro incompleto quando também falta documento, endereço ou outro campo já acompanhado.

Cada categoria exibe o total autorizado e até 40 exemplos. Um cliente pode aparecer em mais de uma categoria. Revisar abre o cadastro; Ver clientes no Cadastro unificado abre a lista com o filtro inicial correspondente. A lista permite combinar as três condições e também consultar os casos com dados preenchidos. Pessoas sem a função Cliente não entram nesses filtros.

Os dados são lidos com a sessão/RLS atual e respeitam a loja selecionada. Cadastros globais continuam incluídos nas consultas da loja, conforme a regra existente. Não há novas permissões ou migração. Definir limite continua exclusivo do administrador; o representante não recebe escrita pelo novo atalho.

## Lojas

O cadastro distingue Sem loja (`loja_pendente=true`, sem centro específico), Uma loja (`loja_pendente=false`, centro definido) e Compartilhado (`loja_pendente=false`, centro vazio). O novo campo tem padrão falso, preservando os cadastros antigos como específicos ou compartilhados.

Em Dados gerais, o seletor permite escolher Sem loja, Compartilhado ou o nome de uma loja permitida. A lista e a Central distinguem o caso pendente. Um cliente Sem loja não inicia novos pedidos; entregas, cancelamentos e históricos de pedidos já avançados continuam possíveis. As regras de crédito e carteira permanecem intactas.

O filtro por nome da loja seleciona os vínculos específicos. Para comparar lojas, use Todas as lojas no seletor global. O compartilhamento corresponde a todas as lojas, atualmente duas; não cria vínculos na tabela legada `pessoa_centros`.

## Integridade e validação

As categorias que consultam cadastros compartilham a mesma leitura paginada de clientes a cada atualização. O Cadastro unificado também usa páginas ordenadas antes de filtrar; assim, o total não fica limitado à primeira resposta de mil registros do PostgREST. Salvar ou excluir uma pessoa invalida a lista, os clientes e as pendências pelo fluxo já existente.

Os testes exercitam valores ausentes/zero/positivos, limite consumido, pessoas sem função cliente, filtros comerciais e distinção de loja específica/compartilhada. Chromium com dados fictícios confirmou os contadores, atalho filtrado, combinação de filtros, Limpar, filtro por loja e exclusão de fornecedores. Uma base sintética de 1.005 clientes confirmou uma pendência na última página, tanto na Central quanto no Cadastro unificado. Nenhum cadastro real foi alterado nos testes.
