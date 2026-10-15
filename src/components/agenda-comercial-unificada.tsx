import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CalendarClock, Compass, HandCoins, Printer, UserRoundSearch } from "lucide-react";
import { LeadRotaAgenda } from "@/components/lead-rota-agenda";
import { AgendaClientes } from "@/components/agenda-clientes";
import { Button } from "@/components/ui/button";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCentroValido } from "@/lib/centros-acesso";
import { FILTROS_AGENDA, type AgendaAba } from "@/lib/agenda-comercial";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { useSupabase } from "@/lib/supabase-provider";

type Opcoes = {
  representantes: { id: string; nome: string }[];
  rotas: { id: string; nome: string }[];
  cidades: string[];
};
export function AgendaComercialUnificada({ aba }: { aba: AgendaAba }) {
  const { client, user, roles } = useSupabase();
  const perm = usePermissoesRotinas(),
    cv = useCentroValido(),
    navigate = useNavigate();
  const restrita = roles.includes("representante") && !roles.includes("admin");
  const [filtros, setFiltros] = useState(FILTROS_AGENDA);
  const [clientePreferido, setClientePreferido] = useState<string | null>(null);
  const [buscaAplicada, setBuscaAplicada] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setBuscaAplicada(filtros.busca), 250);
    return () => clearTimeout(timer);
  }, [filtros.busca]);
  const filtrosAplicados = {
    ...filtros,
    busca: buscaAplicada,
    representante: restrita ? "" : filtros.representante,
  };

  const abas = [
    {
      id: "rotas" as const,
      titulo: "Lead Rota",
      curto: "Rotas",
      acao: "lead_rota_operar" as const,
      icon: Compass,
    },
    {
      id: "comercial" as const,
      titulo: "Relacionamento",
      curto: "Carteira",
      acao: "comercial_acompanhar" as const,
      icon: CalendarClock,
    },
    {
      id: "reativacao" as const,
      titulo: "Clientes sem comprar",
      curto: "Sem compras",
      acao: "clientes_reativar" as const,
      icon: UserRoundSearch,
    },
    {
      id: "cobranca" as const,
      titulo: "Cobrança",
      curto: "Cobrança",
      acao: "cobranca_acompanhar" as const,
      icon: HandCoins,
    },
  ].filter((a) => perm.pode(a.acao));
  const selecionada = abas.some((a) => a.id === aba) ? aba : abas[0]?.id;
  const opcoes = useQuery({
    queryKey: ["agenda_filtros_228", user?.id, roles.join(",")],
    enabled: !!client && abas.length > 0,
    queryFn: async () => {
      const { data, error } = await client!.rpc("agenda_filtros_228");
      if (error)
        throw new Error("Não foi possível carregar os filtros. Confira a fase228 no Supabase.");
      return data as Opcoes;
    },
  });
  const setF = (key: string, value: string) =>
    setFiltros((f) => ({ ...f, [key]: key === "dias" ? Number(value) : value }));
  if (!selecionada)
    return (
      <p role="status">
        {perm.carregando
          ? "Verificando acesso…"
          : "Nenhuma rotina da agenda foi liberada para seu perfil. Solicite ao administrador."}
      </p>
    );
  return (
    <Tabs
      className="space-y-5"
      value={selecionada}
      onValueChange={(value) =>
        void navigate({
          to: "/agenda-comercial",
          search: { aba: value as AgendaAba },
          replace: true,
        })
      }
    >
      <div className="rounded-xl border bg-card p-4 sm:p-5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Uma agenda para cuidar da carteira</h2>
          <Button className="no-print" variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="size-4" />
            Imprimir página
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {restrita
            ? "Você visualiza e acompanha somente os clientes da sua carteira."
            : "Acompanhe as carteiras por representante, rota, cidade e centro de custo."}{" "}
          Os filtros são mantidos ao alternar entre as áreas.
        </p>
        <TabsList className="mt-2 h-auto w-full justify-start flex-wrap gap-1">
          {abas.map(({ id, titulo, curto, icon: Icon }) => (
            <TabsTrigger
              key={id}
              value={id}
              aria-label={titulo}
              className="gap-1 px-2 py-2 text-xs sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm"
            >
              <Icon className="size-4" />
              <span className="sm:hidden">{curto}</span>
              <span className="hidden sm:inline">{titulo}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <FilterBar onClear={() => setFiltros(FILTROS_AGENDA)}>
        <FilterText
          label="Buscar cliente ou código"
          placeholder="Nome ou código do cliente"
          value={filtros.busca}
          onChange={(v) => setF("busca", v)}
        />
        {!restrita && (
          <FilterSelect
            label="Representante"
            value={filtros.representante}
            onChange={(v) => setF("representante", v)}
            options={(opcoes.data?.representantes ?? []).map((r) => ({
              value: r.id,
              label: r.nome,
            }))}
            allLabel="Todas as carteiras"
          />
        )}
        <FilterSelect
          label="Rota"
          value={filtros.rota}
          onChange={(v) => setF("rota", v)}
          options={(opcoes.data?.rotas ?? []).map((r) => ({ value: r.id, label: r.nome }))}
        />
        <FilterSelect
          label="Cidade"
          value={filtros.cidade}
          onChange={(v) => setF("cidade", v)}
          options={(opcoes.data?.cidades ?? []).map((c) => ({ value: c, label: c }))}
        />
        {selecionada === "reativacao" && (
          <label className="space-y-1 text-sm">
            <span>Dias sem comprar</span>
            <select
              aria-label="Dias sem comprar"
              className="block h-9 w-full rounded border bg-background px-2"
              value={filtros.dias}
              onChange={(e) => setF("dias", e.target.value)}
            >
              {[15, 30, 45, 60, 90, 120].map((d) => (
                <option key={d} value={d}>
                  {d} dias ou mais
                </option>
              ))}
            </select>
          </label>
        )}
      </FilterBar>
      {opcoes.error && (
        <p role="alert" className="text-sm text-destructive">
          {opcoes.error.message}
        </p>
      )}
      <TabsContent value={selecionada}>
        {selecionada === "rotas" ? (
          <LeadRotaAgenda
            key={[user?.id, roles.join(","), cv.centro, JSON.stringify(filtrosAplicados)].join(":")}
            filtros={filtrosAplicados}
            onCobrar={(c) => {
              setFiltros((f) => ({ ...f, busca: String(c["razao_social"]) }));
              setBuscaAplicada(String(c["razao_social"]));
              setClientePreferido(String(c["cliente_id"]));
              void navigate({ to: "/agenda-comercial", search: { aba: "cobranca" } });
            }}
          />
        ) : (
          <AgendaClientes
            key={[
              user?.id,
              roles.slice().sort().join(","),
              selecionada,
              cv.centro,
              JSON.stringify(filtrosAplicados),
            ].join(":")}
            tipo={selecionada === "cobranca" ? "cobranca" : "comercial"}
            reativacao={selecionada === "reativacao"}
            filtros={filtrosAplicados}
            clienteInicialId={clientePreferido}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}
