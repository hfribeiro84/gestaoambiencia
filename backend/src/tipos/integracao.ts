/** Tipos compartilhados da camada de integrações. */

/** Identificadores dos provedores integrados ao sistema. */
export type Provedor =
  | 'conta_azul_ass'
  | 'conta_azul_netr'
  | 'pipedrive'
  | 'clockify'
  | 'google_drive'
  | 'claude';

/** Forma de autenticação de cada provedor. */
export type TipoAuth = 'oauth2' | 'api_token' | 'api_key';

/** Resultado padronizado de um teste de conexão. */
export interface ResultadoTeste {
  provedor: Provedor;
  /** 'ok' = conectado, 'nao_configurado' = falta credencial, 'erro' = falhou. */
  status: 'ok' | 'nao_configurado' | 'erro';
  tipoAuth: TipoAuth;
  /** Mensagem amigável (ex.: nome da conta conectada ou motivo do erro). */
  mensagem: string;
  /** Detalhe extra opcional (ex.: nome do workspace, e-mail da conta). */
  detalhe?: string;
}
