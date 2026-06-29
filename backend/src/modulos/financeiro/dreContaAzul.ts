import { chamadaApi } from '../../integracoes/contaAzul';
import type { LancamentoCA, ItemExtrato } from './dreTypes';

type ContaCA = 'ass' | 'netr';

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function extrairCategoria(item: Record<string, unknown>): string {
  const cat = item.categoria;
  if (cat && typeof cat === 'object') return (cat as Record<string, unknown>).nome as string ?? '';
  if (typeof cat === 'string') return cat;
  return '';
}

function extrairValor(item: Record<string, unknown>): number {
  return (item.valorTotal ?? item.valor ?? item.valorLiquido ?? 0) as number;
}

function extrairDataVencimento(item: Record<string, unknown>): string {
  return (item.dataVencimento ?? item.data_vencimento ?? '') as string;
}

function extrairDataPagamento(item: Record<string, unknown>): string | null {
  const d = item.dataPagamento ?? item.dataBaixa ?? item.dataRecebimento ?? null;
  return d as string | null;
}

function extrairSituacao(item: Record<string, unknown>): string {
  return (item.situacao ?? item.status ?? '') as string;
}

function extrairDescricao(item: Record<string, unknown>): string {
  return (item.descricao ?? item.historico ?? item.observacao ?? '') as string;
}

function extrairId(item: Record<string, unknown>): string {
  return (item.id ?? item.codigo ?? '') as string;
}

/** Extrai o array de itens de uma resposta paginada (Spring-style ou CA v1). */
function extrairItens(data: unknown): unknown[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.content)) return d.content;
  if (Array.isArray(d.itens)) return d.itens;
  if (Array.isArray(data)) return data as unknown[];
  return [];
}

/** Total de páginas de uma resposta paginada. */
function extrairTotalPaginas(data: unknown): number {
  if (!data || typeof data !== 'object') return 1;
  const d = data as Record<string, unknown>;
  // Spring-style
  if (typeof d.totalPages === 'number') return d.totalPages || 1;
  // CA v1 style
  const pag = d.paginacao as Record<string, unknown> | undefined;
  if (pag && typeof pag.total_paginas === 'number') return pag.total_paginas || 1;
  return 1;
}

/** Busca todos os itens de um endpoint paginado (tamanho 200). */
async function buscarPaginado(
  conta: ContaCA,
  endpoint: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const todos: Record<string, unknown>[] = [];
  let pagina = 1;

  while (true) {
    const resp = await chamadaApi(conta, endpoint, { ...params, pagina: String(pagina), tamanho_pagina: '200' });

    if (!resp.ok) {
      const corpo = await resp.text();
      // 404 pode significar sem dados para o período — retorna vazio
      if (resp.status === 404) return todos;
      throw new Error(`Conta Azul API ${resp.status} [${endpoint}]: ${corpo.slice(0, 300)}`);
    }

    const data: unknown = await resp.json();
    const itens = extrairItens(data) as Record<string, unknown>[];
    todos.push(...itens);

    const totalPaginas = extrairTotalPaginas(data);
    if (pagina >= totalPaginas || itens.length === 0) break;
    pagina++;
  }

  return todos;
}

// ──────────────────────────────────────────────────────────────
// Endpoints CA
// ──────────────────────────────────────────────────────────────

const EP_RECEITAS = '/v1/searchinstallmentstoreceivebyfilter';
const EP_DESPESAS = '/v1/searchinstallmentstopaybyfilter';
const EP_TRANSFERENCIAS = '/v1/searchAccountingExportTransfers';

// ──────────────────────────────────────────────────────────────
// Exportações públicas
// ──────────────────────────────────────────────────────────────

/**
 * Busca todos os lançamentos (receitas + despesas) no intervalo de datas.
 * Filtra por dataVencimento para cobrir o período; inclui dataPagamento
 * para a lógica de agrupamento por mês pago vs. previsto.
 */
export async function buscarLancamentosCA(
  empresa: ContaCA,
  de: string,
  ate: string,
): Promise<LancamentoCA[]> {
  const [itensReceita, itensDespesa] = await Promise.all([
    buscarPaginado(empresa, EP_RECEITAS, { dataVencimentoInicio: de, dataVencimentoFim: ate }),
    buscarPaginado(empresa, EP_DESPESAS, { dataVencimentoInicio: de, dataVencimentoFim: ate }),
  ]);

  const receitas: LancamentoCA[] = itensReceita.map((item) => ({
    id: extrairId(item),
    categoria: extrairCategoria(item),
    valor: extrairValor(item),
    dataVencimento: extrairDataVencimento(item),
    dataPagamento: extrairDataPagamento(item),
    situacao: extrairSituacao(item),
    descricao: extrairDescricao(item),
    tipo: 'receita',
  }));

  const despesas: LancamentoCA[] = itensDespesa.map((item) => ({
    id: extrairId(item),
    categoria: extrairCategoria(item),
    valor: extrairValor(item),
    dataVencimento: extrairDataVencimento(item),
    dataPagamento: extrairDataPagamento(item),
    situacao: extrairSituacao(item),
    descricao: extrairDescricao(item),
    tipo: 'despesa',
  }));

  return [...receitas, ...despesas];
}

/** Busca o saldo inicial de uma conta financeira em uma data. */
export async function buscarSaldoInicial(empresa: ContaCA, data: string): Promise<number> {
  try {
    const resp = await chamadaApi(empresa, '/v1/financeiro/eventos-financeiros/saldo-inicial', { data });
    if (!resp.ok) return 0;
    const json = (await resp.json()) as Record<string, unknown>;
    return (json.saldo ?? json.valor ?? 0) as number;
  } catch {
    return 0;
  }
}

/** Busca transferências entre contas financeiras no período. */
export async function buscarTransferencias(
  empresa: ContaCA,
  de: string,
  ate: string,
): Promise<ItemExtrato[]> {
  try {
    const itens = await buscarPaginado(empresa, EP_TRANSFERENCIAS, {
      dataInicio: de,
      dataFim: ate,
    });

    return itens.map((item) => ({
      id: extrairId(item),
      data: (item.data ?? item.dataTransferencia ?? '') as string,
      tipo: 'transferencia' as const,
      descricao: extrairDescricao(item),
      categoria: 'Transferência',
      valor: extrairValor(item),
    }));
  } catch {
    return [];
  }
}
