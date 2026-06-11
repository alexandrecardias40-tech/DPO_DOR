import dayjs, { Dayjs } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import * as XLSX from 'xlsx';

dayjs.extend(customParseFormat);

const MONTH_KEY_REGEX = /^\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2})?$/;
const HEADER_PI_YEAR_REGEX = /\bpi\s*[-_/]?\s*(20\d{2})\b/i;
const EXPIRING_DAYS = 90;

const PREFERRED_SHEETS = ['Despesas', 'Execução', 'Execucao', 'CEMP', 'Base'];

type CanonicalField =
  | 'Despesa'
  | 'UGR'
  | 'PI'
  | 'CNPJ'
  | 'Processo'
  | 'Data_Vigencia_Fim'
  | 'Status_Contrato'
  | 'Situacao_Prorrogacao'
  | 'Numero_Contrato'
  | 'Valor_Mensal_Medio_Contrato'
  | 'Valor_Mensal_Continuado'
  | 'Total_Anual_Estimado'
  | 'Fonte'
  | 'NC_Detalhada'
  | 'Saldo_Disponivel_Detalhado'
  | 'Saldo_Empenhos_2025'
  | 'Saldo_Empenhos_RAP'
  | 'Total_Empenho_RAP'
  | 'Executado_Total'
  | 'Total_Necessario';

type HeaderBinding =
  | {
    type: 'field';
    field: CanonicalField;
  }
  | {
    type: 'month';
    monthKey: string;
  };

type ParsedSheet = {
  headerScore: number;
  headerRowIndex: number;
  monthKeys: string[];
  referenceYear: number | null;
  rows: Array<Record<string, any>>;
  sheetName: string;
};

export type BudgetMetadata = {
  month_keys?: string[];
  reference_year?: number | null;
  source_file_name?: string;
  source_sheet?: string;
  updated_at?: string;
  updated_by_email?: string | null;
  source_file?: string | null;
  workbook_sheets?: string[];
};

export const EMPTY_DASHBOARD_DATA = {
  kpis: {
    total_anual_estimado: 0,
    total_empenhado: 0,
    total_comprometido: 0,
    saldo_a_empenhar: 0,
    percentual_execucao: 0,
    taxa_execucao: 0,
    count_expiring_contracts: 0,
    count_expired_contracts: 0,
  },
  ugr_analysis: [],
  monthly_consumption: [],
  expiring_contracts_list: [],
  expired_contracts_list: [],
  raw_data_for_filters: [],
  metadata: {
    month_keys: [],
    reference_year: null,
    updated_at: dayjs().toISOString(),
  } satisfies BudgetMetadata,
};

const normalizeText = (value: unknown): string => {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
};

const normalizeToken = (value: unknown): string => {
  const text = normalizeText(value);
  if (!text) return '';
  if (text === 'nan' || text === 'none' || text === 'null') return '';
  return text;
};

const isNullishLike = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return !Number.isFinite(value);
  if (typeof value === 'string') {
    const token = normalizeToken(value);
    return !token;
  }
  return false;
};

const maybeString = (value: unknown): string => {
  if (isNullishLike(value)) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    if (Math.abs(value) >= 1e15) return value.toFixed(0);
    return Number.isInteger(value) ? String(value) : String(value);
  }
  return String(value).trim();
};

const firstDefined = (...values: unknown[]): unknown => {
  for (const value of values) {
    if (!isNullishLike(value)) return value;
  }
  return undefined;
};

export const toNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const trimmed = value
      .replace(/R\$/gi, '')
      .replace(/\s+/g, '')
      .replace(/%$/, '')
      .trim();

    if (!trimmed) return 0;

    const hasComma = trimmed.includes(',');
    const hasDot = trimmed.includes('.');

    let normalized = trimmed;
    if (hasComma && hasDot) {
      const commaIdx = trimmed.lastIndexOf(',');
      const dotIdx = trimmed.lastIndexOf('.');
      if (commaIdx > dotIdx) {
        normalized = trimmed.replace(/\./g, '').replace(',', '.');
      } else {
        normalized = trimmed.replace(/,/g, '');
      }
    } else if (hasComma) {
      normalized = trimmed.replace(',', '.');
    }

    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  return 0;
};

