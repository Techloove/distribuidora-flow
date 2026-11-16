# Revisão de estabilidade, buscas e uso por toque — 16/11/2026

Entrega: versão 1.56.6.

## Escopo e alterações

- Revisão de tipos, lint, testes unitários, regras de negócio em PGlite descartável, controles estáticos de acesso/SQL e navegação em celular/tablet com dados fictícios.
- Busca compartilhada de seleções e cadastros prepara e reaproveita o texto conforme necessário. A abertura da tela e a busca vazia dispensam essa preparação. Acentos, palavras em outra ordem, códigos, documentos pontuados e ordem das opções são preservados.
- Clientes e parceiros em Boletos/Contas a receber/Contas a pagar são localizados por índices locais por leitura, preservando a primeira ocorrência e o tipo das chaves. O acompanhamento de pedidos agrupa títulos e boletos uma vez por atualização.
- Seleção e impressão de ciclos de boletos passam a percorrer os dados uma vez, preservando prioridade dos ciclos ativos, datas e desempate por ID. Não altera a emissão nem a situação bancária.
- Botões, menus e seleções usados por toque têm áreas mínimas de 44 px, inclusive em tablets. Campos de edição usam texto de 16 px. Regras de tela por mouse e impressão continuam fora desse ajuste de toque.
- O teste visual exige uma tela autenticada do ERP, aguarda o título e usa os contratos atuais de mensalidade e dashboard. Isso evita aprovar uma tela de erro de acesso como se fosse a tela operacional.
- A validação de certificado descartável verifica senha correta/incorreta por um arquivo produzido pelo subprocesso Node. O executor local perdia a saída padrão de subprocessos; a validação TLS do sistema não foi modificada.

## Medições reproduzíveis

Executar `bun scripts/benchmark-estabilidade.ts`. Os dados são sintéticos; os tempos medem CPU local, incluindo a construção dos índices. Os resultados das duas implementações são comparados antes de aceitar a medição.

| Cenário                                  |       Antes |    Depois | Resultado                        |
| ---------------------------------------- | ----------: | --------: | -------------------------------- |
| 10 buscas em 12 mil opções               | 1.815,36 ms | 109,09 ms | 84.438 correspondências em ambos |
| Nomes de 12 mil títulos / 6 mil clientes |   299,67 ms |  15,58 ms | Mesma soma de verificação        |
| Ciclos em 6 mil boletos                  |   270,97 ms |   2,95 ms | 2 mil ciclos em ambos            |

Essas medições representam operações locais específicas. Latência de rede, consultas do banco real e tempos gerais de carregamento exigem medição em produção.

## Verificações

- 437 testes unitários aprovados; 86 arquivos de testes, incluindo comparações com os algoritmos anteriores para busca e seleção de ciclos.
- 91 suítes de negócio verificadas em bancos locais descartáveis. A primeira rodada conjunta aprovou 90; a suíte `check-sicredi-prioridade-345.cjs` passou na reexecução isolada. Ela cobre prioridade, limites, acesso por loja e concorrência da consulta automática.
- Controles estáticos: 11 módulos sensíveis do servidor; superfície cliente, permissões e consultas protegidas; 323 migrações SQL; ordenação determinística dos arquivos de fase.
- Inspeção de 338 arquivos de código em `src` sem arquivos de conteúdo integral idêntico, excluindo a árvore de rotas gerada. Repetições de processamento relevantes foram substituídas por índices locais.
- 53 rotas conferidas em cada largura: 390, 768 e 1.024 px, totalizando 159 aberturas com sessões e dados fictícios. Sem falhas de layout, erros JavaScript ou estouro horizontal nas três rodadas finais. A lista inclui atalhos e redirecionamentos.
- No tablet por toque, campos e opções de menus medidos em 44 px, com texto dos campos em 16 px.
- Compilação, tipos, lint e relatório visual final conferidos antes da publicação. Avisos preexistentes de Fast Refresh e de APIs obsoletas do framework foram preservados; não são falhas de execução encontradas nesta revisão.

## Limites e continuidade

A navegação visual usa dados e sessões fictícios, com requisições externas bloqueadas. Sua cobertura inclui abertura, erros JavaScript e estouro horizontal de rotas, além de inspeção de filtros e áreas de toque. A revisão de registros duplicados na base de produção não foi executada diretamente nesta sessão. Não houve alteração de dados financeiros, cobranças, agendamentos ou permissões de produção. A entrega não requer SQL.
