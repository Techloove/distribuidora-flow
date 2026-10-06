import { useRef, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSupabase } from "@/lib/supabase-provider";
import { gerarHtmlPedidos, type PedidoImpressao, type PrintRow } from "@/lib/pedido-impressao";
import printCss from "@/styles/pedido-impressao.css?raw";

export function ImprimirPedidos({ pedidoIds, label = "Imprimir pedido", compact = false }: { pedidoIds: string[]; label?: string; compact?: boolean }) {
  const { client } = useSupabase();
  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState("");
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  async function open() {
    if (!client || loading || !pedidoIds.length) return;
    setLoading(true);
    try {
      const ids = [...new Set(pedidoIds)];
      const [orders, items, companies] = await Promise.all([
        client.from("pedidos").select("*").in("id", ids).order("numero"),
        client.from("pedido_itens").select("*").in("pedido_id", ids).order("created_at"),
        client.from("empresas").select("razao_social, nome_fantasia, cnpj, telefone, email, logradouro, numero, cidade, uf").limit(1),
      ]);
      if (orders.error) throw new Error(orders.error.message);
      if (items.error) throw new Error(items.error.message);
      const pedidos = (orders.data ?? []) as PrintRow[];
      const linhas = (items.data ?? []) as PrintRow[];
      if (pedidos.length !== ids.length) throw new Error("Não foi possível acessar todos os pedidos selecionados.");
      const lookup = async (table: string, values: unknown[], columns = "*") => {
        const keys = [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))];
        if (!keys.length) return [] as PrintRow[];
        const { data, error } = await client.from(table).select(columns).in("id", keys);
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as PrintRow[];
      };
      const [clientes, produtos, centros, representantes, formas] = await Promise.all([
        lookup("clientes", pedidos.map((p) => p["cliente_id"])),
        lookup("produtos", linhas.map((i) => i["produto_id"]), "id, descricao, unidade, peso_kg"),
        lookup("centros", pedidos.map((p) => p["centro_id"]), "id, nome"),
        lookup("representantes", pedidos.map((p) => p["representante_id"]), "id, nome"),
        lookup("formas_pagamento", pedidos.map((p) => p["forma_pagamento_id"]), "id, nome"),
      ]);
      const find = (rows: PrintRow[], id: unknown) => rows.find((r) => r["id"] === id) ?? {};
      const dados: PedidoImpressao[] = pedidos.map((pedido) => ({
        pedido,
        cliente: find(clientes, pedido["cliente_id"]),
        empresa: companies.error ? {} : (companies.data?.[0] ?? {}),
        centro: find(centros, pedido["centro_id"]),
        representante: find(representantes, pedido["representante_id"]),
        forma: find(formas, pedido["forma_pagamento_id"]),
        itens: linhas.filter((i) => i["pedido_id"] === pedido["id"]).map((item) => ({ item, produto: find(produtos, item["produto_id"]) })),
      }));
      setReady(false);
      setHtml(gerarHtmlPedidos(dados, printCss));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível preparar a impressão.");
    } finally {
      setLoading(false);
    }
  }

  return <>
    <Button variant="outline" size={compact ? "sm" : "default"} disabled={!client || !pedidoIds.length || loading} onClick={(event) => { event.stopPropagation(); void open(); }}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}{label}
    </Button>
    <Dialog open={!!html} onOpenChange={(open) => { if (!open) setHtml(""); }}>
      <DialogContent className="flex h-[90dvh] w-[calc(100%-2rem)] max-w-4xl flex-col sm:max-w-4xl" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Impressão de pedidos</DialogTitle>
          <DialogDescription>{pedidoIds.length} pedido(s)</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end"><Button disabled={!ready} onClick={() => { const win = frame.current?.contentWindow; if (win) { win.focus(); win.print(); } }}><Printer className="size-4" />Imprimir / salvar PDF</Button></div>
        <iframe ref={frame} title="Prévia de impressão dos pedidos" className="min-h-0 w-full flex-1 border border-border bg-card" srcDoc={html} onLoad={() => setReady(true)} />
      </DialogContent>
    </Dialog>
  </>;
}