const fromExcelSerial = (value: number): Dayjs | null => {
  // Excel serial date starts from 1900-01-01, but has a bug for 1900-02-29
  // Use the standard conversion: milliseconds since 1970-01-01
  const excelEpoch = new Date(1900, 0, 1); // 1900-01-01
  const date = new Date(excelEpoch.getTime() + (value - 1) * 24 * 60 * 60 * 1000);
  // Adjust for the 1900 leap year bug
  if (value >= 60) date.setTime(date.getTime() - 24 * 60 * 60 * 1000);
  const parsed = dayjs(date);
  return parsed.isValid() ? parsed : null;
};

const parseDateValue = (value: unknown): Dayjs | null => {
  if (value instanceof Date) {
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const serial = fromExcelSerial(value);
    if (serial?.isValid()) return serial;
    return null;
  }

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?$/.test(trimmed)) {
    const parsed = dayjs(trimmed, ['YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DDTHH:mm:ss'], true);
    if (parsed.isValid()) return parsed;
  }

  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const parsed = dayjs(trimmed, 'YYYY-MM', true);
    if (parsed.isValid()) return parsed;
  }

  const dateMatches = trimmed.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/g);
  if (dateMatches && dateMatches.length > 0) {
    const candidate = dateMatches[dateMatches.length - 1];
    const parsed = dayjs(candidate, ['DD/MM/YYYY', 'D/M/YYYY', 'DD/MM/YY', 'D/M/YY'], true);
    if (parsed.isValid()) return parsed;
  }

  const fallback = dayjs(trimmed, ['DD/MM/YYYY', 'D/M/YYYY', 'DD-MM-YYYY', 'D-M-YYYY'], true);
  return fallback.isValid() ? fallback : null;
};

const toMonthKey = (value: unknown): string | null => {
  const parsed = parseDateValue(value);
  if (!parsed?.isValid()) return null;
  return `${parsed.format('YYYY-MM')}-01 00:00:00`;
};

const isMonthKey = (key: string): boolean => MONTH_KEY_REGEX.test(key);

const normalizeMonthKey = (key: string): string => {
  const match = key.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return key;
  return `${match[1]} 00:00:00`;
};

const mapHeaderTokenToField = (token: string): CanonicalField | null => {
  if (!token) return null;

  if (token.includes('descricao das despesas') || token === 'despesa' || token.includes('acompanhamento de contratos')) {
    return 'Despesa';
  }
  if (token === 'ugr') return 'UGR';
  if (token.startsWith('pi ') || token === 'pi' || token.startsWith('pi20')) return 'PI';
  if (token === 'cnpj') return 'CNPJ';
  if (token.includes('processo')) return 'Processo';
  if (token.includes('vigencia')) return 'Data_Vigencia_Fim';
  if (token.includes('status do contrato') || token === 'status contrato' || token === 'status') {
    return 'Status_Contrato';
  }
  if (token.includes('situacao da prorrogacao') || token.includes('situacao prorrogacao')) {
    return 'Situacao_Prorrogacao';
  }

  if (
    (token.includes('contrato') && token.includes('numero')) ||
    token.startsWith('n contrato') ||
    token === 'n contrato'
  ) {
    return 'Numero_Contrato';
  }

  if (token.includes('valor contrato media mensal') || token.includes('valor mensal medio contrato')) {
    return 'Valor_Mensal_Medio_Contrato';
  }

  if (token.includes('valor cont mensal') || token.includes('valor mensal continuado')) {
    return 'Valor_Mensal_Continuado';
  }

  if (token.includes('total estimado anual') || token.includes('total anual estimado')) {
    return 'Total_Anual_Estimado';
  }

  if (token === 'fonte') return 'Fonte';
  if (token.includes('nc detalha')) return 'NC_Detalhada';
  if (token.includes('saldo disponivel detalh')) return 'Saldo_Disponivel_Detalhado';

  if (token.includes('saldo de empenhos rap') || token.includes('saldo empenhos rap')) {
    return 'Saldo_Empenhos_RAP';
  }

  if (token.includes('total rap') && token.includes('empenho')) {
    return 'Total_Empenho_RAP';
  }

  if (token.includes('saldo empenhos')) {
    return 'Saldo_Empenhos_2025';
  }

  if (token.includes('executado total')) return 'Executado_Total';

  if (token.includes('total necessario') || token.includes('valor empenhar')) {
    return 'Total_Necessario';
  }

  return null;
};

