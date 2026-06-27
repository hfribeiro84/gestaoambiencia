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

function matchPorNome(planilha: NfPlanilha, ca: NfEmitida): boolean {
  const np = normNome(planilha.cliente);
  const nc = normNome(ca.cliente);
  if (!np || !nc) return false;
  const nomesProximos = nc.includes(np) || np.includes(nc);
  return nomesProximos && valorProximo(ca.valor, planilha.valorTotal);
}

export function conferirNfs(
  empresa: Empresa,
  planilha: NfPlanilha[],
  contaAzul: NfEmitida[],
): ItemConferencia[] {
  const matchados = new Set<string>();
  const itens: ItemConferencia[] = [];

  const usarCnpj = empresa === 'netr';

  for (const nfP of planilha) {
    const match = contaAzul.find(
      (ca) => !matchados.has(ca.id) && (usarCnpj ? matchPorCnpj(nfP, ca) : matchPorNome(nfP, ca)),
    );

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
  const itens = erroApi ? planilha.map((p) => ({ status: 'pendente' as const, planilha: p })) : conferirNfs(empresa, planilha, contaAzul);

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
