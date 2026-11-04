export type SaasStatus = {
  proprietario: boolean;
  master: boolean;
  bloqueado: boolean;
  controle_ativo: boolean;
  estado: "nao_configurado" | "em_dia" | "a_vencer" | "em_tolerancia" | "bloqueado";
  vencimento: string | null;
  limite_regularizacao: string | null;
};
export type SaasParcela = {
  chave: string;
  tipo: string;
  competencia: string;
  parcela: number;
  vencimento: string;
  valor: number;
  estado: string;
  pagamento_data: string | null;
};
export type SaasContrato = {
  empresa: string;
  responsavel: string;
  contato: string;
  plano: string;
  dominio: string;
  master_id: string | null;
  mensal_inicio: string | null;
  setup_valor: number;
  setup_parcelas: number;
  setup_vencimento: string | null;
  tolerancia: number;
  aviso_dias: number;
  controle_ativo: boolean;
  ativado_em: string | null;
  revisao: number;
  instrucoes: string;
};
export type SaasPainel = {
  status: SaasStatus;
  contrato?: SaasContrato;
  mensagem?: string;
  termos?: { vigencia: string; valor: number; dia: number }[];
  parcelas?: SaasParcela[];
  servicos?: {
    id: string;
    descricao: string;
    valor: number;
    vencimento: string;
    observacao: string;
    revisao: number;
    editavel: boolean;
  }[];
  historico?: {
    id: number;
    chave: string | null;
    acao: string;
    valor: number | null;
    vencimento: string | null;
    pagamento_data: string | null;
    motivo: string;
    criado_em: string;
  }[];
  masters?: { id: string; nome: string; email: string }[];
};
export const estadosSaas: Record<SaasStatus["estado"], string> = {
  nao_configurado: "Controle ainda não ativado",
  em_dia: "Em dia",
  a_vencer: "Próximo do vencimento",
  em_tolerancia: "Pagamento pendente · dentro da tolerância",
  bloqueado: "Acesso suspenso por pagamento pendente",
};
