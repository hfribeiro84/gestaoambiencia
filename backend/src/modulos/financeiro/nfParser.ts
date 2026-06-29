/**
 * Parseia os CSVs de "NF a emitir" da ASS e da NETR.
 * Detecta as colunas pelo nome do cabeçalho para tolerar qualquer
 * variação de layout (colunas extras, ordem diferente, etc.).
 */
import { parse } from 'csv-parse/sync';
import type { NfPlanilha } from './nfTypes';

function parseBRL(valor: string): number {
  if (!valor || valor.trim() === '' || valor.trim() === '-') return 0;
  const limpo = valor.replace(/R\$\s?/g, '').replace(/\./g, '').replace(',', '.').trim();
  return parseFloat(limpo) || 0;
}

function detectarDelimitador(csv: string): string {
  const amostra = csv.slice(0, 2000);
  const pontoVirgulas = (amostra.match(/;/g) ?? []).length;
  const virgulas = (amostra.match(/,/g) ?? []).length;
  return pontoVirgulas > virgulas ? ';' : ',';
}

function parseLinhas(csv: string): string[][] {
  return parse(csv, {
    skip_empty_lines: false,
    relax_column_count: true,
    relax_quotes: true,
    bom: true,
    delimiter: detectarDelimitador(csv),
  }) as string[][];
}

/** Encontra o índice da coluna cujo cabeçalho contém algum dos termos. */
function findCol(headers: string[], ...termos: string[]): number {
  return headers.findIndex((h) =>
    termos.some((t) => h.trim().toLowerCase().includes(t.toLowerCase())),
  );
}

/** Encontra a linha de cabeçalho procurando por termos conhecidos. */
function findHeaderRow(linhas: string[][], ...termos: string[]): { idx: number; row: string[] } {
  for (let i = 0; i < Math.min(linhas.length, 8); i++) {
    const row = linhas[i];
    if (row.some((cell) => termos.some((t) => cell.toLowerCase().includes(t.toLowerCase())))) {
      return { idx: i, row };
    }
  }
  return { idx: 1, row: linhas[1] ?? [] };
}

export function parseCsvAss(csv: string): NfPlanilha[] {
  const linhas = parseLinhas(csv);
  const { idx: headerIdx, row: headers } = findHeaderRow(linhas, 'organiza', 'emiss');

  const colEmissao  = findCol(headers, 'emiss');
  const colCliente  = findCol(headers, 'organiza');
  const colProjeto  = findCol(headers, 'projeto');
  const colRec      = findCol(headers, 'recorrente');
  const colOut      = findCol(headers, 'estudo', 'outro');
  const colIss      = findCol(headers, 'reten');

  const dados = linhas.slice(headerIdx + 1);
  const resultado: NfPlanilha[] = [];

  for (const row of dados) {
    const organizacao = colCliente >= 0 ? (row[colCliente] ?? '').trim() : '';
    const projeto = colProjeto >= 0 ? (row[colProjeto] ?? '').trim() : '';

    // Quando Organização está vazia, usa Projeto como nome do cliente
    // (casos onde o tomador é identificado só pelo projeto, ex: PJ282-1, A.M.B)
    const cliente = organizacao || projeto;
    if (!cliente) continue;

    const valorRec = parseBRL(colRec >= 0 ? (row[colRec] ?? '') : '');
    const valorOut = parseBRL(colOut >= 0 ? (row[colOut] ?? '') : '');
    const valorTotal = valorRec + valorOut;
    if (valorTotal === 0) continue;

    resultado.push({
      emissaoNF: colEmissao >= 0 ? (row[colEmissao] ?? '').trim().toUpperCase() : '',
      cliente,
      // Se Organização estava vazia, o projeto já virou cliente — descricao fica vazio
      descricao: organizacao ? projeto : '',
      valorTotal,
      retencaoISS: (colIss >= 0 ? row[colIss] : '').trim().toUpperCase() === 'SIM',
    });
  }
  return resultado;
}

