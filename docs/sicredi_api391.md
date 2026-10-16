> Atualização: a fase237 move a configuração para Centros de custo, restringe novas emissões Sicredi à API e considera o manual4.0 (24/06/2026). Veja [cobrança por centro](cobranca_por_centro237.md). Este documento mantém a referência histórica da fase224.

# Implantação da API de cobrança Sicredi 3.9.1 — fase224

Esta atualização implementa as correções identificadas no manual fornecido (capa 3.9.1, rodapés 3.9 de 11/11/2025). Mantém o cadastro central de convênio e os sequenciais CNAB compartilhados pelos centros. A publicação no GitHub não executa SQL no Supabase nem libera o contrato bancário.

## Implantar

1. Se ainda não executou a fase223, aplique `db/fase223_sicredi_convenio_unificado.sql` após as fases anteriores, incluindo 222.
2. Execute **o arquivo inteiro** `db/fase224_sicredi_api_manual391.sql` no SQL Editor do Supabase. Ele é transacional e pode ser reaplicado. Não desative RLS. O script cria o cache privado de tokens, protege as RPCs e atualiza os fluxos financeiros; não reinicia sequências de boletos/remessas.
3. Abra **Configurações > Cobrança Sicredi** como administrador. Os campos de cooperativa, posto e beneficiário continuam sendo os do convênio real compartilhado com CNAB. Informe a chave específica de sandbox, selecione **Homologação (sandbox)** e salve. A chave antiga é preservada; se a configuração estava em homologação, a migração também a aproveita inicialmente no campo sandbox. Isso não certifica que uma chave antiga é válida nos dois ambientes: o Sicredi fornece chaves distintas.
4. Use um cliente e um título de teste. Confira nome e CPF/CNPJ; endereço, cidade, UF e CEP devem estar completos quando exigidos pelo cadastro bancário. Campos opcionais ausentes são omitidos, sem endereço fictício; CEP informado inválido é bloqueado. Configure boleto normal. Emita pela API e confira o PDF pela linha digitável.
5. Depois dos testes e da liberação bancária, informe a chave de produção e o código de acesso gerado no Internet Banking. O usuário é o beneficiário de 5 dígitos seguido da cooperativa de 4 dígitos. Selecione **Produção** e salve. Uma emissão inconclusiva não pode migrar de ambiente/convênio. Se usou o mesmo título em testes, conclua a baixa do ciclo de teste no sandbox antes de emitir um novo ciclo em produção; prefira títulos exclusivos para os testes.
6. Para recebimentos reais, defina o banco/caixa previsto no título. Se ele estiver vazio, a conciliação pode usar a conta financeira compartilhada do convênio CNAB, caso já configurada. Sem conta definida, a baixa é bloqueada para evitar lançar o recebimento em uma conta arbitrária.

## Comportamento corrigido

