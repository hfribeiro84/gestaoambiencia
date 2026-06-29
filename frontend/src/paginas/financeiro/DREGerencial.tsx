import { useCallback, useEffect, useState, type JSX } from 'react';
import { api } from '../../lib/api';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type EmpresaDRE = 'ass' | 'netr' | 'consolidado';
type TipoCategoria = 'receita' | 'deducao' | 'custo' | 'despesa' | 'financeiro' | 'divisao';
type Aba = 'dre' | 'extrato' | 'historico' | 'configuracoes';

interface ValorMes { mes: number; ano: number; valor: number; }

interface LinhaDRE {
  id: string;
  nome: string;
  tipo: TipoCategoria;
  sinal: number;
  ordem: number;
  subcategorias: LinhaDRE[];
  valores: ValorMes[];
  total12m: number;
  percentualReceita?: number;
}

interface TotaisCalculados {
  receitaBruta: ValorMes[];
  receitaLiquida: ValorMes[];
  custoProjetos: ValorMes[];
  despesas: ValorMes[];
  resultadoOperacional: ValorMes[];
  operacaoFinanceira: ValorMes[];
  resultadoLiquido: ValorMes[];
  fluxoCaixaLivre: ValorMes[];
}

interface DadosDRE {
  empresa: EmpresaDRE;
  mesRef: number;
  anoRef: number;
  meses: Array<{ mes: number; ano: number }>;
  categorias: LinhaDRE[];
  totais: TotaisCalculados;
  naoMapeadas: string[];
  naoMapeadasReceita: ValorMes[];
  naoMapeadasDespesa: ValorMes[];
}

interface DreSnapshot {
  id: string;
  empresa: EmpresaDRE;
  mes_ref: number;
  ano_ref: number;
  calculado_em: string;
  dados: DadosDRE;
}

interface DreCategoria {
  id: string;
  nome: string;
  pai_id: string | null;
  tipo: TipoCategoria;
  sinal: number;
  subcategorias?: DreCategoria[];
}

interface DreMapeamento {
  id: string;
  empresa: string;
  nome_ca: string;
  categoria_id: string;
  categoria_nome?: string;
}

interface CategoriaCA {
  nome: string;
  tipo: 'receita' | 'despesa';
  total: number;
  count: number;
}

interface ItemExtrato {
  id: string;
  data: string;
  tipo: 'receita' | 'despesa' | 'transferencia';
  descricao: string;
  categoria: string;
  valor: number;
}

interface DadosExtrato {
  empresa: string;
  mes: number;
  ano: number;
  saldoInicial: number;
  itens: ItemExtrato[];
  totalReceitas: number;
  totalDespesas: number;
  saldoFinal: number;
}

