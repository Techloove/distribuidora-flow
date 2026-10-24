# Forecast Fiscal — fase267: XML e DANFE de homologação

Aplicar manualmente no Supabase **somente o SQL** de `db/fase267_documentos_homologacao_forecast.sql`, após a fase266. Publicar também o código atualizado. Este documento Markdown não é uma migração.

Na tela de Notas, abra Forecast · Homologação. Após uma tentativa iniciada, os botões XML e DANFE consultam os endpoints documentados `GET /api/v2/nfe/{ref}.xml` e `.pdf`. Nenhuma emissão é feita por esses botões. Os testes usam transportes simulados e banco local; nenhuma nota real foi emitida.

O servidor usa a referência reservada e a credencial original da loja, sem aceitar URLs externas. Uma troca de token, ambiente ou CNPJ impede novas consultas remotas do documento antigo. Arquivos já armazenados continuam disponíveis a usuários autorizados na loja e carteira correspondentes. Tokens não são enviados ao navegador.

O XML deve ser uma NF-e processada 4.00, com ambiente 2 tanto na nota quanto no protocolo, autorização 100/150, chave válida e emitente, destinatário, série, número e total correspondentes à tentativa. Quando houver chave/protocolo confirmado no JSON, exige coincidência. O parser rejeita DTD, entidades externas, namespaces incorretos, duplicidades e estruturas inválidas. **A assinatura digital não é verificada.** O recebimento de XML não muda o estado da tentativa nem autoriza a nota operacional.

O DANFE exige primeiro um XML conferido. O PDF deve abrir com o parser e conter páginas; o vínculo usa a mesma referência e credencial do XML. **Não há extração de texto para comprovar a chave impressa no PDF.** A interface informa essa limitação.

Cada arquivo tem limite de 5 MiB, preserva seus bytes originais e recebe SHA-256. O primeiro arquivo armazenado é imutável: uma resposta posterior diferente exige revisão, preservando o original. O download identifica HOMOLOGACAO no nome. A auditoria registra referência, tamanho e hash, sem conteúdo ou credenciais.

Os documentos ficam em tabela própria, sem preencher URLs, chave ou status da nota operacional, movimentar estoque ou alterar títulos. As funções de leitura revalidam permissão fiscal, menu, loja, usuário ativo e carteira. As funções de busca e gravação ficam restritas ao servidor.

A implantação de produção ainda não está concluída. Permanecem a validação do retorno JSON real em homologação, validação fiscal dos cenários e regras por CNPJ com o responsável fiscal, eventos como cancelamento e a liberação controlada de produção. O Swagger com resposta `{}` não comprova o contrato de retorno. Esta fase não libera produção.

Validação local: testes de XML/PDF, limites de transferência, transporte GET, hashes e erros; regressão SQL com reaplicação, permissões, carteira, rotação de credencial, imutabilidade e comparação dos dados operacionais antes/depois.
