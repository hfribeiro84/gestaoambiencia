import { chamadaApi } from '../../integracoes/contaAzul';
import type { LancamentoCA, ItemExtrato } from './dreTypes';

type ContaCA = 'ass' | 'netr';

// ──────────────────────────────────────────────────────────────
// Endpoints da API Financeira do Conta Azul (v2 — api-v2.contaazul.com)
// Referência: https://developers.contaazul.com/docs/financial-apis-openapi
// ──────────────────────────────────────────────────────────────

const EP_RECEITAS = '/v1/financeiro/eventos-financeiros/contas-a-receber/buscar';
const EP_DESPESAS = '/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar';
const EP_TRANSFERENCIAS = '/v1/financeiro/transferencias';

// tamanho_pagina aceita apenas: 10, 20, 50, 100, 200, 500, 1000
const TAMANHO_PAGINA = 200;

// ──────────────────────────────────────────────────────────────
// Helpers de extração de campos (resposta v2)
// ──────────────────────────────────────────────────────────────

/** Categoria vem como array `categorias: [{ id, nome }]`. Usa a primeira. */
function extrairCategoria(item: Record<string, unknown>): string {
  const cats = item.categorias;
  if (Array.isArray(cats) && cats.length > 0) {
    const nome = (cats[0] as Record<string, unknown>)?.nome;
    if (typeof nome === 'string') return nome;
  }
  // Fallbacks (formatos antigos / outras respostas)
  const cat = item.categoria;
  if (cat && typeof cat === 'object') return ((cat as Record<string, unknown>).nome as string) ?? '';
  if (typeof cat === 'string') return cat;
  return '';
}

function extrairValor(item: Record<string, unknown>): number {
  return (item.total ?? item.valorTotal ?? item.valor ?? 0) as number;
}

function extrairPago(item: Record<string, unknown>): number {
  return (item.pago ?? 0) as number;
}

function extrairDataVencimento(item: Record<string, unknown>): string {
  return (item.data_vencimento ?? item.dataVencimento ?? '') as string;
}

function extrairDataCompetencia(item: Record<string, unknown>): string {
  return (item.data_competencia ?? item.dataCompetencia ?? '') as string;
}

function extrairSituacao(item: Record<string, unknown>): string {
  return (item.status_traduzido ?? item.status ?? item.situacao ?? '') as string;
}

function extrairDescricao(item: Record<string, unknown>): string {
  return (item.descricao ?? item.historico ?? item.observacao ?? '') as string;
}

function extrairId(item: Record<string, unknown>): string {
  return (item.id ?? item.codigo ?? '') as string;
}

/** Extrai o array de itens de uma resposta paginada (v2 usa `itens`). */
function extrairItens(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.itens)) return d.itens as Record<string, unknown>[];
  if (Array.isArray(d.content)) return d.content as Record<string, unknown>[];
  if (Array.isArray(d.data)) return d.data as Record<string, unknown>[];
  if (Array.isArray(d.items)) return d.items as Record<string, unknown>[];
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  return [];
}

/** Total de itens da consulta (v2 usa `itens_totais`). */
function extrairTotalItens(data: unknown): number {
  if (!data || typeof data !== 'object') return 0;
  const d = data as Record<string, unknown>;
  if (typeof d.itens_totais === 'number') return d.itens_totais;
  if (typeof d.total_itens === 'number') return d.total_itens;
  if (typeof d.totalItens === 'number') return d.totalItens;
  return 0;
}

// ──────────────────────────────────────────────────────────────
// Busca paginada genérica
// ──────────────────────────────────────────────────────────────

