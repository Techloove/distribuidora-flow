import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { useRotinaRpc } from "@/lib/use-rotina-rpc";
import type { Registro } from "@/lib/rotinas-distribuidora";
import { lerPaginas } from "@/lib/paginacao";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function EntregaPorItem({ expedicao }: { expedicao: Registro }) {
  const { client, user } = useSupabase(),
    perm = usePermissoesRotinas(),
    rpc = useRotinaRpc(["entrega_registros", "entrega_itens", "expedicoes", "devolucoes"]);
  const [quantidades, setQuantidades] = useState<
      Record<string, { entregue: string; recusado: string }>
    >({}),
    [recebedor, setRecebedor] = useState(""),
    [motivo, setMotivo] = useState(""),
    [arquivo, setArquivo] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [chave, setChave] = useState(() => crypto.randomUUID()),
    [path, setPath] = useState("");
  const q = useQuery({
    queryKey: ["entrega_itens", user?.id, expedicao["pedido_id"]],
    enabled: !!client && perm.pode("entrega_parcial_operar"),
    queryFn: async () => {
      return lerPaginas<Registro>((inicio, fim) =>
        client!
          .from("pedido_itens")
          .select("id,quantidade,produtos(descricao),entrega_itens(entregue,recusado)")
          .eq("pedido_id", expedicao["pedido_id"])
          .order("id")
          .range(inicio, fim),
      );
    },
  });
  const salvar = async () => {
    setBusy(true);
    try {
      const itens = Object.entries(quantidades)
        .map(([item_id, v]) => ({
          item_id,
          entregue: Number(v.entregue || 0),
          recusado: Number(v.recusado || 0),
        }))
        .filter((v) => v.entregue + v.recusado > 0);
      if (!itens.length) throw new Error("Informe ao menos uma quantidade.");
      if (itens.length > 300)
        throw new Error("Registre até 300 itens por visita; divida em registros adicionais.");
      let local = path;
      if (!local) {
        if (!arquivo) throw new Error("Selecione o comprovante.");
        if (
          arquivo.size > 5_242_880 ||
          !["image/jpeg", "image/png", "application/pdf"].includes(arquivo.type)
        )
          throw new Error("Use PDF, JPG ou PNG de até 5 MB.");
        const ext =
          arquivo.type === "application/pdf" ? "pdf" : arquivo.type === "image/png" ? "png" : "jpg";
        local = String(expedicao["id"]) + "/" + chave + "." + ext;
        const { error } = await client!.storage
          .from("entrega-comprovantes")
          .upload(local, arquivo, { upsert: false, contentType: arquivo.type });
        if (error)
          throw new Error(
            "Não foi possível enviar comprovante. Verifique a conexão e tente novamente.",
          );
        setPath(local);
      }
      await rpc.mutateAsync({
        nome: "registrar_parcial_214",
        args: {
          _expedicao: expedicao["id"],
          _itens: itens,
          _recebedor: recebedor,
          _motivo: motivo,
          _arquivo: local,
          _chave: chave,
        },
      });
      setQuantidades({});
      setArquivo(null);
      setPath("");
      setChave(crypto.randomUUID());
    } catch (e) {
      if (!(e instanceof Error)) toast.error("Falha na entrega");
      else if (!rpc.isError) toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!perm.pode("entrega_parcial_operar")) return null;
  return (
    <details className="rounded border p-3 space-y-3">
      <summary className="cursor-pointer font-semibold text-sm">
        Entrega parcial, recusa e comprovante
      </summary>
      <p className="text-xs text-muted-foreground">
        Informe apenas as quantidades desta visita. Recusas geram devolução pendente para a gestão
        conferir o retorno físico e o crédito. A expedição só conclui depois de resolver todo o
        saldo.
      </p>
      {q.error && <p role="alert">{q.error.message}</p>}
      {q.data?.map((i) => {
        const id = String(i["id"]),
          historico = (i["entrega_itens"] ?? []) as Registro[],
          saldo =
            Number(i["quantidade"]) -
            historico.reduce((s, t) => s + Number(t["entregue"]) + Number(t["recusado"]), 0),
          nome = String((i["produtos"] as Registro)?.["descricao"] ?? id);
        return (
          <div key={id} className="grid gap-2 sm:grid-cols-3">
            <span className="text-sm">
              {nome} · restante {saldo}
            </span>
            {(["entregue", "recusado"] as const).map((k) => (
              <label className="text-xs" key={k}>
                {k === "entregue" ? "Entregue" : "Recusado"}
                <Input
                  aria-label={`${k} ${nome}`}
                  type="number"
                  min="0"
                  max={saldo}
                  step="0.001"
                  disabled={busy || saldo <= 0}
                  value={quantidades[id]?.[k] ?? ""}
                  onChange={(e) =>
                    setQuantidades((s) => ({
                      ...s,
                      [id]: {
                        entregue: s[id]?.entregue ?? "",
                        recusado: s[id]?.recusado ?? "",
                        [k]: e.target.value,
                      },
                    }))
                  }
                />
              </label>
            ))}
          </div>
        );
      })}
      <Input
        aria-label="Recebedor da entrega parcial"
        placeholder="Recebedor"
        value={recebedor}
        disabled={busy}
        onChange={(e) => setRecebedor(e.target.value)}
      />
      <Input
        aria-label="Motivo da recusa"
        placeholder="Motivo da recusa / observação"
        value={motivo}
        disabled={busy}
        onChange={(e) => setMotivo(e.target.value)}
      />
      <Input
        aria-label="Comprovante privado da entrega"
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        disabled={busy || !!path}
        onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
      />
      <Button
        disabled={
          busy ||
          rpc.isPending ||
          !recebedor.trim() ||
          (!arquivo && !path) ||
          expedicao["status"] !== "em_rota" ||
          q.isPending ||
          q.isError
        }
        onClick={() => void salvar()}
      >
        Registrar quantidades desta entrega
      </Button>
      <p className="text-xs text-muted-foreground">
        O arquivo fica privado; acesso sujeito às permissões de expedição.
      </p>
    </details>
  );
}
export function AbrirComprovante({ path }: { path: string }) {
  const { client } = useSupabase();
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        const { data, error } = await client!.storage
          .from("entrega-comprovantes")
          .createSignedUrl(path, 60);
        if (error) toast.error("Sem acesso ao comprovante");
        else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      }}
    >
      Abrir comprovante
    </Button>
  );
}
