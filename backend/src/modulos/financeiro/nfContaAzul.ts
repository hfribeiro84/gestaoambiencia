/**
 * Busca as NFs emitidas no Conta Azul para um dado mês.
 *
 * Endpoint: GET /v1/service-invoices
 * Parâmetros: emit_date_begin, emit_date_end, status=ISSUED, page, per_page
 *
 * Se o endpoint estiver diferente na API do Conta Azul contratado, ajustar
 * a constante ENDPOINT abaixo.
 */
import { chamadaApi } from '../../integracoes/contaAzul';
import type { Empresa, NfEmitida } from './nfTypes';

const ENDPOINT = '/v1/service-invoices';

function diasNoMes(mes: number, ano: number): string {
  return String(new Date(ano, mes, 0).getDate()).padStart(2, '0');
}

function normCnpj(v: string): string {
  return (v ?? '').replace(/\D/g, '');
}

function extrairCampo(obj: Record<string, unknown>, ...chaves: string[]): string {
  for (const k of chaves) {
    const v = obj[k];
    if (v !== undefined && v !== null) return String(v);
  }
  return '';
}

export async function buscarNfsEmitidas(empresa: Empresa, mes: number, ano: number): Promise<NfEmitida[]> {
  const conta = empresa === 'ass' ? 'ass' : 'netr';
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const fim = `${ano}-${String(mes).padStart(2, '0')}-${diasNoMes(mes, ano)}`;

  const nfs: NfEmitida[] = [];
  let page = 0;

  while (true) {
    const resp = await chamadaApi(conta, ENDPOINT, {
      emit_date_begin: inicio,
      emit_date_end: fim,
      status: 'ISSUED',
      page: String(page),
      per_page: '100',
    });

    if (!resp.ok) {
      const corpo = await resp.text();
      throw new Error(`Conta Azul API ${resp.status}: ${corpo.slice(0, 200)}`);
    }

    const data = await resp.json() as unknown;
    const items: Record<string, unknown>[] = Array.isArray(data)
      ? (data as Record<string, unknown>[])
      : ((data as Record<string, unknown>).data as Record<string, unknown>[] ?? []);

    if (items.length === 0) break;

    for (const item of items) {
      const customer = (item.customer ?? {}) as Record<string, unknown>;
      const valorBruto =
        Number(item.value ?? item.gross_value ?? item.services_amount ?? 0);

      nfs.push({
        id: extrairCampo(item, 'id'),
        numero: extrairCampo(item, 'number', 'numero'),
        dataEmissao: extrairCampo(item, 'issue_date', 'emit_date', 'data_emissao'),
        status: extrairCampo(item, 'status'),
        cliente: extrairCampo(customer, 'name', 'nome') || extrairCampo(item, 'customer_name'),
        cnpj: normCnpj(
          extrairCampo(customer, 'identity', 'document', 'cpf_cnpj') ||
          extrairCampo(item, 'customer_identity', 'customer_document'),
        ),
        valor: valorBruto,
        descricao: extrairCampo(item, 'description', 'descricao', 'observations'),
      });
    }

    // Verifica se há mais páginas
    const total = Number((data as Record<string, unknown>).total ?? (data as Record<string, unknown>).total_count ?? NaN);
    if (!isNaN(total) && nfs.length >= total) break;
    if (items.length < 100) break;
    page++;
  }

  return nfs;
}