interface SnapshotInfo {
  id: string;
  mes_ref: number;
  ano_ref: number;
  calculado_em: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MESES_NOMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_COMPLETOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const anoAtual = new Date().getFullYear();
const ANOS = [anoAtual - 2, anoAtual - 1, anoAtual, anoAtual + 1];

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatBRLK(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return formatBRL(v);
}

function formatDataHora(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function nomeMes(m: number, a: number): string {
  return `${MESES_NOMES[m - 1]}/${String(a).slice(2)}`;
}

function valorDoMes(valores: ValorMes[], mes: number, ano: number): number {
  return valores.find((v) => v.mes === mes && v.ano === ano)?.valor ?? 0;
}

function somaTotal(valores: ValorMes[]): number {
  return valores.reduce((s, v) => s + v.valor, 0);
}

function corValor(v: number, isReceita = false): string {
  if (v === 0) return 'text-gray-400';
  if (isReceita && v > 0) return 'text-green-700';
  if (v > 0) return 'text-green-700';
  return 'text-red-600';
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function DREGerencial() {
  const [empresa, setEmpresa] = useState<EmpresaDRE>('ass');
  const [aba, setAba] = useState<Aba>('dre');
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [ano, setAno] = useState(anoAtual);

  // DRE
  const [snapshot, setSnapshot] = useState<DreSnapshot | null>(null);
  const [carregandoDRE, setCarregandoDRE] = useState(false);
  const [calculando, setCalculando] = useState(false);
  const [erroDRE, setErroDRE] = useState('');
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  // Resumo IA
  const [resumo, setResumo] = useState('');
  const [carregandoResumo, setCarregandoResumo] = useState(false);
  const [erroResumo, setErroResumo] = useState('');
  const [mostrarResumo, setMostrarResumo] = useState(false);

  // Extrato
  const [mesExtrato, setMesExtrato] = useState(new Date().getMonth() + 1);
  const [anoExtrato, setAnoExtrato] = useState(anoAtual);
  const [extrato, setExtrato] = useState<DadosExtrato | null>(null);
  const [carregandoExtrato, setCarregandoExtrato] = useState(false);
  const [erroExtrato, setErroExtrato] = useState('');

  // Histórico
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);

  // Configurações
  const [categorias, setCategorias] = useState<DreCategoria[]>([]);
  const [mapeamentos, setMapeamentos] = useState<DreMapeamento[]>([]);
  const [catsCA, setCatsCA] = useState<CategoriaCA[]>([]);
  const [carregandoConfig, setCarregandoConfig] = useState(false);
  const [carregandoCatsCA, setCarregandoCatsCA] = useState(false);
  const [erroConfig, setErroConfig] = useState('');
  const [novoNomeCA, setNovoNomeCA] = useState('');
  const [novaCategoriaId, setNovaCategoriaId] = useState('');
  const [salvandoMap, setSalvandoMap] = useState(false);

  // ── Carregar último snapshot ao mudar empresa ──────────────────────────────
  const carregarSnapshot = useCallback(async () => {
    setCarregandoDRE(true);
    setErroDRE('');
    setResumo('');
    try {
      const snap = await api<DreSnapshot | null>(`/api/financeiro/dre/ultimo/${empresa}`);
      setSnapshot(snap);
      if (snap) {
        setMes(snap.mes_ref);
        setAno(snap.ano_ref);
      }
    } catch (e) {
      setErroDRE((e as Error).message);
      setSnapshot(null);
    } finally {
      setCarregandoDRE(false);
    }
  }, [empresa]);

  useEffect(() => { carregarSnapshot(); }, [carregarSnapshot]);

  // ── Recalcular DRE ─────────────────────────────────────────────────────────
  async function calcularDRE() {
    setCalculando(true);
    setErroDRE('');
    setResumo('');
    try {
      const snap = await api<DreSnapshot>(`/api/financeiro/dre/calcular/${empresa}/${mes}/${ano}`, { method: 'POST' });
      setSnapshot(snap);
    } catch (e) {
      setErroDRE((e as Error).message);
    } finally {
      setCalculando(false);
    }
  }

  // ── Resumo executivo IA ────────────────────────────────────────────────────
  async function gerarResumo() {
    setCarregandoResumo(true);
    setErroResumo('');
    setMostrarResumo(true);
    try {
      const result = await api<{ resumo: string }>(`/api/financeiro/dre/resumo/${empresa}`);
      setResumo(result.resumo);
    } catch (e) {
      setErroResumo((e as Error).message);
    } finally {
      setCarregandoResumo(false);
    }
  }

  // ── Carregar extrato ───────────────────────────────────────────────────────
  async function carregarExtrato() {
    setCarregandoExtrato(true);
    setErroExtrato('');
    try {
      const empresaExtrato = empresa === 'consolidado' ? 'ass' : empresa;
      const ext = await api<DadosExtrato>(`/api/financeiro/dre/extrato/${empresaExtrato}/${mesExtrato}/${anoExtrato}`);
      setExtrato(ext);
    } catch (e) {
      setErroExtrato((e as Error).message);
      setExtrato(null);
    } finally {
      setCarregandoExtrato(false);
    }
  }

  // ── Excluir snapshot ──────────────────────────────────────────────────────
  async function excluirSnapshot(id: string) {
    try {
      await api(`/api/financeiro/dre/snapshots/${empresa}/${id}`, { method: 'DELETE' });
      setSnapshots((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      console.error('Erro ao excluir snapshot:', e);
    }
  }

  // ── Carregar histórico ─────────────────────────────────────────────────────
  const carregarHistorico = useCallback(async () => {
    setCarregandoHistorico(true);
    try {
      const lista = await api<SnapshotInfo[]>(`/api/financeiro/dre/snapshots/${empresa}`);
      setSnapshots(lista);
    } catch {
      setSnapshots([]);
    } finally {
      setCarregandoHistorico(false);
    }
  }, [empresa]);

  useEffect(() => {
    if (aba === 'historico') carregarHistorico();
  }, [aba, empresa, carregarHistorico]);

  // ── Carregar configurações ─────────────────────────────────────────────────
  const carregarConfig = useCallback(async () => {
    setCarregandoConfig(true);
    setErroConfig('');
    const empresaConfig = empresa === 'consolidado' ? 'ass' : empresa;
    try {
      const [cats, maps] = await Promise.all([
        api<DreCategoria[]>(`/api/financeiro/dre/categorias`),
        api<DreMapeamento[]>(`/api/financeiro/dre/mapeamento/${empresaConfig}`),
      ]);
      setCategorias(cats);
      setMapeamentos(maps);
    } catch (e) {
      setErroConfig((e as Error).message);
    } finally {
      setCarregandoConfig(false);
    }

    // Carrega categorias do CA em paralelo (pode demorar)
    if (empresa !== 'consolidado') {
      setCarregandoCatsCA(true);
      try {
        const cats = await api<CategoriaCA[]>(`/api/financeiro/dre/categorias-ca/${empresaConfig}`);
        setCatsCA(cats);
      } catch {
        setCatsCA([]);
      } finally {
        setCarregandoCatsCA(false);
      }
    }
  }, [empresa]);

  useEffect(() => {
    if (aba === 'configuracoes') carregarConfig();
  }, [aba, empresa, carregarConfig]);

  // ── Adicionar mapeamento ───────────────────────────────────────────────────
  async function adicionarMapeamento() {
    if (!novoNomeCA.trim() || !novaCategoriaId) return;
    const empresaConfig = empresa === 'consolidado' ? 'ass' : empresa;
    setSalvandoMap(true);
    try {
      await api<DreMapeamento>(`/api/financeiro/dre/mapeamento/${empresaConfig}`, {
        method: 'POST',
        body: JSON.stringify({ nome_ca: novoNomeCA.trim(), categoria_id: novaCategoriaId }),
      });
      setNovoNomeCA('');
      setNovaCategoriaId('');
      await carregarConfig();
    } catch (e) {
      setErroConfig((e as Error).message);
    } finally {
      setSalvandoMap(false);
    }
  }

  // ── Remover mapeamento ─────────────────────────────────────────────────────
  async function removerMapeamento(id: string) {
    const empresaConfig = empresa === 'consolidado' ? 'ass' : empresa;
    try {
      await api(`/api/financeiro/dre/mapeamento/${empresaConfig}/${id}`, { method: 'DELETE' });
      await carregarConfig();
    } catch (e) {
      setErroConfig((e as Error).message);
    }
  }

  // ── Toggle expansão subcategorias ──────────────────────────────────────────
  function toggleExpandido(id: string) {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">DRE Gerencial</h1>
      <p className="text-gray-500 text-sm mb-5">
        Demonstrativo de Resultado do Exercício — caixa, 12 meses.
      </p>

      {/* Seletor de empresa */}
      <div className="flex gap-2 mb-5">
        {([
          { id: 'ass', label: 'Ambiência (ASS)' },
          { id: 'netr', label: 'NETResíduos' },
          { id: 'consolidado', label: 'Consolidado' },
        ] as { id: EmpresaDRE; label: string }[]).map((e) => (
          <button
            key={e.id}
            onClick={() => setEmpresa(e.id)}
            className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
              empresa === e.id
                ? 'bg-slate-800 text-white border-slate-800'
                : 'bg-white text-gray-600 border-gray-300 hover:border-slate-500'
            }`}
          >
            {e.label}
          </button>
        ))}
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {([
          { id: 'dre', label: 'DRE' },
          { id: 'extrato', label: 'Extrato' },
          { id: 'historico', label: 'Histórico' },
          { id: 'configuracoes', label: 'Configurações' },
        ] as { id: Aba; label: string }[]).map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              aba === a.id
                ? 'border-slate-800 text-slate-800'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* ── ABA DRE ────────────────────────────────────────────────────────── */}
      {aba === 'dre' && (
        <AbaDRE
          mes={mes}
          ano={ano}
          setMes={setMes}
          setAno={setAno}
          snapshot={snapshot}
          carregando={carregandoDRE}
          calculando={calculando}
          erro={erroDRE}
          expandidos={expandidos}
          onToggle={toggleExpandido}
          onCalcular={calcularDRE}
          resumo={resumo}
          carregandoResumo={carregandoResumo}
          erroResumo={erroResumo}
          mostrarResumo={mostrarResumo}
          onGerarResumo={gerarResumo}
          onFecharResumo={() => setMostrarResumo(false)}
        />
      )}

      {/* ── ABA EXTRATO ────────────────────────────────────────────────────── */}
      {aba === 'extrato' && (
        <AbaExtrato
          mes={mesExtrato}
          ano={anoExtrato}
          setMes={setMesExtrato}
          setAno={setAnoExtrato}
          extrato={extrato}
          carregando={carregandoExtrato}
          erro={erroExtrato}
          empresa={empresa}
          onCarregar={carregarExtrato}
        />
      )}

      {/* ── ABA HISTÓRICO ──────────────────────────────────────────────────── */}
      {aba === 'historico' && (
        <AbaHistorico
          snapshots={snapshots}
          carregando={carregandoHistorico}
          onExcluir={excluirSnapshot}
        />
      )}

      {/* ── ABA CONFIGURAÇÕES ──────────────────────────────────────────────── */}
      {aba === 'configuracoes' && (
        <AbaConfiguracoes
          empresa={empresa}
          categorias={categorias}
          mapeamentos={mapeamentos}
          catsCA={catsCA}
          carregando={carregandoConfig}
          carregandoCatsCA={carregandoCatsCA}
          erro={erroConfig}
          novoNomeCA={novoNomeCA}
          novaCategoriaId={novaCategoriaId}
          salvando={salvandoMap}
          onSetNomeCA={setNovoNomeCA}
          onSetCategoriaId={setNovaCategoriaId}
          onAdicionar={adicionarMapeamento}
          onRemover={removerMapeamento}
        />
      )}
    </div>
  );
}

// ─── Aba DRE ─────────────────────────────────────────────────────────────────

interface AbaDREProps {
  mes: number; ano: number;
  setMes: (m: number) => void; setAno: (a: number) => void;
  snapshot: DreSnapshot | null;
  carregando: boolean; calculando: boolean; erro: string;
  expandidos: Set<string>;
  onToggle: (id: string) => void;
  onCalcular: () => void;
  resumo: string; carregandoResumo: boolean; erroResumo: string;
  mostrarResumo: boolean;
  onGerarResumo: () => void;
  onFecharResumo: () => void;
}

function AbaDRE({
  mes, ano, setMes, setAno, snapshot, carregando, calculando, erro,
  expandidos, onToggle, onCalcular,
  resumo, carregandoResumo, erroResumo, mostrarResumo, onGerarResumo, onFecharResumo,
}: AbaDREProps) {
  const dados = snapshot?.dados ?? null;
  const meses = dados?.meses ?? [];

  function kpiMes(valores: ValorMes[]): number {
    if (!dados) return 0;
    return valorDoMes(valores, dados.mesRef, dados.anoRef);
  }

  const kpiReceitaBruta = kpiMes(dados?.totais.receitaBruta ?? []);
  const kpiResultadoOp = kpiMes(dados?.totais.resultadoOperacional ?? []);
  const kpiFluxoCaixa = kpiMes(dados?.totais.fluxoCaixaLivre ?? []);
  const kpiResultadoLiq = kpiMes(dados?.totais.resultadoLiquido ?? []);

  return (
    <div>
      {/* Seletor + botão */}
      <div className="bg-white rounded-lg shadow p-4 mb-5 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Mês de referência</label>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="border rounded px-2 py-1.5 text-sm">
            {MESES_COMPLETOS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Ano</label>
          <select value={ano} onChange={(e) => setAno(Number(e.target.value))} className="border rounded px-2 py-1.5 text-sm">
            {ANOS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <button
          onClick={onCalcular}
          disabled={calculando || carregando}
          className="bg-slate-800 text-white px-5 py-2 rounded text-sm font-medium disabled:opacity-50 hover:bg-slate-700 transition-colors"
        >
          {calculando ? 'Calculando...' : 'Atualizar'}
        </button>
        {snapshot?.calculado_em && (
          <span className="text-xs text-gray-400 self-center">
            Resultado de {formatDataHora(snapshot.calculado_em)}
          </span>
        )}
      </div>

      {erro && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{erro}</div>
      )}

      {carregando && (
        <div className="text-sm text-gray-400 py-8 text-center">Carregando DRE...</div>
      )}

      {!carregando && !dados && !erro && (
        <div className="text-sm text-gray-400 py-8 text-center">
          Nenhum DRE calculado ainda. Selecione o período e clique em Atualizar.
        </div>
      )}

      {dados && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <KpiCard label="Receita Bruta" valor={kpiReceitaBruta} cor="gray" />
            <KpiCard label="Resultado Operacional" valor={kpiResultadoOp} cor="auto" />
            <KpiCard label="Fluxo de Caixa Livre" valor={kpiFluxoCaixa} cor="auto" />
            <KpiCard label="Resultado Líquido" valor={kpiResultadoLiq} cor="auto" />
          </div>

          {/* Gráfico de evolução */}
          <div className="bg-white rounded-lg shadow p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Evolução 12 meses</h3>
              <div className="flex gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block" /> Receita Bruta</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-500 inline-block" /> Resultado Op.</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-500 inline-block" /> Result. Líquido</span>
              </div>
            </div>
            <GraficoEvolucao
              meses={meses}
              series={[
                { nome: 'Receita Bruta', valores: dados.totais.receitaBruta, cor: '#3b82f6' },
                { nome: 'Resultado Op.', valores: dados.totais.resultadoOperacional, cor: '#10b981' },
                { nome: 'Result. Líquido', valores: dados.totais.resultadoLiquido, cor: '#64748b' },
              ]}
            />
          </div>

          {/* Resumo Executivo IA */}
          <div className="bg-white rounded-lg shadow mb-4">
            <div className="p-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-700">Resumo Executivo</h3>
                <p className="text-xs text-gray-400">Análise automática gerada por IA</p>
              </div>
              <div className="flex gap-2">
                {mostrarResumo && (
                  <button onClick={onFecharResumo} className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1.5 rounded border border-gray-200">
                    Fechar
                  </button>
                )}
                <button
                  onClick={onGerarResumo}
                  disabled={carregandoResumo}
                  className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded font-medium disabled:opacity-50 hover:bg-indigo-700"
                >
                  {carregandoResumo ? 'Gerando...' : resumo ? 'Regerar' : 'Gerar análise'}
                </button>
              </div>
            </div>
            {mostrarResumo && (
              <div className="border-t px-4 pb-4 pt-3">
                {carregandoResumo && (
                  <div className="text-sm text-gray-400 animate-pulse">Analisando dados com IA...</div>
                )}
                {erroResumo && (
                  <div className="text-sm text-red-600">{erroResumo}</div>
                )}
                {resumo && !carregandoResumo && (
                  <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{resumo}</div>
                )}
              </div>
            )}
          </div>

          {/* Aviso de não mapeadas */}
          {dados.naoMapeadas.length > 0 && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
              <strong>Categorias sem mapeamento ({dados.naoMapeadas.length}):</strong>{' '}
              {dados.naoMapeadas.join(', ')}
              <span className="ml-2 text-yellow-600">— vá em Configurações para mapear.</span>
            </div>
          )}

          {/* Tabela DRE */}
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="text-sm" style={{ minWidth: `${200 + meses.length * 110 + 160}px` }}>
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left sticky left-0 bg-gray-50 z-10 min-w-[200px]">Categoria</th>
                  {meses.map((m) => (
                    <th key={`${m.mes}-${m.ano}`} className="px-3 py-3 text-right whitespace-nowrap min-w-[100px]">
                      {nomeMes(m.mes, m.ano)}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-right whitespace-nowrap min-w-[110px]">Total 12m</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap min-w-[60px]">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <TabelaDRE
                  categorias={dados.categorias}
                  totais={dados.totais}
                  meses={meses}
                  expandidos={expandidos}
                  onToggle={onToggle}
                  naoMapeadasReceita={dados.naoMapeadasReceita ?? []}
                  naoMapeadasDespesa={dados.naoMapeadasDespesa ?? []}
                />
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Gráfico de evolução (SVG) ────────────────────────────────────────────────

interface Serie {
  nome: string;
  valores: ValorMes[];
  cor: string;
}

function GraficoEvolucao({ meses, series }: { meses: Array<{ mes: number; ano: number }>; series: Serie[] }) {
  const W = 900, H = 200;
  const pad = { top: 16, right: 24, bottom: 36, left: 72 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;
  const n = meses.length;
  if (n === 0) return null;

  const allVals = series.flatMap((s) => meses.map((m) => valorDoMes(s.valores, m.mes, m.ano)));
  const minV = Math.min(0, ...allVals);
  const maxV = Math.max(0, ...allVals);
  const range = maxV - minV || 1;

  function xOf(i: number) { return pad.left + (i / (n - 1)) * cw; }
  function yOf(v: number) { return pad.top + ch - ((v - minV) / range) * ch; }

  // Grid lines + Y labels
  const gridCount = 4;
  const gridLines: JSX.Element[] = [];
  for (let i = 0; i <= gridCount; i++) {
    const v = minV + (range * i) / gridCount;
    const y = yOf(v);
    gridLines.push(
      <g key={i}>
        <line x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke="#e5e7eb" strokeWidth={1} />
        <text x={pad.left - 6} y={y + 4} textAnchor="end" fontSize={10} fill="#9ca3af">
          {formatBRLK(v)}
        </text>
      </g>
    );
  }

  // Zero line
  const y0 = yOf(0);
  const zeroLine = minV < 0 ? (
    <line x1={pad.left} y1={y0} x2={W - pad.right} y2={y0} stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 2" />
  ) : null;

  // Series
  const seriesElems: JSX.Element[] = series.map((s) => {
    const pts = meses.map((m, i) => `${xOf(i)},${yOf(valorDoMes(s.valores, m.mes, m.ano))}`).join(' ');
    return (
      <polyline
        key={s.nome}
        points={pts}
        fill="none"
        stroke={s.cor}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    );
  });

  // X axis labels (every other month if many)
  const xLabels: JSX.Element[] = meses.map((m, i) => {
    if (n > 8 && i % 2 !== 0) return <g key={i} />;
    return (
      <text key={i} x={xOf(i)} y={H - pad.bottom + 14} textAnchor="middle" fontSize={10} fill="#9ca3af">
        {nomeMes(m.mes, m.ano)}
      </text>
    );
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 180 }}>
      {gridLines}
      {zeroLine}
      {seriesElems}
      {xLabels}
    </svg>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, valor, cor }: { label: string; valor: number; cor: 'gray' | 'auto' }) {
  let bgCor = 'bg-gray-50 text-gray-700';
  if (cor === 'auto') {
    if (valor > 0) bgCor = 'bg-green-50 text-green-700';
    else if (valor < 0) bgCor = 'bg-red-50 text-red-700';
    else bgCor = 'bg-gray-50 text-gray-500';
  }
  return (
    <div className={`rounded-lg p-4 ${bgCor}`}>
      <div className="text-xl font-bold">{formatBRL(valor)}</div>
      <div className="text-sm mt-0.5">{label}</div>
    </div>
  );
}

// ─── Tabela DRE ───────────────────────────────────────────────────────────────

interface TabelaDREProps {
  categorias: LinhaDRE[];
  totais: TotaisCalculados;
  meses: Array<{ mes: number; ano: number }>;
  expandidos: Set<string>;
  onToggle: (id: string) => void;
  naoMapeadasReceita: ValorMes[];
  naoMapeadasDespesa: ValorMes[];
}

const LINHAS_CALCULADAS_APOS: Record<string, string> = {
  deducao: 'receita_liquida',
  financeiro: 'resultado_liquido',
  divisao: 'fluxo_caixa_livre',
};

const NOME_CALCULADO: Record<string, string> = {
  receita_liquida: '= Receita Líquida',
  resultado_operacional: '= Resultado Operacional',
  resultado_liquido: '= Resultado Líquido',
  fluxo_caixa_livre: '= Fluxo de Caixa Livre',
};

const LABEL_TIPO: Record<TipoCategoria, string> = {
  receita: 'Receita Bruta (Serviços)',
  deducao: 'Deduções da Receita Bruta',
  custo: 'Custos Projetos',
  despesa: 'Despesas',
  financeiro: 'Operação Financeira',
  divisao: 'Divisão de Resultados',
};

function TabelaDRE({ categorias, totais, meses, expandidos, onToggle, naoMapeadasReceita, naoMapeadasDespesa }: TabelaDREProps) {
  const valoresCalculados: Record<string, ValorMes[]> = {
    receita_liquida: totais.receitaLiquida,
    resultado_operacional: totais.resultadoOperacional,
    resultado_liquido: totais.resultadoLiquido,
    fluxo_caixa_livre: totais.fluxoCaixaLivre,
  };
  const receitaBrutaTotal12 = somaTotal(totais.receitaBruta);

  const ordem: TipoCategoria[] = ['receita', 'deducao', 'custo', 'despesa', 'financeiro', 'divisao'];
  const porTipo: Record<TipoCategoria, LinhaDRE[]> = {
    receita: [], deducao: [], custo: [], despesa: [], financeiro: [], divisao: [],
  };
  for (const cat of categorias) {
    if (porTipo[cat.tipo]) porTipo[cat.tipo].push(cat);
  }

  const rows: JSX.Element[] = [];

  for (const tipo of ordem) {
    const cats = porTipo[tipo];

    // Total do grupo
    const totalGrupoValores = meses.map((m) => ({
      mes: m.mes, ano: m.ano,
      valor: cats.reduce((s, c) => s + valorDoMes(c.valores, m.mes, m.ano), 0),
    }));
    const totalGrupo12 = cats.reduce((s, c) => s + c.total12m, 0);
    const pctGrupo = receitaBrutaTotal12 ? (totalGrupo12 / receitaBrutaTotal12) * 100 : 0;

    rows.push(
      <tr key={`grupo-${tipo}`} className="bg-white">
        <td className="px-4 py-2 font-semibold sticky left-0 bg-white z-10">{LABEL_TIPO[tipo]}</td>
        {meses.map((m) => {
          const v = totalGrupoValores.find((x) => x.mes === m.mes && x.ano === m.ano)?.valor ?? 0;
          return (
            <td key={`${m.mes}-${m.ano}`} className={`px-3 py-2 text-right font-semibold ${corValor(v, tipo === 'receita')}`}>
              {v !== 0 ? formatBRL(v) : <span className="text-gray-300">—</span>}
            </td>
          );
        })}
        <td className={`px-3 py-2 text-right font-semibold ${corValor(totalGrupo12, tipo === 'receita')}`}>
          {totalGrupo12 !== 0 ? formatBRL(totalGrupo12) : <span className="text-gray-300">—</span>}
        </td>
        <td className="px-3 py-2 text-right text-gray-500 text-xs">
          {pctGrupo !== 0 ? `${pctGrupo.toFixed(1)}%` : ''}
        </td>
      </tr>
    );

    for (const cat of cats) {
      rows.push(...renderLinhaCategoria(cat, meses, expandidos, onToggle, receitaBrutaTotal12, 0));
    }

    // Linha "Não categorizadas" para receita e despesa
    if (tipo === 'receita') {
      const total12 = somaTotal(naoMapeadasReceita);
      if (total12 !== 0) {
        rows.push(
          <LinhaDestaque
            key="nao-cat-receita"
            nome="⚠ Receitas não categorizadas"
            valores={naoMapeadasReceita}
            meses={meses}
            receitaBrutaTotal12={receitaBrutaTotal12}
            estilo="warning"
          />
        );
      }
    }
    if (tipo === 'despesa') {
      const total12 = somaTotal(naoMapeadasDespesa);
      if (total12 !== 0) {
        rows.push(
          <LinhaDestaque
            key="nao-cat-despesa"
            nome="⚠ Despesas não categorizadas"
            valores={naoMapeadasDespesa}
            meses={meses}
            receitaBrutaTotal12={receitaBrutaTotal12}
            estilo="warning"
          />
        );
      }
    }

    // Linhas calculadas após grupos
    const calcId = LINHAS_CALCULADAS_APOS[tipo];
    if (calcId) {
      rows.push(
        <LinhaCalculadaRow
          key={`calc-${calcId}`}
          nome={NOME_CALCULADO[calcId]}
          valores={valoresCalculados[calcId] ?? []}
          meses={meses}
          receitaBrutaTotal12={receitaBrutaTotal12}
        />
      );
    }

    // Resultado operacional aparece após despesas
    if (tipo === 'despesa') {
      rows.push(
        <LinhaCalculadaRow
          key="calc-resultado_operacional"
          nome={NOME_CALCULADO.resultado_operacional}
          valores={valoresCalculados.resultado_operacional ?? []}
          meses={meses}
          receitaBrutaTotal12={receitaBrutaTotal12}
        />
      );
    }
  }

  return <>{rows}</>;
}

function renderLinhaCategoria(
  cat: LinhaDRE,
  meses: Array<{ mes: number; ano: number }>,
  expandidos: Set<string>,
  onToggle: (id: string) => void,
  receitaBrutaTotal12: number,
  nivel: number,
): JSX.Element[] {
  const temSubs = cat.subcategorias && cat.subcategorias.length > 0;
  const aberto = expandidos.has(cat.id);
  const pct = receitaBrutaTotal12 ? (cat.total12m / receitaBrutaTotal12) * 100 : 0;
  const indent = nivel === 0 ? 'pl-6' : nivel === 1 ? 'pl-10' : 'pl-14';

  const rows: JSX.Element[] = [
    <tr key={cat.id} className="hover:bg-gray-50">
      <td className={`px-4 py-1.5 sticky left-0 bg-white z-10 hover:bg-gray-50 ${indent}`}>
        <div className="flex items-center gap-1">
          {temSubs ? (
            <button onClick={() => onToggle(cat.id)} className="text-gray-400 hover:text-gray-600 w-4 text-xs">
              {aberto ? '▼' : '▶'}
            </button>
          ) : <span className="w-4" />}
          <span className="text-gray-700">{cat.nome}</span>
        </div>
      </td>
      {meses.map((m) => {
        const v = valorDoMes(cat.valores, m.mes, m.ano);
        return (
          <td key={`${m.mes}-${m.ano}`} className={`px-3 py-1.5 text-right ${corValor(v, cat.tipo === 'receita')}`}>
            {v !== 0 ? formatBRL(v) : <span className="text-gray-200">—</span>}
          </td>
        );
      })}
      <td className={`px-3 py-1.5 text-right ${corValor(cat.total12m, cat.tipo === 'receita')}`}>
        {cat.total12m !== 0 ? formatBRL(cat.total12m) : <span className="text-gray-200">—</span>}
      </td>
      <td className="px-3 py-1.5 text-right text-gray-400 text-xs">
        {pct !== 0 ? `${pct.toFixed(1)}%` : ''}
      </td>
    </tr>,
  ];

  if (temSubs && aberto) {
    for (const sub of cat.subcategorias) {
      rows.push(...renderLinhaCategoria(sub, meses, expandidos, onToggle, receitaBrutaTotal12, nivel + 1));
    }
  }
  return rows;
}

function LinhaCalculadaRow({ nome, valores, meses, receitaBrutaTotal12 }: {
  nome: string; valores: ValorMes[];
  meses: Array<{ mes: number; ano: number }>; receitaBrutaTotal12: number;
}) {
  const total12 = somaTotal(valores);
  const pct = receitaBrutaTotal12 ? (total12 / receitaBrutaTotal12) * 100 : 0;
  return (
    <tr className="bg-gray-100 border-t border-b border-gray-200">
      <td className="px-4 py-2 font-bold sticky left-0 bg-gray-100 z-10">{nome}</td>
      {meses.map((m) => {
        const v = valorDoMes(valores, m.mes, m.ano);
        return (
          <td key={`${m.mes}-${m.ano}`} className={`px-3 py-2 text-right font-bold ${corValor(v)}`}>
            {v !== 0 ? formatBRL(v) : <span className="text-gray-300">—</span>}
          </td>
        );
      })}
      <td className={`px-3 py-2 text-right font-bold ${corValor(total12)}`}>
        {total12 !== 0 ? formatBRL(total12) : <span className="text-gray-300">—</span>}
      </td>
      <td className="px-3 py-2 text-right text-gray-500 text-xs font-semibold">
        {pct !== 0 ? `${pct.toFixed(1)}%` : ''}
      </td>
    </tr>
  );
}

function LinhaDestaque({ nome, valores, meses, receitaBrutaTotal12, estilo }: {
  nome: string; valores: ValorMes[];
  meses: Array<{ mes: number; ano: number }>; receitaBrutaTotal12: number;
  estilo: 'warning';
}) {
  const total12 = somaTotal(valores);
  const pct = receitaBrutaTotal12 ? (total12 / receitaBrutaTotal12) * 100 : 0;
  const bgCls = estilo === 'warning' ? 'bg-yellow-50' : 'bg-gray-50';
  const textCls = estilo === 'warning' ? 'text-yellow-800 italic' : 'text-gray-600 italic';
  return (
    <tr className={`${bgCls} border-y border-yellow-100`}>
      <td className={`px-4 py-1.5 pl-6 sticky left-0 z-10 ${bgCls} ${textCls} text-xs`}>{nome}</td>
      {meses.map((m) => {
        const v = valorDoMes(valores, m.mes, m.ano);
        return (
          <td key={`${m.mes}-${m.ano}`} className={`px-3 py-1.5 text-right text-xs ${v !== 0 ? 'text-yellow-700' : 'text-gray-300'}`}>
            {v !== 0 ? formatBRL(v) : '—'}
          </td>
        );
      })}
      <td className={`px-3 py-1.5 text-right text-xs ${total12 !== 0 ? 'text-yellow-700' : 'text-gray-300'}`}>
        {total12 !== 0 ? formatBRL(total12) : '—'}
      </td>
      <td className="px-3 py-1.5 text-right text-gray-400 text-xs">
        {pct !== 0 ? `${pct.toFixed(1)}%` : ''}
      </td>
    </tr>
  );
}

// ─── Aba Extrato ──────────────────────────────────────────────────────────────

interface AbaExtratoProps {
  mes: number; ano: number;
  setMes: (m: number) => void; setAno: (a: number) => void;
  extrato: DadosExtrato | null;
  carregando: boolean; erro: string;
  empresa: EmpresaDRE;
  onCarregar: () => void;
}

function AbaExtrato({ mes, ano, setMes, setAno, extrato, carregando, erro, empresa, onCarregar }: AbaExtratoProps) {
  const receitas = extrato?.itens.filter((i) => i.tipo === 'receita') ?? [];
  const despesas = extrato?.itens.filter((i) => i.tipo === 'despesa') ?? [];
  const transferencias = extrato?.itens.filter((i) => i.tipo === 'transferencia') ?? [];

  return (
    <div>
      <div className="bg-white rounded-lg shadow p-4 mb-5 flex flex-wrap items-end gap-4">
        {empresa === 'consolidado' && (
          <div className="w-full text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Extrato disponível apenas por empresa. Mostrando Ambiência (ASS).
          </div>
        )}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Mês</label>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="border rounded px-2 py-1.5 text-sm">
            {MESES_COMPLETOS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Ano</label>
          <select value={ano} onChange={(e) => setAno(Number(e.target.value))} className="border rounded px-2 py-1.5 text-sm">
            {ANOS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <button
          onClick={onCarregar}
          disabled={carregando}
          className="bg-slate-800 text-white px-5 py-2 rounded text-sm font-medium disabled:opacity-50 hover:bg-slate-700"
        >
          {carregando ? 'Carregando...' : 'Carregar'}
        </button>
      </div>

      {erro && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{erro}</div>}

      {!extrato && !carregando && !erro && (
        <div className="text-sm text-gray-400 py-8 text-center">Selecione o período e clique em Carregar.</div>
      )}

      {extrato && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-sm text-blue-600">Saldo Inicial</div>
            <div className="text-xl font-bold text-blue-800">{formatBRL(extrato.saldoInicial)}</div>
          </div>

          {receitas.length > 0 && <GrupoExtrato titulo="Receitas" itens={receitas} cor="green" />}
          {despesas.length > 0 && <GrupoExtrato titulo="Despesas" itens={despesas} cor="red" />}
          {transferencias.length > 0 && <GrupoExtrato titulo="Transferências" itens={transferencias} cor="gray" />}

          {extrato.itens.length === 0 && (
            <div className="text-sm text-gray-400 text-center py-6 bg-white rounded-lg shadow">
              Nenhum lançamento encontrado para o período.
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-green-50 rounded-lg p-4">
              <div className="text-sm text-green-600">Total Receitas</div>
              <div className="text-lg font-bold text-green-700">{formatBRL(extrato.totalReceitas)}</div>
            </div>
            <div className="bg-red-50 rounded-lg p-4">
              <div className="text-sm text-red-600">Total Despesas</div>
              <div className="text-lg font-bold text-red-700">{formatBRL(extrato.totalDespesas)}</div>
            </div>
            <div className={`rounded-lg p-4 ${extrato.saldoFinal >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
              <div className={`text-sm ${extrato.saldoFinal >= 0 ? 'text-green-600' : 'text-red-600'}`}>Saldo Final</div>
              <div className={`text-lg font-bold ${extrato.saldoFinal >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {formatBRL(extrato.saldoFinal)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GrupoExtrato({ titulo, itens, cor }: { titulo: string; itens: ItemExtrato[]; cor: 'green' | 'red' | 'gray' }) {
  const corMap = {
    green: { header: 'text-green-700', valor: 'text-green-700', bg: 'bg-green-50 border-green-200' },
    red: { header: 'text-red-700', valor: 'text-red-600', bg: 'bg-red-50 border-red-200' },
    gray: { header: 'text-gray-600', valor: 'text-gray-600', bg: 'bg-gray-50 border-gray-200' },
  };
  const c = corMap[cor];
  return (
    <div className={`border rounded-lg overflow-hidden ${c.bg}`}>
      <div className={`px-4 py-2 font-semibold text-sm ${c.header}`}>{titulo} ({itens.length})</div>
      <div className="bg-white divide-y divide-gray-100">
        {itens.map((item) => (
          <div key={item.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
            <div className="text-gray-400 w-20 shrink-0">
              {item.data ? new Date(item.data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="truncate font-medium text-gray-800">{item.descricao || '(sem descrição)'}</div>
              <div className="text-xs text-gray-400">{item.categoria}</div>
            </div>
            <div className={`font-medium shrink-0 ${c.valor}`}>{formatBRL(item.valor)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Aba Histórico ────────────────────────────────────────────────────────────

interface AbaHistoricoProps {
  snapshots: SnapshotInfo[];
  carregando: boolean;
  onExcluir: (id: string) => void;
}

function AbaHistorico({ snapshots, carregando, onExcluir }: AbaHistoricoProps) {
  const [confirmando, setConfirmando] = useState<string | null>(null);

  if (carregando) return <div className="text-sm text-gray-400 py-8 text-center">Carregando histórico...</div>;
  if (snapshots.length === 0) return <div className="text-sm text-gray-400 py-8 text-center">Nenhum snapshot encontrado.</div>;

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
          <tr>
            <th className="px-4 py-3 text-left">Data de atualização</th>
            <th className="px-4 py-3 text-left">Mês / Ano ref.</th>
            <th className="px-4 py-3 text-right">Ação</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {snapshots.map((s) => (
            <tr key={s.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-gray-600">{formatDataHora(s.calculado_em)}</td>
              <td className="px-4 py-3 font-medium">{nomeMes(s.mes_ref, s.ano_ref)}</td>
              <td className="px-4 py-3 text-right">
                {confirmando === s.id ? (
                  <span className="flex items-center justify-end gap-2">
                    <span className="text-xs text-gray-500">Excluir?</span>
                    <button onClick={() => { onExcluir(s.id); setConfirmando(null); }} className="text-xs text-red-600 font-medium hover:underline">Sim</button>
                    <button onClick={() => setConfirmando(null)} className="text-xs text-gray-400 hover:underline">Não</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmando(s.id)} className="text-xs text-gray-400 hover:text-red-500 transition-colors">Excluir</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Aba Configurações ────────────────────────────────────────────────────────

interface AbaConfiguracoesProps {
  empresa: EmpresaDRE;
  categorias: DreCategoria[];
  mapeamentos: DreMapeamento[];
  catsCA: CategoriaCA[];
  carregando: boolean;
  carregandoCatsCA: boolean;
  erro: string;
  novoNomeCA: string;
  novaCategoriaId: string;
  salvando: boolean;
  onSetNomeCA: (v: string) => void;
  onSetCategoriaId: (v: string) => void;
  onAdicionar: () => void;
  onRemover: (id: string) => void;
}

// Hierarquia de categorias para o select — usa separadores visuais
function acharCategorias(cats: DreCategoria[], nivel = 0): Array<{ id: string; label: string; nivel: number }> {
  const result: Array<{ id: string; label: string; nivel: number }> = [];
  for (const c of cats) {
    const prefix = nivel === 0 ? '' : nivel === 1 ? '   → ' : '      →→ ';
    result.push({ id: c.id, label: prefix + c.nome, nivel });
    if (c.subcategorias?.length) {
      result.push(...acharCategorias(c.subcategorias, nivel + 1));
    }
  }
  return result;
}

function AbaConfiguracoes({
  empresa, categorias, mapeamentos, catsCA, carregando, carregandoCatsCA, erro,
  novoNomeCA, novaCategoriaId, salvando,
  onSetNomeCA, onSetCategoriaId, onAdicionar, onRemover,
}: AbaConfiguracoesProps) {
  const catsPlanas = acharCategorias(categorias);
  const nomesMapeados = new Set(mapeamentos.map((m) => m.nome_ca));
  const catsCAnaoMapeadas = catsCA.filter((c) => !nomesMapeados.has(c.nome));

  const hoje = new Date();
  const [diag, setDiag] = useState<Record<string, unknown> | null>(null);
  const [diagCarregando, setDiagCarregando] = useState(false);
  const [diagErro, setDiagErro] = useState('');
  const [diagMes, setDiagMes] = useState(hoje.getMonth() + 1);
  const [diagAno, setDiagAno] = useState(hoje.getFullYear());

  async function diagnosticar() {
    const emp = empresa === 'consolidado' ? 'ass' : empresa;
    setDiagCarregando(true);
    setDiagErro('');
    setDiag(null);
    try {
      const resultado = await api<Record<string, unknown>>(
        `/api/financeiro/dre/debug/raw/${emp}/${diagMes}/${diagAno}`
      );
      setDiag(resultado);
    } catch (e) {
      setDiagErro((e as Error).message);
    } finally {
      setDiagCarregando(false);
    }
  }

  if (carregando) return <div className="text-sm text-gray-400 py-8 text-center">Carregando configurações...</div>;

  return (
    <div className="space-y-6">
      {erro && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{erro}</div>}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
        Os mapeamentos são globais — valem para todos os meses e para o cálculo de qualquer período.
        {empresa === 'consolidado' && ' (Editando configurações da ASS; NETR tem configuração separada.)'}
      </div>

      {/* Diagnóstico CA */}
      <div className="bg-white rounded-lg shadow p-5">
        <h2 className="text-base font-semibold mb-1">Diagnóstico Conta Azul</h2>
        <p className="text-xs text-gray-500 mb-3">
          Verifique se o CA retorna lançamentos para um período que você sabe que tem dados cadastrados.
        </p>

        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Mês</label>
            <select value={diagMes} onChange={(e) => setDiagMes(Number(e.target.value))} className="border rounded px-2 py-1.5 text-sm">
              {MESES_COMPLETOS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Ano</label>
            <select value={diagAno} onChange={(e) => setDiagAno(Number(e.target.value))} className="border rounded px-2 py-1.5 text-sm">
              {ANOS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <button
            onClick={diagnosticar}
            disabled={diagCarregando}
            className="bg-slate-700 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50 hover:bg-slate-600"
          >
            {diagCarregando ? 'Consultando...' : 'Testar conexão CA'}
          </button>
        </div>

        {diagErro && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            ❌ Erro de comunicação: {diagErro}
          </div>
        )}

        {diag && (() => {
          type VariacaoDiag = { status: number; params: Record<string, string>; corpo: unknown };
          type GrupoDiag = { camelCase: VariacaoDiag; snakeCase: VariacaoDiag; semFiltro: VariacaoDiag };
          const recGrupo = diag.receitas as GrupoDiag;
          const despGrupo = diag.despesas as GrupoDiag;

          function contarItens(corpo: unknown): { chave: string; quantidade: number; primeiro: Record<string, unknown> | null } | null {
            if (!corpo || typeof corpo !== 'object') return null;
            const d = corpo as Record<string, unknown>;
            for (const chave of ['data', 'content', 'itens', 'items', 'records']) {
              if (Array.isArray(d[chave])) {
                const arr = d[chave] as Record<string, unknown>[];
                return { chave, quantidade: arr.length, primeiro: arr[0] ?? null };
              }
            }
            if (Array.isArray(corpo)) {
              const arr = corpo as Record<string, unknown>[];
              return { chave: '(array direto)', quantidade: arr.length, primeiro: arr[0] ?? null };
            }
            return null;
          }

          function renderVariacao(label: string, v: VariacaoDiag) {
            const info = contarItens(v.corpo);
            const ok = v.status === 200 && (info?.quantidade ?? 0) > 0;
            const semDados = v.status === 404 || (v.status === 200 && (info?.quantidade ?? 0) === 0);
            const semPerm = v.status === 403;
            const cor = ok ? 'bg-green-50 border-green-200 text-green-800' : semPerm ? 'bg-orange-50 border-orange-200 text-orange-800' : semDados ? 'bg-gray-50 border-gray-200 text-gray-600' : 'bg-red-50 border-red-200 text-red-800';
            const icone = ok ? '✅' : semPerm ? '🔒' : semDados ? '—' : '❌';
            return (
              <div key={label} className={`flex items-start gap-2 p-2 rounded border text-xs ${cor}`}>
                <span>{icone}</span>
                <div>
                  <span className="font-medium">{label}:</span>{' '}
                  {ok ? `${info!.quantidade} item(s) — campo "${info!.chave}"` : semPerm ? 'Permissão negada (403)' : semDados ? `Sem dados (HTTP ${v.status})` : `Erro HTTP ${v.status}`}
                  {ok && info?.primeiro && (() => {
                    const p = info.primeiro!;
                    const campos = Object.keys(p).join(' · ');
                    return (
                      <div className="mt-1 font-mono text-gray-500 break-all">{campos}</div>
                    );
                  })()}
                </div>
              </div>
            );
          }

          return (
            <div className="space-y-3 text-sm">
              <div>
                <div className="font-medium mb-1 text-gray-700">Receitas a Receber</div>
                <div className="space-y-1">
                  {renderVariacao('dataVencimentoInicio (camelCase)', recGrupo.camelCase)}
                  {renderVariacao('data_vencimento_inicio (snake_case)', recGrupo.snakeCase)}
                  {renderVariacao('Sem filtro de data', recGrupo.semFiltro)}
                </div>
              </div>
              <div>
                <div className="font-medium mb-1 text-gray-700">Despesas a Pagar</div>
                <div className="space-y-1">
                  {renderVariacao('dataVencimentoInicio (camelCase)', despGrupo.camelCase)}
                  {renderVariacao('data_vencimento_inicio (snake_case)', despGrupo.snakeCase)}
                  {renderVariacao('Sem filtro de data', despGrupo.semFiltro)}
                </div>
              </div>
            </div>
          );
        })()}</div>

      {/* Mapeamentos existentes */}
      <div className="bg-white rounded-lg shadow p-5">
        <h2 className="text-base font-semibold mb-4">Mapeamentos CA → DRE</h2>

        {mapeamentos.length > 0 ? (
          <div className="overflow-x-auto mb-5">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Categoria no Conta Azul</th>
                  <th className="px-3 py-2 text-left">Tipo</th>
                  <th className="px-3 py-2 text-left">Categoria DRE</th>
                  <th className="px-3 py-2 text-center w-20">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {mapeamentos.map((m) => {
                  const catCA = catsCA.find((c) => c.nome === m.nome_ca);
                  return (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-800">{m.nome_ca}</td>
                      <td className="px-3 py-2">
                        {catCA ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${catCA.tipo === 'receita' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {catCA.tipo}
                          </span>
                        ) : <span className="text-gray-400 text-xs">—</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-500">{m.categoria_nome ?? m.categoria_id}</td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => onRemover(m.id)} className="text-red-400 hover:text-red-600 text-xs px-2 py-1 rounded hover:bg-red-50">
                          Remover
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400 mb-4">Nenhum mapeamento cadastrado ainda.</p>
        )}

        {/* Formulário */}
        <div className="border-t pt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Adicionar mapeamento</h3>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-gray-500 mb-1">
                Categoria do Conta Azul
                {carregandoCatsCA && <span className="ml-2 text-gray-400">(buscando...)</span>}
              </label>
              {catsCA.length > 0 ? (
                <select
                  value={novoNomeCA}
                  onChange={(e) => onSetNomeCA(e.target.value)}
                  className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-slate-500"
                >
                  <option value="">Selecione uma categoria CA...</option>
                  <optgroup label="Receitas">
                    {catsCA.filter((c) => c.tipo === 'receita').map((c) => (
                      <option key={c.nome} value={c.nome}>
                        {c.nome} ({c.count}× · {formatBRLK(c.total)})
                        {nomesMapeados.has(c.nome) ? ' ✓' : ''}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Despesas">
                    {catsCA.filter((c) => c.tipo === 'despesa').map((c) => (
                      <option key={c.nome} value={c.nome}>
                        {c.nome} ({c.count}× · {formatBRLK(c.total)})
                        {nomesMapeados.has(c.nome) ? ' ✓' : ''}
                      </option>
                    ))}
                  </optgroup>
                </select>
              ) : (
                <input
                  type="text"
                  value={novoNomeCA}
                  onChange={(e) => onSetNomeCA(e.target.value)}
                  placeholder={carregandoCatsCA ? 'Buscando categorias do CA...' : 'Digite o nome exato da categoria'}
                  className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-slate-500"
                  disabled={carregandoCatsCA}
                />
              )}
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-gray-500 mb-1">Categoria DRE</label>
              <select
                value={novaCategoriaId}
                onChange={(e) => onSetCategoriaId(e.target.value)}
                className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-slate-500"
              >
                <option value="">Selecione a categoria DRE...</option>
                {catsPlanas.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={onAdicionar}
              disabled={salvando || !novoNomeCA.trim() || !novaCategoriaId}
              className="bg-slate-800 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50 hover:bg-slate-700 whitespace-nowrap"
            >
              {salvando ? 'Salvando...' : 'Adicionar'}
            </button>
          </div>
        </div>
      </div>

      {/* Categorias CA não mapeadas */}
      {(catsCAnaoMapeadas.length > 0 || carregandoCatsCA) && (
        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="text-base font-semibold mb-1">
            Categorias sem mapeamento
            {catsCAnaoMapeadas.length > 0 && (
              <span className="ml-2 text-sm font-normal text-yellow-600">({catsCAnaoMapeadas.length})</span>
            )}
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Categorias encontradas no Conta Azul nos últimos 12 meses que ainda não têm mapeamento DRE.
            Clique em "Mapear" para pré-preencher o formulário.
          </p>

          {carregandoCatsCA && (
            <div className="text-sm text-gray-400 animate-pulse">Buscando categorias do Conta Azul...</div>
          )}

          {!carregandoCatsCA && (
            <div className="space-y-2">
              {catsCAnaoMapeadas.map((cat) => (
                <div key={cat.nome} className="flex items-center gap-3 py-2 px-3 bg-yellow-50 border border-yellow-200 rounded text-sm">
                  <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${cat.tipo === 'receita' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {cat.tipo}
                  </span>
                  <span className="text-yellow-800 flex-1">{cat.nome}</span>
                  <span className="text-xs text-yellow-600 shrink-0">{cat.count}× · {formatBRLK(cat.total)}</span>
                  <button
                    onClick={() => onSetNomeCA(cat.nome)}
                    className="text-xs text-yellow-700 hover:text-yellow-900 border border-yellow-400 px-3 py-1 rounded hover:bg-yellow-100 shrink-0"
                  >
                    Mapear
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
