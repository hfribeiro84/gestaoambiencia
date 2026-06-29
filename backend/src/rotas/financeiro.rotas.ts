import { Router } from 'express';
import { autenticar } from '../middleware/auth';
import { parseCsvAss, parseCsvNetr } from '../modulos/financeiro/nfParser';
import { buscarNfsEmitidas } from '../modulos/financeiro/nfContaAzul';
import { calcularResultado } from '../modulos/financeiro/nfConferencia';
import { chamadaApi } from '../integracoes/contaAzul';
import { supabaseAdmin } from '../config/supabase';
import type { Empresa, NfPlanilha, ResultadoConferencia, AssociacaoManual } from '../modulos/financeiro/nfTypes';
import { SEM_PAR } from '../modulos/financeiro/nfTypes';

export const rotasFinanceiro = Router();

// ---------------------------------------------------------------------------
// Helpers de persistência
// ---------------------------------------------------------------------------

async function buscarPlanilhaSalva(empresa: Empresa, mes: number, ano: number) {
  const { data, error } = await supabaseAdmin
    .from('nf_planilha_salva')
    .select('itens, aliquota_iss, atualizado_em, ultimo_resultado, resultado_em, associacoes_manuais')
    .eq('empresa', empresa).eq('mes', mes).eq('ano', ano)
    .single();
  if (error || !data) return null;
  return data as {
    itens: NfPlanilha[];
    aliquota_iss: number | null;
    atualizado_em: string;
    ultimo_resultado: ResultadoConferencia | null;
    resultado_em: string | null;
    associacoes_manuais: AssociacaoManual[];
  };
}

async function salvarPlanilha(
  empresa: Empresa, mes: number, ano: number,
  itens: NfPlanilha[], aliquotaISS: number,
) {
  const { error } = await supabaseAdmin
    .from('nf_planilha_salva')
    .upsert(
      { empresa, mes, ano, itens, aliquota_iss: aliquotaISS || null, atualizado_em: new Date().toISOString() },
      { onConflict: 'empresa,mes,ano' },
    );
  if (error) throw new Error(`Erro ao salvar planilha: ${error.message}`);
}

async function salvarResultado(empresa: Empresa, mes: number, ano: number, resultado: ResultadoConferencia) {
  await supabaseAdmin
    .from('nf_planilha_salva')
    .update({ ultimo_resultado: resultado, resultado_em: new Date().toISOString() })
    .eq('empresa', empresa).eq('mes', mes).eq('ano', ano);
}

async function salvarAssociacoes(empresa: Empresa, mes: number, ano: number, associacoes: AssociacaoManual[]) {
  await supabaseAdmin
    .from('nf_planilha_salva')
    .update({ associacoes_manuais: associacoes })
    .eq('empresa', empresa).eq('mes', mes).eq('ano', ano);
}

async function buscarCA(empresa: Empresa, mes: number, ano: number) {
  return buscarNfsEmitidas(empresa, mes, ano);
}

// ---------------------------------------------------------------------------
// GET /api/financeiro/nf/planilha/:empresa/:mes/:ano
// ---------------------------------------------------------------------------
rotasFinanceiro.get('/financeiro/nf/planilha/:empresa/:mes/:ano', autenticar, async (req, res) => {
  const { empresa, mes, ano } = req.params as { empresa: Empresa; mes: string; ano: string };
  try {
    const salva = await buscarPlanilhaSalva(empresa, Number(mes), Number(ano));
    if (!salva) { res.json(null); return; }
    res.json({
      totalItens: salva.itens.length,
      aliquotaISS: salva.aliquota_iss ?? 0,
      atualizado_em: salva.atualizado_em,
      ultimoResultado: salva.ultimo_resultado ?? null,
      resultado_em: salva.resultado_em ?? null,
    });
  } catch (e) {
    res.json(null);
  }
});

