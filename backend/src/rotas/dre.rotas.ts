import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { autenticar } from '../middleware/auth';
import { supabaseAdmin } from '../config/supabase';
import { calcularDRE } from '../modulos/financeiro/dreCalculo';
import { buscarLancamentosCA } from '../modulos/financeiro/dreContaAzul';
import { gerarESalvarExtrato, lerExtratoSalvo, lerMetaExtrato } from '../modulos/financeiro/dreExtrato';
import { chamadaApi } from '../integracoes/contaAzul';
import { criarCliente } from '../integracoes/claude';
import type { EmpresaDRE, CategoriaCA, TipoCategoria } from '../modulos/financeiro/dreTypes';

const TIPOS_VALIDOS = new Set<TipoCategoria>(['receita', 'deducao', 'custo', 'despesa', 'financeiro', 'divisao']);
const FORMULAS_VALIDAS = new Set(['receita_liquida', 'resultado_operacional', 'resultado_liquido', 'fluxo_caixa_livre']);

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
// POST /financeiro/dre/categorias — cria categoria/subcategoria
// ──────────────────────────────────────────────────────────────
rotasDre.post('/financeiro/dre/categorias', autenticar, async (req: Request, res: Response) => {
  try {
    const { nome, pai_id, tipo, sinal } = req.body as {
      nome?: string; pai_id?: string | null; tipo?: TipoCategoria; sinal?: number;
    };

    if (!nome?.trim() || !tipo || !TIPOS_VALIDOS.has(tipo) || (sinal !== 1 && sinal !== -1)) {
      res.status(400).json({ erro: 'nome, tipo válido e sinal (1 ou -1) são obrigatórios.' });
      return;
    }

    const paiId = pai_id || null;
    const query = supabaseAdmin.from('dre_categoria').select('ordem');
    const { data: irmaos } = paiId ? await query.eq('pai_id', paiId) : await query.is('pai_id', null);
    const maxOrdem = (irmaos ?? []).reduce((m: number, r: { ordem: number }) => Math.max(m, r.ordem), 0);

    const { data, error } = await supabaseAdmin
      .from('dre_categoria')
      .insert({ id: randomUUID(), nome: nome.trim(), pai_id: paiId, tipo, sinal, ordem: maxOrdem + 1 })
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// PATCH /financeiro/dre/categorias/:id — edita nome/pai/tipo/sinal/ordem
// ──────────────────────────────────────────────────────────────
rotasDre.patch('/financeiro/dre/categorias/:id', autenticar, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { nome, pai_id, tipo, sinal, ordem } = req.body as {
      nome?: string; pai_id?: string | null; tipo?: TipoCategoria; sinal?: number; ordem?: number;
    };

    if (pai_id === id) {
      res.status(400).json({ erro: 'Uma categoria não pode ser pai de si mesma.' });
      return;
    }
    if (tipo !== undefined && !TIPOS_VALIDOS.has(tipo)) {
      res.status(400).json({ erro: 'Tipo inválido.' });
      return;
    }
    if (sinal !== undefined && sinal !== 1 && sinal !== -1) {
      res.status(400).json({ erro: 'Sinal deve ser 1 ou -1.' });
      return;
    }

    const patch: Record<string, unknown> = {};
    if (nome !== undefined) patch.nome = nome.trim();
    if (pai_id !== undefined) patch.pai_id = pai_id || null;
    if (tipo !== undefined) patch.tipo = tipo;
    if (sinal !== undefined) patch.sinal = sinal;
    if (ordem !== undefined) patch.ordem = ordem;

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ erro: 'Nada para atualizar.' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('dre_categoria')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// DELETE /financeiro/dre/categorias/:id
// ──────────────────────────────────────────────────────────────
rotasDre.delete('/financeiro/dre/categorias/:id', autenticar, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { count: countFilhos } = await supabaseAdmin
      .from('dre_categoria')
      .select('id', { count: 'exact', head: true })
      .eq('pai_id', id);
    if ((countFilhos ?? 0) > 0) {
      res.status(400).json({ erro: 'Mova ou exclua as subcategorias antes de excluir esta categoria.' });
      return;
    }

    const { count: countMap } = await supabaseAdmin
      .from('dre_mapeamento')
      .select('id', { count: 'exact', head: true })
      .eq('categoria_id', id);
    if ((countMap ?? 0) > 0) {
      res.status(400).json({ erro: `Existe(m) ${countMap} mapeamento(s) usando esta categoria. Remova-os primeiro.` });
      return;
    }

    const { error } = await supabaseAdmin.from('dre_categoria').delete().eq('id', id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
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
// POST /financeiro/dre/extrato/:empresa  (body: { de, ate })
// Busca o período completo no Conta Azul, calcula o saldo corrente e SALVA no
// banco (substituindo). Essa tabela vira a base de dados da DRE.
// ──────────────────────────────────────────────────────────────
rotasDre.post('/financeiro/dre/extrato/:empresa', autenticar, async (req: Request, res: Response) => {
  try {
    const { empresa } = req.params;
    const { de, ate } = req.body as { de?: string; ate?: string };

    if (empresa !== 'ass' && empresa !== 'netr') {
      res.status(400).json({ erro: 'Use ass ou netr para o extrato.' });
      return;
    }
    if (!de || !ate) {
      res.status(400).json({ erro: 'Informe as datas de início (de) e fim (ate).' });
      return;
    }
    if (de > ate) {
      res.status(400).json({ erro: 'A data inicial não pode ser maior que a final.' });
      return;
    }

    const extrato = await gerarESalvarExtrato(empresa, de, ate);
    res.json(extrato);
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /financeiro/dre/extrato/:empresa  — extrato salvo (metadados + itens)
// ──────────────────────────────────────────────────────────────
rotasDre.get('/financeiro/dre/extrato/:empresa', autenticar, async (req: Request, res: Response) => {
  try {
    const { empresa } = req.params;
    if (empresa !== 'ass' && empresa !== 'netr') {
      res.status(400).json({ erro: 'Use ass ou netr para o extrato.' });
      return;
    }
    res.json(await lerExtratoSalvo(empresa));
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /financeiro/dre/extrato-meta/:empresa  — só período + atualização
// (consolidado usa o extrato da ASS como referência de período)
// ──────────────────────────────────────────────────────────────
rotasDre.get('/financeiro/dre/extrato-meta/:empresa', autenticar, async (req: Request, res: Response) => {
  try {
    const { empresa } = req.params;
    if (!empresaValida(empresa)) {
      res.status(400).json({ erro: 'Empresa inválida.' });
      return;
    }
    res.json(await lerMetaExtrato(contaCA(empresa)));
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
// GET /financeiro/dre/subtotais
// ──────────────────────────────────────────────────────────────
rotasDre.get('/financeiro/dre/subtotais', autenticar, async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('dre_subtotal')
      .select('*')
      .order('apos_tipo')
      .order('ordem');
    if (error) throw new Error(error.message);
    res.json(data ?? []);
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// POST /financeiro/dre/subtotais
// ──────────────────────────────────────────────────────────────
rotasDre.post('/financeiro/dre/subtotais', autenticar, async (req: Request, res: Response) => {
  try {
    const { nome, formula, apos_tipo } = req.body as { nome?: string; formula?: string; apos_tipo?: string };
    if (!nome?.trim() || !formula || !FORMULAS_VALIDAS.has(formula) || !apos_tipo || !TIPOS_VALIDOS.has(apos_tipo as TipoCategoria)) {
      res.status(400).json({ erro: 'nome, formula válida e apos_tipo válido são obrigatórios.' });
      return;
    }
    const { data: irmaos } = await supabaseAdmin
      .from('dre_subtotal')
      .select('ordem')
      .eq('apos_tipo', apos_tipo);
    const maxOrdem = (irmaos ?? []).reduce((m: number, r: { ordem: number }) => Math.max(m, r.ordem), 0);
    const { data, error } = await supabaseAdmin
      .from('dre_subtotal')
      .insert({ nome: nome.trim(), formula, apos_tipo, ordem: maxOrdem + 1 })
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// PATCH /financeiro/dre/subtotais/:id
// ──────────────────────────────────────────────────────────────
rotasDre.patch('/financeiro/dre/subtotais/:id', autenticar, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { nome, formula, apos_tipo, ordem } = req.body as { nome?: string; formula?: string; apos_tipo?: string; ordem?: number };
    if (formula !== undefined && !FORMULAS_VALIDAS.has(formula)) {
      res.status(400).json({ erro: 'Fórmula inválida.' });
      return;
    }
    const patch: Record<string, unknown> = {};
    if (nome !== undefined) patch.nome = nome.trim();
    if (formula !== undefined) patch.formula = formula;
    if (apos_tipo !== undefined) patch.apos_tipo = apos_tipo;
    if (ordem !== undefined) patch.ordem = ordem;
    if (Object.keys(patch).length === 0) { res.status(400).json({ erro: 'Nada para atualizar.' }); return; }
    const { data, error } = await supabaseAdmin
      .from('dre_subtotal')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// DELETE /financeiro/dre/subtotais/:id
// ──────────────────────────────────────────────────────────────
rotasDre.delete('/financeiro/dre/subtotais/:id', autenticar, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin.from('dre_subtotal').delete().eq('id', id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
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

    async function testar(endpoint: string) {
      const r = await chamadaApi(conta, endpoint, {
        data_vencimento_de: de, data_vencimento_ate: ate, pagina: '1', tamanho_pagina: '10',
      });
      const texto = await r.text();
      let corpo: unknown;
      try { corpo = JSON.parse(texto); } catch { corpo = texto.slice(0, 300); }
      return { status: r.status, corpo };
    }

    const [respRec, respDesp] = await Promise.all([
      testar('/v1/financeiro/eventos-financeiros/contas-a-receber/buscar'),
      testar('/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar'),
    ]);

    res.json({
      empresa, mes, ano, de, ate,
      receitas: respRec,
      despesas: respDesp,
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

// ──────────────────────────────────────────────────────────────
// GET /financeiro/dre/debug/extrato-diag/:empresa  (TEMPORÁRIO, público)
// Diagnostica: (1) resposta crua do saldo inicial; (2) se o CA devolve parcelas
// com vencimento futuro além de ~1 mês.
// ──────────────────────────────────────────────────────────────
rotasDre.get('/financeiro/dre/debug/extrato-diag/:empresa', async (req: Request, res: Response) => {
  try {
    const { empresa } = req.params;
    if (empresa !== 'ass' && empresa !== 'netr') {
      res.status(400).json({ erro: 'Use ass ou netr.' });
      return;
    }
    const conta = contaCA(empresa);
    const hoje = new Date().toISOString().slice(0, 10);
    const [y, m, d] = hoje.split('-').map(Number);
    const mais18 = new Date(Date.UTC(y, m - 1 + 18, d)).toISOString().slice(0, 10);

    // (1) Saldo inicial — sonda candidatos e mostra a resposta crua.
    const saldoCand: Array<{ ep: string; params: Record<string, string> }> = [
      { ep: '/v1/financeiro/eventos-financeiros/saldo-inicial', params: { data_inicio: hoje, data_fim: hoje } },
      { ep: '/v1/financeiro/contas-financeiras', params: {} },
      { ep: '/v1/financeiro/saldo', params: { data: hoje } },
    ];
    const saldos: Record<string, unknown>[] = [];
    for (const c of saldoCand) {
      try {
        const r = await chamadaApi(conta, c.ep, c.params);
        const t = await r.text();
        let corpo: unknown;
        try { corpo = JSON.parse(t); } catch { corpo = t.slice(0, 300); }
        saldos.push({ ep: c.ep, status: r.status, corpo });
      } catch (e) {
        saldos.push({ ep: c.ep, erro: (e as Error).message });
      }
    }

    // (2) Parcelas a pagar com vencimento de hoje até +18 meses.
    let futuras: Record<string, unknown>;
    try {
      const r = await chamadaApi(conta, '/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar', {
        data_vencimento_de: hoje, data_vencimento_ate: mais18, pagina: '1', tamanho_pagina: '200',
      });
      const b = JSON.parse(await r.text()) as { itens?: Record<string, unknown>[]; itens_totais?: number };
      const itens = b.itens ?? [];
      const vencs = itens.map((i) => String(i.data_vencimento ?? '')).filter(Boolean).sort();
      futuras = {
        status: r.status,
        itens_totais: b.itens_totais,
        qtdRetornada: itens.length,
        vencMin: vencs[0] ?? null,
        vencMax: vencs[vencs.length - 1] ?? null,
        amostra: itens.slice(0, 3).map((i) => ({ desc: i.descricao, venc: i.data_vencimento, status: i.status_traduzido, pago: i.pago, total: i.total })),
      };
    } catch (e) {
      futuras = { erro: (e as Error).message };
    }

    res.json({ empresa, hoje, mais18, saldos, futuras });
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /financeiro/dre/debug/parcelas/:empresa/:mes/:ano
// Inspeciona o schema cru de contas-a-receber (parcelas + baixas) para
// confirmar os nomes dos campos de baixa/pagamento na API do CA.
// ──────────────────────────────────────────────────────────────
rotasDre.get('/financeiro/dre/debug/parcelas/:empresa/:mes/:ano', autenticar, async (req: Request, res: Response) => {
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

    // 1) Pega uma parcela paga do endpoint que já funciona.
    const rP = await chamadaApi(conta, '/v1/financeiro/eventos-financeiros/contas-a-receber/buscar', {
      data_vencimento_de: de, data_vencimento_ate: ate, pagina: '1', tamanho_pagina: '50',
    });
    const corpoP = JSON.parse(await rP.text()) as { itens?: Record<string, unknown>[] };
    const itens = corpoP.itens ?? [];
    const paga = itens.find((i) => Number(i.pago) > 0) ?? itens[0];
    const pid = paga ? String(paga.id) : null;

    // 2) Sonda os caminhos de baixa dessa parcela para achar data de pagamento.
    const candidatosBaixa = pid ? [
      `/v1/financeiro/eventos-financeiros/parcelas/${pid}/baixa`,
      `/v1/financeiro/eventos-financeiros/parcelas/${pid}/baixas`,
      `/v1/financeiro/eventos-financeiros/parcelas/${pid}`,
    ] : [];

    const baixas = [] as Record<string, unknown>[];
    for (const endpoint of candidatosBaixa) {
      try {
        const r = await chamadaApi(conta, endpoint);
        const texto = await r.text();
        let corpo: unknown;
        try { corpo = JSON.parse(texto); } catch { corpo = texto.slice(0, 200); }
        // A resposta pode ser array, {itens:[...]}, ou objeto com baixas dentro.
        let amostra: unknown = corpo;
        if (Array.isArray(corpo)) amostra = corpo[0];
        else if (corpo && typeof corpo === 'object') {
          const o = corpo as Record<string, unknown>;
          amostra = (o.itens as unknown[])?.[0] ?? (o.baixas as unknown[])?.[0] ?? o;
        }
        baixas.push({
          endpoint,
          status: r.status,
          chavesDaResposta: corpo && typeof corpo === 'object' ? Object.keys(corpo as object) : [],
          chavesDaBaixa: amostra && typeof amostra === 'object' ? Object.keys(amostra as object) : [],
          amostra,
        });
      } catch (e) {
        baixas.push({ endpoint, erro: (e as Error).message });
      }
    }

    res.json({
      empresa, mes, ano,
      parcelaTestada: paga ? { id: pid, pago: paga.pago, status_traduzido: paga.status_traduzido } : null,
      baixas,
    });
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});
