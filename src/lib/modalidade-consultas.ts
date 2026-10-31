import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcsModalidade, tabelasModalidade } from "./modalidade-mapeamento";
import type { ModalidadeFiltro } from "./modalidade-store";

/** Só redireciona consultas analíticas enumeradas. Gravações e detalhes conservam a origem. */
export function destinoModalidade(url: URL, metodo: string, modalidade: string | null) {
  if (!modalidade || modalidade === "todos" || !["estoque", "intermediacao"].includes(modalidade))
    return url;
  const partes = url.pathname.split("/"),
    nome = partes.at(-1) ?? "";
  if (!url.pathname.includes("/rest/v1/")) return url;
  let destino: string | undefined;
  if (partes.at(-2) === "rpc") destino = rpcsModalidade[nome];
  else if (["GET", "HEAD"].includes(metodo.toUpperCase())) {
    const detalhe = [
      "id",
      "pedido_id",
      "carga_id",
      "expedicao_id",
      "devolucao_id",
      "conta_receber_id",
      "comissao_id",
    ].some((k) => url.searchParams.get(k)?.startsWith("eq."));
    if (!detalhe) destino = tabelasModalidade[nome];
  }
  if (!destino) return url;
  const nova = new URL(url);
  partes[partes.length - 1] = destino;
  nova.pathname = partes.join("/");
  return nova;
}
export const fetchModalidade: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : null;
  const origem = new URL(request?.url ?? input.toString());
  const headers = new Headers(init?.headers ?? request?.headers);
  const modalidade =
    headers.get("x-client-info")?.match(/^caparao-modalidade\/(estoque|intermediacao)$/)?.[1] ??
    null;
  const destino = destinoModalidade(origem, init?.method ?? request?.method ?? "GET", modalidade);
  if (destino.toString() === origem.toString()) return fetch(input, init);
  // Supabase envia URL + JSON; conserva o corpo original, inclusive no Safari.
  return fetch(request ? new Request(destino, request) : destino, init);
};
/** A marcação existe apenas no SELECT inicial; update/insert/delete/select de retorno ficam intactos. */
export function clienteAnalitico(
  client: SupabaseClient,
  modalidade: ModalidadeFiltro,
): SupabaseClient {
  if (modalidade === "todos") return client;
  return new Proxy(client, {
    get(target, key) {
      if (key === "from")
        return (nome: string) => {
          const origem = target.from(nome);
          if (!tabelasModalidade[nome]) return origem;
          return new Proxy(origem, {
            get(builder, metodo) {
              if (metodo === "select")
                return (...args: Parameters<typeof origem.select>) =>
                  origem
                    .select(...args)
                    .setHeader("x-client-info", "caparao-modalidade/" + modalidade);
              const v = Reflect.get(builder, metodo);
              return typeof v === "function" ? v.bind(builder) : v;
            },
          });
        };
      if (key === "rpc")
        return (...args: Parameters<typeof target.rpc>) => {
          const query = target.rpc(...args);
          return rpcsModalidade[args[0]]
            ? query.setHeader("x-client-info", "caparao-modalidade/" + modalidade)
            : query;
        };
      const v = Reflect.get(target, key);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
