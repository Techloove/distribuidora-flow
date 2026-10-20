import { lerPaginas } from "@/lib/paginacao";
import { identidadeLoja } from "@/lib/identidade-loja";
import { useRef, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSupabase } from "@/lib/supabase-provider";
import { gerarHtmlPedidos, type PedidoImpressao, type PrintRow } from "@/lib/pedido-impressao";
import printCss from "@/styles/pedido-impressao.css?raw";

export function ImprimirPedidos({
  pedidoIds,
  label = "Imprimir pedido",
  compact = false,
}: {
  pedidoIds: string[];
  label?: string;
  compact?: boolean;
}) {
  const { client } = useSupabase();
  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState("");
  const [titulo, setTitulo] = useState("Impressão de pedidos");
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  async function open() {
    if (!client || loading || !pedidoIds.length) return;
    setLoading(true);
    try {
      const ids = [...new Set(pedidoIds)];
      const lerDocumentos = async (tabela: string, coluna: string, ordem: string) => {
        const resultado: PrintRow[] = [];
        for (let de = 0; de < ids.length; de += 100) {
          resultado.push(
            ...(await lerPaginas<PrintRow>((inicio, fim) =>
              client
                .from(tabela)
                .select("*")
                .in(coluna, ids.slice(de, de + 100))
                .order(ordem)
                .order("id")
                .range(inicio, fim),
            )),
          );
        }
        return resultado;
      };
      const [orders, items, companies] = await Promise.all([
        lerDocumentos("pedidos", "id", "numero"),
        lerDocumentos("pedido_itens", "pedido_id", "created_at"),
        client
          .from("empresas")
          .select(
            "razao_social, nome_fantasia, cnpj, telefone, email, logradouro, numero, cidade, uf",
          )
          .limit(1),
      ]);
      const pedidos = orders;
      const linhas = items;
      if (pedidos.length !== ids.length)
        throw new Error("Não foi possível acessar todos os pedidos selecionados.");
      const lookup = async (table: string, values: unknown[], columns = "*") => {
        const keys = [
          ...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0)),
        ];
        if (!keys.length) return [] as PrintRow[];
        const resultado: PrintRow[] = [];
        for (let de = 0; de < keys.length; de += 100) {
          const { data, error } = await client
            .from(table)
            .select(columns)
            .in("id", keys.slice(de, de + 100));
          if (error) throw new Error(error.message);
          resultado.push(...((data ?? []) as unknown as PrintRow[]));
        }
        return resultado;
      };
      const [clientes, produtos, centros, representantes, formas] = await Promise.all([
        lookup(
          "clientes",
          pedidos.map((p) => p["cliente_id"]),
        ),
        lookup(
          "produtos",
          linhas.map((i) => i["produto_id"]),
          "id, codigo, descricao, unidade, peso_kg",
        ),
        lookup(
          "centros",
          pedidos.map((p) => p["centro_id"]),
          "id,nome,nome_fantasia,razao_social,cnpj,inscricao_estadual,email,telefone,logradouro,numero,bairro,cidade,uf,cep,logo_url",
        ),
        lookup(
          "representantes",
          pedidos.map((p) => p["representante_id"]),
          "id, nome",
        ),
        lookup(
          "formas_pagamento",
          pedidos.map((p) => p["forma_pagamento_id"]),
          "id, nome",
        ),
      ]);
      const find = (rows: PrintRow[], id: unknown) => rows.find((r) => r["id"] === id) ?? {};
      const dados: PedidoImpressao[] = pedidos.map((pedido) => ({
        pedido,
        cliente: find(clientes, pedido["cliente_id"]),
        empresa: identidadeLoja(
          find(centros, pedido["centro_id"]),
          companies.error ? {} : (companies.data?.[0] ?? {}),
        ),
        centro: find(centros, pedido["centro_id"]),
        representante: find(representantes, pedido["representante_id"]),
        forma: find(formas, pedido["forma_pagamento_id"]),
        itens: linhas
          .filter((i) => i["pedido_id"] === pedido["id"])
          .map((item) => ({ item, produto: find(produtos, item["produto_id"]) })),
      }));
      setTitulo(
        pedidos.every((p) => p["tipo_documento"] === "orcamento")
          ? "Impressão de orçamentos"
          : pedidos.some((p) => p["tipo_documento"] === "orcamento")
            ? "Impressão de pedidos e orçamentos"
            : "Impressão de pedidos",
      );
      setReady(false);
      setHtml(gerarHtmlPedidos(dados, printCss));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível preparar a impressão.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size={compact ? "sm" : "default"}
        disabled={!client || !pedidoIds.length || loading}
        onClick={(event) => {
          event.stopPropagation();
          void open();
        }}
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
        {label}
      </Button>
      <Dialog
        open={!!html}
        onOpenChange={(open) => {
          if (!open) setHtml("");
        }}
      >
        <DialogContent
          className="flex h-[90dvh] w-[calc(100%-2rem)] max-w-4xl flex-col sm:max-w-4xl"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
            <DialogDescription>{pedidoIds.length} documento(s)</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button
              disabled={!ready}
              onClick={() => {
                const win = frame.current?.contentWindow;
                if (win) {
                  win.focus();
                  win.print();
                }
              }}
            >
              <Printer className="size-4" />
              Imprimir / salvar PDF
            </Button>
          </div>
          <iframe
            ref={frame}
            title="Prévia de impressão dos documentos"
            className="min-h-0 w-full flex-1 border border-border bg-card"
            srcDoc={html}
            onLoad={() => setReady(true)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
