# Responsáveis, avisos e manutenção — fase343 / 1.42.0

## Navegação e apresentação

O layout do ERP observava o pathname durante transições e podia considerar uma rota autônoma como `/assinatura` um módulo não autorizado, redirecionando ao dashboard. O guard agora distingue rotas externas ao ERP antes dessa análise. Os guards próprios do Painel SaaS e da autenticação permanecem; módulos ERP não permitidos continuam recusados.

Responsáveis e proprietário veem um banner destacado para vencimento próximo, tolerância ou bloqueio, com data e dias até o bloqueio. Ao entrar, um diálogo informa a pendência uma vez por sessão. Usa identificador da sessão de autenticação e UUID do usuário como chave de exibição, sem armazenar o token ou dados financeiros. Não aparece durante recuperação de senha. O banner continua disponível depois de fechar o diálogo.

O servidor calcula o primeiro dia de bloqueio como o menor vencimento não pago mais a tolerância mais um dia, no calendário de São Paulo. No último dia de tolerância, falta um dia; no primeiro dia bloqueado, retorna zero. Pagamentos/cancelamentos removem a pendência conforme as regras existentes. Controle desativado não apresenta contagem de bloqueio.

## Responsáveis e privacidade

O contrato aceita de 1 a 20 administradores ativos, escolhidos pelo proprietário. O `master_id` anterior permanece como primeiro responsável e contratos ainda não editados preservam a seleção anterior. Formulários antigos não apagam uma lista múltipla existente. Usuários repetidos, inativos, representantes sem admin e outros perfis não são aceitos para essa autorização. Responsável que perde o papel admin deixa de consultar as faturas; a seleção permite remover contas que ficaram indisponíveis.

Responsáveis somente leem faturas e recebem avisos. Confirmação de pagamento e configuração continuam exclusivas do proprietário, sem atribuição de papéis ERP. Kennedy, com admin e representante, mantém a autorização administrativa do contrato.

Usuários sem autorização financeira veem `Sistema em Manutenção` durante o bloqueio. A API omite vencimento, prazo, contrato e parcelas e usa a mensagem neutra na proteção dos demais endpoints. A interface não consulta o painel financeiro nesse caso. Responsáveis/proprietário mantêm acesso à regularização. O bloqueio do ERP continua no servidor e é retirado pelas regras de pagamento existentes.

## Validação

- `check-responsaveis-saas-343.cjs`: banco isolado com dois responsáveis, readonly sem confirmar pagamentos, usuário admin+representante, limites/rejeições, formulário antigo, remoção de papel, fronteira exata de tolerância, privacidade de status/painel/API, pagamento liberando acesso e reexecução da migração.
- Regressões335/341/342 passaram para faturas, reajuste por salário mínimo, carência e uso pré-pago.
- Suíte geral: 326 testes, 0 falhas, 2031 verificações. Typecheck, build, segurança SQL e ordem de migrações passaram. Lint sem erros; avisos de Fast Refresh já existentes no provedor.
- Chromium com roteador real e dados simulados: aviso inicial, prazo de um dia, link abrindo as faturas, retorno ao ERP sem repetir aviso, recusa de módulo não permitido, seleção múltipla no payload, manutenção sem texto financeiro nem consulta de faturas e layout desktop/celular.

A fase343 foi aplicada em 06/11/2026. Comparações antes/depois confirmaram contrato, grade, eventos financeiros, papéis ERP e proprietário preservados. O acesso de Kennedy foi conferido pela função de autorização com contexto de sessão temporário. Resultado em `auditorias/saas-responsaveis-avisos-343.json`. Não foi criado nem modificado contrato real para testar; outros responsáveis devem ser escolhidos e salvos pelo proprietário na configuração.
