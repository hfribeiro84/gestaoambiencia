import type { Empresa, NfPlanilha, NfEmitida, ItemConferencia, ResultadoConferencia } from './nfTypes';

function normNome(nome: string): string {
  return (nome ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normCnpj(v: string): string {
  return (v ?? '').replace(/\D/g, '');
}

function valorProximo(a: number, b: number): boolean {
  if (a === 0 && b === 0) return true;
  return Math.abs(a - b) < 1.0; // ±R$1,00
}

function matchPorCnpj(planilha: NfPlanilha, ca: NfEmitida): boolean {
  const cnpjP = normCnpj(planilha.cnpj ?? '');
  const cnpjC = normCnpj(ca.cnpj ?? '');
  return cnpjP.length > 0 && cnpjP === cnpjC && valorProximo(ca.valor, planilha.valorTotal);
}

/**
 * Matching para ASS: o Conta Azul grava o projeto no campo nome_cliente
 * (ex.: "PJ279-1 - GAC - EPA Letícia..."), então comparamos o código PJ
 * do campo descricao (Projeto da planilha) contra o nome_cliente da CA.
 * Fallback: nome da organização.
 */
function matchAss(planilha: NfPlanilha, ca: NfEmitida): boolean {
  const caNorm = normNome(ca.cliente);
  if (!caNorm) return false;

  // 1. Código PJ (mais específico): "pj279-1" deve estar em ambos
  const descNorm = normNome(planilha.descricao ?? '');
  const pjPlanilha = descNorm.match(/pj\d+[-\d]*/)?.[0];
  const pjCa = caNorm.match(/pj\d+[-\d]*/)?.[0];
  if (pjPlanilha && pjCa && pjPlanilha === pjCa) {
    return valorProximo(ca.valor, planilha.valorTotal);
  }

  // 2. Substring bidirecional do texto do projeto
  if (descNorm.length > 3 && (caNorm.includes(descNorm) || descNorm.includes(caNorm))) {
    return valorProximo(ca.valor, planilha.valorTotal);
  }

  // 3. Fallback: nome da organização
  const clienteNorm = normNome(planilha.cliente);
  if (clienteNorm.length > 2 && (caNorm.includes(clienteNorm) || clienteNorm.includes(caNorm))) {
    return valorProximo(ca.valor, planilha.valorTotal);
  }

  return false;
}

export function conferirNfs(
  empresa: Empresa,
  planilha: NfPlanilha[],
  contaAzul: NfEmitida[],
): ItemConferencia[] {
  const matchados = new Set<string>();
  const itens: ItemConferencia[] = [];

  const escolherMatch = empresa === 'netr'
    ? (nfP: NfPlanilha, ca: NfEmitida) => matchPorCnpj(nfP, ca)
    : (nfP: NfPlanilha, ca: NfEmitida) => matchAss(nfP, ca);

  for (const nfP of planilha) {
    const match = contaAzul.find((ca) => !matchados.has(ca.id) && escolherMatch(nfP, ca));

    if (match) {
      matchados.add(match.id);
      itens.push({ status: 'conferido', planilha: nfP, contaAzul: match });
    } else {
      itens.push({ status: 'pendente', planilha: nfP });
    }
  }

  for (const ca of contaAzul) {
    if (!matchados.has(ca.id)) {
      itens.push({ status: 'nao_esperada', contaAzul: ca });
    }
  }

  return itens;
}

export function calcularResultado(
  empresa: Empresa,
  mes: number,
  ano: number,
  planilha: NfPlanilha[],
  contaAzul: NfEmitida[],
  erroApi?: string,
): ResultadoConferencia {
  const itens = erroApi
    ? planilha.map((p) => ({ status: 'pendente' as const, planilha: p }))
    : conferirNfs(empresa, planilha, contaAzul);

  return {
    empresa,
    mes,
    ano,
    totalPlanilha: planilha.length,
    totalContaAzul: contaAzul.length,
    conferidos: itens.filter((i) => i.status === 'conferido').length,
    pendentes: itens.filter((i) => i.status === 'pendente').length,
    naoEsperadas: itens.filter((i) => i.status === 'nao_esperada').length,
    itens,
    erroApi,
  };
}
