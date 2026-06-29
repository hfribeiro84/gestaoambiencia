import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';

type Empresa = 'ass' | 'netr';
type StatusConferencia = 'conferido' | 'conferido_diferenca' | 'pendente' | 'nao_esperada';

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
  aliquotaISS: number;
  totalPlanilha: number;
  totalContaAzul: number;
  conferidos: number;
  conferidosDiferenca: number;
  pendentes: number;
  naoEsperadas: number;
  itens: ItemConferencia[];
  erroApi?: string;
  erroSalvar?: string;
}

interface PlanilhaSalvaInfo {
  totalItens: number;
  aliquotaISS: number;
  atualizado_em: string;
  ultimoResultado?: ResultadoConferencia;
  resultado_em?: string;
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const anoAtual = new Date().getFullYear();
const ANOS = [anoAtual - 1, anoAtual, anoAtual + 1];

const COR_STATUS: Record<StatusConferencia, string> = {
  conferido: 'text-green-700 bg-green-50',
  conferido_diferenca: 'text-orange-700 bg-orange-50',
  pendente: 'text-red-700 bg-red-50',
  nao_esperada: 'text-yellow-700 bg-yellow-50',
};

const LABEL_STATUS: Record<StatusConferencia, string> = {
  conferido: '✅ Conferido',
  conferido_diferenca: '⚠️ Divergência',
  pendente: '❌ Pendente',
  nao_esperada: '🔵 Não prevista',
};

function formatBRL(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Valor líquido após desconto de ISS, se aplicável. */
function valorLiquido(planilha: NfPlanilha, aliquotaISS: number): number {
  return planilha.retencaoISS && aliquotaISS > 0
    ? planilha.valorTotal * (1 - aliquotaISS / 100)
    : planilha.valorTotal;
}

export function ConferenciaNF() {
  const [empresa, setEmpresa] = useState<Empresa>('ass');
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [ano, setAno] = useState(anoAtual);
  const [aliquotaISS, setAliquotaISS] = useState(0);

  // Planilha salva no banco
  const [planilhaSalva, setPlanilhaSalva] = useState<PlanilhaSalvaInfo | null>(null);
  const [carregandoInfo, setCarregandoInfo] = useState(false);
  const [modoSubstituir, setModoSubstituir] = useState(false);

  // Upload de novo CSV
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [csvContent, setCsvContent] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Resultado e UX
  const [carregando, setCarregando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoConferencia | null>(null);
  const [resultadoEm, setResultadoEm] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState<StatusConferencia | 'todos'>('todos');

  const carregarInfo = useCallback(async () => {
    setCarregandoInfo(true);
    setErro('');
    setModoSubstituir(false);
    setNomeArquivo('');
    setCsvContent('');
    try {
      const info = await api<PlanilhaSalvaInfo | null>(`/api/financeiro/nf/planilha/${empresa}/${mes}/${ano}`);
      setPlanilhaSalva(info);
      if (info?.aliquotaISS) setAliquotaISS(info.aliquotaISS);
      setResultado(info?.ultimoResultado ?? null);
      setResultadoEm(info?.resultado_em ?? null);
      setFiltro('todos');
    } catch {
      setPlanilhaSalva(null);
      setResultado(null);
      setResultadoEm(null);
    } finally {
      setCarregandoInfo(false);
    }
  }, [empresa, mes, ano]);

  useEffect(() => { carregarInfo(); }, [carregarInfo]);

  async function atualizarContaAzul() {
    setCarregando(true);
    setErro('');
    setResultado(null);
    try {
      const params = aliquotaISS > 0 ? `?aliquotaISS=${aliquotaISS}` : '';
      const r = await api<ResultadoConferencia>(`/api/financeiro/nf/conferir/${empresa}/${mes}/${ano}${params}`);
      setResultado(r);
      setResultadoEm(new Date().toISOString());
      setFiltro('todos');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  async function conferirComCsv() {
    if (!csvContent) { setErro('Selecione o arquivo CSV.'); return; }
    setCarregando(true);
    setErro('');
    setResultado(null);
    try {
      const r = await api<ResultadoConferencia>('/api/financeiro/nf/conferir', {
        method: 'POST',
        body: JSON.stringify({ empresa, mes, ano, csv: csvContent, aliquotaISS }),
      });
      setResultado(r);
      setResultadoEm(new Date().toISOString());
      setFiltro('todos');
      setModoSubstituir(false);
      setNomeArquivo('');
      setCsvContent('');
      // Recarrega do servidor para obter a data de atualização real do banco
      if (!r.erroSalvar) carregarInfo();
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
      const r = await api<unknown>('/api/financeiro/debug/preview-csv', {
        method: 'POST',
        body: JSON.stringify({ empresa, csv: csvContent }),
      });
      setErro(JSON.stringify(r, null, 2));
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

  const aliquotaEfetiva = resultado?.aliquotaISS ?? aliquotaISS;

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Conferência de NF</h1>
      <p className="text-gray-600 mb-6">
        Compara a planilha "NF a emitir" com as notas efetivamente emitidas no Conta Azul.
      </p>

      {/* Controles */}
      <div className="bg-white rounded-lg shadow p-5 mb-6">
        {/* Linha 1: seletores + ISS */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Empresa</label>
            <div className="flex gap-2">
              {(['ass', 'netr'] as Empresa[]).map((e) => (
                <button
                  key={e}
                  onClick={() => setEmpresa(e)}
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
          <div>
            <label className="block text-xs text-gray-500 mb-1">Mês</label>
            <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="w-full border rounded px-2 py-2 text-sm">
              {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Ano</label>
            <select value={ano} onChange={(e) => setAno(Number(e.target.value))} className="w-full border rounded px-2 py-2 text-sm">
              {ANOS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Alíquota ISS (%)</label>
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={aliquotaISS || ''}
              onChange={(e) => setAliquotaISS(Number(e.target.value))}
              placeholder="Ex: 5"
              className="w-full border rounded px-2 py-2 text-sm"
            />
          </div>
        </div>

        {/* Status da planilha + ações */}
        {carregandoInfo ? (
          <div className="text-sm text-gray-400">Verificando planilha salva...</div>
        ) : planilhaSalva && !modoSubstituir ? (
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-700">
                <span className="font-medium">Planilha salva</span>
                <span className="text-gray-400 ml-2">({planilhaSalva.totalItens} itens)</span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                Atualizada em {formatDataHora(planilhaSalva.atualizado_em)}
              </div>
            </div>
            <button
              onClick={atualizarContaAzul}
              disabled={carregando}
              className="bg-ambiencia text-white px-5 py-2 rounded font-medium disabled:opacity-50 whitespace-nowrap"
            >
              {carregando ? 'Consultando...' : 'Atualizar Conta Azul'}
            </button>
            <button
              onClick={() => setModoSubstituir(true)}
              className="border border-gray-300 text-gray-600 px-4 py-2 rounded text-sm hover:border-gray-400 whitespace-nowrap"
            >
              Substituir planilha
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <label className="block text-xs text-gray-500 mb-1">Planilha CSV</label>
              <input
                ref={inputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) { setNomeArquivo(file.name); setCsvContent(await file.text()); }
                  else { setNomeArquivo(''); setCsvContent(''); }
                }}
              />
              <button
                onClick={() => inputRef.current?.click()}
                className="w-full border rounded px-3 py-2 text-sm text-left truncate text-gray-600 hover:border-ambiencia"
              >
                {nomeArquivo || 'Selecionar arquivo...'}
              </button>
            </div>
            <button
              onClick={conferirComCsv}
              disabled={carregando || !csvContent}
              className="bg-ambiencia text-white px-5 py-2 rounded font-medium disabled:opacity-50 whitespace-nowrap"
            >
              {carregando ? 'Consultando...' : 'Conferir'}
            </button>
            {csvContent && (
              <button
                onClick={verPreviewCsv}
                disabled={carregando}
                className="border border-gray-300 text-gray-600 px-4 py-2 rounded text-sm disabled:opacity-50 hover:border-gray-400"
              >
                Preview CSV
              </button>
            )}
            {modoSubstituir && (
              <button
                onClick={() => { setModoSubstituir(false); setNomeArquivo(''); setCsvContent(''); }}
                className="text-sm text-gray-400 hover:text-gray-600 px-2 py-2"
              >
                Cancelar
              </button>
            )}
          </div>
        )}

        {erro && <pre className="mt-3 text-sm text-gray-700 bg-gray-50 border rounded p-3 whitespace-pre-wrap max-h-64 overflow-y-auto">{erro}</pre>}
      </div>

      {/* Resultado */}
      {resultado && (
        <>
          {resultado.erroApi && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
              <strong>Aviso:</strong> Não foi possível consultar o Conta Azul ({resultado.erroApi}).
            </div>
          )}
          {resultado.erroSalvar && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
              <strong>Erro ao salvar planilha no banco:</strong> {resultado.erroSalvar}
              <div className="mt-1 text-xs">Verifique se as migrations 0002 e 0003 foram rodadas no Supabase.</div>
            </div>
          )}

          {resultadoEm && (
            <div className="mb-3 text-xs text-gray-400">
              Resultado de {formatDataHora(resultadoEm)}
            </div>
          )}

          {/* Cards */}
          {(() => {
            const totalValorPlanilha = resultado.itens.reduce((s, i) => s + (i.planilha?.valorTotal ?? 0), 0);
            const totalValorCa = resultado.itens.reduce((s, i) => s + (i.contaAzul?.valor ?? 0), 0);
            return (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
                  {[
                    { label: 'Na planilha', valor: resultado.totalPlanilha, cor: 'bg-gray-50 text-gray-700' },
                    { label: 'No Conta Azul', valor: resultado.totalContaAzul, cor: 'bg-blue-50 text-blue-700' },
                    { label: 'Conferidos', valor: resultado.conferidos, cor: 'bg-green-50 text-green-700' },
                    { label: 'Com divergência', valor: resultado.conferidosDiferenca ?? 0, cor: 'bg-orange-50 text-orange-700' },
                    { label: 'Pendentes', valor: resultado.pendentes, cor: 'bg-red-50 text-red-700' },
                    { label: 'Não previstas', valor: resultado.naoEsperadas, cor: 'bg-yellow-50 text-yellow-700' },
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
                    <div className="text-sm">Total planilha (bruto)</div>
                  </div>
                  <div className="rounded-lg p-4 bg-blue-50 text-blue-700">
                    <div className="text-xl font-bold">{formatBRL(totalValorCa)}</div>
                    <div className="text-sm">Total NFs emitidas</div>
                  </div>
                </div>
              </>
            );
          })()}

          {/* Filtros */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {(['todos', 'conferido', 'conferido_diferenca', 'pendente', 'nao_esperada'] as const).map((f) => (
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
                  <th className="px-4 py-3 text-left">Cliente / Projeto</th>
                  <th className="px-4 py-3 text-right">Valor planilha</th>
                  <th className="px-4 py-3 text-center">NF nº</th>
                  <th className="px-4 py-3 text-right">Valor NF</th>
                  <th className="px-4 py-3 text-right">Diferença</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {itensFiltrados.map((item, idx) => {
                  const vliq = item.planilha
                    ? valorLiquido(item.planilha, aliquotaEfetiva)
                    : null;
                  const temMatch = item.status === 'conferido' || item.status === 'conferido_diferenca';
                  const diferenca = temMatch && vliq !== null
                    ? (item.contaAzul?.valor ?? 0) - vliq
                    : null;
                  const temIss = item.planilha?.retencaoISS && aliquotaEfetiva > 0;

                  return (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${COR_STATUS[item.status]}`}>
                          {LABEL_STATUS[item.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <div className="font-medium truncate">
                          {item.planilha?.cliente ?? item.contaAzul?.cliente ?? '—'}
                        </div>
                        {(item.planilha?.descricao || item.contaAzul?.descricao) && (
                          <div className="text-xs text-gray-400 truncate">
                            {item.planilha?.descricao ?? item.contaAzul?.descricao}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {item.planilha ? (
                          <div>
                            <div>{formatBRL(item.planilha.valorTotal)}</div>
                            {temIss && vliq !== null && (
                              <div className="text-xs text-orange-500">
                                líq. {formatBRL(vliq)}
                              </div>
                            )}
                          </div>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-500">
                        {item.contaAzul?.numero ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {item.contaAzul ? formatBRL(item.contaAzul.valor) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {diferenca !== null ? (
                          <span className={
                            Math.abs(diferenca) < 1 ? 'text-gray-400' : 'text-red-600 font-medium'
                          }>
                            {formatBRL(diferenca)}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {itensFiltrados.length === 0 && (
              <p className="text-center text-gray-400 py-8">Nenhum item nesta categoria.</p>
            )}
            {aliquotaEfetiva > 0 && resultado.itens.some((i) => i.planilha?.retencaoISS) && (
              <div className="px-4 py-3 border-t text-xs text-gray-400">
                ISS {aliquotaEfetiva}% — coluna Diferença calculada sobre o valor líquido (planilha bruto − ISS).
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
