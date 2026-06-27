/**
 * Rotas das integrações.
 *
 * - Status e testes (protegidos por login).
 * - Disparo manual da sincronização (protegido).
 * - Fluxo OAuth (conectar/callback) — públicos, pois o callback é chamado
 *   pelo próprio provedor (Conta Azul / Google), sem o token do usuário.
 */
import { Router } from 'express';
import { autenticar } from '../middleware/auth';
import { env } from '../config/env';
import { testes, statusGeral, contaAzul, googleDrive } from '../integracoes';
import { executarSincronizacao } from '../servicos/sincronizacao';
import type { Provedor } from '../tipos/integracao';

export const rotasIntegracoes = Router();

// --- Status agregado de todas as integrações --------------------------------
rotasIntegracoes.get('/integracoes/status', autenticar, async (_req, res) => {
  res.json({ integracoes: await statusGeral() });
});

// --- Testa um provedor específico -------------------------------------------
rotasIntegracoes.get('/integracoes/:provedor/testar', autenticar, async (req, res) => {
  const provedor = req.params.provedor as Provedor;
  const teste = testes[provedor];
  if (!teste) {
    res.status(404).json({ erro: `Provedor desconhecido: ${provedor}` });
    return;
  }
  res.json(await teste());
});

// --- Dispara a sincronização manualmente ------------------------------------
rotasIntegracoes.post('/integracoes/sincronizar', autenticar, async (_req, res) => {
  const resultado = await executarSincronizacao();
  res.json(resultado);
});

// --- OAuth: inicia a autorização (redireciona ao provedor) ------------------
rotasIntegracoes.get('/integracoes/:provedor/conectar', (req, res) => {
  const { provedor } = req.params;
  let url: string | null = null;
  if (provedor === 'conta_azul_ass') url = contaAzul.urlAutorizacao('ass');
  else if (provedor === 'conta_azul_netr') url = contaAzul.urlAutorizacao('netr');
  else if (provedor === 'google_drive') url = googleDrive.urlAutorizacao();

  if (!url) {
    res.status(400).json({ erro: `Provedor sem fluxo OAuth: ${provedor}` });
    return;
  }
  res.redirect(url);
});

// --- OAuth: callback (troca code por token e volta ao frontend) -------------
rotasIntegracoes.get('/integracoes/:provedor/callback', async (req, res) => {
  const { provedor } = req.params;
  const code = String(req.query.code ?? '');
  const destino = `${env.frontendUrl}/integracoes`;

  try {
    if (!code) throw new Error('Código de autorização ausente.');
    if (provedor === 'conta_azul_ass') await contaAzul.trocarCodigoPorToken('ass', code);
    else if (provedor === 'conta_azul_netr') await contaAzul.trocarCodigoPorToken('netr', code);
    else if (provedor === 'google_drive') await googleDrive.trocarCodigoPorToken(code);
    else throw new Error(`Provedor sem fluxo OAuth: ${provedor}`);

    res.redirect(`${destino}?conectado=${provedor}`);
  } catch (e) {
    res.redirect(`${destino}?erro=${encodeURIComponent((e as Error).message)}`);
  }
});
