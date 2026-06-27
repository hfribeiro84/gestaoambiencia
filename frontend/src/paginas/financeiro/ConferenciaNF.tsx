/**
 * Conferência de NF — compara a planilha "NF a emitir" com as NFs
 * efetivamente emitidas no Conta Azul no mesmo mês.
 */
import { useRef, useState } from 'react';
import { api } from '../../lib/api';

type Empresa = 'ass' | 'netr';
type StatusConferencia = 'conferido' | 'pendente' | 'nao_esperada';

interface NfPlanilha {
  emissaoNF: string;
  cliente: string;
  descricao: string;
  cnpj?: string;
  valorTotal: number;
  retencaoISS: boolean;
}

interface NfEmitida {
  id: string;
  numero: string;
  dataEmissao: string;
  status: string;
  cliente: string;
  cnpj?: string;
  valor: number;
  descricao?: string;
}

interface ItemConferencia {
  status: StatusConferencia;
  planilha?: NfPlanilha;
  contaAzul?: NfEmitida;
}

interface ResultadoConferencia {
  empresa: Empresa;
  mes: number;
  ano: number;
  totalPlanilha: number;
  totalContaAzul: number;
  conferidos: number;
  pendentes: number;
  naoEsperadas: number;
  itens: ItemConferencia[];
  erroApi?: string;
}

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const anoAtual = new Date().getFullYear();
const ANOS = [anoAtual - 1, anoAtual, anoAtual + 1];

const COR_STATUS: Record<StatusConferencia, string> = {
  conferido: 'text-green-700 bg-green-50',
  pendente: 'text-red-700 bg-red-50',
  nao_esperada: 'text-yellow-700 bg-yellow-50',
};

const LABEL_STATUS: Record<StatusConferencia, string> = {
  conferido: '✅ Conferido',
  pendente: '❌ Pendente',
  nao_esperada: '⚠️ Não esperada',
};

