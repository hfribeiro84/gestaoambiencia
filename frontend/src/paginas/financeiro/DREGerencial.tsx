import { useCallback, useEffect, useState, type JSX } from 'react';
import { api } from '../../lib/api';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type EmpresaDRE = 'ass' | 'netr' | 'consolidado';
type TipoCategoria = 'receita' | 'deducao' | 'custo' | 'despesa' | 'financeiro' | 'divisao';
type FormulaSubtotal = 'receita_liquida' | 'resultado_operacional' | 'resultado_liquido' | 'fluxo_caixa_livre';
type Aba = 'dre' | 'extrato' | 'configuracoes';

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
  ordem: number;
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

interface DreSubtotal {
  id: string;
  nome: string;
  formula: FormulaSubtotal;
  apos_tipo: TipoCategoria;
  ordem: number;
}

type SubtotalPatch = Partial<{ nome: string; formula: FormulaSubtotal; apos_tipo: TipoCategoria; ordem: number }>;

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
  saldo?: number;
  previsto?: boolean;
}

interface ItemAtraso {
  id: string;
  descricao: string;
  categoria: string;
  dataVencimento: string;
  valorAberto: number;
  diasAtraso: number;
}

interface AtrasadosResumo {
  aReceber: ItemAtraso[];
  aPagar: ItemAtraso[];
  totalReceber: number;
  totalPagar: number;
}

interface ExtratoSalvo {
  empresa: string;
  periodoDe: string;
  periodoAte: string;
  saldoInicial: number;
  atualizadoEm: string;
  itens: ItemExtrato[];
  totalReceitas: number;
  totalDespesas: number;
  saldoFinal: number;
  atrasados?: AtrasadosResumo | null;
}

