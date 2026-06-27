/**
 * Página de Integrações.
 *
 * Mostra o status de cada provedor (Conta Azul ASS/NETR, Pipedrive, Clockify,
 * Google Drive, Claude), permite testar a conexão e iniciar os fluxos OAuth.
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

// Provedores que usam OAuth (botão "Conectar" abre o fluxo no backend).
const OAUTH = ['conta_azul_ass', 'conta_azul_netr', 'google_drive'];

const COR: Record<string, string> = {
  ok: 'bg-green-100 text-green-800',
  nao_configurado: 'bg-gray-100 text-gray-600',
  erro: 'bg-red-100 text-red-800',
};

export function Integracoes() {
  const [lista, setLista] = useState<StatusIntegracao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState('');

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
    // Mostra retorno do fluxo OAuth (?conectado= ou ?erro=).
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

      {aviso && <div className="mb-4 p-3 bg-blue-50 text-blue-800 rounded text-sm">{aviso}</div>}

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
              {OAUTH.includes(it.provedor) && (
                <a
                  href={`${urlBackend}/api/integracoes/${it.provedor}/conectar`}
                  className="inline-block mt-3 text-sm text-ambiencia underline"
                >
                  {it.status === 'ok' ? 'Reconectar' : 'Conectar'}
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
