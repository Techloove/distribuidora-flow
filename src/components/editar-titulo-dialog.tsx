import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { useSupabase } from "@/lib/supabase-provider";
import { lerPaginas } from "@/lib/paginacao";
import { dataBr } from "@/lib/formatacao";
type Resposta = { registro: Record<string, unknown>; versao: string; vinculado: boolean };
export function EditarTituloDialog({
  tabela,
  id,
  onClose,
  onSaved,
}: {
  tabela: "contas_receber" | "contas_pagar";
  id: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { client, user } = useSupabase();
  const [erro, setErro] = useState("");
  const [form, setForm] = useState({
    documento: "",
    data_emissao: "",
    vencimento: "",
    valor: "",
    categoria_id: "",
    descricao: "",
    observacao: "",
  });
  const q = useQuery({
    queryKey: ["editar-titulo", tabela, id, user?.id],
    enabled: !!client,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    retry: false,
    queryFn: async () => {
      const r = await client!.rpc("editar_titulo_356", { _tabela: tabela, _id: id });
      if (r.error) throw Error(r.error.message);
      return r.data as Resposta;
    },
  });
  useEffect(() => {
    if (q.data) {
      const r = q.data.registro;
      setForm({
        documento: String(r["documento"] ?? ""),
        data_emissao: String(r["data_emissao"] ?? ""),
        vencimento: String(r["vencimento"] ?? ""),
        valor: String(r["valor"] ?? ""),
        categoria_id: String(r["categoria_id"] ?? ""),
        descricao: String(r["descricao"] ?? ""),
        observacao: String(r["observacao"] ?? ""),
      });
      setErro("");
    }
  }, [q.data]);
  const categorias = useQuery({
    queryKey: ["categorias-financeiras-edicao", tabela, user?.id],
    enabled: !!client,
    queryFn: () =>
      lerPaginas<{ id: string; nome: string }>((a, b) =>
        client!
          .from("categorias_financeiras")
          .select("id,nome")
          .eq("ativo", true)
          .eq("tipo", tabela === "contas_receber" ? "receita" : "despesa")
          .order("nome")
          .order("id")
          .range(a, b),
      ),
  });
  const salvar = useMutation({
    mutationFn: async () => {
      if (!q.data) throw Error("Reabra o título para editar.");
      const valor = Number(form.valor);
      if (
        !form.documento.trim() ||
        !Number.isFinite(valor) ||
        valor <= 0 ||
        dataBr(form.vencimento) === "—" ||
        (form.data_emissao && dataBr(form.data_emissao) === "—")
      )
        throw Error("Confira documento, valor e datas.");
      const r = await client!.rpc("editar_titulo_356", {
        _tabela: tabela,
        _id: id,
        _versao: q.data.versao,
        _dados: { ...form, valor, categoria_id: form.categoria_id || null },
      });
      if (r.error) throw Error(r.error.message);
    },
    onSuccess: onSaved,
    onError: (e: Error) => setErro(e.message),
  });
  const set = (k: keyof typeof form, v: string) => {
    setForm((s) => ({ ...s, [k]: v }));
    setErro("");
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !salvar.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Editar conta a {tabela === "contas_receber" ? "receber" : "pagar"}
          </DialogTitle>
          <DialogDescription>
            A edição altera somente esta parcela. Loja, parceiro, origem e histórico são
            preservados.
          </DialogDescription>
        </DialogHeader>
        {q.isPending ? (
          <p>Carregando dados atuais…</p>
        ) : q.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {q.error.message}
          </p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              salvar.mutate();
            }}
          >
            <fieldset disabled={salvar.isPending} className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="editar-titulo-documento">Documento</Label>
                <Input
                  id="editar-titulo-documento"
                  maxLength={120}
                  value={form.documento}
                  onChange={(e) => set("documento", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="editar-titulo-valor">Valor (R$)</Label>
                <Input
                  id="editar-titulo-valor"
                  currency
                  disabled={q.data.vinculado}
                  value={form.valor}
                  onChange={(e) => set("valor", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="editar-titulo-emissao">Emissão</Label>
                <Input
                  id="editar-titulo-emissao"
                  type="date"
                  value={form.data_emissao}
                  onChange={(e) => set("data_emissao", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="editar-titulo-vencimento">Vencimento</Label>
                <Input
                  id="editar-titulo-vencimento"
                  type="date"
                  value={form.vencimento}
                  onChange={(e) => set("vencimento", e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="editar-titulo-categoria">Categoria</Label>
                <select
                  id="editar-titulo-categoria"
                  className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
                  disabled={q.data.vinculado || categorias.isPending || categorias.isError}
                  value={form.categoria_id}
                  onChange={(e) => set("categoria_id", e.target.value)}
                >
                  <option value="">Sem categoria</option>
                  {form.categoria_id &&
                    !categorias.data?.some((x) => x.id === form.categoria_id) && (
                      <option value={form.categoria_id}>Categoria atual</option>
                    )}
                  {categorias.data?.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nome}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="editar-titulo-descricao">Descrição</Label>
                <Input
                  id="editar-titulo-descricao"
                  maxLength={2000}
                  value={form.descricao}
                  onChange={(e) => set("descricao", e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="editar-titulo-observacao">Observações</Label>
                <Textarea
                  id="editar-titulo-observacao"
                  maxLength={4000}
                  value={form.observacao}
                  onChange={(e) => set("observacao", e.target.value)}
                />
              </div>
            </fieldset>
            {q.data.vinculado && (
              <p className="text-sm text-muted-foreground">
                Título vinculado a pedido, compra ou acordo: valor e categoria devem ser corrigidos
                na origem.
              </p>
            )}
            {erro && (
              <p role="alert" className="text-sm text-destructive">
                {erro}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={salvar.isPending} onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvar.isPending}>
                Salvar alterações
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
