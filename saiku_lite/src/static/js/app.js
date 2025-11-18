const datasetFileInput = document.getElementById('dataset-file');
const uploadForm = document.getElementById('upload-form');
const datasetInfo = document.getElementById('dataset-info');
const analysisArea = document.getElementById('analysis-area');
const statusMessage = document.getElementById('status-message');
const statusDataset = document.getElementById('status-dataset');
const datasetMeta = document.getElementById('dataset-meta');
const metaRows = document.getElementById('meta-rows');
const metaColumns = document.getElementById('meta-columns');
const dimensionList = document.getElementById('dimension-list');
const measureList = document.getElementById('measure-list');
const excludedGroup = document.getElementById('excluded-group');
const excludedList = document.getElementById('excluded-list');
const dropzones = document.querySelectorAll('.dropzone');
const aggregatorSelect = document.getElementById('aggregator-select');
const runPivotBtn = document.getElementById('run-pivot');
const pivotError = document.getElementById('pivot-error');
const pivotOutput = document.getElementById('pivot-output');
const pivotSummary = document.getElementById('pivot-summary');
const pivotTableContainer = document.getElementById('pivot-table-container');
const toolbarUploadBtn = document.getElementById('toolbar-upload');
const toolbarNewBtn = document.getElementById('toolbar-new');
const toolbarRefreshBtn = document.getElementById('toolbar-refresh');
const exportButtons = document.querySelectorAll('.export');
const dialogBackdrop = document.getElementById('dialog-backdrop');
const filterDialog = document.getElementById('filter-dialog');
const filterDialogTitle = document.getElementById('filter-dialog-title');
const filterDialogBody = document.getElementById('filter-dialog-body');
const filterDialogClose = document.getElementById('filter-dialog-close');
const filterDialogCancel = document.getElementById('filter-dialog-cancel');
const filterDialogApply = document.getElementById('filter-dialog-apply');
const tabsContainer = document.getElementById('universe-tabs');
const addCalculationBtn = document.getElementById('add-calculation-btn');
const calculationList = document.getElementById('calculation-list');
const calculationDialog = document.getElementById('calculation-dialog');
const calculationDialogTitle = document.getElementById('calculation-dialog-title');
const calculationDialogClose = document.getElementById('calculation-dialog-close');
const calculationDialogCancel = document.getElementById('calculation-dialog-cancel');
const calculationDialogSave = document.getElementById('calculation-dialog-save');
const calculationForm = document.getElementById('calculation-form');
const calcNameInput = document.getElementById('calc-name');
const calcStageSelect = document.getElementById('calc-stage');
const calcOperationSelect = document.getElementById('calc-operation');
const calcOperandsContainer = document.getElementById('calc-operands');
const calcDecimalsInput = document.getElementById('calc-decimals');
const calcBetweenLower = document.getElementById('calc-between-lower');
const calcBetweenUpper = document.getElementById('calc-between-upper');
const calcOperandNotice = document.getElementById('calc-operand-notice');
const calcExpressionField = document.getElementById('calc-expression-field');
const calcExpressionInput = document.getElementById('calc-expression');
const calcExpressionSuggestions = document.getElementById('calc-expression-suggestions');
const calcExpressionChips = document.getElementById('calc-expression-chips');

const SAIKU_BASE_PATH = (() => {
  const raw = window.SAIKU_BASE_PATH || '';
  if (!raw || raw === '/') {
    return '';
  }
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
})();

function buildUrl(path) {
  if (!path) {
    return SAIKU_BASE_PATH || '/';
  }
  let normalized = path;
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  if (!SAIKU_BASE_PATH) {
    return normalized;
  }
  return `${SAIKU_BASE_PATH}${normalized}`;
}

const PLACEHOLDERS = {
  rows: 'Arraste dimensões para as linhas',
  columns: 'Arraste dimensões para as colunas',
  measures: 'Arraste uma ou mais medidas numéricas',
  filters: 'Arraste campos para aplicar filtros',
};

const EMPTY_LABEL = 'Células Vazias';
const MAX_MEASURES = 6;

const CALC_OPERATION_DEFINITIONS = [
  { id: 'expression', label: 'Expressão personalizada', operands: 0, stages: ['pre', 'post'], acceptsExpression: true },
];
const CALC_OPERATION_LABEL = CALC_OPERATION_DEFINITIONS.reduce((acc, def) => {
  acc[def.id] = def.label;
  return acc;
}, {});
const CALC_STAGE_LABEL = { pre: 'Antes da consulta', post: 'Após o pivot' };

function formatLabel(value) {
  if (value === null || value === undefined) {
    return EMPTY_LABEL;
  }
  const str = String(value).trim();
  if (!str.length) {
    return EMPTY_LABEL;
  }
  return str;
}

const state = {
  datasets: {},
  universes: [],
  activeUniverseId: null,
  datasetId: null,
  dimensions: [],
  measures: [],
  schema: {},
  aggregations: [],
  filters: {},
  filterValuesCache: {},
  fieldLabels: {},
  calculations: { pre: [], post: [] },
  availablePostColumns: [],
  lastPivot: null,
  zones: {
    rows: [],
    columns: [],
    measures: [],
    filters: [],
  },
  excluded: [],
};

let activeFilterField = null;
let editingCalculation = null;

function deepClone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function insertExpressionToken(token) {
  if (!calcExpressionInput) return;
  const textarea = calcExpressionInput;
  const insertion = `{${token}}`;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = `${before}${insertion}${after}`;
  const caret = start + insertion.length;
  textarea.focus();
  textarea.setSelectionRange(caret, caret);
  updateExpressionSaveState();
}

function redirectToLoginIfNeeded(response) {
  if (!response) {
    return false;
  }
  if (response.headers && response.headers.get('X-Force-Password-Change') === '1') {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = buildUrl(`/change-password?next=${next}`);
    return true;
  }
  if (response.status === 401) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = buildUrl(`/login?next=${next}`);
    return true;
  }
  return false;
}

function getActiveDatasetMeta() {
  if (!state.datasetId) {
    return null;
  }
  return state.datasets[state.datasetId] || null;
}

function ensureDatasetCalculations(meta) {
  if (!meta) {
    return { pre: [], post: [] };
  }
  if (!meta.calculations) {
    meta.calculations = { pre: [], post: [] };
  } else {
    meta.calculations.pre = Array.isArray(meta.calculations.pre) ? meta.calculations.pre : [];
    meta.calculations.post = Array.isArray(meta.calculations.post) ? meta.calculations.post : [];
  }
  return meta.calculations;
}

function getFieldLabel(field) {
  return state.fieldLabels[field] || field;
}

function registerFieldLabel(field, label) {
  if (!field) {
    return;
  }
  state.fieldLabels[field] = label || field;
}

function removeFieldLabel(field) {
  if (!field) {
    return;
  }
  delete state.fieldLabels[field];
}


function updateStatus(message, tone = 'muted') {
  if (!statusMessage) return;
  statusMessage.textContent = message;
  statusMessage.classList.remove('muted', 'success', 'error');
  if (tone === 'success') {
    statusMessage.classList.add('success');
  } else if (tone === 'error') {
    statusMessage.classList.add('error');
  } else {
    statusMessage.classList.add('muted');
  }
}

function resetDatasetState() {
  state.datasetId = null;
  state.dimensions = [];
  state.measures = [];
  state.schema = {};
  state.aggregations = [];
  state.filters = {};
  state.fieldLabels = {};
  state.calculations = { pre: [], post: [] };
  state.availablePostColumns = [];
  state.lastPivot = null;
  state.zones = { rows: [], columns: [], measures: [], filters: [] };
  state.excluded = [];
  aggregatorSelect.innerHTML = '';
  aggregatorSelect.disabled = true;
}

function getActiveUniverse() {
  return state.universes.find((universe) => universe.id === state.activeUniverseId) || null;
}

function serializeCurrentLayout() {
  return {
    rows: [...state.zones.rows],
    columns: [...state.zones.columns],
    filtersZone: [...state.zones.filters],
    filters: deepClone(state.filters),
    measures: [...state.zones.measures],
    measure: state.zones.measures[0] || null,
    aggregator: aggregatorSelect.value || (state.aggregations[0]?.id ?? null),
  };
}

