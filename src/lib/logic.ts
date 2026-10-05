export type MeterType = 'cold-water' | 'hot-water' | 'electric';

export type Meter = {
  id: string;
  label: string;
  location: string;
  type: MeterType;
  unit: string;
  reading: number | null;
  previousReading: number | null;
  lastUpdated: string;
};

export type MeterRecord = {
  id: string;
  meterId: string;
  value: number;
  date: string;
  source: 'manual' | 'photo';
};

export type BillRowStatus = 'confirmed' | 'needs-check' | 'issue';

export type BillRow = {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  source: 'manual' | 'ocr' | 'photo';
  status: BillRowStatus;
};

export type BillDocument = {
  id: string;
  provider: string;
  period: string;
  total: string;
  rows: BillRow[];
};

export type MeterComparisonStatus = 'match' | 'warning' | 'issue';

export type MeterComparison = {
  meterId: string;
  meterLabel: string;
  meterType: MeterType;
  meterConsumption: number | null;
  billValue: number | null;
  diff: number | null;
  status: MeterComparisonStatus;
  note: string;
};

export type MonthChecklistItem = {
  id: string;
  label: string;
  severity: 'warning' | 'issue';
  message: string;
};

export type FieldStatus = 'verified' | 'needs-check' | 'needs-data' | 'mismatch';

export type SourceMethod = 'manual' | 'ocr' | 'photo' | 'document';

export type SourceRef = {
  page: string;
  method: SourceMethod;
  status: FieldStatus;
  note?: string;
};

export type StructuredField<T> = {
  raw: string | null;
  value: T | null;
  unit?: string;
  source: SourceRef;
  isEmpty: boolean;
};

export type StructuredService = {
  service: StructuredField<string>;
  unit: StructuredField<string>;
  volume: StructuredField<number | null>;
  tariff: StructuredField<number | null>;
  currentCharge: StructuredField<number | null>;
  coefficient: StructuredField<number | null>;
  recalculation: StructuredField<number | null>;
  reduction: StructuredField<number | null>;
  debtOrOverpayment: StructuredField<number | null>;
  payments: StructuredField<number | null>;
  penalties: StructuredField<number | null>;
  totalDue: StructuredField<number | null>;
  source: SourceRef;
};

export type StructuredBillDocument = {
  documentId: string;
  calculationMonth: StructuredField<string>;
  provider: StructuredField<string>;
  recipientId: StructuredField<string | null>;
  services: StructuredService[];
  totalDue: StructuredField<number | null>;
  sourceDocument: {
    fileName: string | null;
    storage: 'local-only';
    pages: string[];
  };
};

function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).replace(/\s+/g, '').replace(',', '.');
  if (normalized === '—' || normalized === '-') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function makeField<T>(value: T, unit: string | undefined, source: SourceRef, raw: string | null = null): StructuredField<T> {
  return {
    raw: raw ?? (typeof value === 'string' ? value : value === null ? null : String(value)),
    value,
    unit,
    source,
    isEmpty: value === null || value === undefined || value === '',
  };
}

export function buildStructuredBillDocument(
  bill: BillDocument,
  options: { fileName?: string; localOnly: boolean; pages: string[] },
): StructuredBillDocument {
  const sourceRef: SourceRef = {
    page: options.pages[0] ?? 'page-1',
    method: 'ocr',
    status: 'needs-check',
    note: 'Локальная структура данных; проверки по README требуют отдельной верификации.',
  };

  const monthValue = makeField<string>(bill.period, undefined, sourceRef, bill.period);
  const providerValue = makeField<string>(bill.provider, undefined, sourceRef, bill.provider);
  const recipientId = makeField<string | null>(null, undefined, sourceRef, null);

  const services: StructuredService[] = bill.rows.map((row) => {
    const parsedValue = toNumberOrNull(row.value);
    const totalDue = makeField<number | null>(parsedValue, row.unit, sourceRef, row.value === null ? null : String(row.value));

    return {
      service: makeField<string>(row.label, row.unit, sourceRef, row.label),
      unit: makeField<string>(row.unit, row.unit, sourceRef, row.unit),
      volume: makeField<number | null>(parsedValue, row.unit, sourceRef, row.value === null ? null : String(row.value)),
      tariff: makeField<number | null>(null, row.unit, sourceRef, null),
      currentCharge: makeField<number | null>(parsedValue, row.unit, sourceRef, row.value === null ? null : String(row.value)),
      coefficient: makeField<number | null>(null, undefined, sourceRef, null),
      recalculation: makeField<number | null>(null, undefined, sourceRef, null),
      reduction: makeField<number | null>(null, undefined, sourceRef, null),
      debtOrOverpayment: makeField<number | null>(null, undefined, sourceRef, null),
      payments: makeField<number | null>(null, undefined, sourceRef, null),
      penalties: makeField<number | null>(null, undefined, sourceRef, null),
      totalDue,
      source: sourceRef,
    };
  });

  const totalNumeric = toNumberOrNull(bill.total?.replace(/[^0-9,.-]/g, ''));

  return {
    documentId: bill.id,
    calculationMonth: monthValue,
    provider: providerValue,
    recipientId,
    services,
    totalDue: makeField<number | null>(totalNumeric, '₽', sourceRef, bill.total ?? null),
    sourceDocument: {
      fileName: options.fileName ?? null,
      storage: 'local-only',
      pages: options.pages,
    },
  };
}

