# Painel SaaS da operação atual

**Situação:** versão 1.36.0 preparada e validada localmente, ainda não instalada nem publicada. A instalação no banco de produção aguarda autorização explícita após a revisão automática recusar o teste de DDL por risco de locks e alterações em políticas/funções/configuração do PostgREST. Nenhuma cobrança real foi criada e o ERP publicado permanece na versão anterior.

Escopo: um contrato para a operação existente, sem migração de cadastros, novas empresas ou alteração de domínios. A tabela `empresas` da instalação estava vazia; os clientes, lojas e perfis existentes não foram recategorizados.

A conta expressamente indicada, carlosantoniolucio@gmail.com, recebe somente a autorização de proprietária da plataforma, vinculada ao UUID existente. Isso não atribui admin ao ERP. O vínculo não pode ser criado por cadastro público, metadados do usuário, administrador da distribuidora ou REST direto. O master do contrato é um administrador ativo escolhido pelo proprietário.

`/plataforma` tem autenticação e autorização próprias, fora dos menus comerciais. `/assinatura` permanece acessível durante suspensão. O login oferece o acesso Administração da plataforma. O proprietário recebe os controles de contrato e confirmação manual; o master consulta valores e histórico. Outros usuários recebem apenas a orientação de procurar o master.

O contrato começa com controle desativado e sem valores inventados. O proprietário informa implantação, parcelas, primeiro vencimento, mensalidade, início, dia, tolerância, avisos e instruções. Salvar exige revisão explícita. A ativação pode bloquear imediatamente se forem cadastrados vencimentos já além da tolerância. Desativar o controle não apaga histórico.

A implantação é dividida em centavos, com ajuste na última parcela e calendário mensal ancorado no dia original. Mensalidades são calculadas por calendário até o próximo mês, com versões de preço/dia por competência; não dependem de cron ou do acesso do proprietário. O primeiro vencimento não antecede o início. Após ativação ou primeiro evento financeiro, termos iniciais são preservados; preços e dia só mudam em competência futura sem histórico financeiro que seria afetado.

O bloqueio ocorre quando `hoje de São Paulo > vencimento + tolerância`. O vencimento do próprio dia permanece pendente. A liberação exige que não reste dívida além da tolerância. Confirmações, cancelamentos e reaberturas exigem motivo, geram eventos com autor, data, valor e vencimento e são idempotentes por requisição. Não há baixa parcial, emissão de boleto/Pix, webhook, e-mail ou WhatsApp nesta entrega.

Defesas do servidor:

- `saas_pre_request_330` instalado em `authenticator.pgrst.db_pre_request`, com recarga da configuração do PostgREST. Ele bloqueia tabelas, views e RPCs operacionais via HTTP, inclusive funções definer legadas. Preserva somente os endpoints de assinatura, cujas autorizações são independentes; o proprietário também fica sem operar o ERP suspenso.
- `requireServerAuth` consulta `saas_acesso_330` antes de executar serviços externos e módulos financeiros. Falha da consulta impede a operação.
- Policies restritivas em tabelas públicas com RLS e `storage.objects` defendem leituras por Realtime/Storage. Perfis e papéis são preservados como metadados de autenticação; o hook continua bloqueando seu acesso REST operacional durante suspensão.
- Tabelas SaaS não possuem privilégios para anon/authenticated e só são alteradas por RPCs específicas. Histórico não é editado: estornos são novos eventos. A limpeza do ERP exclui as tabelas SaaS e há proteção contra TRUNCATE autenticado.
- Jobs confiáveis de serviço continuam operando; suspensão não deve interromper liquidações bancárias ou manutenção. Ela não revoga dados já baixados nem invalida antecipadamente URLs assinadas já emitidas, sujeitas à validade existente.

Instalação: testar fase330 em banco descartável, aplicar `db/fase330_painel_saas_cliente_atual.sql`, provisionar a conta com `db/vincular_proprietario_saas_330.sql` e publicar a interface. Nunca ativar um contrato fictício em produção. O hook recusa substituir outra configuração existente. Conferir previamente contagens/hashes das tabelas de negócio e, depois, o estado desativado e a preservação de papéis e registros.

Teste principal: `node scripts/check-saas-330.cjs`. O teste usa Postgres descartável, identidades fictícias e contexto de requisição simulado; não envia cobrança nem opera registros reais. Cobre permissões, calendário, centavos, bloqueio, idempotência, histórico, novos termos e preservação do ERP. A instalação não equivale a transformar toda a aplicação em um SaaS multiempresa: esse isolamento ainda precisará de projeto específico.

Validação local concluída: 302 testes unitários, 74/74 suítes de negócio em PGlite, build, typecheck, verificações de superfície do cliente/servidor, SQL, datas, manual e versão. A interface real foi exercitada com Supabase simulado em 1366 e 390 pixels, incluindo formulário de revisão, proprietário, master bloqueado e usuário sem acesso ao contrato; não houve rolagem horizontal da página nem controles de pagamento para não proprietários.

A conta proprietária está ativa e a rotina de limpeza possui o padrão necessário à adaptação, conforme preflight somente leitura. O cadastro de proprietário ainda será provisionado pelo SQL de instalação. O administrador da distribuidora não poderá desativar, excluir ou alterar o e-mail do perfil proprietário pelo ERP.
