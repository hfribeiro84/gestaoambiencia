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
import * as pipedrive from '../integracoes/pipedrive';
import * as clockify from '../integracoes/clockify';
import * as claude from '../integracoes/claude';
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

// --- Configura credenciais simples (API key / token) pelo frontend ----------
rotasIntegracoes.post('/integracoes/:provedor/configurar', autenticar, async (req, res) => {
  const { provedor } = req.params;
  const corpo = req.body as Record<string, string>;

  try {
    if (provedor === 'pipedrive') {
      if (!corpo.api_token) {
        res.status(400).json({ erro: 'Campo obrigatório: api_token.' });
        return;
      }
      await pipedrive.configurar(corpo.api_token);
    } else if (provedor === 'clockify') {
      if (!corpo.api_key) {
        res.status(400).json({ erro: 'Campo obrigatório: api_key.' });
        return;
      }
      await clockify.configurar(corpo.api_key);
    } else if (provedor === 'claude') {
      if (!corpo.api_key) {
        res.status(400).json({ erro: 'Campo obrigatório: api_key.' });
        return;
      }
      await claude.configurar(corpo.api_key);
    } else if (provedor === 'conta_azul_ass' || provedor === 'conta_azul_netr') {
      if (!corpo.client_id || !corpo.client_secret) {
        res.status(400).json({ erro: 'Campos obrigatórios: client_id e client_secret.' });
        return;
      }
      const conta = provedor === 'conta_azul_ass' ? 'ass' : 'netr';
      await contaAzul.configurar(conta, {
        client_id: corpo.client_id,
        client_secret: corpo.client_secret,
        authorize_url: corpo.authorize_url,
        token_url: corpo.token_url,
        api_base: corpo.api_base,
      });
    } else {
      res.status(400).json({ erro: `Provedor não configurável via formulário: ${provedor}` });
      return;
    }
    res.json({ ok: true, mensagem: `Credencial de ${provedor} salva com sucesso.` });
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message });
  }
});

// --- OAuth: inicia a autorização (redireciona ao provedor) ------------------
rotasIntegracoes.get('/integracoes/:provedor/conectar', async (req, res) => {
  const { provedor } = req.params;
  try {
    let url: string | null = null;
    if (provedor === 'conta_azul_ass') url = await contaAzul.urlAutorizacao('ass');
    else if (provedor === 'conta_azul_netr') url = await contaAzul.urlAutorizacao('netr');
    else if (provedor === 'google_drive') url = googleDrive.urlAutorizacao();

    if (!url) {
      res.status(400).json({ erro: `Provedor sem fluxo OAuth: ${provedor}` });
      return;
    }
    res.redirect(url);
  } catch (e) {
    res.status(400).json({ erro: (e as Error).message });
  }
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
