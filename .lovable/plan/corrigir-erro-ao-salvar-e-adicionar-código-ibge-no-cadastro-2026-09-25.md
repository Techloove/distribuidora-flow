# Corrigir erro ao salvar e adicionar código IBGE no Cadastro Unificado

## 1. Erro "Preencha todos os campos obrigatórios"
Causa encontrada: o campo "Comissão (%) do vendedor" agora fica escondido quando a pessoa não é representante. Mesmo escondido, o sistema envia ele vazio, e o banco não aceita comissão vazia (o padrão é 0). O mesmo pode acontecer com "Limite de crédito" e "Tipo de pessoa" quando ficam em branco.

Correção:
- Campos escondidos ou vazios que têm valor padrão no banco deixam de ser enviados como vazio (o banco aplica o padrão, ex.: comissão 0, limite 0).
- A mensagem de erro passa a dizer qual campo está faltando, em vez da frase genérica.

## 2. Código IBGE do município
- Novo campo "Código IBGE" no Cadastro Unificado (e no cadastro de Clientes, para ficar igual), ao lado de Cidade/UF.
- Busca automática: ao consultar CNPJ ou CEP, e ao preencher Cidade + UF, o código IBGE é preenchido sozinho.
- Busca manual: botão "Buscar IBGE" ao lado do campo, que usa a Cidade e UF digitadas.
- Fonte: serviço público gratuito do IBGE (lista de municípios por UF) e ViaCEP para CEP; não precisa de chave.
- Se a cidade não for encontrada, aparece aviso e o campo pode ser digitado à mão.

## Detalhes técnicos
- `crud-page.tsx`: no payload, omitir campos com `showIf` falso e campos vazios de colunas com default (ou tratar number vazio como omitido em insert); `traduzErro` extrair nome da coluna de `null value in column "x"`.
- Migração `db/fase79_codigo_ibge.sql`: `alter table pessoas/clientes add column if not exists codigo_ibge text` (idempotente).
- Server fn `src/lib/ibge.functions.ts`: `buscarIbge({cidade, uf})` via `servicodados.ibge.gov.br/api/v1/localidades/estados/{uf}/municipios` com comparação normalizada (sem acento); `buscarCep(cep)` via ViaCEP retornando `ibge`.
- `consulta-cadastral.functions.ts`: preencher `codigo_ibge` a partir do CEP retornado.
- Componente pequeno `CodigoIbge` no `extraForm` de `/pessoas` e `/clientes`.
