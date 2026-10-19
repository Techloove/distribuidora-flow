import { camposFaltantesCliente } from "./pendencias-cadastro";
import { lerPaginas } from "./paginacao";
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
  pessoa?: string;
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
      label: "Pedidos em digitação",
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
    {
      id: "agenda",
      label: "Contatos comerciais atrasados",
      table: "acompanhamentos" as const,
      module: "/agenda-comercial",
      statuses: ["aberto"],
      high: false,
    },
    {
      id: "cobranca",
      label: "Ações de cobrança atrasadas",
      table: "acompanhamentos" as const,
      module: "/cobranca",
      statuses: ["aberto"],
      high: true,
    },
    {
      id: "comissao",
      label: "Ajustes de comissão a conferir",
      table: "comissao_ajustes" as const,
      module: "/comissoes",
      statuses: ["pendente"],
      high: true,
    },
    {
      id: "extrato",
      label: "Extrato sem conciliação",
      table: "extrato_bancario_linhas" as const,
      module: "/movimentacoes",
      statuses: [],
      high: false,
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
    refetchInterval: 60_000,
    queryFn: async () => {
      const results = await Promise.all(
        kinds.map(async (k) => {
          if (k.id === "cadastro") {
            try {
              const clientes = await lerPaginas<Row>((inicio, fim) => {
                let consulta = client!
                  .from("clientes")
                  .select(
                    "id,pessoa_id,codigo,razao_social,tipo_pessoa,cnpj_cpf,inscricao_estadual,indicador_contribuinte_icms,situacao_inscricao_estadual,rota_id,representante_id,logradouro,numero,bairro,cidade,uf,cep,centro_id,pessoa_fiscal:pessoas(indicador_contribuinte_icms,situacao_inscricao_estadual)",
                  );
                if (centro) consulta = consulta.or(`centro_id.eq.${centro},centro_id.is.null`);
                return consulta.order("razao_social").order("id").range(inicio, fim);
              });
              const incompletos = clientes
                .map((r) => ({ r, faltas: camposFaltantesCliente(r) }))
                .filter((c) => c.faltas.length);
              const itens: Pendencia[] = incompletos.slice(0, 40).map(({ r, faltas }) => ({
                id: `cadastro:${String(r["id"])}`,
                categoria: k.label,
                prioridade: "normal",
                to: "/pessoas",
                titulo: `${r["codigo"] ? `${String(r["codigo"])} · ` : ""}${String(r["razao_social"] ?? "Cliente")}`,
                detalhe: `Falta preencher: ${faltas.join("; ")}.`,
                centro: String(r["centro_id"] ?? ""),
                ...(r["pessoa_id"] ? { pessoa: String(r["pessoa_id"]) } : {}),
              }));
              return { id: k.id, label: k.label, total: incompletos.length, itens, erro: null };
            } catch {
              return {
                id: k.id,
                label: k.label,
                total: null,
                itens: [] as Pendencia[],
                erro: "Não foi possível conferir os cadastros dos clientes.",
              };
            }
          }
          let q = client!.from(k.table).select("*", { count: "exact" }).limit(40);
          if (centro && !["cadastro", "extrato", "agenda", "cobranca"].includes(k.id))
            q = q.eq("centro_id", centro);
          if (["agenda", "cobranca"].includes(k.id)) {
            q = q
              .eq("tipo", k.id === "agenda" ? "comercial" : "cobranca")
              .lt("proxima_acao", today)
              .order("proxima_acao");
            if (centro) q = q.or(`centro_id.eq.${centro},centro_id.is.null`);
          }
          if (k.id === "extrato") q = q.is("movimento_id", null).order("data");
          if (k.statuses.length) q = q.in(k.id === "vencimento" ? "estado" : "status", k.statuses);
          if (k.id === "vencido") q = q.lt("vencimento", today).order("vencimento");
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
            titulo: ["agenda", "cobranca"].includes(k.id)
              ? String(r["resultado"] ?? "Contato pendente")
              : k.id === "extrato"
                ? `Extrato · ${r["referencia"]}`
                : k.id === "comissao"
                  ? "Ajuste de comissão paga"
                  : k.module === "/pedidos" || k.id === "divergencia"
                    ? `Pedido #${String(r["numero"] ?? "—")}`
                    : String(r["documento"] ?? r["nosso_numero"] ?? "Parcela / boleto"),
            detalhe: ["agenda", "cobranca"].includes(k.id)
              ? `Próxima ação ${r["proxima_acao"]} · ${r["observacao"] ?? "Confira a agenda"}`
              : k.id === "extrato"
                ? String(r["descricao"] ?? "Vincule ao movimento correspondente.")
                : k.id === "comissao"
                  ? `Valor a conferir: R$ ${Number(r["valor"]).toFixed(2)}`
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