function persistActiveLayout() {
  const universe = getActiveUniverse();
  if (!universe || !state.datasetId) return;
  universe.layout = serializeCurrentLayout();
}

function defaultLayoutFor(meta) {
  return {
    rows: [],
    columns: [],
    filtersZone: [],
    filters: {},
    measures: [],
    measure: null,
    aggregator: meta.aggregations[0]?.id || 'sum',
  };
}

function ensureUniverse(info, layoutOverride = null) {
  let universe = state.universes.find((item) => item.datasetId === info.datasetId);
  if (!universe) {
    universe = {
      id: info.datasetId,
      datasetId: info.datasetId,
      name: info.name,
      layout: layoutOverride ? deepClone(layoutOverride) : defaultLayoutFor(info),
    };
    state.universes.push(universe);
  } else {
    universe.name = info.name;
    if (layoutOverride) {
      universe.layout = deepClone(layoutOverride);
    }
  }
  state.activeUniverseId = universe.id;
  return universe;
}

function applyUniverse(universe) {
  const meta = state.datasets[universe.datasetId];
  if (!meta) {
    updateStatus('Dataset indisponível para esta aba.', 'error');
    return;
  }

  state.activeUniverseId = universe.id;

  resetDatasetState();
  state.datasetId = universe.datasetId;

  const layout = deepClone(universe.layout || defaultLayoutFor(meta));

  state.schema = {};
  state.fieldLabels = {};
  Object.entries(meta.schema || {}).forEach(([field, info]) => {
    const schemaInfo = typeof info === 'object'
      ? { ...info }
      : {
          dtype: info,
          isMeasure: (meta.measures || []).includes(field),
          label: field,
          calculated: false,
        };
    state.schema[field] = schemaInfo;
    registerFieldLabel(field, schemaInfo.label || field);
  });

  state.dimensions = [...(meta.dimensions || [])];
  state.measures = [...(meta.measures || [])];
  state.aggregations = meta.aggregations || [];

  const calculations = ensureDatasetCalculations(meta);
  state.calculations = {
    pre: deepClone(calculations.pre),
    post: deepClone(calculations.post),
  };
  meta.calculations = {
    pre: deepClone(calculations.pre),
    post: deepClone(calculations.post),
  };

  state.availablePostColumns = deepClone(meta.availablePostColumns || []);
  state.lastPivot = null;

  state.filters = layout.filters || {};
  state.zones = {
    rows: [...(layout.rows || [])],
    columns: [...(layout.columns || [])],
    measures: Array.isArray(layout.measures)
      ? Array.from(new Set(layout.measures))
      : layout.measure
        ? [layout.measure]
        : [],
    filters: [...(layout.filtersZone || [])],
  };
  state.excluded = [];

  aggregatorSelect.innerHTML = '';
  populateAggregatorOptions(state.aggregations);
  const aggValue = layout.aggregator || (state.aggregations[0]?.id ?? 'sum');
  if (aggValue) {
    aggregatorSelect.value = aggValue;
  }
  aggregatorSelect.disabled = state.zones.measures.length === 0;

  renderState();

  if (statusDataset) {
    statusDataset.classList.remove('hidden');
    statusDataset.textContent = meta.name;
  }
  datasetMeta.classList.remove('hidden');
  metaRows.textContent = meta.rowCount;
  metaColumns.textContent = meta.columns.length;
  analysisArea.classList.remove('hidden');
}

function renderTabs() {
  if (!tabsContainer) return;
  tabsContainer.innerHTML = '';
  if (!state.universes.length) {
    tabsContainer.classList.add('hidden');
    return;
  }
  tabsContainer.classList.remove('hidden');
  state.universes.forEach((universe) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab-button';
    if (universe.id === state.activeUniverseId) {
      button.classList.add('active');
    }
    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = universe.name || 'Sem nome';
    button.appendChild(label);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.setAttribute('aria-label', `Fechar ${universe.name || 'universo'}`);
    close.textContent = '×';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      removeUniverse(universe.id);
    });
    button.addEventListener('click', () => switchUniverse(universe.id));
    button.appendChild(close);
    tabsContainer.appendChild(button);
  });
}

function switchUniverse(universeId) {
  if (state.activeUniverseId === universeId) {
    return;
  }
  persistActiveLayout();
  const universe = state.universes.find((item) => item.id === universeId);
  if (!universe) {
    updateStatus('Aba selecionada não encontrada.', 'error');
    return;
  }
  applyUniverse(universe);
  renderTabs();
  renderState();
  const layout = universe.layout || {};
  const layoutHasMeasures = Array.isArray(layout.measures)
    ? layout.measures.length
    : layout.measure
      ? 1
      : 0;
  const shouldQuery = Boolean(
    (layout.rows && layout.rows.length) ||
      (layout.columns && layout.columns.length) ||
      (layout.filtersZone && layout.filtersZone.length) ||
      layoutHasMeasures,
  );
  if (shouldQuery) {
    runPivot();
  } else {
    pivotOutput.classList.add('hidden');
    pivotTableContainer.innerHTML = '';
  }
}

function removeUniverse(universeId) {
  persistActiveLayout();
  const index = state.universes.findIndex((item) => item.id === universeId);
  if (index === -1) {
    updateStatus('Aba não encontrada para remoção.', 'error');
    return;
  }

  const [removed] = state.universes.splice(index, 1);
  if (removed) {
    delete state.datasets[removed.datasetId];
    if (state.filterValuesCache[removed.datasetId]) {
      delete state.filterValuesCache[removed.datasetId];
    }
    fetch(buildUrl(`/api/dataset/${removed.datasetId}`), { method: 'DELETE' })
      .then((response) => {
        redirectToLoginIfNeeded(response);
      })
      .catch(() => {});
  }

  const wasActive = state.activeUniverseId === universeId;

  if (!state.universes.length) {
    state.activeUniverseId = null;
    resetDatasetState();
    renderTabs();
    renderState();
    analysisArea.classList.add('hidden');
    pivotOutput.classList.add('hidden');
    pivotTableContainer.innerHTML = '';
    if (statusDataset) {
      statusDataset.classList.add('hidden');
      statusDataset.textContent = '';
    }
    updateStatus('Aguardando carregamento...', 'muted');
    return;
  }

  if (!wasActive) {
    renderTabs();
    return;
  }

  const newIndex = index > 0 ? index - 1 : 0;
  const nextUniverse = state.universes[newIndex];
  state.activeUniverseId = nextUniverse.id;
  applyUniverse(nextUniverse);
  renderTabs();
  renderState();
  const layout = nextUniverse.layout || {};
  const layoutHasMeasures = Array.isArray(layout.measures)
    ? layout.measures.length
    : layout.measure
      ? 1
      : 0;
  const shouldQuery = Boolean(
    (layout.rows && layout.rows.length) ||
      (layout.columns && layout.columns.length) ||
      (layout.filtersZone && layout.filtersZone.length) ||
      layoutHasMeasures
  );
  if (shouldQuery) {
    runPivot();
  } else {
    pivotOutput.classList.add('hidden');
    pivotTableContainer.innerHTML = '';
    updateStatus('Arraste dimensões e medidas para montar sua consulta.', 'muted');
  }
}


function getFilterValuesCache() {
  if (!state.datasetId) {
    return {};
  }
  if (!state.filterValuesCache[state.datasetId]) {
    state.filterValuesCache[state.datasetId] = {};
  }
  return state.filterValuesCache[state.datasetId];
}

function isAssigned(field) {
  return (
    state.zones.rows.includes(field) ||
    state.zones.columns.includes(field) ||
    state.zones.measures.includes(field) ||
    state.zones.filters.includes(field)
  );
}

function makeExcludeButton(field) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chip-action';
  button.setAttribute('aria-label', `Excluir ${field} da análise`);
  button.textContent = '×';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    excludeField(field);
  });
  button.addEventListener('mousedown', (event) => event.stopPropagation());
  return button;
}

function makeFieldChip(field, type) {
  const chip = document.createElement('div');
  chip.className = 'field-chip';
  chip.draggable = true;
  chip.dataset.field = field;
  chip.dataset.type = type;
  chip.dataset.source = 'list';
  chip.addEventListener('dragstart', handleDragStart);

  const meta = state.schema[field] || {};

  const label = document.createElement('span');
  label.className = 'chip-label';
  label.textContent = getFieldLabel(field);
  chip.appendChild(label);

  if (meta.calculated) {
    chip.classList.add('is-calculated');
    chip.dataset.calculated = 'true';
  }

  const actions = document.createElement('div');
  actions.className = 'chip-actions';
  actions.appendChild(makeExcludeButton(field));
  chip.appendChild(actions);

  return chip;
}