const scoreHeaderRow = (row: unknown[]): number => {
  let score = 0;

  for (const cell of row) {
    const token = normalizeText(cell);
    if (!token) continue;

    if (toMonthKey(cell)) score += 1;

    if (token.includes('descricao das despesas')) score += 4;
    if (token === 'ugr') score += 2;
    if (token.startsWith('pi')) score += 2;

    if (mapHeaderTokenToField(token)) score += 2;
  }

  return score;
};

const findHeaderRowIndex = (matrix: unknown[][]): number => {
  let bestIdx = -1;
  let bestScore = 0;

  for (let i = 0; i < matrix.length && i < 40; i += 1) {
    const row = matrix[i] || [];
    const score = scoreHeaderRow(row);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestScore >= 8 ? bestIdx : -1;
};

const detectReferenceYear = (monthKeys: string[], rowYearHint?: number | null): number | null => {
  if (rowYearHint && Number.isFinite(rowYearHint)) return rowYearHint;
  if (monthKeys.length > 0) {
    const first = monthKeys[0];
    const year = Number(first.slice(0, 4));
    return Number.isFinite(year) ? year : null;
  }
  return null;
};

const detectYearFromHeader = (headerRow: unknown[]): number | null => {
  for (const cell of headerRow) {
    if (typeof cell !== 'string') continue;
    const match = cell.match(HEADER_PI_YEAR_REGEX);
    if (match && match[1]) {
      const year = Number(match[1]);
      if (Number.isFinite(year)) return year;
    }
  }
  return null;
};

const toIsoDate = (value: unknown): string => {
  const parsed = parseDateValue(value);
  if (!parsed?.isValid()) return '';
  return parsed.format('YYYY-MM-DD');
};

const sumMonthValues = (row: Record<string, unknown>): number => {
  return Object.entries(row).reduce((sum, [key, value]) => {
    if (!isMonthKey(key)) return sum;
    return sum + toNumber(value);
  }, 0);
};

const normalizeNumericFields = (row: Record<string, any>) => {
  const totalEstimado = toNumber(row.Total_Anual_Estimado);
  const executadoInformado = toNumber(row.Executado_Total);
  const empenhoRap = toNumber(row.Total_Empenho_RAP);
  const saldo25 = toNumber(row.Saldo_Empenhos_2025);
  const saldoRap = toNumber(row.Saldo_Empenhos_RAP);
  const meses = sumMonthValues(row);

  const comprometido = empenhoRap || saldo25 + saldoRap;
  const executado = executadoInformado || meses || comprometido;

  const taxaExecucao = totalEstimado > 0 ? (executado / totalEstimado) * 100 : 0;

  return {
    ...row,
    Total_Anual_Estimado: totalEstimado,
    Valor_Mensal_Medio_Contrato: toNumber(row.Valor_Mensal_Medio_Contrato),
    Valor_Mensal_Continuado: toNumber(row.Valor_Mensal_Continuado),
    Saldo_Empenhos_2025: saldo25,
    Saldo_Empenhos_RAP: saldoRap,
    Total_Empenho_RAP: comprometido,
    Executado_Total: executado,
    Total_Necessario: toNumber(row.Total_Necessario),
    Taxa_Execucao: taxaExecucao,
  };
};

type UgrAccumulator = {
  UGR: string;
  Total_Anual_Estimado: number;
  Total_Empenho_RAP: number;
  Executado_Total: number;
  Comprometido_Total: number;
  Contratos_Ativos: number;
  Contratos_Expirados: number;
  Percentual_Execucao: number;
  // New separated fields
  Saldo_Empenhos_2025: number;
  Saldo_Empenhos_RAP: number;
};

const buildUgrAnalysis = (rows: Array<Record<string, any>>): UgrAccumulator[] => {
  const map = new Map<string, UgrAccumulator>();
  const today = dayjs().startOf('day');

  rows.forEach((row) => {
    const ugrKey = (row.UGR || 'Nao informado') as string;
    const stats =
      map.get(ugrKey) ||
      {
        UGR: ugrKey,
        Total_Anual_Estimado: 0,
        Total_Empenho_RAP: 0,
        Executado_Total: 0,
        Comprometido_Total: 0,
        Contratos_Ativos: 0,
        Contratos_Expirados: 0,
        Percentual_Execucao: 0,
        Saldo_Empenhos_2025: 0,
        Saldo_Empenhos_RAP: 0,
      };

    const totalEstimado = toNumber(row.Total_Anual_Estimado);
    const executado = toNumber(row.Executado_Total);
    const rap = toNumber(row.Total_Empenho_RAP);
    const saldo25 = toNumber(row.Saldo_Empenhos_2025);
    const saldoRap = toNumber(row.Saldo_Empenhos_RAP);

    // Original logic fallback
    const saldo = saldo25 + saldoRap;
    const comprometido = rap > 0 ? rap : saldo;

    const status = String(row.Status_Contrato || '').toUpperCase();
    const vigencia = row.Data_Vigencia_Fim ? parseDateValue(row.Data_Vigencia_Fim) : null;

    stats.Total_Anual_Estimado += totalEstimado;
    stats.Executado_Total += executado;
    stats.Total_Empenho_RAP += comprometido;
    stats.Comprometido_Total += comprometido;

    // Accumulate new separated fields
    stats.Saldo_Empenhos_2025 += saldo25;
    stats.Saldo_Empenhos_RAP += saldoRap;

    const isExpired =
      (vigencia && vigencia.isValid() && vigencia.isBefore(today)) ||
      (status.includes('VENC') && !status.includes('VENCENDO')) ||
      status.includes('EXPIRAD');

    if (isExpired) {
      stats.Contratos_Expirados += 1;
    } else {
      stats.Contratos_Ativos += 1;
    }

    map.set(ugrKey, stats);
  });

  return Array.from(map.values()).map((stats) => ({
    ...stats,
    Percentual_Execucao:
      stats.Total_Anual_Estimado > 0
        ? (stats.Executado_Total / stats.Total_Anual_Estimado) * 100
        : 0,
  }));
};

const buildMonthlyConsumption = (rows: Array<Record<string, any>>, monthKeys: string[]) => {
  return monthKeys.map((monthKey) => ({
    Mes: monthKey,
    Mês: monthKey.slice(0, 7),
    Consumo_Mensal: rows.reduce((sum, row) => sum + toNumber(row[monthKey]), 0),
  }));
};

const buildContractStatusLists = (rows: Array<Record<string, any>>) => {
  const today = dayjs().startOf('day');
  const expiring: Array<Record<string, any>> = [];
  const expired: Array<Record<string, any>> = [];

  rows.forEach((row) => {
    const status = String(row.Status_Contrato || '').toUpperCase();
    const vigencia = row.Data_Vigencia_Fim ? parseDateValue(row.Data_Vigencia_Fim) : null;

    if (vigencia?.isValid()) {
      const diff = vigencia.startOf('day').diff(today, 'day');
      if (diff < 0) {
        expired.push(row);
        return;
      }
      if (diff <= EXPIRING_DAYS) {
        expiring.push(row);
        return;
      }
    }

    if (status.includes('EXPIRAD') || status.includes('VENCIDO')) {
      expired.push(row);
      return;
    }

    if (status.includes('EM BREVE') || status.includes('VENCENDO')) {
      expiring.push(row);
    }
  });

  const sortByDate = (a: Record<string, any>, b: Record<string, any>) => {
    const dateA = parseDateValue(a.Data_Vigencia_Fim);
    const dateB = parseDateValue(b.Data_Vigencia_Fim);

    if (!dateA?.isValid() && !dateB?.isValid()) return 0;
    if (!dateA?.isValid()) return 1;
    if (!dateB?.isValid()) return -1;
    return dateA.valueOf() - dateB.valueOf();
  };

  return {
    expiringContracts: expiring.sort(sortByDate),
    expiredContracts: expired.sort(sortByDate),
  };
};

const buildKpis = (rows: Array<Record<string, any>>) => {
  const totalEstimado = rows.reduce((sum, row) => sum + toNumber(row.Total_Anual_Estimado), 0);
  const executado = rows.reduce((sum, row) => sum + toNumber(row.Executado_Total), 0);
  const comprometido = rows.reduce((sum, row) => {
    const rap = toNumber(row.Total_Empenho_RAP);
    const saldo = toNumber(row.Saldo_Empenhos_2025) + toNumber(row.Saldo_Empenhos_RAP);
    return sum + (rap > 0 ? rap : saldo);
  }, 0);
  const saldo = Math.max(totalEstimado - executado, 0);
  const percentual = totalEstimado > 0 ? (executado / totalEstimado) * 100 : 0;

  const today = dayjs().startOf('day');
  let expiring = 0;
  let expired = 0;

  rows.forEach((row) => {
    const vigencia = row.Data_Vigencia_Fim ? parseDateValue(row.Data_Vigencia_Fim) : null;
    const status = String(row.Status_Contrato || '').toUpperCase();

    if (vigencia?.isValid()) {
      const diff = vigencia.startOf('day').diff(today, 'day');
      if (diff < 0) {
        expired += 1;
      } else if (diff <= EXPIRING_DAYS) {
        expiring += 1;
      }
      return;
    }

    if (status.includes('EXPIRAD') || status.includes('VENCIDO')) {
      expired += 1;
    } else if (status.includes('EM BREVE') || status.includes('VENCENDO')) {
      expiring += 1;
    }
  });

  return {
    total_anual_estimado: totalEstimado,
    total_empenhado: executado,
    total_comprometido: comprometido,
    saldo_a_empenhar: saldo,
    percentual_execucao: percentual,
    taxa_execucao: percentual,
    count_expiring_contracts: expiring,
    count_expired_contracts: expired,
  };
};

const shouldDiscardRow = (row: Record<string, any>, monthKeys: string[]): boolean => {
  const description = normalizeToken(row.Despesa || row['Descrição das despesas']);
  const ugr = normalizeToken(row.UGR || row.ugr);
  const pi = normalizeToken(row.PI || row.PI_2025 || row.pi);

  if (description === 'data de atualizacao') return true;

  if (description === 'total' || description === 'total geral') return true;
  if (description.startsWith('total da') || description.startsWith('total de')) return true;
  if (description.startsWith('total ') && !ugr) return true;

  const hasFinancial =
    toNumber(row.Total_Anual_Estimado) > 0 ||
    toNumber(row.Total_Empenho_RAP) > 0 ||
    toNumber(row.Saldo_Empenhos_2025) > 0 ||
    toNumber(row.Saldo_Empenhos_RAP) > 0 ||
    toNumber(row.Total_Necessario) > 0 ||
    monthKeys.some((key) => toNumber(row[key]) > 0);

  const hasCoreInfo = Boolean(description || ugr || pi || normalizeToken(row['nº  Contrato']));

  return !hasCoreInfo && !hasFinancial;
};

const getLooseRowMonthKeys = (row: Record<string, unknown>): string[] => {
  const keys: string[] = [];

  Object.keys(row).forEach((rawKey) => {
    const trimmed = rawKey.trim();
    if (isMonthKey(trimmed)) {
      keys.push(normalizeMonthKey(trimmed));
      return;
    }

    const monthKey = toMonthKey(trimmed);
    if (monthKey) {
      keys.push(monthKey);
    }
  });

  return keys;
};

const coerceCanonicalRow = (
  looseRow: Record<string, unknown>,
  monthKeysFromDataset: string[],
  referenceYearHint?: number | null,
): Record<string, any> => {
  const piKey = Object.keys(looseRow).find((key) => /^PI_20\d{2}$/i.test(key));

  const despesa = maybeString(
    firstDefined(
      looseRow.Despesa,
      looseRow.despesa,
      looseRow['Descrição das despesas'],
      looseRow.descricao,
      looseRow['Acompanhamento de Contratos*'],
    ),
  );

  const piValue = maybeString(
    firstDefined(
      looseRow.PI,
      looseRow.pi,
      looseRow.PI_2025,
      piKey ? looseRow[piKey] : undefined,
      looseRow['PI 2025'],
      looseRow['PI 2026'],
      looseRow['PI 2027'],
      looseRow['PI 2028'],
    ),
  );

  const coerced: Record<string, any> = {
    Despesa: despesa,
    'Descrição das despesas': despesa,
    UGR: maybeString(firstDefined(looseRow.UGR, looseRow.ugr)),
    PI: piValue,
    PI_2025: piValue,
    CNPJ: maybeString(firstDefined(looseRow.CNPJ, looseRow.cnpj)),
    Processo: maybeString(firstDefined(looseRow.Processo, looseRow.processo)),
    Data_Vigencia_Fim: toIsoDate(
      firstDefined(looseRow.Data_Vigencia_Fim, looseRow['Vigência'], looseRow.vigencia),
    ),
    Status_Contrato: maybeString(
      firstDefined(looseRow.Status_Contrato, looseRow['Status do Contrato'], looseRow.status),
    ),
    Situacao_Prorrogacao: maybeString(
      firstDefined(
        looseRow.Situacao_Prorrogacao,
        looseRow['Situação da prorrogação'],
        looseRow['Situação da Prorrogação'],
      ),
    ),
    'nº  Contrato': maybeString(
      firstDefined(looseRow['nº  Contrato'], looseRow.Numero_Contrato, looseRow['Nº Contrato']),
    ),
    Valor_Mensal_Medio_Contrato: toNumber(
      firstDefined(
        looseRow.Valor_Mensal_Medio_Contrato,
        looseRow['Valor Contrato Média mensal'],
        looseRow['Valor contrato média mensal'],
      ),
    ),
    Valor_Mensal_Continuado: toNumber(
      firstDefined(looseRow.Valor_Mensal_Continuado, looseRow['Valor Cont Mensal ']),
    ),
    Total_Anual_Estimado: toNumber(
      firstDefined(looseRow.Total_Anual_Estimado, looseRow['Total estimado Anual']),
    ),
    Fonte: maybeString(firstDefined(looseRow.Fonte, looseRow.fonte)),
    NC_Detalhada: maybeString(firstDefined(looseRow.NC_Detalhada, looseRow['NC detalhada'], looseRow['NC detalhado'])),
    Saldo_Disponivel_Detalhado: toNumber(
      firstDefined(looseRow.Saldo_Disponivel_Detalhado, looseRow['Saldo Disponível Detalhado']),
    ),
    Saldo_Empenhos_2025: toNumber(
      firstDefined(looseRow.Saldo_Empenhos_2025, looseRow['Saldo Empenhos 2025']),
    ),
    Saldo_Empenhos_RAP: toNumber(
      firstDefined(looseRow.Saldo_Empenhos_RAP, looseRow['Saldo de Empenhos RAP']),
    ),
    Total_Empenho_RAP: toNumber(
      firstDefined(looseRow.Total_Empenho_RAP, looseRow['Total RAP + Empenho']),
    ),
    Executado_Total: toNumber(firstDefined(looseRow.Executado_Total, looseRow.executado_total)),
    Total_Necessario: toNumber(
      firstDefined(looseRow.Total_Necessario, looseRow['Total necessário'], looseRow['Valor  Empenhar']),
    ),
  };

  const allMonthKeys = new Set(monthKeysFromDataset);
  getLooseRowMonthKeys(looseRow).forEach((key) => allMonthKeys.add(key));

  allMonthKeys.forEach((monthKey) => {
    const directValue = looseRow[monthKey as keyof typeof looseRow];
    const looseValue = looseRow[monthKey.replace(' 00:00:00', '') as keyof typeof looseRow];
    coerced[monthKey] = toNumber(firstDefined(directValue, looseValue));
  });

  const referenceYear = detectReferenceYear(Array.from(allMonthKeys), referenceYearHint ?? null);
  if (referenceYear) {
    coerced[`PI_${referenceYear}`] = piValue;
  }

  return normalizeNumericFields(coerced);
};

const parseSheet = (sheetName: string, worksheet: XLSX.WorkSheet): ParsedSheet | null => {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    blankrows: false,
    defval: null,
    raw: true,
  });

  const headerRowIndex = findHeaderRowIndex(matrix);
  if (headerRowIndex < 0) return null;

  const headerRow = matrix[headerRowIndex] || [];
  const headerScore = scoreHeaderRow(headerRow);

  const bindings = new Map<number, HeaderBinding>();
  const monthKeys = new Set<string>();

  headerRow.forEach((cell, colIdx) => {
    const monthKey = toMonthKey(cell);
    if (monthKey) {
      bindings.set(colIdx, { type: 'month', monthKey });
      monthKeys.add(monthKey);
      return;
    }

    const token = normalizeText(cell);
    const field = mapHeaderTokenToField(token);
    if (field) {
      bindings.set(colIdx, { type: 'field', field });
    }
  });

  const referenceYear = detectYearFromHeader(headerRow);

  const parsedRows: Array<Record<string, any>> = [];
  for (let rowIdx = headerRowIndex + 1; rowIdx < matrix.length; rowIdx += 1) {
    const row = matrix[rowIdx] || [];

    const mapped: Record<string, unknown> = {};
    bindings.forEach((binding, colIdx) => {
      const value = row[colIdx];
      if (binding.type === 'month') {
        mapped[binding.monthKey] = value;
        return;
      }
      mapped[binding.field] = value;
    });

    const canonicalRow = coerceCanonicalRow(mapped, Array.from(monthKeys), referenceYear);

    if (shouldDiscardRow(canonicalRow, Array.from(monthKeys))) {
      continue;
    }

    parsedRows.push(canonicalRow);
  }

  return {
    headerRowIndex,
    headerScore,
    monthKeys: Array.from(monthKeys).sort(),
    referenceYear,
    rows: parsedRows,
    sheetName,
  };
};

