import { Router } from 'express';
import type { Request, Response } from 'express';
import { autenticar } from '../middleware/auth';
import { supabaseAdmin } from '../config/supabase';
import { calcularDRE } from '../modulos/financeiro/dreCalculo';
import { buscarSaldoInicial, buscarTransferencias, buscarLancamentosCA, buscarLancamentosExtrato } from '../modulos/financeiro/dreContaAzul';
import { chamadaApi } from '../integracoes/contaAzul';
import { criarCliente } from '../integracoes/claude';
import type { EmpresaDRE, ItemExtrato, CategoriaCA } from '../modulos/financeiro/dreTypes';

export const rotasDre = Router();

function empresaValida(e: string): e is EmpresaDRE {
  return e === 'ass' || e === 'netr' || e === 'consolidado';
}

function contaCA(empresa: string): 'ass' | 'netr' {
  return empresa === 'netr' ? 'netr' : 'ass';
}

function primeiroDia(mes: number, ano: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}-01`;
}

function ultimoDia(mes: number, ano: number): string {
  const d = new Date(ano, mes, 0).getDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ──────────────────────────────────────────────────────────────
// GET /financeiro/dre/categorias
// ──────────────────────────────────────────────────────────────
rotasDre.get('/financeiro/dre/categorias', autenticar, async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('dre_categoria')
      .select('*')
      .order('ordem');
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /financeiro/dre/mapeamento/:empresa
// ──────────────────────────────────────────────────────────────
rotasDre.get('/financeiro/dre/mapeamento/:empresa', autenticar, async (req: Request, res: Response) => {
  try {
    const { empresa } = req.params;
    const { data, error } = await supabaseAdmin
      .from('dre_mapeamento')
      .select('*, dre_categoria(nome)')
      .eq('empresa', empresa)
      .order('nome_ca');
    if (error) throw new Error(error.message);

    const resultado = (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id,
      empresa: row.empresa,
      nome_ca: row.nome_ca,
      categoria_id: row.categoria_id,
      categoria_nome: (row.dre_categoria as Record<string, unknown> | null)?.nome ?? null,
    }));
    res.json(resultado);
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// POST /financeiro/dre/mapeamento/:empresa
// ──────────────────────────────────────────────────────────────
rotasDre.post('/financeiro/dre/mapeamento/:empresa', autenticar, async (req: Request, res: Response) => {
  try {
    const { empresa } = req.params;
    const { nome_ca, categoria_id } = req.body as { nome_ca: string; categoria_id: string };

    if (!nome_ca || !categoria_id) {
      res.status(400).json({ erro: 'nome_ca e categoria_id são obrigatórios.' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('dre_mapeamento')
      .upsert({ empresa, nome_ca, categoria_id }, { onConflict: 'empresa,nome_ca' })
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// DELETE /financeiro/dre/mapeamento/:empresa/:id
// ──────────────────────────────────────────────────────────────
rotasDre.delete('/financeiro/dre/mapeamento/:empresa/:id', autenticar, async (req: Request, res: Response) => {
  try {
    const { empresa, id } = req.params;
    const { error } = await supabaseAdmin
      .from('dre_mapeamento')
      .delete()
      .eq('id', id)
      .eq('empresa', empresa);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// POST /financeiro/dre/calcular/:empresa/:mes/:ano
// ──────────────────────────────────────────────────────────────
rotasDre.post('/financeiro/dre/calcular/:empresa/:mes/:ano', autenticar, async (req: Request, res: Response) => {
  try {
    const { empresa } = req.params;
    const mes = parseInt(req.params.mes, 10);
    const ano = parseInt(req.params.ano, 10);

    if (!empresaValida(empresa)) {
      res.status(400).json({ erro: 'Empresa inválida. Use: ass | netr | consolidado' });
      return;
    }

    const dados = await calcularDRE(empresa, mes, ano);
    const calculado_em = new Date().toISOString();

    const { data: saved } = await supabaseAdmin
      .from('dre_snapshot')
      .insert({ empresa, mes_ref: mes, ano_ref: ano, calculado_em, dados })
      .select('id, empresa, mes_ref, ano_ref, calculado_em')
      .single();

    res.json({ ...(saved ?? { id: '', empresa, mes_ref: mes, ano_ref: ano, calculado_em }), dados });
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /financeiro/dre/ultimo/:empresa
// ──────────────────────────────────────────────────────────────
rotasDre.get('/financeiro/dre/ultimo/:empresa', autenticar, async (req: Request, res: Response) => {
  try {
    const { empresa } = req.params;
    const { data, error } = await supabaseAdmin
      .from('dre_snapshot')
      .select('*')
      .eq('empresa', empresa)
      .order('calculado_em', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    if (!data) {
      res.json(null);
      return;
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /financeiro/dre/snapshots/:empresa
// ──────────────────────────────────────────────────────────────
rotasDre.get('/financeiro/dre/snapshots/:empresa', autenticar, async (req: Request, res: Response) => {
  try {
    const { empresa } = req.params;
    const { data, error } = await supabaseAdmin
      .from('dre_snapshot')
      .select('id, mes_ref, ano_ref, calculado_em')
      .eq('empresa', empresa)
      .order('calculado_em', { ascending: false });

    if (error) throw new Error(error.message);
    res.json(data ?? []);
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// DELETE /financeiro/dre/snapshots/:empresa/:id
// ──────────────────────────────────────────────────────────────
rotasDre.delete('/financeiro/dre/snapshots/:empresa/:id', autenticar, async (req: Request, res: Response) => {
  try {
    const { empresa, id } = req.params;
    const { error } = await supabaseAdmin
      .from('dre_snapshot')
      .delete()
      .eq('id', id)
      .eq('empresa', empresa);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /financeiro/dre/extrato/:empresa/:mes/:ano
// ──────────────────────────────────────────────────────────────
rotasDre.get('/financeiro/dre/extrato/:empresa/:mes/:ano', autenticar, async (req: Request, res: Response) => {
  try {
    const { empresa } = req.params;
    const mes = parseInt(req.params.mes, 10);
    const ano = parseInt(req.params.ano, 10);

    if (!empresaValida(empresa) || empresa === 'consolidado') {
      res.status(400).json({ erro: 'Use ass ou netr para o extrato.' });
      return;
    }

    const conta = contaCA(empresa);
    const de = primeiroDia(mes, ano);
    const ate = ultimoDia(mes, ano);

    const [saldoInicial, transferencias, lancamentos] = await Promise.all([
      buscarSaldoInicial(conta, de),
      buscarTransferencias(conta, de, ate),
      buscarLancamentosExtrato(conta, de, ate),
    ]);

    const itens: ItemExtrato[] = [
      ...lancamentos.map((l) => ({
        id: l.id,
        data: l.dataPagamento ?? l.dataVencimento,
        tipo: l.tipo as 'receita' | 'despesa',
        descricao: l.descricao,
        categoria: l.categoria,
        valor: l.valor,
      })),
      ...transferencias,
    ].sort((a, b) => a.data.localeCompare(b.data));

    const totalReceitas = itens
      .filter((i) => i.tipo === 'receita')
      .reduce((acc, i) => acc + i.valor, 0);
    const totalDespesas = itens
      .filter((i) => i.tipo === 'despesa')
      .reduce((acc, i) => acc + i.valor, 0);

    res.json({
      empresa,
      mes,
      ano,
      saldoInicial,
      itens,
      totalReceitas,
      totalDespesas,
      saldoFinal: saldoInicial + totalReceitas - totalDespesas,
    });
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /financeiro/dre/categorias-ca/:empresa
// Retorna categorias distintas do CA nos últimos 12 meses (para mapeamento)
// ──────────────────────────────────────────────────────────────
rotasDre.get('/financeiro/dre/categorias-ca/:empresa', autenticar, async (req: Request, res: Response) => {
  try {
    const { empresa } = req.params;
    if (!empresaValida(empresa) || empresa === 'consolidado') {
      res.status(400).json({ erro: 'Use ass ou netr.' });
      return;
    }
    const conta = contaCA(empresa);
    const hoje = new Date();
    const anoRef = hoje.getFullYear();
    const mesRef = hoje.getMonth() + 1;

    // Janela: últimos 12 meses
    const ateDate = new Date(anoRef, mesRef - 1 + 1, 0);
    const deDate = new Date(anoRef, mesRef - 1 - 11, 1);
    const de = deDate.toISOString().slice(0, 10);
    const ate = ateDate.toISOString().slice(0, 10);

    const lancamentos = await buscarLancamentosCA(conta, de, ate);

    const mapa = new Map<string, CategoriaCA>();
    for (const l of lancamentos) {
      if (!l.categoria) continue;
      const existente = mapa.get(l.categoria);
      if (existente) {
        existente.total += Math.abs(l.valor);
        existente.count++;
      } else {
        mapa.set(l.categoria, { nome: l.categoria, tipo: l.tipo, total: Math.abs(l.valor), count: 1 });
      }
    }

    const resultado = Array.from(mapa.values()).sort((a, b) => a.nome.localeCompare(b.nome));
    res.json(resultado);
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /financeiro/dre/resumo/:empresa
// Gera resumo executivo com IA a partir do último snapshot
// ──────────────────────────────────────────────────────────────
rotasDre.get('/financeiro/dre/resumo/:empresa', autenticar, async (req: Request, res: Response) => {
  try {
    const { empresa } = req.params;
    if (!empresaValida(empresa)) {
      res.status(400).json({ erro: 'Empresa inválida.' });
      return;
    }

    const { data: snap, error } = await supabaseAdmin
      .from('dre_snapshot')
      .select('*')
      .eq('empresa', empresa)
      .order('calculado_em', { ascending: false })
      .limit(1)
      .single();

    if (error || !snap) {
      res.status(404).json({ erro: 'Calcule o DRE primeiro.' });
      return;
    }

    const claude = await criarCliente();
    if (!claude) {
      res.status(503).json({ erro: 'API do Claude não configurada.' });
      return;
    }

    const dados = snap.dados as Record<string, unknown>;
    const totais = dados.totais as Record<string, Array<{ mes: number; ano: number; valor: number }>>;
    const mesRef = dados.mesRef as number;
    const anoRef = dados.anoRef as number;
    const nomeEmpresa = empresa === 'ass' ? 'Ambiência (ASS)' : empresa === 'netr' ? 'NETResíduos (NETR)' : 'Consolidado';

    function somaRef(serie: Array<{ mes: number; ano: number; valor: number }>) {
      return serie?.find((v) => v.mes === mesRef && v.ano === anoRef)?.valor ?? 0;
    }
    function soma12(serie: Array<{ mes: number; ano: number; valor: number }>) {
      return serie?.reduce((s, v) => s + v.valor, 0) ?? 0;
    }
    function brl(v: number) {
      return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    const rb = somaRef(totais.receitaBruta);
    const rl = somaRef(totais.receitaLiquida);
    const ro = somaRef(totais.resultadoOperacional);
    const rLiq = somaRef(totais.resultadoLiquido);
    const fc = somaRef(totais.fluxoCaixaLivre);
    const rb12 = soma12(totais.receitaBruta);
    const ro12 = soma12(totais.resultadoOperacional);

    const naoMapeadasNomes = (dados.naoMapeadas as string[] | undefined) ?? [];
    const mesesNomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

    const prompt = `Você é um consultor financeiro analisando o DRE gerencial da empresa ${nomeEmpresa}.

