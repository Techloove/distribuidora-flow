import historico from "@/content/versoes.json";
export const HISTORICO_VERSOES = historico;
export const VERSAO_ATUAL = historico[0]!;
export const VERSAO_SISTEMA = VERSAO_ATUAL.versao;
