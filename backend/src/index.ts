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
import { rotasDre } from './rotas/dre.rotas';
import { tratadorDeErros } from './middleware/erros';
import { executarSincronizacao } from './servicos/sincronizacao';
import { atualizarExtratosDiario } from './modulos/financeiro/dreExtrato';

const app = express();

// CORS: libera as origens do frontend (domínio próprio + Vercel + local).
app.use(
  cors({
    origin(origin, cb) {
      // Sem Origin (curl, health check, mesmo host) ou origem na lista → libera.
      if (!origin || env.frontendUrls.includes(origin)) return cb(null, true);
      cb(new Error(`Origem não permitida pelo CORS: ${origin}`));
    },
    credentials: true,
  }),
);
app.use(express.json());

// Rotas (todas sob /api).
app.use('/api', rotasSaude);
app.use('/api', rotasAuth);
app.use('/api', rotasIntegracoes);
app.use('/api', rotasFinanceiro);
app.use('/api', rotasDre);

// Tratador de erros (sempre por último).
app.use(tratadorDeErros);

// Agendamento da sincronização diária — todo dia às 05:00 (horário do servidor).
cron.schedule('0 5 * * *', () => {
  console.log('[cron] iniciando sincronização diária...');
  executarSincronizacao()
    .then((r) => console.log('[cron]', r.mensagem))
    .catch((e) => console.error('[cron] erro na sincronização:', e.message));
});

// Atualização noturna do extrato DRE — 04:00 (antes da sincronização, p/ não
// concorrer). Reprocessa o período salvo de cada empresa; o cache de baixas
// deixa isso barato (só rebusca o que mudou no Conta Azul).
cron.schedule('0 4 * * *', () => {
  console.log('[cron] atualizando extratos DRE...');
  atualizarExtratosDiario()
    .then((r) => console.log('[cron extrato]', r))
    .catch((e) => console.error('[cron extrato] erro:', e.message));
});

app.listen(env.porta, () => {
  console.log(`API no ar em http://localhost:${env.porta} (CORS: ${env.frontendUrls.join(', ')})`);
});
