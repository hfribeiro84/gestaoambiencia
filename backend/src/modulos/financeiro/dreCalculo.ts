import { supabaseAdmin } from '../../config/supabase';
import { buscarLancamentosCA } from './dreContaAzul';
import type {
  EmpresaDRE,
  TipoCategoria,
  DreCategoria,
  LancamentoCA,
  ValorMes,
  LinhaDRE,
  TotaisCalculados,
  DadosDRE,
} from './dreTypes';

// ──────────────────────────────────────────────────────────────
// Helpers de data
// ──────────────────────────────────────────────────────────────

function janela12Meses(mesRef: number, anoRef: number): Array<{ mes: number; ano: number }> {
  const meses: Array<{ mes: number; ano: number }> = [];
  for (let i = -5; i <= 6; i++) {
    let mes = mesRef + i;
    let ano = anoRef;
    while (mes < 1) { mes += 12; ano--; }
    while (mes > 12) { mes -= 12; ano++; }
    meses.push({ mes, ano });
  }
  return meses;
}

function inicioFimJanela(meses: Array<{ mes: number; ano: number }>): { de: string; ate: string } {
  const primeiro = meses[0];
  const ultimo = meses[meses.length - 1];
  const mm1 = String(primeiro.mes).padStart(2, '0');
  const mm2 = String(ultimo.mes).padStart(2, '0');
  const diaFinal = new Date(ultimo.ano, ultimo.mes, 0).getDate();
  return {
    de: `${primeiro.ano}-${mm1}-01`,
    ate: `${ultimo.ano}-${mm2}-${String(diaFinal).padStart(2, '0')}`,
  };
}

/** Retorna 'YYYY-MM' de uma data ISO (YYYY-MM-DD). */
function mesAno(data: string): string {
  return data.slice(0, 7);
}

