/**
 * Extrato materializado no banco — base de dados da DRE Gerencial (REGIME DE CAIXA).
 *
 * O usuário atualiza o extrato por período (manualmente). Como a API v2 do Conta
 * Azul não filtra por data de pagamento, buscamos as parcelas por uma janela de
 * vencimento ampla, explodimos as BAIXAS (pagamentos/recebimentos efetivos) e
 * filtramos pelas que caíram no período — assim o extrato reflete o caixa real.
 * A DRE lê desses lançamentos (já datados pelo pagamento).
 *
 * Também calcula um snapshot de contas EM ATRASO (vencidas e em aberto), guardado
 * junto do extrato — informativo, não entra no saldo de caixa.
 */
import { supabaseAdmin } from '../../config/supabase';
import { buscarSaldoInicial, buscarParcelas, enriquecerComBaixas } from './dreContaAzul';
import type {
  LancamentoCA,
  ItemExtratoSalvo,
  ExtratoSalvo,
  MetaExtrato,
  ParcelaCA,
  ItemAtraso,
  AtrasadosResumo,
} from './dreTypes';

type ContaCA = 'ass' | 'netr';

// Margens da janela de vencimento para captar baixas fora do período (pagamentos
// atrasados ou adiantados). Amplas de propósito — o extrato é atualização manual.
const MARGEM_ATRASO_MESES = 36;
const MARGEM_ADIANTAMENTO_MESES = 12;
// Quão longe olhar para trás ao levantar contas vencidas em aberto.
const MARGEM_ATRASADOS_MESES = 36;