function makeExcludedChip(field) {
  const chip = document.createElement('div');
  chip.className = 'field-chip is-excluded';

  const label = document.createElement('span');
  label.className = 'chip-label';
  label.textContent = getFieldLabel(field);
  chip.appendChild(label);

  const actions = document.createElement('div');
  actions.className = 'chip-actions';
  const restore = document.createElement('button');
  restore.type = 'button';
  restore.className = 'chip-action';
  restore.setAttribute('aria-label', `Restaurar o campo ${field}`);
  restore.textContent = '↺';
  restore.addEventListener('click', () => restoreField(field));
  actions.appendChild(restore);
  chip.appendChild(actions);

  return chip;
}

function renderFieldLists() {
  const excludedSet = new Set(state.excluded);
  const meta = state.datasets[state.datasetId] || { dimensions: [], measures: [] };
  const dimensionSource = Array.from(new Set(meta.dimensions || []));
  const measureSource = Array.from(new Set(meta.measures || []));
  const dimensions = dimensionSource.sort((a, b) => getFieldLabel(a).localeCompare(getFieldLabel(b), 'pt-BR', { sensitivity: 'base' }));
  const measures = measureSource.sort((a, b) => getFieldLabel(a).localeCompare(getFieldLabel(b), 'pt-BR', { sensitivity: 'base' }));
  const numericSet = new Set(measures);

  state.dimensions = [...dimensions];
  state.measures = [...measures];

  measureList.innerHTML = '';
  dimensionList.innerHTML = '';

  dimensions.forEach((field) => {
    if (excludedSet.has(field) || isAssigned(field)) {
      return;
    }
    const chip = makeFieldChip(field, 'dimension');
    if (numericSet.has(field)) {
      chip.classList.add('is-numeric');
      chip.dataset.numeric = 'true';
    }
    dimensionList.appendChild(chip);
  });

  measures.forEach((field) => {
    if (excludedSet.has(field) || isAssigned(field)) {
      return;
    }
    const chip = makeFieldChip(field, 'measure');
    measureList.appendChild(chip);
  });

  if (!dimensionList.childElementCount) {
    const placeholder = document.createElement('span');
    placeholder.className = 'placeholder';
    placeholder.textContent = 'Nenhuma dimensão disponível.';
    dimensionList.appendChild(placeholder);
  }

  if (!measureList.childElementCount) {
    const placeholder = document.createElement('span');
    placeholder.className = 'placeholder';
    placeholder.textContent = 'Nenhuma medida numérica disponível.';
    measureList.appendChild(placeholder);
  }
}

function renderExcludedList() {
  if (!excludedGroup) return;
  excludedList.innerHTML = '';
  if (!state.excluded.length) {
    excludedGroup.classList.add('hidden');
    return;
  }
  excludedGroup.classList.remove('hidden');
  state.excluded.forEach((field) => {
    excludedList.appendChild(makeExcludedChip(field));
  });
}


function generateCalculationId(prefix = 'calc') {
  const random = Math.floor(Math.random() * 1e6);
  return `${prefix}_${Date.now()}_${random}`;
}

function getPreCalculationColumns() {
  const meta = getActiveDatasetMeta();
  if (!meta) {
    return [];
  }
  const fields = Array.from(new Set(meta.measures || []));
  return fields.map((field) => ({ field, label: getFieldLabel(field) }));
}

function getPostCalculationColumns() {
  let columns = state.availablePostColumns;
  if (!columns || !columns.length) {
    const meta = getActiveDatasetMeta();
    columns = meta?.availablePostColumns || [];
  }
  return (columns || []).map((item) => ({ ...item }));
}

function renderExpressionChipList(stage, columns) {
  if (!calcExpressionChips || !calcExpressionSuggestions) {
    return;
  }
  calcExpressionChips.innerHTML = '';
  if (!columns.length) {
    calcExpressionSuggestions.classList.add('hidden');
    return;
  }
  calcExpressionSuggestions.classList.remove('hidden');
  columns.forEach((column) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'calc-expression-chip';
    button.textContent = column.label;
    const token = stage === 'pre' ? column.field : column.label;
    button.addEventListener('click', () => insertExpressionToken(token));
    calcExpressionChips.appendChild(button);
  });
}

function findPostColumnLabel(columnKey) {
  const columns = getPostCalculationColumns();
  const match = columns.find((col) => col.key === columnKey);
  return match?.label || columnKey;
}

function formatOperandPlaceholder(input, stage) {
  if (!input) return '0';
  if (input.type === 'column') {
    if (stage === 'pre') {
      return `{${input.field || ''}}`;
    }
    const label = findPostColumnLabel(input.columnKey || input.key);
    return `{${label}}`;
  }
  const value = input.value ?? 0;
  return String(value);
}