export type OfficialServiceTariff = {
  provider: string;
  service: string;
  unit: string;
  rate2026_01: number;
  rate2026_10: number | null;
  source: string;
};

export type ManagementCompanyProfile = {
  id: string;
  name: string;
  region: string;
  tariffPageUrl: string;
  normsPageUrl: string;
  searchTerms: string[];
};

export const DEFAULT_MANAGEMENT_COMPANIES: ManagementCompanyProfile[] = [
  {
    id: 'uk-verh-isetskaya',
    name: 'ООО УК «Верх-Исетская»',
    region: 'Екатеринбург',
    tariffPageUrl: 'https://www.ukviz.ru/normativnye-akty/tarify/tarify.html',
    normsPageUrl: 'https://www.ukviz.ru/normativnye-akty/normativy',
    searchTerms: ['верх-исетская', 'верх исетская', 'верхисетская', 'укт', 'екатеринбург'],
  },
  {
    id: 'uk-city',
    name: 'ООО "УК ..."',
    region: 'Регион уточняется',
    tariffPageUrl: '',
    normsPageUrl: '',
    searchTerms: [],
  },
];

export function inferManagementCompany(address: string): ManagementCompanyProfile | null {
  const normalized = (address || '').trim().toLowerCase();
  if (!normalized) return null;

  for (const company of DEFAULT_MANAGEMENT_COMPANIES) {
    if (company.id === 'uk-city') continue;
    const match = company.searchTerms.some((term) => normalized.includes(term.toLowerCase()));
    if (match) return company;
  }

  if (normalized.includes('екатеринбург') || normalized.includes('верх-исетский') || normalized.includes('верх исетский')) {
    return DEFAULT_MANAGEMENT_COMPANIES[0];
  }

  return null;
}

