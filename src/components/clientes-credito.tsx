import { ConsultaClienteRepresentante } from "@/components/consulta-cliente-representante";
import { preencherCadastroRepresentante } from "@/lib/consulta-cliente-representante";
import { SearchSelect } from "@/components/ui/search-select";
import { useState, useRef, type FormEvent } from "react";
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
  ["observacoes", "Observações"],
] as const;

export function CadastrarClienteRepresentante() {
  const { client } = useSupabase();
  const centros = useCentrosPermitidos();
  const perm = usePermissoesRotinas();
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [consultaPendente, setConsultaPendente] = useState(false);
  const preenchidosConsulta = useRef<Record<string, string>>({});
  const salvar = useMutation({
    mutationFn: async () => {
      if (consultaPendente) throw new Error("Aguarde a consulta terminar antes de cadastrar.");
      const loja = form["centro_id"] || (centros.lista.length === 1 ? centros.lista[0]!.id : "");
      if (!loja) throw new Error("Selecione uma loja permitida.");
      const result = await client!.rpc("cadastrar_cliente_representante_284", {
        _dados: { ...form, centro_id: loja },
      });
      if (result.error) throw new Error(result.error.message);
    },
    onSuccess: () => {
      toast.success(
        "Cliente cadastrado e enviado para revisão. O administrador definirá a rota e liberará o cadastro; você já pode preparar o pedido.",
      );
      setAberto(false);
      setForm({});
      preenchidosConsulta.current = {};
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
  const set = (key: string, value: string) => {
    const preenchidos = { ...preenchidosConsulta.current };
    if (
      key === "cnpj_cpf" &&
      value.replace(/\D/g, "") !== (form["cnpj_cpf"] ?? "").replace(/\D/g, "")
    )
      preenchidosConsulta.current = {};
    setForm((f) => {
      if (
        key === "cnpj_cpf" &&
        value.replace(/\D/g, "") !== (f["cnpj_cpf"] ?? "").replace(/\D/g, "")
      ) {
        const limpo = { ...f };
        for (const [campo, anterior] of Object.entries(preenchidos))
          if (limpo[campo] === anterior) limpo[campo] = "";
        return { ...limpo, [key]: value };
      }
      return { ...f, [key]: value };
    });
  };
  return (
    <section className="mb-5 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">Novos clientes da minha carteira</h2>
      <p className="my-2 text-sm text-muted-foreground">
        Informe os dados do cliente e a loja em que você pode atender. Sua carteira será vinculada
        automaticamente; rota e limite serão revisados pelo administrador. Você já pode preencher,
        imprimir e enviar pedidos para aprovação de cadastro; a aprovação e confirmação da venda
        aguardam a liberação do cliente.
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
              Preencha os dados que você conhece. Apenas nome, CPF/CNPJ e loja são obrigatórios.
              Rota, crédito e aprovação ficam com o administrador.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              salvar.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-1">
              <Label htmlFor="novo-cliente-cnpj_cpf">CPF / CNPJ *</Label>
              <Input
                id="novo-cliente-cnpj_cpf"
                inputMode="numeric"
                required
                maxLength={18}
                placeholder="Comece informando o CPF ou CNPJ"
                disabled={salvar.isPending}
                value={form["cnpj_cpf"] ?? ""}
                onChange={(e) => set("cnpj_cpf", e.target.value)}
              />
            </div>
            <ConsultaClienteRepresentante
              documento={form["cnpj_cpf"] ?? ""}
              inscricao={form["inscricao_estadual"] ?? ""}
              ativo={aberto}
              disabled={salvar.isPending}
              ocupado={setConsultaPendente}
              preencher={(documento, dados) =>
                setForm((f) => {
                  const patch = preencherCadastroRepresentante(f, documento, dados);
                  preenchidosConsulta.current = { ...preenchidosConsulta.current, ...patch };
                  return { ...f, ...patch };
                })
              }
              aplicarIe={(documento, inscricao, somenteVazio) =>
                setForm((f) => {
                  if ((f["cnpj_cpf"] ?? "").replace(/\D/g, "") !== documento) return f;
                  if (somenteVazio && (f["inscricao_estadual"] ?? "").trim()) return f;
                  preenchidosConsulta.current["inscricao_estadual"] = inscricao;
                  return { ...f, inscricao_estadual: inscricao };
                })
              }
            />
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
                <SearchSelect
                  id="novo-cliente-loja"
                  required
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={
                    form["centro_id"] || (centros.lista.length === 1 ? centros.lista[0]!.id : "")
                  }
                  onChange={(e) => set("centro_id", e.target.value)}
                >
                  <option value="">Selecione</option>
                  {centros.lista.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </SearchSelect>
              </div>
            </fieldset>
            {centros.error && (
              <p role="alert" className="text-sm text-destructive">
                {centros.error.message}
              </p>
            )}
            {!centros.isLoading && !centros.error && !centros.lista.length && (
              <p role="status" className="text-sm">
                Nenhuma loja foi liberada para sua conta. Peça ao administrador para definir sua
                loja de atendimento.
              </p>
            )}
            <p className="rounded-xl border bg-muted/30 p-3 text-sm">
              O cadastro será enviado automaticamente para aprovação. A rota de entrega será
              definida pelo administrador, sem precisar acessar o módulo de rotas.
            </p>
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
                disabled={
                  salvar.isPending ||
                  consultaPendente ||
                  centros.isLoading ||
                  !!centros.error ||
                  !centros.lista.length
                }
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
  const [pagina, setPagina] = useState(0);
  const q = useQuery({
    queryKey: ["clientes-credito-pendente", user?.id, pagina],
    enabled: !!client,
    refetchInterval: 60_000,
    queryFn: async () => {
      const r = await client!
        .from("pessoas")
        .select("id,razao_social,cnpj_cpf,created_at,rota_id", { count: "exact" })
        .eq("credito_pendente", true)
        .order("created_at")
        .order("id")
        .range(pagina * 20, pagina * 20 + 19);
      if (r.error) throw new Error("Não foi possível carregar os clientes com crédito pendente.");
      return {
        rows: r.data as {
          id: string;
          razao_social: string;
          cnpj_cpf: string;
          rota_id: string | null;
        }[],
        count: r.count ?? 0,
      };
    },
  });
  return (
    <section className="mb-5 space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">
        Clientes aguardando aprovação de cadastro e limite{q.data ? ` · ${q.data.count}` : ""}
      </h2>
      <p className="text-sm text-muted-foreground">
        Revise os cadastros feitos por representantes. Eles podem ter pedidos aguardando aprovação
        de cadastro. O limite permanece zero até a liberação. Apenas administradores podem definir o
        valor. Abra o cadastro completo para conferir identificação, contato, endereço, rota e
        limite antes de salvar.
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
            {!p.rota_id && (
              <p className="text-xs text-amber-800">
                Rota pendente: abra o cadastro para definir antes de liberar.
              </p>
            )}
          </div>
          <Button variant="outline" asChild>
            <Link to="/pessoas" search={{ pessoa: p.id }} reloadDocument>
              Revisar cadastro e liberar limite
            </Link>
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
    </section>
  );
}