function buildExpressionFromLegacy(calc) {
  if (!calc) return '';
  const stage = calc.stage || 'post';
  const operands = (calc.inputs || []).map((entry) => formatOperandPlaceholder(entry, stage));
  const [a, b] = operands;
  switch (calc.operation) {
    case 'add':
      return operands.join(' + ');
    case 'subtract':
      return operands.reduce((expr, operand, index) => (index === 0 ? operand : `${expr} - ${operand}`), '');
    case 'multiply':
      return operands.join(' * ');
    case 'divide':
      return operands.reduce((expr, operand, index) => (index === 0 ? operand : `${expr} / ${operand}`), '');
    case 'percentage': {
      const factor = calc.options?.factor ?? 100;
      return `${a || '0'} / ${b || '1'} * ${factor}`;
    }
    case 'greater_than':
      return `${a || '0'} > ${b || '0'}`;
    case 'less_than':
      return `${a || '0'} < ${b || '0'}`;
    case 'between':
      return `${a || '0'} >= ${calc.options?.lower ?? 0} && ${a || '0'} <= ${calc.options?.upper ?? 0}`;
    default:
      if (operands.length) {
        return operands.join(' + ');
      }
      return '';
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeExpressionText(rawText, stage, columns) {
  let text = rawText.trim();
  if (!text.includes('{')) {
    const sorted = [...columns].sort((a, b) => (b.label?.length || 0) - (a.label?.length || 0));
    sorted.forEach((column) => {
      const searchTerm = column.label || column.field || column.key || '';
      if (!searchTerm) return;
      const placeholder = stage === 'pre' ? `{${column.field}}` : `{${column.label}}`;
      const pattern = new RegExp(`\\b${escapeRegExp(searchTerm)}\\b`, 'g');
      text = text.replace(pattern, placeholder);
    });
  }
  return text;
}

function canonicalizeExpressionPlaceholders(expression, stage, columns) {
  return expression.replace(/\{([^}]+)\}/g, (_, token) => {
    const normalized = token.trim();
    if (!normalized) return '{}';
    if (stage === 'pre') {
      const column = columns.find((col) => col.field === normalized || col.label === normalized);
      if (column?.field) {
        return `{${column.field}}`;
      }
      return `{${normalized}}`;
    }
    const column = columns.find((col) => col.label === normalized || col.key === normalized);
    if (column?.label) {
      return `{${column.label}}`;
    }
    return `{${normalized}}`;
  });
}

function updateExpressionSaveState() {
  if (!calculationDialogSave) return;
  const text = (calcExpressionInput?.value || '').trim();
  const stage = calcStageSelect?.value || 'post';
  const columnsAvailable = stage === 'pre'
    ? getPreCalculationColumns().length > 0
    : getPostCalculationColumns().length > 0;
  const requiresColumns = stage === 'post';
  calculationDialogSave.disabled = !text || (requiresColumns && !columnsAvailable);
}

function updateAvailablePostColumnsFromResult(result) {
  if (!result || !Array.isArray(result.columnKeys)) {
    state.availablePostColumns = [];
    const meta = getActiveDatasetMeta();
    if (meta) {
      meta.availablePostColumns = [];
    }
    return;
  }
  const headers = Array.isArray(result.columnHeaders) ? result.columnHeaders : [];
  const columns = result.columnKeys.map((key, index) => ({
    key,
    label: flattenHeader(headers[index] ?? `Coluna ${index + 1}`),
  }));
  state.availablePostColumns = columns;
  const meta = getActiveDatasetMeta();
  if (meta) {
    meta.availablePostColumns = deepClone(columns);
  }
}

function renderCalculationList() {
  if (!calculationList) {
    return;
  }
  calculationList.innerHTML = '';
  if (!state.datasetId) {
    if (addCalculationBtn) {
      addCalculationBtn.disabled = true;
    }
    const placeholder = document.createElement('p');
    placeholder.className = 'placeholder';
    placeholder.textContent = 'Carregue uma base para criar cálculos.';
    calculationList.appendChild(placeholder);
    return;
  }

  if (addCalculationBtn) {
    addCalculationBtn.disabled = false;
  }

  const calculations = state.calculations || { pre: [], post: [] };
  const total = (calculations.pre?.length || 0) + (calculations.post?.length || 0);
  if (!total) {
    const placeholder = document.createElement('p');
    placeholder.className = 'placeholder';
    placeholder.textContent = 'Nenhuma coluna calculada cadastrada.';
    calculationList.appendChild(placeholder);
    return;
  }

  if (calculations.pre?.length) {
    calculationList.appendChild(makeCalculationGroup('pre', calculations.pre));
  }

  if (calculations.post?.length) {
    calculationList.appendChild(makeCalculationGroup('post', calculations.post));
  }
}

function makeCalculationGroup(stage, items) {
  const wrapper = document.createElement('div');
  wrapper.className = `calculation-group calculation-stage-${stage}`;

  const header = document.createElement('div');
  header.className = 'calculation-group-header';
  const title = document.createElement('span');
  title.className = 'calculation-group-title';
  title.textContent = CALC_STAGE_LABEL[stage] || stage;
  header.appendChild(title);
  wrapper.appendChild(header);

  items.forEach((calc) => {
    wrapper.appendChild(makeCalculationItem(calc, stage));
  });

  return wrapper;
}

function makeCalculationItem(calc, stage) {
  const row = document.createElement('div');
  row.className = 'calculation-item';
  row.dataset.stage = stage;

  const nameSpan = document.createElement('span');
  nameSpan.className = 'calculation-name';
  nameSpan.textContent = calc.name || getFieldLabel(calc.resultField || calc.resultKey || calc.id);
  row.appendChild(nameSpan);

  const detail = document.createElement('span');
  detail.className = 'calculation-detail';
  if (calc.operation === 'expression' && calc.options?.expression) {
    detail.textContent = calc.options.expression;
  } else {
    detail.textContent = CALC_OPERATION_LABEL[calc.operation] || calc.operation;
  }
  row.appendChild(detail);

  const actions = document.createElement('div');
  actions.className = 'calculation-actions';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'chip-action';
  editBtn.setAttribute('aria-label', `Editar cálculo ${calc.name || calc.id}`);
  editBtn.textContent = '✎';
  editBtn.addEventListener('click', () => editCalculation(calc.id, stage));
  actions.appendChild(editBtn);
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'chip-action';
  removeBtn.setAttribute('aria-label', `Remover cálculo ${calc.name || calc.id}`);
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => removeCalculation(calc.id, stage));
  actions.appendChild(removeBtn);
  row.appendChild(actions);

  return row;
}

function removeCalculation(calculationId, stage) {
  const meta = getActiveDatasetMeta();
  if (!meta) {
    return;
  }
  const calculations = ensureDatasetCalculations(meta);
  if (stage === 'pre') {
    const index = calculations.pre.findIndex((item) => item.id === calculationId);
    if (index === -1) {
      return;
    }
    const [removed] = calculations.pre.splice(index, 1);
    if (removed) {
      removeFromZones(removed.resultField);
      meta.measures = (meta.measures || []).filter((field) => field !== removed.resultField);
      state.measures = state.measures.filter((field) => field !== removed.resultField);
      delete meta.schema[removed.resultField];
      delete state.schema[removed.resultField];
      removeFieldLabel(removed.resultField);
      delete state.filters[removed.resultField];
    }
  } else {
    calculations.post = calculations.post.filter((item) => item.id !== calculationId);
  }

  meta.calculations = {
    pre: deepClone(calculations.pre),
    post: deepClone(calculations.post),
  };
  state.calculations = {
    pre: deepClone(calculations.pre),
    post: deepClone(calculations.post),
  };

  renderState();
  persistActiveLayout();
  updateStatus('Cálculo removido.', 'muted');
}

function editCalculation(calculationId, stage) {
  const meta = getActiveDatasetMeta();
  if (!meta) return;
  const calculations = ensureDatasetCalculations(meta);
  const list = stage === 'pre' ? calculations.pre : calculations.post;
  const calc = list.find((item) => item.id === calculationId);
  if (!calc) {
    updateStatus('Cálculo não encontrado para edição.', 'error');
    return;
  }
  openCalculationDialog(calc.stage || stage, calc);
}

function resetCalculationForm(defaultStage = 'post') {
  if (!calculationForm || !calcStageSelect || !calcOperationSelect) {
    return;
  }
  calculationForm.reset();
  editingCalculation = null;
  if (calcStageSelect) {
    calcStageSelect.disabled = false;
  }
  calcOperandNotice.classList.add('hidden');
  if (calcExpressionField) {
    calcExpressionField.classList.add('hidden');
  }
  if (calcExpressionSuggestions) {
    calcExpressionSuggestions.classList.add('hidden');
    if (calcExpressionChips) {
      calcExpressionChips.innerHTML = '';
    }
  }
  if (calcExpressionInput) {
    calcExpressionInput.value = '';
  }
  const stageOption = defaultStage === 'post' && (!state.availablePostColumns || !state.availablePostColumns.length)
    ? 'pre'
    : defaultStage;
  calcStageSelect.value = stageOption;
  calcOperationSelect.value = 'expression';
  calcDecimalsInput.value = '';
  if (calcBetweenLower) calcBetweenLower.value = '';
  if (calcBetweenUpper) calcBetweenUpper.value = '';
  renderCalculationOperands();
  updateExpressionSaveState();
}

function populateCalculationForm(calc) {
  if (!calc || !calcStageSelect || !calcOperationSelect) {
    return;
  }
  calcNameInput.value = calc.name || '';
  calcStageSelect.value = calc.stage || 'post';
  calcStageSelect.disabled = true;
  calcOperationSelect.value = 'expression';
  if (calcDecimalsInput) {
    calcDecimalsInput.value = calc.options?.decimals ?? '';
  }
  if (calcBetweenLower) {
    calcBetweenLower.value = calc.options?.lower ?? '';
  }
  if (calcBetweenUpper) {
    calcBetweenUpper.value = calc.options?.upper ?? '';
  }
  renderCalculationOperands();
  if (calcExpressionInput) {
    if (calc.operation === 'expression') {
      calcExpressionInput.value = calc.options?.expression || '';
    } else {
      calcExpressionInput.value = buildExpressionFromLegacy(calc) || '';
    }
  }
  updateExpressionSaveState();
}

function openCalculationDialog(preferredStage = 'post', calcToEdit = null) {
  if (!state.datasetId || !calculationDialog) {
    updateStatus('Carregue uma base antes de criar cálculos.', 'error');
    return;
  }
  const initialStage = calcToEdit?.stage || preferredStage;
  resetCalculationForm(initialStage);
  editingCalculation = calcToEdit ? deepClone(calcToEdit) : null;
  calculationDialog.classList.remove('hidden');
  calculationDialogTitle.textContent = calcToEdit ? 'Editar coluna calculada' : 'Nova coluna calculada';
  if (editingCalculation) {
    populateCalculationForm(editingCalculation);
  } else {
    renderCalculationOperands();
  }
  dialogBackdrop.classList.remove('hidden');
  calcNameInput.focus();
}

function hideBackdropIfNoDialog() {
  if (filterDialog.classList.contains('hidden') && calculationDialog.classList.contains('hidden')) {
    dialogBackdrop.classList.add('hidden');
  }
}

function closeCalculationDialog() {
  if (!calculationDialog) {
    return;
  }
  calculationDialog.classList.add('hidden');
  calcOperandNotice.classList.add('hidden');
  if (calcStageSelect) {
    calcStageSelect.disabled = false;
  }
  editingCalculation = null;
  hideBackdropIfNoDialog();
}

