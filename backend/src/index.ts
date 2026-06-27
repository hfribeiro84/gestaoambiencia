/**
 * Ponto de entrada da API do Sistema de Gestão Ambiência.
 *
 * Monta o Express, registra as rotas, configura o CORS para o frontend e
 * agenda a sincronização diária (node-cron).
 */
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { env } from './config/env';
import { rotasSaude } from './rotas/saude.rotas';
import { rotasAuth } from './rotas/auth.rotas';
import { rotasIntegracoes } from './rotas/integracoes.rotas';
import { rotasFinanceiro } from './rotas/financeiro.rotas';
import { tratadorDeErros } from './middleware/erros';
import { executarSincronizacao } from './servicos/sincronizacao';

const app = express();

// CORS: libera o frontend (local ou Vercel em produção).
app.use(cors({ origin: env.frontendUrl, credentials: true }));
app.use(express.json());

// Rotas (todas sob /api).
app.use('/api', rotasSaude);
app.use('/api', rotasAuth);
app.use('/api', rotasIntegracoes);
app.use('/api', rotasFinanceiro);

// Tratador de erros (sempre por último).
app.use(tratadorDeErros);

// Agendamento da sincronização diária — todo dia às 05:00 (horário do servidor).
cron.schedule('0 5 * * *', () => {
  console.log('[cron] iniciando sincronização diária...');
  executarSincronizacao()
    .then((r) => console.log('[cron]', r.mensagem))
    .catch((e) => console.error('[cron] erro na sincronização:', e.message));
});

app.listen(env.porta, () => {
  console.log(`API no ar em http://localhost:${env.porta} (CORS: ${env.frontendUrl})`);
});
