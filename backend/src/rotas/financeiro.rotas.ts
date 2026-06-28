import { Router } from 'express';
import { autenticar } from '../middleware/auth';
import { parseCsvAss, parseCsvNetr } from '../modulos/financeiro/nfParser';
import { buscarNfsEmitidas } from '../modulos/financeiro/nfContaAzul';
import { calcularResultado } from '../modulos/financeiro/nfConferencia';
import { chamadaApi } from '../integracoes/contaAzul';
import { supabaseAdmin } from '../config/supabase';
import type { Empresa, NfPlanilha } from '../modulos/financeiro/nfTypes';

export const rotasFinanceiro = Router();

// ---------------------------------------------------------------------------
// Helpers de persistência da planilha
// ---------------------------------------------------------------------------

async function buscarPlanilhaSalva(empresa: Empresa, mes: number, ano: number) {
  const { data, error } = await supabaseAdmin
    .from('nf_planilha_salva')
    .select('itens, atualizado_em')
    .eq('empresa', empresa)
    .eq('mes', mes)
    .eq('ano', ano)
    .single();
  if (error || !data) return null;
  return data as { itens: NfPlanilha[]; atualizado_em: string };
}

async function salvarPlanilha(empresa: Empresa, mes: number, ano: number, itens: NfPlanilha[]) {
  const { error } = await supabaseAdmin
    .from('nf_planilha_salva')
    .upsert({ empresa, mes, ano, itens, atualizado_em: new Date().toISOString() }, { onConflict: 'empresa,mes,ano' });
  if (error) throw new Error(`Erro ao salvar planilha: ${error.message}`);
}

// ---------------------------------------------------------------------------
// GET /api/financeiro/nf/planilha/:empresa/:mes/:ano
// Verifica se existe planilha salva e retorna seus metadados.
// ---------------------------------------------------------------------------
rotasFinanceiro.get('/financeiro/nf/planilha/:empresa/:mes/:ano', autenticar, async (req, res) => {
  const { empresa, mes, ano } = req.params as { empresa: Empresa; mes: string; ano: string };
  const salva = await buscarPlanilhaSalva(empresa, Number(mes), Number(ano));
  if (!salva) { res.json(null); return; }
  res.json({ totalItens: salva.itens.length, atualizado_em: salva.atualizado_em });
});

// ---------------------------------------------------------------------------
// POST /api/financeiro/nf/conferir
// Upload de CSV → salva planilha no banco → busca CA → retorna resultado.
// ---------------------------------------------------------------------------
rotasFinanceiro.post('/financeiro/nf/conferir', autenticar, async (req, res) => {
  const { empresa, mes, ano, csv } = req.body as {
    empresa: Empresa; mes: number; ano: number; csv: string;
  };

  if (!empresa || !mes || !ano || !csv) {
    res.status(400).json({ erro: 'Campos obrigatórios: empresa, mes, ano, csv.' });
    return;
  }
  if (empresa !== 'ass' && empresa !== 'netr') {
    res.status(400).json({ erro: 'empresa deve ser "ass" ou "netr".' });
    return;
  }

  let planilha: NfPlanilha[];
  try {
    planilha = empresa === 'ass' ? parseCsvAss(csv) : parseCsvNetr(csv);
  } catch (e) {
    res.status(400).json({ erro: `Erro ao ler CSV: ${(e as Error).message}` });
    return;
  }

  // Salva planilha no banco (ignora erro para não bloquear a conferência)
  try { await salvarPlanilha(empresa, Number(mes), Number(ano), planilha); } catch (_) { /* ok */ }

  let nfsEmitidas: Awaited<ReturnType<typeof buscarNfsEmitidas>> = [];
  let erroApi: string | undefined;
  try {
    nfsEmitidas = await buscarNfsEmitidas(empresa, Number(mes), Number(ano));
  } catch (e) {
    erroApi = (e as Error).message;
  }

  res.json(calcularResultado(empresa, Number(mes), Number(ano), planilha, nfsEmitidas, erroApi));
});

// ---------------------------------------------------------------------------
// GET /api/financeiro/nf/conferir/:empresa/:mes/:ano
// Usa a planilha salva no banco + busca CA atualizado.
// ---------------------------------------------------------------------------
rotasFinanceiro.get('/financeiro/nf/conferir/:empresa/:mes/:ano', autenticar, async (req, res) => {
  const { empresa, mes, ano } = req.params as { empresa: Empresa; mes: string; ano: string };

  const salva = await buscarPlanilhaSalva(empresa, Number(mes), Number(ano));
  if (!salva) {
    res.status(404).json({ erro: 'Nenhuma planilha salva para este período. Faça o upload primeiro.' });
    return;
  }

  let nfsEmitidas: Awaited<ReturnType<typeof buscarNfsEmitidas>> = [];
  let erroApi: string | undefined;
  try {
    nfsEmitidas = await buscarNfsEmitidas(empresa, Number(mes), Number(ano));
  } catch (e) {
    erroApi = (e as Error).message;
  }

  res.json(calcularResultado(empresa, Number(mes), Number(ano), salva.itens, nfsEmitidas, erroApi));
});

// ---------------------------------------------------------------------------
// Debug — manter enquanto a conferência ainda está sendo ajustada
// ---------------------------------------------------------------------------

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