async function buscarPaginado(
  conta: ContaCA,
  endpoint: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const todos: Record<string, unknown>[] = [];
  let pagina = 1;

  while (true) {
    const resp = await chamadaApi(conta, endpoint, {
      ...params,
      pagina: String(pagina),
      tamanho_pagina: String(TAMANHO_PAGINA),
    });

    if (!resp.ok) {
      // 404 = sem registros no período — retorna o que tiver
      if (resp.status === 404) return todos;
      if (resp.status === 403) {
        throw new Error(
          `Conta Azul ${endpoint}: acesso negado (403). O token OAuth não tem permissão para ` +
          `lançamentos financeiros. Reconecte o Conta Azul em Integrações.`,
        );
      }
      const corpo = await resp.text();
      throw new Error(`Conta Azul API ${resp.status} [${endpoint}]: ${corpo.slice(0, 200)}`);
    }

    const data: unknown = await resp.json();
    const itens = extrairItens(data);
    todos.push(...itens);

    const totalItens = extrairTotalItens(data);
    if (
      itens.length === 0 ||
      itens.length < TAMANHO_PAGINA ||
      (totalItens > 0 && todos.length >= totalItens)
    ) {
      break;
    }
    pagina++;
  }

  return todos;
}

// ──────────────────────────────────────────────────────────────
// Mapeamento item CA → LancamentoCA
// ──────────────────────────────────────────────────────────────

function mapearItem(item: Record<string, unknown>, tipo: 'receita' | 'despesa'): LancamentoCA {
  return {
    id: extrairId(item),
    categoria: extrairCategoria(item),
    valor: extrairValor(item),
    pago: extrairPago(item),
    dataVencimento: extrairDataVencimento(item),
    dataCompetencia: extrairDataCompetencia(item),
    dataPagamento: null, // não retornado pela API v2
    situacao: extrairSituacao(item),
    descricao: extrairDescricao(item),
    tipo,
  };
}

// ──────────────────────────────────────────────────────────────
// Exportações públicas
// ──────────────────────────────────────────────────────────────

/**
 * Busca todos os lançamentos (receitas + despesas) cujo VENCIMENTO esteja
 * no intervalo [de, ate]. A API v2 exige filtro por data de vencimento.
 */
export async function buscarLancamentosCA(
  empresa: ContaCA,
  de: string,
  ate: string,
): Promise<LancamentoCA[]> {
  const filtro = { data_vencimento_de: de, data_vencimento_ate: ate };

  const [itensReceita, itensDespesa] = await Promise.all([
    buscarPaginado(empresa, EP_RECEITAS, filtro),
    buscarPaginado(empresa, EP_DESPESAS, filtro),
  ]);

  return [
    ...itensReceita.map((i) => mapearItem(i, 'receita')),
    ...itensDespesa.map((i) => mapearItem(i, 'despesa')),
  ];
}

/**
 * Busca lançamentos para o extrato de um mês específico (por vencimento).
 */
export async function buscarLancamentosExtrato(
  empresa: ContaCA,
  de: string,
  ate: string,
): Promise<LancamentoCA[]> {
  return buscarLancamentosCA(empresa, de, ate);
}

/** Busca o saldo inicial das contas financeiras em uma data. */
export async function buscarSaldoInicial(empresa: ContaCA, data: string): Promise<number> {
  try {
    const resp = await chamadaApi(empresa, '/v1/financeiro/eventos-financeiros/saldo-inicial', {
      data_inicio: data,
      data_fim: data,
    });
    if (!resp.ok) return 0;
    const json = (await resp.json()) as Record<string, unknown>;
    // Resposta pode trazer lista de contas; soma os saldos disponíveis
    const itens = extrairItens(json);
    if (itens.length > 0) {
      return itens.reduce((acc, it) => acc + ((it.saldo_inicial ?? it.saldo ?? it.valor ?? 0) as number), 0);
    }
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
      data_inicio: de,
      data_fim: ate,
    });

    return itens.map((item) => ({
      id: extrairId(item),
      data: (item.data ?? item.data_transferencia ?? item.dataTransferencia ?? '') as string,
      tipo: 'transferencia' as const,
      descricao: extrairDescricao(item),
      categoria: 'Transferência',
      valor: extrairValor(item),
    }));
  } catch {
    return [];
  }
}
