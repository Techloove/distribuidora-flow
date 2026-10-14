import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSupabase } from "@/lib/supabase-provider";
import { lerPaginas } from "@/lib/paginacao";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import type { Registro } from "@/lib/rotinas-distribuidora";

export function CadastrosRepresentantes() {
  const { client, roles, user } = useSupabase(),
    qc = useQueryClient();
  const isAdmin = roles.includes("admin");
  const [situacao, setSituacao] = useState("pendente"),
    [pagina, setPagina] = useState(0),
    [alvo, setAlvo] = useState<Registro | null>(null),
    [rep, setRep] = useState("novo"),
    [centros, setCentros] = useState<string[]>([]),
    [motivo, setMotivo] = useState("");
  const q = useQuery({
    queryKey: ["cadastros-representantes", user?.id, situacao, pagina],
    enabled: !!client && isAdmin,
    queryFn: async () => {
      const { data, count, error } = await client!
        .from("profiles")
        .select("id,nome,email,telefone,created_at,cadastro_status,cadastro_motivo", {
          count: "exact",
        })
        .eq("cadastro_status", situacao)
        .order("created_at")
        .order("id")
        .range(pagina * 50, pagina * 50 + 49);
      if (error)
        throw new Error(
          "Não foi possível carregar solicitações. Confira se a fase221 foi aplicada no Supabase.",
        );
      return { rows: (data ?? []) as Registro[], count };
    },
  });
  const opcoes = useQuery({
    queryKey: ["cadastro-opcoes", user?.id],
    enabled: !!client && isAdmin && !!alvo,
    queryFn: async () => {
      const [representantes, centros] = await Promise.all([
        lerPaginas<Registro>((i, f) =>
          client!
            .from("representantes")
            .select("id,nome,profile_id,ativo")
            .eq("ativo", true)
            .order("nome")
            .order("id")
            .range(i, f),
        ),
        lerPaginas<Registro>((i, f) =>
          client!
            .from("centros")
            .select("id,nome")
            .eq("ativo", true)
            .order("nome")
            .order("id")
            .range(i, f),
        ),
      ]);
      return { representantes, centros };
    },
  });
  useEffect(() => {
    if (!alvo || rep !== "novo") return;
    const vinculado = opcoes.data?.representantes.find((r) => r["profile_id"] === alvo["id"]);
    if (vinculado) setRep(String(vinculado["id"]));
  }, [alvo, opcoes.data, rep]);
  const decidir = useMutation({
    mutationFn: async (autorizar: boolean) => {
      if (!alvo || !isAdmin) throw new Error("Solicitação indisponível.");
      const { error } = await client!.rpc("admin_decidir_cadastro_221", {
        _usuario: alvo["id"],
        _autorizar: autorizar,
        _representante: rep === "novo" ? null : rep,
        _centros: centros,
        _motivo: motivo,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, autorizar) => {
      toast.success(autorizar ? "Cadastro autorizado como representante" : "Cadastro recusado");
      setAlvo(null);
      for (const key of [
        "cadastros-representantes",
        "profiles",
        "user_roles",
        "representantes",
        "usuario_centros",
        "cadastro-opcoes",
      ])
        void qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!isAdmin) return null;
  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <h2 className="font-semibold">Primeiros cadastros de representantes</h2>
      <p className="text-sm text-muted-foreground">
        Novos cadastros ficam sem acesso até a autorização. Vincule a carteira do representante e
        escolha os centros permitidos. Um novo representante começa sem clientes vinculados.
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Situação dos primeiros cadastros"
          className="rounded border bg-background p-2 text-sm"
          value={situacao}
          onChange={(e) => {
            setSituacao(e.target.value);
            setPagina(0);
          }}
        >
          <option value="pendente">Aguardando autorização</option>
          <option value="recusado">Recusados</option>
        </select>
        <Button variant="outline" disabled={q.isFetching} onClick={() => void q.refetch()}>
          Atualizar solicitações
        </Button>
      </div>
      {q.isPending && <p role="status">Carregando solicitações…</p>}
      {q.error && (
        <p role="alert" className="text-destructive text-sm">
          {q.error.message}
        </p>
      )}
      {q.data?.rows.map((p) => (
        <article
          key={String(p["id"])}
          className="flex flex-wrap items-center justify-between gap-3 border-b py-3"
        >
          <div className="min-w-0 text-sm">
            <strong>{String(p["nome"] || "Sem nome")}</strong>
            <p className="break-all">
              {String(p["email"] ?? "")} · {String(p["telefone"] ?? "Sem telefone")}
            </p>
            {!!p["cadastro_motivo"] && (
              <p className="text-xs text-muted-foreground">
                Motivo: {String(p["cadastro_motivo"])}
              </p>
            )}
          </div>
          <Button
            onClick={() => {
              setAlvo(p);
              setRep("novo");
              setCentros([]);
              setMotivo("");
            }}
          >
            Analisar cadastro
          </Button>
        </article>
      ))}
      {!q.isPending && !q.error && q.data?.rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma solicitação nesta situação.</p>
      )}
      {(q.data?.count ?? 0) > 50 && (
        <div className="flex gap-2 items-center">
          <Button
            variant="outline"
            disabled={pagina === 0 || q.isFetching}
            onClick={() => setPagina((p) => p - 1)}
          >
            Anterior
          </Button>
          <span className="text-sm">
            Página {pagina + 1} · {q.data?.count} solicitações
          </span>
          <Button
            variant="outline"
            disabled={(pagina + 1) * 50 >= (q.data?.count ?? 0) || q.isFetching}
            onClick={() => setPagina((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      )}
      <Dialog
        open={!!alvo}
        onOpenChange={(open) => {
          if (!open && !decidir.isPending) setAlvo(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Autorizar cadastro de representante</DialogTitle>
            <DialogDescription>
              {String(alvo?.["nome"] ?? "")} · {String(alvo?.["email"] ?? "")}. A confirmação do
              e-mail é necessária antes de autorizar.
            </DialogDescription>
          </DialogHeader>
          {opcoes.error && <p role="alert">{opcoes.error.message}</p>}
          <label className="text-sm">
            Carteira / representante
            <select
              aria-label="Representante para autorização"
              className="block w-full rounded border bg-background p-2"
              disabled={decidir.isPending || opcoes.isPending}
              value={rep}
              onChange={(e) => setRep(e.target.value)}
            >
              <option value="novo">Criar novo representante (sem carteira inicial)</option>
              {opcoes.data?.representantes
                .filter((r) => !r["profile_id"] || r["profile_id"] === alvo?.["id"])
                .map((r) => (
                  <option key={String(r["id"])} value={String(r["id"])}>
                    {String(r["nome"])}
                  </option>
                ))}
            </select>
          </label>
          <fieldset disabled={decidir.isPending} className="space-y-2">
            <legend className="text-sm font-medium">Centros de custo permitidos</legend>
            {opcoes.data?.centros.map((c) => (
              <label key={String(c["id"])} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={centros.includes(String(c["id"]))}
                  onChange={(e) =>
                    setCentros((s) =>
                      e.target.checked ? [...s, String(c["id"])] : s.filter((id) => id !== c["id"]),
                    )
                  }
                />
                {String(c["nome"])}
              </label>
            ))}
          </fieldset>
          <Button
            disabled={
              decidir.isPending || opcoes.isPending || opcoes.isError || centros.length === 0
            }
            onClick={() => decidir.mutate(true)}
          >
            Autorizar representante
          </Button>
          <div className="border-t pt-4 space-y-2">
            <label className="text-sm" htmlFor="recusa-cadastro">
              Justificativa para recusar
            </label>
            <Textarea
              id="recusa-cadastro"
              maxLength={1000}
              value={motivo}
              disabled={decidir.isPending}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={decidir.isPending || !motivo.trim()}
              onClick={() => decidir.mutate(false)}
            >
              Recusar cadastro
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