function renderCalculationOperands() {
  if (!calcStageSelect || !calcOperationSelect) {
    return;
  }
  const stage = calcStageSelect.value;
  const columns = stage === 'pre' ? getPreCalculationColumns() : getPostCalculationColumns();

  if (calcExpressionField) {
    calcExpressionField.classList.remove('hidden');
  }
  if (calcOperandsContainer) {
    calcOperandsContainer.classList.add('hidden');
  }
  const rangeWrapper = document.getElementById('calc-between-range');
  if (rangeWrapper) {
    rangeWrapper.classList.add('hidden');
    if (calcBetweenLower) calcBetweenLower.value = '';
    if (calcBetweenUpper) calcBetweenUpper.value = '';
  }

  if (!columns.length) {
    if (calcExpressionSuggestions) {
      calcExpressionSuggestions.classList.add('hidden');
      if (calcExpressionChips) {
        calcExpressionChips.innerHTML = '';
      }
    }
    calcOperandNotice.textContent = stage === 'post'
      ? 'Execute uma consulta para habilitar colunas do resultado.'
      : 'Nenhuma coluna disponível para a expressão.';
    calcOperandNotice.classList.remove('hidden');
    calculationDialogSave.disabled = stage === 'post';
    updateExpressionSaveState();
    return;
  }

  renderExpressionChipList(stage, columns);
  calcOperandNotice.textContent = 'Clique nos chips ou digite {Nome da Coluna} para montar a expressão.';
  calcOperandNotice.classList.remove('hidden');
  calculationDialogSave.disabled = false;
  updateExpressionSaveState();
}

function collectCalculationFromForm(existingCalc = null) {
  const name = (calcNameInput.value || '').trim();
  const stage = calcStageSelect.value || 'post';
  const operation = calcOperationSelect.value || 'expression';
  if (!name) {
    throw new Error('Informe um nome para o cálculo.');
  }
  const definition = CALC_OPERATION_DEFINITIONS.find((item) => item.id === operation);
  if (!definition) {
    throw new Error('Operação inválida selecionada.');
  }

  const columns = stage === 'pre' ? getPreCalculationColumns() : getPostCalculationColumns();
  if (stage === 'post' && !columns.length) {
    throw new Error('Execute uma consulta para habilitar colunas do resultado.');
  }

  const inputs = Array.isArray(existingCalc?.inputs) ? deepClone(existingCalc.inputs) : [];

  const options = {};
  const decimalsText = calcDecimalsInput.value;
  if (decimalsText !== '') {
    const decimals = Number.parseInt(decimalsText, 10);
    if (Number.isNaN(decimals)) {
      throw new Error('Casas decimais inválidas.');
    }
    options.decimals = decimals;
  }

  const expressionTextRaw = (calcExpressionInput?.value || '').trim();
  if (!expressionTextRaw) {
    throw new Error('Informe a expressão personalizada.');
  }
  const normalizedExpression = normalizeExpressionText(expressionTextRaw, stage, columns);
  options.expression = canonicalizeExpressionPlaceholders(normalizedExpression, stage, columns);

  const calc = {
    id: existingCalc?.id || generateCalculationId(stage === 'pre' ? 'pre' : 'post'),
    name,
    stage,
    operation,
    inputs,
    options,
  };

  if (stage === 'pre') {
    calc.resultField = existingCalc?.resultField || calc.resultField || generateCalculationId('measure');
    calc.resultKey = calc.resultField;
  } else {
    calc.resultKey = existingCalc?.resultKey || calc.resultKey || generateCalculationId('calc');
  }

  return calc;
}

function persistCalculation(calc, existingCalc = null) {
  const meta = getActiveDatasetMeta();
  if (!meta) {
    throw new Error('Dataset não carregado.');
  }
  const calculations = ensureDatasetCalculations(meta);
  if (existingCalc) {
    const targetList = calc.stage === 'pre' ? calculations.pre : calculations.post;
    const idx = targetList.findIndex((item) => item.id === existingCalc.id);
    if (idx !== -1) {
      targetList[idx] = calc;
    } else {
      targetList.push(calc);
    }
    if (calc.stage === 'pre') {
      registerFieldLabel(calc.resultField, calc.name);
      if (meta.schema?.[calc.resultField]) {
        meta.schema[calc.resultField].label = calc.name;
      }
      if (state.schema?.[calc.resultField]) {
        state.schema[calc.resultField].label = calc.name;
      }
    }
  } else {
    if (calc.stage === 'pre') {
      calculations.pre.push(calc);
      meta.measures = Array.from(new Set([...(meta.measures || []), calc.resultField]));
      meta.schema = meta.schema || {};
      meta.schema[calc.resultField] = {
        dtype: 'float64',
        isMeasure: true,
        label: calc.name,
        calculated: true,
      };
      state.schema[calc.resultField] = {
        dtype: 'float64',
        isMeasure: true,
        label: calc.name,
        calculated: true,
      };
      registerFieldLabel(calc.resultField, calc.name);
    } else {
      calculations.post.push(calc);
    }
  }
  meta.calculations = {
    pre: deepClone(calculations.pre),
    post: deepClone(calculations.post),
  };
  state.calculations = {
    pre: deepClone(calculations.pre),
    post: deepClone(calculations.post),
  };
}

function handleCalculationSubmit(event) {
  event.preventDefault();
  try {
    const calc = collectCalculationFromForm(editingCalculation);
    const isEditing = Boolean(editingCalculation);
    persistCalculation(calc, editingCalculation);
    closeCalculationDialog();
    editingCalculation = null;
    renderState();
    persistActiveLayout();
    updateStatus(
      `Cálculo "${calc.name}" ${isEditing ? 'atualizado' : 'criado'}.`,
      'success'
    );
  } catch (error) {
    calcOperandNotice.textContent = error.message;
    calcOperandNotice.classList.remove('hidden');
  }
}
function createFilterButton(field) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'filter-trigger';
  button.setAttribute('aria-label', `Configurar filtro para ${getFieldLabel(field)}`);
  button.textContent = '⚙';
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    openFilterDialog(field);
  });
  return button;
}