const pickSheet = (
  workbook: XLSX.WorkBook,
  preferredSheet?: string,
): ParsedSheet => {
  const sheetNames = workbook.SheetNames;

  const orderedCandidates = [preferredSheet, ...PREFERRED_SHEETS, ...sheetNames].filter(
    (name, idx, arr): name is string => Boolean(name) && arr.indexOf(name) === idx,
  );

  let best: ParsedSheet | null = null;

  for (const sheetName of orderedCandidates) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const parsed = parseSheet(sheetName, sheet);
    if (!parsed) continue;

    if (!best) {
      best = parsed;
    } else {
      const currentScore = parsed.headerScore * 1000 + parsed.rows.length;
      const bestScore = best.headerScore * 1000 + best.rows.length;
      if (currentScore > bestScore) {
        best = parsed;
      }
    }

    if (parsed.rows.length > 0 && (sheetName === preferredSheet || PREFERRED_SHEETS.includes(sheetName))) {
      return parsed;
    }
  }

  if (!best) {
    throw new Error('Nao foi possivel identificar uma aba valida na planilha.');
  }

  return best;
};

const extractMonthKeys = (rows: Array<Record<string, unknown>>, metadataMonthKeys?: string[]): string[] => {
  const keys = new Set<string>();

  if (Array.isArray(metadataMonthKeys)) {
    metadataMonthKeys
      .filter((key): key is string => typeof key === 'string')
      .forEach((key) => {
        if (isMonthKey(key)) {
          keys.add(normalizeMonthKey(key));
        }
      });
  }

  rows.forEach((row) => {
    Object.keys(row).forEach((rawKey) => {
      const key = rawKey.trim();
      if (isMonthKey(key)) {
        keys.add(normalizeMonthKey(key));
        return;
      }

      const monthKey = toMonthKey(key);
      if (monthKey) {
        keys.add(monthKey);
      }
    });
  });

  return Array.from(keys).sort();
};

