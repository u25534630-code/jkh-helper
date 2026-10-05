import { describe, expect, it } from 'vitest';
import {
  buildMeterComparison,
  buildMonthChecklist,
  buildStructuredBillDocument,
  calculateConsumption,
  buildMeterState,
  calculateExpectedServiceCharge,
  inferManagementCompany,
  parseVoiceCommand,
  resolveOfficialTariffRate,
  type BillDocument,
  type Meter,
  type MeterRecord,
} from './logic';

describe('calculateConsumption', () => {
  it('returns the difference when values are valid', () => {
    expect(calculateConsumption(123.45, 120)).toBe(3.45);
  });

  it('returns null when current reading is lower than previous', () => {
    expect(calculateConsumption(120, 123.45)).toBeNull();
  });

  it('returns null when values are missing', () => {
    expect(calculateConsumption(null, 120)).toBeNull();
  });
});

describe('buildMeterState', () => {
  it('uses the latest confirmed value for each meter', () => {
    const meters: Meter[] = [
      {
        id: 'kitchen-cold',
        label: 'Холодная вода кухня',
        location: 'Кухня',
        type: 'cold-water',
        unit: 'м³',
        reading: 121.2,
        previousReading: 119.8,
        lastUpdated: '2026-09-01',
      },
    ];

    const records: MeterRecord[] = [
      { id: 'r1', meterId: 'kitchen-cold', value: 120.4, date: '2026-08-01', source: 'manual' },
      { id: 'r2', meterId: 'kitchen-cold', value: 121.2, date: '2026-09-01', source: 'manual' },
    ];

    const result = buildMeterState(meters, records);
    expect(result[0].reading).toBe(121.2);
    expect(result[0].previousReading).toBe(120.4);
  });
});

describe('official tariff logic', () => {
  it('uses the official 2026 water tariff from the company site', () => {
    const rate = resolveOfficialTariffRate('Водоснабжение', '2026-06');
    expect(rate?.rate2026_01).toBe(52.63);
  });

  it('calculates the expected charge using the official tariff', () => {
    const expected = calculateExpectedServiceCharge('Водоотведение', 12, '2026-06');
    expect(expected.expected).toBe(415.8);
    expect(expected.rate).toBe(34.65);
  });
});

describe('management company detection', () => {
  it('recognizes the company by address when the property is in Yekaterinburg', () => {
    const company = inferManagementCompany('Екатеринбург, ул. Ленина, 10');
    expect(company?.name).toBe('ООО УК «Верх-Исетская»');
    expect(company?.tariffPageUrl).toContain('tarify');
    expect(company?.normsPageUrl).toContain('normativy');
  });

  it('returns null for an incomplete or unknown address', () => {
    expect(inferManagementCompany('')).toBeNull();
  });
});

describe('buildMeterComparison', () => {
  it('marks a meter as matching when the consumption is close to the bill line', () => {
    const meters: Meter[] = [
      {
        id: 'kitchen-cold',
        label: 'Холодная вода кухня',
        location: 'Кухня',
        type: 'cold-water',
        unit: 'м³',
        reading: 121.2,
        previousReading: 119.8,
        lastUpdated: '2026-09-01',
      },
    ];

    const bills: BillDocument[] = [
      {
        id: 'bill-1',
        provider: 'УК «Дом»',
        period: '2026-09',
        total: '123 ₽',
        rows: [{ id: 'r1', label: 'Холодная вода', value: 1.4, unit: 'м³', source: 'ocr', status: 'needs-check' }],
      },
    ];

    const result = buildMeterComparison(meters, bills);
    expect(result[0].status).toBe('match');
    expect(result[0].diff).toBe(0);
  });
});

describe('buildMonthChecklist', () => {
  it('collects the items that need attention for the selected month', () => {
    const meters: Meter[] = [
      {
        id: 'kitchen-cold',
        label: 'Холодная вода кухня',
        location: 'Кухня',
        type: 'cold-water',
        unit: 'м³',
        reading: 121.2,
        previousReading: 119.8,
        lastUpdated: '2026-09-01',
      },
    ];

    const bills: BillDocument[] = [
      {
        id: 'bill-1',
        provider: 'УК «Дом»',
        period: '2026-09',
        total: '123 ₽',
        rows: [{ id: 'r1', label: 'Холодная вода', value: 1.8, unit: 'м³', source: 'ocr', status: 'needs-check' }],
      },
    ];

    const result = buildMonthChecklist(meters, bills);
    expect(result[0].label).toBe('Холодная вода кухня');
    expect(result[0].severity).toBe('warning');
  });
});

describe('parseVoiceCommand', () => {
  it('detects copy summary command', () => {
    expect(parseVoiceCommand('скопируй сводку', [])).toMatchObject({ kind: 'copy-summary' });
  });

  it('detects export command', () => {
    expect(parseVoiceCommand('экспортируй txt', [])).toMatchObject({ kind: 'export-report' });
  });

  it('detects month switch command', () => {
    expect(parseVoiceCommand('выбери месяц 2026-10', [])).toMatchObject({ kind: 'set-month', month: '2026-10' });
  });

  it('detects month by name', () => {
    expect(parseVoiceCommand('выбери октябрь', [])).toMatchObject({ kind: 'set-month', month: '2026-10' });
  });

  it('detects mic toggle command', () => {
    expect(parseVoiceCommand('включи микрофон', [])).toMatchObject({ kind: 'toggle-listening' });
  });

  it('detects saving instruction for a meter', () => {
    expect(parseVoiceCommand('сохрани показание холодная вода кухня 118.4', ['Холодная вода кухня'])).toMatchObject({
      kind: 'save-meter',
      meterLabel: 'Холодная вода кухня',
      value: 118.4,
    });
  });
});

describe('buildStructuredBillDocument', () => {
  it('keeps all fields separated and preserves source metadata', () => {
    const bill: BillDocument = {
      id: 'bill-1',
      provider: 'УК «Дом»',
      period: '2026-09',
      total: '3698.40 ₽',
      rows: [
        { id: 'row-1', label: 'Холодная вода', value: 5.42, unit: 'м³', source: 'ocr', status: 'needs-check' },
      ],
    };

    const result = buildStructuredBillDocument(bill, {
      fileName: 'kvitancia-september.pdf',
      localOnly: true,
      pages: ['page-1'],
    });

    expect(result.calculationMonth.value).toBe('2026-09');
    expect(result.provider.value).toBe('УК «Дом»');
    expect(result.totalDue.value).toBe(3698.4);
    expect(result.services[0].volume.value).toBe(5.42);
    expect(result.services[0].source.page).toBe('page-1');
    expect(result.sourceDocument.storage).toBe('local-only');
  });

  it('keeps empty values distinct from zero', () => {
    const bill: BillDocument = {
      id: 'bill-empty',
      provider: 'УК «Дом»',
      period: '2026-09',
      total: '—',
      rows: [{ id: 'row-null', label: 'Пени', value: null, unit: '₽', source: 'manual', status: 'needs-check' }],
    };

    const result = buildStructuredBillDocument(bill, { fileName: 'empty.pdf', localOnly: true, pages: ['page-2'] });
    expect(result.services[0].currentCharge.value).toBeNull();
    expect(result.services[0].currentCharge.isEmpty).toBe(true);
    expect(result.services[0].currentCharge.raw).toBeNull();
  });
});