- **Sandbox isolado:** usa automaticamente cooperativa 6789, posto 03, beneficiário 12345, usuário 123456789 e senha pública de exemplo do manual. Apenas a chave sandbox é informada pelo administrador. Esses dados não alteram o convênio real nem a sequência CNAB. Liquidação simulada não gera movimento financeiro.
- **PDF:** GET `/cobranca/boleto/v1/boletos/pdf` envia a linha digitável de 47 dígitos armazenada. O retorno é binário, convertido em base64 somente para o navegador abrir o documento.
- **Tokens:** ficam na tabela privada `sicredi_tokens_224`, sem acesso de anon/authenticated. Uma chave SHA-256 isola ambiente, convênio e credenciais. As instâncias do servidor reutilizam tokens válidos; uma reserva no banco evita autenticação simultânea; a renovação usa refresh_token. Renovação recusada por 400/401 permite uma autenticação por usuário/senha; timeout/5xx não dispara essa repetição. Campos secretos vazios no formulário mantêm os valores existentes.
- **Liquidação:** consulta de produção usa v2 e `data-movimento=true`. A baixa utiliza valor, juros, multa, desconto e abatimento de dadosLiquidacao, e a data bancária. Sem data/valor válido, pagamento parcial, saldo alterado ou conta inadequada, a transação é bloqueada para conciliação. Exemplo: título de R$ 100, juros de R$ 5 e multa de R$ 2 gera título pago de R$ 107 e uma entrada de R$ 107; título de R$ 100 com desconto de R$ 3 e abatimento de R$ 2 gera título pago de R$ 95. Repetir a mesma consulta não repete encargos nem recebimento; dados divergentes são rejeitados.
- **Registro inconclusivo:** o estado de envio é gravado antes do POST, inclusive nas tentativas após rejeição; falha nessa gravação impede o envio externo. Timeout, HTTP5xx, resposta incompleta ou falha após aceitação deixam a reserva protegida. Reservas legadas sem contador de tentativas também passam pela conferência bancária. Nas novas tentativas inconclusivas de produção, o ERP consulta `/cobranca/boleto/v1/boletos/cadastrados` por seuNumero antes de enviar. Um registro único com valor/pagador/identificador correspondentes é recuperado sem novo POST. HTTP 404 documentado permite o reenvio com o mesmo identificador; resultado múltiplo, divergente ou indisponível bloqueia o envio. Rejeições definitivas 400/401/403/422 permitem corrigir os dados.
- **Integridade:** o ambiente e os identificadores bancários são associados à reserva antes do envio. Se o título mudar durante a chamada, o ERP não registra o novo saldo como se fosse o valor aceito pelo banco. A identificação real fica protegida pelo histórico; títulos do sandbox não substituem os identificadores reais.

A consulta de cadastrados do manual não documenta campo nossoNumero. Se o banco devolver apenas linha digitável/código de barras, o registro é recuperado e pode ser impresso; o ERP não inventa o nosso número. Use **Confirmar nosso número** na tela de Boletos, informe os 9 dígitos disponíveis no PDF ou no Sicredi e selecione **Conferir e salvar**. O sistema consulta o banco e exige que a linha digitável corresponda ao título antes de associar o número. Isso libera consulta, baixa e alteração sem criar outro boleto. O endpoint de cadastrados não está documentado para sandbox: novas tentativas de testes inconclusivos ficam bloqueadas para conferência com o banco. A reserva existente mantém a espera de 10 minutos antes de voltar à seleção para nova tentativa.

Esta entrega não ativa boleto híbrido, webhooks, emissão fiscal ou APIs gerais de Pix/extrato. Consulta de boleto, impressão, baixa e vencimento exigem selecionar o mesmo ambiente/convênio em que o título foi emitido. Valores de juros/desconto usam até duas casas decimais, conforme o manual.

## Evidências locais

- Testes de contrato com respostas simuladas: PDF, produção/sandbox, encargos reais, dados incompletos, recuperação sem reenvio,404, resultados múltiplos/divergentes, timeout/5xx, rejeição422, mudança de configuração e falha após aceitação.
- Testes de token: reutilização, renovação, renovação recusada, isolamento por credenciais/ambiente, prazo inválido e chamadas concorrentes.
- PostgreSQL isolado com PGlite: migração reaplicável, preservação de credenciais, separação do sandbox, fluxo real de receber_titulo da fase71, idempotência/rollback de encargos, restrições de centro/usuário e tokens privados com reserva/expiração/renovação. Funções de reserva/registro da fases 131/129 são usadas sob os novos wrappers.

```sh
bun test
bun run typecheck
bun run lint
bun run build
bun run check:sql
bun run check:migrations
bun run check:surface
bun run check:server
NODE_PATH=/caminho/das/dependencias node scripts/check-sicredi-api-database.cjs
```

Os testes locais não comprovam liberação de credenciais, execução da migração no Supabase de produção ou homologação bancária; nenhum boleto real foi emitido pelo agente.

Resultado desta entrega: **86 testes passaram**, assim como typecheck, build e os quatro checks de segurança/migrações. Lint sem erros, com 9 avisos anteriores de Fast Refresh. Chromium verificou o formulário único, chaves separadas sem retorno de segredos, sequenciais preservados, leitura de gestor e confirmação do nosso número com banco simulado, liberando as ações do boleto. O teste PostgreSQL isolado também passou. Esses resultados são locais; a aplicação do SQL e a homologação no Sicredi continuam sendo etapas de implantação.