function addMeses(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10);
}

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function diasEntre(deIso: string, ateIso: string): number {
  const ms = Date.parse(ateIso) - Date.parse(deIso);
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function somaPorTipo(itens: ItemExtratoSalvo[], tipo: 'receita' | 'despesa'): number {
  return itens.filter((i) => i.tipo === tipo).reduce((s, i) => s + i.valor, 0);
}

// ──────────────────────────────────────────────────────────────
// Contas em atraso (vencidas e ainda em aberto) — snapshot informativo
// ──────────────────────────────────────────────────────────────

function atrasadosDeParcelas(parcelas: ParcelaCA[], hoje: string): ItemAtraso[] {
  const out: ItemAtraso[] = [];
  for (const p of parcelas) {
    const aberto = p.valorTotal - p.totalBaixado;
    if (aberto <= 0.005) continue;           // já quitada (ou quase)
    if (!p.dataVencimento || p.dataVencimento >= hoje) continue; // não vencida
    out.push({
      id: p.id,
      descricao: p.descricao,
      categoria: p.categoria,
      dataVencimento: p.dataVencimento,
      valorAberto: aberto,
      diasAtraso: diasEntre(p.dataVencimento, hoje),
    });
  }
  return out.sort((a, b) => b.diasAtraso - a.diasAtraso);
}

/** Levanta as contas a receber e a pagar vencidas e em aberto (regime informativo). */
export async function calcularAtrasados(empresa: ContaCA): Promise<AtrasadosResumo> {
  const hoje = hojeISO();
  const de = addMeses(hoje, -MARGEM_ATRASADOS_MESES);

  const [rec, pag] = await Promise.all([
    buscarParcelas(empresa, 'receita', de, hoje),
    buscarParcelas(empresa, 'despesa', de, hoje),
  ]);

  const aReceber = atrasadosDeParcelas(rec, hoje);
  const aPagar = atrasadosDeParcelas(pag, hoje);
  return {
    aReceber,
    aPagar,
    totalReceber: aReceber.reduce((s, i) => s + i.valorAberto, 0),
    totalPagar: aPagar.reduce((s, i) => s + i.valorAberto, 0),
  };
}

// ──────────────────────────────────────────────────────────────
// Extrato de caixa
// ──────────────────────────────────────────────────────────────

/**
 * Busca o período no CA (regime de caixa), calcula o saldo corrente e SALVA no
 * banco, substituindo o extrato anterior. Também grava o snapshot de atrasados.
 */
export async function gerarESalvarExtrato(empresa: ContaCA, de: string, ate: string): Promise<ExtratoSalvo> {
  const vencDe = addMeses(de, -MARGEM_ATRASO_MESES);
  const vencAte = addMeses(ate, MARGEM_ADIANTAMENTO_MESES);

  const [saldoInicial, parcelasRec, parcelasPag, atrasados] = await Promise.all([
    buscarSaldoInicial(empresa, de),
    buscarParcelas(empresa, 'receita', vencDe, vencAte),
    buscarParcelas(empresa, 'despesa', vencDe, vencAte),
    calcularAtrasados(empresa),
  ]);

  // Enriquece as parcelas pagas com suas baixas (data real do pagamento).
  await Promise.all([
    enriquecerComBaixas(empresa, parcelasRec),
    enriquecerComBaixas(empresa, parcelasPag),
  ]);

  // Explode as baixas cuja data de pagamento cai no período [de, ate].
  const eventos = [] as Array<{ id: string; data: string; tipo: 'receita' | 'despesa'; descricao: string; categoria: string; valor: number }>;
  for (const p of [...parcelasRec, ...parcelasPag]) {
    for (const b of p.baixas) {
      if (b.data >= de && b.data <= ate && b.valor) {
        eventos.push({
          id: p.id,
          data: b.data,
          tipo: p.tipo,
          descricao: p.descricao,
          categoria: p.categoria,
          valor: Math.abs(b.valor),
        });
      }
    }
  }
  eventos.sort((a, b) => a.data.localeCompare(b.data));

  // Saldo corrente: parte do saldo inicial do CA; recebimentos somam, pagamentos subtraem.
  let saldo = saldoInicial;
  const itens: ItemExtratoSalvo[] = eventos.map((it) => {
    saldo += it.tipo === 'receita' ? it.valor : -it.valor;
    return { id: it.id, data: it.data, tipo: it.tipo, descricao: it.descricao, categoria: it.categoria, valor: it.valor, saldo };
  });

  const totalReceitas = somaPorTipo(itens, 'receita');
  const totalDespesas = somaPorTipo(itens, 'despesa');
  const atualizadoEm = new Date().toISOString();

  // Substitui o extrato anterior desta empresa.
  await supabaseAdmin.from('dre_extrato_item').delete().eq('empresa', empresa);
  const { error: eMeta } = await supabaseAdmin.from('dre_extrato').upsert(
    { empresa, periodo_de: de, periodo_ate: ate, saldo_inicial: saldoInicial, atualizado_em: atualizadoEm, atrasados },
    { onConflict: 'empresa' },
  );
  if (eMeta) throw new Error(`Falha ao salvar extrato: ${eMeta.message}`);

  const rows = itens.map((i, idx) => ({
    empresa,
    lancamento_id: i.id,
    data: i.data,
    tipo: i.tipo,
    categoria: i.categoria,
    descricao: i.descricao,
    valor: i.valor,
    saldo: i.saldo,
    ordem: idx,
  }));
  for (let k = 0; k < rows.length; k += 500) {
    const { error } = await supabaseAdmin.from('dre_extrato_item').insert(rows.slice(k, k + 500));
    if (error) throw new Error(`Falha ao salvar itens do extrato: ${error.message}`);
  }

  return {
    empresa,
    periodoDe: de,
    periodoAte: ate,
    saldoInicial,
    atualizadoEm,
    itens,
    totalReceitas,
    totalDespesas,
    saldoFinal: saldoInicial + totalReceitas - totalDespesas,
    atrasados,
  };
}

/** Lê o extrato salvo (metadados + itens com saldo + atrasados). */
export async function lerExtratoSalvo(empresa: ContaCA): Promise<ExtratoSalvo | null> {
  const { data: meta } = await supabaseAdmin
    .from('dre_extrato')
    .select('*')
    .eq('empresa', empresa)
    .maybeSingle();
  if (!meta) return null;

  const { data: itensDb, error } = await supabaseAdmin
    .from('dre_extrato_item')
    .select('lancamento_id, data, tipo, descricao, categoria, valor, saldo')
    .eq('empresa', empresa)
    .order('data')
    .order('ordem');
  if (error) throw new Error(error.message);

  const itens: ItemExtratoSalvo[] = (itensDb ?? []).map((r: Record<string, unknown>) => ({
    id: (r.lancamento_id as string) ?? '',
    data: r.data as string,
    tipo: r.tipo as ItemExtratoSalvo['tipo'],
    descricao: (r.descricao as string) ?? '',
    categoria: (r.categoria as string) ?? '',
    valor: Number(r.valor),
    saldo: Number(r.saldo),
  }));

  const saldoInicial = Number(meta.saldo_inicial);
  const totalReceitas = somaPorTipo(itens, 'receita');
  const totalDespesas = somaPorTipo(itens, 'despesa');

  return {
    empresa,
    periodoDe: meta.periodo_de as string,
    periodoAte: meta.periodo_ate as string,
    saldoInicial,
    atualizadoEm: meta.atualizado_em as string,
    itens,
    totalReceitas,
    totalDespesas,
    saldoFinal: saldoInicial + totalReceitas - totalDespesas,
    atrasados: (meta.atrasados as AtrasadosResumo | null) ?? null,
  };
}

/** Lê apenas os metadados do extrato (período + atualização + atrasados). */
export async function lerMetaExtrato(empresa: ContaCA): Promise<MetaExtrato | null> {
  const { data } = await supabaseAdmin
    .from('dre_extrato')
    .select('periodo_de, periodo_ate, atualizado_em, atrasados')
    .eq('empresa', empresa)
    .maybeSingle();
  if (!data) return null;
  return {
    periodoDe: data.periodo_de as string,
    periodoAte: data.periodo_ate as string,
    atualizadoEm: data.atualizado_em as string,
    atrasados: (data.atrasados as AtrasadosResumo | null) ?? null,
  };
}

/**
 * Lê os lançamentos do extrato salvo dentro da janela de datas (por data de
 * pagamento) — alimenta a DRE de caixa. Formato LancamentoCA para reaproveitar
 * o motor de cálculo (o campo dataVencimento carrega a data do pagamento).
 */
export async function lerLancamentosDoExtrato(empresa: ContaCA, de: string, ate: string): Promise<LancamentoCA[]> {
  const { data, error } = await supabaseAdmin
    .from('dre_extrato_item')
    .select('lancamento_id, data, tipo, categoria, descricao, valor')
    .eq('empresa', empresa)
    .neq('tipo', 'transferencia')
    .gte('data', de)
    .lte('data', ate);
  if (error) throw new Error(error.message);

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: (r.lancamento_id as string) ?? '',
    categoria: (r.categoria as string) ?? '',
    valor: Number(r.valor),
    pago: 0,
    dataVencimento: r.data as string,
    dataCompetencia: r.data as string,
    dataPagamento: r.data as string,
    situacao: '',
    descricao: (r.descricao as string) ?? '',
    tipo: r.tipo as 'receita' | 'despesa',
  }));
}
