import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, ChevronDown, FileText, Layers3, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { useSupabase } from "@/lib/supabase-provider";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { brl, dataBr } from "@/lib/formatacao";
import { lerPaginas } from "@/lib/paginacao";
import {
  previsaoTitulo,
  subcategoriasTitulo,
  valorTitulo,
  type CategoriaTitulo,
} from "@/lib/lancamento-titulo";

type Opcao = { id: string; nome: string };
const selectCls =
  "h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50";
export function NovoTituloDialog({
  receber,
  lojas,
  lojaInicial,
  parceiros,
  parceirosCarregando,
  parceirosErro,
  onClose,
  onCreated,
}: {
  receber: boolean;
  lojas: Opcao[];
  lojaInicial: string;
  parceiros: Opcao[];
  parceirosCarregando: boolean;
  parceirosErro: string | undefined;
  onClose: () => void;
  onCreated: (loja: string, parcelas: number) => void;
}) {
  const { client, user } = useSupabase();
  const [form, setForm] = useState({
    loja: lojas.some((l) => l.id === lojaInicial) ? lojaInicial : "",
    parceiro: "",
    documento: "",
    valor: "",
    vencimento: hojeSaoPaulo(),
    categoria: "",
    subcategoria: "",
    observacao: "",
    parcelas: "1",
    intervalo: "30",
  });
  const [parcelar, setParcelar] = useState(false),
    [erro, setErro] = useState("");
  const set = (key: keyof typeof form, v: string) => {
    setForm((s) => ({ ...s, [key]: v, ...(key === "categoria" ? { subcategoria: "" } : {}) }));
    setErro("");
  };
  const categorias = useQuery({
    queryKey: ["categorias_financeiras", "lancamento", user?.id, receber],
    enabled: !!client,
    queryFn: () =>
      lerPaginas<CategoriaTitulo>((a, b) =>
        client!
          .from("categorias_financeiras")
          .select("id,nome,parent_id,tipo,ativo")
          .eq("ativo", true)
          .eq("tipo", receber ? "receita" : "despesa")
          .order("ordem")
          .order("nome")
          .order("id")
          .range(a, b),
      ),
  });
  const principais = (categorias.data ?? []).filter((c) => !c.parent_id),
    subs = subcategoriasTitulo(categorias.data ?? [], form.categoria);
  const valor = valorTitulo(form.valor),
    quantidade = parcelar ? Number(form.parcelas) : 1,
    intervalo = parcelar ? Number(form.intervalo) : 30;
  const previa = previsaoTitulo(valor, quantidade, form.vencimento, intervalo);
  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.loja || !lojas.some((l) => l.id === form.loja))
        throw Error("Selecione a loja do lançamento.");
      if (!form.parceiro || !parceiros.some((p) => p.id === form.parceiro))
        throw Error(`Selecione o ${receber ? "cliente" : "fornecedor"}.`);
      if (!form.documento.trim()) throw Error("Informe o número do documento.");
      if (!Number.isFinite(valor) || valor <= 0)
        throw Error("Informe um valor válido, como 1.234,56.");
      if (!previa)
        throw Error(
          "Confira o vencimento, o número de parcelas e o intervalo. Todas as parcelas devem ter valor positivo.",
        );
      if (!principais.some((c) => c.id === form.categoria)) throw Error("Selecione a categoria.");
      if (subs.length && !subs.some((c) => c.id === form.subcategoria))
        throw Error("Selecione a subcategoria.");
      const r = await client!.rpc(receber ? "criar_receita" : "criar_despesa", {
        [receber ? "_cliente_id" : "_fornecedor_id"]: form.parceiro,
        _centro_id: form.loja,
        _documento: form.documento.trim(),
        _valor: valor,
        _primeiro_vencimento: form.vencimento,
        _categoria_id: form.subcategoria || form.categoria,
        _descricao: form.observacao.trim() || null,
        _parcelas: quantidade,
        _intervalo_dias: intervalo,
        _forma_id: null,
        _conta_id: null,
      });
      if (r.error) throw Error(r.error.message);
    },
    onSuccess: () => onCreated(form.loja, quantidade),
    onError: (e: Error) => {
      setErro(e.message);
      toast.error(e.message);
    },
  });
  const ocupado = salvar.isPending;
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !ocupado) onClose();
      }}
    >
      <DialogContent className="flex h-[min(56rem,92dvh)] max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-3xl sm:rounded-2xl sm:p-0">
        <DialogHeader className="shrink-0 border-b bg-primary/[0.04] px-5 py-5 text-left sm:px-7">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary">
            <Wallet className="size-4" />
            Financeiro · Lançamento manual
          </div>
          <DialogTitle className="text-xl">
            Nova conta a {receber ? "receber" : "pagar"}
          </DialogTitle>
          <DialogDescription>
            Organize o lançamento por loja e classifique {receber ? "a receita" : "a despesa"}. O
            banco será escolhido na baixa.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          onSubmit={(e) => {
            e.preventDefault();
            salvar.mutate();
          }}
        >
          <div
            data-lancamento-scroll
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
          >
            <fieldset disabled={ocupado} className="min-w-0 space-y-5 px-5 py-5 sm:px-7">
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">
                    1
                  </span>
                  Origem do lançamento
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="titulo-loja">
                    Loja <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Building2 className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
                    <select
                      autoFocus
                      required
                      id="titulo-loja"
                      className={selectCls + " pl-9"}
                      value={form.loja}
                      onChange={(e) => set("loja", e.target.value)}
                    >
                      <option value="">Selecione a loja</option>
                      {lojas.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.nome}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="titulo-parceiro">
                    {receber ? "Cliente" : "Fornecedor"} <span className="text-destructive">*</span>
                  </Label>
                  <select
                    required
                    id="titulo-parceiro"
                    className={selectCls}
                    disabled={!form.loja || parceirosCarregando || !!parceirosErro}
                    value={form.parceiro}
                    onChange={(e) => set("parceiro", e.target.value)}
                  >
                    <option value="">
                      {!form.loja
                        ? "Escolha a loja primeiro"
                        : parceirosCarregando
                          ? "Carregando…"
                          : `Selecione o ${receber ? "cliente" : "fornecedor"}`}
                    </option>
                    {parceiros.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </select>
                  {parceirosErro && (
                    <p role="alert" className="text-xs text-destructive">
                      {parceirosErro}
                    </p>
                  )}
                </div>
              </section>
              <section className="space-y-4 rounded-2xl border bg-muted/20 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">
                    2
                  </span>
                  Documento e vencimento
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="titulo-documento">Número do documento *</Label>
                    <Input
                      required
                      id="titulo-documento"
                      className="h-11 rounded-xl"
                      placeholder="Ex.: NF 12345"
                      value={form.documento}
                      onChange={(e) => set("documento", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="titulo-valor">Valor total (R$) *</Label>
                    <Input
                      required
                      id="titulo-valor"
                      className="h-11 rounded-xl tabular-nums"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0,00"
                      value={form.valor}
                      onChange={(e) => set("valor", e.target.value)}
                      onBlur={() => {
                        if (Number.isFinite(valor)) set("valor", brl(valor).replace(/^R\$\s*/, ""));
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="titulo-vencimento">
                      {parcelar ? "Primeiro vencimento" : "Vencimento"} *
                    </Label>
                    <Input
                      required
                      id="titulo-vencimento"
                      className="h-11 w-full min-w-0 rounded-xl"
                      type="date"
                      value={form.vencimento}
                      onChange={(e) => set("vencimento", e.target.value)}
                    />
                  </div>
                </div>
              </section>
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">
                    3
                  </span>
                  Classificação {receber ? "da receita" : "da despesa"}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="titulo-categoria">Categoria *</Label>
                    <select
                      required
                      id="titulo-categoria"
                      className={selectCls}
                      disabled={categorias.isPending || categorias.isError}
                      value={form.categoria}
                      onChange={(e) => set("categoria", e.target.value)}
                    >
                      <option value="">
                        {categorias.isPending ? "Carregando…" : "Selecione a categoria"}
                      </option>
                      {principais.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="titulo-subcategoria">
                      Subcategoria{subs.length ? " *" : ""}
                    </Label>
                    <select
                      required={subs.length > 0}
                      id="titulo-subcategoria"
                      className={selectCls}
                      disabled={!form.categoria || !subs.length}
                      value={form.subcategoria}
                      onChange={(e) => set("subcategoria", e.target.value)}
                    >
                      <option value="">
                        {!form.categoria
                          ? "Escolha a categoria primeiro"
                          : !subs.length
                            ? "Sem subcategorias cadastradas"
                            : "Selecione a subcategoria"}
                      </option>
                      {subs.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {categorias.error && (
                  <p role="alert" className="text-sm text-destructive">
                    Não foi possível carregar as categorias: {categorias.error.message}
                  </p>
                )}
                {categorias.data && !principais.length && (
                  <p className="text-xs text-amber-700">
                    Cadastre uma categoria de {receber ? "receita" : "despesa"} em Categorias de
                    despesas e receitas para continuar.
                  </p>
                )}
              </section>
              <details className="rounded-xl border bg-muted/15 p-3">
                <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <Layers3 className="size-4 text-primary" />
                  Parcelamento{" "}
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    Opcional
                  </span>
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                </summary>
                <div className="mt-4 space-y-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={parcelar}
                      onChange={(e) => {
                        setParcelar(e.target.checked);
                        if (e.target.checked && Number(form.parcelas) < 2) set("parcelas", "2");
                        setErro("");
                      }}
                    />
                    Dividir em parcelas
                  </label>
                  {parcelar && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="titulo-parcelas">Número de parcelas</Label>
                        <Input
                          id="titulo-parcelas"
                          className="h-11"
                          type="number"
                          min="2"
                          step="1"
                          value={form.parcelas}
                          onChange={(e) => set("parcelas", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="titulo-intervalo">Intervalo entre parcelas (dias)</Label>
                        <Input
                          id="titulo-intervalo"
                          className="h-11"
                          type="number"
                          min="1"
                          step="1"
                          value={form.intervalo}
                          onChange={(e) => set("intervalo", e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </details>
              <div className="space-y-1.5">
                <Label htmlFor="titulo-observacao">
                  Observação <span className="font-normal text-muted-foreground">(opcional)</span>
                </Label>
                <Textarea
                  id="titulo-observacao"
                  className="min-h-20 resize-y rounded-xl"
                  placeholder={
                    receber
                      ? "Detalhes sobre a receita ou instruções para o recebimento…"
                      : "Detalhes sobre a despesa ou instruções para o pagamento…"
                  }
                  value={form.observacao}
                  onChange={(e) => set("observacao", e.target.value)}
                />
              </div>
              {erro && (
                <p
                  role="alert"
                  className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {erro}
                </p>
              )}
            </fieldset>
          </div>
          <div className="shrink-0 border-t bg-background px-5 py-4 sm:px-7">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <FileText className="size-4" />
                {previa
                  ? `${previa.parcelas} ${previa.parcelas === 1 ? "título" : "títulos"} · ${dataBr(previa.inicio)}${previa.parcelas > 1 ? ` a ${dataBr(previa.fim)}` : ""}`
                  : "Confira os dados do lançamento"}
              </div>
              <strong className="text-lg tabular-nums">
                {brl(Number.isFinite(valor) ? valor : 0)}
              </strong>
            </div>
            {previa && previa.parcelas > 1 && (
              <p className="mb-3 text-xs text-muted-foreground">
                Primeira parcela: {brl(previa.primeira)} · última: {brl(previa.ultima)}. O ajuste de
                centavos fica na última parcela.
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" disabled={ocupado} onClick={onClose}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={ocupado || categorias.isPending || categorias.isError || !!parceirosErro}
              >
                {ocupado ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Wallet className="size-4" />
                )}
                {ocupado ? "Salvando…" : `Lançar ${receber ? "conta a receber" : "conta a pagar"}`}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
