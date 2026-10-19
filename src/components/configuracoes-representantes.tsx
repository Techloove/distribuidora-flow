import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useSupabase } from "@/lib/supabase-provider";
import { lerPaginas } from "@/lib/paginacao";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

type Configuracao = {
  representante_id: string;
  usuario_id: string;
  nome: string;
  comissao_percentual: number;
  comissao_confirmada: boolean;
  centros: string[];
  pendencias: string[];
};
type Centro = { id: string; nome: string };
export function ConfiguracoesRepresentantes() {
  const { client, roles, user } = useSupabase();
  const qc = useQueryClient();
  const [alvo, setAlvo] = useState<Configuracao | null>(null);
  const [centros, setCentros] = useState<string[]>([]);
  const [comissao, setComissao] = useState("");
  const [busca, setBusca] = useState("");
  const [soPendentes, setSoPendentes] = useState(true);
  const [pagina, setPagina] = useState(0);
  const admin = roles.includes("admin");
  const q = useQuery({
    queryKey: ["configuracoes-representantes", user?.id],
    enabled: !!client && admin,
    queryFn: () =>
      lerPaginas<Configuracao>((i, f) =>
        client!.rpc("admin_configuracoes_representantes_239").range(i, f),
      ),
  });
  const opcoes = useQuery({
    queryKey: ["configuracoes-representantes-centros", user?.id],
    enabled: !!client && admin && !!alvo,
    queryFn: () =>
      lerPaginas<Centro>((i, f) =>
        client!
          .from("centros")
          .select("id,nome")
          .eq("ativo", true)
          .order("nome")
          .order("id")
          .range(i, f),
      ),
  });
  const salvar = useMutation({
    mutationFn: async () => {
      if (!alvo || !comissao.trim() || !Number.isFinite(Number(comissao.replace(",", "."))))
        throw new Error("Defina a comissão. Informe 0 quando não houver comissão.");
      const { error } = await client!.rpc("admin_configurar_representante_239", {
        _representante: alvo.representante_id,
        _centros: centros,
        _comissao: Number(comissao.replace(",", ".")),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Centros e comissão confirmados pelo administrador.");
      setAlvo(null);
      await Promise.all(
        [
          "configuracoes-representantes",
          "pendencias",
          "representantes",
          "pessoas",
          "usuario_centros",
          "profiles",
          "cadastro-opcoes",
        ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!admin) return null;
  const rows = (q.data ?? []).filter(
    (r) =>
      (!soPendentes || r.pendencias.length > 0) &&
      r.nome.toLocaleLowerCase("pt-BR").includes(busca.toLocaleLowerCase("pt-BR")),
  );
  const currentPage = Math.min(pagina, Math.max(0, Math.ceil(rows.length / 10) - 1));
  return (
    <section
      className="space-y-4 rounded-2xl border bg-card p-4 sm:p-6"
      aria-label="Configuração dos representantes"
    >
      <div>
        <h2 className="font-semibold">Centros de custo e comissão dos representantes</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Definição obrigatória do administrador. A confirmação de 0% registra que não há comissão.
          Alterar o percentual pelo Cadastro Unificado exige nova confirmação aqui.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="max-w-sm"
          aria-label="Buscar representante para configurar"
          placeholder="Buscar representante"
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            setPagina(0);
          }}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={soPendentes}
            onChange={(e) => {
              setSoPendentes(e.target.checked);
              setPagina(0);
            }}
          />
          Somente pendentes
        </label>
        <Button variant="outline" disabled={q.isFetching} onClick={() => void q.refetch()}>
          Atualizar
        </Button>
      </div>
      {q.isPending && <p role="status">Carregando configurações…</p>}
      {q.isError && (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar as configurações. Confira se a fase239 foi aplicada e tente
          novamente.
        </p>
      )}
      {!q.isPending && !q.isError && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum representante neste filtro.</p>
      )}
      <div className="divide-y">
        {rows.slice(currentPage * 10, currentPage * 10 + 10).map((r) => (
          <article
            key={r.representante_id}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <p className="font-medium">{r.nome}</p>
              <p
                className={`text-sm ${r.pendencias.length ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}
              >
                {r.pendencias.length
                  ? r.pendencias.join(" · ")
                  : `Configuração confirmada · comissão ${Number(r.comissao_percentual).toLocaleString("pt-BR")}%`}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setAlvo(r);
                setCentros(r.centros);
                setComissao(String(r.comissao_percentual ?? ""));
              }}
            >
              {r.pendencias.length ? "Definir configuração" : "Revisar configuração"}
            </Button>
          </article>
        ))}
      </div>
      {rows.length > 10 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={currentPage === 0}
            onClick={() => setPagina(currentPage - 1)}
          >
            Anterior
          </Button>
          <span className="text-sm">
            Página {currentPage + 1} · {rows.length} representantes
          </span>
          <Button
            variant="outline"
            disabled={(currentPage + 1) * 10 >= rows.length}
            onClick={() => setPagina(currentPage + 1)}
          >
            Próxima
          </Button>
        </div>
      )}
      <Dialog
        open={!!alvo}
        onOpenChange={(open) => {
          if (!open && !salvar.isPending) setAlvo(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Definir centros e comissão</DialogTitle>
            <DialogDescription>
              {alvo?.nome}. A configuração altera as permissões por centro e a comissão padrão das
              próximas operações; não recalcula comissões já geradas.
            </DialogDescription>
          </DialogHeader>
          <fieldset
            disabled={salvar.isPending || opcoes.isPending || opcoes.isError}
            className="space-y-3"
          >
            <legend className="text-sm font-medium">
              Centros de custo permitidos (obrigatório)
            </legend>
            {opcoes.data?.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={centros.includes(c.id)}
                  onChange={(e) =>
                    setCentros((s) =>
                      e.target.checked ? [...s, c.id] : s.filter((id) => id !== c.id),
                    )
                  }
                />
                {c.nome}
              </label>
            ))}
          </fieldset>
          {opcoes.isError && (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível consultar centros ativos.
            </p>
          )}
          <Label htmlFor="config-comissao">Comissão padrão (%) — obrigatória</Label>
          <Input
            id="config-comissao"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={comissao}
            disabled={salvar.isPending}
            onChange={(e) => setComissao(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Ao confirmar 0%, você declara que o representante não recebe comissão.
          </p>
          <Button
            disabled={
              salvar.isPending ||
              opcoes.isPending ||
              opcoes.isError ||
              !centros.length ||
              !comissao.trim() ||
              Number(comissao) < 0 ||
              Number(comissao) > 100
            }
            onClick={() => salvar.mutate()}
          >
            Confirmar centros e comissão
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
