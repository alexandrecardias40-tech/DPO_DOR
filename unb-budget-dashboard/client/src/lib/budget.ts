const MONTH_KEY_REGEX = /^\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2})?$/;

const normalizeMonthKey = (value: string): string => {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return value;
  return `${match[1]} 00:00:00`;
};

export const getMonthKeysFromRows = (rows: any[]): string[] => {
  const keys = new Set<string>();

  rows.forEach((row) => {
    if (!row || typeof row !== 'object') return;

    Object.keys(row).forEach((key) => {
      if (MONTH_KEY_REGEX.test(key)) {
        keys.add(normalizeMonthKey(key));
      }
    });
  });

  return Array.from(keys).sort();
};

export const getReferenceYearFromRows = (rows: any[]): number | null => {
  const monthKeys = getMonthKeysFromRows(rows);
  if (monthKeys.length === 0) return null;
  const year = Number(monthKeys[0].slice(0, 4));
  return Number.isFinite(year) ? year : null;
};

export const getPiValue = (row: any): string => {
  if (!row || typeof row !== 'object') return '';

  const directPi = row.PI || row.pi || row.PI_2025;
  if (directPi) return String(directPi);

  const dynamicPiKey = Object.keys(row).find((key) => /^PI_20\d{2}$/i.test(key));
  if (dynamicPiKey && row[dynamicPiKey]) {
    return String(row[dynamicPiKey]);
  }

  return '';
};

export const formatMonthShort = (monthKey: string): string => {
  const isoDate = monthKey.slice(0, 10);
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;

  const month = date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return month.charAt(0).toUpperCase() + month.slice(1);
};
