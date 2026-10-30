-- Contratos reais das tabelas e visões, sem dados de produção.
create table centros("id" uuid primary key,"codigo" text,"nome" text,"cidade" text,"uf" text,"ativo" bool,"created_at" timestamptz,"updated_at" timestamptz,"razao_social" text,"nome_fantasia" text,"cnpj" text,"inscricao_estadual" text,"email" text,"telefone" text,"logradouro" text,"numero" text,"bairro" text,"cep" text,"logo_url" text,"comercial_por_loja_245" bool,"categoria_produtos_id" uuid);
create table clientes("id" uuid primary key,"codigo" text,"razao_social" text,"nome_fantasia" text,"tipo_pessoa" text,"cnpj_cpf" text,"inscricao_estadual" text,"email" text,"telefone" text,"logradouro" text,"numero" text,"complemento" text,"bairro" text,"cidade" text,"uf" text,"cep" text,"limite_credito" numeric,"condicao_pagamento" text,"tabela_preco" text,"representante_id" uuid,"status" text,"observacoes" text,"created_by" uuid,"created_at" timestamptz,"updated_at" timestamptz,"pessoa_id" uuid,"centro_id" uuid,"rota_id" uuid,"sequencia_entrega" int4,"situacao_cadastral" text,"data_abertura" date,"natureza_juridica" text,"porte" text,"cnae_principal" text,"cnae_secundarios" text,"data_nascimento" date,"cadastro_provedor" text,"cadastro_consultado_em" timestamptz,"cadastro_atualizado_em" timestamptz,"uf_inscricao_estadual" text,"situacao_inscricao_estadual" text,"indicador_contribuinte_icms" text,"data_ultima_consulta_ie" timestamptz,"ie_provedor" text,"codigo_ibge" text,"loja_pendente" bool);
create table contas_financeiras("id" uuid primary key,"codigo" text,"nome" text,"tipo" text,"banco" text,"agencia" text,"conta" text,"saldo_inicial" numeric,"data_saldo_inicial" date,"centro_id" uuid,"observacoes" text,"ativo" bool,"created_at" timestamptz,"updated_at" timestamptz,"chave_pix" text,"pix_beneficiario" text,"pix_cidade" text);
create table contas_receber("id" uuid primary key,"cliente_id" uuid,"pedido_id" uuid,"documento" text,"parcela" int4,"valor" numeric,"valor_pago" numeric,"vencimento" date,"data_pagamento" date,"status" text,"observacao" text,"created_at" timestamptz,"updated_at" timestamptz,"centro_id" uuid,"data_emissao" date,"desconto" numeric,"acrescimo" numeric,"juros" numeric,"multa" numeric,"forma_pagamento_id" uuid,"conta_financeira_id" uuid,"categoria_id" uuid,"descricao" text,"acordo_id" uuid,"titulo_substituido_285" uuid,"ciclo_pedido_289" int4);
create table formas_pagamento("id" uuid primary key,"codigo" text,"nome" text,"tipo" text,"parcelas_padrao" int4,"dias_primeira_parcela" int4,"intervalo_dias" int4,"taxa_percentual" numeric,"observacoes" text,"ativo" bool,"created_at" timestamptz,"updated_at" timestamptz,"desconto_percentual" numeric);
create table pedidos("id" uuid primary key,"numero" int8,"cliente_id" uuid,"representante_id" uuid,"centro_id" uuid,"data_pedido" date,"condicao_pagamento" text,"parcelas" int4,"status" text,"desconto_valor" numeric,"frete_valor" numeric,"total_itens" numeric,"total_liquido" numeric,"comissao_percentual" numeric,"comissao_valor" numeric,"observacoes" text,"created_by" uuid,"created_at" timestamptz,"updated_at" timestamptz,"forma_pagamento_id" uuid,"rota_id" uuid,"previsao_entrega" date,"endereco_entrega" text,"tabela_preco" text,"onda_id" uuid,"forma_acrescimo_valor" numeric,"forma_desconto_valor" numeric,"custo_frete" numeric,"faturado_em" timestamptz,"tributos_estimados" numeric,"despesas_variaveis" numeric,"data_entrega" date,"tipo_documento" text,"orcamento_situacao" text,"orcamento_data" date,"orcamento_validade" date,"orcamento_aceito_em" timestamptz,"orcamento_encerrado_em" timestamptz,"orcamento_motivo" text,"aprovacao_automatica_em" timestamptz,"aprovacao_automatica_motivos" jsonb,"frete_volume_ativo" bool,"frete_volume_valor" numeric,"frete_volume_detalhes" jsonb,"outras_despesas" numeric,"frete_volume_opcao" text,"status_regularizado_em" timestamptz,"status_regularizado_por" uuid,"status_regularizado_motivo" text,"status_regularizado_data" date,"cancelamento_motivo_285" text,"cancelamento_por_285" uuid,"cancelamento_em_285" timestamptz,"ciclo_reabertura_289" int4,"reaberto_por_289" uuid,"reaberto_em_289" timestamptz,"modalidade_venda" text);
create view vw_cliente_credito with(security_invoker=true) as  SELECT c.id AS cliente_id,
    c.razao_social,
    COALESCE(c.limite_credito, 0::numeric) AS limite_credito,
    COALESCE(t.em_aberto, 0::numeric) AS em_aberto,
    COALESCE(t.vencido, 0::numeric) AS vencido,
    COALESCE(t.parcelas_abertas, 0::bigint) AS parcelas_abertas,
    COALESCE(t.parcelas_vencidas, 0::bigint) AS parcelas_vencidas,
    COALESCE(c.limite_credito, 0::numeric) - COALESCE(t.em_aberto, 0::numeric) AS limite_disponivel
   FROM clientes c
     LEFT JOIN ( SELECT cr.cliente_id,
            sum(cr.valor - COALESCE(cr.valor_pago, 0::numeric)) AS em_aberto,
            count(*) AS parcelas_abertas,
            sum(
                CASE
                    WHEN cr.vencimento < CURRENT_DATE THEN cr.valor - COALESCE(cr.valor_pago, 0::numeric)
                    ELSE 0::numeric
                END) AS vencido,
            count(*) FILTER (WHERE cr.vencimento < CURRENT_DATE) AS parcelas_vencidas
           FROM contas_receber cr
          WHERE (cr.valor - COALESCE(cr.valor_pago, 0::numeric)) > 0::numeric AND COALESCE(cr.status, 'aberto'::text) <> 'cancelado'::text
          GROUP BY cr.cliente_id) t ON t.cliente_id = c.id;
