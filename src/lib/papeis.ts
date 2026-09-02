import { useQuery } from "@tanstack/react-query";

import { useSupabase } from "@/lib/supabase-provider";

export type Papel = { codigo: string; nome: string; sistema: boolean; ordem: number };

const FALLBACK: Papel[] = [
  { codigo: "admin", nome: "Administrador / Gestor", sistema: true, ordem: 1 },
  { codigo: "financeiro", nome: "Financeiro", sistema: false, ordem: 3 },
  { codigo: "comercial", nome: "Comercial", sistema: false, ordem: 4 },
  { codigo: "representante", nome: "Representante", sistema: false, ordem: 5 },
  { codigo: "estoque", nome: "Estoque", sistema: false, ordem: 6 },
  { codigo: "expedicao", nome: "Expedição", sistema: false, ordem: 7 },
];

/** Lista os perfis de acesso cadastrados (com fallback quando a Fase 29 não está aplicada). */
export function usePapeis() {
  const { client } = useSupabase();
  const query = useQuery({
    queryKey: ["papeis"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("papeis")
        .select("codigo, nome, sistema, ordem")
        .order("ordem");
      if (error) return FALLBACK;
      return ((data ?? []) as Papel[]).length ? (data as Papel[]) : FALLBACK;
    },
  });

  const papeis = query.data ?? FALLBACK;
  return {
    papeis,
    carregando: query.isLoading,
    nome: (codigo: string) => papeis.find((p) => p.codigo === codigo)?.nome ?? codigo,
  };
}
