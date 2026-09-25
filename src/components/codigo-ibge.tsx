import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();

async function buscar(cidade: string, uf: string, cep: string): Promise<string | null> {
  const digitos = cep.replace(/\D/g, "");
  if (digitos.length === 8) {
    try {
      const r = await fetch(`https://viacep.com.br/ws/${digitos}/json/`);
      const j = (await r.json()) as { ibge?: string };
      if (j.ibge) return j.ibge;
    } catch { /* tenta pela cidade */ }
  }
  if (!cidade.trim() || !/^[A-Za-z]{2}$/.test(uf.trim())) return null;
  const r = await fetch(
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf.trim().toUpperCase()}/municipios`,
  );
  const lista = (await r.json()) as { id: number; nome: string }[];
  const achado = lista.find((m) => norm(m.nome) === norm(cidade));
  return achado ? String(achado.id) : null;
}

export function CodigoIbge({
  form,
  patch,
}: {
  form: Record<string, unknown>;
  patch: (v: Record<string, string>) => void;
}) {
  const cidade = String(form["cidade"] ?? "");
  const uf = String(form["uf"] ?? "");
  const cep = String(form["cep"] ?? "");
  const codigo = String(form["codigo_ibge"] ?? "");
  const [carregando, setCarregando] = useState(false);
  const ultimo = useRef("");

  async function executar(manual: boolean) {
    setCarregando(true);
    try {
      const c = await buscar(cidade, uf, cep);
      if (c) {
        patch({ codigo_ibge: c });
        if (manual) toast.success(`Código IBGE encontrado: ${c}`);
      } else if (manual) {
        toast.error("Município não encontrado. Confira cidade e UF ou digite o código.");
      }
    } catch {
      if (manual) toast.error("Não foi possível consultar o IBGE agora.");
    } finally {
      setCarregando(false);
    }
  }

  // automático: quando cidade/UF/CEP mudam e o código está vazio
  useEffect(() => {
    const chave = `${cidade}|${uf}|${cep}`;
    if (codigo || chave === ultimo.current || (!cidade && !cep)) return;
    const t = setTimeout(() => {
      ultimo.current = chave;
      void executar(false);
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cidade, uf, cep, codigo]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="codigo_ibge">Código IBGE do município</Label>
      <div className="flex gap-2">
        <Input
          id="codigo_ibge"
          value={codigo}
          inputMode="numeric"
          maxLength={7}
          placeholder="Preenchido pela cidade/UF ou CEP"
          onChange={(e) => patch({ codigo_ibge: e.target.value.replace(/\D/g, "") })}
        />
        <Button type="button" variant="outline" disabled={carregando} onClick={() => void executar(true)}>
          {carregando ? "Buscando..." : "Buscar IBGE"}
        </Button>
      </div>
    </div>
  );
}