create view vw_cobranca_clientes_209 with(security_invoker=true) as  SELECT cliente_id,
    razao_social,
    centro_id,
    aberto,
    vencido
   FROM ( SELECT c.id AS cliente_id,
            c.razao_social,
            t.centro_id,
            sum(GREATEST(t.valor - COALESCE(t.valor_pago, 0::numeric), 0::numeric)) AS aberto,
            sum(
                CASE
                    WHEN vencimento_util(t.vencimento) < (now() AT TIME ZONE 'America/Sao_Paulo'::text)::date THEN GREATEST(t.valor - COALESCE(t.valor_pago, 0::numeric), 0::numeric)
                    ELSE 0::numeric
                END) AS vencido
           FROM contas_receber t
             JOIN clientes c ON c.id = t.cliente_id
          WHERE t.status = ANY (ARRAY['aberto'::text, 'parcial'::text])
          GROUP BY c.id, t.centro_id
         HAVING sum(GREATEST(t.valor - COALESCE(t.valor_pago, 0::numeric), 0::numeric)) > 0::numeric) fonte
  WHERE pode_rotina('cobranca_acompanhar'::text);
create table contas_pagar (like contas_receber);
create view vw_fluxo_previsto with(security_invoker=true) as  SELECT t.vencimento AS data,
    t.centro_id,
    round(t.valor + t.juros + t.multa + t.acrescimo - t.desconto - COALESCE(t.valor_pago, 0::numeric), 2) AS entradas,
    0::numeric AS saidas
   FROM contas_receber t
  WHERE t.status <> ALL (ARRAY['pago'::text, 'cancelado'::text])
UNION ALL
 SELECT t.vencimento AS data,
    t.centro_id,
    0::numeric AS entradas,
    round(t.valor + t.juros + t.multa + t.acrescimo - t.desconto - COALESCE(t.valor_pago, 0::numeric), 2) AS saidas
   FROM contas_pagar t
  WHERE t.status <> ALL (ARRAY['pago'::text, 'cancelado'::text]);
