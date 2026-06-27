/** Roteamento do app. */
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contextos/AuthContext';
import { RotaProtegida } from './componentes/RotaProtegida';
import { Layout } from './componentes/Layout';
import { Login } from './paginas/Login';
import { Dashboard } from './paginas/Dashboard';
import { Integracoes } from './paginas/Integracoes';
import { ConferenciaNF } from './paginas/financeiro/ConferenciaNF';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RotaProtegida>
                <Layout>
                  <Dashboard />
                </Layout>
              </RotaProtegida>
            }
          />
          <Route
            path="/integracoes"
            element={
              <RotaProtegida>
                <Layout>
                  <Integracoes />
                </Layout>
              </RotaProtegida>
            }
          />
          <Route
            path="/financeiro/conferencia-nf"
            element={
              <RotaProtegida>
                <Layout>
                  <ConferenciaNF />
                </Layout>
              </RotaProtegida>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
