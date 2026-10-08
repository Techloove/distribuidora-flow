import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "./supabase-provider";
import { useCentroValido } from "./centros-acesso";
import { useAcesso } from "./permissoes";
import { hojeSaoPaulo } from "./painel-trabalho";
export type Pendencia = {
  id: string;
  titulo: string;
  detalhe: string;
  categoria: string;
  prioridade: "alta" | "normal";
  to: string;
  pedido?: string;
  centro?: string;
};
type Row = Record<string, unknown>;
export function usePendencias() {
  const { client, user, roles } = useSupabase();
  const { centro, isLoading, error } = useCentroValido();
  const acesso = useAcesso();
  const today = hojeSaoPaulo();
  const kinds = [
    {
      id: "aprovacao",
      label: "Pedidos aguardando aprovação",
      table: "pedidos" as const,
      module: "/pedidos",
      statuses: ["aguardando_aprovacao"],
      high: true,
    },
    {
      id: "rascunho",
      label: "Pedidos em rascunho",
      table: "pedidos" as const,
      module: "/pedidos",
      statuses: ["rascunho", "digitacao"],
      high: false,
    },
    {
      id: "boleto",
      label: "Boletos com erro",
      table: "boletos" as const,
      module: "/boletos",
      statuses: ["erro"],
      high: true,
    },
    {
      id: "vencimento",
      label: "Vencimentos sem confirmação bancária",
      table: "sicredi_boleto_alteracoes" as const,
      module: "/boletos",
      statuses: ["incerto", "pendente", "enviado"],
      high: true,
    },
    {
      id: "vencido",
      label: "Parcelas vencidas",
      table: "contas_receber" as const,
      module: "/receber",
      statuses: ["aberto", "parcial"],
      high: true,
    },
    {
      id: "cadastro",
      label: "Clientes com cadastro incompleto",
      table: "clientes" as const,
      module: "/pessoas",
      statuses: [],
      high: false,
    },
    {
      id: "divergencia",
      label: "Divergências na separação",
      table: "vw_separacao" as const,
      module: "/separacao",
      statuses: [],
      high: true,
    },
  ].filter((k) => acesso.pode(k.module));
  return useQuery({
    queryKey: [
      "pendencias",
      user?.id,
      roles.slice().sort().join(","),
      centro,
      today,
      kinds.map((k) => k.id).join(","),
    ],
    enabled: !!client && !!user && !isLoading && !error && !acesso.carregando && !acesso.erro,
    staleTime: 30_000,
    queryFn: async () => {
      const results = await Promise.all(
        kinds.map(async (k) => {
          let q = client!.from(k.table).select("*", { count: "exact" }).limit(40);
          if (centro && k.id !== "cadastro") q = q.eq("centro_id", centro);
          if (k.statuses.length) q = q.in(k.id === "vencimento" ? "estado" : "status", k.statuses);
          if (k.id === "vencido") q = q.lt("vencimento", today).order("vencimento");
          if (k.id === "cadastro") {
            const incompleto =
              'cnpj_cpf.is.null,cnpj_cpf.eq."",cidade.is.null,cidade.eq."",uf.is.null,uf.eq.""';
            q = q.or(
              centro
                ? `and(or(centro_id.eq.${centro},centro_id.is.null),or(${incompleto}))`
                : incompleto,
            );
          }
          if (k.id === "divergencia") q = q.eq("separacao_status", "divergente");
          const { data, error, count } = await q;
          if (error)
            return {
              id: k.id,
              label: k.label,
              total: null,
              itens: [] as Pendencia[],
              erro: `Não foi possível carregar ${k.label.toLowerCase()}.`,
            };
          const itens = ((data ?? []) as unknown as Row[]).map((r) => ({
            id: `${k.id}:${String(r["id"] ?? r["item_id"] ?? r["pedido_id"])}`,
            categoria: k.label,
            prioridade: k.high ? ("alta" as const) : ("normal" as const),
            to: k.module,
            titulo:
              k.id === "cadastro"
                ? String(r["razao_social"] ?? "Cliente")
                : k.module === "/pedidos" || k.id === "divergencia"
                  ? `Pedido #${String(r["numero"] ?? "—")}`
                  : String(r["documento"] ?? r["nosso_numero"] ?? "Parcela / boleto"),
            detalhe:
              k.id === "cadastro"
                ? "Confira documento, cidade e UF."
                : k.id === "vencimento"
                  ? `Alteração ${String(r["estado"])} · vencimento ${String(r["vencimento_novo"])}`
                  : String(
                      r["erro"] ??
                        r["divergencia_obs"] ??
                        (k.id === "vencido" ? `Vencimento ${r["vencimento"]}` : k.label),
                    ),
            ...(k.module === "/pedidos" ? { pedido: String(r["id"]) } : {}),
            centro: String(r["centro_id"] ?? ""),
          }));
          return { id: k.id, label: k.label, total: count ?? itens.length, itens, erro: null };
        }),
      );
      return {
        categorias: results,
        itens: results
          .flatMap((r) => r.itens)
          .sort((a, b) => Number(b.prioridade === "alta") - Number(a.prioridade === "alta")),
      };
    },
  });
}
