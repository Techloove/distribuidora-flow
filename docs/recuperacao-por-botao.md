# Recuperação pela tela de manutenção

## Opções solicitadas

A tela deve oferecer duas operações distintas ao administrador:

1. **Repor registros apagados:** inserir registros existentes na cópia e ausentes hoje, sem substituir registros atuais. Antes de liberar, conferir dependências e efeitos em estoque, saldos, comissões, pedidos e integrações. Inserir linhas isoladas não garante consistência financeira.
2. **Voltar os dados à data da cópia:** recuperar o conjunto consistente de dados operacionais e descartar alterações posteriores dentro desse conjunto. Exibir a data da cópia e o impacto antes de confirmar. Preservar o acesso administrativo e as credenciais atuais.

Escolher uma opção ou abrir sua prévia não autoriza a execução. A recuperação de produção exige confirmação específica na tela, depois de mostrar o impacto.

## Condições para liberar a execução

- Administrador ativo; autorização revalidada no servidor e no executor.
- Identidade e integridade da cópia conferidas, incluindo o pacote criptografado e sua chave.
- Restauração inicial em banco descartável, sem rede, antes de analisar os dados.
- Prévia sem dados pessoais em logs, com quantidades de registros e conflitos.
- Compatibilidade da estrutura atual conferida. Mudanças incompatíveis devem bloquear a execução automática.
- Vínculos entre tabelas, efeitos de gatilhos e estado de integrações externas conferidos. Restaurar um boleto no banco não desfaz uma operação no banco emissor.
- Nova cópia dos dados atuais concluída e verificada antes de aplicar a recuperação.
- Escritas concorrentes suspensas durante a aplicação, com desbloqueio garantido em falha ou expiração.
- Aplicação transacional, validação de restrições e consistência; nenhuma alteração parcial em caso de erro.
- Histórico da escolha, confirmação, cópia de segurança, execução e resultado.
- Testes dos dois modos, falhas e concorrência em ambiente separado. Não usar os dados de produção como teste de recuperação.

## Situação atual

O backup completo e o ensaio de restauração isolada estão implementados. O ensaio concluído conferiu 161 tabelas e 9.481 registros, além do código versionado. Consulte [o ensaio de restauração](ensaio-restauracao-backup.md).

**O ensaio não instala um botão que restaura produção.** As duas opções acima são o escopo solicitado para a próxima implementação. Não apresentar um botão de download, uma solicitação na fila ou um teste isolado como se fossem uma recuperação concluída. A interface atual continua sem ação destrutiva de restauração.

Recuperar identidades do provedor, chaves raiz, configurações externas e a própria infraestrutura continua exigindo procedimento técnico específico; não prometer reversão dessas partes por uma operação de dados do aplicativo.
