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
  '/v1/pessoa',
  '/v1/notas-fiscais-servico',
  '/v1/notas-fiscais',
  '/v1/conta-receber',
  '/v1/lancamento',
  '/v1/venda',
];

rotasFinanceiro.get('/financeiro/debug/explorar/:empresa', autenticar, async (req, res) => {
  const conta = (req.params.empresa === 'ass' ? 'ass' : 'netr') as 'ass' | 'netr';

  async function testar(path: string): Promise<{ path: string; status: number; trecho: string }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await chamadaApi(conta, path, { page: '0', per_page: '1' });
      clearTimeout(timer);
      const texto = await r.text();
      return { path, status: r.status, trecho: texto.slice(0, 300) };
    } catch (e) {
      clearTimeout(timer);
      return { path, status: 0, trecho: (e as Error).message.slice(0, 200) };
    }
  }

  const resultados = await Promise.all(CANDIDATOS.map(testar));
  res.json(resultados);
});

/**
 * GET /api/financeiro/debug/amostra/:empresa
 * Retorna as primeiras 2 NFS-e do mês atual para inspecionar a estrutura.
 */
rotasFinanceiro.get('/financeiro/debug/amostra/:empresa', autenticar, async (req, res) => {
  const conta = (req.params.empresa === 'ass' ? 'ass' : 'netr') as 'ass' | 'netr';
  const hoje = new Date();
  const inicio = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
  const fim = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;

  try {
    const r = await chamadaApi(conta, '/v1/notas-fiscais-servico', {
      dataEmissaoInicio: inicio,
      dataEmissaoFim: fim,
      pagina: '0',
      tamanhoPagina: '2',
    });
    const texto = await r.text();
    res.json({ status: r.status, corpo: JSON.parse(texto) });
  } catch (e) {
    res.json({ erro: (e as Error).message });
  }
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
