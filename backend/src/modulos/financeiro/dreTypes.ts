export type EmpresaDRE = 'ass' | 'netr' | 'consolidado';
export type TipoCategoria = 'receita' | 'deducao' | 'custo' | 'despesa' | 'financeiro' | 'divisao';

export interface DreCategoria {
  id: string;
  nome: string;
  pai_id: string | null;
  ordem: number;
  tipo: TipoCategoria;
  sinal: number;
  subcategorias: DreCategoria[];
}

export interface DreMapeamento {
  id: string;
  empresa: string;
  nome_ca: string;
  categoria_id: string;
  categoria_nome?: string;
}

export interface LancamentoCA {
  id: string;
  categoria: string;
  valor: number;            // valor total da parcela (campo `total` do CA)
  pago: number;             // valor já pago/recebido (campo `pago` do CA)
  dataVencimento: string;
  dataCompetencia: string;  // campo `data_competencia` do CA
  dataPagamento: string | null; // não disponível na API v2 (mantido por compatibilidade)
  situacao: string;         // status_traduzido (EM_ABERTO, RECEBIDO, ATRASADO, ...)
  descricao: string;
  tipo: 'receita' | 'despesa';
}

export interface ValorMes {
  mes: number;
  ano: number;
  valor: number;
}

export interface LinhaDRE {
  id: string;
  nome: string;
  tipo: TipoCategoria;
  sinal: number;
  ordem: number;
  subcategorias: LinhaDRE[];
  valores: ValorMes[];
  total12m: number;
  percentualReceita?: number;
}

export interface TotaisCalculados {
  receitaBruta: ValorMes[];
  receitaLiquida: ValorMes[];
  custoProjetos: ValorMes[];
  despesas: ValorMes[];
  resultadoOperacional: ValorMes[];
  operacaoFinanceira: ValorMes[];
  resultadoLiquido: ValorMes[];
  fluxoCaixaLivre: ValorMes[];
}

export interface DadosDRE {
  empresa: EmpresaDRE;
  mesRef: number;
  anoRef: number;
  meses: Array<{ mes: number; ano: number }>;
  categorias: LinhaDRE[];
  totais: TotaisCalculados;
  naoMapeadas: string[];
  naoMapeadasReceita: ValorMes[];
  naoMapeadasDespesa: ValorMes[];
}

export interface CategoriaCA {
  nome: string;
  tipo: 'receita' | 'despesa';
  total: number;
  count: number;
}

export type FormulaSubtotal = 'receita_liquida' | 'resultado_operacional' | 'resultado_liquido' | 'fluxo_caixa_livre';

export interface DreSubtotal {
  id: string;
  nome: string;
  formula: FormulaSubtotal;
  apos_tipo: TipoCategoria;
  ordem: number;
}

export interface DreSnapshot {
  id: string;
  empresa: EmpresaDRE;
  mes_ref: number;
  ano_ref: number;
  calculado_em: string;
  dados: DadosDRE;
}

export interface ItemExtrato {
  id: string;
  data: string;
  tipo: 'receita' | 'despesa' | 'transferencia';
  descricao: string;
  categoria: string;
  valor: number;
}

export interface DadosExtrato {
  empresa: string;
  mes: number;
  ano: number;
  saldoInicial: number;
  itens: ItemExtrato[];
  totalReceitas: number;
  totalDespesas: number;
  saldoFinal: number;
}