export const UK_VERH_ISET_2026_TARIFFS: OfficialServiceTariff[] = [
  {
    provider: 'Екатеринбургское муниципальное унитарное предприятие водопроводно-канализационного хозяйства (МУП "Водоканал")',
    service: 'Водоотведение',
    unit: 'м3',
    rate2026_01: 34.65,
    rate2026_10: 36.83,
    source: 'Постановление РЭК Свердловской области от 09.12.2021 № 208-ПК (в ред. Постановления РЭК Свердловской области от 15.12.2025 № 294-ПК)',
  },
  {
    provider: 'Екатеринбургское муниципальное унитарное предприятие водопроводно-канализационного хозяйства (МУП "Водоканал")',
    service: 'Водоснабжение',
    unit: 'м3',
    rate2026_01: 52.63,
    rate2026_10: 59.41,
    source: 'Постановление РЭК Свердловской области от 09.12.2021 № 208-ПК (в ред. Постановления РЭК Свердловской области от 15.12.2025 № 294-ПК)',
  },
  {
    provider: 'Публичное акционерное общество "Т Плюс"',
    service: 'ГВС (компонент на тепловую энергию)',
    unit: 'Гкал',
    rate2026_01: 2899.98,
    rate2026_10: 3274.08,
    source: 'Постановление РЭК Свердловской области от 14.11.2025 №172-ПК / Приказ филиала «Свердловский» ПАО «Т Плюс» от 26.12.2025 № 453',
  },
  {
    provider: 'Публичное акционерное общество "Т Плюс"',
    service: 'ГВС (компонент на теплоноситель)',
    unit: 'м3',
    rate2026_01: 49.26,
    rate2026_10: 54.62,
    source: 'Постановление РЭК Свердловской области от 14.11.2025 №172-ПК / Приказ филиала «Свердловский» ПАО «Т Плюс» от 26.12.2025 № 453',
  },
  {
    provider: 'Публичное акционерное общество "Т Плюс"',
    service: 'Теплоснабжение',
    unit: 'Гкал',
    rate2026_01: 2899.98,
    rate2026_10: 3274.08,
    source: 'Постановление РЭК Свердловской области от 14.11.2025 №172-ПК / Приказ филиала «Свердловский» ПАО «Т Плюс» от 26.12.2025 № 453',
  },
  {
    provider: 'Акционерное общество "ТЭЦ ВИЗа"',
    service: 'Теплоснабжение',
    unit: 'Гкал',
    rate2026_01: 1333.81,
    rate2026_10: 1505.6,
    source: 'Постановление РЭК Свердловской области от 09.12.2021 № 205-ПК (в ред. Постановления РЭК Свердловской области от 15.12.2025 № 203-ПК)',
  },
  {
    provider: 'Акционерное общество "ТЭЦ ВИЗа"',
    service: 'ГВС (компонент на тепловую энергию)',
    unit: 'Гкал',
    rate2026_01: 1333.81,
    rate2026_10: 1505.6,
    source: 'Постановление РЭК Свердловской области от 13.12.2023 № 229-ПК (в ред. Постановления РЭК Свердловской области от 18.12.2025 № 306-ПК)',
  },
  {
    provider: 'АО "Екатеринбурггаз"',
    service: 'Природный газ',
    unit: 'м3',
    rate2026_01: 7.55,
    rate2026_10: null,
    source: 'Постановление РЭК Свердловской области от 19.06.2025 № 75-ПК (в ред. Постановления РЭК Свердловской области от 29.12.2025 № 338-ПК)',
  },
  {
    provider: 'АО "Екатеринбурггаз"',
    service: 'Электроэнергия (одноставочный, газ.плиты)',
    unit: 'кВтч',
    rate2026_01: 6.43,
    rate2026_10: 7.15,
    source: 'Постановление РЭК Свердловской области от 29.12.2025 г. № 327-ПК',
  },
  {
    provider: 'АО "Екатеринбурггаз"',
    service: 'Электроэнергия (дневная зона)',
    unit: 'кВтч',
    rate2026_01: 7.67,
    rate2026_10: 8.45,
    source: 'Постановление РЭК Свердловской области от 29.12.2025 г. № 327-ПК',
  },
  {
    provider: 'АО "Екатеринбурггаз"',
    service: 'Электроэнергия (ночная зона)',
    unit: 'кВтч',
    rate2026_01: 3.86,
    rate2026_10: 4.29,
    source: 'Постановление РЭК Свердловской области от 29.12.2025 г. № 327-ПК',
  },
  {
    provider: 'АО "Екатеринбурггаз"',
    service: 'Электроэнергия (электроплиты, одноставочный)',
    unit: 'кВтч',
    rate2026_01: 4.5,
    rate2026_10: 5.01,
    source: 'Постановление РЭК Свердловской области от 29.12.2025 г. № 327-ПК',
  },
  {
    provider: 'АО "Екатеринбурггаз"',
    service: 'Электроэнергия (электроплиты, дневная зона)',
    unit: 'кВтч',
    rate2026_01: 5.37,
    rate2026_10: 5.92,
    source: 'Постановление РЭК Свердловской области от 29.12.2025 г. № 327-ПК',
  },
  {
    provider: 'АО "Екатеринбурггаз"',
    service: 'Электроэнергия (электроплиты, ночная зона)',
    unit: 'кВтч',
    rate2026_01: 3.0,
    rate2026_10: 3.0,
    source: 'Постановление РЭК Свердловской области от 29.12.2025 г. № 327-ПК',
  },
  {
    provider: 'Екатеринбургское муниципальное унитарное предприятие "Специализированная автобаза"',
    service: 'Обращение с твердыми коммунальными отходами',
    unit: 'куб. м',
    rate2026_01: 789.8,
    rate2026_10: 865.63,
    source: 'Постановление РЭК Свердловской области от 30.08.2023 № 89-ПК (в ред. Постановления РЭК Свердловской области от 18.12.2025 № 323-ПК)',
  },
];

function normalizeServiceKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^а-яёa-z0-9]/g, '')
    .replace(/\s+/g, '');
}

export function resolveOfficialTariffRate(serviceLabel: string, date: string): OfficialServiceTariff | null {
  const targetDate = new Date(`${date}-01T00:00:00`);
  const key = normalizeServiceKey(serviceLabel);

  const candidates = UK_VERH_ISET_2026_TARIFFS.filter((entry) => {
    const serviceKey = normalizeServiceKey(entry.service);
    return serviceKey.includes(key) || key.includes(serviceKey);
  });

  const candidate = candidates[0] ?? null;
  if (!candidate) return null;

  const isAfterOctober = targetDate >= new Date('2026-10-01T00:00:00');
  const selectedRate = isAfterOctober && candidate.rate2026_10 !== null && candidate.rate2026_10 !== undefined
    ? candidate.rate2026_10
    : candidate.rate2026_01;

  return {
    ...candidate,
    rate2026_01: selectedRate,
    rate2026_10: candidate.rate2026_10 ?? null,
  };
}

