/**
 * Extrato materializado no banco — base de dados da DRE Gerencial.
 *
 * Em vez de consultar o Conta Azul a cada cálculo, o usuário atualiza o extrato
 * por período (manualmente). Este módulo busca os dados do CA, calcula o saldo
 * corrente linha a linha e grava nas tabelas `dre_extrato` (metadados) e
 * `dre_extrato_item` (lançamentos). A DRE passa a ler daqui.
 */
import { supabaseAdmin } from '../../config/supabase';
import { buscarSaldoInicial, buscarTransferencias, buscarLancamentosExtrato } from './dreContaAzul';
import type { LancamentoCA, ItemExtratoSalvo, ExtratoSalvo, MetaExtrato } from './dreTypes';

type ContaCA = 'ass' | 'netr';

function somaPorTipo(itens: ItemExtratoSalvo[], tipo: 'receita' | 'despesa'): number {
  return itens.filter((i) => i.tipo === tipo).reduce((s, i) => s + i.valor, 0);
}

/**
 * Busca o extrato do CA no período, calcula o saldo corrente e SALVA no banco,
 * substituindo o extrato anterior daquela empresa.
 */
export async function gerarESalvarExtrato(empresa: ContaCA, de: string, ate: string): Promise<ExtratoSalvo> {
  const [saldoInicial, transferencias, lancamentos] = await Promise.all([
    buscarSaldoInicial(empresa, de),
    buscarTransferencias(empresa, de, ate),
    buscarLancamentosExtrato(empresa, de, ate),
  ]);

  // Junta lançamentos (por vencimento — API v2 não traz data de pagamento) e
  // transferências, ordenados por data.
  const base = [
    ...lancamentos.map((l) => ({
      id: l.id,
      data: l.dataVencimento,
      tipo: l.tipo as 'receita' | 'despesa',
      descricao: l.descricao,
      categoria: l.categoria,
      valor: l.valor,
    })),
    ...transferencias,
  ].sort((a, b) => a.data.localeCompare(b.data));

  // Saldo corrente: parte do saldo inicial do CA; receitas somam, despesas
  // subtraem. Transferências entre contas próprias não movem o saldo total
  // (mantêm o anterior), pois se anulam e a API não informa a direção.
  let saldo = saldoInicial;
  const itens: ItemExtratoSalvo[] = base.map((it) => {
    if (it.tipo === 'receita') saldo += it.valor;
    else if (it.tipo === 'despesa') saldo -= it.valor;
    return { ...it, saldo };
  });

  const totalReceitas = somaPorTipo(itens, 'receita');
  const totalDespesas = somaPorTipo(itens, 'despesa');
  const atualizadoEm = new Date().toISOString();

  // Substitui o extrato anterior desta empresa.
  await supabaseAdmin.from('dre_extrato_item').delete().eq('empresa', empresa);
  const { error: eMeta } = await supabaseAdmin.from('dre_extrato').upsert(
    { empresa, periodo_de: de, periodo_ate: ate, saldo_inicial: saldoInicial, atualizado_em: atualizadoEm },
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
  };
}

/** Lê o extrato salvo (metadados + itens com saldo). */
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
  };
}

/** Lê apenas os metadados do extrato (período disponível + atualização). */
export async function lerMetaExtrato(empresa: ContaCA): Promise<MetaExtrato | null> {
  const { data } = await supabaseAdmin
    .from('dre_extrato')
    .select('periodo_de, periodo_ate, atualizado_em')
    .eq('empresa', empresa)
    .maybeSingle();
  if (!data) return null;
  return {
    periodoDe: data.periodo_de as string,
    periodoAte: data.periodo_ate as string,
    atualizadoEm: data.atualizado_em as string,
  };
}

/**
 * Lê os lançamentos (receitas/despesas) do extrato salvo dentro da janela de
 * datas — é o que alimenta a DRE (transferências são ignoradas no cálculo).
 * Retorna no formato LancamentoCA para reaproveitar o motor de cálculo.
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
    dataPagamento: null,
    situacao: '',
    descricao: (r.descricao as string) ?? '',
    tipo: r.tipo as 'receita' | 'despesa',
  }));
}
