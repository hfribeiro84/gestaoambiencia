/**
 * Registro central das integrações.
 *
 * Mapeia cada provedor ao seu teste de conexão e expõe um agregador de status,
 * usado pela página "Integrações" do frontend.
 */
import type { Provedor, ResultadoTeste } from '../tipos/integracao';
import * as pipedrive from './pipedrive';
import * as clockify from './clockify';
import * as claude from './claude';
import * as contaAzul from './contaAzul';
import * as googleDrive from './googleDrive';

/** Testes de conexão por provedor. */
export const testes: Record<Provedor, () => Promise<ResultadoTeste>> = {
  conta_azul_ass: () => contaAzul.testarConexao('ass'),
  conta_azul_netr: () => contaAzul.testarConexao('netr'),
  pipedrive: pipedrive.testarConexao,
  clockify: clockify.testarConexao,
  google_drive: googleDrive.testarConexao,
  claude: claude.testarConexao,
};

export const PROVEDORES = Object.keys(testes) as Provedor[];

/** Testa todos os provedores em paralelo e devolve o status agregado. */
export async function statusGeral(): Promise<ResultadoTeste[]> {
  return Promise.all(PROVEDORES.map((p) => testes[p]()));
}

export { contaAzul, googleDrive };