export function calculateExpectedServiceCharge(serviceLabel: string, quantity: number | null, date: string): {
  expected: number | null;
  rate: number | null;
  unit: string | null;
  source: string | null;
  service: string | null;
} {
  if (quantity === null || Number.isNaN(quantity) || quantity < 0) {
    return { expected: null, rate: null, unit: null, source: null, service: null };
  }

  const tariff = resolveOfficialTariffRate(serviceLabel, date);
  if (!tariff) {
    return { expected: null, rate: null, unit: null, source: null, service: null };
  }

  const targetDate = new Date(`${date}-01T00:00:00`);
  const effectiveRate = targetDate >= new Date('2026-10-01T00:00:00') && tariff.rate2026_10 !== null && tariff.rate2026_10 !== undefined
    ? tariff.rate2026_10
    : tariff.rate2026_01;

  return {
    expected: Number((quantity * effectiveRate).toFixed(2)),
    rate: effectiveRate,
    unit: tariff.unit,
    source: tariff.source,
    service: tariff.service,
  };
}

export function calculateConsumption(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (current < previous) return null;
  return Number((current - previous).toFixed(3));
}

export function buildMeterState(meters: Meter[], records: MeterRecord[]): Meter[] {
  return meters.map((meter) => {
    const latestRecord = records
      .filter((record) => record.meterId === meter.id)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

    const previousRecord = records
      .filter((record) => record.meterId === meter.id)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[1];

    return {
      ...meter,
      reading: latestRecord?.value ?? meter.reading,
      previousReading: previousRecord?.value ?? meter.previousReading,
      lastUpdated: latestRecord?.date ?? meter.lastUpdated,
    };
  });
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^а-яёa-z0-9]/g, '');
}

function extractNumberFromText(value: string): number | null {
  const match = value.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  return Number(match[0].replace(',', '.'));
}

export type VoiceCommand =
  | { kind: 'copy-summary' }
  | { kind: 'export-report' }
  | { kind: 'open-transfer' }
  | { kind: 'open-summary' }
  | { kind: 'add-sample' }
  | { kind: 'upload-document' }
  | { kind: 'toggle-listening' }
  | { kind: 'set-month'; month: string }
  | { kind: 'save-meter'; meterLabel: string; value: number | null }
  | { kind: 'unknown'; raw: string };

const monthNames: Record<string, string> = {
  январь: '01',
  февраль: '02',
  март: '03',
  апрель: '04',
  май: '05',
  июнь: '06',
  июль: '07',
  август: '08',
  сентябрь: '09',
  октябрь: '10',
  ноябрь: '11',
  декабрь: '12',
};

export function parseVoiceCommand(input: string, meterLabels: string[] = []): VoiceCommand {
  const text = input.toLowerCase().replace(/\s+/g, ' ').trim();
  const compactText = normalizeText(input);
  if (!text) return { kind: 'unknown', raw: input };

  if (/(скопируй|копировать|сделай).*(сводку|передачу|текст)/.test(text)) {
    return { kind: 'copy-summary' };
  }

  if (/(экспорт|экспортируй|сохранить txt|сохранить текст)/.test(text)) {
    return { kind: 'export-report' };
  }

  if (/(открой|покажи).*(передачу|сводку|текст)/.test(text)) {
    return { kind: 'open-transfer' };
  }

  if (/(открой|покажи).*(сводка|сводку|месяц)/.test(text)) {
    return { kind: 'open-summary' };
  }

  if (/(включи|вруби|открой).*(микрофон|голос)/.test(text) || /(микрофон|голос).*(включи|вруби|открой)/.test(text)) {
    return { kind: 'toggle-listening' };
  }

  if (/(добавь|создай).*(тестовое показание|тестовое)/.test(text) || /тестовое показание/.test(text)) {
    return { kind: 'add-sample' };
  }

  if (/(загрузи|добавь).*(документ|файл)/.test(text)) {
    return { kind: 'upload-document' };
  }

  const monthMatch = text.match(/(\d{4}-\d{2})/);
  if (monthMatch && /(выбери|установи|открой).*(месяц|период)/.test(text)) {
    return { kind: 'set-month', month: monthMatch[1] };
  }

  const monthNameMatch = Object.entries(monthNames).find(([name]) => text.includes(name));
  if (monthNameMatch && /(выбери|установи|открой|переключи).*(месяц|период|$)/.test(text)) {
    const year = new Date().getFullYear();
    return { kind: 'set-month', month: `${year}-${monthNameMatch[1]}` };
  }

  if (/(сохрани|запиши|обнови).*(показание|значение)/.test(text) || /показание/.test(text)) {
    const matchedMeter = meterLabels.find((label) => {
      const normalizedLabel = normalizeText(label);
      return compactText.includes(normalizedLabel);
    });

    if (matchedMeter) {
      return {
        kind: 'save-meter',
        meterLabel: matchedMeter,
        value: extractNumberFromText(text),
      };
    }
  }

  return { kind: 'unknown', raw: input };
}

