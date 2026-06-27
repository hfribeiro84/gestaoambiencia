/** Protege rotas que exigem login: redireciona ao /login se não houver sessão. */
import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../contextos/AuthContext';

export function RotaProtegida({ children }: { children: ReactNode }) {
  const { sessao, carregando } = useAuth();

  if (carregando) {
    return <div className="p-8 text-gray-500">Carregando...</div>;
  }
  if (!sessao) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
