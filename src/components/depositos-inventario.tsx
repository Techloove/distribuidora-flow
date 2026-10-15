import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
  const [deposito, setDeposito] = useState(""),
    [destino, setDestino] = useState(""),
    [produto, setProduto] = useState(""),
    [nome, setNome] = useState(""),
    [endereco, setEndereco] = useState(""),
    [qtd, setQtd] = useState(""),
    [inventario, setInventario] = useState(""),
    [contagens, setContagens] = useState<Record<string, string>>({});
  const [paginaInventario, setPaginaInventario] = useState(0);
  const [novoContado, setNovoContado] = useState("");
  const [chaveTransferencia, setChaveTransferencia] = useState(() => crypto.randomUUID());
  const rpc = useRotinaRpc([
    "depositos",
    "deposito_saldos",
    "inventarios",
    "inventario_itens",
    "estoque_saldos",
    "estoque_disponivel",
  ]);
  const dep = useQuery({
    queryKey: ["depositos", user?.id, "compartilhado"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("depositos")
        .select("*,centros(nome)")
        .eq("ativo", true)
        .order("nome")
        .limit(100);
      if (error) throw new Error("Aplique a fase213 para usar depósitos e inventário.");
      return (data ?? []) as Registro[];
    },
  });
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
      <h2 className="font-semibold">Depósitos e inventário</h2>
      <p className="text-xs text-muted-foreground">
        Os depósitos compõem o estoque compartilhado das lojas. Entradas usam o depósito de estoque
        compartilhado; saídas podem consumir os depósitos de qualquer centro.
      </p>
      {dep.error && (
        <p role="alert" className="text-destructive text-sm">
          {dep.error.message}
        </p>
      )}
      <label className="block text-sm">
        Depósito
        <select
          className="block w-full rounded border bg-background p-2"
          aria-label="Depósito"
          value={deposito}
          onChange={(e) => {
            setDeposito(e.target.value);
            setInventario("");
            setContagens({});
          }}
        >
          <option value="">Selecione</option>
          {dep.data?.map((d) => (
            <option key={String(d["id"])} value={String(d["id"])}>
              {String(d["nome"])} ·{" "}
              {String((d["centros"] as Registro | null)?.["nome"] ?? "Compartilhado")}
            </option>
          ))}
        </select>
      </label>
      {!centro && perm.pode("deposito_operar") && (
        <p className="text-xs text-muted-foreground">
          Selecione um centro para cadastrar um novo depósito.
        </p>
      )}
      {perm.pode("deposito_operar") && (
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Nome do novo depósito"
            placeholder="Novo depósito"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
          <Button
            disabled={!centro || !nome.trim() || rpc.isPending}
            onClick={() =>
              rpc.mutate(
                { nome: "gerenciar_deposito_213", args: { _centro: centro, _nome: nome } },
                { onSuccess: () => setNome("") },
              )
            }
          >
            Criar depósito
          </Button>
        </div>
      )}
      {deposito && (
        <>
          <label className="block text-sm">
            Produto
            <select
              className="block w-full rounded border bg-background p-2"
              aria-label="Produto no depósito"
              value={produto}
              onChange={(e) => {
                setProduto(e.target.value);
                setChaveTransferencia(crypto.randomUUID());
              }}
            >
              <option value="">Selecione</option>
              {produtos.map((p) => (
                <option key={String(p["id"])} value={String(p["id"])}>
                  {String(p["descricao"])}
                </option>
              ))}
            </select>
          </label>
          {perm.pode("deposito_operar") && (
            <div className="grid gap-2 sm:grid-cols-2">
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
                      _centro: centro || dep.data?.find((d) => d["id"] === deposito)?.["centro_id"],
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
              <select
                aria-label="Depósito de destino"
                className="rounded border bg-background p-2"
                value={destino}
                onChange={(e) => {
                  setDestino(e.target.value);
                  setChaveTransferencia(crypto.randomUUID());
                }}
              >
                <option value="">Destino da transferência</option>
                {dep.data
                  ?.filter((d) => d["id"] !== deposito)
                  .map((d) => (
                    <option key={String(d["id"])} value={String(d["id"])}>
                      {String(d["nome"])} ·{" "}
                      {String((d["centros"] as Registro | null)?.["nome"] ?? "Compartilhado")}
                    </option>
                  ))}
              </select>
              <Input
                aria-label="Quantidade para transferir"
                type="number"
                min="0.001"
                step="0.001"
                value={qtd}
                onChange={(e) => {
                  setQtd(e.target.value);
                  setChaveTransferencia(crypto.randomUUID());
                }}
              />
              <Button
                disabled={!produto || !destino || !(Number(qtd) > 0) || rpc.isPending}
                onClick={() =>
                  rpc.mutate(
                    {
                      nome: "transferir_deposito_213",
                      args: {
                        _origem: deposito,
                        _destino: destino,
                        _produto: produto,
                        _quantidade: Number(qtd),
                        _chave: chaveTransferencia,
                      },
                    },
                    {
                      onSuccess: () => {
                        setQtd("");
                        setChaveTransferencia(crypto.randomUUID());
                      },
                    },
                  )
                }
              >
                Transferir entre depósitos
              </Button>
            </div>
          )}
          {saldos.error && <p role="alert">{saldos.error.message}</p>}
          <div className="max-h-64 overflow-auto space-y-2">
            {saldos.data?.rows.map((s) => (
              <div className="border-b py-2 text-sm" key={String(s["produto_id"])}>
                {label(s["produto_id"])} — {String(s["quantidade"])} ·{" "}
                {String(s["endereco"] ?? "Sem endereço")}
              </div>
            ))}
          </div>
          {(saldos.data?.count ?? 0) > 1000 && (
            <p role="alert">Mostrando os primeiros 1000 saldos deste depósito.</p>
          )}
          {(perm.pode("inventario_contar") || perm.pode("inventario_conferir")) && (
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
              {inventario && produto && perm.pode("inventario_contar") && (
                <div className="flex gap-2">
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
                A conferência exige todos os itens contados. Se o estoque mudar durante a contagem,
                abra novo inventário. O ajuste respeita mercadorias reservadas.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