function matchesMeterTypeLabel(meterType: MeterType, rowLabel: string): boolean {
  const normalized = normalizeText(rowLabel);
  if (!normalized) return false;

  if (meterType === 'cold-water') {
    return normalized.includes('холод') || normalized.includes('watercold') || normalized.includes('водахолодная');
  }

  if (meterType === 'hot-water') {
    return normalized.includes('горяч') || normalized.includes('waterhot') || normalized.includes('водагорячая');
  }

  return normalized.includes('элект') || normalized.includes('энерг') || normalized.includes('electric');
}

export function buildMeterComparison(meters: Meter[], bills: BillDocument[]): MeterComparison[] {
  return meters.map((meter) => {
    const meterConsumption = calculateConsumption(meter.reading, meter.previousReading);
    const billRows = bills.flatMap((bill) => bill.rows.filter((row) => matchesMeterTypeLabel(meter.type, row.label)));
    const matchedRow = billRows[0] ?? null;
    const billValue = matchedRow?.value ?? null;

    if (meterConsumption === null) {
      return {
        meterId: meter.id,
        meterLabel: meter.label,
        meterType: meter.type,
        meterConsumption: null,
        billValue,
        diff: null,
        status: 'warning',
        note: 'Нет полного набора данных для расчёта расхода.',
      };
    }

    if (billValue === null) {
      return {
        meterId: meter.id,
        meterLabel: meter.label,
        meterType: meter.type,
        meterConsumption,
        billValue: null,
        diff: null,
        status: 'warning',
        note: 'Для этого счётчика нет строки в квитанции.',
      };
    }

    const diff = Number((billValue - meterConsumption).toFixed(3));
    const tolerance = meter.type === 'electric' ? 8 : 0.5;

    let status: MeterComparisonStatus = 'match';
    let note = 'Расход по счётчику и по квитанции совпадают в допустимой норме.';

    if (Math.abs(diff) > tolerance * 3) {
      status = 'issue';
      note = `Есть заметное расхождение: ${Math.abs(diff).toFixed(3)} ${meter.unit}. Следует проверить вручную.`;
    } else if (Math.abs(diff) > tolerance) {
      status = 'warning';
      note = `Расхождение небольшое: ${Math.abs(diff).toFixed(3)} ${meter.unit}. Рекомендуется проверить.`;
    }

    return {
      meterId: meter.id,
      meterLabel: meter.label,
      meterType: meter.type,
      meterConsumption,
      billValue,
      diff,
      status,
      note,
    };
  });
}

export function buildMonthChecklist(meters: Meter[], bills: BillDocument[]): MonthChecklistItem[] {
  const candidateMap = new Map<string, MonthChecklistItem>();

  for (const item of buildMeterComparison(meters, bills)) {
    if (item.status === 'match') continue;
    candidateMap.set(item.meterId, {
      id: item.meterId,
      label: item.meterLabel,
      severity: item.status === 'issue' ? 'issue' : 'warning',
      message: item.note,
    });
  }

  for (const bill of bills) {
    for (const row of bill.rows) {
      if (row.status === 'confirmed') continue;

      const matchedMeter = meters.find((meter) => matchesMeterTypeLabel(meter.type, row.label));
      if (!matchedMeter) continue;

      const existing = candidateMap.get(matchedMeter.id);
      const nextItem: MonthChecklistItem = {
        id: matchedMeter.id,
        label: matchedMeter.label,
        severity: row.status === 'issue' ? 'issue' : 'warning',
        message: row.status === 'issue'
          ? 'Строка квитанции отмечена как спорная.'
          : 'Строка квитанции требует ручной проверки.',
      };

      if (!existing || existing.severity === 'warning' && nextItem.severity === 'issue') {
        candidateMap.set(matchedMeter.id, nextItem);
      }
    }
  }

  return Array.from(candidateMap.values());
}
