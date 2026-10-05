import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
import {
  buildMeterComparison,
  buildMonthChecklist,
  buildStructuredBillDocument,
  calculateConsumption,
  inferManagementCompany,
  parseVoiceCommand,
  type BillDocument,
  type Meter,
  type MeterRecord,
} from './lib/logic';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const emptyMeterTemplate: Meter[] = [
  { id: 'cold-water-kitchen', label: 'Холодная вода (кухня)', location: 'Кухня', type: 'cold-water', unit: 'м³', reading: null, previousReading: null, lastUpdated: '' },
  { id: 'cold-water-bath', label: 'Холодная вода (ванная)', location: 'Ванная', type: 'cold-water', unit: 'м³', reading: null, previousReading: null, lastUpdated: '' },
  { id: 'hot-water-kitchen', label: 'Горячая вода (кухня)', location: 'Кухня', type: 'hot-water', unit: 'м³', reading: null, previousReading: null, lastUpdated: '' },
  { id: 'hot-water-bath', label: 'Горячая вода (ванная)', location: 'Ванная', type: 'hot-water', unit: 'м³', reading: null, previousReading: null, lastUpdated: '' },
  { id: 'electricity-main', label: 'Электричество', location: 'Общий счётчик', type: 'electric', unit: 'кВт·ч', reading: null, previousReading: null, lastUpdated: '' },
];

const initialMeters: Meter[] = emptyMeterTemplate;

const meterNumbers: Record<string, string> = {};

const initialRecords: MeterRecord[] = [];

const emptyBillTemplate: BillDocument[] = [
  {
    id: 'bill-template',
    provider: '',
    period: '',
    total: '',
    rows: [
      { id: 'svc-cold-water', label: 'Холодная вода', value: null, unit: 'м³', source: 'ocr', status: 'needs-check' },
      { id: 'svc-hot-water', label: 'Горячая вода', value: null, unit: 'м³', source: 'ocr', status: 'needs-check' },
      { id: 'svc-electricity', label: 'Электроэнергия', value: null, unit: 'кВт·ч', source: 'ocr', status: 'needs-check' },
      { id: 'svc-total', label: 'Итого по квитанции', value: null, unit: '₽', source: 'manual', status: 'needs-check' },
    ],
  },
];

const initialBills: BillDocument[] = emptyBillTemplate;

type PropertyProfile = {
  id: string;
  address: string;
  managementCompany: string;
  region: string;
  tariffsUrl: string;
  normsUrl: string;
  notes: string;
};

const createPropertyProfile = (id: string, address = ''): PropertyProfile => ({
  id,
  address,
  managementCompany: '',
  region: 'Екатеринбург',
  tariffsUrl: '',
  normsUrl: '',
  notes: 'Адрес ещё не подтверждён; УК определяется автоматически по признакам адреса.',
});

const initialProperties: PropertyProfile[] = [
  createPropertyProfile('property-1'),
];

type LocalDocument = {
  id: string;
  name: string;
  type: 'pdf' | 'image';
  sizeLabel: string;
  uploadedAt: string;
};

type ConfirmationEntry = {
  id: string;
  month: string;
  status: 'confirmed' | 'warning' | 'issue';
  summary: string;
  updatedAt: string;
};

const initialHistory: ConfirmationEntry[] = [];

const normalizeBillNumber = (value: string): number | null => {
  if (!value) return null;
  const normalized = value
    .replace(/[^0-9,.-]/g, '')
    .replace(/,/g, '.')
    .replace(/\s+/g, '');

  if (!normalized || normalized === '-' || normalized === '.') return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeMonthValue = (value: string): string => {
  const match = value.match(/(\d{4})\D*(\d{1,2})|(?:\D*)(\d{1,2})\D*(\d{4})/);
  if (!match) return '';

  const year = match[1] ?? match[4];
  const month = match[2] ?? match[3];
  if (!year || !month) return '';

  const monthNumber = String(Number(month)).padStart(2, '0');
  return `${year}-${monthNumber}`;
};

const buildServiceRowsFromText = (text: string): BillDocument['rows'] => {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const serviceDefinitions = [
    { id: 'svc-cold-water', label: 'Холодная вода', keywords: ['холодная вода', 'вода холодная', 'водоснабжение холодная'], unit: 'м³' },
    { id: 'svc-hot-water', label: 'Горячая вода', keywords: ['горячая вода', 'вода горячая', 'водоснабжение горячая'], unit: 'м³' },
    { id: 'svc-electricity', label: 'Электроэнергия', keywords: ['электроэнергия', 'электричество', 'энергия'], unit: 'кВт·ч' },
    { id: 'svc-total', label: 'Итого по квитанции', keywords: ['итого', 'итого по квитанции', 'к оплате'], unit: '₽' },
  ];

  const rows: BillDocument['rows'] = serviceDefinitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    value: null,
    unit: definition.unit,
    source: 'ocr' as const,
    status: 'needs-check' as const,
  }));

  lines.forEach((line, index) => {
    const lowered = line.toLowerCase();
    for (const definition of serviceDefinitions) {
      const matchedKeyword = definition.keywords.find((keyword) => lowered.includes(keyword));
      if (!matchedKeyword) continue;

      const window = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 4)).join(' ');
      const sample = window.replace(/\s+/g, ' ');
      const numbers = [...sample.matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => match[0]);
      const value = numbers.length > 0 ? normalizeBillNumber(numbers[numbers.length - 1]) : null;

      const row = rows.find((item) => item.id === definition.id);
      if (row && value !== null) {
        row.value = value;
        row.label = definition.label;
        row.unit = definition.unit;
        row.source = 'ocr';
      }
    }
  });

  return rows;
};

