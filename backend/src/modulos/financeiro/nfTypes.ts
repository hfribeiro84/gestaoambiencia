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
  numero: string;       // número da NFS-e
  numeroRps?: string;   // número do RPS (recibo provisório)
  dataEmissao: string;
  status: string;
  cliente: string;
  cnpj?: string;
  valor: number;
  descricao?: string;
  // Empresa emitente (prestador) da nota — quando o CA informa esse campo.
  // Serve para detectar quando o token de uma empresa traz notas de outra.
  emitenteNome?: string;
  emitenteCnpj?: string;
  // Município/CNAE de emissão — atributos do EMITENTE. Como a lista de NFS-e do
  // CA não traz o prestador, isso é o que distingue ASS x NETR (cidades distintas).
  cidadeEmissao?: string;
  cnae?: string;
  // Diagnóstico: nomes dos campos crus da 1ª nota (só preenchido na primeira).
  _camposCrus?: string[];
}

export type StatusConferencia = 'conferido' | 'conferido_diferenca' | 'pendente' | 'nao_esperada';

export interface ItemConferencia {
  status: StatusConferencia;
  planilha?: NfPlanilha;
  contaAzul?: NfEmitida;
  associacaoManual?: boolean;
  // Casou (por código/nome ou manualmente), mas o CNPJ da planilha difere do CNPJ
  // da NF no Conta Azul → erro de cadastro a corrigir (NETR).
  cnpjDivergente?: boolean;
}

export interface AssociacaoManual {
  chaveItem: string;  // "${cliente}|${descricao}|${valorTotal}"
  caId: string;       // id da NF no Conta Azul
}

/** Gera a chave estável de um item da planilha para associações manuais. */
export function chaveItemPlanilha(item: NfPlanilha): string {
  return `${item.cliente}|${item.descricao}|${item.valorTotal}`;
}

/** caId especial: indica que o item deve permanecer Pendente (sem auto-match). */
export const SEM_PAR = '__sem_par__';

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
  cnpjDivergentes: number;
  itens: ItemConferencia[];
  erroApi?: string;
  erroSalvar?: string;
  // Falha ao buscar/ler a planilha a partir do link salvo (Google Sheets). Quando
  // ocorre, os dados exibidos são da última planilha conhecida (não atualizada).
  erroPlanilha?: string;
  // Empresa emitente detectada nas notas do Conta Azul. Se divergir da empresa
  // selecionada, o token conectado pertence à conta errada (ASS x NETR).
  emitenteNome?: string;
  emitenteCnpj?: string;
  // Município de emissão dominante das notas (atributo do emitente). Distingue
  // ASS x NETR quando ficam em cidades diferentes.
  cidadeEmissaoCA?: string;
  // Amostra de nomes de clientes das notas do CA — identificador garantido
  // (nome_cliente sempre presente) para o usuário reconhecer a empresa conectada.
  amostraClientesCA?: string[];
  // Diagnóstico: nomes dos campos crus da resposta do CA (quando o emitente não
  // for identificável automaticamente).
  camposCA?: string[];
}