interface MetaExtrato {
  periodoDe: string;
  periodoAte: string;
  atualizadoEm: string;
  atrasados?: AtrasadosResumo | null;
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

/** Formata data 'YYYY-MM-DD' como dd/mm/aaaa (sem hora). */
function formatData(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR');
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

  // Extrato (materializado no banco — base da DRE)
  const [extratoSalvo, setExtratoSalvo] = useState<ExtratoSalvo | null>(null);
  const [extratoMeta, setExtratoMeta] = useState<MetaExtrato | null>(null);
  const [extratoDe, setExtratoDe] = useState('');
  const [extratoAte, setExtratoAte] = useState('');
  const [extratoSaldoInicial, setExtratoSaldoInicial] = useState('');
  const [modalExtrato, setModalExtrato] = useState(false);
  const [atualizandoExtrato, setAtualizandoExtrato] = useState(false);
  const [processandoExtrato, setProcessandoExtrato] = useState(false);
  const [carregandoExtrato, setCarregandoExtrato] = useState(false);
  const [erroExtrato, setErroExtrato] = useState('');

  // Configurações
  const [categorias, setCategorias] = useState<DreCategoria[]>([]);
  const [mapeamentos, setMapeamentos] = useState<DreMapeamento[]>([]);
  const [catsCA, setCatsCA] = useState<CategoriaCA[]>([]);
  const [carregandoConfig, setCarregandoConfig] = useState(false);
  const [carregandoCatsCA, setCarregandoCatsCA] = useState(false);
  const [erroConfig, setErroConfig] = useState('');
  const [erroCatsCA, setErroCatsCA] = useState('');
  const [subtotais, setSubtotais] = useState<DreSubtotal[]>([]);
  const [mappingsAlterados, setMappingsAlterados] = useState(false);

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
      setMappingsAlterados(false);
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

  // ── Extrato salvo (base da DRE) ──────────────────────────────────────────────
  const empresaExtrato = empresa === 'consolidado' ? 'ass' : empresa;

  // Metadados (período disponível + atualização) — exibidos nas abas DRE e Extrato.
  const carregarExtratoMeta = useCallback(async () => {
    try {
      const meta = await api<MetaExtrato | null>(`/api/financeiro/dre/extrato-meta/${empresa === 'consolidado' ? 'ass' : empresa}`);
      setExtratoMeta(meta);
    } catch {
      setExtratoMeta(null);
    }
  }, [empresa]);

  useEffect(() => { carregarExtratoMeta(); }, [carregarExtratoMeta]);

  // Extrato salvo completo (itens + saldo) — carregado ao abrir a aba Extrato.
  const carregarExtratoSalvo = useCallback(async () => {
    setCarregandoExtrato(true);
    setErroExtrato('');
    try {
      const emp = empresa === 'consolidado' ? 'ass' : empresa;
      const ext = await api<ExtratoSalvo | null>(`/api/financeiro/dre/extrato/${emp}`);
      setExtratoSalvo(ext);
      if (ext) { setExtratoDe(ext.periodoDe); setExtratoAte(ext.periodoAte); setExtratoSaldoInicial(String(ext.saldoInicial ?? 0)); }
    } catch (e) {
      setErroExtrato((e as Error).message);
      setExtratoSalvo(null);
    } finally {
      setCarregandoExtrato(false);
    }
  }, [empresa]);

  useEffect(() => {
    if (aba === 'extrato') carregarExtratoSalvo();
  }, [aba, carregarExtratoSalvo]);

  // Rebuild COMPLETO: roda em background no servidor (pode levar minutos).
  // Dispara e acompanha o status até terminar. `reprocessar` ignora o cache.
  async function atualizarExtrato(reprocessar = false) {
    if (!extratoDe || !extratoAte) { setErroExtrato('Informe o período inicial e final.'); return; }
    setAtualizandoExtrato(true);
    setErroExtrato('');
    try {
      const saldoNum = parseFloat(extratoSaldoInicial.replace(',', '.'));
      await api(`/api/financeiro/dre/extrato/${empresaExtrato}`, {
        method: 'POST',
        body: JSON.stringify({
          de: extratoDe,
          ate: extratoAte,
          ...(reprocessar ? { reprocessar: true } : {}),
          ...(Number.isNaN(saldoNum) ? {} : { saldoInicial: saldoNum }),
        }),
      });
      setModalExtrato(false);
      setProcessandoExtrato(true);
      await aguardarProcessamento();
    } catch (e) {
      setErroExtrato((e as Error).message);
      setAtualizandoExtrato(false);
    }
  }

  // Consulta o status do rebuild até terminar (ou dar erro / estourar o tempo).
  async function aguardarProcessamento() {
    const emp = empresa === 'consolidado' ? 'ass' : empresa;
    const inicio = Date.now();
    const MAX_MS = 25 * 60 * 1000; // 25 min
    while (Date.now() - inicio < MAX_MS) {
      await new Promise((r) => setTimeout(r, 6000));
      try {
        const s = await api<{ estado: string; mensagem?: string }>(`/api/financeiro/dre/extrato/${emp}/status`);
        if (s.estado === 'ok') {
          await carregarExtratoSalvo();
          await carregarExtratoMeta();
          setProcessandoExtrato(false);
          setAtualizandoExtrato(false);
          return;
        }
        if (s.estado === 'erro') {
          setErroExtrato('Falha no processamento: ' + (s.mensagem ?? 'erro desconhecido'));
          setProcessandoExtrato(false);
          setAtualizandoExtrato(false);
          return;
        }
      } catch {
        /* segue tentando — falha de rede pontual não interrompe */
      }
    }
    setErroExtrato('O processamento está demorando mais que o normal. Ele continua rodando no servidor — recarregue a página em alguns minutos para ver o resultado.');
    setProcessandoExtrato(false);
    setAtualizandoExtrato(false);
  }

  function reprocessarExtrato() {
    if (!extratoSalvo) return;
    if (!window.confirm('Reprocessar todo o extrato ignorando o cache de baixas? Refaz do zero — pode demorar mais.')) return;
    atualizarExtrato(true);
  }

  // Atualização incremental: congela o histórico, refaz só os últimos meses + futuro.
  async function atualizarRecente() {
    setAtualizandoExtrato(true);
    setErroExtrato('');
    try {
      const ext = await api<ExtratoSalvo>(`/api/financeiro/dre/extrato/${empresaExtrato}/recente`, { method: 'POST' });
      setExtratoSalvo(ext);
      setExtratoMeta({ periodoDe: ext.periodoDe, periodoAte: ext.periodoAte, atualizadoEm: ext.atualizadoEm, atrasados: ext.atrasados });
    } catch (e) {
      setErroExtrato((e as Error).message);
    } finally {
      setAtualizandoExtrato(false);
    }
  }

  // ── Carregar configurações ─────────────────────────────────────────────────
  const carregarConfig = useCallback(async () => {
    setCarregandoConfig(true);
    setErroConfig('');
    const empresaConfig = empresa === 'consolidado' ? 'ass' : empresa;
    try {
      const [cats, maps, subs] = await Promise.all([
        api<DreCategoria[]>(`/api/financeiro/dre/categorias`),
        api<DreMapeamento[]>(`/api/financeiro/dre/mapeamento/${empresaConfig}`),
        api<DreSubtotal[]>(`/api/financeiro/dre/subtotais`),
      ]);
      setCategorias(cats);
      setMapeamentos(maps);
      setSubtotais(subs);
    } catch (e) {
      setErroConfig((e as Error).message);
    } finally {
      setCarregandoConfig(false);
    }

    // Carrega categorias do CA em paralelo (pode demorar — busca 12 meses no CA)
    if (empresa !== 'consolidado') {
      setCarregandoCatsCA(true);
      setErroCatsCA('');
      try {
        const cats = await api<CategoriaCA[]>(`/api/financeiro/dre/categorias-ca/${empresaConfig}`);
        setCatsCA(cats);
      } catch (e) {
        setCatsCA([]);
        setErroCatsCA((e as Error).message);
      } finally {
        setCarregandoCatsCA(false);
      }
    }
  }, [empresa]);

  useEffect(() => {
    if (aba === 'configuracoes') carregarConfig();
  }, [aba, empresa, carregarConfig]);

  // Carrega subtotais na montagem para que a aba DRE já os tenha disponíveis
  useEffect(() => {
    api<DreSubtotal[]>('/api/financeiro/dre/subtotais').then(setSubtotais).catch(() => setSubtotais([]));
  }, []);

  // ── Remover mapeamento ─────────────────────────────────────────────────────
  async function removerMapeamento(id: string) {
    const empresaConfig = empresa === 'consolidado' ? 'ass' : empresa;
    try {
      await api(`/api/financeiro/dre/mapeamento/${empresaConfig}/${id}`, { method: 'DELETE' });
      await carregarConfig();
      setMappingsAlterados(true);
    } catch (e) {
      setErroConfig((e as Error).message);
    }
  }

  // ── CRUD da estrutura de categorias DRE ────────────────────────────────────
  async function criarCategoria(dados: { nome: string; pai_id: string | null; tipo: TipoCategoria; sinal: number }) {
    setErroConfig('');
    try {
      await api(`/api/financeiro/dre/categorias`, { method: 'POST', body: JSON.stringify(dados) });
      await carregarConfig();
    } catch (e) {
      setErroConfig((e as Error).message);
      throw e;
    }
  }

  async function editarCategoria(id: string, patch: Partial<{ nome: string; pai_id: string | null; tipo: TipoCategoria; sinal: number; ordem: number }>) {
    setErroConfig('');
    try {
      await api(`/api/financeiro/dre/categorias/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      await carregarConfig();
    } catch (e) {
      setErroConfig((e as Error).message);
      throw e;
    }
  }

  async function excluirCategoria(id: string) {
    setErroConfig('');
    try {
      await api(`/api/financeiro/dre/categorias/${id}`, { method: 'DELETE' });
      await carregarConfig();
    } catch (e) {
      setErroConfig((e as Error).message);
      throw e;
    }
  }

  async function salvarTudoEstrutura(
    catChanges: Map<string, Partial<{ nome: string; pai_id: string | null; tipo: TipoCategoria; sinal: number; ordem: number }>>,
    subChanges: Map<string, SubtotalPatch>,
  ) {
    setErroConfig('');
    try {
      for (const [id, patch] of catChanges) {
        await api(`/api/financeiro/dre/categorias/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      }
      for (const [id, patch] of subChanges) {
        await api(`/api/financeiro/dre/subtotais/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      }
      await carregarConfig();
    } catch (e) {
      setErroConfig((e as Error).message);
      throw e;
    }
  }

  async function criarSubtotal(dados: { nome: string; formula: FormulaSubtotal; apos_tipo: TipoCategoria }) {
    setErroConfig('');
    try {
      await api('/api/financeiro/dre/subtotais', { method: 'POST', body: JSON.stringify(dados) });
      await carregarConfig();
    } catch (e) {
      setErroConfig((e as Error).message);
      throw e;
    }
  }

  async function excluirSubtotal(id: string) {
    setErroConfig('');
    try {
      await api(`/api/financeiro/dre/subtotais/${id}`, { method: 'DELETE' });
      await carregarConfig();
    } catch (e) {
      setErroConfig((e as Error).message);
      throw e;
    }
  }

  async function adicionarMapeamentoInline(nomeCA: string, categoriaId: string) {
    const empresaConfig = empresa === 'consolidado' ? 'ass' : empresa;
    try {
      await api<DreMapeamento>(`/api/financeiro/dre/mapeamento/${empresaConfig}`, {
        method: 'POST',
        body: JSON.stringify({ nome_ca: nomeCA, categoria_id: categoriaId }),
      });
      await carregarConfig();
      setMappingsAlterados(true);
    } catch (e) {
      setErroConfig((e as Error).message);
      throw e;
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
        Demonstrativo de Resultado do Exercício — caixa (até ontem) + previsto (a partir de hoje).
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
          subtotais={subtotais}
          mappingsAlterados={mappingsAlterados}
          extratoMeta={extratoMeta}
        />
      )}

      {/* ── ABA EXTRATO ────────────────────────────────────────────────────── */}
      {aba === 'extrato' && (
        <AbaExtrato
          empresa={empresa}
          extrato={extratoSalvo}
          meta={extratoMeta}
          carregando={carregandoExtrato}
          erro={erroExtrato}
          modalAberto={modalExtrato}
          de={extratoDe}
          ate={extratoAte}
          setDe={setExtratoDe}
          setAte={setExtratoAte}
          saldoInicial={extratoSaldoInicial}
          setSaldoInicial={setExtratoSaldoInicial}
          atualizando={atualizandoExtrato}
          processando={processandoExtrato}
          onAbrirModal={() => setModalExtrato(true)}
          onFecharModal={() => setModalExtrato(false)}
          onAtualizar={() => atualizarExtrato(false)}
          onAtualizarRecente={atualizarRecente}
          onReprocessar={reprocessarExtrato}
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
          erroCatsCA={erroCatsCA}
          subtotais={subtotais}
          onRemover={removerMapeamento}
          onAdicionarMapeamento={adicionarMapeamentoInline}
          onCriarCategoria={criarCategoria}
          onEditarCategoria={editarCategoria}
          onExcluirCategoria={excluirCategoria}
          onCriarSubtotal={criarSubtotal}
          onExcluirSubtotal={excluirSubtotal}
          onSalvarTudoEstrutura={salvarTudoEstrutura}
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
  subtotais: DreSubtotal[];
  mappingsAlterados: boolean;
  extratoMeta: MetaExtrato | null;
}

function AbaDRE({
  mes, ano, setMes, setAno, snapshot, carregando, calculando, erro,
  expandidos, onToggle, onCalcular,
  resumo, carregandoResumo, erroResumo, mostrarResumo, onGerarResumo, onFecharResumo,
  subtotais, mappingsAlterados, extratoMeta,
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
            DRE gerada em {formatDataHora(snapshot.calculado_em)}
          </span>
        )}
      </div>

      {/* Base de dados: extrato salvo no banco */}
      <div className="mb-4 text-xs">
        {extratoMeta ? (
          <span className="text-gray-500">
            Base: extrato de <strong>{formatData(extratoMeta.periodoDe)}</strong> a{' '}
            <strong>{formatData(extratoMeta.periodoAte)}</strong> · atualizado em {formatDataHora(extratoMeta.atualizadoEm)}
          </span>
        ) : (
          <span className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">
            Nenhum extrato salvo. Vá na aba <strong>Extrato</strong>, atualize o período e volte — a DRE usa o extrato como base.
          </span>
        )}
      </div>

      <PainelAtrasados atrasados={extratoMeta?.atrasados} />

      {mappingsAlterados && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800 flex items-center justify-between gap-3">
          <span>Mapeamentos alterados — clique em <strong>Atualizar</strong> para recalcular o DRE com os novos valores.</span>
          <button
            onClick={onCalcular}
            disabled={calculando || carregando}
            className="text-xs bg-amber-700 text-white px-3 py-1.5 rounded font-medium disabled:opacity-50 hover:bg-amber-800 shrink-0"
          >
            {calculando ? 'Calculando...' : 'Atualizar agora'}
          </button>
        </div>
      )}

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
                  subtotais={subtotais}
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
  subtotais: DreSubtotal[];
}

const LABEL_TIPO: Record<TipoCategoria, string> = {
  receita: 'Receita Bruta (Serviços)',
  deducao: 'Deduções da Receita Bruta',
  custo: 'Custos Projetos',
  despesa: 'Despesas',
  financeiro: 'Operação Financeira',
  divisao: 'Divisão de Resultados',
};

function TabelaDRE({ categorias, totais, meses, expandidos, onToggle, naoMapeadasReceita, naoMapeadasDespesa, subtotais }: TabelaDREProps) {
  const valoresCalculados: Record<string, ValorMes[]> = {
    receita_liquida: totais.receitaLiquida,
    resultado_operacional: totais.resultadoOperacional,
    resultado_liquido: totais.resultadoLiquido,
    fluxo_caixa_livre: totais.fluxoCaixaLivre,
  };
  const receitaBrutaTotal12 = somaTotal(totais.receitaBruta);

  const subtotaisPorTipo = new Map<TipoCategoria, DreSubtotal[]>();
  for (const sub of subtotais) {
    const list = subtotaisPorTipo.get(sub.apos_tipo) ?? [];
    list.push(sub);
    subtotaisPorTipo.set(sub.apos_tipo, list);
  }

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
    if (cats.length === 0) continue;

    // Exibe cabeçalho de grupo separado apenas quando há múltiplas raízes do mesmo tipo.
    // Com uma única raiz, a própria categoria serve de cabeçalho (evita duplicação de nome).
    if (cats.length > 1) {
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
    }

    for (const cat of cats) {
      rows.push(...renderLinhaCategoria(cat, meses, expandidos, onToggle, receitaBrutaTotal12, 0, cats.length === 1));
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

    // Subtotais configuráveis após este grupo de tipos
    const subs = (subtotaisPorTipo.get(tipo) ?? []).slice().sort((a, b) => a.ordem - b.ordem);
    for (const sub of subs) {
      rows.push(
        <LinhaCalculadaRow
          key={`subtotal-${sub.id}`}
          nome={sub.nome}
          valores={valoresCalculados[sub.formula] ?? []}
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
  ehCabecalho = false,
): JSX.Element[] {
  const temSubs = cat.subcategorias && cat.subcategorias.length > 0;
  const aberto = expandidos.has(cat.id);
  const pct = receitaBrutaTotal12 ? (cat.total12m / receitaBrutaTotal12) * 100 : 0;
  const indent = nivel === 0 ? (ehCabecalho ? 'pl-4' : 'pl-6') : nivel === 1 ? 'pl-10' : 'pl-14';
  const py = ehCabecalho ? 'py-2' : 'py-1.5';
  const negrito = ehCabecalho ? 'font-semibold text-gray-800' : 'text-gray-700';

  const rows: JSX.Element[] = [
    <tr key={cat.id} className="hover:bg-gray-50">
      <td className={`px-4 ${py} sticky left-0 bg-white z-10 hover:bg-gray-50 ${indent}`}>
        <div className="flex items-center gap-1">
          {temSubs ? (
            <button onClick={() => onToggle(cat.id)} className="text-gray-400 hover:text-gray-600 w-4 text-xs">
              {aberto ? '▼' : '▶'}
            </button>
          ) : <span className="w-4" />}
          <span className={negrito}>{cat.nome}</span>
        </div>
      </td>
      {meses.map((m) => {
        const v = valorDoMes(cat.valores, m.mes, m.ano);
        return (
          <td key={`${m.mes}-${m.ano}`} className={`px-3 ${py} text-right ${ehCabecalho ? 'font-semibold' : ''} ${corValor(v, cat.tipo === 'receita')}`}>
            {v !== 0 ? formatBRL(v) : <span className={ehCabecalho ? 'text-gray-300' : 'text-gray-200'}>—</span>}
          </td>
        );
      })}
      <td className={`px-3 ${py} text-right ${ehCabecalho ? 'font-semibold' : ''} ${corValor(cat.total12m, cat.tipo === 'receita')}`}>
        {cat.total12m !== 0 ? formatBRL(cat.total12m) : <span className={ehCabecalho ? 'text-gray-300' : 'text-gray-200'}>—</span>}
      </td>
      <td className={`px-3 ${py} text-right text-gray-400 text-xs`}>
        {pct !== 0 ? `${pct.toFixed(1)}%` : ''}
      </td>
    </tr>,
  ];

  if (temSubs && aberto) {
    for (const sub of cat.subcategorias) {
      rows.push(...renderLinhaCategoria(sub, meses, expandidos, onToggle, receitaBrutaTotal12, nivel + 1, false));
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

// ─── Painel de contas em atraso (informativo, fora do caixa) ──────────────────

function PainelAtrasados({ atrasados }: { atrasados: AtrasadosResumo | null | undefined }) {
  const [aberto, setAberto] = useState<'nenhum' | 'receber' | 'pagar'>('nenhum');
  if (!atrasados) return null;
  const { totalReceber, totalPagar, aReceber, aPagar } = atrasados;
  if (totalReceber === 0 && totalPagar === 0) return null;

  return (
    <div className="mb-4">
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setAberto(aberto === 'receber' ? 'nenhum' : 'receber')}
          className={`text-left rounded-lg border p-3 transition-colors ${aberto === 'receber' ? 'border-amber-400 bg-amber-100' : 'border-amber-200 bg-amber-50 hover:bg-amber-100'}`}
        >
          <div className="text-xs text-amber-700">A receber em atraso ({aReceber.length})</div>
          <div className="text-lg font-bold text-amber-800">{formatBRL(totalReceber)}</div>
        </button>
        <button
          onClick={() => setAberto(aberto === 'pagar' ? 'nenhum' : 'pagar')}
          className={`text-left rounded-lg border p-3 transition-colors ${aberto === 'pagar' ? 'border-red-400 bg-red-100' : 'border-red-200 bg-red-50 hover:bg-red-100'}`}
        >
          <div className="text-xs text-red-700">A pagar em atraso ({aPagar.length})</div>
          <div className="text-lg font-bold text-red-800">{formatBRL(totalPagar)}</div>
        </button>
      </div>
      {aberto !== 'nenhum' && <TabelaAtrasados itens={aberto === 'receber' ? aReceber : aPagar} />}
    </div>
  );
}

function TabelaAtrasados({ itens }: { itens: ItemAtraso[] }) {
  if (itens.length === 0) return <div className="mt-2 text-sm text-gray-400 text-center py-4 bg-white rounded-lg shadow">Nada em atraso.</div>;
  return (
    <div className="mt-2 bg-white rounded-lg shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-4 py-2 text-left">Descrição</th>
              <th className="px-4 py-2 text-left">Categoria</th>
              <th className="px-4 py-2 text-left w-24">Vencimento</th>
              <th className="px-4 py-2 text-right w-20">Atraso</th>
              <th className="px-4 py-2 text-right w-32">Em aberto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {itens.map((it, idx) => (
              <tr key={it.id || idx} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-800">{it.descricao || '(sem descrição)'}</td>
                <td className="px-4 py-2 text-gray-500">{it.categoria}</td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{formatData(it.dataVencimento)}</td>
                <td className="px-4 py-2 text-right text-gray-500 whitespace-nowrap">{it.diasAtraso}d</td>
                <td className="px-4 py-2 text-right font-medium text-gray-800 whitespace-nowrap">{formatBRL(it.valorAberto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Aba Extrato ──────────────────────────────────────────────────────────────

interface AbaExtratoProps {
  empresa: EmpresaDRE;
  extrato: ExtratoSalvo | null;
  meta: MetaExtrato | null;
  carregando: boolean; erro: string;
  modalAberto: boolean;
  de: string; ate: string;
  setDe: (v: string) => void; setAte: (v: string) => void;
  saldoInicial: string; setSaldoInicial: (v: string) => void;
  atualizando: boolean;
  processando: boolean;
  onAbrirModal: () => void;
  onFecharModal: () => void;
  onAtualizar: () => void;
  onAtualizarRecente: () => void;
  onReprocessar: () => void;
}

function AbaExtrato({
  empresa, extrato, meta, carregando, erro, modalAberto,
  de, ate, setDe, setAte, saldoInicial, setSaldoInicial, atualizando, processando, onAbrirModal, onFecharModal, onAtualizar, onAtualizarRecente, onReprocessar,
}: AbaExtratoProps) {
  return (
    <div>
      <div className="bg-white rounded-lg shadow p-4 mb-5 flex flex-wrap items-center gap-4">
        {empresa === 'consolidado' && (
          <div className="w-full text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Extrato salvo por empresa. Mostrando Ambiência (ASS).
          </div>
        )}
        <div className="flex-1 min-w-0 text-sm">
          {meta ? (
            <div className="text-gray-600">
              Período salvo: <strong>{formatData(meta.periodoDe)}</strong> a <strong>{formatData(meta.periodoAte)}</strong>
              <span className="text-gray-400"> · atualizado em {formatDataHora(meta.atualizadoEm)}</span>
              <div className="text-[11px] text-gray-400 mt-0.5">
                "Atualizar recente" refaz só os últimos 2 meses + o futuro (rápido, mantém o histórico) — também roda sozinho toda madrugada.
              </div>
            </div>
          ) : (
            <div className="text-gray-500">Nenhum extrato salvo ainda para esta empresa.</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {meta && (
            <button
              onClick={onReprocessar}
              disabled={atualizando}
              title="Refaz o extrato inteiro do zero, ignorando o cache de baixas"
              className="text-gray-500 px-3 py-2 rounded text-sm hover:text-gray-700 disabled:opacity-50"
            >
              Reprocessar tudo
            </button>
          )}
          <button
            onClick={onAbrirModal}
            disabled={atualizando}
            title="Define/estende o período completo do extrato (substitui tudo)"
            className={`px-4 py-2 rounded text-sm font-medium disabled:opacity-50 ${meta ? 'border border-slate-300 text-slate-700 hover:border-slate-500' : 'bg-slate-800 text-white hover:bg-slate-700'}`}
          >
            {meta ? 'Alterar período' : 'Atualizar extrato'}
          </button>
          {meta && (
            <button
              onClick={onAtualizarRecente}
              disabled={atualizando}
              title="Atualiza só os últimos 2 meses + o futuro (rápido; mantém o histórico)"
              className="bg-slate-800 text-white px-5 py-2 rounded text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
            >
              {atualizando ? 'Atualizando...' : 'Atualizar recente'}
            </button>
          )}
        </div>
      </div>

      {processando && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800 flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
          Processando o período completo no Conta Azul — pode levar alguns minutos. Pode aguardar aqui; se fechar, o processamento continua no servidor.
        </div>
      )}

      <PainelAtrasados atrasados={meta?.atrasados} />

      {erro && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{erro}</div>}

      {carregando && <div className="text-sm text-gray-400 py-8 text-center">Carregando extrato...</div>}

      {!carregando && !extrato && !erro && (
        <div className="text-sm text-gray-400 py-8 text-center">
          Nenhum extrato salvo. Clique em <strong>Atualizar extrato</strong> e selecione o período.
        </div>
      )}

      {!carregando && extrato && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-sm text-blue-600">Saldo Inicial (base Conta Azul em {formatData(extrato.periodoDe)})</div>
            <div className="text-xl font-bold text-blue-800">{formatBRL(extrato.saldoInicial)}</div>
          </div>

          <div className="text-xs text-gray-500">
            <strong>Até ontem:</strong> caixa realizado (data do pagamento). <strong className="text-blue-700">A partir de hoje:</strong>{' '}
            <span className="text-blue-700">previsto</span> pela data de vencimento das contas em aberto (linhas em azul). O saldo projeta o futuro.
          </div>

          {extrato.itens.length > 0 ? (
            <TabelaExtrato itens={extrato.itens} />
          ) : (
            <div className="text-sm text-gray-400 text-center py-6 bg-white rounded-lg shadow">
              Nenhum lançamento no período salvo.
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

      {/* Modal de seleção de período */}
      {modalAberto && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onFecharModal}>
          <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-1">Atualizar extrato</h3>
            <p className="text-sm text-gray-500 mb-4">
              O sistema busca todo o período no Conta Azul e substitui o extrato salvo. Essa tabela é a base da DRE.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Início</label>
                <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Fim</label>
                <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" />
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-xs text-gray-500 mb-1">Saldo inicial na data de início (R$)</label>
              <input
                type="number" step="0.01" value={saldoInicial}
                onChange={(e) => setSaldoInicial(e.target.value)}
                placeholder="0,00"
                className="w-full border rounded px-2 py-1.5 text-sm"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                O Conta Azul não fornece o saldo de uma data qualquer — informe o saldo bancário no dia de início. O extrato acumula a partir dele.
              </p>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={onFecharModal} disabled={atualizando} className="text-sm text-gray-500 px-3 py-2 hover:underline disabled:opacity-50">Cancelar</button>
              <button onClick={onAtualizar} disabled={atualizando} className="bg-slate-800 text-white text-sm px-5 py-2 rounded font-medium hover:bg-slate-700 disabled:opacity-50">
                {atualizando ? 'Buscando no Conta Azul...' : 'Atualizar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabelaExtrato({ itens }: { itens: ItemExtrato[] }) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-4 py-2 text-left w-20">Data</th>
              <th className="px-4 py-2 text-left">Descrição</th>
              <th className="px-4 py-2 text-left">Categoria</th>
              <th className="px-4 py-2 text-right">Receita</th>
              <th className="px-4 py-2 text-right">Despesa</th>
              <th className="px-4 py-2 text-right">Saldo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {itens.map((item, idx) => {
              const ehReceita = item.tipo === 'receita';
              const ehDespesa = item.tipo === 'despesa';
              const prev = item.previsto;
              return (
                <tr key={item.id || idx} className={prev ? 'bg-blue-50/40 hover:bg-blue-50 italic' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-2 text-gray-400 whitespace-nowrap">
                    {item.data ? new Date(item.data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—'}
                  </td>
                  <td className={`px-4 py-2 ${prev ? 'text-gray-500' : 'text-gray-800'}`}>
                    {item.descricao || '(sem descrição)'}
                    {item.tipo === 'transferencia' && <span className="ml-1 text-xs text-gray-400">(transferência)</span>}
                    {prev && <span className="ml-1 text-[10px] uppercase tracking-wide text-blue-600 bg-blue-100 rounded px-1 py-0.5 not-italic">previsto</span>}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{item.categoria}</td>
                  <td className={`px-4 py-2 text-right font-medium ${prev ? 'text-green-600/70' : 'text-green-700'}`}>
                    {ehReceita ? formatBRL(Math.abs(item.valor)) : ''}
                  </td>
                  <td className={`px-4 py-2 text-right font-medium ${prev ? 'text-red-500/70' : 'text-red-600'}`}>
                    {ehDespesa ? formatBRL(Math.abs(item.valor)) : ''}
                  </td>
                  <td className={`px-4 py-2 text-right whitespace-nowrap ${prev ? 'text-gray-500' : 'text-gray-700'}`}>
                    {item.saldo !== undefined ? formatBRL(item.saldo) : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Aba Configurações ────────────────────────────────────────────────────────

type CatPatch = Partial<{ nome: string; pai_id: string | null; tipo: TipoCategoria; sinal: number; ordem: number }>;

const FORMULA_LABEL: Record<FormulaSubtotal, string> = {
  receita_liquida: 'Receita Líquida',
  resultado_operacional: 'Resultado Operacional',
  resultado_liquido: 'Resultado Líquido',
  fluxo_caixa_livre: 'Fluxo de Caixa Livre',
};

interface AbaConfiguracoesProps {
  empresa: EmpresaDRE;
  categorias: DreCategoria[];
  mapeamentos: DreMapeamento[];
  catsCA: CategoriaCA[];
  carregando: boolean;
  carregandoCatsCA: boolean;
  erro: string;
  erroCatsCA: string;
  subtotais: DreSubtotal[];
  onRemover: (id: string) => void;
  onAdicionarMapeamento: (nomeCA: string, categoriaId: string) => Promise<void>;
  onCriarCategoria: (dados: { nome: string; pai_id: string | null; tipo: TipoCategoria; sinal: number }) => Promise<void>;
  onEditarCategoria: (id: string, patch: CatPatch) => Promise<void>;
  onExcluirCategoria: (id: string) => Promise<void>;
  onCriarSubtotal: (dados: { nome: string; formula: FormulaSubtotal; apos_tipo: TipoCategoria }) => Promise<void>;
  onExcluirSubtotal: (id: string) => Promise<void>;
  onSalvarTudoEstrutura: (catChanges: Map<string, CatPatch>, subChanges: Map<string, SubtotalPatch>) => Promise<void>;
}

// Reconstrói a árvore (pai_id) a partir da lista plana retornada pela API, ordenando por `ordem`.
function construirArvoreCategorias(flat: DreCategoria[]): DreCategoria[] {
  const mapa = new Map<string, DreCategoria>();
  for (const c of flat) mapa.set(c.id, { ...c, subcategorias: [] });

  const raizes: DreCategoria[] = [];
  for (const c of flat) {
    const node = mapa.get(c.id)!;
    const pai = c.pai_id ? mapa.get(c.pai_id) : undefined;
    if (pai) pai.subcategorias!.push(node);
    else raizes.push(node);
  }

  function ordenar(nodes: DreCategoria[]) {
    nodes.sort((a, b) => a.ordem - b.ordem);
    for (const n of nodes) if (n.subcategorias?.length) ordenar(n.subcategorias);
  }
  ordenar(raizes);
  return raizes;
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
  empresa, categorias, mapeamentos, catsCA, carregando, carregandoCatsCA, erro, erroCatsCA,
  subtotais, onRemover, onAdicionarMapeamento,
  onCriarCategoria, onExcluirCategoria, onCriarSubtotal, onExcluirSubtotal, onSalvarTudoEstrutura,
}: AbaConfiguracoesProps) {
  const [localCats, setLocalCats] = useState<DreCategoria[]>(categorias);
  const [pendingEdits, setPendingEdits] = useState<Map<string, CatPatch>>(new Map());
  const [localSubtotais, setLocalSubtotais] = useState<DreSubtotal[]>(subtotais);
  const [pendingSubtotalEdits, setPendingSubtotalEdits] = useState<Map<string, SubtotalPatch>>(new Map());
  const [salvandoEstrutura, setSalvandoEstrutura] = useState(false);

  useEffect(() => {
    setLocalCats(categorias);
    setPendingEdits(new Map());
  }, [categorias]);

  useEffect(() => {
    setLocalSubtotais(subtotais);
    setPendingSubtotalEdits(new Map());
  }, [subtotais]);

  const arvoreCategorias = construirArvoreCategorias(localCats);
  const catsPlanas = acharCategorias(arvoreCategorias);
  const nomesMapeados = new Set(mapeamentos.map((m) => m.nome_ca));
  const catsCAnaoMapeadas = catsCA.filter((c) => !nomesMapeados.has(c.nome));

  function handleEditarLocal(id: string, patch: CatPatch) {
    setLocalCats((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setPendingEdits((prev) => {
      const next = new Map(prev);
      next.set(id, { ...(next.get(id) ?? {}), ...patch });
      return next;
    });
  }

  function handleEditarSubtotalLocal(id: string, patch: SubtotalPatch) {
    setLocalSubtotais((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    setPendingSubtotalEdits((prev) => {
      const next = new Map(prev);
      next.set(id, { ...(next.get(id) ?? {}), ...patch });
      return next;
    });
  }

  const pendingCount = pendingEdits.size + pendingSubtotalEdits.size;

  async function salvarEstrutura() {
    setSalvandoEstrutura(true);
    try {
      await onSalvarTudoEstrutura(pendingEdits, pendingSubtotalEdits);
    } catch {
      // erro exibido pelo pai
    } finally {
      setSalvandoEstrutura(false);
    }
  }

  function descartarAlteracoes() {
    setLocalCats(categorias);
    setPendingEdits(new Map());
    setLocalSubtotais(subtotais);
    setPendingSubtotalEdits(new Map());
  }

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

      {/* Estrutura da DRE + Mapeamentos CA (unificado) */}
      <EstruturaDRE
        arvore={arvoreCategorias}
        mapeamentos={mapeamentos}
        catsCA={catsCA}
        carregandoCatsCA={carregandoCatsCA}
        erroCatsCA={erroCatsCA}
        catsCAnaoMapeadas={catsCAnaoMapeadas}
        catsPlanas={catsPlanas}
        pendingCount={pendingCount}
        salvando={salvandoEstrutura}
        onSalvar={salvarEstrutura}
        onDescartar={descartarAlteracoes}
        onCriar={onCriarCategoria}
        onEditar={handleEditarLocal}
        onExcluir={onExcluirCategoria}
        onAdicionarMapeamento={onAdicionarMapeamento}
        onRemoverMapeamento={onRemover}
        subtotais={localSubtotais}
        onEditarSubtotal={handleEditarSubtotalLocal}
        onCriarSubtotal={onCriarSubtotal}
        onExcluirSubtotal={onExcluirSubtotal}
      />

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
          type DiagResp = { status: number; corpo: unknown };
          const rec = diag.receitas as DiagResp;
          const desp = diag.despesas as DiagResp;

          function info(corpo: unknown): { quantidade: number; primeiro: Record<string, unknown> | null } {
            if (corpo && typeof corpo === 'object') {
              const d = corpo as Record<string, unknown>;
              if (Array.isArray(d.itens)) {
                const arr = d.itens as Record<string, unknown>[];
                return { quantidade: arr.length, primeiro: arr[0] ?? null };
              }
            }
            return { quantidade: 0, primeiro: null };
          }

          function renderLinha(label: string, v: DiagResp) {
            const { quantidade, primeiro } = info(v.corpo);
            const ok = v.status === 200 && quantidade > 0;
            const semPerm = v.status === 403;
            const semDados = v.status === 404 || (v.status === 200 && quantidade === 0);
            const cor = ok ? 'bg-green-50 border-green-200' : semPerm ? 'bg-orange-50 border-orange-200' : semDados ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200';
            const icone = ok ? '✅' : semPerm ? '🔒' : semDados ? '⚠️' : '❌';
            return (
              <div className={`flex items-start gap-3 p-3 rounded border ${cor}`}>
                <span className="text-lg mt-0.5">{icone}</span>
                <div className="min-w-0">
                  <div className="font-medium">
                    {label} — {ok ? `${quantidade} item(s) encontrado(s)` : semPerm ? 'Permissão negada (403) — reconecte o CA' : semDados ? 'Sem lançamentos neste período' : `Erro HTTP ${v.status}`}
                  </div>
                  {semDados && v.status === 404 && (
                    <div className="text-xs text-yellow-700 mt-0.5">Tente um mês que tenha lançamentos cadastrados no CA.</div>
                  )}
                  {ok && primeiro && (
                    <div className="text-xs text-gray-600 mt-1 font-mono break-all">
                      Campos: {Object.keys(primeiro).join(' · ')}
                    </div>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div className="space-y-2 text-sm">
              {renderLinha('Receitas', rec)}
              {renderLinha('Despesas', desp)}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─── Estrutura da DRE + Mapeamentos CA (unificado) ────────────────────────────

const TIPO_LABEL: Record<TipoCategoria, string> = {
  receita: 'Receita', deducao: 'Dedução', custo: 'Custo', despesa: 'Despesa', financeiro: 'Financeiro', divisao: 'Divisão',
};
const TIPO_COR: Record<TipoCategoria, string> = {
  receita: 'bg-green-100 text-green-700', deducao: 'bg-orange-100 text-orange-700', custo: 'bg-purple-100 text-purple-700',
  despesa: 'bg-red-100 text-red-700', financeiro: 'bg-blue-100 text-blue-700', divisao: 'bg-gray-200 text-gray-700',
};
const SINAL_PADRAO: Record<TipoCategoria, number> = {
  receita: 1, deducao: -1, custo: -1, despesa: -1, financeiro: 1, divisao: -1,
};
const ORDEM_TIPOS: TipoCategoria[] = ['receita', 'deducao', 'custo', 'despesa', 'financeiro', 'divisao'];

/** ids da própria categoria + todos os descendentes — evita criar ciclo ao mudar de pai. */
function coletarIds(node: DreCategoria): Set<string> {
  const ids = new Set<string>([node.id]);
  function rec(n: DreCategoria) {
    for (const s of n.subcategorias ?? []) { ids.add(s.id); rec(s); }
  }
  rec(node);
  return ids;
}

interface EstruturaDREProps {
  arvore: DreCategoria[];
  mapeamentos: DreMapeamento[];
  catsCA: CategoriaCA[];
  carregandoCatsCA: boolean;
  erroCatsCA: string;
  catsCAnaoMapeadas: CategoriaCA[];
  catsPlanas: Array<{ id: string; label: string; nivel: number }>;
  pendingCount: number;
  salvando: boolean;
  onSalvar: () => void;
  onDescartar: () => void;
  onCriar: (dados: { nome: string; pai_id: string | null; tipo: TipoCategoria; sinal: number }) => Promise<void>;
  onEditar: (id: string, patch: CatPatch) => void;
  onExcluir: (id: string) => Promise<void>;
  onAdicionarMapeamento: (nomeCA: string, categoriaId: string) => Promise<void>;
  onRemoverMapeamento: (id: string) => void;
  subtotais: DreSubtotal[];
  onEditarSubtotal: (id: string, patch: SubtotalPatch) => void;
  onCriarSubtotal: (dados: { nome: string; formula: FormulaSubtotal; apos_tipo: TipoCategoria }) => Promise<void>;
  onExcluirSubtotal: (id: string) => Promise<void>;
}

function EstruturaDRE({
  arvore, mapeamentos, catsCA, carregandoCatsCA, erroCatsCA, catsCAnaoMapeadas, catsPlanas,
  pendingCount, salvando, onSalvar, onDescartar,
  onCriar, onEditar, onExcluir, onAdicionarMapeamento, onRemoverMapeamento,
  subtotais, onEditarSubtotal, onCriarSubtotal, onExcluirSubtotal,
}: EstruturaDREProps) {
  const [formAberto, setFormAberto] = useState<string | null>(null);
  const [formSubtotalAberto, setFormSubtotalAberto] = useState(false);
  const [erro, setErro] = useState('');

  const opcoesPai = acharCategorias(arvore);

  function mover(node: DreCategoria, irmaos: DreCategoria[], direcao: -1 | 1) {
    const idx = irmaos.findIndex((s) => s.id === node.id);
    const outro = irmaos[idx + direcao];
    if (!outro) return;
    const ordemNode = node.ordem;
    const ordemOutro = outro.ordem;
    onEditar(node.id, { ordem: ordemOutro });
    onEditar(outro.id, { ordem: ordemNode });
  }

  async function excluir(node: DreCategoria) {
    if ((node.subcategorias?.length ?? 0) > 0) {
      setErro('Mova ou exclua as subcategorias antes de excluir esta categoria.');
      return;
    }
    if (!window.confirm(`Excluir a categoria "${node.nome}"?`)) return;
    setErro('');
    try {
      await onExcluir(node.id);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  // Agrupa raízes por tipo para exibir cabeçalhos de seção (como na aba DRE)
  const raizesPorTipo = new Map<TipoCategoria, DreCategoria[]>();
  for (const t of ORDEM_TIPOS) raizesPorTipo.set(t, []);
  for (const n of arvore) raizesPorTipo.get(n.tipo)?.push(n);

  return (
    <div className="bg-white rounded-lg shadow p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold">Estrutura da DRE + Mapeamentos CA</h2>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {pendingCount > 0 && (
            <>
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                {pendingCount} alteração{pendingCount !== 1 ? 'ões' : ''} não salva{pendingCount !== 1 ? 's' : ''}
              </span>
              <button
                onClick={onDescartar}
                disabled={salvando}
                className="text-xs text-gray-500 hover:text-gray-700 border border-gray-300 px-3 py-1 rounded"
              >
                Descartar
              </button>
              <button
                onClick={onSalvar}
                disabled={salvando}
                className="text-xs bg-slate-800 text-white px-3 py-1 rounded disabled:opacity-50 hover:bg-slate-700"
              >
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Clique no nome para editar, setas para reordenar, ▶ para recolher. Clique em "Salvar" para confirmar edições.
      </p>

      {erro && <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">{erro}</div>}

      {carregandoCatsCA && (
        <div className="mb-3 p-2.5 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700 animate-pulse">
          Carregando categorias do Conta Azul (12 meses)…
        </div>
      )}
      {!carregandoCatsCA && erroCatsCA && (
        <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          Não foi possível carregar as categorias do Conta Azul: {erroCatsCA}
        </div>
      )}
      {!carregandoCatsCA && !erroCatsCA && catsCA.length === 0 && (
        <div className="mb-3 p-2.5 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-700">
          Nenhuma categoria do CA encontrada nos últimos 12 meses. Verifique a conexão na aba Integrações.
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        {ORDEM_TIPOS.map((tipo) => {
          const roots = raizesPorTipo.get(tipo) ?? [];
          const formKey = `__raiz_${tipo}__`;
          return (
            <div key={tipo} className="border-b last:border-b-0">
              {/* Cabeçalho da seção de tipo */}
              <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-100">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {LABEL_TIPO[tipo]}
                </span>
                <button
                  onClick={() => setFormAberto(formAberto === formKey ? null : formKey)}
                  className="text-xs text-slate-600 hover:underline"
                >
                  + Categoria
                </button>
              </div>
              {formAberto === formKey && (
                <FormNovaCategoria
                  paiId={null}
                  tipoDefault={tipo}
                  sinalDefault={SINAL_PADRAO[tipo]}
                  onCriar={onCriar}
                  onFechar={() => setFormAberto(null)}
                />
              )}
              <div className="divide-y divide-gray-100">
                {roots.length === 0 && formAberto !== formKey && (
                  <div className="text-xs text-gray-400 text-center py-2 italic px-3">Nenhuma categoria</div>
                )}
                {roots.map((node) => (
                  <NodoCategoria
                    key={node.id}
                    node={node}
                    nivel={0}
                    irmaos={roots}
                    opcoesPai={opcoesPai}
                    formAberto={formAberto}
                    setFormAberto={setFormAberto}
                    onMover={mover}
                    onEditar={onEditar}
                    onExcluir={excluir}
                    onCriar={onCriar}
                    mapeamentos={mapeamentos}
                    catsCA={catsCA}
                    carregandoCatsCA={carregandoCatsCA}
                    onAdicionarMapeamento={onAdicionarMapeamento}
                    onRemoverMapeamento={onRemoverMapeamento}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Subtotais configuráveis ──────────────────────────────────────── */}
      <div className="mt-5 pt-4 border-t">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Linhas de Subtotal</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Linhas calculadas (ex: = Resultado Operacional) que aparecem após cada grupo de categorias. Editáveis e reposicionáveis.
            </p>
          </div>
          <button
            onClick={() => setFormSubtotalAberto(!formSubtotalAberto)}
            className="text-xs text-slate-700 hover:underline border border-slate-300 px-3 py-1 rounded shrink-0"
          >
            + Subtotal
          </button>
        </div>
        {formSubtotalAberto && (
          <FormNovaSubtotal onCriar={onCriarSubtotal} onFechar={() => setFormSubtotalAberto(false)} />
        )}
        <div className="border rounded-lg divide-y divide-gray-100 mt-2">
          {subtotais.length === 0 && (
            <div className="text-sm text-gray-400 text-center py-4">Nenhum subtotal cadastrado.</div>
          )}
          {subtotais.map((sub) => {
            const irmaos = subtotais.filter((s) => s.apos_tipo === sub.apos_tipo).sort((a, b) => a.ordem - b.ordem);
            return (
              <NodoSubtotal
                key={sub.id}
                sub={sub}
                irmaos={irmaos}
                onEditar={onEditarSubtotal}
                onExcluir={onExcluirSubtotal}
              />
            );
          })}
        </div>
      </div>

      {/* Categorias CA sem mapeamento */}
      {(catsCAnaoMapeadas.length > 0 || carregandoCatsCA) && (
        <div className="mt-5 pt-4 border-t">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">
            Categorias CA sem mapeamento
            {catsCAnaoMapeadas.length > 0 && (
              <span className="ml-2 font-normal text-yellow-600">({catsCAnaoMapeadas.length})</span>
            )}
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            Categorias do Conta Azul ainda não associadas a nenhuma linha da DRE.
          </p>
          {carregandoCatsCA && (
            <div className="text-xs text-gray-400 animate-pulse">Buscando categorias do Conta Azul...</div>
          )}
          {!carregandoCatsCA && (
            <div className="space-y-1.5">
              {catsCAnaoMapeadas.map((cat) => (
                <NaoMapeadaItem
                  key={cat.nome}
                  cat={cat}
                  catsPlanas={catsPlanas}
                  onMapear={onAdicionarMapeamento}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Nodo da árvore de categorias ─────────────────────────────────────────────

interface NodoCategoriaProps {
  node: DreCategoria;
  nivel: number;
  irmaos: DreCategoria[];
  opcoesPai: Array<{ id: string; label: string; nivel: number }>;
  formAberto: string | null;
  setFormAberto: (id: string | null) => void;
  onMover: (node: DreCategoria, irmaos: DreCategoria[], direcao: -1 | 1) => void;
  onEditar: (id: string, patch: CatPatch) => void;
  onExcluir: (node: DreCategoria) => void;
  onCriar: (dados: { nome: string; pai_id: string | null; tipo: TipoCategoria; sinal: number }) => Promise<void>;
  mapeamentos: DreMapeamento[];
  catsCA: CategoriaCA[];
  carregandoCatsCA: boolean;
  onAdicionarMapeamento: (nomeCA: string, categoriaId: string) => Promise<void>;
  onRemoverMapeamento: (id: string) => void;
}

function NodoCategoria({
  node, nivel, irmaos, opcoesPai, formAberto, setFormAberto, onMover, onEditar, onExcluir, onCriar,
  mapeamentos, catsCA, carregandoCatsCA, onAdicionarMapeamento, onRemoverMapeamento,
}: NodoCategoriaProps) {
  const [editando, setEditando] = useState(false);
  const [nomeEdit, setNomeEdit] = useState(node.nome);
  const [mapeandoCA, setMapeandoCA] = useState(false);
  const [novaMapeamentoCA, setNovaMapeamentoCA] = useState('');
  const [salvandoMap, setSalvandoMap] = useState(false);
  const [aberto, setAberto] = useState(true);

  const temSubs = (node.subcategorias?.length ?? 0) > 0;
  const idx = irmaos.findIndex((s) => s.id === node.id);
  const ehPrimeiro = idx === 0;
  const ehUltimo = idx === irmaos.length - 1;
  const idsExcluidos = coletarIds(node);

  const mapeamentosDoNode = mapeamentos.filter((m) => m.categoria_id === node.id);
  const catsCAlivres = catsCA.filter((c) => !mapeamentosDoNode.some((m) => m.nome_ca === c.nome));

  useEffect(() => { setNomeEdit(node.nome); }, [node.nome]);

  function salvarNome() {
    setEditando(false);
    const nomeLimpo = nomeEdit.trim();
    if (!nomeLimpo || nomeLimpo === node.nome) { setNomeEdit(node.nome); return; }
    onEditar(node.id, { nome: nomeLimpo });
  }

  async function adicionarMapeamento() {
    if (!novaMapeamentoCA) return;
    setSalvandoMap(true);
    try {
      await onAdicionarMapeamento(novaMapeamentoCA, node.id);
      setNovaMapeamentoCA('');
      setMapeandoCA(false);
    } finally {
      setSalvandoMap(false);
    }
  }

  return (
    <div>
      {/* Linha principal com chips CA inline */}
      <div
        className="flex items-center flex-wrap gap-1.5 py-1.5 px-2 hover:bg-gray-50"
        style={{ paddingLeft: 8 + nivel * 20 }}
      >
        {/* Setas de ordem */}
        <div className="flex flex-col shrink-0">
          <button onClick={() => onMover(node, irmaos, -1)} disabled={ehPrimeiro} className="text-gray-400 hover:text-gray-700 disabled:opacity-20 leading-none text-[10px]">▲</button>
          <button onClick={() => onMover(node, irmaos, 1)} disabled={ehUltimo} className="text-gray-400 hover:text-gray-700 disabled:opacity-20 leading-none text-[10px]">▼</button>
        </div>

        {/* Botão recolher */}
        {temSubs ? (
          <button
            onClick={() => setAberto(!aberto)}
            className="w-4 text-gray-400 hover:text-gray-700 text-xs shrink-0 leading-none"
          >
            {aberto ? '▼' : '▶'}
          </button>
        ) : <span className="w-4 shrink-0" />}

        {/* Nome */}
        {editando ? (
          <input
            value={nomeEdit}
            onChange={(e) => setNomeEdit(e.target.value)}
            onBlur={salvarNome}
            onKeyDown={(e) => { if (e.key === 'Enter') salvarNome(); if (e.key === 'Escape') { setNomeEdit(node.nome); setEditando(false); } }}
            autoFocus
            className="min-w-[120px] border rounded px-2 py-0.5 text-sm"
          />
        ) : (
          <span
            onClick={() => setEditando(true)}
            title="Clique para editar"
            className="cursor-text hover:bg-gray-100 px-1.5 py-0.5 rounded text-sm text-gray-800"
          >
            {node.nome}
          </span>
        )}

        {/* Chips CA inline */}
        {mapeamentosDoNode.map((m) => {
          const catCA = catsCA.find((c) => c.nome === m.nome_ca);
          return (
            <span key={m.id} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-full text-slate-700 shrink-0">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${catCA?.tipo === 'receita' ? 'bg-green-500' : 'bg-red-500'}`} />
              {m.nome_ca}
              <button onClick={() => onRemoverMapeamento(m.id)} className="ml-0.5 text-slate-400 hover:text-red-500 leading-none">×</button>
            </span>
          );
        })}