const extractBillDataFromText = (text: string): Partial<BillDocument> => {
  const normalized = text.replace(/\u00a0/g, ' ');
  const provider = (() => {
    const candidates = ['ПАО', 'Водоканал', 'РКЦ', 'Расчетный центр', 'Единый', 'ЖКХ', 'УК', 'Мосэнергосбыт', 'Энергосбыт'];
    const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);

    for (const line of lines) {
      const lowered = line.toLowerCase();
      if (candidates.some((candidate) => lowered.includes(candidate.toLowerCase()))) {
        return line;
      }
    }

    return '';
  })();

  const monthMatch = normalized.match(/(\d{4}[\-./ ]\d{1,2}|\d{1,2}[\-./ ]\d{4}|\d{1,2}\.\d{4})/);
  const period = monthMatch ? normalizeMonthValue(monthMatch[0]) : '';

  const totalMatch = normalized.match(/(\d{1,3}(?:[\s.,]\d{3})*(?:[.,]\d{1,2})?)\s*(?:₽|руб|руб\.|рублей|rur)/i);
  const total = totalMatch ? totalMatch[1].replace(/\s+/g, '').replace(',', '.') : '';

  return {
    provider,
    period,
    total: total ? `${total} ₽` : '',
    rows: buildServiceRowsFromText(normalized),
  };
};

const renderPdfPageToImage = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.8 });

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Не удалось создать canvas для PDF');
  }

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas.toDataURL('image/png');
};

const readDocumentText = async (file: File): Promise<string> => {
  if (file.type.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')) {
    const imageDataUrl = await renderPdfPageToImage(file);
    const result = await Tesseract.recognize(imageDataUrl, 'rus+eng', {
      logger: () => undefined,
    });
    return result.data.text;
  }

  const result = await Tesseract.recognize(file, 'rus+eng', {
    logger: () => undefined,
  });

  return result.data.text;
};

const formatStructuredValue = (value: number | string | null | undefined, fallback = 'Нет данных') => {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
};

const countMissingStructuredFields = (structuredBills: ReturnType<typeof buildStructuredBillDocument>[]) =>
  structuredBills.reduce((total, bill) => {
    return total + bill.services.reduce((serviceTotal, service) => {
      const fields = [
        service.service.value,
        service.unit.value,
        service.volume.value,
        service.tariff.value,
        service.currentCharge.value,
        service.coefficient.value,
        service.recalculation.value,
        service.reduction.value,
        service.debtOrOverpayment.value,
        service.payments.value,
        service.penalties.value,
        service.totalDue.value,
      ];

      return serviceTotal + fields.filter((field) => field === null || field === undefined || field === '').length;
    }, 0);
  }, 0);