function formatCnpj(cnpj: string): string {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export function parseCsvNetr(csv: string): NfPlanilha[] {
  const linhas = parseLinhas(csv);
  const { idx: headerIdx, row: headers } = findHeaderRow(linhas, 'empresa', 'unidade', 'cnpj');

  const colEmissao     = findCol(headers, 'emiss');
  const colEmpresa     = findCol(headers, 'empresa');
  const colUnidade     = findCol(headers, 'unidade');
  const colFaturamento = findCol(headers, 'faturamento');  // "Corporativo" ou "Unidade"
  const colCnpj        = findCol(headers, 'cnpj');
  const colValor       = findCol(headers, 'cobran');
  const colIss         = findCol(headers, 'reten');

  const dados = linhas.slice(headerIdx + 1);

  // Faturamento "Corporativo" e "Consultoria": 1 NF única para todas as unidades,
  // agrupada pelo CNPJ de Faturamento (soma dos valores). "Unidade": 1 NF por linha.
  const ehAgrupado = (f: string) => f === 'corporativo' || f === 'consultoria';

  // Agrupado por CNPJ → 1 NF por CNPJ com soma dos valores
  type GrupoCorp = {
    emissaoNF: string;
    empresas: Set<string>;
    nUnidades: number;
    valorTotal: number;
    retencaoISS: boolean;
  };
  const gruposCorp = new Map<string, GrupoCorp>();

  // Unidade: 1 NF por linha (CNPJ individual da obra/unidade)
  const itensUnidade: NfPlanilha[] = [];

  for (const row of dados) {
    const empresa = colEmpresa >= 0 ? (row[colEmpresa] ?? '').trim() : '';
    if (!empresa) continue;

    const valorTotal = parseBRL(colValor >= 0 ? (row[colValor] ?? '') : '');
    if (valorTotal === 0) continue;

    const emissaoNF   = (colEmissao >= 0 ? (row[colEmissao] ?? '') : '').trim().toUpperCase();
    const faturamento = (colFaturamento >= 0 ? (row[colFaturamento] ?? '') : '').trim().toLowerCase();
    const cnpj        = (colCnpj >= 0 ? (row[colCnpj] ?? '') : '').replace(/\D/g, '');
    const unidade     = colUnidade >= 0 ? (row[colUnidade] ?? '').trim() : '';
    const retencaoISS = (colIss >= 0 ? row[colIss] : '').trim().toUpperCase() === 'SIM';

    if (ehAgrupado(faturamento)) {
      if (!cnpj) continue;
      if (!gruposCorp.has(cnpj)) {
        gruposCorp.set(cnpj, { emissaoNF: '', empresas: new Set(), nUnidades: 0, valorTotal: 0, retencaoISS: false });
      }
      const g = gruposCorp.get(cnpj)!;
      if (emissaoNF && !g.emissaoNF) g.emissaoNF = emissaoNF;
      g.empresas.add(empresa);
      g.nUnidades++;
      g.valorTotal += valorTotal;
      if (retencaoISS) g.retencaoISS = true;
    } else {
      itensUnidade.push({
        emissaoNF,
        cliente: empresa,
        descricao: unidade,
        cnpj,
        valorTotal,
        retencaoISS,
      });
    }
  }

  // Converte grupos corporativos em itens de planilha
  const itensCorp: NfPlanilha[] = [];
  for (const [cnpj, g] of gruposCorp) {
    const empresasList = [...g.empresas];
    const clienteNome = empresasList.length === 1
      ? empresasList[0]
      : `${empresasList[0]} +${empresasList.length - 1} empresas`;
    itensCorp.push({
      emissaoNF: g.emissaoNF,
      cliente: clienteNome,
      descricao: `${g.nUnidades} unidades · ${formatCnpj(cnpj)}`,
      cnpj,
      valorTotal: parseFloat(g.valorTotal.toFixed(2)),
      retencaoISS: g.retencaoISS,
    });
  }

  // Corporativo primeiro, depois Unidades (ordem natural do CSV)
  return [...itensCorp, ...itensUnidade];
}