function chave(mes: number, ano: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}`;
}

// ──────────────────────────────────────────────────────────────
// Carga do banco
// ──────────────────────────────────────────────────────────────

async function carregarCategorias(): Promise<DreCategoria[]> {
  const { data, error } = await supabaseAdmin
    .from('dre_categoria')
    .select('*')
    .order('ordem');
  if (error) throw new Error(`Erro ao carregar categorias: ${error.message}`);
  return (data ?? []) as DreCategoria[];
}

async function carregarMapeamentos(empresa: 'ass' | 'netr'): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin
    .from('dre_mapeamento')
    .select('nome_ca, categoria_id')
    .eq('empresa', empresa);
  if (error) throw new Error(`Erro ao carregar mapeamentos: ${error.message}`);
  const mapa = new Map<string, string>();
  for (const row of data ?? []) mapa.set(row.nome_ca as string, row.categoria_id as string);
  return mapa;
}

// ──────────────────────────────────────────────────────────────
// Montagem da árvore
// ──────────────────────────────────────────────────────────────

function montarArvore(
  categorias: DreCategoria[],
  meses: Array<{ mes: number; ano: number }>,
): { arvore: LinhaDRE[]; mapaLinhas: Map<string, LinhaDRE> } {
  const mapaLinhas = new Map<string, LinhaDRE>();

  for (const cat of categorias) {
    const linha: LinhaDRE = {
      id: cat.id,
      nome: cat.nome,
      tipo: cat.tipo,
      sinal: cat.sinal,
      ordem: cat.ordem,
      subcategorias: [],
      valores: meses.map(({ mes, ano }) => ({ mes, ano, valor: 0 })),
      total12m: 0,
    };
    mapaLinhas.set(cat.id, linha);
  }

  const raizes: LinhaDRE[] = [];
  for (const cat of categorias) {
    const linha = mapaLinhas.get(cat.id)!;
    if (cat.pai_id) {
      const pai = mapaLinhas.get(cat.pai_id);
      if (pai) pai.subcategorias.push(linha);
    } else {
      raizes.push(linha);
    }
  }

  return { arvore: raizes, mapaLinhas };
}

// ──────────────────────────────────────────────────────────────
// Acúmulo de valores
// ──────────────────────────────────────────────────────────────

function acumularValor(
  mapaLinhas: Map<string, LinhaDRE>,
  categoriaId: string,
  chaveMes: string,
  valorBruto: number,
) {
  const alvo = mapaLinhas.get(categoriaId);
  if (!alvo) return;

  const idx = alvo.valores.findIndex((v) => chave(v.mes, v.ano) === chaveMes);
  if (idx === -1) return;

  // O valor já vem positivo do CA; aplica o sinal da categoria no acúmulo
  alvo.valores[idx].valor += valorBruto * alvo.sinal;
}

/** Soma os valores de subcategorias para a linha pai recursivamente. */
function somarSubcategorias(linha: LinhaDRE): void {
  for (const sub of linha.subcategorias) somarSubcategorias(sub);

  if (linha.subcategorias.length > 0) {
    for (let i = 0; i < linha.valores.length; i++) {
      linha.valores[i].valor = linha.subcategorias.reduce(
        (acc, sub) => acc + sub.valores[i].valor,
        0,
      );
    }
  }

  linha.total12m = linha.valores.reduce((acc, v) => acc + v.valor, 0);
}

// ──────────────────────────────────────────────────────────────
// Determinação do mês do lançamento
// ──────────────────────────────────────────────────────────────

function determinarMesLancamento(
  lancamento: LancamentoCA,
  hoje: Date,
): string | null {
  const vencimento = lancamento.dataVencimento;
  if (!vencimento) return null;

  const [anoV, mesV] = vencimento.split('-').map(Number);
  const dataVenc = new Date(anoV, mesV - 1, 1);
  const inicioMesAtual = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

  if (dataVenc < inicioMesAtual) {
    // Mês passado: usa dataPagamento se existir
    if (lancamento.dataPagamento) return mesAno(lancamento.dataPagamento);
    return null; // não pago ainda em mês passado — ignora
  }

  // Mês atual ou futuro: usa dataVencimento
  return mesAno(vencimento);
}

// ──────────────────────────────────────────────────────────────
// Totais calculados
// ──────────────────────────────────────────────────────────────

function somarPorTipo(
  arvore: LinhaDRE[],
  tipo: TipoCategoria,
  meses: Array<{ mes: number; ano: number }>,
  excluirNome?: string,
): ValorMes[] {
  const resultado = meses.map(({ mes, ano }) => ({ mes, ano, valor: 0 }));

  function percorrer(linhas: LinhaDRE[]) {
    for (const l of linhas) {
      if (l.tipo === tipo) {
        if (excluirNome && l.nome.includes(excluirNome)) {
          percorrer(l.subcategorias);
          continue;
        }
        for (let i = 0; i < resultado.length; i++) {
          resultado[i].valor += l.valores[i].valor;
        }
      }
      percorrer(l.subcategorias);
    }
  }

  percorrer(arvore);
  return resultado;
}

function somarValoresMes(a: ValorMes[], b: ValorMes[]): ValorMes[] {
  return a.map((v, i) => ({ ...v, valor: v.valor + b[i].valor }));
}

function calcularTotais(
  arvore: LinhaDRE[],
  meses: Array<{ mes: number; ano: number }>,
  consolidado: boolean,
): TotaisCalculados {
  const excluirEstorno = consolidado ? 'Estorno' : undefined;

  const receitaBruta = somarPorTipo(arvore, 'receita', meses);
  const deducoes = somarPorTipo(arvore, 'deducao', meses);
  const custoProjetos = somarPorTipo(arvore, 'custo', meses);
  const despesas = somarPorTipo(arvore, 'despesa', meses, excluirEstorno);
  const operacaoFinanceira = somarPorTipo(arvore, 'financeiro', meses);
  const divisao = somarPorTipo(arvore, 'divisao', meses);

  const receitaLiquida = somarValoresMes(receitaBruta, deducoes);
  const resultadoOperacional = somarValoresMes(somarValoresMes(receitaLiquida, custoProjetos), despesas);
  const resultadoLiquido = somarValoresMes(resultadoOperacional, operacaoFinanceira);
  const fluxoCaixaLivre = somarValoresMes(resultadoLiquido, divisao);

  return {
    receitaBruta,
    receitaLiquida,
    custoProjetos,
    despesas,
    resultadoOperacional,
    operacaoFinanceira,
    resultadoLiquido,
    fluxoCaixaLivre,
  };
}

// ──────────────────────────────────────────────────────────────
// Percentual sobre receita bruta
// ──────────────────────────────────────────────────────────────

function aplicarPercentuais(arvore: LinhaDRE[], receitaBruta12m: number): void {
  for (const linha of arvore) {
    if (receitaBruta12m !== 0) {
      linha.percentualReceita = (linha.total12m / receitaBruta12m) * 100;
    }
    if (linha.subcategorias.length > 0) aplicarPercentuais(linha.subcategorias, receitaBruta12m);
  }
}

// ──────────────────────────────────────────────────────────────
// Função principal
// ──────────────────────────────────────────────────────────────

export async function calcularDRE(
  empresa: EmpresaDRE,
  mesRef: number,
  anoRef: number,
): Promise<DadosDRE> {
  const meses = janela12Meses(mesRef, anoRef);
  const { de, ate } = inicioFimJanela(meses);
  const hoje = new Date();

  // Carrega estrutura do banco
  const [categoriasDb, mapeamentoAss, mapeamentoNetr] = await Promise.all([
    carregarCategorias(),
    empresa !== 'netr' ? carregarMapeamentos('ass') : Promise.resolve(new Map<string, string>()),
    empresa !== 'ass' ? carregarMapeamentos('netr') : Promise.resolve(new Map<string, string>()),
  ]);

  // Monta a árvore de linhas do DRE
  const { arvore, mapaLinhas } = montarArvore(categoriasDb, meses);

  const naoMapeadasSet = new Set<string>();
  const naoMapeadasReceitaMes = new Map<string, number>();
  const naoMapeadasDespesaMes = new Map<string, number>();
  const chaveMesesSet = new Set(meses.map(({ mes, ano }) => chave(mes, ano)));

  async function processarEmpresa(conta: 'ass' | 'netr', mapeamento: Map<string, string>) {
    const lancamentos = await buscarLancamentosCA(conta, de, ate);

    for (const lanc of lancamentos) {
      const chaveMes = determinarMesLancamento(lanc, hoje);
      if (!chaveMes || !chaveMesesSet.has(chaveMes)) continue;

      const catId = mapeamento.get(lanc.categoria);
      if (!catId) {
        if (lanc.categoria) naoMapeadasSet.add(lanc.categoria);
        const mapa = lanc.tipo === 'receita' ? naoMapeadasReceitaMes : naoMapeadasDespesaMes;
        mapa.set(chaveMes, (mapa.get(chaveMes) ?? 0) + Math.abs(lanc.valor));
        continue;
      }

      acumularValor(mapaLinhas, catId, chaveMes, Math.abs(lanc.valor));
    }
  }

  if (empresa === 'consolidado') {
    await Promise.all([
      processarEmpresa('ass', mapeamentoAss),
      processarEmpresa('netr', mapeamentoNetr),
    ]);
  } else {
    const mapeamento = empresa === 'ass' ? mapeamentoAss : mapeamentoNetr;
    await processarEmpresa(empresa, mapeamento);
  }

  // Soma subcategorias → pais
  for (const linha of arvore) somarSubcategorias(linha);

  // Calcula totais e percentuais
  const totais = calcularTotais(arvore, meses, empresa === 'consolidado');
  const receitaBruta12m = totais.receitaBruta.reduce((acc, v) => acc + v.valor, 0);
  aplicarPercentuais(arvore, receitaBruta12m);

  const naoMapeadasReceita = meses.map(({ mes, ano }) => ({
    mes, ano, valor: naoMapeadasReceitaMes.get(chave(mes, ano)) ?? 0,
  }));
  const naoMapeadasDespesa = meses.map(({ mes, ano }) => ({
    mes, ano, valor: naoMapeadasDespesaMes.get(chave(mes, ano)) ?? 0,
  }));

  return {
    empresa,
    mesRef,
    anoRef,
    meses,
    categorias: arvore,
    totais,
    naoMapeadas: Array.from(naoMapeadasSet).sort(),
    naoMapeadasReceita,
    naoMapeadasDespesa,
  };
}
