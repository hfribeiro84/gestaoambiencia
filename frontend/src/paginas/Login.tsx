/** Tela de login (email/senha via Supabase Auth). */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contextos/AuthContext';

export function Login() {
  const { entrar } = useAuth();
  const navegar = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      await entrar(email, senha);
      navegar('/');
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <form onSubmit={aoEnviar} className="bg-white p-8 rounded-lg shadow w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1">Gestão Ambiência</h1>
        <p className="text-sm text-gray-500 mb-6">Entre com seu e-mail e senha.</p>

        <label className="block text-sm mb-1">E-mail</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full border rounded px-3 py-2 mb-4"
        />

        <label className="block text-sm mb-1">Senha</label>
        <input
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          required
          className="w-full border rounded px-3 py-2 mb-4"
        />

        {erro && <p className="text-sm text-red-600 mb-4">{erro}</p>}

        <button
          type="submit"
          disabled={enviando}
          className="w-full bg-ambiencia text-white py-2 rounded font-medium disabled:opacity-60"
        >
          {enviando ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
