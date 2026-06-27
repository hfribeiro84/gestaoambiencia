/**
 * Serviço de sincronização diária.
 *
 * Na Fase 1 é um ESQUELETO: registra a execução no `sync_log` e confere o
 * status das integrações. Cada módulo futuro (Financeiro, Resultado por
 * Projeto, etc.) vai plugar aqui a sua rotina de importação de dados.
 *
 * O agendamento (node-cron, 1x/dia) é configurado no `index.ts`. Também pode
 * ser disparado manualmente pelo endpoint POST /api/integracoes/sincronizar.
 */
import { statusGeral } from '../integracoes';
import { iniciarLog, finalizarLog } from './logSync';

export async function executarSincronizacao(): Promise<{ mensagem: string; registros: number }> {
  const id = await iniciarLog('todos');
  try {
    // Por enquanto, "sincronizar" = checar conexão de todos os provedores.
    // Os módulos futuros substituem isto pela importação real de dados.
    const status = await statusGeral();
    const conectados = status.filter((s) => s.status === 'ok').length;
    const mensagem = `Sync executada: ${conectados}/${status.length} integrações conectadas.`;
    await finalizarLog(id, 'sucesso', mensagem, conectados);
    return { mensagem, registros: conectados };
  } catch (e) {
    const msg = (e as Error).message;
    await finalizarLog(id, 'erro', msg);
    throw e;
  }
}