export const mergeDashboardData = (currentData: any, newData: any): any => {
  // If current data is empty/invalid, just return new data
  if (!currentData || !Array.isArray(currentData.raw_data_for_filters)) {
    return newData;
  }

  const currentRows = currentData.raw_data_for_filters as Array<Record<string, any>>;
  const newRows = newData.raw_data_for_filters as Array<Record<string, any>>;

  // Index existing rows by PI for O(1) lookup
  const currentMap = new Map<string, Record<string, any>>();
  // Also index by Description/UGR as fallback? No, user emphasized PI.
  // But let's also use a composite key for reliability if PI is missing.

  currentRows.forEach(row => {
    // Normalize PI
    const pi = normalizeToken(row.PI || row.PI_2025);
    if (pi) {
      currentMap.set(pi, row);
    }
    // TODO: Secondary index?
  });

  const mergedRows: Array<Record<string, any>> = [];
  const processedPIs = new Set<string>();

  // Process new rows (Upsert)
  newRows.forEach(newRow => {
    const pi = normalizeToken(newRow.PI || newRow.PI_2025);

    if (pi && currentMap.has(pi)) {
      // MERGE STRATEGY:
      // 1. We assume 'newRow' has the latest Execution/Financial data.
      // 2. We assume 'oldRow' might have better Metadata (Description, UGR) if 'newRow' is sparse.
      const oldRow = currentMap.get(pi)!;

      const mergedRow = { ...oldRow, ...newRow };

      // Preserve "Fixed" variables from Old Row if New Row is empty
      // Fixed: Cadastro, Vigencia e Contrato
      const fixedFields = [
        'Despesa',
        'UGR',
        'CNPJ',
        'Processo',
        'nº  Contrato',
        'Fonte',
        'Status_Contrato',
        'Data_Vigencia_Fim',
        'Situacao_Prorrogacao',
      ];

      fixedFields.forEach(field => {
        // If new row has empty/null value for this field, revert to old row value
        if (isNullishLike(newRow[field]) && !isNullishLike(oldRow[field])) {
          mergedRow[field] = oldRow[field];
        }
      });

      mergedRows.push(mergedRow);
      processedPIs.add(pi);
    } else {
      // New row (Insert)
      mergedRows.push(newRow);
      if (pi) processedPIs.add(pi);
    }
  });

  // Preserve existing rows that were NOT in the new dataset?
  // User: "if try to update with another spreadsheet... procure atualizar por uma variavel de chave primaria".
  // This implies partial update. If I upload a sheet with 10 rows, I probably want to update those 10, not delete the other 1000.
  // SO: We must keep existing rows that were not touched.
  currentRows.forEach(oldRow => {
    const pi = normalizeToken(oldRow.PI || oldRow.PI_2025);
    // If PI is missing, we can't reliably match, so we might duplicate or keep? 
    // Let's keep distinct rows.
    if (!pi || !processedPIs.has(pi)) {
      mergedRows.push(oldRow);
    }
  });

  // Now we have the merged Full Set of Rows.
  // We need to re-normalize/re-calculate aggregates.
  // We can reuse 'normalizeDashboardData' but pass these rows as 'source'.

  // Merge Metadata (Combine month keys from both)
  const allMonthKeys = new Set<string>([
    ...(currentData.metadata?.month_keys || []),
    ...(newData.metadata?.month_keys || [])
  ]);

  return normalizeDashboardData({
    raw_data_for_filters: mergedRows,
    metadata: {
      ...currentData.metadata,
      ...newData.metadata, // Prefer new metadata (filenames, dates)
      month_keys: Array.from(allMonthKeys).sort(),
      updated_at: dayjs().toISOString() // Always update timestamp
    }
  });
};