function formatBRL(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function ConferenciaNF() {
  const [empresa, setEmpresa] = useState<Empresa>('ass');
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [ano, setAno] = useState(anoAtual);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [csvContent, setCsvContent] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoConferencia | null>(null);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState<StatusConferencia | 'todos'>('todos');
  const inputRef = useRef<HTMLInputElement>(null);

  async function diagnosticar() {
    setCarregando(true);
    setErro('');
    try {
      const r = await api<{ path: string; status: number; trecho: string }[]>(
        `/api/financeiro/debug/explorar/${empresa}`,
      );
      const resumo = r
        .map((x) => `${x.status === 200 ? '✅' : '❌'} ${x.path} → HTTP ${x.status}`)
        .join('\n');
      setErro(resumo);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  async function verPreviewCsv() {
    if (!csvContent) { setErro('Selecione o arquivo CSV primeiro.'); return; }
    setCarregando(true);
    setErro('');
    try {
      const csv = csvContent;
      const r = await api<unknown>('/api/financeiro/debug/preview-csv', {
        method: 'POST',
        body: JSON.stringify({ empresa, csv }),
      });
      setErro(JSON.stringify(r, null, 2));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  async function verAmostra() {
    setCarregando(true);
    setErro('');
    try {
      const r = await api<{ status: number; corpo: unknown; erro?: string }>(
        `/api/financeiro/debug/amostra/${empresa}`,
      );
      setErro(JSON.stringify(r, null, 2));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  async function conferir() {
    if (!csvContent) { setErro('Selecione o arquivo CSV.'); return; }
    setCarregando(true);
    setErro('');
    setResultado(null);

    try {
      const csv = csvContent;
      const r = await api<ResultadoConferencia>('/api/financeiro/nf/conferir', {
        method: 'POST',
        body: JSON.stringify({ empresa, mes, ano, csv }),
      });
      setResultado(r);
      setFiltro('todos');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  const itensFiltrados = resultado
    ? filtro === 'todos'
      ? resultado.itens
      : resultado.itens.filter((i) => i.status === filtro)
    : [];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Conferência de NF</h1>
      <p className="text-gray-600 mb-6">
        Compara a planilha "NF a emitir" com as notas efetivamente emitidas no Conta Azul.
      </p>

      {/* Controles */}
      <div className="bg-white rounded-lg shadow p-5 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
          {/* Empresa */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Empresa</label>
            <div className="flex gap-2">
              {(['ass', 'netr'] as Empresa[]).map((e) => (
                <button
                  key={e}
                  onClick={() => { setEmpresa(e); setNomeArquivo(''); setCsvContent(''); setResultado(null); }}
                  className={`flex-1 py-2 rounded text-sm font-medium border transition-colors ${
                    empresa === e
                      ? 'bg-ambiencia text-white border-ambiencia'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-ambiencia'
                  }`}
                >
                  {e === 'ass' ? 'Ambiência' : 'NETResíduos'}
                </button>
              ))}
            </div>
          </div>

          {/* Mês */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Mês</label>
            <select
              value={mes}
              onChange={(e) => setMes(Number(e.target.value))}
              className="w-full border rounded px-2 py-2 text-sm"
            >
              {MESES.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>

          {/* Ano */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Ano</label>
            <select
              value={ano}
              onChange={(e) => setAno(Number(e.target.value))}
              className="w-full border rounded px-2 py-2 text-sm"
            >
              {ANOS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          {/* Arquivo */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Planilha CSV</label>
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                setNomeArquivo(file.name);
                setCsvContent(await file.text());
              } else {
                setNomeArquivo('');
                setCsvContent('');
              }
              setResultado(null);
            }}
            />
            <button
              onClick={() => inputRef.current?.click()}
              className="w-full border rounded px-2 py-2 text-sm text-left truncate text-gray-600 hover:border-ambiencia"
            >
              {nomeArquivo || 'Selecionar arquivo...'}
            </button>
          </div>
        </div>

        <div className="mt-4 flex gap-3 items-center flex-wrap">
          <button
            onClick={conferir}
            disabled={carregando || !csvContent}
            className="bg-ambiencia text-white px-5 py-2 rounded font-medium disabled:opacity-50"
          >
            {carregando ? 'Consultando...' : 'Conferir'}
          </button>
          <button
            onClick={diagnosticar}
            disabled={carregando}
            className="border border-gray-300 text-gray-600 px-4 py-2 rounded text-sm disabled:opacity-50 hover:border-gray-400"
          >
            Testar endpoints
          </button>
          <button
            onClick={verAmostra}
            disabled={carregando}
            className="border border-gray-300 text-gray-600 px-4 py-2 rounded text-sm disabled:opacity-50 hover:border-gray-400"
          >
            Ver amostra NFS-e
          </button>
          <button
            onClick={verPreviewCsv}
            disabled={carregando || !csvContent}
            className="border border-gray-300 text-gray-600 px-4 py-2 rounded text-sm disabled:opacity-50 hover:border-gray-400"
          >
            Preview CSV
          </button>
          {csvContent && (
            <span className="text-xs text-gray-400">
              {empresa.toUpperCase()} — {MESES[mes - 1]}/{ano}
            </span>
          )}
        </div>

        {erro && <pre className="mt-3 text-sm text-gray-700 bg-gray-50 border rounded p-3 whitespace-pre-wrap">{erro}</pre>}
      </div>

      {/* Resultado */}
      {resultado && (
        <>
          {resultado.erroApi && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
              <strong>Aviso:</strong> Não foi possível consultar o Conta Azul ({resultado.erroApi}).
              A planilha foi processada, mas a conferência não pôde ser realizada.
            </div>
          )}

          {/* Cards de resumo */}
          {(() => {
            const totalValorPlanilha = resultado.itens.reduce((s, i) => s + (i.planilha?.valorTotal ?? 0), 0);
            const totalValorCa = resultado.itens.reduce((s, i) => s + (i.contaAzul?.valor ?? 0), 0);
            return (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                  {[
                    { label: 'Na planilha', valor: resultado.totalPlanilha, cor: 'bg-gray-50 text-gray-700' },
                    { label: 'No Conta Azul', valor: resultado.totalContaAzul, cor: 'bg-blue-50 text-blue-700' },
                    { label: 'Conferidos', valor: resultado.conferidos, cor: 'bg-green-50 text-green-700' },
                    { label: 'Pendentes', valor: resultado.pendentes, cor: 'bg-red-50 text-red-700' },
                  ].map((c) => (
                    <div key={c.label} className={`rounded-lg p-4 ${c.cor}`}>
                      <div className="text-2xl font-bold">{c.valor}</div>
                      <div className="text-sm">{c.label}</div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <div className="rounded-lg p-4 bg-gray-50 text-gray-700">
                    <div className="text-xl font-bold">{formatBRL(totalValorPlanilha)}</div>
                    <div className="text-sm">Total planilha</div>
                  </div>
                  <div className="rounded-lg p-4 bg-blue-50 text-blue-700">
                    <div className="text-xl font-bold">{formatBRL(totalValorCa)}</div>
                    <div className="text-sm">Total NFs emitidas</div>
                  </div>
                </div>
              </>
            );
          })()}

          {/* Filtro */}
          <div className="flex gap-2 mb-4">
            {(['todos', 'conferido', 'pendente', 'nao_esperada'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                className={`px-3 py-1 rounded text-sm border transition-colors ${
                  filtro === f ? 'bg-ambiencia text-white border-ambiencia' : 'bg-white border-gray-200 hover:border-ambiencia'
                }`}
              >
                {f === 'todos' ? `Todos (${resultado.itens.length})` : LABEL_STATUS[f]}
              </button>
            ))}
          </div>

          {/* Tabela */}
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Descrição</th>
                  <th className="px-4 py-3 text-right">Valor planilha</th>
                  <th className="px-4 py-3 text-center">NF nº</th>
                  <th className="px-4 py-3 text-right">Valor NF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {itensFiltrados.map((item, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${COR_STATUS[item.status]}`}>
                        {LABEL_STATUS[item.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {item.planilha?.cliente ?? item.contaAzul?.cliente ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate">
                      {item.planilha?.descricao ?? item.contaAzul?.descricao ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item.planilha ? formatBRL(item.planilha.valorTotal) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-500">
                      {item.contaAzul?.numero ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item.contaAzul ? formatBRL(item.contaAzul.valor) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {itensFiltrados.length === 0 && (
              <p className="text-center text-gray-400 py-8">Nenhum item nesta categoria.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