// ---------------------------------------------------------------------------
// POST /api/financeiro/nf/conferir  — upload CSV → salva → busca CA
// ---------------------------------------------------------------------------
rotasFinanceiro.post('/financeiro/nf/conferir', autenticar, async (req, res) => {
  const { empresa, mes, ano, csv, aliquotaISS = 0 } = req.body as {
    empresa: Empresa; mes: number; ano: number; csv: string; aliquotaISS?: number;
  };

  if (!empresa || !mes || !ano || !csv) {
    res.status(400).json({ erro: 'Campos obrigatórios: empresa, mes, ano, csv.' }); return;
  }
  if (empresa !== 'ass' && empresa !== 'netr') {
    res.status(400).json({ erro: 'empresa deve ser "ass" ou "netr".' }); return;
  }

  let planilha: NfPlanilha[];
  try {
    planilha = empresa === 'ass' ? parseCsvAss(csv) : parseCsvNetr(csv);
  } catch (e) {
    res.status(400).json({ erro: `Erro ao ler CSV: ${(e as Error).message}` }); return;
  }

  let erroSalvar: string | undefined;
  try {
    await salvarPlanilha(empresa, Number(mes), Number(ano), planilha, Number(aliquotaISS));
  } catch (e) {
    erroSalvar = (e as Error).message;
  }

  // Preserva associações manuais existentes ao substituir a planilha
  let assocExistentes: AssociacaoManual[] = [];
  try {
    const salva = await buscarPlanilhaSalva(empresa, Number(mes), Number(ano));
    assocExistentes = salva?.associacoes_manuais ?? [];
  } catch (_) {}

  let nfsEmitidas: Awaited<ReturnType<typeof buscarCA>> = [];
  let erroApi: string | undefined;
  try { nfsEmitidas = await buscarCA(empresa, Number(mes), Number(ano)); } catch (e) { erroApi = (e as Error).message; }

  try {
    const resultado = calcularResultado(
      empresa, Number(mes), Number(ano), planilha, nfsEmitidas,
      Number(aliquotaISS), erroApi, erroSalvar, assocExistentes,
    );
    salvarResultado(empresa, Number(mes), Number(ano), resultado).catch(() => {});
    res.json(resultado);
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/financeiro/nf/conferir/:empresa/:mes/:ano  — usa planilha salva
// ---------------------------------------------------------------------------
rotasFinanceiro.get('/financeiro/nf/conferir/:empresa/:mes/:ano', autenticar, async (req, res) => {
  const { empresa, mes, ano } = req.params as { empresa: Empresa; mes: string; ano: string };
  const aliquotaISS = Number(req.query.aliquotaISS ?? 0);

  try {
    const salva = await buscarPlanilhaSalva(empresa, Number(mes), Number(ano));
    if (!salva) {
      res.status(404).json({ erro: 'Nenhuma planilha salva para este período. Faça o upload primeiro.' }); return;
    }

    const aliquotaFinal = aliquotaISS || salva.aliquota_iss || 0;
    if (aliquotaISS && aliquotaISS !== salva.aliquota_iss) {
      try { await salvarPlanilha(empresa, Number(mes), Number(ano), salva.itens, aliquotaISS); } catch (_) { /* ok */ }
    }

    let nfsEmitidas: Awaited<ReturnType<typeof buscarCA>> = [];
    let erroApi: string | undefined;
    try { nfsEmitidas = await buscarCA(empresa, Number(mes), Number(ano)); } catch (e) { erroApi = (e as Error).message; }

    const resultado = calcularResultado(
      empresa, Number(mes), Number(ano), salva.itens, nfsEmitidas,
      aliquotaFinal, erroApi, undefined, salva.associacoes_manuais ?? [],
    );
    salvarResultado(empresa, Number(mes), Number(ano), resultado).catch(() => {});
    res.json(resultado);
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/financeiro/nf/associar  — cria / remove associação manual
// Body: { empresa, mes, ano, chaveItem, caId }
//   caId = null → remove associação do chaveItem
//   chaveItem e caId preenchidos → cria/substitui associação
// Retorna: ResultadoConferencia atualizado
// ---------------------------------------------------------------------------
rotasFinanceiro.post('/financeiro/nf/associar', autenticar, async (req, res) => {
  const { empresa, mes, ano, chaveItem, caId } = req.body as {
    empresa: Empresa; mes: number; ano: number; chaveItem: string; caId: string | null;
  };

  if (!empresa || !mes || !ano || !chaveItem) {
    res.status(400).json({ erro: 'Campos obrigatórios: empresa, mes, ano, chaveItem.' }); return;
  }

  try {
    const salva = await buscarPlanilhaSalva(empresa, Number(mes), Number(ano));
    if (!salva) { res.status(404).json({ erro: 'Planilha não encontrada.' }); return; }

    let assocs: AssociacaoManual[] = salva.associacoes_manuais ?? [];

    if (caId === null) {
      // Remove associação e marca SEM_PAR para bloquear o re-match automático.
      // Sem isso, o algoritmo simplesmente re-criaria o par na próxima rodada.
      assocs = assocs.filter((a) => a.chaveItem !== chaveItem);
      assocs.push({ chaveItem, caId: SEM_PAR });
    } else {
      // Remove quaisquer associações existentes envolvendo este item ou esta CA NF
      // (um item só pode ter um par; uma CA NF só pode ser par de um item)
      assocs = assocs.filter((a) => a.chaveItem !== chaveItem && a.caId !== caId);
      assocs.push({ chaveItem, caId });
    }

    await salvarAssociacoes(empresa, Number(mes), Number(ano), assocs);

    let nfsEmitidas: Awaited<ReturnType<typeof buscarCA>> = [];
    let erroApi: string | undefined;
    try { nfsEmitidas = await buscarCA(empresa, Number(mes), Number(ano)); } catch (e) { erroApi = (e as Error).message; }

    const aliquotaFinal = salva.aliquota_iss ?? 0;
    const resultado = calcularResultado(
      empresa, Number(mes), Number(ano), salva.itens, nfsEmitidas,
      aliquotaFinal, erroApi, undefined, assocs,
    );
    salvarResultado(empresa, Number(mes), Number(ano), resultado).catch(() => {});
    res.json(resultado);
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/financeiro/debug/matching/:empresa/:mes/:ano
// ---------------------------------------------------------------------------
rotasFinanceiro.get('/financeiro/debug/matching/:empresa/:mes/:ano', autenticar, async (req, res) => {
  const { empresa, mes, ano } = req.params as { empresa: Empresa; mes: string; ano: string };
  try {
    const salva = await buscarPlanilhaSalva(empresa, Number(mes), Number(ano));
    let nfsEmitidas: Awaited<ReturnType<typeof buscarCA>> = [];
    try { nfsEmitidas = await buscarCA(empresa, Number(mes), Number(ano)); } catch (_) {}

    res.json({
      planilha: (salva?.itens ?? []).slice(0, 5).map((p) => ({
        cliente: p.cliente,
        descricao: p.descricao,
        valorTotal: p.valorTotal,
        retencaoISS: p.retencaoISS,
      })),
      contaAzul: nfsEmitidas.slice(0, 5).map((ca) => ({
        cliente: ca.cliente,
        valor: ca.valor,
        numero: ca.numero,
      })),
    });
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Debug DRE
// ---------------------------------------------------------------------------

rotasFinanceiro.get('/financeiro/debug/dre/:empresa/:mes/:ano', autenticar, async (req, res) => {
  const conta = (req.params.empresa === 'ass' ? 'ass' : 'netr') as 'ass' | 'netr';
  const mes = req.params.mes.padStart(2, '0');
  const ano = req.params.ano;
  const de = `${ano}-${mes}-01`;
  const ate = `${ano}-${mes}-${String(new Date(Number(ano), Number(req.params.mes), 0).getDate()).padStart(2, '0')}`;

  async function explorar(endpoint: string, filtros: Record<string, string>) {
    try {
      const r = await chamadaApi(conta, endpoint, filtros);
      const texto = await r.text();
      let corpo: unknown;
      try { corpo = JSON.parse(texto); } catch { corpo = texto; }
      return { endpoint, status: r.status, corpo };
    } catch (e) {
      return { endpoint, status: 0, erro: (e as Error).message };
    }
  }

  const [receitas, despesas] = await Promise.all([
    explorar('/v1/financeiro/eventos-financeiros/contas-a-receber/buscar', { data_vencimento_de: de, data_vencimento_ate: ate, pagina: '1', tamanho_pagina: '10' }),
    explorar('/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar', { data_vencimento_de: de, data_vencimento_ate: ate, pagina: '1', tamanho_pagina: '10' }),
  ]);

  res.json({ de, ate, receitas, despesas });
});

const CANDIDATOS = ['/v1/pessoa', '/v1/notas-fiscais-servico', '/v1/notas-fiscais', '/v1/conta-receber', '/v1/lancamento', '/v1/venda'];

rotasFinanceiro.get('/financeiro/debug/explorar/:empresa', autenticar, async (req, res) => {
  const conta = (req.params.empresa === 'ass' ? 'ass' : 'netr') as 'ass' | 'netr';
  async function testar(path: string) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await chamadaApi(conta, path, { page: '0', per_page: '1' });
      clearTimeout(timer);
      return { path, status: r.status, trecho: (await r.text()).slice(0, 300) };
    } catch (e) {
      clearTimeout(timer);
      return { path, status: 0, trecho: (e as Error).message.slice(0, 200) };
    }
  }
  res.json(await Promise.all(CANDIDATOS.map(testar)));
});

rotasFinanceiro.post('/financeiro/debug/preview-csv', autenticar, async (req, res) => {
  const { empresa, csv } = req.body as { empresa: string; csv: string };
  try {
    const { parse } = await import('csv-parse/sync');
    const todasLinhas = parse(csv, { skip_empty_lines: false, relax_column_count: true, relax_quotes: true, bom: true }) as string[][];
    const cabecalho = todasLinhas.slice(0, 5).map((row: string[], i: number) => ({
      linha: i,
      colunas: row.map((v: string, j: number) => `[${j}]=${v.slice(0, 40)}`).join(' | '),
    }));
    const planilha = empresa === 'ass' ? parseCsvAss(csv) : parseCsvNetr(csv);
    res.json({ totalLinhas: todasLinhas.length, totalItens: planilha.length, cabecalho, primeiros3: planilha.slice(0, 3) });
  } catch (e) {
    res.json({ erro: (e as Error).message });
  }
});

rotasFinanceiro.get('/financeiro/debug/amostra/:empresa', autenticar, async (req, res) => {
  const conta = (req.params.empresa === 'ass' ? 'ass' : 'netr') as 'ass' | 'netr';
  const hoje = new Date();
  const inicio = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
  const fim = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  try {
    const r = await chamadaApi(conta, '/v1/notas-fiscais-servico', { data_competencia_de: inicio, data_competencia_ate: fim, pagina: '1', tamanho_pagina: '2' });
    res.json({ status: r.status, corpo: JSON.parse(await r.text()) });
  } catch (e) {
    res.json({ erro: (e as Error).message });
  }
});
