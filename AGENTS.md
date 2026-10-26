<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

- Keep promotion management as a master-detail workspace on `/tabelas-preco`; this preserves fast campaign-to-product editing.
- Share one client-side order print template and preview control across orders, picking and dispatch; existing authenticated reads preserve permissions without new server logic.

## Versões e manual do usuário

- Toda entrega que altere o comportamento ou a interface publicada deve avançar a versão: patch para correção, minor para nova funcionalidade compatível e major para mudança incompatível. A primeira versão numerada é 1.0.0 (fase272); não invente versões retroativas.
- Use `npm run version:patch -- "Resumo"` (ou `version:minor` / `version:major`) uma vez por entrega. O script atualiza package.json, src/content/versoes.json e a cópia do manual. Não envie commits nem publique automaticamente por meio do script.
- Atualize src/content/manual.json quando uma rotina mudar. Rode `npm run manual:gerar` e `npm run check:version` antes de concluir. Preserve notas anteriores; descreva limitações reais de homologação e de infraestrutura.
- O manual em /ajuda é documentação para usuários autenticados com acesso ao sistema. Ele não concede permissões a módulos, lojas, carteiras ou operações. Atalhos devem respeitar o acesso existente.