        {/* Botão / formulário de mapeamento CA */}
        {mapeandoCA ? (
          <div className="flex items-center gap-1 shrink-0">
            <select
              value={novaMapeamentoCA}
              onChange={(e) => setNovaMapeamentoCA(e.target.value)}
              disabled={carregandoCatsCA || catsCAlivres.length === 0}
              className="text-xs border rounded px-1.5 py-1 max-w-[200px] disabled:bg-gray-50 disabled:text-gray-400"
            >
              <option value="">
                {carregandoCatsCA ? 'Carregando…' : catsCAlivres.length === 0 ? 'Nenhuma disponível' : 'Cat. CA…'}
              </option>
              {catsCAlivres.map((c) => (
                <option key={c.nome} value={c.nome}>{c.nome} ({c.tipo}, {c.count}×)</option>
              ))}
            </select>
            <button
              onClick={adicionarMapeamento}
              disabled={!novaMapeamentoCA || salvandoMap}
              className="text-xs bg-slate-700 text-white px-2 py-1 rounded disabled:opacity-50 hover:bg-slate-600"
            >
              {salvandoMap ? '…' : 'OK'}
            </button>
            <button onClick={() => { setMapeandoCA(false); setNovaMapeamentoCA(''); }} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
          </div>
        ) : (
          <button
            onClick={() => setMapeandoCA(true)}
            className="text-xs text-gray-400 hover:text-slate-600 px-1.5 py-0.5 rounded border border-dashed border-gray-300 hover:border-slate-400 shrink-0"
          >
            +CA
          </button>
        )}

