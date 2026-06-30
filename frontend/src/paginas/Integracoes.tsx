/**
 * Página de Integrações.
 *
 * - Provedores OAuth (Conta Azul ASS/NETR, Google Drive): botão "Conectar"
 *   que inicia o fluxo OAuth no backend.
 * - Provedores de chave simples (Pipedrive, Clockify, Claude): formulário
 *   inline para salvar a credencial no banco sem sair do sistema.
 */
import { useEffect, useState } from 'react';
import { api, urlBackend } from '../lib/api';

interface StatusIntegracao {
  provedor: string;
  status: 'ok' | 'nao_configurado' | 'erro';
  tipoAuth: string;
  mensagem: string;
  detalhe?: string;
}

const NOMES: Record<string, string> = {
  conta_azul_ass: 'Conta Azul — Ambiência',
  conta_azul_netr: 'Conta Azul — NETResíduos',
  pipedrive: 'Pipedrive',
  clockify: 'Clockify',
  google_drive: 'Google Drive',
  claude: 'Claude (IA)',
};

// Provedores que suportam desconexão (limpar token).
const DESCONECTAVEIS = ['conta_azul_ass', 'conta_azul_netr'];

// Provedores que usam fluxo OAuth (botão "Conectar").
const OAUTH = ['conta_azul_ass', 'conta_azul_netr', 'google_drive'];

// Provedores que precisam de formulário para configurar credenciais antes de conectar.
const OAUTH_COM_CONFIG = ['conta_azul_ass', 'conta_azul_netr'];

const COR: Record<string, string> = {
  ok: 'bg-green-100 text-green-800',
  nao_configurado: 'bg-gray-100 text-gray-600',
  erro: 'bg-red-100 text-red-800',
};

// Campos dos formulários de configuração por provedor.
const FORMULARIOS: Record<string, { label: string; campo: string; tipo?: string; placeholder?: string }[]> = {
  conta_azul_ass: [
    { label: 'Client ID', campo: 'client_id', placeholder: 'ID do app OAuth no portal Conta Azul' },
    { label: 'Client Secret', campo: 'client_secret', tipo: 'password', placeholder: 'Secret do app OAuth' },
    { label: 'Authorize URL (opcional)', campo: 'authorize_url', placeholder: 'https://auth.contaazul.com/login' },
    { label: 'Token URL (opcional)', campo: 'token_url', placeholder: 'https://auth.contaazul.com/oauth2/token' },
  ],
  conta_azul_netr: [
    { label: 'Client ID', campo: 'client_id', placeholder: 'ID do app OAuth no portal Conta Azul' },
    { label: 'Client Secret', campo: 'client_secret', tipo: 'password', placeholder: 'Secret do app OAuth' },
    { label: 'Authorize URL (opcional)', campo: 'authorize_url', placeholder: 'https://auth.contaazul.com/login' },
    { label: 'Token URL (opcional)', campo: 'token_url', placeholder: 'https://auth.contaazul.com/oauth2/token' },
  ],
  pipedrive: [
    { label: 'API Token', campo: 'api_token', tipo: 'password' },
  ],
  clockify: [
    { label: 'API Key', campo: 'api_key', tipo: 'password' },
  ],
  claude: [
    { label: 'API Key (Anthropic)', campo: 'api_key', tipo: 'password' },
  ],
};

