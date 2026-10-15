import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw, Truck } from "lucide-react";
import { toast } from "sonner";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { useCentroValido } from "@/lib/centros-acesso";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { dataAgenda } from "@/lib/agenda-comercial";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Entrega = {
  expedicao_id: string;
  pedido_id: string;
  numero: number;
  status: string;
  pedido_status: string;
  cliente: string;
  codigo_cliente: string | number | null;
  cidade: string | null;
  uf: string | null;
  endereco: string | null;
  telefone: string | null;
  rota: string;
  centro: string;
  motorista: string | null;
  romaneio: number;
  itens: number;
  parcial: boolean;
  data_pedido: string;
  data_saida: string | null;
  previsao_entrega: string | null;
  data_entrega: string | null;
  recebedor: string | null;
  comprovante: string | null;
  observacao: string | null;
  registrado_em: string | null;
  registrado_por: string | null;
};
type Resultado = {
  rows: Entrega[];
  count: number;
  pendentes: number;
  entregues: number;
  rotas: { id: string; nome: string }[];
};
export function Entregas() {
  const { client, user, roles } = useSupabase(),
    perm = usePermissoesRotinas(),
    cv = useCentroValido(),
    qc = useQueryClient();
  const [status, setStatus] = useState("em_rota"),
    [rota, setRota] = useState(""),
    [busca, setBusca] = useState(""),
    [termo, setTermo] = useState(""),
    [pagina, setPagina] = useState(0);
  const [selecionada, setSelecionada] = useState<Entrega | null>(null);
  const escopo = roles.slice().sort().join(",");
  const pode = perm.pode("entregas_operar");
  useEffect(() => {
    const t = setTimeout(() => setTermo(busca), 300);
    return () => clearTimeout(t);
  }, [busca]);
  useEffect(() => {
    setPagina(0);
    setSelecionada(null);
  }, [cv.centro, user?.id, escopo]);
  const lista = useQuery({
    queryKey: ["entregas_listar_232", user?.id, escopo, cv.centro, status, rota, termo, pagina],
    enabled: !!client && pode && !cv.isLoading && !cv.error,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await client!.rpc("entregas_listar_232", {
        _centro: cv.centro || null,
        _status: status,
        _rota: rota || null,
        _busca: termo.trim(),
        _pagina: pagina,
      });
      if (error)
        throw new Error(
          /schema cache|does not exist|Could not find/.test(error.message)
            ? "Aplique a fase232 no Supabase para ativar a rotina Entregas."
            : error.message,
        );
      return data as Resultado;
    },
  });
  const atualizada = async () => {
    await Promise.all(
      [
        "entregas_listar_232",
        "pedidos",
        "expedicoes",
        "vw_expedicoes",
        "vw_separacao",
        "entrega_registros",
        "pendencias",
      ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
    );
  };
  if (!pode)
    return (
      <p role="status" className="rounded-xl border p-5">
        {perm.carregando
          ? "Verificando acesso…"
          : "Seu perfil não tem permissão para acessar a rotina de entregas."}
      </p>
    );
  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        Registre aqui a entrega completa dos pedidos que já saíram em rota. A confirmação atualiza o
        pedido e o romaneio, com data, recebedor e responsável pelo registro.
      </section>
      <FilterBar
        onClear={() => {
          setStatus("em_rota");
          setRota("");
          setBusca("");
          setPagina(0);
        }}
      >
        <FilterText
          label="Buscar pedido ou cliente"
          placeholder="Número, código, cliente ou cidade"
          value={busca}
          onChange={(v) => {
            setBusca(v);
            setPagina(0);
          }}
        />
        <FilterSelect
          label="Situação da entrega"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPagina(0);
          }}
          allLabel="Todas"
          options={[
            { value: "em_rota", label: "Em rota / pendentes" },
            { value: "entregue", label: "Entregues" },
          ]}
        />
        <FilterSelect
          label="Rota"
          value={rota}
          onChange={(v) => {
            setRota(v);
            setPagina(0);
          }}
          options={(lista.data?.rotas ?? []).map((r) => ({ value: r.id, label: r.nome }))}
        />
      </FilterBar>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Pedidos dos centros permitidos. Representantes continuam limitados à própria carteira. A
          lista atualiza automaticamente.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={lista.isFetching || cv.isLoading || !!cv.error}
          onClick={() => void lista.refetch()}
        >
          <RefreshCw className="size-4" /> Atualizar
        </Button>
      </div>
      {[cv.error, lista.error].filter(Boolean).map((e, i) => (
        <p role="alert" key={i} className="rounded border p-4 text-sm text-destructive">
          {(e as Error).message}
        </p>
      ))}
      <div className="grid grid-cols-2 gap-3 sm:max-w-xl">
        <article className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Em rota / pendentes</p>
          <p className="mt-1 text-2xl font-semibold">{lista.data?.pendentes ?? "…"}</p>
        </article>
        <article className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Entregues</p>
          <p className="mt-1 text-2xl font-semibold">{lista.data?.entregues ?? "…"}</p>
        </article>
      </div>
      {(lista.isLoading || cv.isLoading) && <p role="status">Carregando entregas…</p>}
      {!lista.isPending && !lista.error && !cv.error && !lista.data?.rows.length && (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          Nenhum pedido neste filtro. Para aparecer como pendente, o pedido precisa ter sido
          despachado e estar em rota.
        </p>
      )}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {lista.data?.rows.map((e) => (
          <article key={e.expedicao_id} className="min-w-0 rounded-xl border bg-card p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">Pedido #{e.numero}</h2>
                <p className="text-sm">
                  {e.codigo_cliente ? `${e.codigo_cliente} · ` : ""}
                  {e.cliente}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs ${e.status === "entregue" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
              >
                {e.status === "entregue" ? "Entregue" : "Em rota"}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {[e.endereco, e.cidade, e.uf].filter(Boolean).join(" · ") || "Endereço não informado"}
            </p>
            {e.telefone && <p className="text-sm">Contato: {e.telefone}</p>}
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <p>Rota: {e.rota}</p>
              <p>Centro: {e.centro}</p>
              <p>
                Romaneio #{e.romaneio} · {e.itens} itens
              </p>
              <p>Motorista: {e.motorista || "Não informado"}</p>
              <p>Saída: {dataAgenda(e.data_saida)}</p>
              <p>
                {e.status === "entregue"
                  ? `Entregue em: ${dataAgenda(e.data_entrega)}`
                  : `Previsão: ${dataAgenda(e.previsao_entrega)}`}
              </p>
            </div>
            {e.status === "entregue" && (
              <p className="text-sm">
                Recebido por: {e.recebedor || "Não informado"}
                {e.registrado_por ? ` · Registrado por ${e.registrado_por}` : ""}
              </p>
            )}
            {e.status !== "entregue" && (e.parcial || e.pedido_status === "parcial") && (
              <p className="text-sm text-amber-800">
                Há entrega parcial ou recusa. Solicite a conclusão do tratamento na Expedição.
              </p>
            )}
            <Button
              className="w-full sm:w-auto"
              variant={e.status === "entregue" ? "outline" : "default"}
              onClick={() => setSelecionada(e)}
              disabled={e.status !== "entregue" && (e.parcial || e.pedido_status !== "em_rota")}
            >
              {e.status === "entregue" ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <Truck className="size-4" />
              )}
              {e.status === "entregue" ? "Consultar entrega" : "Confirmar entrega"}
            </Button>
          </article>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Button
          size="sm"
          variant="outline"
          disabled={!pagina || lista.isFetching}
          onClick={() => setPagina(pagina - 1)}
        >
          Anterior
        </Button>
        <span>
          Página {pagina + 1} · {lista.data?.count ?? 0} pedidos
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={lista.isFetching || (pagina + 1) * 50 >= (lista.data?.count ?? 0)}
          onClick={() => setPagina(pagina + 1)}
        >
          Próxima
        </Button>
      </div>
      {selecionada && (
        <FormalizarEntrega
          key={selecionada.expedicao_id}
          entrega={selecionada}
          fechar={() => setSelecionada(null)}
          concluida={atualizada}
        />
      )}
    </div>
  );
}
function FormalizarEntrega({
  entrega,
  fechar,
  concluida,
}: {
  entrega: Entrega;
  fechar: () => void;
  concluida: () => Promise<void>;
}) {
  const { client, user, roles } = useSupabase();
  const hoje = hojeSaoPaulo();
  const leitura = entrega.status === "entregue";
  const [data, setData] = useState(hoje),
    [recebedor, setRecebedor] = useState(""),
    [comprovante, setComprovante] = useState(""),
    [obs, setObs] = useState("");
  const [chave] = useState(() => crypto.randomUUID());
  const itens = useQuery({
    queryKey: ["entregas_itens_232", user?.id, roles.join(","), entrega.expedicao_id],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.rpc("entregas_itens_232", {
        _expedicao: entrega.expedicao_id,
      });
      if (error) throw new Error(error.message);
      return data as {
        count: number;
        rows: { id: string; codigo: string; produto: string; quantidade: number }[];
      };
    },
  });
  const confirmar = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("confirmar_entrega_232", {
        _expedicao: entrega.expedicao_id,
        _data: data,
        _recebedor: recebedor.trim(),
        _comprovante: comprovante.trim(),
        _observacao: obs.trim() || null,
        _chave: chave,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Entrega formalizada. Pedido e data de entrega atualizados.");
      fechar();
      await concluida();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto && !confirmar.isPending) fechar();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {leitura ? "Entrega registrada" : "Confirmar entrega"} — pedido #{entrega.numero}
          </DialogTitle>
          <DialogDescription>
            {entrega.cliente}.{" "}
            {leitura
              ? "Dados da formalização."
              : "Confirme somente após entregar integralmente os produtos ao cliente."}
          </DialogDescription>
        </DialogHeader>
        <section className="rounded border p-3 space-y-2">
          <h3 className="text-sm font-semibold">Itens do pedido</h3>
          {itens.isPending ? (
            <p className="text-sm">Carregando itens…</p>
          ) : itens.error ? (
            <p role="alert" className="text-sm text-destructive">
              {itens.error.message}
            </p>
          ) : (
            <ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
              {itens.data?.rows.map((i) => (
                <li key={i.id}>
                  <strong>{i.codigo || "—"}</strong> · {i.produto}
                  <span className="block text-xs text-muted-foreground">
                    Quantidade: {Number(i.quantidade).toLocaleString("pt-BR")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {leitura ? (
          <div className="space-y-2 text-sm">
            <p>Data de entrega: {dataAgenda(entrega.data_entrega)}</p>
            <p>Recebedor: {entrega.recebedor || "Não informado"}</p>
            <p className="break-words">Comprovante: {entrega.comprovante || "Não informado"}</p>
            <p className="whitespace-pre-wrap break-words">{entrega.observacao}</p>
            <p className="text-xs text-muted-foreground">
              Registrado por {entrega.registrado_por || "Usuário não informado"}
              {entrega.registrado_em
                ? ` em ${new Date(entrega.registrado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                : ""}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm">
              Data da entrega
              <Input
                type="date"
                disabled={confirmar.isPending}
                value={data}
                max={hoje}
                min={entrega.data_saida || entrega.data_pedido}
                onChange={(e) => setData(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Nome de quem recebeu
              <Input
                value={recebedor}
                disabled={confirmar.isPending}
                maxLength={120}
                onChange={(e) => setRecebedor(e.target.value)}
                autoComplete="name"
              />
            </label>
            <label className="block text-sm">
              Referência do comprovante
              <Input
                value={comprovante}
                disabled={confirmar.isPending}
                maxLength={1000}
                onChange={(e) => setComprovante(e.target.value)}
                placeholder="Ex.: canhoto assinado do pedido, protocolo de recebimento"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Informe a identificação do comprovante que formaliza o recebimento.
            </p>
            <label className="block text-sm">
              Observação (opcional)
              <Textarea
                value={obs}
                disabled={confirmar.isPending}
                maxLength={4000}
                onChange={(e) => setObs(e.target.value)}
              />
            </label>
            {confirmar.error && (
              <p role="alert" className="text-sm text-destructive">
                {confirmar.error.message} Se houve falha de conexão, tente novamente sem fechar esta
                confirmação.
              </p>
            )}
            <Button
              className="w-full"
              disabled={
                confirmar.isPending ||
                itens.isPending ||
                !!itens.error ||
                !itens.data?.count ||
                !data ||
                data > hoje ||
                data < (entrega.data_saida || entrega.data_pedido) ||
                !recebedor.trim() ||
                !comprovante.trim()
              }
              onClick={() => confirmar.mutate()}
            >
              {confirmar.isPending ? "Registrando…" : "Formalizar entrega completa"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
