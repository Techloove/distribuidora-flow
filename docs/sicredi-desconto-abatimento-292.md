# Desconto e abatimento do boleto Sicredi — fase292

Fonte: **Manual API da Cobrança Sicredi 4.0, 24/06/2026**, arquivo “Sem título (1).pdf” reenviado pelo usuário. §§7.6 (p.71–79), 7.7 (p.80–87), 7.10 (p.103–109), 7.11 (p.110–114); consulta nas páginas151–161.

## Operações documentadas

| Ação | PATCH /cobranca/boleto/v1/boletos/{nossoNumero}/ | Corpo |
|---|---|---|
| Conceder abatimento | conceder-abatimento | `{ "valorAbatimento": "12.34" }` |
| Cancelar abatimento | cancelar-abatimento | `{}` |
| Alterar desconto cadastrado | desconto | `{ "valorDesconto1": 12.34 }` (também2/3) |
| Alterar prazo de desconto | data-desconto | `{ "data1": "YYYY-MM-DD" }` (também2/3) |

Cabeçalhos: x-api-key, Authorization Bearer, Content-Type application/json, cooperativa, posto e codigoBeneficiario. Sandbox usa /sb e convênio de teste existente. O manual informa HTTP202 como recebimento do comando, não confirmação de execução.

**O manual não documenta alteração direta do valor nominal nem mudança do tipo do desconto após emissão.** Para reduzir o valor a pagar de boleto sem desconto, usa-se abatimento. Para aumentar o principal, regularizar o boleto anterior e gerar nova cobrança pelo fluxo existente; esta entrega não automatiza cancelamento/reemissão. O endpoint de desconto só altera um desconto já retornado pela consulta, mantendo VALOR/PERCENTUAL e sua data. A mudança de data é uma solicitação independente. Não inventa novos níveis de desconto quando não existem no banco. Desconto por antecipação é uma modalidade diferente e não é alterada aqui.

## Fluxo no aplicativo

Em Boletos → Opções → **Desconto e abatimento**, ou Contas a receber → Opções, um administrador ativo consulta o boleto no banco, escolhe a operação, informa motivo de10 a2000 caracteres e confirma. Descontos podem ser valor fixo ou percentual conforme o tipo bancário atual. A alteração de data respeita hoje/vencimento e datas distintas entre descontos.

Só opera boleto API Sicredi normal, registrado no ERP, em carteira ou vencido no banco, sem recebimentos parciais ou divergência de saldo/convênio/identificação. Protesto, cartório, negativação, híbrido/Pix, baixa, liquidação e estados desconhecidos não são elegíveis. A confirmação usa nosso número e linha digitável, não apenas o ID local.

Há reserva no banco antes do PATCH, UUID de idempotência, uma solicitação pendente por boleto, auditoria com ator/motivo e snapshots antes/depois. O histórico exibe as30 solicitações mais recentes. RLS restringe a leitura a administrador ativo com acesso ao centro; gravações e confirmações são exclusivas do servidor. Vencimento/baixa verificam a reserva pendente, e a nova reserva verifica pendência de vencimento/baixa conhecida. Alterações feitas por outro canal bancário ainda exigem conferência; o ERP não controla o Internet Banking.

HTTP400/401/403/404/422 encerra como rejeitado. Timeout, HTTP408/429/5xx e resposta inesperada ficam incertos, sem reenvio automático. Falha após envio mantém a reserva. **Conferir no Sicredi** só confirma quando valor nominal, vencimento, abatimento, tipo e todos os descontos/datas correspondem ao snapshot esperado. Se o banco ainda mostrar a condição anterior, permanece pendente. Recusa assíncrona sem evidência de execução exige conciliação técnica com o banco, sem botão para forçar sucesso ou repetir comando incerto. Baixa/liquidação observada encerra a solicitação sem afirmar execução; a consulta financeira existente concilia a situação separadamente.

## Financeiro

Não altera valor nominal do boleto/título nem simula recebimento ao conceder abatimento/desconto. Exibe valor após abatimento, antes de descontos/encargos. A baixa existente `sicredi_liquidar_api_224` confere `nominal + juros + multa - desconto - abatimento = valor recebido` e contabiliza a redução uma única vez no recebimento real. Assim evita descontar novamente um abatimento já aplicado no banco. Até a liquidação, o contas a receber e a exposição de crédito mantêm o saldo nominal; não antecipa quitação nem redução contábil por uma solicitação. Não recalcula preço da venda, estoque ou comissão ao conceder uma condição bancária.

## Implantação e verificação

Aplicar `db/fase292_sicredi_desconto_abatimento.sql`, transacional e repetível; instalação não envia comandos ao Sicredi e não altera negócios anteriores. Publicar a versão compatível.

Testes descartáveis de SQL: administrador/ativo/centro, RLS/grants, idempotência, reserva única, bloqueio de instruções concorrentes, confirmação divergente/terminal, preservação nominal e reaplicação. Testes de API com fetch simulado conferem endpoints, formato/cabeçalhos, reserva antes do envio, recusa/timeout/429/5xx/persistência e consulta sem mutação bancária. Interface validada em navegador local com banco fictício. Não houve envio de comando sobre boleto real; homologação junto ao Sicredi depende de credenciais e retorno do convênio.

## Correção de leitura — fase293 / versão1.19.4

A política inicial do histórico chamava `ator_financeiro_pode_acessar_centro`, helper exclusivo do servidor. A consulta REST com JWT do administrador falhava com42501 mesmo com SELECT permitido, antes de liberar o formulário. O erro era apresentado genericamente como “Não foi possível validar o título no ERP”.

A fase293 substitui essa expressão por `usuario_ativo()`, `has_role(auth.uid(),'admin')` e `usuario_pode_acessar_centro(centro_id)`, helpers já autorizados para políticas de sessão. Mantém RLS, administrador ativo, escopo existente e proibição de gravação pelo navegador. Não concede EXECUTE ao helper privado. Não altera valores, boletos ou solicitações.

A regressão reproduz a ACL privada real antes da correção e testa leitura depois, repetição da migração, usuário inativo/não administrador, centros, idempotência e permissões de gravação. A leitura com papel authenticated e contexto do administrador também foi conferida no Supabase, sem enviar instrução bancária. Após a correção, reabra Desconto e abatimento ou use Tentar novamente.
