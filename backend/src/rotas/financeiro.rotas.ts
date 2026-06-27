import { Router } from 'express';
import { autenticar } from '../middleware/auth';
import { parseCsvAss, parseCsvNetr } from '../modulos/financeiro/nfParser';
import { buscarNfsEmitidas } from '../modulos/financeiro/nfContaAzul';
import { calcularResultado } from '../modulos/financeiro/nfConferencia';
import type { Empresa } from '../modulos/financeiro/nfTypes';

export const rotasFinanceiro = Router();

/**
 * POST /api/financeiro/nf/conferir
 * Body: { empresa: 'ass'|'netr', mes: number, ano: number, csv: string }
 */
rotasFinanceiro.post('/financeiro/nf/conferir', autenticar, async (req, res) => {
  const { empresa, mes, ano, csv } = req.body as {
    empresa: Empresa;
    mes: number;
    ano: number;
    csv: string;
  };

  if (!empresa || !mes || !ano || !csv) {
    res.status(400).json({ erro: 'Campos obrigatórios: empresa, mes, ano, csv.' });
    return;
  }
  if (empresa !== 'ass' && empresa !== 'netr') {
    res.status(400).json({ erro: 'empresa deve ser "ass" ou "netr".' });
    return;
  }

  // Parseia o CSV
  let planilha;
  try {
    planilha = empresa === 'ass' ? parseCsvAss(csv) : parseCsvNetr(csv);
  } catch (e) {
    res.status(400).json({ erro: `Erro ao ler CSV: ${(e as Error).message}` });
    return;
  }

  // Busca NFs no Conta Azul (best-effort — erro não bloqueia a resposta)
  let nfsEmitidas: Awaited<ReturnType<typeof buscarNfsEmitidas>> = [];
  let erroApi: string | undefined;
  try {
    nfsEmitidas = await buscarNfsEmitidas(empresa, Number(mes), Number(ano));
  } catch (e) {
    erroApi = (e as Error).message;
  }

  const resultado = calcularResultado(empresa, Number(mes), Number(ano), planilha, nfsEmitidas, erroApi);
  res.json(resultado);
});
