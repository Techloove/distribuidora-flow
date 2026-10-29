# Revisão de apresentação no celular

A revisão cobre os componentes compartilhados e as 53 entradas em `src/routes/_app`, incluindo os redirecionamentos antigos. O objetivo é ler dados e operar os controles sem alargar a página, sobrepor rótulos ou esconder ações.

## Ajustes

- Barras de ações de pedidos e cadastros quebram em linhas; botões longos podem quebrar o texto e manter altura para toque.
- Filtros podem ser abertos e recolhidos no telefone, sem apagar valores. A partir de 640 px continuam visíveis.
- Listas de boletos, cargas, separação, notas, contas, comissões, relatórios e consultas de apoio usam cartões com rótulos no telefone. Datas, nomes e avisos ficam em linhas próprias. As tabelas de cadastros e títulos também recebem a correção compartilhada.
- A DRE mantém as colunas e oferece rolagem dentro da tabela. Isso preserva a comparação entre descrição, valor e percentual.
- Janelas têm margem lateral, limite de altura e rolagem; títulos têm espaço para o botão Fechar. Botões de confirmação ficam acessíveis na janela.
- Campos têm tamanho de fonte adequado para reduzir zoom automático no iPhone; campos e popovers respeitam a largura disponível.
- O resumo do pedido deixa de ficar fixo no telefone, para não cobrir os itens. O formulário de inclusão de produto se distribui em duas colunas no tablet antes do formato completo de desktop.
- O menu móvel tem área de toque maior, botão Fechar maior e altura baseada na área visível.

## Validação reproduzível

O teste de navegador usa **somente fixtures**, com nomes extensos, valores altos e avisos. As requisições externas são bloqueadas; o Supabase fictício é respondido pelo Playwright. Não há autenticação real, cancelamento, alteração financeira ou operação bancária.

Instale Playwright fora do repositório e use Chromium disponível na máquina:

```bash
npm install --prefix /tmp/caparao-browser --cache /tmp/caparao-npm-cache --no-package-lock playwright
EXT_SUPABASE_URL=https://mobile-fixture.supabase.co EXT_SUPABASE_ANON_KEY=public-fixture npm run dev -- --host 127.0.0.1 --port 5174
```

Em outro terminal:

```bash
NODE_PATH=/tmp/caparao-browser/node_modules MOBILE_WIDTH=320 node scripts/check-mobile-layout.cjs
NODE_PATH=/tmp/caparao-browser/node_modules MOBILE_WIDTH=768 node scripts/check-mobile-layout.cjs
NODE_PATH=/tmp/caparao-browser/node_modules MOBILE_WIDTH=1280 node scripts/check-mobile-layout.cjs
```

`CHROMIUM_PATH` permite selecionar outro executável; `MOBILE_BASE_URL` deve apontar para o servidor local iniciado **com a configuração fictícia**. `MOBILE_OUTPUT_DIR` escolhe a pasta dos resultados e capturas, por padrão `/tmp/caparao-mobile-layout`. O teste reprova alargamento da página, controles que saem da área útil e páginas que exibem a tela de erro. A rolagem interna de tabelas é permitida.

Resultado: 53 entradas em cada largura (320, 768 e 1280 px), sem alargamento da página, controles saindo da área útil ou tela de erro. Foram inspecionados 17 estados de telas/janelas em 320 px, sem botões cortados e com as janelas dentro da área visível.

O painel, pedidos, cadastro e agenda do representante também passaram em 390 px com a fixture de perfil restrito (`MOBILE_ROLE=representante`).

Além da navegação, foram conferidos o pedido aberto, filtros (inclusive preservação de valor ao recolher), menu, impressão, edição de cliente/produto e confirmação da baixa de boleto. A confirmação bancária não foi acionada.

## Limites

É uma inspeção de layout no Chromium com emulação de largura e toque. Alguns módulos usam listas vazias nas fixtures; os fluxos principais usam exemplos preenchidos. Não equivale a homologar todas as combinações de dados, permissões e estados, nem substitui testar teclado virtual, compartilhamento e impressão em iPhone/Android físicos. Regras de acesso, estoque, financeiro e banco não foram alteradas nesta entrega.
