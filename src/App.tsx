import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  buildMeterComparison,
  buildMonthChecklist,
  buildStructuredBillDocument,
  calculateConsumption,
  parseVoiceCommand,
  type BillDocument,
  type Meter,
  type MeterRecord,
} from './lib/logic';

const initialMeters: Meter[] = [
  { id: 'kitchen-cold', label: 'Холодная вода кухня', location: 'Кухня', type: 'cold-water', unit: 'м³', reading: 118.4, previousReading: 116.1, lastUpdated: '2026-09-15' },
  { id: 'bath-cold', label: 'Холодная вода ванная', location: 'Ванная', type: 'cold-water', unit: 'м³', reading: 95.1, previousReading: 91.7, lastUpdated: '2026-09-15' },
  { id: 'kitchen-hot', label: 'Горячая вода кухня', location: 'Кухня', type: 'hot-water', unit: 'м³', reading: 74.6, previousReading: 71.2, lastUpdated: '2026-09-15' },
  { id: 'bath-hot', label: 'Горячая вода ванная', location: 'Ванная', type: 'hot-water', unit: 'м³', reading: 88.9, previousReading: 84.3, lastUpdated: '2026-09-15' },
  { id: 'electric', label: 'Электричество', location: 'Общий счётчик', type: 'electric', unit: 'кВт·ч', reading: 7480.5, previousReading: 7421.1, lastUpdated: '2026-09-15' },
];

const meterNumbers: Record<string, string> = {
  'kitchen-cold': '№ 12-4821',
  'bath-cold': '№ 17-5402',
  'kitchen-hot': '№ 12-4818',
  'bath-hot': '№ 17-5487',
  electric: '№ 345981',
};

const initialRecords: MeterRecord[] = [
  { id: 'r1', meterId: 'kitchen-cold', value: 116.1, date: '2026-08-15', source: 'manual' },
  { id: 'r2', meterId: 'kitchen-cold', value: 118.4, date: '2026-09-15', source: 'manual' },
  { id: 'r3', meterId: 'bath-cold', value: 91.7, date: '2026-08-15', source: 'manual' },
  { id: 'r4', meterId: 'bath-cold', value: 95.1, date: '2026-09-15', source: 'manual' },
  { id: 'r5', meterId: 'kitchen-hot', value: 71.2, date: '2026-08-15', source: 'manual' },
  { id: 'r6', meterId: 'kitchen-hot', value: 74.6, date: '2026-09-15', source: 'manual' },
  { id: 'r7', meterId: 'bath-hot', value: 84.3, date: '2026-08-15', source: 'manual' },
  { id: 'r8', meterId: 'bath-hot', value: 88.9, date: '2026-09-15', source: 'manual' },
  { id: 'r9', meterId: 'electric', value: 7421.1, date: '2026-08-15', source: 'manual' },
  { id: 'r10', meterId: 'electric', value: 7480.5, date: '2026-09-15', source: 'manual' },
];

const initialBills: BillDocument[] = [
  {
    id: 'b1',
    provider: 'УК «Дом»',
    period: '2026-09',
    total: '3698.40 ₽',
    rows: [
      { id: 'row-1', label: 'Холодная вода', value: 5.42, unit: 'м³', source: 'ocr', status: 'needs-check' },
      { id: 'row-2', label: 'Горячая вода', value: 7.2, unit: 'м³', source: 'photo', status: 'confirmed' },
      { id: 'row-3', label: 'Электричество', value: 526.5, unit: 'кВт·ч', source: 'ocr', status: 'needs-check' },
    ],
  },
  {
    id: 'b2',
    provider: 'Мосэнергосбыт',
    period: '2026-09',
    total: '2140.10 ₽',
    rows: [
      { id: 'row-4', label: 'Электроэнергия', value: 2140.1, unit: '₽', source: 'manual', status: 'confirmed' },
    ],
  },
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

const initialHistory: ConfirmationEntry[] = [
  { id: 'hist-1', month: '2026-09', status: 'warning', summary: 'Проверить холодную воду и электричество', updatedAt: '2026-09-20 12:14' },
  { id: 'hist-2', month: '2026-10', status: 'confirmed', summary: 'Показания и квитанции совпадают', updatedAt: '2026-10-02 09:20' },
];

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
    return saved ? JSON.parse(saved) : [
      { id: 'doc-1', name: 'kvitancia-september.pdf', type: 'pdf', sizeLabel: '842 KB', uploadedAt: '2026-09-20 12:14' },
    ];
  });
  const [confirmationHistory, setConfirmationHistory] = useState<ConfirmationEntry[]>(() => {
    const saved = localStorage.getItem('jkh-helper-confirmation-history');
    return saved ? JSON.parse(saved) : initialHistory;
  });
  const [selectedMonth, setSelectedMonth] = useState('2026-10');
  const [draftValues, setDraftValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialMeters.map((meter) => [meter.id, String(meter.reading ?? '')])),
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [transferCopied, setTransferCopied] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('Голосовой ввод выключен');
  const [isListening, setIsListening] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<any>(null);

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

  const handleDocumentUpload = (event: ChangeEvent<HTMLInputElement>) => {
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
          <p className="eyebrow">Этап 1 · Базовый интерфейс</p>
          <h1>Помощник ЖКХ</h1>
        </div>
        <div className="voice-controls">
          <button className={`voice-button ${isListening ? 'listening' : ''}`} onClick={toggleVoiceRecognition}>
            {isListening ? '⏹ Голос' : '🎙 Голос'}
          </button>
          <button className="primary" onClick={addSampleReading}>Добавить тестовое показание</button>
        </div>
      </header>

      <div className="voice-status-panel">
        <span>Голос:</span>
        <strong>{voiceStatus}</strong>
      </div>

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
          <button className="primary small" onClick={() => fileInputRef.current?.click()}>Загрузить документ</button>
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
