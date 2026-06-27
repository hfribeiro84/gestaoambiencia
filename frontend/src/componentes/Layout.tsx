/**
 * Layout principal — barra lateral + área de conteúdo.
 *
 * A sidebar já antecipa a navegação do sistema (Consolidado, Ambiência, NETR e
 * os módulos futuros), mas na Fase 1 só Dashboard e Integrações estão ativos.
 */
import { Link, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../contextos/AuthContext';

const itensMenu = [
  { rotulo: 'Dashboard', caminho: '/', ativo: true },
  { rotulo: 'Integrações', caminho: '/integracoes', ativo: true },
  { rotulo: '— Financeiro —', caminho: '', ativo: false, separador: true },
  { rotulo: 'Conferência de NF', caminho: '/financeiro/conferencia-nf', ativo: true },
  { rotulo: 'DRE Gerencial', caminho: '/financeiro/dre', ativo: false },
  { rotulo: 'Sistema de Rateio', caminho: '/financeiro/rateio', ativo: false },
  { rotulo: '— Outros módulos —', caminho: '', ativo: false, separador: true },
  { rotulo: 'Resultado por Projeto', caminho: '/projetos', ativo: false },
  { rotulo: 'Contratos', caminho: '/contratos', ativo: false },
  { rotulo: 'Unidades NETR', caminho: '/unidades', ativo: false },
  { rotulo: 'RH & Equipe', caminho: '/rh', ativo: false },
  { rotulo: 'Comercial', caminho: '/comercial', ativo: false },
];

export function Layout({ children }: { children: ReactNode }) {
  const { sessao, sair } = useAuth();
  const local = useLocation();

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-700">
          <div className="text-lg font-semibold">Gestão Ambiência</div>
          <div className="text-xs text-slate-400">ASS + NETResíduos</div>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-1">
          {itensMenu.map((item, idx) =>
            (item as { separador?: boolean }).separador ? (
              <div key={idx} className="px-3 pt-4 pb-1 text-xs text-slate-500 font-semibold tracking-wide">
                {item.rotulo}
              </div>
            ) : item.ativo ? (
              <Link
                key={item.caminho}
                to={item.caminho}
                className={`block px-3 py-2 rounded text-sm ${
                  local.pathname === item.caminho
                    ? 'bg-slate-700 font-medium'
                    : 'hover:bg-slate-800'
                }`}
              >
                {item.rotulo}
              </Link>
            ) : (
              <span
                key={item.caminho || idx}
                className="block px-3 py-2 rounded text-sm text-slate-500 cursor-not-allowed"
                title="Em breve"
              >
                {item.rotulo}
              </span>
            ),
          )}
        </nav>
        <div className="px-5 py-4 border-t border-slate-700 text-xs">
          <div className="truncate text-slate-300">{sessao?.user.email}</div>
          <button onClick={sair} className="mt-2 text-slate-400 hover:text-white underline">
            Sair
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