function renderDropzone(zoneName) {
  const body = document.querySelector(`.dropzone[data-zone="${zoneName}"] .dropzone-body`);
  if (!body) return;
  body.innerHTML = '';

  const items = state.zones[zoneName];
  if (!items.length) {
    const placeholder = document.createElement('span');
    placeholder.className = 'placeholder';
    placeholder.textContent = PLACEHOLDERS[zoneName];
    body.appendChild(placeholder);
    return;
  }

  items.forEach((field) => {
    const meta = state.schema[field] || {};
    const pill = document.createElement('div');
    pill.className = 'zone-pill';
    pill.dataset.field = field;
    pill.dataset.type = meta.isMeasure ? 'measure' : 'dimension';
    pill.dataset.source = 'zone';
    pill.dataset.zone = zoneName;
    pill.draggable = true;
    pill.addEventListener('dragstart', handleDragStart);

    const baseLabel = getFieldLabel(field);
    const label = document.createElement('span');
    if ((zoneName === 'filters' || zoneName === 'rows' || zoneName === 'columns') && state.filters[field]?.length) {
      pill.classList.add('has-filter');
      label.textContent = `${baseLabel} (${state.filters[field].length})`;
    } else {
      label.textContent = baseLabel;
    }
    pill.appendChild(label);

    if (meta.calculated) {
      pill.classList.add('is-calculated');
      pill.dataset.calculated = 'true';
    }

    if (zoneName === 'filters' || zoneName === 'rows' || zoneName === 'columns') {
      pill.appendChild(createFilterButton(field));
      if (!state.filters[field]) {
        state.filters[field] = [];
      }
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', `Remover ${field} de ${zoneName}`);
    close.textContent = '×';
    close.addEventListener('click', () => {
      removeFromZones(field);
      renderState();
      persistActiveLayout();
    });
    pill.appendChild(close);

    body.appendChild(pill);
  });
}

function renderState() {
  renderFieldLists();
  renderExcludedList();
  renderDropzone('columns');
  renderDropzone('rows');
  renderDropzone('filters');
  renderDropzone('measures');
  renderCalculationList();
  updateAggregatorControl();
}

function clearError() {
  pivotError.classList.add('hidden');
  pivotError.textContent = '';
}

function showError(message) {
  pivotError.textContent = message;
  pivotError.classList.remove('hidden');
  updateStatus(message, 'error');
}

function removeFromZones(field) {
  state.zones.rows = state.zones.rows.filter((item) => item !== field);
  state.zones.columns = state.zones.columns.filter((item) => item !== field);
  state.zones.measures = state.zones.measures.filter((item) => item !== field);
  state.zones.filters = state.zones.filters.filter((item) => item !== field);
  delete state.filters[field];
}

function excludeField(field) {
  removeFromZones(field);
  if (!state.excluded.includes(field)) {
    state.excluded.push(field);
  }
  renderState();
  persistActiveLayout();
  updateStatus(`Campo "${getFieldLabel(field)}" excluído da análise.`, 'muted');
}

function restoreField(field) {
  state.excluded = state.excluded.filter((item) => item !== field);
  renderState();
  persistActiveLayout();
  updateStatus(`Campo "${getFieldLabel(field)}" restaurado.`, 'muted');
}

function handleDragStart(event) {
  const { field, type, source, zone } = event.currentTarget.dataset;
  const payload = JSON.stringify({ field, type, source, zone });
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', payload);
}

function handleDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  let payload;
  try {
    payload = JSON.parse(event.dataTransfer.getData('text/plain'));
  } catch (error) {
    return;
  }

  if (!payload || !payload.field) {
    return;
  }

  const zoneName = event.currentTarget.dataset.zone;
  const { field } = payload;

  state.excluded = state.excluded.filter((item) => item !== field);
  removeFromZones(field);

  if (zoneName === 'measures') {
    if (state.zones.measures.includes(field)) {
      updateStatus(`Medida "${getFieldLabel(field)}" já está selecionada.`, 'muted');
    } else if (state.zones.measures.length >= MAX_MEASURES) {
      updateStatus(`Limite de ${MAX_MEASURES} medidas atingido.`, 'error');
    } else {
      state.zones.measures.push(field);
    }
  } else {
    if (!state.zones[zoneName].includes(field)) {
      state.zones[zoneName].push(field);
    }
  }

  if (zoneName === 'filters') {
    if (!state.filters[field]) {
      state.filters[field] = [];
    }
    updateStatus(`Campo "${getFieldLabel(field)}" adicionado em ${zoneName}.`, 'muted');
    renderState();
    persistActiveLayout();
    openFilterDialog(field);
    return;
  }

  if ((zoneName === 'rows' || zoneName === 'columns') && !state.filters[field]) {
    state.filters[field] = [];
  }

  clearError();
  updateStatus(`Campo "${getFieldLabel(field)}" adicionado em ${zoneName}.`, 'muted');
  renderState();
  persistActiveLayout();
}

function handleDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(event) {
  event.currentTarget.classList.add('drag-over');
}

function handleDragLeave(event) {
  const target = event.relatedTarget;
  if (!target || !event.currentTarget.contains(target)) {
    event.currentTarget.classList.remove('drag-over');
  }
}

function populateAggregatorOptions(aggregations) {
  aggregatorSelect.innerHTML = '';
  aggregations.forEach((agg, index) => {
    const option = document.createElement('option');
    option.value = agg.id;
    option.textContent = agg.label;
    if (agg.format) {
      option.dataset.format = agg.format;
    }
    if (index === 0) {
      option.selected = true;
    }
    aggregatorSelect.appendChild(option);
  });
}

function getAggregatorFormatById(id) {
  const found = state.aggregations.find((agg) => agg.id === id);
  return found?.format || 'number';
}

function updateAggregatorControl() {
  const hasMeasure = state.zones.measures.length > 0;
  aggregatorSelect.disabled = !hasMeasure;
  if (!hasMeasure) {
    return;
  }
  const current = aggregatorSelect.value;
  const available = Array.from(aggregatorSelect.options).map((option) => option.value);
  if (!available.includes(current) && available.length) {
    aggregatorSelect.value = available[0];
  }
}

function setDataset(info, layoutOverride = null) {
  persistActiveLayout();

  if (datasetInfo) {
    datasetInfo.classList.add('hidden');
    datasetInfo.textContent = '';
  }

  const previous = state.datasets[info.datasetId] || {};
  const previousCalculations = ensureDatasetCalculations(previous);
  const calculations = {
    pre: deepClone(previousCalculations.pre),
    post: deepClone(previousCalculations.post),
  };

  const measures = Array.from(new Set(info.measures || []));
  const incomingSchema = info.schema || {};
  const existingSchema = previous.schema || {};
  const schema = {};
  Object.entries(incomingSchema).forEach(([field, dtype]) => {
    const previousInfo = typeof existingSchema[field] === 'object' ? existingSchema[field] : {};
    schema[field] = {
      dtype: dtype || previousInfo.dtype || null,
      isMeasure: measures.includes(field),
      label: previousInfo.label || field,
      calculated: Boolean(previousInfo.calculated),
    };
  });

  calculations.pre.forEach((calc) => {
    if (!schema[calc.resultField]) {
      schema[calc.resultField] = {
        dtype: 'float64',
        isMeasure: true,
        label: calc.name,
        calculated: true,
      };
      if (!measures.includes(calc.resultField)) {
        measures.push(calc.resultField);
      }
    }
  });

  const datasetEntry = {
    id: info.datasetId,
    datasetId: info.datasetId,
    name: info.name,
    columns: info.columns,
    dimensions: info.dimensions || info.columns || [],
    measures,
    schema,
    rowCount: info.rowCount,
    aggregations: info.aggregations || [],
    calculations,
    availablePostColumns: deepClone(previous.availablePostColumns || []),
  };

  state.datasets[info.datasetId] = datasetEntry;

  if (!state.filterValuesCache[info.datasetId]) {
    state.filterValuesCache[info.datasetId] = {};
  }

  const universe = ensureUniverse(datasetEntry, layoutOverride);
  applyUniverse(universe);
  renderTabs();
  renderState();

  const layout = universe.layout || {};
  const layoutHasMeasures = Array.isArray(layout.measures)
    ? layout.measures.length
    : layout.measure
      ? 1
      : 0;
  const shouldQuery = Boolean(
    (layout.rows && layout.rows.length) ||
      (layout.columns && layout.columns.length) ||
      (layout.filtersZone && layout.filtersZone.length) ||
      layoutHasMeasures,
  );

  if (shouldQuery) {
    runPivot();
  } else {
    pivotOutput.classList.add('hidden');
    pivotTableContainer.innerHTML = '';
    updateStatus('Arraste dimensões e medidas para montar sua consulta.', 'muted');
  }
}

function handleFileSelection() {
  const files = datasetFileInput.files || [];
  if (!files.length) {
    if (datasetInfo) {
      datasetInfo.classList.add('hidden');
      datasetInfo.textContent = '';
    }
    return;
  }
  const file = files[0];
  if (datasetInfo) {
    datasetInfo.textContent = `Arquivo selecionado: ${file.name}`;
    datasetInfo.classList.remove('hidden');
  }
  if (typeof uploadForm.requestSubmit === 'function') {
    uploadForm.requestSubmit();
  } else {
    const event = new Event('submit', { cancelable: true });
    if (uploadForm.dispatchEvent(event)) {
      handleUpload(event);
    }
  }
}

async function handleUpload(event) {
  event.preventDefault();
  if (!datasetFileInput.files.length) {
    datasetFileInput.focus();
    return;
  }

  const formData = new FormData();
  formData.append('file', datasetFileInput.files[0]);

  try {
    const response = await fetch(buildUrl('/api/upload'), {
      method: 'POST',
      body: formData,
    });
    if (redirectToLoginIfNeeded(response)) {
      return;
    }
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Falha ao carregar arquivo.');
    }
    setDataset(result);
  } catch (error) {
    datasetInfo.classList.remove('hidden');
    datasetInfo.innerHTML = `<span class="error">${error.message}</span>`;
    analysisArea.classList.add('hidden');
    pivotOutput.classList.add('hidden');
    updateStatus(error.message, 'error');
  } finally {
    uploadForm.reset();
  }
}

