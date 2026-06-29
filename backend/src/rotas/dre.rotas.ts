import { Router } from 'express';
import type { Request, Response } from 'express';
import { autenticar } from '../middleware/auth';
import { supabaseAdmin } from '../config/supabase';
import { calcularDRE } from '../modulos/financeiro/dreCalculo';
import { buscarSaldoInicial, buscarTransferencias, buscarLancamentosCA } from '../modulos/financeiro/dreContaAzul';
import type { EmpresaDRE, ItemExtrato } from '../modulos/financeiro/dreTypes';

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

    await supabaseAdmin.from('dre_snapshot').insert({
      empresa,
      mes_ref: mes,
      ano_ref: ano,
      calculado_em: new Date().toISOString(),
      dados,
    });

    res.json(dados);
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
      .select('dados')
      .eq('empresa', empresa)
      .order('calculado_em', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    if (!data) {
      res.status(404).json({ erro: 'Nenhum snapshot encontrado.' });
      return;
    }
    res.json(data.dados);
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
      buscarLancamentosCA(conta, de, ate),
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
