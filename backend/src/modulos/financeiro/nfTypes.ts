export type Empresa = 'ass' | 'netr';

export interface NfPlanilha {
  emissaoNF: string;
  cliente: string;
  descricao: string;   // projeto (ASS) ou unidade (NETR)
  cnpj?: string;       // NETR: CNPJ de faturamento
  valorTotal: number;
  retencaoISS: boolean;
}

export interface NfEmitida {
  id: string;
  numero: string;
  dataEmissao: string;
  status: string;
  cliente: string;
  cnpj?: string;
  valor: number;
  descricao?: string;
}

export type StatusConferencia = 'conferido' | 'pendente' | 'nao_esperada';

export interface ItemConferencia {
  status: StatusConferencia;
  planilha?: NfPlanilha;
  contaAzul?: NfEmitida;
}

export interface ResultadoConferencia {
  empresa: Empresa;
  mes: number;
  ano: number;
  aliquotaISS: number;
  totalPlanilha: number;
  totalContaAzul: number;
  conferidos: number;
  pendentes: number;
  naoEsperadas: number;
  itens: ItemConferencia[];
  erroApi?: string;
}
