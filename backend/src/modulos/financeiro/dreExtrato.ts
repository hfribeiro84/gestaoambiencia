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

// Ao buscar baixas realizadas, olhamos parcelas vencidas até N meses antes do
// início do período (pagamentos costumam ocorrer perto do vencimento).
const MARGEM_CAIXA_MESES = 6;
// Quão longe olhar para trás ao levantar contas vencidas em aberto (atrasados).
const MARGEM_ATRASADOS_MESES = 12;

function addMeses(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10);
}

function addDias(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
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

const TAMANHO_PAGINA_DB = 1000;

/**
 * Executa uma query Supabase paginando com `.range()` até esgotar os resultados.
 * O PostgREST limita a 1000 linhas por padrão — sem isso, extratos com muitos
 * itens (ex.: ano inteiro com previsões granulares) perdiam os meses finais.
 */
async function selecionarTudoPaginado<T>(
  montarQuery: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const todos: T[] = [];
  let pagina = 0;
  while (true) {
    const de = pagina * TAMANHO_PAGINA_DB;
    const ate = de + TAMANHO_PAGINA_DB - 1;
    const { data, error } = await montarQuery(de, ate);
    if (error) throw new Error(error.message);
    const lote = data ?? [];
    todos.push(...lote);
    if (lote.length < TAMANHO_PAGINA_DB) break;
    pagina++;
  }
  return todos;
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

// Janela recente reprocessada no "Atualizar recente" e no cron (o histórico
// anterior fica congelado). Cobre pagamentos que atrasaram até ~2 meses.
const MESES_REFRESH_RECENTE = 2;

type EventoExtrato = { id: string; data: string; tipo: 'receita' | 'despesa'; descricao: string; categoria: string; valor: number; previsto: boolean };

/**
 * Monta os eventos do recorte [de, ate] no modelo híbrido: até ontem = CAIXA
 * (baixas reais, por data de pagamento); de hoje em diante = PREVISTO (parcelas
 * em aberto, pela data de vencimento). Não persiste nada — só devolve os eventos.
 */
async function montarEventos(empresa: ContaCA, de: string, ate: string, opts: { ignorarCache?: boolean } = {}): Promise<EventoExtrato[]> {
  const hoje = hojeISO();
  const ontem = addDias(hoje, -1);
  const caixaAte = ate < ontem ? ate : ontem; // realizado vai até ontem (ou fim, se antes)
  const prevDe = de > hoje ? de : hoje;        // previsto começa hoje (ou início, se depois)
  const eventos: EventoExtrato[] = [];

  // ── REALIZADO (caixa): baixas com data_pagamento em [de, caixaAte] ──
  if (de <= caixaAte) {
    const vDe = addMeses(de, -MARGEM_CAIXA_MESES);
    const [pr, pp] = await Promise.all([
      buscarParcelas(empresa, 'receita', vDe, caixaAte),
      buscarParcelas(empresa, 'despesa', vDe, caixaAte),
    ]);

    // Só busca a baixa das parcelas que PROVAVELMENTE foram pagas no período —
    // evita centenas de chamadas inúteis. Proxy: data_alteracao (registro da baixa)
    // ou vencimento dentro do período. Baixa real é filtrada por data depois.
    const candidata = (p: (typeof pr)[number]) =>
      p.totalBaixado > 0.005 &&
      ((p.dataAlteracao >= de && p.dataAlteracao <= caixaAte) ||
        (p.dataVencimento >= de && p.dataVencimento <= caixaAte));
    const candRec = pr.filter(candidata);
    const candPag = pp.filter(candidata);

    await Promise.all([
      enriquecerComBaixas(empresa, candRec, { ignorarCache: opts.ignorarCache }),
      enriquecerComBaixas(empresa, candPag, { ignorarCache: opts.ignorarCache }),
    ]);
    for (const p of [...candRec, ...candPag]) {
      for (const b of p.baixas) {
        if (b.data >= de && b.data <= caixaAte && b.valor) {
          eventos.push({ id: p.id, data: b.data, tipo: p.tipo, descricao: p.descricao, categoria: p.categoria, valor: Math.abs(b.valor), previsto: false });
        }
      }
    }
  }

  // ── PREVISTO (competência): parcelas em aberto com vencimento em [prevDe, ate] ──
  if (ate >= prevDe) {
    const [pr, pp] = await Promise.all([
      buscarParcelas(empresa, 'receita', prevDe, ate),
      buscarParcelas(empresa, 'despesa', prevDe, ate),
    ]);
    for (const p of [...pr, ...pp]) {
      const aberto = p.valorTotal - p.totalBaixado;
      if (aberto > 0.005 && p.dataVencimento >= prevDe && p.dataVencimento <= ate) {
        eventos.push({ id: p.id, data: p.dataVencimento, tipo: p.tipo, descricao: p.descricao, categoria: p.categoria, valor: aberto, previsto: true });
      }
    }
  }

  eventos.sort((a, b) => a.data.localeCompare(b.data));
  return eventos;
}

function linhasParaInserir(empresa: ContaCA, itens: ItemExtratoSalvo[]) {
  return itens.map((i, idx) => ({
    empresa,
    lancamento_id: i.id,
    data: i.data,
    tipo: i.tipo,
    categoria: i.categoria,
    descricao: i.descricao,
    valor: i.valor,
    saldo: i.saldo,
    ordem: idx,
    previsto: i.previsto ?? false,
  }));
}

async function inserirItens(rows: ReturnType<typeof linhasParaInserir>): Promise<void> {
  for (let k = 0; k < rows.length; k += 500) {
    const { error } = await supabaseAdmin.from('dre_extrato_item').insert(rows.slice(k, k + 500));
    if (error) throw new Error(`Falha ao salvar itens do extrato: ${error.message}`);
  }
}

/**
 * Gera o extrato COMPLETO do período [de, ate] e SUBSTITUI o extrato salvo da
 * empresa (apaga tudo e regrava). Usar para (re)construir/estender o histórico
 * ou trocar o saldo inicial. Para o dia a dia, use `atualizarExtratoRecente`.
 */
export async function gerarESalvarExtrato(
  empresa: ContaCA,
  de: string,
  ate: string,
  saldoInicialManual?: number,
  opts: { ignorarCache?: boolean } = {},
): Promise<ExtratoSalvo> {
  const eventos = await montarEventos(empresa, de, ate, opts);

  // Saldo inicial: usa o valor informado; se não vier, tenta o CA (que normalmente
  // não devolve saldo de data arbitrária) e cai para 0.
  const atrasados = await calcularAtrasados(empresa);
  const saldoInicial = saldoInicialManual != null && !Number.isNaN(saldoInicialManual)
    ? saldoInicialManual
    : await buscarSaldoInicial(empresa, de);

  let saldo = saldoInicial;
  const itens: ItemExtratoSalvo[] = eventos.map((it) => {
    saldo += it.tipo === 'receita' ? it.valor : -it.valor;
    return { id: it.id, data: it.data, tipo: it.tipo, descricao: it.descricao, categoria: it.categoria, valor: it.valor, saldo, previsto: it.previsto };
  });

  const atualizadoEm = new Date().toISOString();

  await supabaseAdmin.from('dre_extrato_item').delete().eq('empresa', empresa);
  const { error: eMeta } = await supabaseAdmin.from('dre_extrato').upsert(
    { empresa, periodo_de: de, periodo_ate: ate, saldo_inicial: saldoInicial, atualizado_em: atualizadoEm, atrasados },
    { onConflict: 'empresa' },
  );
  if (eMeta) throw new Error(`Falha ao salvar extrato: ${eMeta.message}`);

  await inserirItens(linhasParaInserir(empresa, itens));

  const totalReceitas = somaPorTipo(itens, 'receita');
  const totalDespesas = somaPorTipo(itens, 'despesa');
  return {
    empresa, periodoDe: de, periodoAte: ate, saldoInicial, atualizadoEm, itens,
    totalReceitas, totalDespesas,
    saldoFinal: saldoInicial + totalReceitas - totalDespesas, atrasados,
  };
}

/**
 * Atualização INCREMENTAL: congela o histórico e reprocessa só os últimos
 * MESES_REFRESH_RECENTE meses + todo o futuro (previsto). Rápido e preserva o
 * período completo salvo. O saldo continua a partir do último item congelado.
 * É o que o dia a dia e o cron usam. Retorna metadados (leve) ou null se não
 * houver extrato salvo — a tela recarrega os itens já filtrados à parte.
 */
export async function atualizarExtratoRecente(empresa: ContaCA, opts: { ignorarCache?: boolean } = {}): Promise<MetaExtrato | null> {
  const cfg = await lerConfigExtrato(empresa);
  if (!cfg) return null;

  const hoje = hojeISO();
  const limite = addMeses(hoje, -MESES_REFRESH_RECENTE);
  const refreshDe = cfg.periodoDe > limite ? cfg.periodoDe : limite; // max(periodoDe, hoje-2m)
  const ate = cfg.periodoAte;

  // Se a janela recente cobre o período inteiro, faz o completo (mais simples).
  if (refreshDe <= cfg.periodoDe) {
    const full = await gerarESalvarExtrato(empresa, cfg.periodoDe, cfg.periodoAte, cfg.saldoInicial, opts);
    return { periodoDe: full.periodoDe, periodoAte: full.periodoAte, atualizadoEm: full.atualizadoEm, atrasados: full.atrasados ?? null };
  }

  // Saldo base = saldo do último item congelado (data < refreshDe).
  const { data: ultimoAntigo } = await supabaseAdmin
    .from('dre_extrato_item')
    .select('saldo')
    .eq('empresa', empresa)
    .lt('data', refreshDe)
    .order('data', { ascending: false })
    .order('ordem', { ascending: false })
    .limit(1)
    .maybeSingle();
  const saldoBase = ultimoAntigo ? Number(ultimoAntigo.saldo) : cfg.saldoInicial;

  const eventos = await montarEventos(empresa, refreshDe, ate, opts);
  let saldo = saldoBase;
  const itens: ItemExtratoSalvo[] = eventos.map((it) => {
    saldo += it.tipo === 'receita' ? it.valor : -it.valor;
    return { id: it.id, data: it.data, tipo: it.tipo, descricao: it.descricao, categoria: it.categoria, valor: it.valor, saldo, previsto: it.previsto };
  });

  const atrasados = await calcularAtrasados(empresa);
  const atualizadoEm = new Date().toISOString();

  // Apaga só o recorte recente (data >= refreshDe) e reinsere; histórico intacto.
  const { error: eDel } = await supabaseAdmin.from('dre_extrato_item').delete().eq('empresa', empresa).gte('data', refreshDe);
  if (eDel) throw new Error(`Falha ao atualizar extrato: ${eDel.message}`);
  await inserirItens(linhasParaInserir(empresa, itens));
  await supabaseAdmin.from('dre_extrato').update({ atualizado_em: atualizadoEm, atrasados }).eq('empresa', empresa);

  // Devolve só os metadados; a tela recarrega os itens filtrados.
  return { periodoDe: cfg.periodoDe, periodoAte: cfg.periodoAte, atualizadoEm, atrasados };
}

/** Lê o extrato salvo (metadados + itens com saldo + atrasados). */
export async function lerExtratoSalvo(empresa: ContaCA): Promise<ExtratoSalvo | null> {
  const { data: meta } = await supabaseAdmin
    .from('dre_extrato')
    .select('*')
    .eq('empresa', empresa)
    .maybeSingle();
  if (!meta) return null;

  const itensDb = await selecionarTudoPaginado<Record<string, unknown>>((de, ate) =>
    supabaseAdmin
      .from('dre_extrato_item')
      .select('lancamento_id, data, tipo, descricao, categoria, valor, saldo, previsto')
      .eq('empresa', empresa)
      .order('data')
      .order('ordem')
      .range(de, ate),
  );

  const itens: ItemExtratoSalvo[] = itensDb.map((r: Record<string, unknown>) => ({
    id: (r.lancamento_id as string) ?? '',
    data: r.data as string,
    tipo: r.tipo as ItemExtratoSalvo['tipo'],
    descricao: (r.descricao as string) ?? '',
    categoria: (r.categoria as string) ?? '',
    valor: Number(r.valor),
    saldo: Number(r.saldo),
    previsto: Boolean(r.previsto),
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

export interface FiltroExtrato { de?: string; ate?: string; categoria?: string; busca?: string }

/**
 * Lê o extrato aplicando filtros (data, categoria, descrição) no banco. Retorna
 * só o recorte — essencial com histórico grande (não traz milhares de linhas à
 * toa). O `saldo` de cada item é absoluto (acumulado desde o saldo inicial), então
 * qualquer recorte mostra saldos corretos; `saldoFinal` = saldo do último item do
 * recorte; totais = somas do recorte.
 */
export async function lerExtratoFiltrado(empresa: ContaCA, filtro: FiltroExtrato): Promise<ExtratoSalvo | null> {
  const { data: meta } = await supabaseAdmin
    .from('dre_extrato')
    .select('*')
    .eq('empresa', empresa)
    .maybeSingle();
  if (!meta) return null;

  const itensDb = await selecionarTudoPaginado<Record<string, unknown>>((rDe, rAte) => {
    let q = supabaseAdmin
      .from('dre_extrato_item')
      .select('lancamento_id, data, tipo, descricao, categoria, valor, saldo, previsto')
      .eq('empresa', empresa);
    if (filtro.de) q = q.gte('data', filtro.de);
    if (filtro.ate) q = q.lte('data', filtro.ate);
    if (filtro.categoria) q = q.eq('categoria', filtro.categoria);
    if (filtro.busca) q = q.ilike('descricao', `%${filtro.busca}%`);
    return q.order('data').order('ordem').range(rDe, rAte);
  });

  const itens: ItemExtratoSalvo[] = itensDb.map((r: Record<string, unknown>) => ({
    id: (r.lancamento_id as string) ?? '',
    data: r.data as string,
    tipo: r.tipo as ItemExtratoSalvo['tipo'],
    descricao: (r.descricao as string) ?? '',
    categoria: (r.categoria as string) ?? '',
    valor: Number(r.valor),
    saldo: Number(r.saldo),
    previsto: Boolean(r.previsto),
  }));

  const saldoInicial = Number(meta.saldo_inicial);
  const totalReceitas = somaPorTipo(itens, 'receita');
  const totalDespesas = somaPorTipo(itens, 'despesa');
  const saldoFinal = itens.length > 0 ? itens[itens.length - 1].saldo : saldoInicial;

  return {
    empresa,
    periodoDe: meta.periodo_de as string,
    periodoAte: meta.periodo_ate as string,
    saldoInicial,
    atualizadoEm: meta.atualizado_em as string,
    itens,
    totalReceitas,
    totalDespesas,
    saldoFinal,
    atrasados: (meta.atrasados as AtrasadosResumo | null) ?? null,
  };
}

/** Lista as categorias distintas presentes no extrato (para o filtro). */
export async function lerCategoriasExtrato(empresa: ContaCA): Promise<string[]> {
  const rows = await selecionarTudoPaginado<{ categoria: string | null }>((rDe, rAte) =>
    supabaseAdmin.from('dre_extrato_item').select('categoria').eq('empresa', empresa).range(rDe, rAte),
  );
  const set = new Set<string>();
  for (const r of rows) if (r.categoria) set.add(r.categoria);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Lê a configuração do extrato salvo (período + saldo inicial) — usada pelo cron. */
export async function lerConfigExtrato(empresa: ContaCA): Promise<{ periodoDe: string; periodoAte: string; saldoInicial: number } | null> {
  const { data } = await supabaseAdmin
    .from('dre_extrato')
    .select('periodo_de, periodo_ate, saldo_inicial')
    .eq('empresa', empresa)
    .maybeSingle();
  if (!data) return null;
  return {
    periodoDe: data.periodo_de as string,
    periodoAte: data.periodo_ate as string,
    saldoInicial: Number(data.saldo_inicial),
  };
}

/**
 * Atualização INCREMENTAL noturna de cada empresa: congela o histórico e refaz
 * só a janela recente + futuro (via `atualizarExtratoRecente`). Com o cache de
 * baixas, fica barato mesmo com histórico grande. Rola a fronteira caixa/previsto
 * e traz novos pagamentos automaticamente.
 */
export async function atualizarExtratosDiario(): Promise<string> {
  const empresas: ContaCA[] = ['ass', 'netr'];
  const resultados: string[] = [];
  for (const emp of empresas) {
    try {
      const ext = await atualizarExtratoRecente(emp);
      resultados.push(ext ? `${emp}: ok (${ext.periodoDe}..${ext.periodoAte})` : `${emp}: sem extrato salvo`);
    } catch (e) {
      resultados.push(`${emp}: erro — ${(e as Error).message}`);
    }
  }
  return resultados.join(' | ');
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
  const data = await selecionarTudoPaginado<Record<string, unknown>>((rangeDe, rangeAte) =>
    supabaseAdmin
      .from('dre_extrato_item')
      .select('lancamento_id, data, tipo, categoria, descricao, valor')
      .eq('empresa', empresa)
      .neq('tipo', 'transferencia')
      .gte('data', de)
      .lte('data', ate)
      .order('data')
      .range(rangeDe, rangeAte),
  );

  return data.map((r: Record<string, unknown>) => ({
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