export function Integracoes() {
  const [lista, setLista] = useState<StatusIntegracao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState('');
  // Estado dos formulários abertos e seus valores.
  const [formAberto, setFormAberto] = useState<string | null>(null);
  const [formValores, setFormValores] = useState<Record<string, string>>({});
  const [formSalvando, setFormSalvando] = useState(false);
  const [desconectando, setDesconectando] = useState<string | null>(null);

  async function carregar() {
    setCarregando(true);
    try {
      const r = await api<{ integracoes: StatusIntegracao[] }>('/api/integracoes/status');
      setLista(r.integracoes);
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    const params = new URLSearchParams(window.location.search);
    if (params.get('conectado')) setAviso(`Conectado: ${params.get('conectado')}`);
    if (params.get('erro')) setAviso(`Erro: ${params.get('erro')}`);
  }, []);

  async function sincronizar() {
    setSincronizando(true);
    setAviso('');
    try {
      const r = await api<{ mensagem: string }>('/api/integracoes/sincronizar', { method: 'POST' });
      setAviso(r.mensagem);
      await carregar();
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setSincronizando(false);
    }
  }

  async function desconectar(provedor: string) {
    if (!window.confirm(`Desconectar ${NOMES[provedor]}?\n\nO token será apagado. Você precisará reconectar com a conta correta.`)) return;
    setDesconectando(provedor);
    setAviso('');
    try {
      await api(`/api/integracoes/${provedor}/desconectar`, { method: 'POST' });
      await carregar();
      setAviso(`${NOMES[provedor]} desconectado. Clique em "Conectar" para autorizar novamente com a conta correta.`);
    } catch (e) {
      setAviso(`Erro ao desconectar: ${(e as Error).message}`);
    } finally {
      setDesconectando(null);
    }
  }

  function abrirForm(provedor: string) {
    setFormAberto(formAberto === provedor ? null : provedor);
    setFormValores({});
  }

  async function salvarCredencial(provedor: string) {
    setFormSalvando(true);
    setAviso('');
    try {
      await api(`/api/integracoes/${provedor}/configurar`, {
        method: 'POST',
        body: JSON.stringify(formValores),
      });
      setFormAberto(null);
      setFormValores({});
      await carregar();
      setAviso(`Credencial do ${NOMES[provedor]} salva. Testando conexão...`);
    } catch (e) {
      setAviso(`Erro: ${(e as Error).message}`);
    } finally {
      setFormSalvando(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Integrações</h1>
          <p className="text-gray-600">Status de conexão com os sistemas externos.</p>
        </div>
        <button
          onClick={sincronizar}
          disabled={sincronizando}
          className="bg-ambiencia text-white px-4 py-2 rounded font-medium disabled:opacity-60"
        >
          {sincronizando ? 'Sincronizando...' : 'Sincronizar agora'}
        </button>
      </div>

      {aviso && (
        <div className="mb-4 p-3 bg-blue-50 text-blue-800 rounded text-sm">{aviso}</div>
      )}

      {carregando ? (
        <p className="text-gray-500">Carregando...</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {lista.map((it) => (
            <div key={it.provedor} className="bg-white rounded-lg shadow p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">{NOMES[it.provedor] ?? it.provedor}</span>
                <span className={`text-xs px-2 py-1 rounded ${COR[it.status]}`}>{it.status}</span>
              </div>
              <p className="text-sm text-gray-600 mt-1">{it.mensagem}</p>
              {it.detalhe && <p className="text-xs text-gray-400 mt-1">{it.detalhe}</p>}

              <div className="mt-3 flex gap-3 flex-wrap">
                {/* Formulário de configuração (todos os provedores com FORMULARIOS) */}
                {FORMULARIOS[it.provedor] && (
                  <button
                    onClick={() => abrirForm(it.provedor)}
                    className="text-sm text-ambiencia underline"
                  >
                    {it.status === 'ok' && !OAUTH_COM_CONFIG.includes(it.provedor)
                      ? 'Atualizar credencial'
                      : 'Configurar app'}
                  </button>
                )}

                {/* Botão OAuth: só aparece após o app estar configurado (ou para google_drive) */}
                {OAUTH.includes(it.provedor) && (
                  <a
                    href={`${urlBackend}/api/integracoes/${it.provedor}/conectar`}
                    className="text-sm text-ambiencia underline"
                  >
                    {it.status === 'ok' ? 'Reconectar' : 'Conectar'}
                  </a>
                )}

                {/* Desconectar: limpa token corrompido antes de reconectar com a conta certa */}
                {DESCONECTAVEIS.includes(it.provedor) && it.status === 'ok' && (
                  <button
                    onClick={() => desconectar(it.provedor)}
                    disabled={desconectando === it.provedor}
                    className="text-sm text-red-600 underline disabled:opacity-50"
                  >
                    {desconectando === it.provedor ? 'Desconectando...' : 'Desconectar'}
                  </button>
                )}
              </div>

              {/* Formulário inline (visível só quando aberto) */}
              {formAberto === it.provedor && FORMULARIOS[it.provedor] && (
                <div className="mt-3 border-t pt-3 space-y-2">
                  {FORMULARIOS[it.provedor].map((campo) => (
                    <div key={campo.campo}>
                      <label className="block text-xs text-gray-500 mb-1">{campo.label}</label>
                      <input
                        type={campo.tipo ?? 'text'}
                        value={formValores[campo.campo] ?? ''}
                        onChange={(e) =>
                          setFormValores((v) => ({ ...v, [campo.campo]: e.target.value }))
                        }
                        className="w-full border rounded px-2 py-1 text-sm"
                        placeholder={campo.tipo === 'password' ? '••••••••' : ''}
                      />
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => salvarCredencial(it.provedor)}
                      disabled={formSalvando}
                      className="bg-ambiencia text-white text-sm px-3 py-1 rounded disabled:opacity-60"
                    >
                      {formSalvando ? 'Salvando...' : 'Salvar'}
                    </button>
                    <button
                      onClick={() => setFormAberto(null)}
                      className="text-sm text-gray-500 underline"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
