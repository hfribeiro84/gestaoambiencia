/**
 * Dashboard — placeholder da Fase 1.
 *
 * Será o Dashboard Executivo com visão consolidada de todos os módulos.
 * Por ora apenas confirma que a sessão e a comunicação com o backend funcionam.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function Dashboard() {
  const [saude, setSaude] = useState<string>('verificando...');

  useEffect(() => {
    api<{ status: string }>('/api/saude')
      .then((r) => setSaude(r.status))
      .catch((e) => setSaude(`erro: ${e.message}`));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">Dashboard</h1>
      <p className="text-gray-600 mb-6">
        Esqueleto no ar. O Dashboard Executivo consolidado será construído sobre esta base.
      </p>
      <div className="bg-white rounded-lg shadow p-5 inline-block">
        <div className="text-sm text-gray-500">Status do backend</div>
        <div className="text-lg font-medium">{saude}</div>
      </div>
    </div>
  );
}
