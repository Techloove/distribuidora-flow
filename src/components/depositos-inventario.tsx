import { SeletorProdutoEstoque } from "@/components/seletor-produto-estoque";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { useRotinaRpc } from "@/lib/use-rotina-rpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Registro } from "@/lib/rotinas-distribuidora";

export function DepositosInventario({
  centro,
  produtos,
}: {
  centro: string;
  produtos: Registro[];
}) {
  const { client, user } = useSupabase(),
    perm = usePermissoesRotinas();
  const [tarefa, setTarefa] = useState("inventario");
  const [deposito, setDeposito] = useState(""),
    [produto, setProduto] = useState(""),
    [endereco, setEndereco] = useState(""),
    [inventario, setInventario] = useState(""),
    [contagens, setContagens] = useState<Record<string, string>>({});
  const [paginaInventario, setPaginaInventario] = useState(0);
  const [novoContado, setNovoContado] = useState("");
  const rpc = useRotinaRpc([
    "depositos",
    "deposito_saldos",
    "inventarios",
    "inventario_itens",
    "estoque_saldos",
    "estoque_disponivel",
  ]);
  const dep = useQuery({
    queryKey: ["depositos", user?.id, centro],
    enabled: !!client && !!centro,
    queryFn: async () => {
      const { data, error } = await client!
        .from("depositos")
        .select("*,centros(nome)")
        .eq("ativo", true)
        .eq("centro_id", centro)
        .order("nome")
        .limit(100);
      if (error) throw new Error("Aplique a fase213 para usar depósitos e inventário.");
      return (data ?? []) as Registro[];
    },
  });
  useEffect(() => {
    const daLoja = (dep.data ?? []).filter((d) => d["centro_id"] === centro);
    const principal =
      daLoja.find((d) => d["padrao"] === true) ?? (daLoja.length === 1 ? daLoja[0] : undefined);
    const novo = principal ? String(principal["id"]) : "";
    if (deposito === novo) return;
    setDeposito(novo);
    setInventario("");
    setContagens({});
    setPaginaInventario(0);
    setNovoContado("");
    setEndereco("");
  }, [centro, dep.data, deposito]);
  const saldos = useQuery({
    queryKey: ["deposito_saldos", user?.id, deposito, produto],
    enabled: !!client && !!deposito,
    queryFn: async () => {
      let busca = client!
        .from("deposito_saldos")
        .select("*", { count: "exact" })
        .eq("deposito_id", deposito);
      if (produto) busca = busca.eq("produto_id", produto);
      const { data, error, count } = await busca
        /* filtro do produto permite consultar qualquer posição */
        .order("produto_id")
        .limit(1000);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as Registro[], count };
    },
  });
  const inv = useQuery({
    queryKey: ["inventarios", user?.id, deposito],
    enabled:
      !!client &&
      !!deposito &&
      (perm.pode("inventario_contar") || perm.pode("inventario_conferir")),
    queryFn: async () => {
      const { data, error } = await client!
        .from("inventarios")
        .select("*")
        .eq("deposito_id", deposito)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as Registro[];
    },
  });
  const itens = useQuery({
    queryKey: ["inventario_itens", user?.id, inventario, paginaInventario],
    enabled: !!client && !!inventario,
    queryFn: async () => {
      const { data, error, count } = await client!
        .from("inventario_itens")
        .select("*", { count: "exact" })
        .eq("inventario_id", inventario)
        .order("produto_id")
        .range(paginaInventario * 50, paginaInventario * 50 + 49);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as Registro[], count };
    },
  });
  const label = (id: unknown) => String(produtos.find((p) => p["id"] === id)?.["descricao"] ?? id);
  return (
    <section className="space-y-4 rounded border p-4">
      <h2 className="font-semibold">Depósito da loja</h2>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Operação no depósito">
        {[
          { id: "inventario", nome: "Contar estoque" },
          { id: "organizar", nome: "Localização dos produtos" },
        ].map((t) => (
          <Button
            key={t.id}
            type="button"
            variant={tarefa === t.id ? "default" : "outline"}
            aria-pressed={tarefa === t.id}
            disabled={rpc.isPending}
            onClick={() => setTarefa(t.id)}
          >
            {t.nome}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        O depósito principal é selecionado automaticamente conforme a loja escolhida. A lista abaixo
        mostra somente depósitos dessa loja.
      </p>
      {dep.error && (
        <p role="alert" className="text-destructive text-sm">
          {dep.error.message}
        </p>
      )}
      <div className="space-y-2">
        <label className="text-sm" htmlFor="deposito-loja">
          Depósito vinculado à loja
        </label>
        <Input
          id="deposito-loja"
          readOnly
          value={
            dep.data?.find((d) => d["id"] === deposito)?.["nome"]
              ? String(dep.data.find((d) => d["id"] === deposito)!["nome"])
              : ""
          }
          placeholder={
            !centro
              ? "Selecione a loja no topo da página"
              : dep.isPending
                ? "Carregando depósito..."
                : "Depósito principal não encontrado. Confira a fase271."
          }
        />
      </div>
      {deposito && (
        <>
          {tarefa !== "inventario" && (
            <>
              <div className="space-y-2">
                <label htmlFor="deposito-produto" className="text-sm">
                  Produto
                </label>
                <SeletorProdutoEstoque
                  id="deposito-produto"
                  produtos={produtos}
                  value={produto}
                  onChange={(id) => {
                    setProduto(id);
                    setEndereco("");
                  }}
                  disabled={rpc.isPending}
                />
              </div>
            </>
          )}
          {perm.pode("deposito_operar") && (
            <div className="grid items-end gap-3 sm:grid-cols-2">
              {tarefa === "organizar" && (
                <>
                  <Input
                    aria-label="Endereço de armazenagem"
                    placeholder="Rua A / prateleira 2"
                    value={endereco}
                    onChange={(e) => setEndereco(e.target.value)}
                  />
                  <Button
                    disabled={!produto || rpc.isPending}
                    onClick={() =>
                      rpc.mutate({
                        nome: "gerenciar_deposito_213",
                        args: {
                          _centro:
                            centro || dep.data?.find((d) => d["id"] === deposito)?.["centro_id"],
                          _nome: "",
                          _deposito: deposito,
                          _produto: produto,
                          _endereco: endereco,
                        },
                      })
                    }
                  >
                    Salvar endereço
                  </Button>
                </>
              )}
            </div>
          )}
          {tarefa !== "inventario" && (
            <>
              {saldos.error && <p role="alert">{saldos.error.message}</p>}
              <div className="max-h-64 overflow-auto space-y-2">
                {saldos.data?.rows
                  .filter((s) => produtos.some((p) => p["id"] === s["produto_id"]))
                  .map((s) => (
                    <div className="border-b py-2 text-sm" key={String(s["produto_id"])}>
                      {label(s["produto_id"])} — {String(s["quantidade"])} ·{" "}
                      {String(s["endereco"] ?? "Sem endereço")}
                    </div>
                  ))}
              </div>
              {(saldos.data?.count ?? 0) > 1000 && (
                <p role="alert">Mostrando os primeiros 1000 saldos deste depósito.</p>
              )}
            </>
          )}
          {tarefa === "inventario" &&
            (perm.pode("inventario_contar") || perm.pode("inventario_conferir")) && (
              <>
                {perm.pode("inventario_contar") && (
                  <Button
                    disabled={rpc.isPending}
                    onClick={() =>
                      rpc.mutate(
                        { nome: "abrir_inventario_213", args: { _deposito: deposito } },
                        {
                          onSuccess: (id) => {
                            setInventario(String(id));
                            setContagens({});
                            setPaginaInventario(0);
                            setNovoContado("");
                          },
                        },
                      )
                    }
                  >
                    Abrir inventário
                  </Button>
                )}
                <select
                  aria-label="Inventário"
                  className="block w-full rounded border bg-background p-2"
                  value={inventario}
                  onChange={(e) => {
                    setInventario(e.target.value);
                    setPaginaInventario(0);
                    setContagens({});
                    setNovoContado("");
                  }}
                >
                  <option value="">Selecione um inventário</option>
                  {inv.data?.map((i) => (
                    <option key={String(i["id"])} value={String(i["id"])}>
                      {String(i["created_at"]).slice(0, 16)} · {String(i["status"])}
                    </option>
                  ))}
                </select>
                {itens.error && <p role="alert">{itens.error.message}</p>}
                {itens.data?.rows.map((i) => {
                  const id = String(i["produto_id"]);
                  return (
                    <div key={id} className="grid gap-2 sm:grid-cols-3 items-center">
                      <span className="text-sm">
                        {label(id)} · esperado {String(i["esperado"])}
                      </span>
                      <Input
                        aria-label={`Contagem de ${label(id)}`}
                        type="number"
                        min="0"
                        step="0.001"
                        value={contagens[id] ?? String(i["contado"] ?? "")}
                        onChange={(e) => setContagens((s) => ({ ...s, [id]: e.target.value }))}
                      />
                      <Button
                        disabled={
                          !perm.pode("inventario_contar") ||
                          rpc.isPending ||
                          (contagens[id] ?? "") === "" ||
                          Number(contagens[id]) < 0 ||
                          inv.data?.find((i) => i["id"] === inventario)?.["status"] !== "contagem"
                        }
                        onClick={() =>
                          rpc.mutate({
                            nome: "contar_inventario_213",
                            args: {
                              _inventario: inventario,
                              _produto: id,
                              _contado: Number(contagens[id]),
                            },
                          })
                        }
                      >
                        Salvar contagem
                      </Button>
                    </div>
                  );
                })}
                {inventario && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={paginaInventario === 0 || itens.isFetching}
                      onClick={() => setPaginaInventario((p) => p - 1)}
                    >
                      Página anterior
                    </Button>
                    <span className="text-sm">
                      Página {paginaInventario + 1} · {itens.data?.count ?? 0} itens
                    </span>
                    <Button
                      variant="outline"
                      disabled={
                        (paginaInventario + 1) * 50 >= (itens.data?.count ?? 0) || itens.isFetching
                      }
                      onClick={() => setPaginaInventario((p) => p + 1)}
                    >
                      Próxima página
                    </Button>
                  </div>
                )}
                {inventario && perm.pode("inventario_contar") && (
                  <details className="rounded-lg border p-3">
                    <summary className="cursor-pointer text-sm">Contar outro produto</summary>
                    <div className="mt-3 space-y-3">
                      <SeletorProdutoEstoque
                        id="inventario-produto"
                        produtos={produtos}
                        value={produto}
                        onChange={(id) => {
                          setProduto(id);
                          setNovoContado("");
                        }}
                        disabled={rpc.isPending}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Input
                          aria-label="Contagem do produto selecionado"
                          placeholder="Contagem do produto selecionado"
                          type="number"
                          min="0"
                          step="0.001"
                          value={novoContado}
                          onChange={(e) => setNovoContado(e.target.value)}
                        />
                        <Button
                          disabled={
                            rpc.isPending ||
                            !produto ||
                            novoContado === "" ||
                            Number(novoContado) < 0 ||
                            inv.data?.find((i) => i["id"] === inventario)?.["status"] !== "contagem"
                          }
                          onClick={() =>
                            rpc.mutate({
                              nome: "contar_inventario_213",
                              args: {
                                _inventario: inventario,
                                _produto: produto,
                                _contado: Number(novoContado),
                              },
                            })
                          }
                        >
                          Contar produto selecionado
                        </Button>
                      </div>
                    </div>
                  </details>
                )}
                {inventario && perm.pode("inventario_conferir") && (
                  <Button
                    disabled={
                      rpc.isPending ||
                      inv.data?.find((i) => i["id"] === inventario)?.["status"] !== "contagem"
                    }
                    onClick={() =>
                      rpc.mutate({
                        nome: "conferir_inventario_213",
                        args: { _inventario: inventario },
                      })
                    }
                  >
                    Conferir e aplicar diferenças
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  A conferência exige todos os itens contados. Se o estoque mudar durante a
                  contagem, abra novo inventário. O ajuste respeita mercadorias reservadas.
                </p>
              </>
            )}
        </>
      )}
    </section>
  );
}
