# FAZNOTAS — tributação por loja e produto, fase258

## Aplicação e uso

1. Executar integralmente `db/fase258_tributacao_produtos_faznotas.sql` após as fases256 e257, no Supabase utilizado pelo sistema.
2. Publicar no Lovable.
3. Acessar **Lojas → Configurações da loja → Tributação dos produtos · FAZNOTAS**. Selecionar um produto disponível no catálogo da loja.
4. Criar uma regra para cada CFOP que esse produto utilizará. Conferir os CFOPs definidos na preparação da loja e nas exceções do produto; cadastrar somente os códigos aplicáveis, conforme o contador.
5. No ICMS, adicionar as UFs de destino. CFOP5xxx aceita apenas a UF do emitente;6xxx aceita UFs diferentes. Cada UF tem CST/CSOSN, modalidade da base e campos de alíquota, ST, MVA, FCP, redução, crédito, diferimento e cBenef do contrato recebido.
6. Informar CST e, quando aplicável, alíquotas de PIS/COFINS. Habilitar IPI quando houver parametrização a informar. Não há CST ou alíquota preenchidos automaticamente pelo sistema.
7. Para IBS/CBS, configurar CST, classificação e alíquotas. Se o contador orientar omitir o bloco, confirmar expressamente a utilização dos padrões da FAZNOTAS descritos na documentação: CST000, classificação000001, CBS0,9% e IBS0,1%. A opção começa desmarcada e é independente por produto/CFOP. Isso não é recomendação de enquadramento; a conta e o provedor precisam suportar a operação desejada.
8. **Salvar como rascunho** conserva o trabalho sem liberar a regra para preparação do cadastro. Blocos informados precisam ter formato válido; campos opcionais vazios são omitidos. ICMS adicionado exige UF e CST/CSOSN; PIS/COFINS informado exige os dois CSTs; IBS/CBS habilitado exige CST e classificação.
9. Após resolver as pendências, marcar a confirmação da revisão com o contador e **Salvar regra revisada**. A preparação fiscal da própria loja também precisa estar revisada. Revisar exige NCM, origem e unidade do produto preenchidos, CEST com formato válido quando informado, ICMS para ao menos uma UF e CST de PIS/COFINS. A interface verifica também GTIN/EAN quando informado.
10. Usar **Conferir JSON salvo deste CFOP** para visualizar a estrutura do cadastro de produto. O botão prepara apenas uma prévia local da regra salva; não cadastra produtos remotamente e não emite notas. O JSON não inclui token, credencial, preço de referência nem propriedades que não constam no schema Produto da API recebida (como EAN/CEST). Estes últimos permanecem no cadastro local.

## Revisão e alterações

- Estados visuais: **Rascunho**, **Revisado** e **Revisar alterações**.
- A revisão guarda os dados fiscais relevantes do produto e da loja. Alterar NCM, origem, unidade, GTIN/CEST, descrição/código, exceções de CFOP, UF, CRT ou CFOPs gerais sinaliza que a regra precisa ser conferida se o contexto atual divergir do contexto revisado. Mudanças de preço/estoque não invalidam a tributação.
- O servidor compara também os dados exibidos no momento de confirmar a revisão. Se outra pessoa alterar o produto ou a loja enquanto o editor estiver aberto, a revisão é recusada até recarregar os dados.
- Regras usam controle de versão: uma gravação feita após outra pessoa alterar a mesma regra é recusada, evitando sobrescrever a configuração sem perceber. Recarregar os dados e regras salvas antes de continuar. Esse botão recupera os valores salvos; alterações locais ainda não salvas devem ser concluídas antes de recarregar.
- A revisão não é mantida silenciosamente durante a edição. A confirmação começa desmarcada no editor; salvar sem confirmar grava rascunho, conforme o texto do botão.
- As UFs podem ser removidas do rascunho. Isso só é persistido ao salvar a regra. Não há alteração de produtos globais, notas históricas, estoque compartilhado, contas a receber ou pedidos.

## Contrato e limites

A estrutura segue os schemas `ConfiguracaoFiscal` e `ConfiguracaoFiscalIcmsEstado` do OpenAPI FAZNOTAS/Myse3.10.0 recebido. Campos de imposto são strings decimais com ponto, inclusive zero explícito. Listas de propriedades são fechadas no cliente e no banco; propriedades arbitrárias e campos de credencial são recusados.

O campo `codigo-beneficiario` sob `aliquotas` é o nome exato usado pelo contrato para cBenef; não é o código de beneficiário bancário Sicredi. A tela apresenta o nome fiscal para evitar confusão.

O sistema confere estrutura, CFOP/UF e CST/CSOSN compatível com o CRT: CRT1/4 usa CSOSN e CRT2/3 usa CST. Essa conferência não decide a incidência legal, NCM correto, CST aplicável, cálculo de base/ST/DIFAL ou exigibilidade de cBenef. O contador deve definir os enquadramentos e campos necessários. Valores opcionais omitidos podem receber tratamento padrão pelo provedor; não representam automaticamente isenção nem alíquota zero.

IPI, ICMS e CSTs podem exigir outros enquadramentos conforme a operação. O schema de Produto recebido não expõe todos os campos fiscais possíveis de NF-e. Operações não representadas pelo contrato precisam ser confirmadas com o provedor antes de transmitir.

A prévia contempla um CFOP salvo por vez. Não é uma chamada de `/nfe/emissao`. A integração operacional ainda precisa sincronizar os produtos e clientes, validar notas com múltiplos CFOPs, conciliar os totais e implementar envio idempotente/consulta com DANFE/XML. Nenhuma nota é transmitida nesta fase, e o faturamento manual existente é preservado.

## Segurança e verificação

- Leitura e gravação exigem usuário ativo, administrador/gestor, permissão de configuração e acesso à loja. A gravação exige produto no catálogo disponível da loja, considerando a categoria da loja.
- Tabela com RLS e escrita direta bloqueada para usuários. Somente a RPC validada grava configurações; credenciais continuam isoladas na fase257.
- Registro de usuário, data, produto, loja, CFOP e revisão na auditoria.
- Migração testada duas vezes em PGlite, incluindo esquema, percentuais, inconsistência de UF/CRT, isolamento de acesso, contexto de revisão e concorrência.
- Testes de contrato e de prévia verificam campos permitidos, preservação de zeros, omissão de IBS/CBS somente com confirmação explícita e bloqueio de revisão desatualizada.
- Teste no navegador com dados simulados percorreu cadastro, revisão, prévia JSON, edição para rascunho e troca de loja. Nenhuma chamada à FAZNOTAS foi feita nos testes.
