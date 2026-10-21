import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { lerPaginas } from "@/lib/paginacao";
import { brl } from "@/lib/formatacao";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Cidade = { cidade: string; uf: string };
type Produto = { id: string; codigo: string; descricao: string; unidade?: string };
type Tarifa = Cidade & {
  produto_id: string;
  valor_unitario: number;
  ativo: boolean;
  produtos: Omit<Produto, "id"> | null;
};
export function FreteVolumeLoja({ loja }: { loja: string }) {
  const { client, user, canManage } = useSupabase();
  const permissoes = usePermissoesRotinas();
  const pode = canManage && permissoes.pode("lojas_frete_volume_configurar");
  const qc = useQueryClient();
  const [cidade, setCidade] = useState("");
  const [produto, setProduto] = useState("");
  const [busca, setBusca] = useState("");
  const [valor, setValor] = useState("");
  const [ativo, setAtivo] = useState(true);
  const [filtro, setFiltro] = useState("");
  const cidades = useQuery({
    queryKey: ["cidades-frete-volume", loja, user?.id],
    enabled: !!client && pode,
    queryFn: () =>
      lerPaginas<Cidade>(async (inicio, fim) => {
        const { data, error } = await client!
          .rpc("cidades_frete_volume_250", { _loja: loja })
          .range(inicio, fim);
        return { data: data as Cidade[] | null, error };
      }),
  });
  const produtos = useQuery({
    queryKey: ["produtos-frete-volume", loja, busca, user?.id],
    enabled: !!client && pode,
    queryFn: async () => {
      const { data, error } = await client!
        .rpc("listar_catalogo_loja_244", { _loja: loja, _busca: busca, _somente_disponiveis: true })
        .range(0, 49);
      if (error) throw new Error(error.message);
      return (data ?? []) as Produto[];
    },
  });
  const tarifas = useQuery({
    queryKey: ["tarifas-frete-volume", loja, user?.id],
    enabled: !!client && pode,
    queryFn: () =>
      lerPaginas<Tarifa>(async (inicio, fim) => {
        const { data, error } = await client!
          .from("loja_fretes_volume")
          .select("cidade,uf,produto_id,valor_unitario,ativo,produtos(codigo,descricao,unidade)")
          .eq("centro_id", loja)
          .order("cidade")
          .order("uf")
          .order("produto_id")
          .range(inicio, fim);
        return { data: data as unknown as Tarifa[] | null, error };
      }),
  });
  const salvar = useMutation({
    mutationFn: async () => {
      const local = JSON.parse(cidade || "null") as Cidade | null;
      if (
        !local ||
        !produto ||
        !valor.trim() ||
        !Number.isFinite(Number(valor)) ||
        Number(valor) < 0
      )
        throw new Error("Selecione cidade, produto e informe o frete por unidade.");
      const { error } = await client!.rpc("salvar_frete_volume_250", {
        _loja: loja,
        _cidade: local.cidade,
        _uf: local.uf,
        _produto: produto,
        _valor: Number(valor),
        _ativo: ativo,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Tarifa de frete salva para esta loja.");
      void qc.invalidateQueries({ queryKey: ["tarifas-frete-volume"] });
      setValor("");
      setProduto("");
      setAtivo(true);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!pode) return null;
  const rows = (tarifas.data ?? []).filter((t) =>
    `${t.cidade} ${t.uf} ${t.produtos?.descricao ?? ""} ${t.produtos?.codigo ?? ""}`
      .toLocaleLowerCase("pt-BR")
      .includes(filtro.toLocaleLowerCase("pt-BR")),
  );
  return (
    <section className="rounded-xl border p-4 space-y-4">
      <div>
        <h3 className="font-semibold">Frete por volume</h3>
        <p className="text-sm text-muted-foreground">
          Defina o valor cobrado por unidade de cada produto, conforme a cidade/UF do cliente.
          Exemplo: 100 sacos × R$ 2,50 = R$ 250,00. As tarifas são exclusivas desta loja.
        </p>
      </div>
      {(cidades.error || produtos.error || tarifas.error) && (
        <p role="alert" className="text-sm text-destructive">
          {(cidades.error || produtos.error || tarifas.error)?.message}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="frete-cidade">Cidade / UF do cliente</Label>
          <select
            id="frete-cidade"
            className="h-10 w-full rounded-md border bg-background px-3"
            value={cidade}
            onChange={(e) => setCidade(e.target.value)}
          >
            <option value="">Selecione a cidade</option>
            {cidades.data?.map((c) => (
              <option key={JSON.stringify(c)} value={JSON.stringify(c)}>
                {c.cidade} / {c.uf || "UF não informada"}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="frete-busca-produto">Buscar produto da loja</Label>
          <Input
            id="frete-busca-produto"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Código ou nome do produto"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="frete-produto">Produto</Label>
          <select
            id="frete-produto"
            className="h-10 w-full rounded-md border bg-background px-3"
            value={produto}
            onChange={(e) => setProduto(e.target.value)}
          >
            <option value="">Selecione o produto (até 50 resultados por busca)</option>
            {produto && !produtos.data?.some((p) => p.id === produto) && (
              <option value={produto}>Produto da tarifa selecionada</option>
            )}
            {produtos.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.codigo} · {p.descricao}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="frete-tarifa">Frete por unidade do produto (R$)</Label>
          <Input
            id="frete-tarifa"
            type="number"
            min="0"
            step="0.01"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
        Tarifa ativa
      </label>
      <Button
        onClick={() => salvar.mutate()}
        disabled={salvar.isPending || !cidade || !produto || !valor.trim()}
      >
        Salvar tarifa
      </Button>
      <p className="text-xs text-muted-foreground">
        Produtos sem tarifa ativa para a cidade não recebem frete por volume. Alterar uma tarifa não
        modifica pedidos já aprovados. Nos documentos em digitação, use “Atualizar encargos” para
        buscar as tarifas atuais.
      </p>
      <Input
        aria-label="Filtrar tarifas de frete"
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        placeholder="Filtrar tarifas por cidade ou produto"
      />
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-2">Cidade / UF</th>
              <th>Produto</th>
              <th>Frete/un.</th>
              <th>Situação</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={`${t.cidade}/${t.uf}/${t.produto_id}`} className="border-t">
                <td className="p-2">
                  {t.cidade} / {t.uf || "—"}
                </td>
                <td>
                  {t.produtos?.codigo} · {t.produtos?.descricao} ({t.produtos?.unidade || "un."})
                </td>
                <td>{brl(t.valor_unitario)}</td>
                <td>{t.ativo ? "Ativa" : "Inativa"}</td>
                <td>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setCidade(JSON.stringify({ cidade: t.cidade, uf: t.uf }));
                      setProduto(t.produto_id);
                      setValor(String(t.valor_unitario));
                      setAtivo(t.ativo);
                    }}
                  >
                    Editar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="p-3 text-sm text-muted-foreground">Nenhuma tarifa encontrada.</p>
        )}
      </div>
    </section>
  );
}