create view vw_titulos_receber with(security_invoker=true) as  SELECT t.id,
    t.cliente_id,
    t.pedido_id,
    t.documento,
    t.parcela,
    t.valor,
    t.valor_pago,
    t.vencimento,
    t.data_pagamento,
    t.status,
    t.observacao,
    t.created_at,
    t.updated_at,
    t.centro_id,
    t.data_emissao,
    t.desconto,
    t.acrescimo,
    t.juros,
    t.multa,
    t.forma_pagamento_id,
    t.conta_financeira_id,
    t.categoria_id,
    t.descricao,
    c.razao_social AS parceiro,
    round(t.valor + t.juros + t.multa + t.acrescimo - t.desconto - COALESCE(t.valor_pago, 0::numeric), 2) AS saldo,
        CASE
            WHEN t.status = 'cancelado'::text THEN 'cancelado'::text
            WHEN t.status = 'pago'::text THEN 'pago'::text
            WHEN COALESCE(t.valor_pago, 0::numeric) > 0::numeric AND t.vencimento < (now() AT TIME ZONE 'America/Sao_Paulo'::text)::date THEN 'vencido_parcial'::text
            WHEN COALESCE(t.valor_pago, 0::numeric) > 0::numeric THEN 'parcial'::text
            WHEN t.vencimento < (now() AT TIME ZONE 'America/Sao_Paulo'::text)::date THEN 'vencido'::text
            ELSE 'aberto'::text
        END AS status_efetivo,
    fp.nome AS forma_pagamento,
    cf.nome AS conta_nome,
    ct.nome AS centro_nome
   FROM contas_receber t
     LEFT JOIN clientes c ON c.id = t.cliente_id
     LEFT JOIN formas_pagamento fp ON fp.id = t.forma_pagamento_id
     LEFT JOIN contas_financeiras cf ON cf.id = t.conta_financeira_id
     LEFT JOIN centros ct ON ct.id = t.centro_id;
create view vw_cliente_titulos with(security_invoker=true) as  SELECT cr.id AS titulo_id,
    cr.cliente_id,
    cl.pessoa_id,
    cr.pedido_id,
    p.numero AS pedido_numero,
    cr.documento,
    cr.parcela,
    cr.descricao,
    cr.data_emissao,
    cr.vencimento,
    cr.data_pagamento,
    cr.valor,
    COALESCE(cr.valor_pago, 0::numeric) AS valor_pago,
    GREATEST(COALESCE(cr.valor, 0::numeric) + COALESCE(cr.juros, 0::numeric) + COALESCE(cr.multa, 0::numeric) + COALESCE(cr.acrescimo, 0::numeric) - COALESCE(cr.desconto, 0::numeric) - COALESCE(cr.valor_pago, 0::numeric), 0::numeric) AS saldo,
    cr.status,
        CASE
            WHEN cr.status = 'cancelado'::text THEN 'cancelado'::text
            WHEN COALESCE(cr.valor_pago, 0::numeric) >= cr.valor THEN 'pago'::text
            WHEN cr.vencimento < CURRENT_DATE THEN 'vencido'::text
            WHEN COALESCE(cr.valor_pago, 0::numeric) > 0::numeric THEN 'parcial'::text
            ELSE 'aberto'::text
        END AS status_efetivo,
    cr.centro_id,
    ce.nome AS centro
   FROM contas_receber cr
     LEFT JOIN clientes cl ON cl.id = cr.cliente_id
     LEFT JOIN pedidos p ON p.id = cr.pedido_id
     LEFT JOIN centros ce ON ce.id = cr.centro_id;
create view vw_fluxo_caixa with(security_invoker=true) as  SELECT to_char(contas_receber.vencimento::timestamp with time zone, 'YYYY-MM'::text) AS periodo,
    sum(
        CASE
            WHEN contas_receber.status <> ALL (ARRAY['cancelado'::text, 'pago'::text]) THEN contas_receber.valor + COALESCE(contas_receber.juros, 0::numeric) + COALESCE(contas_receber.multa, 0::numeric) + COALESCE(contas_receber.acrescimo, 0::numeric) - COALESCE(contas_receber.desconto, 0::numeric) - COALESCE(contas_receber.valor_pago, 0::numeric)
            ELSE 0::numeric
        END) AS previsto_entrada,
    sum(contas_receber.valor_pago) AS realizado_entrada,
    0::numeric AS previsto_saida,
    0::numeric AS realizado_saida,
    contas_receber.centro_id
   FROM contas_receber
  GROUP BY (to_char(contas_receber.vencimento::timestamp with time zone, 'YYYY-MM'::text)), contas_receber.centro_id
UNION ALL
 SELECT to_char(contas_pagar.vencimento::timestamp with time zone, 'YYYY-MM'::text) AS periodo,
    0::numeric AS previsto_entrada,
    0::numeric AS realizado_entrada,
    sum(
        CASE
            WHEN contas_pagar.status <> ALL (ARRAY['cancelado'::text, 'pago'::text]) THEN contas_pagar.valor + COALESCE(contas_pagar.juros, 0::numeric) + COALESCE(contas_pagar.multa, 0::numeric) + COALESCE(contas_pagar.acrescimo, 0::numeric) - COALESCE(contas_pagar.desconto, 0::numeric) - COALESCE(contas_pagar.valor_pago, 0::numeric)
            ELSE 0::numeric
        END) AS previsto_saida,
    sum(contas_pagar.valor_pago) AS realizado_saida,
    contas_pagar.centro_id
   FROM contas_pagar
  GROUP BY (to_char(contas_pagar.vencimento::timestamp with time zone, 'YYYY-MM'::text)), contas_pagar.centro_id;
