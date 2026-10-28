import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSupabase } from "@/lib/supabase-provider";
import { useCentrosPermitidos } from "@/lib/centros-acesso";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";

const campos = [
  ["razao_social", "Razão social / Nome", true],
  ["cnpj_cpf", "CPF / CNPJ", true],
  ["nome_fantasia", "Nome fantasia"],
  ["inscricao_estadual", "Inscrição estadual"],
  ["email", "E-mail"],
  ["telefone", "Telefone"],
  ["cep", "CEP"],
  ["logradouro", "Logradouro"],
  ["numero", "Número"],
  ["complemento", "Complemento"],
  ["bairro", "Bairro"],
  ["cidade", "Cidade"],
  ["uf", "UF"],
  ["codigo_ibge", "Código IBGE da cidade"],
  ["observacoes", "Observações"],
] as const;

export function CadastrarClienteRepresentante() {
  const { client, user } = useSupabase();
  const centros = useCentrosPermitidos();
  const perm = usePermissoesRotinas();
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const rotas = useQuery({
    queryKey: ["rotas-cadastro-cliente", user?.id],
    enabled: !!client && aberto && perm.pode("clientes_cadastrar"),
    queryFn: async () => {
      const result = await client!.rpc("rotas_cadastro_representante_284");
      if (result.error) throw new Error("Não foi possível carregar suas rotas.");
      return result.data as { id: string; nome: string }[];
    },
  });
  const salvar = useMutation({
    mutationFn: async () => {
      const result = await client!.rpc("cadastrar_cliente_representante_284", { _dados: form });
      if (result.error) throw new Error(result.error.message);
    },
    onSuccess: () => {
      toast.success(
        "Cliente cadastrado na sua carteira. Aguarde o administrador liberar o limite.",
      );
      setAberto(false);
      setForm({});
      for (const key of [
        ["pessoas"],
        ["clientes"],
        ["painel-representante"],
        ["clientes-credito-pendente"],
      ])
        void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!perm.pode("clientes_cadastrar")) return null;
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));
  return (
    <section className="mb-5 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">Novos clientes da minha carteira</h2>
      <p className="my-2 text-sm text-muted-foreground">
        Você pode cadastrar clientes nas suas lojas e rotas. O limite será definido pelo
        administrador; até a liberação, o cliente fica bloqueado para aprovação e confirmação de
        pedidos.
      </p>
      <Button onClick={() => setAberto(true)}>Cadastrar novo cliente</Button>
      <Dialog
        open={aberto}
        onOpenChange={(value) => {
          if (!salvar.isPending) setAberto(value);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Cadastrar cliente</DialogTitle>
            <DialogDescription>
              O vínculo com seu representante é automático. Não há liberação de crédito nesta tela.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              salvar.mutate();
            }}
            className="space-y-4"
          >
            <fieldset disabled={salvar.isPending} className="grid gap-4 sm:grid-cols-2">
              {campos.map(([key, label, required]) => (
                <div className="space-y-1" key={key}>
                  <Label htmlFor={`novo-cliente-${key}`}>
                    {label}
                    {required ? " *" : ""}
                  </Label>
                  <Input
                    id={`novo-cliente-${key}`}
                    type={key === "email" ? "email" : "text"}
                    required={!!required}
                    maxLength={key === "observacoes" ? 2000 : 250}
                    value={form[key] ?? ""}
                    onChange={(e) => set(key, e.target.value)}
                  />
                </div>
              ))}
              <div className="space-y-1">
                <Label htmlFor="novo-cliente-loja">Loja *</Label>
                <select
                  id="novo-cliente-loja"
                  required
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={form["centro_id"] ?? ""}
                  onChange={(e) => set("centro_id", e.target.value)}
                >
                  <option value="">Selecione</option>
                  {centros.lista.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="novo-cliente-rota">Rota *</Label>
                <select
                  id="novo-cliente-rota"
                  required
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={form["rota_id"] ?? ""}
                  onChange={(e) => set("rota_id", e.target.value)}
                >
                  <option value="">Selecione</option>
                  {rotas.data?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nome}
                    </option>
                  ))}
                </select>
              </div>
            </fieldset>
            {(rotas.error || centros.error) && (
              <p role="alert" className="text-sm text-destructive">
                {(rotas.error || centros.error)?.message}
              </p>
            )}
            {rotas.data?.length === 0 && (
              <p className="text-sm">
                Peça ao administrador para vincular suas rotas antes de cadastrar clientes.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={salvar.isPending}
                onClick={() => setAberto(false)}
              >
                Voltar
              </Button>
              <Button
                type="submit"
                disabled={salvar.isPending || !rotas.data?.length || !centros.lista.length}
              >
                {salvar.isPending ? "Cadastrando…" : "Cadastrar e aguardar liberação"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function CreditosClientesPendentes() {
  const { client, user } = useSupabase();
  const qc = useQueryClient();
  const [pagina, setPagina] = useState(0);
  const [alvo, setAlvo] = useState<{ id: string; razao_social: string } | null>(null);
  const [limite, setLimite] = useState("");
  const q = useQuery({
    queryKey: ["clientes-credito-pendente", user?.id, pagina],
    enabled: !!client,
    refetchInterval: 60_000,
    queryFn: async () => {
      const r = await client!
        .from("pessoas")
        .select("id,razao_social,cnpj_cpf,created_at", { count: "exact" })
        .eq("credito_pendente", true)
        .order("created_at")
        .order("id")
        .range(pagina * 20, pagina * 20 + 19);
      if (r.error) throw new Error("Não foi possível carregar os clientes com crédito pendente.");
      return {
        rows: r.data as { id: string; razao_social: string; cnpj_cpf: string }[],
        count: r.count ?? 0,
      };
    },
  });
  const liberar = useMutation({
    mutationFn: async () => {
      const valor = Number(limite);
      if (!alvo || !Number.isFinite(valor) || valor <= 0)
        throw new Error("Informe um limite positivo.");
      const r = await client!.rpc("liberar_credito_cliente_284", {
        _pessoa: alvo.id,
        _limite: valor,
      });
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: () => {
      toast.success("Limite liberado. Cliente disponível para pedidos.");
      setPagina(0);
      setAlvo(null);
      setLimite("");
      for (const key of [
        ["clientes-credito-pendente"],
        ["pessoas"],
        ["clientes"],
        ["painel-representante"],
      ])
        void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <section className="mb-5 space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">
        Clientes aguardando liberação de limite{q.data ? ` · ${q.data.count}` : ""}
      </h2>
      <p className="text-sm text-muted-foreground">
        Cadastros feitos por representantes ficam com limite zero e bloqueados até esta liberação.
        Apenas administradores podem definir o valor.
      </p>
      {q.error && (
        <p role="alert" className="text-sm text-destructive">
          {q.error.message}
        </p>
      )}
      {q.isPending && <p className="text-sm">Carregando…</p>}
      {q.data?.count === 0 && <p className="text-sm">Nenhum cliente aguardando liberação.</p>}
      {q.data?.rows.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div>
            <Link
              className="text-sm font-medium text-primary underline"
              to="/pessoas"
              search={{ pessoa: p.id }}
            >
              {p.razao_social}
            </Link>
            <p className="text-xs text-muted-foreground">{p.cnpj_cpf}</p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setAlvo(p);
              setLimite("");
            }}
          >
            Definir limite e liberar
          </Button>
        </div>
      ))}
      {!!q.data?.count && (
        <div className="flex items-center gap-3 text-sm">
          <Button variant="outline" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>
            Anterior
          </Button>
          Página {pagina + 1}
          <Button
            variant="outline"
            disabled={(pagina + 1) * 20 >= q.data.count}
            onClick={() => setPagina((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      )}
      <Dialog
        open={!!alvo}
        onOpenChange={(value) => {
          if (!value && !liberar.isPending) setAlvo(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Liberar limite de crédito</DialogTitle>
            <DialogDescription>
              {alvo?.razao_social}. Confira o cadastro antes de liberar. O valor ficará disponível
              para as regras de crédito dos pedidos.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              liberar.mutate();
            }}
          >
            <Label htmlFor="limite-cliente">Limite autorizado (R$)</Label>
            <Input
              id="limite-cliente"
              type="number"
              min="0.01"
              step="0.01"
              required
              value={limite}
              disabled={liberar.isPending}
              onChange={(e) => setLimite(e.target.value)}
            />
            <Button type="submit" disabled={liberar.isPending}>
              {liberar.isPending ? "Liberando…" : "Confirmar limite e liberar cliente"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