function flattenHeader(item) {
  if (!Array.isArray(item)) {
    return formatLabel(item);
  }
  if (!item.length) {
    return 'Total';
  }
  return item.map((value) => formatLabel(value)).join('\n');
}

function renderPivotTable(data) {
  pivotSummary.classList.add('hidden');
  pivotSummary.innerHTML = '';

  const valueFormat = data.valueFormat || getAggregatorFormatById(data.aggregator);
  const currencyFormatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
  const numberFormatter = new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });

  const formatValue = (raw) => {
    if (raw === null || raw === undefined) {
      return '';
    }
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) {
        return '';
      }
      return valueFormat === 'currency' ? currencyFormatter.format(raw) : numberFormatter.format(raw);
    }
    if (raw instanceof Date) {
      return raw.toLocaleDateString('pt-BR');
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed.length) {
        return '';
      }
      const numeric = Number(trimmed.replace(',', '.'));
      if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
        return valueFormat === 'currency' ? currencyFormatter.format(numeric) : numberFormatter.format(numeric);
      }
      return trimmed;
    }
    const numeric = Number(raw);
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
      return valueFormat === 'currency' ? currencyFormatter.format(numeric) : numberFormatter.format(numeric);
    }
    return String(raw);
  };

  const summaryEntries = data.summaryValues && typeof data.summaryValues === 'object'
    ? Object.entries(data.summaryValues)
    : [];

  const hasRowDims = Array.isArray(data.rows) && data.rows.length > 0;
  const hasColumnDims = Array.isArray(data.columns) && data.columns.length > 0;
  const hasDataRows = Array.isArray(data.values) && data.values.length > 0;

  if ((!hasRowDims && !hasColumnDims) || !hasDataRows) {
    if (summaryEntries.length) {
      let summaryHtml = '<table class="summary-table"><thead><tr><th>Medida</th><th>Valor</th></tr></thead><tbody>';
      summaryEntries.forEach(([label, value]) => {
        summaryHtml += `<tr><td>${formatLabel(label)}</td><td>${formatValue(value)}</td></tr>`;
      });
      summaryHtml += '</tbody></table>';
      pivotSummary.innerHTML = summaryHtml;
    } else {
      const summaryValue = data.summaryValue ?? data.grandTotal;
      pivotSummary.innerHTML = `<p><strong>Total:</strong> ${formatValue(summaryValue)}</p>`;
    }
    pivotSummary.classList.remove('hidden');
    pivotTableContainer.innerHTML = '';
    pivotOutput.classList.remove('hidden');
    return;
  }

  const columnKeys = Array.isArray(data.columnKeys) ? data.columnKeys : [];
  const calculatedKeys = new Set(
    Array.isArray(data.calculations?.post)
      ? data.calculations.post.map((calc) => calc.resultKey)
      : [],
  );
  const valueHeaders = Array.isArray(data.columnHeaders) ? data.columnHeaders : [];
  const rowHeaderCount = Math.max(1, data.rows.length);
  const shouldRenderValueColumns = hasColumnDims || valueHeaders.length > 1;

  const table = document.createElement('table');
  table.className = 'pivot-table';

  const thead = document.createElement('thead');

  if (hasColumnDims && valueHeaders.length) {
    const columnsTitleRow = document.createElement('tr');
    for (let i = 0; i < rowHeaderCount; i += 1) {
      const th = document.createElement('th');
      th.textContent = '';
      columnsTitleRow.appendChild(th);
    }
    const columnsHead = document.createElement('th');
    columnsHead.colSpan = Math.max(valueHeaders.length, 1);
    columnsHead.textContent = data.columns.map((value) => formatLabel(value)).join(' / ');
    columnsTitleRow.appendChild(columnsHead);
    const totalTitle = document.createElement('th');
    totalTitle.textContent = 'Total';
    columnsTitleRow.appendChild(totalTitle);
    thead.appendChild(columnsTitleRow);
  }

  const headerRow = document.createElement('tr');

  for (let i = 0; i < rowHeaderCount; i += 1) {
    const th = document.createElement('th');
    if (data.rows[i]) {
      th.textContent = formatLabel(data.rows[i]);
    } else if (!data.rows.length && i === 0) {
      th.textContent = 'Medida';
    } else {
      th.textContent = '';
    }
    headerRow.appendChild(th);
  }

  if (shouldRenderValueColumns) {
    valueHeaders.forEach((header, index) => {
      const th = document.createElement('th');
      th.textContent = flattenHeader(header);
      if (calculatedKeys.has(columnKeys[index])) {
        th.classList.add('is-calculated');
      }
      headerRow.appendChild(th);
    });
  }

  const totalTh = document.createElement('th');
  totalTh.textContent = 'Total';
  headerRow.appendChild(totalTh);

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  data.values.forEach((rowValues, rowIndex) => {
    const tr = document.createElement('tr');

    const headerValues = Array.isArray(data.rowHeaders[rowIndex]) ? data.rowHeaders[rowIndex] : [];
    const headerParts = headerValues.length ? headerValues : ['Total'];

    for (let i = 0; i < rowHeaderCount; i += 1) {
      const td = document.createElement('td');
      td.classList.add('row-header-cell');
      const headerValue = headerParts[i];
      if (headerValue === undefined) {
        td.textContent = '';
      } else if (headerValue === 'Total') {
        td.textContent = 'Total';
      } else {
        td.textContent = formatLabel(headerValue);
      }
      tr.appendChild(td);
    }

    if (shouldRenderValueColumns) {
      valueHeaders.forEach((header, columnIndex) => {
        const td = document.createElement('td');
        if (calculatedKeys.has(columnKeys[columnIndex])) {
          td.classList.add('is-calculated');
        }
        const value = Array.isArray(rowValues) ? rowValues[columnIndex] : undefined;
        td.textContent = formatValue(value);
        tr.appendChild(td);
      });
    }

    const totalCell = document.createElement('td');
    totalCell.textContent = formatValue(data.rowTotals[rowIndex]);
    tr.appendChild(totalCell);

    tbody.appendChild(tr);
  });

  const totalsRow = document.createElement('tr');
  const totalLabelCell = document.createElement('td');
  totalLabelCell.colSpan = rowHeaderCount;
  totalLabelCell.textContent = 'Total';
  totalsRow.appendChild(totalLabelCell);

  if (shouldRenderValueColumns) {
    valueHeaders.forEach((header, columnIndex) => {
      const td = document.createElement('td');
      if (calculatedKeys.has(columnKeys[columnIndex])) {
        td.classList.add('is-calculated');
      }
      const totalValue = Array.isArray(data.columnTotals) ? data.columnTotals[columnIndex] : undefined;
      td.textContent = formatValue(totalValue);
      totalsRow.appendChild(td);
    });
  }

  const grandTotalCell = document.createElement('td');
  grandTotalCell.textContent = formatValue(data.grandTotal);
  totalsRow.appendChild(grandTotalCell);

  tbody.appendChild(totalsRow);
  table.appendChild(tbody);

  pivotTableContainer.innerHTML = '';
  pivotTableContainer.appendChild(table);
  pivotOutput.classList.remove('hidden');
}

