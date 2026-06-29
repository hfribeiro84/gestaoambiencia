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

export type StatusConferencia = 'conferido' | 'conferido_diferenca' | 'pendente' | 'nao_esperada';

export interface ItemConferencia {
  status: StatusConferencia;
  planilha?: NfPlanilha;
  contaAzul?: NfEmitida;
  associacaoManual?: boolean;
}

export interface AssociacaoManual {
  chaveItem: string;  // "${cliente}|${descricao}|${valorTotal}"
  caId: string;       // id da NF no Conta Azul
}

/** Gera a chave estável de um item da planilha para associações manuais. */
export function chaveItemPlanilha(item: NfPlanilha): string {
  return `${item.cliente}|${item.descricao}|${item.valorTotal}`;
}

export interface ResultadoConferencia {
  empresa: Empresa;
  mes: number;
  ano: number;
  aliquotaISS: number;
  totalPlanilha: number;
  totalContaAzul: number;
  conferidos: number;
  conferidosDiferenca: number;
  pendentes: number;
  naoEsperadas: number;
  itens: ItemConferencia[];
  erroApi?: string;
  erroSalvar?: string;
}
