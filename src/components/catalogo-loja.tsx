import { CategoriaLoja } from "@/components/categoria-loja";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";

type Produto = {
  id: string;
  codigo: string;
  descricao: string;
  preco_venda: number;
  disponivel: boolean;
  desconto_maximo: number | null;
};
const moeda = (n: number) =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function CatalogoLoja({ loja, nome }: { loja: string; nome: string }) {
  const { client, user, canManage } = useSupabase();
  const permissoes = usePermissoesRotinas();
  const editar = canManage && permissoes.pode("lojas_catalogo_configurar");
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("");
  const [pagina, setPagina] = useState(0);
  const [produto, setProduto] = useState<Produto | null>(null);
  const [preco, setPreco] = useState("");
  const [desconto, setDesconto] = useState("");
  const [disponivel, setDisponivel] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => {
      setFiltro(busca.trim());
      setPagina(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [busca]);
  const q = useQuery({
    queryKey: ["loja-catalogo", user?.id, loja, filtro, pagina],
    enabled: !!client && !!user,
    queryFn: async () => {
      const { data, error } = await client!
        .rpc("listar_catalogo_loja_244", {
          _loja: loja,
          _busca: filtro,
          _somente_disponiveis: false,
        })
        .range(pagina * 50, pagina * 50 + 49);
      if (error) throw new Error(error.message);
      return (data ?? []) as Produto[];
    },
  });
  const salvar = useMutation({
    mutationFn: async () => {
      if (
        !produto ||
        !preco.trim() ||
        !Number.isFinite(Number(preco)) ||
        Number(preco) < 0 ||
        (desconto.trim() &&
          (!Number.isFinite(Number(desconto)) || Number(desconto) < 0 || Number(desconto) > 100))
      )
        throw new Error("Confira o preço e o desconto informado.");
      const { error } = await client!.rpc("salvar_produto_loja_244", {
        _loja: loja,
        _produto: produto.id,
        _disponivel: disponivel,
        _preco: Number(preco),
        _desconto_maximo: desconto.trim() ? Number(desconto) : null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(`Produto atualizado em ${nome}.`);
      setProduto(null);
      void qc.invalidateQueries({ queryKey: ["loja-catalogo"] });
      void qc.invalidateQueries({ queryKey: ["validar_pedido"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  function abrir(p: Produto) {
    setProduto(p);
    setPreco(String(p.preco_venda));
    setDesconto(p.desconto_maximo === null ? "" : String(p.desconto_maximo));
    setDisponivel(p.disponivel);
  }
  return (
    <section className="rounded-xl border p-4 space-y-4" aria-label={`Catálogo de ${nome}`}>
      <h3 className="font-semibold">Produtos e preços — {nome}</h3>
      <p className="text-sm text-muted-foreground">
        O catálogo segue a categoria da loja. Ajuste aqui o preço-base, o teto de desconto ou uma
        suspensão individual de venda. O estoque é compartilhado. Alterar a referência no cadastro
        geral de Produtos não altera os preços já configurados nas lojas.
      </p>
      <CategoriaLoja key={loja} loja={loja} editar={editar} />
      <Label htmlFor="busca-catalogo-loja">Buscar produto por código ou descrição</Label>
      <Input id="busca-catalogo-loja" value={busca} onChange={(e) => setBusca(e.target.value)} />
      {q.isPending ? (
        <p>Carregando catálogo…</p>
      ) : q.error ? (
        <p role="alert" className="text-destructive">
          {q.error.message}. Confira a aplicação da fase244.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-2">Código / produto</th>
                <th className="p-2">Venda na loja</th>
                <th className="p-2">Preço-base</th>
                <th className="p-2">Desconto máximo</th>
                <th className="p-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="p-2">
                    {p.codigo} · {p.descricao}
                  </td>
                  <td className="p-2">{p.disponivel ? "Disponível" : "Indisponível"}</td>
                  <td className="p-2">{moeda(p.preco_venda)}</td>
                  <td className="p-2">
                    {p.desconto_maximo === null ? "Regra da loja" : `${p.desconto_maximo}%`}
                  </td>
                  <td className="p-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!editar}
                      onClick={() => abrir(p)}
                      aria-label={`Configurar ${p.codigo} ${p.descricao}`}
                    >
                      Configurar
                    </Button>
                  </td>
                </tr>
              ))}
              {!q.data.length && (
                <tr>
                  <td colSpan={5} className="p-4">
                    Nenhum produto encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          disabled={pagina === 0 || q.isFetching}
          onClick={() => setPagina((p) => p - 1)}
        >
          Anterior
        </Button>
        <span>Página {pagina + 1}</span>
        <Button
          variant="outline"
          disabled={q.isFetching || (q.data?.length ?? 0) < 50}
          onClick={() => setPagina((p) => p + 1)}
        >
          Próxima
        </Button>
      </div>
      {!editar && (
        <p className="text-sm text-muted-foreground">
          Edição disponível para gestores autorizados em Usuários e papéis → Lojas → Configurar
          produtos, preços e descontos da loja.
        </p>
      )}
      <Dialog
        open={!!produto}
        onOpenChange={(v) => {
          if (!v && !salvar.isPending) setProduto(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Produto em {nome}</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            {produto?.codigo} · {produto?.descricao}
          </p>
          <Label htmlFor="produto-loja-disponivel">Venda nesta loja</Label>
          <select
            id="produto-loja-disponivel"
            className="h-10 rounded-md border px-3"
            value={String(disponivel)}
            onChange={(e) => setDisponivel(e.target.value === "true")}
            disabled={salvar.isPending}
          >
            <option value="true">Disponível</option>
            <option value="false">Indisponível</option>
          </select>
          <Label htmlFor="produto-loja-preco">Preço-base nesta loja (R$)</Label>
          <Input
            id="produto-loja-preco"
            type="number"
            min="0"
            step="0.0001"
            value={preco}
            onChange={(e) => setPreco(e.target.value)}
            disabled={salvar.isPending}
          />
          <Label htmlFor="produto-loja-desconto">Desconto máximo do item (%)</Label>
          <Input
            id="produto-loja-desconto"
            type="number"
            min="0"
            max="100"
            step="0.01"
            placeholder="Vazio: usar regra da loja"
            value={desconto}
            onChange={(e) => setDesconto(e.target.value)}
            disabled={salvar.isPending}
          />
          <p className="text-xs text-muted-foreground">
            O teto do produto complementa o limite geral da loja: vale o mais restritivo. Desconto
            acima do teto exige aprovação. A indisponibilidade impede novos itens e
            aprovação/confirmação de pedidos em aberto; vendas confirmadas conservam seu histórico.
            As promoções vigentes da loja podem definir o preço do item.
          </p>
          <Button disabled={!editar || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? "Salvando…" : "Salvar produto nesta loja"}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
