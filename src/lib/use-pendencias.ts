import { brl } from "./formatacao";
import { usePermissoesRotinas } from "./permissoes-rotinas";
import {
  camposFaltantesCliente,
  PENDENCIAS_COMERCIAIS_CLIENTE,
  pendenciasComerciaisCliente,
} from "./pendencias-cadastro";
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
  cliente?: string;
  centro?: string;
  loja?: string;
  cidade?: string;
  uf?: string;
};
type Row = Record<string, unknown>;
export function usePendencias() {
  const { client, user, roles } = useSupabase();
  const { centro, isLoading, error } = useCentroValido();
  const acesso = useAcesso();
  const permissoes = usePermissoesRotinas();
  const today = hojeSaoPaulo();
  const kinds = [
    {
      id: "frete-volume",
      label: "Cidades com frete por volume pendente",
      table: "loja_fretes_volume" as const,
      module: "/centros",
      statuses: [],
      high: false,
    },
    {
      id: "config-representante",
      label: "Representantes com configuração pendente",
      table: "representantes" as const,
      module: "/usuarios",
      statuses: [],
      high: true,
    },
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
    ...PENDENCIAS_COMERCIAIS_CLIENTE.map((p) => ({
      id: p.id,
      label: p.label,
      table: "clientes" as const,
      module: "/pessoas",
      statuses: [],
      high: false,
    })),
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
  ].filter(
    (k) =>
      acesso.pode(k.module) &&
      (k.id !== "config-representante" || roles.includes("admin")) &&
      (k.id !== "frete-volume" ||
        ((roles.includes("admin") || roles.includes("gestor")) &&
          permissoes.pode("lojas_frete_volume_configurar"))),
  );
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
      let clientesPromise: Promise<Row[]> | undefined;
      const lerClientes = () =>
        (clientesPromise ??= lerPaginas<Row>((inicio, fim) => {
          let consulta = client!
            .from("clientes")
            .select(
              "id,pessoa_id,codigo,razao_social,tipo_pessoa,cnpj_cpf,inscricao_estadual,indicador_contribuinte_icms,situacao_inscricao_estadual,rota_id,representante_id,limite_credito,loja_pendente,logradouro,numero,bairro,cidade,uf,cep,centro_id,pessoa_fiscal:pessoas(indicador_contribuinte_icms,situacao_inscricao_estadual)",
            );
          if (centro) consulta = consulta.or(`centro_id.eq.${centro},centro_id.is.null`);
          return consulta.order("razao_social").order("id").range(inicio, fim);
        }));
      const results = await Promise.all(
        kinds.map(async (k) => {
          if (k.id === "frete-volume") {
            try {
              const rows = await lerPaginas<Row>((inicio, fim) =>
                client!
                  .rpc("pendencias_frete_volume_252", { _loja: centro || null })
                  .range(inicio, fim),
              );
              const itens: Pendencia[] = rows.slice(0, 40).map((r) => ({
                id: `frete-volume:${String(r["centro_id"])}:${String(r["cidade"])}:${String(r["uf"])}`,
                categoria: k.label,
                prioridade: "normal",
                to: "/centros",
                titulo: `${String(r["cidade"])} / ${String(r["uf"] || "UF não informada")} · ${String(r["loja"])}`,
                detalhe: `Falta tarifa ativa para ${String(r["produtos_sem_tarifa"])} de ${String(r["produtos_previstos"])} produto(s) que usam frete por volume nesta loja. Configure o valor por unidade.`,
                centro: String(r["centro_id"]),
                loja: String(r["centro_id"]),
                cidade: String(r["cidade"]),
                uf: String(r["uf"] ?? ""),
              }));
              return { id: k.id, label: k.label, total: rows.length, itens, erro: null };
            } catch {
              return {
                id: k.id,
                label: k.label,
                total: null,
                itens: [] as Pendencia[],
                erro: "Não foi possível conferir as cidades sem frete por volume. Confira a fase252 no Supabase.",
              };
            }
          }
          if (k.id === "config-representante") {
            try {
              const [rows, solicitacoes] = await Promise.all([
                lerPaginas<Row>((inicio, fim) =>
                  client!.rpc("admin_configuracoes_representantes_239").range(inicio, fim),
                ),
                lerPaginas<Row>((inicio, fim) =>
                  client!
                    .from("profiles")
                    .select("id,nome")
                    .eq("cadastro_status", "pendente")
                    .order("created_at")
                    .order("id")
                    .range(inicio, fim),
                ),
              ]);
              // Configuração administrativa é global ao usuário; não some ao filtrar outro centro.
              const pendentes = rows.filter(
                (r) => Array.isArray(r["pendencias"]) && r["pendencias"].length > 0,
              );
              const itens: Pendencia[] = pendentes.slice(0, 40).map((r) => ({
                id: `config-representante:${String(r["representante_id"])}`,
                categoria: k.label,
                prioridade: "alta",
                to: "/usuarios",
                titulo: String(r["nome"] ?? "Representante"),
                detalhe: (r["pendencias"] as string[]).join("; ") + ". Ação do administrador.",
              }));
              itens.push(
                ...solicitacoes.slice(0, Math.max(0, 40 - itens.length)).map((r): Pendencia => ({
                  id: `solicitacao-representante:${String(r["id"])}`,
                  categoria: k.label,
                  prioridade: "alta",
                  to: "/usuarios",
                  titulo: String(r["nome"] ?? "Novo representante"),
                  detalhe:
                    "Solicitação aguardando aprovação. O administrador deve definir centros de custo e comissão antes de autorizar.",
                })),
              );
              return {
                id: k.id,
                label: k.label,
                total: pendentes.length + solicitacoes.length,
                itens,
                erro: null,
              };
            } catch {
              return {
                id: k.id,
                label: k.label,
                total: null,
                itens: [] as Pendencia[],
                erro: "Não foi possível conferir a configuração dos representantes. Confira a fase239.",
              };
            }
          }
          const comercial = PENDENCIAS_COMERCIAIS_CLIENTE.find((p) => p.id === k.id);
          if (comercial) {
            try {
              const rows = (await lerClientes()).filter(
                (r) => pendenciasComerciaisCliente(r)[comercial.filtro],
              );
              const itens: Pendencia[] = rows.slice(0, 40).map((r) => ({
                id: `${k.id}:${String(r["id"])}`,
                categoria: k.label,
                prioridade: "normal",
                to: "/pessoas",
                titulo: `${r["codigo"] ? `${String(r["codigo"])} · ` : ""}${String(r["razao_social"] ?? "Cliente")}`,
                detalhe: comercial.detalhe,
                centro: String(r["centro_id"] ?? ""),
                ...(r["pessoa_id"]
                  ? { pessoa: String(r["pessoa_id"]) }
                  : { cliente: String(r["id"]) }),
              }));
              return { id: k.id, label: k.label, total: rows.length, itens, erro: null };
            } catch {
              return {
                id: k.id,
                label: k.label,
                total: null,
                itens: [] as Pendencia[],
                erro: `Não foi possível conferir ${k.label.toLowerCase()}.`,
              };
            }
          }
          if (k.id === "cadastro") {
            try {
              const clientes = await lerClientes();
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
                  ? `Valor a conferir: ${brl(r["valor"])}`
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