Dados do mês de referência ${mesesNomes[mesRef - 1]}/${anoRef}:
- Receita Bruta: ${brl(rb)}
- Receita Líquida: ${brl(rl)}
- Resultado Operacional: ${brl(ro)} (${rb !== 0 ? ((ro / rb) * 100).toFixed(1) : '0'}% da receita bruta)
- Resultado Líquido: ${brl(rLiq)}
- Fluxo de Caixa Livre: ${brl(fc)}

Acumulado 12 meses:
- Receita Bruta total: ${brl(rb12)}
- Resultado Operacional total: ${brl(ro12)} (${rb12 !== 0 ? ((ro12 / rb12) * 100).toFixed(1) : '0'}% da receita)

${naoMapeadasNomes.length > 0 ? `Categorias sem mapeamento (${naoMapeadasNomes.length}): ${naoMapeadasNomes.join(', ')}` : 'Todas as categorias estão mapeadas.'}

Escreva um resumo executivo em português com:
1. Um parágrafo curto (2-3 frases) com a visão geral do mês
2. 3-4 pontos de atenção ou destaques (use "•" como marcador)
3. Uma recomendação prática

Seja direto, use linguagem de gestão, sem repetir números que já aparecem nos cards.`;

    const resp = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });

    const texto = resp.content.find((c) => c.type === 'text');
    res.json({ resumo: texto?.type === 'text' ? texto.text : '' });
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /financeiro/dre/debug/raw/:empresa/:mes/:ano
// Resposta bruta do CA (sem parsing) — para diagnóstico
// ──────────────────────────────────────────────────────────────
rotasDre.get('/financeiro/dre/debug/raw/:empresa/:mes/:ano', autenticar, async (req: Request, res: Response) => {
  try {
    const { empresa } = req.params;
    const mes = parseInt(req.params.mes, 10);
    const ano = parseInt(req.params.ano, 10);
    if (!empresaValida(empresa) || empresa === 'consolidado') {
      res.status(400).json({ erro: 'Use ass ou netr.' });
      return;
    }
    const conta = contaCA(empresa);
    const de = primeiroDia(mes, ano);
    const ate = ultimoDia(mes, ano);

    const [respRec, respDesp] = await Promise.all([
      chamadaApi(conta, '/v1/searchinstallmentstoreceivebyfilter', {
        dataVencimentoInicio: de, dataVencimentoFim: ate, pagina: '1', tamanho_pagina: '3',
      }),
      chamadaApi(conta, '/v1/searchinstallmentstopaybyfilter', {
        dataVencimentoInicio: de, dataVencimentoFim: ate, pagina: '1', tamanho_pagina: '3',
      }),
    ]);

    const [rawRec, rawDesp] = await Promise.all([
      respRec.json().catch(() => `HTTP ${respRec.status}`),
      respDesp.json().catch(() => `HTTP ${respDesp.status}`),
    ]);

    res.json({
      empresa, mes, ano, de, ate,
      receitas: { status: respRec.status, corpo: rawRec },
      despesas: { status: respDesp.status, corpo: rawDesp },
    });
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /financeiro/dre/debug/amostra/:empresa/:mes/:ano
// ──────────────────────────────────────────────────────────────
rotasDre.get('/financeiro/dre/debug/amostra/:empresa/:mes/:ano', autenticar, async (req: Request, res: Response) => {
  try {
    const { empresa } = req.params;
    const mes = parseInt(req.params.mes, 10);
    const ano = parseInt(req.params.ano, 10);

    if (!empresaValida(empresa) || empresa === 'consolidado') {
      res.status(400).json({ erro: 'Use ass ou netr para debug.' });
      return;
    }

    const conta = contaCA(empresa);
    const de = primeiroDia(mes, ano);
    const ate = ultimoDia(mes, ano);
    const lancamentos = await buscarLancamentosCA(conta, de, ate);

    const receitas = lancamentos.filter((l) => l.tipo === 'receita').slice(0, 2);
    const despesas = lancamentos.filter((l) => l.tipo === 'despesa').slice(0, 2);

    res.json({ empresa, mes, ano, amostraReceitas: receitas, amostraDespesas: despesas });
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});