async function runPivot() {
  if (!state.datasetId) {
    showError('Carregue uma base antes de executar a consulta.');
    return;
  }

  const measures = [...state.zones.measures];
  if (!measures.length) {
    showError('Selecione pelo menos uma medida numérica.');
    return;
  }

  const payload = {
    datasetId: state.datasetId,
    rows: state.zones.rows,
    columns: state.zones.columns,
    measures,
    measure: measures[0],
    aggregator: aggregatorSelect.value || state.aggregations[0]?.id || 'sum',
    filters: state.filters,
  };
  const calculationPayload = state.calculations || { pre: [], post: [] };
  payload.preCalculations = deepClone(calculationPayload.pre || []);
  payload.postCalculations = deepClone(calculationPayload.post || []);

  try {
    updateStatus('Executando consulta...', 'muted');
    const response = await fetch(buildUrl('/api/pivot'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (redirectToLoginIfNeeded(response)) {
      return;
    }
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Falha ao gerar tabela dinâmica.');
    }
    clearError();
    renderPivotTable(result);
    state.lastPivot = result;
    if (result.calculations) {
      state.calculations = {
        pre: deepClone(result.calculations.pre || []),
        post: deepClone(result.calculations.post || []),
      };
      const meta = getActiveDatasetMeta();
      if (meta) {
        meta.calculations = deepClone(state.calculations);
      }
    }
    updateAvailablePostColumnsFromResult(result);
    renderCalculationList();
    if (calculationDialog && !calculationDialog.classList.contains('hidden')) {
      renderCalculationOperands();
    }
    updateStatus('Consulta atualizada.', 'success');
    persistActiveLayout();
  } catch (error) {
    showError(error.message);
    pivotOutput.classList.add('hidden');
    state.availablePostColumns = [];
    const meta = getActiveDatasetMeta();
    if (meta) {
      meta.availablePostColumns = [];
    }
    if (calculationDialog && !calculationDialog.classList.contains('hidden')) {
      renderCalculationOperands();
    }
  }
}

function startNewQuery() {
  if (!state.datasetId) {
    updateStatus('Carregue uma base para iniciar uma consulta.', 'muted');
    return;
  }
  state.filters = {};
  state.zones = {
    rows: [],
    columns: [],
    measures: [],
    filters: [],
  };
  state.availablePostColumns = [];
  state.lastPivot = null;
  const meta = getActiveDatasetMeta();
  if (meta) {
    meta.availablePostColumns = [];
  }
  renderState();
  pivotOutput.classList.add('hidden');
  pivotTableContainer.innerHTML = '';
  updateStatus('Layout limpo. Arraste campos para começar.', 'muted');
  persistActiveLayout();
}

function getFilterOptions(field) {
  const cache = getFilterValuesCache();
  return cache[field] || [];
}

function setFilterOptions(field, values) {
  const cache = getFilterValuesCache();
  cache[field] = values;
}

function buildFilterOption(value, isChecked) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.value = value;
  input.checked = isChecked;
  label.appendChild(input);
  label.appendChild(document.createTextNode(value));
  return label;
}

function renderFilterDialogOptions(field, values) {
  filterDialogBody.innerHTML = '';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Buscar valores';
  search.className = 'filter-search';
  filterDialogBody.appendChild(search);

  const container = document.createElement('div');
  container.className = 'filter-options';
  const selected = new Set(state.filters[field] || []);
  values.forEach((value) => {
    container.appendChild(buildFilterOption(value, selected.has(value)));
  });
  filterDialogBody.appendChild(container);

  search.addEventListener('input', () => {
    const term = search.value.toLowerCase();
    container.querySelectorAll('label').forEach((label) => {
      const match = label.textContent.toLowerCase().includes(term);
      label.style.display = match ? 'flex' : 'none';
    });
  });
}

async function openFilterDialog(field) {
  if (!state.datasetId) return;
  activeFilterField = field;
  filterDialogTitle.textContent = `Filtro: ${getFieldLabel(field)}`;
  dialogBackdrop.classList.remove('hidden');
  filterDialog.classList.remove('hidden');

  const cache = getFilterValuesCache();
  if (!cache[field]) {
    try {
      const params = new URLSearchParams({ datasetId: state.datasetId, field });
      const response = await fetch(buildUrl(`/api/filter-values?${params.toString()}`));
      if (redirectToLoginIfNeeded(response)) {
        return;
      }
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Não foi possível carregar valores.');
      }
      setFilterOptions(field, result.values || []);
    } catch (error) {
      filterDialogBody.innerHTML = `<p class="error">${error.message}</p>`;
      return;
    }
  }

  renderFilterDialogOptions(field, getFilterOptions(field));
}

function closeFilterDialog() {
  filterDialog.classList.add('hidden');
  filterDialogBody.innerHTML = '';
  activeFilterField = null;
  hideBackdropIfNoDialog();
}

function handleBackdropClick(event) {
  if (event.target !== dialogBackdrop) {
    return;
  }
  if (!filterDialog.classList.contains('hidden')) {
    closeFilterDialog();
  }
  if (!calculationDialog.classList.contains('hidden')) {
    closeCalculationDialog();
  }
}

function applyFilterDialog() {
  if (!activeFilterField) {
    closeFilterDialog();
    return;
  }
  const selectedValues = Array.from(
    filterDialogBody.querySelectorAll('input[type="checkbox"]:checked'),
  ).map((input) => input.value);

  if (selectedValues.length) {
    state.filters[activeFilterField] = selectedValues;
    updateStatus(`Filtro aplicado em "${activeFilterField}".`, 'muted');
  } else {
    delete state.filters[activeFilterField];
    updateStatus(`Filtro removido de "${activeFilterField}".`, 'muted');
  }
  renderState();
  persistActiveLayout();
  closeFilterDialog();
}

async function exportPivot(format) {
  if (!state.datasetId) {
    showError('Carregue uma base antes de exportar.');
    return;
  }
  const measures = [...state.zones.measures];
  if (!measures.length) {
    showError('Selecione pelo menos uma medida para exportar.');
    return;
  }

  const payload = {
    datasetId: state.datasetId,
    rows: state.zones.rows,
    columns: state.zones.columns,
    measures,
    measure: measures[0],
    aggregator: aggregatorSelect.value || state.aggregations[0]?.id || 'sum',
    filters: state.filters,
    format,
  };
  const calculationPayload = state.calculations || { pre: [], post: [] };
  payload.preCalculations = deepClone(calculationPayload.pre || []);
  payload.postCalculations = deepClone(calculationPayload.post || []);

  try {
    updateStatus(`Gerando exportação (${format.toUpperCase()})...`, 'muted');
    const response = await fetch(buildUrl('/api/export'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (redirectToLoginIfNeeded(response)) {
      return;
    }

    if (!response.ok) {
      const errorBody = await response.json();
      throw new Error(errorBody.error || 'Falha ao exportar.');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const disposition = response.headers.get('Content-Disposition');
    let filename = `pivot.${format === 'excel' ? 'xlsx' : 'pdf'}`;
    if (disposition) {
      const match = /filename="?([^";]+)"?/i.exec(disposition);
      if (match) {
        filename = match[1];
      }
    }
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    updateStatus(`Arquivo (${format.toUpperCase()}) gerado com sucesso.`, 'success');
  } catch (error) {
    showError(error.message);
  }
}




function initializeEvents() {
  uploadForm.addEventListener('submit', handleUpload);
  datasetFileInput.addEventListener('change', handleFileSelection);
  runPivotBtn.addEventListener('click', runPivot);
  toolbarUploadBtn.addEventListener('click', () => datasetFileInput.click());
  toolbarNewBtn.addEventListener('click', startNewQuery);
  toolbarRefreshBtn.addEventListener('click', runPivot);
  filterDialogClose.addEventListener('click', closeFilterDialog);
  filterDialogCancel.addEventListener('click', closeFilterDialog);
  filterDialogApply.addEventListener('click', applyFilterDialog);
  dialogBackdrop.addEventListener('click', handleBackdropClick);
  if (addCalculationBtn) {
    addCalculationBtn.addEventListener('click', () => {
      const preferredStage = state.availablePostColumns && state.availablePostColumns.length ? 'post' : 'pre';
      openCalculationDialog(preferredStage);
    });
  }
  if (calculationDialogClose) {
    calculationDialogClose.addEventListener('click', closeCalculationDialog);
  }
  if (calculationDialogCancel) {
    calculationDialogCancel.addEventListener('click', (event) => {
      event.preventDefault();
      closeCalculationDialog();
    });
  }
  if (calculationForm) {
    calculationForm.addEventListener('submit', handleCalculationSubmit);
  }
  if (calcStageSelect) {
    calcStageSelect.addEventListener('change', renderCalculationOperands);
  }
  if (calcOperationSelect) {
    calcOperationSelect.addEventListener('change', renderCalculationOperands);
  }
  if (calcExpressionInput) {
    calcExpressionInput.addEventListener('input', updateExpressionSaveState);
  }
  exportButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const format = button.dataset.export;
      exportPivot(format);
    });
  });
  aggregatorSelect.addEventListener('change', () => {
    clearError();
    persistActiveLayout();
  });
  dropzones.forEach((zone) => {
    zone.addEventListener('dragover', handleDragOver);
    zone.addEventListener('drop', handleDrop);
    zone.addEventListener('dragenter', handleDragEnter);
    zone.addEventListener('dragleave', handleDragLeave);
  });
}

resetDatasetState();
renderState();
renderTabs();
initializeEvents();
