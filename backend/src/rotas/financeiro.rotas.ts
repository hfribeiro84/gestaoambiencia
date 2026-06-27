import { Router } from 'express';
import { autenticar } from '../middleware/auth';
import { parseCsvAss, parseCsvNetr } from '../modulos/financeiro/nfParser';
import { buscarNfsEmitidas } from '../modulos/financeiro/nfContaAzul';
import { calcularResultado } from '../modulos/financeiro/nfConferencia';
import { chamadaApi } from '../integracoes/contaAzul';
import type { Empresa } from '../modulos/financeiro/nfTypes';

export const rotasFinanceiro = Router();

/**
 * GET /api/financeiro/debug/explorar/:empresa
 * Testa vários caminhos de API do Conta Azul e retorna status + trecho da resposta.
 * Usar só para diagnosticar o endpoint correto das NFs.
 */
const CANDIDATOS = [
  '/v1/service-invoices',
  '/v1/nota-fiscal',
  '/v1/nota-fiscal/nfse',
  '/v1/nfse',
  '/v1/invoices',
  '/v1/sales',
  '/v1/accounts-receivable',
  '/v1/contas-receber',
  '/v1/receivables',
  '/v1/financial/receivables',
];

rotasFinanceiro.get('/financeiro/debug/explorar/:empresa', autenticar, async (req, res) => {
  const conta = req.params.empresa === 'ass' ? 'ass' : 'netr';
  const resultados: { path: string; status: number; trecho: string }[] = [];

  for (const path of CANDIDATOS) {
    try {
      const r = await chamadaApi(conta as 'ass' | 'netr', path, { page: '0', per_page: '1' });
      const texto = await r.text();
      resultados.push({ path, status: r.status, trecho: texto.slice(0, 200) });
    } catch (e) {
      resultados.push({ path, status: 0, trecho: (e as Error).message });
    }
  }

  res.json(resultados);
});

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
