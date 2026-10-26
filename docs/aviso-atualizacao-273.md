# Versão1.1.0 / fase273 — aviso de atualização

O sistema consulta o manifesto público `/versao.json` ao abrir uma sessão na área autenticada, aproximadamente a cada minuto enquanto a página estiver visível e quando a pessoa retornar à aba ou recuperar a conexão. As consultas próximas são limitadas a um intervalo de 15 segundos. O manifesto contém somente número, data e título da versão; não contém dados de usuários, credenciais ou configurações.

Na primeira entrada na área autenticada, o sistema faz essa verificação **antes de renderizar os formulários**. Se encontrar uma versão mais nova, recarrega automaticamente uma vez por versão, mantendo a sessão já autenticada. A sessão persistida do Supabase não é apagada. Uma marca na sessão e outra na URL impedem ciclo de recarregamento se a hospedagem ainda servir código antigo; nesse caso fica disponível a atualização manual. Se a consulta falhar, a entrada continua e novas versões detectadas depois usam o aviso.

Durante o uso, se a versão publicada for maior que a versão do código aberto no navegador, aparece o balão **Nova versão disponível**. O aviso não desaparece por navegar entre telas. O botão **Depois** recolhe o balão em um botão menor, mantendo a atualização acessível. Se outra versão for publicada, o aviso volta a expandir.

No balão durante o uso, **Atualizar agora** pede confirmação e recarrega a página somente por ação do usuário. Operações registradas pelo sistema como mutações em andamento bloqueiam o botão até terminarem. Campos ainda não enviados não são salvos automaticamente: o aviso orienta a salvar antes de confirmar. O recarregamento conserva a URL da tela, seus parâmetros e a âncora, acrescentando um identificador da versão para evitar reutilizar HTML antigo em cache.

A comparação considera as partes numéricas da versão. Versão igual, versão anterior, resposta HTML, erro de rede, manifesto inválido ou ausência do arquivo não geram falso aviso. A verificação não envia cookies ou token de sessão. Não depende de Supabase, de SQL novo ou de mensagens por email.

## Publicação

A primeira instalação deste recurso exige publicar a versão1.1.0 e atualizar uma vez os navegadores que ainda estão no código1.0.0, pois esse código antigo não possui a verificação. Depois disso, as próximas versões publicadas serão detectadas nas sessões que permanecerem abertas. Um commit no GitHub, sem publicação do site, ainda não é uma nova versão disponível no ambiente.

Use os comandos de versionamento já documentados. Os scripts `dev`, `build` e `build:dev` geram `public/versao.json` da mesma fonte do número exibido. O arquivo gerado não é versionado. Ao concluir o build, o manifesto em `.output/public` é conferido e o arquivo `_headers` recebe a regra sem cache para o manifesto, preservando as regras de cache dos assets.

Se o provedor de hospedagem usar outro pipeline, ele precisa executar esses passos e servir `/versao.json` como JSON atualizado. No pipeline atual do projeto eles fazem parte do build. As consultas usam também `cache: no-store` e um parâmetro por consulta. Não há serviço de push nem atualização silenciosa dos navegadores.

## Validação

Testes locais: comparação de versões, transporte sem credenciais/cache, nova publicação detectada na consulta seguinte, tratamento de erro/HTML/manifesto inválido, conservação dos parâmetros da tela, geração de metadados públicos, preservação do cache de assets, finalização repetível e rejeição de versão divergente no build. Nenhuma operação real no banco, estoque ou emissão fiscal foi executada.