export const normalizeDashboardData = (payload: any): any => {
  const sourceRows = Array.isArray(payload?.raw_data_for_filters)
    ? (payload.raw_data_for_filters as Array<Record<string, unknown>>)
    : [];

  const metadataMonthKeys = Array.isArray(payload?.metadata?.month_keys)
    ? payload.metadata.month_keys
    : undefined;

  const monthKeys = extractMonthKeys(sourceRows, metadataMonthKeys);
  const rows = sourceRows
    .map((row) => coerceCanonicalRow(row, monthKeys, payload?.metadata?.reference_year))
    .filter((row) => !shouldDiscardRow(row, monthKeys))
    .map((row) => normalizeNumericFields(row));

  const normalizedMonthKeys =
    monthKeys.length > 0 ? monthKeys : extractMonthKeys(rows as Array<Record<string, unknown>>);

  const ugrAnalysis = buildUgrAnalysis(rows);
  const computedKpis = buildKpis(rows);
  const monthlyConsumption = buildMonthlyConsumption(rows, normalizedMonthKeys);
  const { expiringContracts, expiredContracts } = buildContractStatusLists(rows);

  const referenceYear = detectReferenceYear(
    normalizedMonthKeys,
    payload?.metadata?.reference_year ?? payload?.reference_year ?? null,
  );

  return {
    ...payload,
    raw_data_for_filters: rows,
    ugr_analysis: ugrAnalysis,
    monthly_consumption: monthlyConsumption,
    expiring_contracts_list: expiringContracts,
    expired_contracts_list: expiredContracts,
    kpis: {
      ...(payload?.kpis || {}),
      ...computedKpis,
    },
    metadata: {
      ...(payload?.metadata || {}),
      month_keys: normalizedMonthKeys,
      reference_year: referenceYear,
      updated_at: payload?.metadata?.updated_at || dayjs().toISOString(),
    } satisfies BudgetMetadata,
  };
};

export const parseDashboardExcel = (
  buffer: Buffer,
  options?: {
    fileName?: string;
    preferredSheet?: string;
  },
): any => {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    raw: true,
  });

  const selectedSheet = pickSheet(workbook, options?.preferredSheet);

  const normalized = normalizeDashboardData({
    raw_data_for_filters: selectedSheet.rows,
    metadata: {
      source_file_name: options?.fileName,
      source_sheet: selectedSheet.sheetName,
      workbook_sheets: workbook.SheetNames,
      month_keys: selectedSheet.monthKeys,
      reference_year: detectReferenceYear(selectedSheet.monthKeys, selectedSheet.referenceYear),
      updated_at: dayjs().toISOString(),
    } satisfies BudgetMetadata,
  });

  return normalized;
};