        {/* Espaçador flexível */}
        <span className="flex-1 min-w-0" />

        {/* Controles estruturais */}
        <select
          value={node.tipo}
          onChange={(e) => onEditar(node.id, { tipo: e.target.value as TipoCategoria })}
          className={`text-xs rounded px-1.5 py-1 border-none shrink-0 ${TIPO_COR[node.tipo]}`}
        >
          {(Object.keys(TIPO_LABEL) as TipoCategoria[]).map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
        </select>

        <select
          value={node.sinal}
          onChange={(e) => onEditar(node.id, { sinal: Number(e.target.value) })}
          className="text-xs border rounded px-1.5 py-1 shrink-0 w-10"
        >
          <option value={1}>+</option>
          <option value={-1}>−</option>
        </select>

        <select
          value={node.pai_id ?? ''}
          onChange={(e) => onEditar(node.id, { pai_id: e.target.value || null })}
          className="text-xs border rounded px-1.5 py-1 shrink-0 max-w-[150px]"
          title="Mudar nível (categoria pai)"
        >
          <option value="">— Raiz —</option>
          {opcoesPai.filter((o) => !idsExcluidos.has(o.id)).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>

        <button onClick={() => setFormAberto(formAberto === node.id ? null : node.id)} className="text-xs text-slate-600 hover:underline shrink-0">+Sub</button>
        <button onClick={() => onExcluir(node)} className="text-xs text-red-400 hover:text-red-600 shrink-0">×</button>
      </div>

      {aberto && formAberto === node.id && (
        <div style={{ paddingLeft: 8 + (nivel + 1) * 20 }}>
          <FormNovaCategoria paiId={node.id} tipoDefault={node.tipo} sinalDefault={node.sinal} onCriar={onCriar} onFechar={() => setFormAberto(null)} />
        </div>
      )}

      {aberto && (node.subcategorias ?? []).map((sub) => (
        <NodoCategoria
          key={sub.id} node={sub} nivel={nivel + 1} irmaos={node.subcategorias!}
          opcoesPai={opcoesPai} formAberto={formAberto} setFormAberto={setFormAberto}
          onMover={onMover} onEditar={onEditar} onExcluir={onExcluir} onCriar={onCriar}
          mapeamentos={mapeamentos} catsCA={catsCA} carregandoCatsCA={carregandoCatsCA}
          onAdicionarMapeamento={onAdicionarMapeamento} onRemoverMapeamento={onRemoverMapeamento}
        />
      ))}
    </div>
  );
}

// ─── Item de categoria CA não mapeada ─────────────────────────────────────────

function NaoMapeadaItem({
  cat, catsPlanas, onMapear,
}: {
  cat: CategoriaCA;
  catsPlanas: Array<{ id: string; label: string; nivel: number }>;
  onMapear: (nomeCA: string, categoriaId: string) => Promise<void>;
}) {
  const [mapeando, setMapeando] = useState(false);
  const [categoriaId, setCategoriaId] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!categoriaId) return;
    setSalvando(true);
    try { await onMapear(cat.nome, categoriaId); setMapeando(false); }
    finally { setSalvando(false); }
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 py-1.5 px-3 rounded text-sm border ${mapeando ? 'bg-slate-50 border-slate-300' : 'bg-yellow-50 border-yellow-200'}`}>
      <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${cat.tipo === 'receita' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
        {cat.tipo}
      </span>
      <span className="text-yellow-800 flex-1 font-medium">{cat.nome}</span>
      <span className="text-xs text-yellow-600 shrink-0">{cat.count}× · {formatBRLK(cat.total)}</span>
      {mapeando ? (
        <>
          <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className="text-xs border rounded px-2 py-1 flex-1 min-w-[180px]">
            <option value="">Categoria DRE...</option>
            {catsPlanas.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <button onClick={salvar} disabled={!categoriaId || salvando} className="text-xs bg-slate-700 text-white px-3 py-1 rounded disabled:opacity-50 shrink-0">
            {salvando ? '...' : 'Salvar'}
          </button>
          <button onClick={() => { setMapeando(false); setCategoriaId(''); }} className="text-xs text-gray-400 hover:text-gray-600 shrink-0">✕</button>
        </>
      ) : (
        <button onClick={() => setMapeando(true)} className="text-xs text-yellow-700 hover:text-yellow-900 border border-yellow-400 px-3 py-1 rounded hover:bg-yellow-100 shrink-0">
          Mapear →
        </button>
      )}
    </div>
  );
}

// ─── Nodo de subtotal ─────────────────────────────────────────────────────────

interface NodoSubtotalProps {
  sub: DreSubtotal;
  irmaos: DreSubtotal[];
  onEditar: (id: string, patch: SubtotalPatch) => void;
  onExcluir: (id: string) => Promise<void>;
}

function NodoSubtotal({ sub, irmaos, onEditar, onExcluir }: NodoSubtotalProps) {
  const [editando, setEditando] = useState(false);
  const [nomeEdit, setNomeEdit] = useState(sub.nome);

  useEffect(() => { setNomeEdit(sub.nome); }, [sub.nome]);

  const idx = irmaos.findIndex((s) => s.id === sub.id);
  const ehPrimeiro = idx === 0;
  const ehUltimo = idx === irmaos.length - 1;

  function mover(direcao: -1 | 1) {
    const outro = irmaos[idx + direcao];
    if (!outro) return;
    onEditar(sub.id, { ordem: outro.ordem });
    onEditar(outro.id, { ordem: sub.ordem });
  }

  function salvarNome() {
    setEditando(false);
    const nomeLimpo = nomeEdit.trim();
    if (!nomeLimpo || nomeLimpo === sub.nome) { setNomeEdit(sub.nome); return; }
    onEditar(sub.id, { nome: nomeLimpo });
  }

  async function excluir() {
    if (!window.confirm(`Excluir o subtotal "${sub.nome}"?`)) return;
    await onExcluir(sub.id);
  }

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50">
      <div className="flex flex-col shrink-0">
        <button onClick={() => mover(-1)} disabled={ehPrimeiro} className="text-gray-400 hover:text-gray-700 disabled:opacity-20 leading-none text-[10px]">▲</button>
        <button onClick={() => mover(1)} disabled={ehUltimo} className="text-gray-400 hover:text-gray-700 disabled:opacity-20 leading-none text-[10px]">▼</button>
      </div>

      {editando ? (
        <input
          value={nomeEdit}
          onChange={(e) => setNomeEdit(e.target.value)}
          onBlur={salvarNome}
          onKeyDown={(e) => { if (e.key === 'Enter') salvarNome(); if (e.key === 'Escape') { setNomeEdit(sub.nome); setEditando(false); } }}
          autoFocus
          className="flex-1 min-w-[120px] border rounded px-2 py-1 text-sm font-bold"
        />
      ) : (
        <span onClick={() => setEditando(true)} title="Clique para editar" className="flex-1 min-w-[120px] cursor-text hover:bg-gray-100 px-1.5 py-0.5 rounded text-sm font-bold text-gray-800">
          {sub.nome}
        </span>
      )}

      <select
        value={sub.formula}
        onChange={(e) => onEditar(sub.id, { formula: e.target.value as FormulaSubtotal })}
        className="text-xs border rounded px-1.5 py-1 shrink-0 bg-indigo-50 text-indigo-700"
      >
        {(Object.keys(FORMULA_LABEL) as FormulaSubtotal[]).map((f) => (
          <option key={f} value={f}>{FORMULA_LABEL[f]}</option>
        ))}
      </select>

      <span className="text-xs text-gray-400 shrink-0">após</span>

      <select
        value={sub.apos_tipo}
        onChange={(e) => onEditar(sub.id, { apos_tipo: e.target.value as TipoCategoria })}
        className="text-xs border rounded px-1.5 py-1 shrink-0"
      >
        {(Object.keys(TIPO_LABEL) as TipoCategoria[]).map((t) => (
          <option key={t} value={t}>{TIPO_LABEL[t]}</option>
        ))}
      </select>

      <button onClick={excluir} className="text-xs text-red-400 hover:text-red-600 shrink-0">Excluir</button>
    </div>
  );
}

// ─── Formulário novo subtotal ─────────────────────────────────────────────────

function FormNovaSubtotal({
  onCriar, onFechar,
}: {
  onCriar: (dados: { nome: string; formula: FormulaSubtotal; apos_tipo: TipoCategoria }) => Promise<void>;
  onFechar: () => void;
}) {
  const [nome, setNome] = useState('');
  const [formula, setFormula] = useState<FormulaSubtotal>('resultado_operacional');
  const [aposTipo, setAposTipo] = useState<TipoCategoria>('despesa');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!nome.trim()) return;
    setSalvando(true);
    try {
      await onCriar({ nome: nome.trim(), formula, apos_tipo: aposTipo });
      onFechar();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-2 px-2 bg-slate-50 border-y border-slate-200 mt-1">
      <input value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && salvar()} placeholder="Ex: = Resultado Operacional" autoFocus className="flex-1 min-w-[180px] border rounded px-2 py-1 text-sm" />
      <select value={formula} onChange={(e) => setFormula(e.target.value as FormulaSubtotal)} className="text-xs border rounded px-1.5 py-1">
        {(Object.keys(FORMULA_LABEL) as FormulaSubtotal[]).map((f) => (
          <option key={f} value={f}>{FORMULA_LABEL[f]}</option>
        ))}
      </select>
      <span className="text-xs text-gray-500">após</span>
      <select value={aposTipo} onChange={(e) => setAposTipo(e.target.value as TipoCategoria)} className="text-xs border rounded px-1.5 py-1">
        {(Object.keys(TIPO_LABEL) as TipoCategoria[]).map((t) => (
          <option key={t} value={t}>{TIPO_LABEL[t]}</option>
        ))}
      </select>
      <button onClick={salvar} disabled={salvando || !nome.trim()} className="bg-slate-800 text-white px-3 py-1 rounded text-xs font-medium disabled:opacity-50 hover:bg-slate-700">
        {salvando ? 'Salvando...' : 'Adicionar'}
      </button>
      <button onClick={onFechar} className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
    </div>
  );
}

// ─── Formulário nova categoria ────────────────────────────────────────────────

interface FormNovaCategoriaProps {
  paiId: string | null;
  tipoDefault: TipoCategoria;
  sinalDefault: number;
  onCriar: (dados: { nome: string; pai_id: string | null; tipo: TipoCategoria; sinal: number }) => Promise<void>;
  onFechar: () => void;
}

function FormNovaCategoria({ paiId, tipoDefault, sinalDefault, onCriar, onFechar }: FormNovaCategoriaProps) {
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<TipoCategoria>(tipoDefault);
  const [sinal, setSinal] = useState(sinalDefault);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!nome.trim()) return;
    setSalvando(true);
    try {
      await onCriar({ nome: nome.trim(), pai_id: paiId, tipo, sinal });
      onFechar();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-2 px-2 bg-slate-50 border-y border-slate-200">
      <input value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && salvar()} placeholder="Nome da categoria" autoFocus className="flex-1 min-w-[160px] border rounded px-2 py-1 text-sm" />
      <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoCategoria)} className="text-xs border rounded px-1.5 py-1">
        {(Object.keys(TIPO_LABEL) as TipoCategoria[]).map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
      </select>
      <select value={sinal} onChange={(e) => setSinal(Number(e.target.value))} className="text-xs border rounded px-1.5 py-1 w-12">
        <option value={1}>+</option>
        <option value={-1}>−</option>
      </select>
      <button onClick={salvar} disabled={salvando || !nome.trim()} className="bg-slate-800 text-white px-3 py-1 rounded text-xs font-medium disabled:opacity-50 hover:bg-slate-700">
        {salvando ? 'Salvando...' : 'Adicionar'}
      </button>
      <button onClick={onFechar} className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
    </div>
  );
}