function App() {
  const [meters, setMeters] = useState<Meter[]>(() => {
    const saved = localStorage.getItem('jkh-helper-meters');
    return saved ? JSON.parse(saved) : initialMeters;
  });
  const [records, setRecords] = useState<MeterRecord[]>(() => {
    const saved = localStorage.getItem('jkh-helper-records');
    return saved ? JSON.parse(saved) : initialRecords;
  });
  const [bills, setBills] = useState<BillDocument[]>(() => {
    const saved = localStorage.getItem('jkh-helper-bills');
    return saved ? JSON.parse(saved) : initialBills;
  });
  const [documents, setDocuments] = useState<LocalDocument[]>(() => {
    const saved = localStorage.getItem('jkh-helper-documents');
    return saved ? JSON.parse(saved) : [];
  });
  const [confirmationHistory, setConfirmationHistory] = useState<ConfirmationEntry[]>(() => {
    const saved = localStorage.getItem('jkh-helper-confirmation-history');
    return saved ? JSON.parse(saved) : initialHistory;
  });
  const [properties, setProperties] = useState<PropertyProfile[]>(() => {
    const saved = localStorage.getItem('jkh-helper-properties');
    return saved ? JSON.parse(saved) : initialProperties;
  });
  const [selectedPropertyId, setSelectedPropertyId] = useState(() => {
    const saved = localStorage.getItem('jkh-helper-selected-property');
    return saved ?? 'property-1';
  });
  const [selectedMonth, setSelectedMonth] = useState('');
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [transferCopied, setTransferCopied] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('Голосовой ввод выключен');
  const [isListening, setIsListening] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<any>(null);

  const currentBill = bills[0] ?? initialBills[0];

  const managementCompanyFields = useMemo(() => {
    const parsedRows = currentBill.rows
      .filter((row) => row.id !== 'svc-total')
      .map((row) => ({ ...row, numericValue: row.value === null || Number.isNaN(row.value) ? null : Number(row.value) }))
      .filter((row) => row.numericValue !== null);

    const serviceCharge = parsedRows.reduce((sum, row) => sum + (row.numericValue ?? 0), 0);
    const totalValue = currentBill.total ? Number.parseFloat(currentBill.total.replace(/[^0-9,.-]/g, '').replace(',', '.')) : null;
    const effectiveCharge = serviceCharge > 0 ? serviceCharge : totalValue;
    const finalTotal = totalValue !== null ? totalValue : (serviceCharge > 0 ? serviceCharge : null);

    const formatAmount = (value: number | null) => value === null || Number.isNaN(value) ? '—' : `${value.toFixed(2)} ₽`;

    return [
      { id: 'charge', label: 'Начислено', value: formatAmount(effectiveCharge) },
      { id: 'recalculation', label: 'Перерасчёт', value: '—' },
      { id: 'payment', label: 'Оплата', value: '—' },
      { id: 'debt', label: 'Долг / переплата', value: '—' },
      { id: 'final-total', label: 'Итого по УК', value: formatAmount(finalTotal) },
    ];
  }, [currentBill.rows, currentBill.total]);

  const managementCompanyDetails = useMemo(() => {
    return currentBill.rows
      .filter((row) => row.id !== 'svc-total')
      .map((row) => ({
        ...row,
        numericValue: row.value === null || Number.isNaN(row.value) ? null : Number(row.value),
      }))
      .filter((row) => row.label.trim() || row.numericValue !== null);
  }, [currentBill.rows]);

  const unresolvedBillFields = useMemo(() => {
    const items: Array<{ id: string; label: string; reason: string; confidence: 'low' | 'medium' | 'high'; }> = [];

    if (!currentBill.provider.trim()) {
      items.push({ id: 'provider', label: 'Поставщик', reason: 'Поле не распознано', confidence: 'low' });
    }

    if (!currentBill.period.trim()) {
      items.push({ id: 'period', label: 'Период', reason: 'Поле не распознано', confidence: 'low' });
    }

    if (!currentBill.total.trim()) {
      items.push({ id: 'total', label: 'Итого', reason: 'Поле не распознано', confidence: 'low' });
    }

    currentBill.rows.forEach((row) => {
      if (!row.label.trim()) {
        items.push({ id: `${row.id}-label`, label: `${row.label || 'Услуга'} · название`, reason: 'Название не распознано', confidence: 'low' });
      }

      if (row.value === null || Number.isNaN(row.value)) {
        items.push({ id: `${row.id}-value`, label: `${row.label || 'Услуга'} · значение`, reason: 'Число не распознано', confidence: 'medium' });
      }

      if (!row.unit.trim()) {
        items.push({ id: `${row.id}-unit`, label: `${row.label || 'Услуга'} · единицы`, reason: 'Единицы не распознаны', confidence: 'medium' });
      }

      if (row.status === 'needs-check') {
        items.push({ id: `${row.id}-status`, label: `${row.label || 'Услуга'}`, reason: 'Нужно проверить вручную', confidence: 'high' });
      }
    });

    return items;
  }, [currentBill]);

  const updateBillField = (field: 'provider' | 'period' | 'total', value: string) => {
    setBills((prev) => {
      const next = prev.length > 0 ? [...prev] : [...initialBills];
      next[0] = {
        ...next[0],
        [field]: value,
      };
      return next;
    });
  };

  const updateBillRowField = (rowId: string, field: 'label' | 'value' | 'unit' | 'status', value: string | number | null) => {
    setBills((prev) => {
      const next = prev.length > 0 ? [...prev] : [...initialBills];
      next[0] = {
        ...next[0],
        rows: next[0].rows.map((row) =>
          row.id === rowId
            ? {
                ...row,
                [field]: field === 'value' ? (value === '' ? null : Number(value)) : value,
              }
            : row,
        ),
      };
      return next;
    });
  };

  useEffect(() => {
    localStorage.setItem('jkh-helper-meters', JSON.stringify(meters));
  }, [meters]);

  useEffect(() => {
    localStorage.setItem('jkh-helper-records', JSON.stringify(records));
  }, [records]);

  useEffect(() => {
    localStorage.setItem('jkh-helper-bills', JSON.stringify(bills));
  }, [bills]);

  useEffect(() => {
    localStorage.setItem('jkh-helper-documents', JSON.stringify(documents));
  }, [documents]);

  useEffect(() => {
    localStorage.setItem('jkh-helper-confirmation-history', JSON.stringify(confirmationHistory));
  }, [confirmationHistory]);

  useEffect(() => {
    localStorage.setItem('jkh-helper-properties', JSON.stringify(properties));
  }, [properties]);

  useEffect(() => {
    localStorage.setItem('jkh-helper-selected-property', selectedPropertyId);
  }, [selectedPropertyId]);

  useEffect(() => {
    const nextDraft = Object.fromEntries(meters.map((meter) => [meter.id, String(meter.reading ?? '')]));
    setDraftValues((prev) => ({ ...nextDraft, ...prev }));
  }, [meters]);

  const summary = useMemo(
    () =>
      meters.map((meter) => ({
        ...meter,
        currentConsumption: calculateConsumption(meter.reading, meter.previousReading),
      })),
    [meters],
  );

  const comparison = useMemo(() => buildMeterComparison(meters, bills), [meters, bills]);
  const monthChecklist = useMemo(() => buildMonthChecklist(meters, bills), [meters, bills]);
  const structuredBills = useMemo(
    () =>
      bills.map((bill) =>
        buildStructuredBillDocument(bill, {
          fileName: `${bill.provider}-${bill.period}.pdf`,
          localOnly: true,
          pages: ['page-1'],
        }),
      ),
    [bills],
  );
  const missingStructuredFields = useMemo(() => countMissingStructuredFields(structuredBills), [structuredBills]);
  const verificationChecks = useMemo(() => {
    const arithmeticStatus = comparison.some((item) => item.status === 'issue') ? 'mismatch' : comparison.some((item) => item.status === 'warning') ? 'needs-check' : 'verified';
    const readingStatus = monthChecklist.length > 0 ? 'needs-check' : 'verified';
    const tariffStatus = bills.some((bill) => bill.rows.some((row) => row.status === 'issue')) ? 'mismatch' : bills.some((bill) => bill.rows.some((row) => row.status === 'needs-check')) ? 'needs-check' : 'verified';
    const statusResult = bills.every((bill) => bill.rows.every((row) => row.status === 'confirmed')) ? 'verified' : bills.some((bill) => bill.rows.some((row) => row.status === 'issue')) ? 'mismatch' : 'needs-check';
    const dataStatus = structuredBills.every((bill) => bill.services.every((service) => Boolean(service.source.page))) ? 'verified' : 'needs-data';
    const storageStatus = documents.length > 0 ? 'verified' : 'needs-data';

    return [
      {
        id: 'arithmetic',
        title: 'Арифметика',
        status: arithmeticStatus,
        note: 'Проверка разницы между расходом по счётчику и значением по квитанции.',
      },
      {
        id: 'readings',
        title: 'Показания и расход',
        status: readingStatus,
        note: 'Проверка, что показания не пустые, не неразборчивые и расход рассчитывается по подтверждённой базе.',
      },
      {
        id: 'tariffs',
        title: 'Тарифы и основания начисления',
        status: tariffStatus,
        note: 'Проверка того, что тариф и основания начисления разнесены отдельно от фактического расхода.',
      },
      {
        id: 'result-status',
        title: 'Статусы результата',
        status: statusResult,
        note: 'Оценка, подтверждено ли состояние квитанции или есть спорные участки.',
      },
      {
        id: 'source-data',
        title: 'Данные и хранение',
        status: dataStatus,
        note: 'Каждое поле должно иметь источник и храниться отдельно от кода.',
      },
      {
        id: 'storage',
        title: 'Хранение и исходный документ',
        status: storageStatus,
        note: 'Фото и исходные документы хранятся отдельно от логики и проверяются по странице.',
      },
    ];
  }, [bills, comparison, documents.length, monthChecklist.length, structuredBills]);
  const currentMonthStatus = monthChecklist.length === 0 ? 'confirmed' : monthChecklist.some((item) => item.severity === 'issue') ? 'issue' : 'warning';
  const transferText = useMemo(() => {
    const lines = [
      `Период: ${selectedMonth}`,
      'Счётчики:',
      ...meters.map((meter) => `- ${meter.label}: ${meter.reading ?? '—'} ${meter.unit} (${meterNumbers[meter.id] ?? '№ не указан'})`),
      '',
      'Что проверить:',
      ...monthChecklist.map((item) => `- ${item.label}: ${item.message}`),
    ];

    if (monthChecklist.length === 0) {
      lines.push('- Ничего не требует проверки');
    }

    return lines.join('\n');
  }, [meters, monthChecklist, selectedMonth]);

  const historyForDisplay = useMemo(() => {
    const currentEntry: ConfirmationEntry = {
      id: `history-${selectedMonth}`,
      month: selectedMonth,
      status: currentMonthStatus,
      summary: monthChecklist.length === 0 ? 'Показания и квитанции совпадают' : `Нужно проверить: ${monthChecklist.length} пунктов`,
      updatedAt: new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }),
    };

    const withoutCurrent = confirmationHistory.filter((item) => item.month !== selectedMonth);
    return [currentEntry, ...withoutCurrent].slice(0, 6);
  }, [confirmationHistory, currentMonthStatus, monthChecklist.length, selectedMonth]);

  const selectedProperty = properties.find((property) => property.id === selectedPropertyId) ?? properties[0] ?? initialProperties[0];

  const updateProperty = (propertyId: string, updates: Partial<PropertyProfile>) => {
    setProperties((prev) => prev.map((property) => (property.id === propertyId ? { ...property, ...updates } : property)));
  };

  const handlePropertyAddressUpdate = (propertyId: string, address: string) => {
    const company = inferManagementCompany(address);

    updateProperty(propertyId, {
      address,
      managementCompany: company?.name ?? '',
      region: company?.region ?? 'Регион уточняется',
      tariffsUrl: company?.tariffPageUrl ?? '',
      normsUrl: company?.normsPageUrl ?? '',
      notes: company
        ? 'УК определена автоматически по адресу. Следующий шаг — скачать и сверить тарифы и нормативы для данного региона.'
        : 'Нет уверенного совпадения по адресу. Нужно уточнить УК вручную.',
    });
  };

  const addProperty = () => {
    const nextId = `property-${Date.now()}`;
    const nextProperty = createPropertyProfile(nextId);
    setProperties((prev) => [...prev, nextProperty]);
    setSelectedPropertyId(nextId);
  };

  const addSampleReading = () => {
    const next = meters.map((meter, index) => {
      const nextValue = Number((meter.reading! + (index + 1) * 0.7).toFixed(3));
      return { ...meter, reading: nextValue };
    });

    const newRecords: MeterRecord[] = next.map((meter, index) => ({
      id: `read-${Date.now()}-${index}`,
      meterId: meter.id,
      value: meter.reading!,
      date: new Date().toISOString().slice(0, 10),
      source: 'manual',
    }));

    setRecords((prev) => [...prev, ...newRecords]);
    setMeters(next);
  };

  const saveManualReading = (meterId: string) => {
    const raw = draftValues[meterId];
    if (raw === undefined || raw === '' || Number.isNaN(Number(raw))) return;

    const numericValue = Number(raw);

    setMeters((prev) =>
      prev.map((meter) =>
        meter.id === meterId
          ? { ...meter, reading: numericValue, lastUpdated: `${selectedMonth}-15` }
          : meter,
      ),
    );

    setRecords((prev) => [
      ...prev,
      {
        id: `manual-${Date.now()}-${meterId}`,
        meterId,
        value: numericValue,
        date: `${selectedMonth}-15`,
        source: 'manual',
      },
    ]);
  };

  const copyTransferValue = async (meter: Meter) => {
    const text = `${meter.location}; ${meter.label}; ${meterNumbers[meter.id] ?? '№ не указан'}; ${meter.reading ?? '—'} ${meter.unit}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(meter.id);
      setTimeout(() => setCopiedId(null), 1200);
    } catch (error) {
      console.error('Copy failed', error);
    }
  };

  const copyPreparedTransfer = async () => {
    try {
      await navigator.clipboard.writeText(transferText);
      setTransferCopied(true);
      setTimeout(() => setTransferCopied(false), 1400);
    } catch (error) {
      console.error('Copy transfer summary failed', error);
    }
  };

  const exportPreparedTransfer = () => {
    const blob = new Blob([transferText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `zhkh-report-${selectedMonth}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleDocumentUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    const nextDocuments: LocalDocument[] = files.map((file) => {
      const type: LocalDocument['type'] = file.type.includes('pdf') ? 'pdf' : 'image';

      return {
        id: `doc-${Date.now()}-${file.name}`,
        name: file.name,
        type,
        sizeLabel: `${(file.size / 1024).toFixed(0)} KB`,
        uploadedAt: new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }),
      };
    });

    setDocuments((prev) => [...nextDocuments, ...prev]);

    const file = files[0];
    try {
      setVoiceStatus('Распознавание документа…');
      const text = await readDocumentText(file);
      const extracted = extractBillDataFromText(text);

      setBills((prev) => {
        const next = prev.length > 0 ? [...prev] : [...initialBills];
        const base = next[0] ?? initialBills[0];
        const mappedRows: BillDocument['rows'] = base.rows.map((row) => {
          const matched = extracted.rows?.find((candidate) => candidate.id === row.id);
          if (!matched) return row;
          return {
            ...row,
            label: matched.label || row.label,
            value: matched.value ?? row.value,
            unit: matched.unit || row.unit,
            source: 'ocr' as const,
          };
        });

        next[0] = {
          ...base,
          provider: extracted.provider || base.provider,
          period: extracted.period || base.period,
          total: extracted.total || base.total,
          rows: mappedRows,
        };

        return next;
      });

      if (extracted.period) {
        setSelectedMonth(extracted.period);
      }

      setVoiceStatus('Документ распознан. Проверьте поля и поправьте неразборчивые значения.');
    } catch (error) {
      console.error('OCR extraction failed', error);
      setVoiceStatus('Не удалось автоматически распознать документ; поля можно заполнить вручную.');
    }

    event.target.value = '';
  };

  const updateBillRowStatus = (billId: string, rowId: string, status: 'confirmed' | 'needs-check' | 'issue') => {
    setBills((prev) =>
      prev.map((bill) =>
        bill.id === billId
          ? {
              ...bill,
              rows: bill.rows.map((row) => (row.id === rowId ? { ...row, status } : row)),
            }
          : bill,
      ),
    );
  };

  const handleVoiceCommand = (text: string) => {
    const command = parseVoiceCommand(text, meters.map((meter) => meter.label));

    if (command.kind === 'copy-summary') {
      void copyPreparedTransfer();
      setVoiceStatus('Команда: скопировать сводку');
      return;
    }

    if (command.kind === 'export-report') {
      exportPreparedTransfer();
      setVoiceStatus('Команда: экспортировать txt');
      return;
    }

    if (command.kind === 'open-transfer') {
      document.getElementById('transfer-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setVoiceStatus('Команда: открыть блок передачи');
      return;
    }

    if (command.kind === 'open-summary') {
      document.getElementById('summary-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setVoiceStatus('Команда: открыть сводку месяца');
      return;
    }

    if (command.kind === 'add-sample') {
      addSampleReading();
      setVoiceStatus('Команда: добавлено тестовое показание');
      return;
    }

    if (command.kind === 'upload-document') {
      fileInputRef.current?.click();
      setVoiceStatus('Команда: загрузить документ');
      return;
    }

    if (command.kind === 'set-month') {
      setSelectedMonth(command.month);
      setVoiceStatus(`Команда: выбран месяц ${command.month}`);
      return;
    }

    if (command.kind === 'save-meter') {
      const meter = meters.find((entry) => entry.label === command.meterLabel);
      if (!meter) {
        setVoiceStatus(`Не нашёл счётчик: ${command.meterLabel}`);
        return;
      }

      const nextValue = command.value ?? Number(draftValues[meter.id] ?? meter.reading ?? 0);
      setDraftValues((prev) => ({ ...prev, [meter.id]: String(nextValue) }));
      setTimeout(() => saveManualReading(meter.id), 0);
      setVoiceStatus(`Команда: сохранить показание для ${meter.label}`);
      return;
    }

    setVoiceStatus(`Не распознана команда: ${text}`);
  };

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceStatus('Голосовой ввод недоступен в этом браузере');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0]?.transcript ?? '')
        .join(' ')
        .trim();

      if (!transcript) return;
      handleVoiceCommand(transcript);
    };

    recognition.onerror = (event: any) => {
      const message = event?.error === 'not-allowed' ? 'Доступ к микрофону запрещён' : 'Не удалось распознать речь';
      setVoiceStatus(message);
      setIsListening(false);
    };

    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;

    return () => recognition.stop();
  }, [meters]);

  const toggleVoiceRecognition = () => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setVoiceStatus('Голосовой ввод недоступен в этом браузере');
      return;
    }

    if (isListening) {
      recognition.stop();
      setIsListening(false);
      setVoiceStatus('Запись остановлена');
      return;
    }

    recognition.start();
    setIsListening(true);
    setVoiceStatus('Слушаю команду…');
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Шаблон разбора квитанции ЖКХ</p>
          <h1>Помощник ЖКХ</h1>
        </div>
        <div className="voice-controls">
          <button className={`voice-button ${isListening ? 'listening' : ''}`} onClick={toggleVoiceRecognition}>
            {isListening ? '⏹ Голос' : '🎙 Голос'}
          </button>
        </div>
      </header>

      <div className="voice-status-panel">
        <span>Примечание:</span>
        <strong>Нечитаемые данные не подставляются автоматически; пустые поля остаются пустыми до проверки.</strong>
      </div>

      <section className="panel property-panel">
        <div className="transfer-header">
          <h2>Объекты и управляющие компании</h2>
          <button className="primary small" onClick={addProperty}>Добавить объект</button>
        </div>

        <div className="property-grid">
          {properties.map((property) => (
            <article
              key={property.id}
              className={`property-card ${property.id === selectedProperty.id ? 'selected' : ''}`}
            >
              <div className="property-card-header">
                <strong>{property.address || 'Адрес не указан'}</strong>
                <button
                  className="ghost xs"
                  onClick={() => setSelectedPropertyId(property.id)}
                >
                  {property.id === selectedProperty.id ? 'Выбран' : 'Выбрать'}
                </button>
              </div>

              <label className="input-field compact">
                <span>Адрес объекта</span>
                <input
                  value={property.address}
                  onChange={(event) => handlePropertyAddressUpdate(property.id, event.target.value)}
                  placeholder="Например: Екатеринбург, ул. Ленина, 42"
                />
              </label>

              <div className="property-meta-row">
                <span>УК</span>
                <strong>{property.managementCompany || 'Не определена'}</strong>
              </div>

              <div className="property-meta-row">
                <span>Регион</span>
                <strong>{property.region}</strong>
              </div>

              <div className="property-link-list">
                {property.tariffsUrl ? (
                  <a href={property.tariffsUrl} target="_blank" rel="noreferrer">Открыть тарифы</a>
                ) : null}
                {property.normsUrl ? (
                  <a href={property.normsUrl} target="_blank" rel="noreferrer">Открыть нормативы</a>
                ) : null}
              </div>

              <p className="property-note">{property.notes}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel bill-entry-panel">
        <div className="transfer-header">
          <h2>Разбор квитанции</h2>
          <button className="primary small" onClick={() => fileInputRef.current?.click()}>
            Загрузить документ
          </button>
        </div>

        <div className="document-meta-grid">
          <label className="input-field">
            <span>Поставщик</span>
            <input
              value={currentBill.provider}
              onChange={(event) => updateBillField('provider', event.target.value)}
              placeholder="Например: ПАО «Водоканал»"
            />
          </label>

          <label className="input-field">
            <span>Период</span>
            <input
              type="month"
              value={selectedMonth || currentBill.period || ''}
              onChange={(event) => {
                const nextValue = event.target.value;
                setSelectedMonth(nextValue);
                updateBillField('period', nextValue);
              }}
            />
          </label>

          <label className="input-field">
            <span>Итого</span>
            <input
              value={currentBill.total}
              onChange={(event) => updateBillField('total', event.target.value)}
              placeholder="Например: 9802.06 ₽"
            />
          </label>
        </div>

        <div className="bill-editor-list">
          {currentBill.rows.map((row) => (
            <div key={row.id} className="bill-row-editor">
              <label className="input-field">
                <span>Услуга</span>
                <input
                  value={row.label}
                  onChange={(event) => updateBillRowField(row.id, 'label', event.target.value)}
                  placeholder="Нечитаемо — оставьте пустым"
                />
              </label>

              <label className="input-field">
                <span>Объём</span>
                <input
                  type="number"
                  step="0.001"
                  value={row.value ?? ''}
                  onChange={(event) => updateBillRowField(row.id, 'value', event.target.value)}
                  placeholder="—"
                />
              </label>

              <label className="input-field">
                <span>Ед. изм.</span>
                <input
                  value={row.unit}
                  onChange={(event) => updateBillRowField(row.id, 'unit', event.target.value)}
                  placeholder="м³ / кВт·ч / ₽"
                />
              </label>

              <label className="input-field small-field">
                <span>Статус</span>
                <select
                  value={row.status}
                  onChange={(event) => updateBillRowField(row.id, 'status', event.target.value)}
                >
                  <option value="needs-check">Нужно проверить</option>
                  <option value="confirmed">Подтверждено</option>
                  <option value="issue">Проблема</option>
                </select>
              </label>
            </div>
          ))}
        </div>

        {documents.length > 0 && (
          <div className="uploaded-documents">
            <h3>Загруженные документы</h3>
            <ul>
              {documents.map((document) => (
                <li key={document.id}>
                  <strong>{document.name}</strong>
                  <span>{document.type.toUpperCase()} · {document.sizeLabel}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {unresolvedBillFields.length > 0 && (
          <div className="unresolved-fields">
            <h3>Неразобранные поля</h3>
            <ul>
              {unresolvedBillFields.map((field) => (
                <li key={field.id} className={`field-warning confidence-${field.confidence}`}>
                  <div className="field-warning-header">
                    <strong>{field.label}</strong>
                    <span className={`confidence-badge confidence-${field.confidence}`}>
                      {field.confidence === 'high' ? 'высокая' : field.confidence === 'medium' ? 'средняя' : 'низкая'}
                    </span>
                  </div>
                  <span>{field.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="panel management-company-panel">
        <div className="transfer-header">
          <h2>Расчёты управляющей компании</h2>
        </div>
        <p className="section-note">Квитанция УК включает не только воду и электричество: отопление, уборку, подогрев, доставка воды, общедомовое электричество и другие услуги. Здесь показываются все строки, кроме итоговой суммы.</p>

        <div className="management-company-grid">
          {managementCompanyFields.map((field) => (
            <div key={field.id} className="management-company-item">
              <span>{field.label}</span>
              <strong>{field.value}</strong>
            </div>
          ))}
        </div>

        {managementCompanyDetails.length > 0 && (
          <div className="management-company-details">
            <h3>Детализация по услугам</h3>
            <div className="management-company-details-list">
              {managementCompanyDetails.map((row) => (
                <div key={row.id} className="management-company-detail-row">
                  <span>{row.label || 'Услуга не распознана'}</span>
                  <strong>{row.numericValue === null ? '—' : `${row.numericValue.toFixed(2)} ${row.unit || '₽'}`}</strong>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="toolbar">
        <label className="month-picker">
          <span>Месяц</span>
          <input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} />
        </label>
      </section>

      <section className="month-summary panel" id="summary-section">
        <div>
          <span className="tiny-label">Сводка месяца</span>
          <h2>{selectedMonth}</h2>
        </div>
        <div className="month-summary-grid">
          <div>
            <span>Статус</span>
            <strong>{currentMonthStatus === 'confirmed' ? 'Подтверждено' : currentMonthStatus === 'warning' ? 'Проверить' : 'Расхождение'}</strong>
          </div>
          <div>
            <span>Проверить</span>
            <strong>{monthChecklist.length}</strong>
          </div>
          <div>
            <span>Счётчиков</span>
            <strong>{meters.length}</strong>
          </div>
        </div>
        <button className="primary small" onClick={exportPreparedTransfer}>Экспортировать .txt</button>
      </section>

      <section className="summary-grid">
        {summary.map((meter) => (
          <article key={meter.id} className="meter-card">
            <div className="meter-header">
              <span className="tag">{meter.type}</span>
              <strong>{meter.label}</strong>
            </div>

            <div className="meter-number">{meterNumbers[meter.id] ?? '№ не указан'}</div>

            <div className="meter-row">
              <span>Место</span>
              <b>{meter.location}</b>
            </div>
            <div className="meter-row">
              <span>Текущее</span>
              <b>{meter.reading ?? '—'} {meter.unit}</b>
            </div>
            <div className="meter-row">
              <span>Предыдущее</span>
              <b>{meter.previousReading ?? '—'} {meter.unit}</b>
            </div>
            <div className="meter-row accent">
              <span>Расход</span>
              <b>{meter.currentConsumption ?? '—'} {meter.unit}</b>
            </div>

            <label className="input-field">
              <span>Показание</span>
              <input
                type="number"
                step="0.001"
                value={draftValues[meter.id] ?? ''}
                onChange={(event) =>
                  setDraftValues((prev) => ({
                    ...prev,
                    [meter.id]: event.target.value,
                  }))
                }
              />
            </label>

            <button className="secondary" onClick={() => saveManualReading(meter.id)}>Сохранить</button>
          </article>
        ))}
      </section>

      <section className="transfer-panel panel" id="transfer-panel">
        <div className="transfer-header">
          <h2>Для передачи</h2>
          <button className="primary small" onClick={copyPreparedTransfer}>
            {transferCopied ? 'Скопировано' : 'Копировать сводку'}
          </button>
        </div>

        <div className="transfer-summary">
          <div>
            <span>Период</span>
            <strong>{selectedMonth}</strong>
          </div>
          <div>
            <span>Проверить</span>
            <strong>{monthChecklist.length}</strong>
          </div>
          <div>
            <span>Счётчиков</span>
            <strong>{meters.length}</strong>
          </div>
        </div>

        {meters.map((meter) => (
          <div key={meter.id} className="transfer-row">
            <div className="transfer-meta">
              <span>{meter.location}</span>
              <strong>{meter.label}</strong>
            </div>
            <div className="transfer-detail">
              <span>Номер</span>
              <strong>{meterNumbers[meter.id] ?? '—'}</strong>
            </div>
            <div className="transfer-detail">
              <span>Показание</span>
              <strong>{meter.reading ?? '—'} {meter.unit}</strong>
            </div>
            <button className="ghost" onClick={() => copyTransferValue(meter)}>
              {copiedId === meter.id ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
        ))}

        <div className="checklist-panel">
          <h3>Что проверить</h3>
          {monthChecklist.length === 0 ? (
            <p>Пока всё в порядке. Ничего не требует ручной проверки.</p>
          ) : (
            <ul>
              {monthChecklist.map((item) => (
                <li key={item.id} className={item.severity === 'issue' ? 'issue' : 'warning'}>
                  <strong>{item.label}</strong>
                  <span>{item.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="export-preview">
          <h3>Текст для передачи</h3>
          <pre>{transferText}</pre>
        </div>
      </section>

      <section className="panel">
        <h2>Структура квитанции</h2>
        <div className="document-status-strip">
          <div>
            <span>Заполнено</span>
            <strong>{structuredBills.reduce((sum, bill) => sum + bill.services.reduce((count, service) => count + [
              service.service.value,
              service.unit.value,
              service.volume.value,
              service.tariff.value,
              service.currentCharge.value,
              service.coefficient.value,
              service.recalculation.value,
              service.reduction.value,
              service.debtOrOverpayment.value,
              service.payments.value,
              service.penalties.value,
              service.totalDue.value,
            ].filter((field) => field !== null && field !== undefined && field !== '').length, 0), 0)}
            </strong>
          </div>
          <div>
            <span>Не хватает</span>
            <strong>{missingStructuredFields}</strong>
          </div>
          <div>
            <span>Хранение</span>
            <strong>Локально</strong>
          </div>
        </div>

        <div className="structured-bill-list">
          {structuredBills.map((bill) => (
            <article key={bill.documentId} className="structured-bill-card">
              <div className="structured-header">
                <div>
                  <span className="tiny-label">Месяц</span>
                  <strong>{bill.calculationMonth.value ?? '—'}</strong>
                </div>
                <div>
                  <span className="tiny-label">Поставщик</span>
                  <strong>{bill.provider.value ?? '—'}</strong>
                </div>
                <div>
                  <span className="tiny-label">Файл</span>
                  <strong>{bill.sourceDocument.fileName ?? 'Локальный файл'}</strong>
                </div>
              </div>

              {bill.services.map((service) => (
                <div key={`${bill.documentId}-${service.service.raw ?? service.service.value}`} className="structured-service">
                  <div className="structured-service-topline">
                    <strong>{formatStructuredValue(service.service.value, 'Услуга не определена')}</strong>
                    <span>{formatStructuredValue(service.unit.value, 'ед. не указаны')}</span>
                  </div>

                  <div className="structured-grid">
                    <div>
                      <span>Объём</span>
                      <strong>{formatStructuredValue(service.volume.value, 'Нет данных')}</strong>
                    </div>
                    <div>
                      <span>Тариф</span>
                      <strong>{formatStructuredValue(service.tariff.value, 'Нет данных')}</strong>
                    </div>
                    <div>
                      <span>Начисление</span>
                      <strong>{formatStructuredValue(service.currentCharge.value, 'Нет данных')}</strong>
                    </div>
                    <div>
                      <span>Коэффициент</span>
                      <strong>{formatStructuredValue(service.coefficient.value, 'Нет данных')}</strong>
                    </div>
                    <div>
                      <span>Перерасчёт</span>
                      <strong>{formatStructuredValue(service.recalculation.value, 'Нет данных')}</strong>
                    </div>
                    <div>
                      <span>Снижение</span>
                      <strong>{formatStructuredValue(service.reduction.value, 'Нет данных')}</strong>
                    </div>
                    <div>
                      <span>Долг/переплата</span>
                      <strong>{formatStructuredValue(service.debtOrOverpayment.value, 'Нет данных')}</strong>
                    </div>
                    <div>
                      <span>Платежи</span>
                      <strong>{formatStructuredValue(service.payments.value, 'Нет данных')}</strong>
                    </div>
                    <div>
                      <span>Пени</span>
                      <strong>{formatStructuredValue(service.penalties.value, 'Нет данных')}</strong>
                    </div>
                    <div>
                      <span>Итог</span>
                      <strong>{formatStructuredValue(service.totalDue.value, 'Нет данных')}</strong>
                    </div>
                  </div>

                  <div className="source-row">
                    <span>Источник: {service.source.page}</span>
                    <span>Способ: {service.source.method}</span>
                    <span>Статус: {service.source.status}</span>
                  </div>
                </div>
              ))}
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Проверки по README</h2>
        <div className="verification-list">
          {verificationChecks.map((check) => (
            <article key={check.id} className={`verification-item verification-${check.status}`}>
              <div className="verification-header">
                <strong>{check.title}</strong>
                <span className={`status status-${check.status === 'verified' ? 'confirmed' : check.status === 'needs-data' ? 'needs-check' : check.status}`}>
                  {check.status === 'verified' ? 'Подтверждено' : check.status === 'needs-check' ? 'Проверить' : check.status === 'needs-data' ? 'Нет данных' : 'Есть расхождение'}
                </span>
              </div>
              <p>{check.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Квитанции и документы</h2>
        <div className="bill-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/*"
            multiple
            className="hidden-file-input"
            onChange={handleDocumentUpload}
          />
        </div>

        <div className="document-list">
          {documents.map((document) => (
            <div key={document.id} className="document-item">
              <div className="document-type">{document.type === 'pdf' ? 'PDF' : 'Фото'}</div>
              <div>
                <strong>{document.name}</strong>
                <small>{document.sizeLabel} • {document.uploadedAt}</small>
              </div>
            </div>
          ))}
        </div>

        {bills.map((bill) => (
          <article key={bill.id} className="bill-card">
            <div className="bill-header">
              <div>
                <span className="tiny-label">Поставщик</span>
                <strong>{bill.provider}</strong>
              </div>
              <div>
                <span className="tiny-label">Месяц</span>
                <strong>{bill.period}</strong>
              </div>
              <div>
                <span className="tiny-label">Итог</span>
                <strong>{bill.total}</strong>
              </div>
            </div>

            <div className="bill-table">
              <div className="bill-row bill-row-head">
                <span>Поле</span>
                <span>Значение</span>
                <span>Источник</span>
                <span>Статус</span>
              </div>
              {bill.rows.map((row) => (
                <div key={row.id} className="bill-row">
                  <span>{row.label}</span>
                  <span>{row.value ?? '—'} {row.unit}</span>
                  <span>{row.source}</span>
                  <div className="row-status-controls">
                    <span className={`status status-${row.status}`}>
                      {row.status === 'confirmed' ? 'Подтверждено' : row.status === 'needs-check' ? 'Проверить' : 'Есть расхождение'}
                    </span>
                    <div className="mini-buttons">
                      <button className="tiny-button" onClick={() => updateBillRowStatus(bill.id, row.id, 'confirmed')}>OK</button>
                      <button className="tiny-button" onClick={() => updateBillRowStatus(bill.id, row.id, 'needs-check')}>?</button>
                      <button className="tiny-button danger" onClick={() => updateBillRowStatus(bill.id, row.id, 'issue')}>!</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Сверка показаний и квитанций</h2>
        <div className="comparison-list">
          {comparison.map((item) => {
            const meter = meters.find((entry) => entry.id === item.meterId);
            const unitLabel = meter?.unit ?? 'ед.';

            return (
              <article key={item.meterId} className={`comparison-item comparison-${item.status}`}>
                <div className="comparison-header">
                  <strong>{item.meterLabel}</strong>
                  <span className={`comparison-badge comparison-badge-${item.status}`}>
                    {item.status === 'match' ? 'Совпадает' : item.status === 'warning' ? 'Проверить' : 'Расхождение'}
                  </span>
                </div>

                <div className="comparison-grid">
                  <div>
                    <span>Расход по счётчику</span>
                    <strong>{item.meterConsumption ?? '—'} {unitLabel}</strong>
                  </div>
                  <div>
                    <span>По квитанции</span>
                    <strong>{item.billValue ?? '—'} {unitLabel}</strong>
                  </div>
                  <div>
                    <span>Разница</span>
                    <strong>{item.diff === null ? '—' : `${Math.abs(item.diff)} ${unitLabel}`}</strong>
                  </div>
                </div>

                <p>{item.note}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2>История подтверждений</h2>
        <div className="history-list">
          {historyForDisplay.map((entry) => (
            <div key={entry.id} className={`history-entry history-${entry.status}`}>
              <div className="history-topline">
                <strong>{entry.month}</strong>
                <span className={`status status-${entry.status}`}>
                  {entry.status === 'confirmed' ? 'Подтверждено' : entry.status === 'warning' ? 'Проверить' : 'Расхождение'}
                </span>
              </div>
              <p>{entry.summary}</p>
              <small>{entry.updatedAt}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>История показаний</h2>
        <ul className="record-list">
          {records.slice().reverse().slice(0, 8).map((record) => (
            <li key={record.id}>
              <span>{record.date}</span>
              <strong>{record.value}</strong>
              <small>{record.source}</small>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export default App;
