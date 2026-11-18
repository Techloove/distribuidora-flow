import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Printer, RefreshCw } from "lucide-react";
import { ErpLayout } from "@/components/erp-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useSupabase } from "@/lib/supabase-provider";
import { useCentroValido } from "@/lib/centros-acesso";
import { setCentro } from "@/lib/centro-store";
import { brl, dataHoraBr } from "@/lib/formatacao";
import {
  correspondeBuscaPreparada,
  prepararTextoBusca,
  prepararTermoBusca,
} from "@/lib/busca-selecao";
import {
  descricaoFaixaPreco,
  htmlTabelaPrecos,
  observacaoTabelaPrecos,
  precoPorFaixa,
  type TabelaPrecos,
} from "@/lib/tabela-precos";
export const Route = createFileRoute("/_app/tabela-precos")({
  head: () => ({ meta: [{ title: "Tabela de preços por loja — Caparaó System" }] }),
  component: TabelaPrecosPage,
});
const valor = (v: number | null) => (v === null ? "Não informado" : brl(v));
function TabelaPrecosPage() {
  const { client, user } = useSupabase();
  const cv = useCentroValido();
  const [busca, setBusca] = useState("");
  const [formato, setFormato] = useState("normal");
  const [pagina, setPagina] = useState(0);
  const [impressao, setImpressao] = useState("");
  const [pronto, setPronto] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const q = useQuery({
    queryKey: ["tabela_precos_loja_371", user?.id, cv.centro],
    enabled: !!client && !!user && !!cv.centro && !cv.isLoading && !cv.error,
    queryFn: async () => {
      const { data, error } = await client!.rpc("tabela_precos_loja_371", { _loja: cv.centro });
      if (error)
        throw Error(
          error.message.includes("schema cache")
            ? "Aplique a fase371 no Supabase para habilitar a tabela de preços."
            : error.message,
        );
      const tabela = data as TabelaPrecos;
      if (
        !tabela ||
        tabela.loja?.id !== cv.centro ||
        !Array.isArray(tabela.itens) ||
        !Array.isArray(tabela.faixas)
      )
        throw Error("Resposta da tabela de preços inválida. Atualize para tentar novamente.");
      return tabela;
    },
  });
  const preparados = useMemo(
    () =>
      (q.data?.itens ?? []).map((item) => ({
        item,
        texto: prepararTextoBusca([item.codigo, item.descricao, item.categoria ?? ""].join(" ")),
      })),
    [q.data],
  );
  const itens = useMemo(() => {
    const termo = prepararTermoBusca(busca);
    return preparados.filter((p) => correspondeBuscaPreparada(p.texto, termo)).map((p) => p.item);
  }, [preparados, busca]);
  const faixas = useMemo(
    () => (formato === "peso" ? (q.data?.faixas ?? []).filter((f) => f.ativo) : []),
    [q.data, formato],
  );
  const paginas = Math.max(1, Math.ceil(itens.length / 30));
  const atual = Math.min(pagina, paginas - 1);
  const visiveis = itens.slice(atual * 30, atual * 30 + 30);
  const carregando = cv.isLoading || q.isPending;
  return (
    <ErpLayout
      title="Tabela de preços"
      description="Consulte e imprima os preços de cada loja, com as condições por faixa de peso."
    >
      <div className="space-y-4">
        <div className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-2 text-sm">
            Loja
            <SearchSelect
              aria-label="Loja da tabela de preços"
              value={cv.centro}
              onChange={(e) => {
                setCentro(e.target.value);
                setPagina(0);
                setBusca("");
                setImpressao("");
              }}
              disabled={cv.isLoading || !!cv.error}
              className="h-10 w-full rounded-md border px-3"
            >
              <option value="">Selecione a loja</option>
              {cv.lista.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </SearchSelect>
          </label>
          <label className="space-y-2 text-sm">
            Formato
            <SearchSelect
              aria-label="Formato da tabela de preços"
              value={formato}
              onChange={(e) => {
                setFormato(e.target.value);
                setPagina(0);
              }}
              className="h-10 w-full rounded-md border px-3"
            >
              <option value="normal">Preço normal</option>
              <option value="peso">Preço normal e faixas por peso</option>
            </SearchSelect>
          </label>
          <label className="space-y-2 text-sm">
            Buscar produto
            <Input
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setPagina(0);
              }}
              placeholder="Código, descrição ou categoria"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {q.data?.loja.nome ?? "Selecione uma loja"} · {itens.length} produto(s)
            {q.data ? ` · Consulta: ${dataHoraBr(q.data.consultado_em)}` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!cv.centro || q.isFetching}
              onClick={() => void q.refetch()}
            >
              <RefreshCw className="size-4" />
              Atualizar
            </Button>
            <Button
              disabled={!q.data || q.isFetching || !itens.length || !!q.error}
              onClick={() => {
                setPronto(false);
                setImpressao(htmlTabelaPrecos(q.data!, itens, faixas));
              }}
            >
              <Printer className="size-4" />
              Imprimir / salvar PDF
            </Button>
          </div>
        </div>
        {cv.error || q.error ? (
          <p role="alert" className="rounded-xl border p-4 text-destructive">
            {(cv.error ?? q.error)?.message}
          </p>
        ) : !cv.centro ? (
          <p>Selecione uma loja para consultar.</p>
        ) : carregando ? (
          <p>Carregando preços…</p>
        ) : (
          <>
            {formato === "peso" && !faixas.length && (
              <p className="rounded-xl border p-3 text-sm">
                Esta loja não tem faixas de desconto por peso ativas. O relatório apresenta o preço
                normal.
              </p>
            )}
            <p className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
              {observacaoTabelaPrecos}
            </p>
            {!itens.length ? (
              <p>Nenhum produto disponível para esta busca.</p>
            ) : (
              <>
                <div className="hidden overflow-x-auto rounded-xl border sm:block">
                  <table className="w-full text-sm" style={{ minWidth: 560 + faixas.length * 200 }}>
                    <thead className="bg-muted">
                      <tr>
                        <th className="min-w-24 whitespace-nowrap p-3 text-left">Código</th>
                        <th className="min-w-56 p-3 text-left">Produto</th>
                        <th className="min-w-16 whitespace-nowrap p-3">Un.</th>
                        <th className="min-w-28 p-3 text-right">Preço normal</th>
                        {faixas.map((f) => (
                          <th key={f.id} className="min-w-48 max-w-64 p-3 text-left">
                            {descricaoFaixaPreco(f)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visiveis.map((p) => (
                        <tr key={p.id} className="border-t">
                          <td className="whitespace-nowrap p-3">{p.codigo}</td>
                          <td className="p-3">{p.descricao}</td>
                          <td className="whitespace-nowrap p-3 text-center">{p.unidade}</td>
                          <td className="whitespace-nowrap p-3 text-right font-semibold">
                            {valor(p.preco_normal)}
                          </td>
                          {faixas.map((f) => (
                            <td key={f.id} className="whitespace-nowrap p-3 text-right">
                              {valor(precoPorFaixa(p.preco_normal, f.percentual))}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-3 sm:hidden">
                  {visiveis.map((p) => (
                    <article key={p.id} className="space-y-3 rounded-xl border bg-card p-4">
                      <div>
                        <p className="font-semibold">{p.descricao}</p>
                        <p className="text-xs text-muted-foreground">
                          Código {p.codigo} · {p.unidade}
                        </p>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span>Preço normal</span>
                        <strong>{valor(p.preco_normal)}</strong>
                      </div>
                      {faixas.map((f) => (
                        <div key={f.id} className="space-y-1 rounded-lg bg-muted/50 p-3">
                          <p className="text-xs">{descricaoFaixaPreco(f)}</p>
                          <p className="font-semibold">
                            {valor(precoPorFaixa(p.preco_normal, f.percentual))}
                          </p>
                        </div>
                      ))}
                    </article>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span>
                    Página {atual + 1} de {paginas} · A impressão inclui todos os produtos da busca.
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={atual === 0}
                      onClick={() => setPagina(atual - 1)}
                    >
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      disabled={atual >= paginas - 1}
                      onClick={() => setPagina(atual + 1)}
                    >
                      Próxima
                    </Button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
      <Dialog
        open={!!impressao}
        onOpenChange={(v) => {
          if (!v) setImpressao("");
        }}
      >
        <DialogContent className="flex h-[90dvh] max-w-6xl flex-col">
          <DialogHeader>
            <DialogTitle>Tabela de preços · impressão</DialogTitle>
            <DialogDescription>
              Confira a loja, os produtos e as condições antes de imprimir ou salvar em PDF.
            </DialogDescription>
          </DialogHeader>
          <Button
            className="self-start"
            disabled={!pronto}
            onClick={() => {
              frame.current?.contentWindow?.focus();
              frame.current?.contentWindow?.print();
            }}
          >
            <Printer className="size-4" />
            Imprimir / salvar PDF
          </Button>
          <iframe
            ref={frame}
            title="Prévia da tabela de preços"
            srcDoc={impressao}
            sandbox="allow-modals allow-same-origin"
            className="min-h-0 w-full flex-1 rounded-lg border bg-white"
            onLoad={() => setPronto(true)}
          />
        </DialogContent>
      </Dialog>
    </ErpLayout>
  );
}
