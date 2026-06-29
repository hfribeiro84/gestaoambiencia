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
  subcategorias: DreCategoria[];
}

interface DreMapeamento {
  id: string;
  empresa: string;
  nome_ca: string;
  categoria_id: string;
  categoria_nome?: string;
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

function formatDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
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
  const [carregandoConfig, setCarregandoConfig] = useState(false);
  const [erroConfig, setErroConfig] = useState('');
  const [novaNomeCA, setNovaNomeCA] = useState('');
  const [novaCategoriaId, setNovaCategoriaId] = useState('');
  const [salvandoMap, setSalvandoMap] = useState(false);

  // ── Carregar último snapshot ao mudar empresa ──────────────────────────────
  const carregarSnapshot = useCallback(async () => {
    setCarregandoDRE(true);
    setErroDRE('');
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
    try {
      const snap = await api<DreSnapshot>(`/api/financeiro/dre/calcular/${empresa}/${mes}/${ano}`, { method: 'POST' });
      setSnapshot(snap);
    } catch (e) {
      setErroDRE((e as Error).message);
    } finally {
      setCalculando(false);
    }
  }

  // ── Carregar extrato ───────────────────────────────────────────────────────
  async function carregarExtrato() {
    setCarregandoExtrato(true);
    setErroExtrato('');
    try {
      const ext = await api<DadosExtrato>(`/api/financeiro/dre/extrato/${empresa}/${mesExtrato}/${anoExtrato}`);
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
    try {
      const [cats, maps] = await Promise.all([
        api<DreCategoria[]>(`/api/financeiro/dre/categorias`),
        api<DreMapeamento[]>(`/api/financeiro/dre/mapeamento/${empresa}`),
      ]);
      setCategorias(cats);
      setMapeamentos(maps);
    } catch (e) {
      setErroConfig((e as Error).message);
    } finally {
      setCarregandoConfig(false);
    }
  }, [empresa]);

  useEffect(() => {
    if (aba === 'configuracoes') carregarConfig();
  }, [aba, empresa, carregarConfig]);

  // ── Adicionar mapeamento ───────────────────────────────────────────────────
  async function adicionarMapeamento() {
    if (!novaNomeCA.trim() || !novaCategoriaId) return;
    setSalvandoMap(true);
    try {
      await api<DreMapeamento>(`/api/financeiro/dre/mapeamento/${empresa}`, {
        method: 'POST',
        body: JSON.stringify({ nome_ca: novaNomeCA.trim(), categoria_id: novaCategoriaId }),
      });
      setNovaNomeCA('');
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
    try {
      await api(`/api/financeiro/dre/mapeamento/${empresa}/${id}`, { method: 'DELETE' });
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
          categorias={categorias}
          mapeamentos={mapeamentos}
          naoMapeadas={snapshot?.dados.naoMapeadas ?? []}
          carregando={carregandoConfig}
          erro={erroConfig}
          novaNomeCA={novaNomeCA}
          novaCategoriaId={novaCategoriaId}
          salvando={salvandoMap}
          onSetNomeCA={setNovaNomeCA}
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
  mes: number;
  ano: number;
  setMes: (m: number) => void;
  setAno: (a: number) => void;
  snapshot: DreSnapshot | null;
  carregando: boolean;
  calculando: boolean;
  erro: string;
  expandidos: Set<string>;
  onToggle: (id: string) => void;
  onCalcular: () => void;
}

function AbaDRE({
  mes, ano, setMes, setAno, snapshot, carregando, calculando, erro, expandidos, onToggle, onCalcular,
}: AbaDREProps) {
  const dados = snapshot?.dados ?? null;
  const meses = dados?.meses ?? [];

  // KPIs: valor do mês de referência
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
      {/* Seletor de período + botão Atualizar */}
      <div className="bg-white rounded-lg shadow p-4 mb-5 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Mês de referência</label>
          <select
            value={mes}
            onChange={(e) => setMes(Number(e.target.value))}
            className="border rounded px-2 py-1.5 text-sm"
          >
            {MESES_COMPLETOS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Ano</label>
          <select
            value={ano}
            onChange={(e) => setAno(Number(e.target.value))}
            className="border rounded px-2 py-1.5 text-sm"
          >
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
        {snapshot && (
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <KpiCard label="Receita Bruta" valor={kpiReceitaBruta} cor="gray" />
            <KpiCard label="Resultado Operacional" valor={kpiResultadoOp} cor="auto" />
            <KpiCard label="Fluxo de Caixa Livre" valor={kpiFluxoCaixa} cor="auto" />
            <KpiCard label="Resultado Líquido" valor={kpiResultadoLiq} cor="auto" />
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
                />
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
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

// ─── Tabela DRE (linhas) ──────────────────────────────────────────────────────

interface TabelaDREProps {
  categorias: LinhaDRE[];
  totais: TotaisCalculados;
  meses: Array<{ mes: number; ano: number }>;
  expandidos: Set<string>;
  onToggle: (id: string) => void;
}

// Linhas "calculadas" que aparecem em posições específicas do DRE
type LinhaCalculada = {
  id: string;
  nome: string;
  valores: ValorMes[];
  aposGrupo: TipoCategoria | TipoCategoria[];
};

const LINHAS_CALCULADAS: LinhaCalculada[] = [
  { id: 'receita_liquida', nome: '= Receita Líquida', valores: [], aposGrupo: 'deducao' },
  { id: 'resultado_operacional', nome: '= Resultado Operacional', valores: [], aposGrupo: ['custo', 'despesa'] },
  { id: 'resultado_liquido', nome: '= Resultado Líquido', valores: [], aposGrupo: 'financeiro' },
  { id: 'fluxo_caixa_livre', nome: '= Fluxo de Caixa Livre', valores: [], aposGrupo: 'divisao' },
];

function resolverValoresCalculados(totais: TotaisCalculados): Record<string, ValorMes[]> {
  return {
    receita_liquida: totais.receitaLiquida,
    resultado_operacional: totais.resultadoOperacional,
    resultado_liquido: totais.resultadoLiquido,
    fluxo_caixa_livre: totais.fluxoCaixaLivre,
  };
}

function TabelaDRE({ categorias, totais, meses, expandidos, onToggle }: TabelaDREProps) {
  const valoresCalculados = resolverValoresCalculados(totais);
  const receitaBrutaTotal12 = somaTotal(totais.receitaBruta);

  // Agrupar categorias por tipo, na ordem correta do DRE
  const ordem: TipoCategoria[] = ['receita', 'deducao', 'custo', 'despesa', 'financeiro', 'divisao'];
  const porTipo: Record<TipoCategoria, LinhaDRE[]> = {
    receita: [], deducao: [], custo: [], despesa: [], financeiro: [], divisao: [],
  };
  for (const cat of categorias) {
    if (porTipo[cat.tipo]) porTipo[cat.tipo].push(cat);
  }

  const linhasCalculadasAposGrupo: Record<string, string> = {
    deducao: 'receita_liquida',
    // "despesa" é o último antes de resultado_operacional; tratamos após 'despesa'
    financeiro: 'resultado_liquido',
    divisao: 'fluxo_caixa_livre',
  };

  const rows: JSX.Element[] = [];

  // Título de seção por tipo
  const LABEL_TIPO: Record<TipoCategoria, string> = {
    receita: 'Receita Bruta (Serviços)',
    deducao: 'Deduções da Receita Bruta',
    custo: 'Custos Projetos',
    despesa: 'Despesas',
    financeiro: 'Operação Financeira',
    divisao: 'Divisão de Resultados',
  };

  for (const tipo of ordem) {
    const cats = porTipo[tipo];
    if (cats.length === 0 && tipo !== 'custo' && tipo !== 'despesa') {
      // Mesmo sem itens, mostrar a linha de grupo (para que as calculadas apareçam)
    }

    // Linha de grupo/seção
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

    // Linhas de subcategorias
    for (const cat of cats) {
      rows.push(...renderLinhaCategoria(cat, meses, expandidos, onToggle, receitaBrutaTotal12, 0));
    }

    // Linhas calculadas após este grupo
    const calcId = linhasCalculadasAposGrupo[tipo];
    if (calcId) {
      const vals = valoresCalculados[calcId] ?? [];
      rows.push(
        <LinhaCalculadaRow
          key={`calc-${calcId}`}
          nome={LINHAS_CALCULADAS.find((l) => l.id === calcId)?.nome ?? calcId}
          valores={vals}
          meses={meses}
          receitaBrutaTotal12={receitaBrutaTotal12}
        />
      );
    }

    // Caso especial: resultado operacional aparece APÓS despesas
    if (tipo === 'despesa') {
      const vals = valoresCalculados['resultado_operacional'] ?? [];
      rows.push(
        <LinhaCalculadaRow
          key="calc-resultado_operacional"
          nome="= Resultado Operacional"
          valores={vals}
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
  const indent = nivel === 0 ? 'pl-6' : 'pl-10';

  const rows: JSX.Element[] = [
    <tr key={cat.id} className="hover:bg-gray-50">
      <td className={`px-4 py-1.5 sticky left-0 bg-white z-10 hover:bg-gray-50 ${indent}`}>
        <div className="flex items-center gap-1">
          {temSubs && (
            <button
              onClick={() => onToggle(cat.id)}
              className="text-gray-400 hover:text-gray-600 w-4 text-xs leading-none"
            >
              {aberto ? '▼' : '▶'}
            </button>
          )}
          {!temSubs && <span className="w-4" />}
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

function LinhaCalculadaRow({
  nome, valores, meses, receitaBrutaTotal12,
}: {
  nome: string;
  valores: ValorMes[];
  meses: Array<{ mes: number; ano: number }>;
  receitaBrutaTotal12: number;
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

// ─── Aba Extrato ──────────────────────────────────────────────────────────────

interface AbaExtratoProps {
  mes: number;
  ano: number;
  setMes: (m: number) => void;
  setAno: (a: number) => void;
  extrato: DadosExtrato | null;
  carregando: boolean;
  erro: string;
  onCarregar: () => void;
}

function AbaExtrato({ mes, ano, setMes, setAno, extrato, carregando, erro, onCarregar }: AbaExtratoProps) {
  const receitas = extrato?.itens.filter((i) => i.tipo === 'receita') ?? [];
  const despesas = extrato?.itens.filter((i) => i.tipo === 'despesa') ?? [];
  const transferencias = extrato?.itens.filter((i) => i.tipo === 'transferencia') ?? [];

  return (
    <div>
      {/* Controles */}
      <div className="bg-white rounded-lg shadow p-4 mb-5 flex flex-wrap items-end gap-4">
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
          {/* Saldo inicial */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-sm text-blue-600">Saldo Inicial</div>
            <div className="text-xl font-bold text-blue-800">{formatBRL(extrato.saldoInicial)}</div>
          </div>

          {/* Receitas */}
          {receitas.length > 0 && (
            <GrupoExtrato titulo="Receitas" itens={receitas} cor="green" />
          )}

          {/* Despesas */}
          {despesas.length > 0 && (
            <GrupoExtrato titulo="Despesas" itens={despesas} cor="red" />
          )}

          {/* Transferências */}
          {transferencias.length > 0 && (
            <GrupoExtrato titulo="Transferências" itens={transferencias} cor="gray" />
          )}

          {/* Totais + saldo final */}
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
      <div className={`px-4 py-2 font-semibold text-sm ${c.header}`}>{titulo}</div>
      <div className="bg-white divide-y divide-gray-100">
        {itens.map((item) => (
          <div key={item.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
            <div className="text-gray-400 w-20 shrink-0">
              {new Date(item.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
            </div>
            <div className="flex-1 min-w-0">
              <div className="truncate font-medium text-gray-800">{item.descricao}</div>
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

  if (carregando) {
    return <div className="text-sm text-gray-400 py-8 text-center">Carregando histórico...</div>;
  }

  if (snapshots.length === 0) {
    return <div className="text-sm text-gray-400 py-8 text-center">Nenhum snapshot encontrado.</div>;
  }

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
                    <button
                      onClick={() => { onExcluir(s.id); setConfirmando(null); }}
                      className="text-xs text-red-600 font-medium hover:underline"
                    >
                      Sim
                    </button>
                    <button
                      onClick={() => setConfirmando(null)}
                      className="text-xs text-gray-400 hover:underline"
                    >
                      Não
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmando(s.id)}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                  >
                    Excluir
                  </button>
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
  categorias: DreCategoria[];
  mapeamentos: DreMapeamento[];
  naoMapeadas: string[];
  carregando: boolean;
  erro: string;
  novaNomeCA: string;
  novaCategoriaId: string;
  salvando: boolean;
  onSetNomeCA: (v: string) => void;
  onSetCategoriaId: (v: string) => void;
  onAdicionar: () => void;
  onRemover: (id: string) => void;
}

// Achata a árvore de categorias em lista plana para o <select>
function acharCategorias(cats: DreCategoria[], nivel = 0): Array<{ id: string; nome: string; nivel: number }> {
  const result: Array<{ id: string; nome: string; nivel: number }> = [];
  for (const c of cats) {
    result.push({ id: c.id, nome: c.nome, nivel });
    if (c.subcategorias?.length) {
      result.push(...acharCategorias(c.subcategorias, nivel + 1));
    }
  }
  return result;
}

function AbaConfiguracoes({
  categorias, mapeamentos, naoMapeadas, carregando, erro,
  novaNomeCA, novaCategoriaId, salvando,
  onSetNomeCA, onSetCategoriaId, onAdicionar, onRemover,
}: AbaConfiguracoesProps) {
  const catsPlanas = acharCategorias(categorias);

  function preencherNaoMapeada(nome: string) {
    onSetNomeCA(nome);
  }

  if (carregando) {
    return <div className="text-sm text-gray-400 py-8 text-center">Carregando configurações...</div>;
  }

  return (
    <div className="space-y-6">
      {erro && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{erro}</div>}

      {/* Seção: Mapeamentos */}
      <div className="bg-white rounded-lg shadow p-5">
        <h2 className="text-base font-semibold mb-4">Mapeamentos CA → DRE</h2>

        {/* Tabela de mapeamentos existentes */}
        {mapeamentos.length > 0 ? (
          <div className="overflow-x-auto mb-5">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Nome no Conta Azul</th>
                  <th className="px-3 py-2 text-left">Categoria DRE</th>
                  <th className="px-3 py-2 text-center w-20">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {mapeamentos.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-800">{m.nome_ca}</td>
                    <td className="px-3 py-2 text-gray-500">{m.categoria_nome ?? m.categoria_id}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => onRemover(m.id)}
                        className="text-red-400 hover:text-red-600 text-xs px-2 py-1 rounded hover:bg-red-50"
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400 mb-4">Nenhum mapeamento cadastrado ainda.</p>
        )}

        {/* Formulário de novo mapeamento */}
        <div className="border-t pt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Adicionar mapeamento</h3>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs text-gray-500 mb-1">Nome CA (como aparece no Conta Azul)</label>
              <input
                type="text"
                value={novaNomeCA}
                onChange={(e) => onSetNomeCA(e.target.value)}
                placeholder="Ex: Serviços de Consultoria"
                className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-slate-500"
              />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs text-gray-500 mb-1">Categoria DRE</label>
              <select
                value={novaCategoriaId}
                onChange={(e) => onSetCategoriaId(e.target.value)}
                className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-slate-500"
              >
                <option value="">Selecione...</option>
                {catsPlanas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {'  '.repeat(c.nivel)}{c.nome}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={onAdicionar}
              disabled={salvando || !novaNomeCA.trim() || !novaCategoriaId}
              className="bg-slate-800 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50 hover:bg-slate-700 whitespace-nowrap"
            >
              {salvando ? 'Salvando...' : 'Adicionar'}
            </button>
          </div>
        </div>
      </div>

      {/* Seção: Não mapeadas */}
      {naoMapeadas.length > 0 && (
        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="text-base font-semibold mb-1">Categorias sem mapeamento</h2>
          <p className="text-sm text-gray-500 mb-4">
            Estas categorias do Conta Azul aparecem no extrato mas não têm mapeamento DRE.
            Clique em "Mapear" para pré-preencher o formulário acima.
          </p>
          <div className="space-y-2">
            {naoMapeadas.map((nome) => (
              <div key={nome} className="flex items-center justify-between py-2 px-3 bg-yellow-50 border border-yellow-200 rounded text-sm">
                <span className="text-yellow-800">{nome}</span>
                <button
                  onClick={() => preencherNaoMapeada(nome)}
                  className="text-xs text-yellow-700 hover:text-yellow-900 border border-yellow-400 px-3 py-1 rounded hover:bg-yellow-100"
                >
                  Mapear
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
