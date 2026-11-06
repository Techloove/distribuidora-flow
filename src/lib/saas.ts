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
  periodo_inicio?: string | null;
  periodo_fim?: string | null;
  chave: string;
  descricao?: string;
  tipo: string;
  competencia: string;
  parcela: number;
  vencimento: string;
  valor: number;
  estado: string;
  pagamento_data: string | null;
};
export type SaasContrato = {
  inicio: string | null;
  fim: string | null;
  modelo_335: boolean;
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
  itens_contrato?: SaasItemContrato[];
  reajustes_pendentes?: SaasReajustePendente[];
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

export type SaasReajuste = { vigencia: string; salario_minimo: number | null };
export type SaasReajustePendente = {
  servico_id: string;
  descricao: string;
  vigencia: string;
  percentual: number;
};
export type SaasItemContrato = {
  carencia_inicial_dias?: number | null;
  percentual_salario?: number | null;
  reajustes?: SaasReajuste[];
  id: string;
  descricao: string;
  tipo: string;
  periodicidade: string;
  valor: number;
  primeiro_vencimento: string;
  parcelas: number;
  observacao: string;
};
export type SaasPreviaContrato = {
  reajustes_pendentes?: SaasReajustePendente[];
  total: number;
  parcelas: {
    chave: string;
    descricao: string;
    tipo: string;
    parcela: number;
    vencimento: string;
    valor: number;
  }[];
};
