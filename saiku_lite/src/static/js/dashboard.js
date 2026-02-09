const uploadButton = document.getElementById('dashboard-upload-btn');
const uploadInput = document.getElementById('dashboard-upload-input');
const uploadName = document.getElementById('dashboard-upload-name');
const datasetSelect = document.getElementById('dashboard-dataset');
const updatedAtLabel = document.getElementById('dashboard-updated');
const warningBox = document.getElementById('dashboard-warning');
const messageBox = document.getElementById('dashboard-messages');

const filterSelects = {
  ugr: document.getElementById('filter-ugr'),
  pi: document.getElementById('filter-pi'),
  descricao: document.getElementById('filter-descricao'),
  status: document.getElementById('filter-status'),
  cnpj: document.getElementById('filter-cnpj'),
  month: document.getElementById('filter-month'),
};

const clearFiltersBtn = document.getElementById('filters-clear');

const kpiElements = {
  totalEstimado: document.getElementById('kpi-total-estimado'),
  empenhado: document.getElementById('kpi-empenhado'),
  executado: document.getElementById('kpi-executado'),
  execucaoPercentual: document.getElementById('kpi-execucao'),
  contratosVencendo: document.getElementById('kpi-vencer'),
  contratosVencidos: document.getElementById('kpi-vencidos'),
};

const chartModeButtons = document.querySelectorAll('.chart-toggle .toggle-button');
const alertsTableBody = document.querySelector('#alerts-table tbody');
const heatmapTable = document.getElementById('heatmap-table');
const dataTable = document.getElementById('dashboard-data-table');
const dataTableHead = dataTable.querySelector('thead');
const dataTableBody = dataTable.querySelector('tbody');
const tableSearchInput = document.getElementById('table-search');
const tableCountLabel = document.getElementById('table-count');

const exportButtons = document.querySelectorAll('.export-actions button[data-export-target]');

const simUGRSelect = document.getElementById('sim-ugr');
const simFieldSelect = document.getElementById('sim-field');
const simDeltaInput = document.getElementById('sim-delta');
const simAddButton = document.getElementById('sim-add');
const simClearButton = document.getElementById('sim-clear');
const simList = document.getElementById('simulation-list');
const simDeltaPlanejado = document.getElementById('sim-delta-planejado');
const simDeltaExecutado = document.getElementById('sim-delta-executado');
const simDeltaEmpenhado = document.getElementById('sim-delta-empenhado');

const KPI_KEYS = [
  'totalEstimado',
  'empenhado',
  'executado',
  'execucaoPercentual',
  'contratosVencendo',
  'contratosVencidos',
];

const state = {
  datasetId: null,
  datasets: [],
  filters: {
    ugr: [],
    pi: [],
    descricao: [],
    status: [],
    cnpj: [],
    month: [],
  },
  filterOptions: {
    ugr: [],
    pi: [],
    descricao: [],
    status: [],
    cnpj: [],
    month: [],
  },
  scenario: {
    adjustments: [],
  },
  scenarioSummary: {
    deltaPlanejado: 0,
    deltaExecutado: 0,
    deltaEmpenhado: 0,
  },
  chartMode: 'total',
  charts: {
    mensal: null,
    descricao: null,
    ugr: null,
    planejado: null,
  },
  tableColumns: [],
  tableData: [],
  tableSort: { column: null, direction: 'asc' },
  searchTerm: '',
  isLoading: false,
};

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DASHBOARD_BASE_PATH = (() => {
  const raw = window.SAIKU_BASE_PATH || '';
  if (!raw || raw === '/') {
    return '';
  }
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
})();

function buildDashboardUrl(path) {
  if (!path) {
    return DASHBOARD_BASE_PATH || '/';
  }
  let normalized = path;
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  if (!DASHBOARD_BASE_PATH) {
    return normalized;
  }
  return `${DASHBOARD_BASE_PATH}${normalized}`;
}

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return currencyFormatter.format(Number(value));
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return `${percentFormatter.format(Number(value))}%`;
}

function redirectToLoginIfNeeded(response) {
  if (!response) return false;
  if (response.headers && response.headers.get('X-Force-Password-Change') === '1') {
    window.location.href = buildDashboardUrl(`/change-password?next=${encodeURIComponent(window.location.pathname)}`);
    return true;
  }
  if (response.status === 401) {
    window.location.href = buildDashboardUrl(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    return true;
  }
  return false;
}

function setLoading(isLoading) {
  state.isLoading = isLoading;
  document.body.classList.toggle('loading', isLoading);
}

function showMessage(message, tone = 'error') {
  if (!messageBox) return;
  messageBox.hidden = false;
  messageBox.textContent = message;
  messageBox.className = `card dashboard-message ${tone}`;
}

function clearMessage() {
  if (!messageBox) return;
  messageBox.hidden = true;
  messageBox.textContent = '';
  messageBox.className = 'card';
}

function populateDatasetOptions(datasets, selectedId) {
  state.datasets = datasets || [];
  datasetSelect.innerHTML = '';
  state.datasets.forEach((dataset) => {
    const option = document.createElement('option');
    option.value = dataset.id;
    option.textContent = dataset.name || dataset.id;
    datasetSelect.appendChild(option);
  });
  if (selectedId && state.datasets.some((dataset) => dataset.id === selectedId)) {
    datasetSelect.value = selectedId;
  } else if (state.datasets.length) {
    datasetSelect.value = state.datasets[0].id;
    state.datasetId = datasetSelect.value;
  } else {
    datasetSelect.disabled = true;
  }
  datasetSelect.disabled = state.datasets.length === 0;
}

function populateMultiSelect(select, options, selectedValues = []) {
  if (!select) return;
  const previousSelection = new Set(selectedValues.length ? selectedValues : Array.from(select.selectedOptions).map((option) => option.value));
  select.innerHTML = '';
  options.forEach((optionValue) => {
    const option = document.createElement('option');
    if (typeof optionValue === 'object') {
      option.value = optionValue.key;
      option.textContent = optionValue.label || optionValue.key;
    } else {
      option.value = optionValue;
      option.textContent = optionValue;
    }
    if (previousSelection.has(option.value)) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

function updateFilterOptions(filterOptions) {
  state.filterOptions = filterOptions || state.filterOptions;
  populateMultiSelect(filterSelects.ugr, state.filterOptions.ugr || [], state.filters.ugr);
  populateMultiSelect(filterSelects.pi, state.filterOptions.pi || [], state.filters.pi);
  populateMultiSelect(filterSelects.descricao, state.filterOptions.descricao || [], state.filters.descricao);
  populateMultiSelect(filterSelects.status, state.filterOptions.status || [], state.filters.status);
  populateMultiSelect(filterSelects.cnpj, state.filterOptions.cnpj || [], state.filters.cnpj);
  populateMultiSelect(filterSelects.month, state.filterOptions.month || [], state.filters.month);

  populateMultiSelect(simUGRSelect, state.filterOptions.ugr || [], state.filters.ugr);
}

function getSelectedValues(select) {
  if (!select) return [];
  return Array.from(select.selectedOptions).map((option) => option.value);
}

function updateFiltersFromUI() {
  state.filters.ugr = getSelectedValues(filterSelects.ugr);
  state.filters.pi = getSelectedValues(filterSelects.pi);
  state.filters.descricao = getSelectedValues(filterSelects.descricao);
  state.filters.status = getSelectedValues(filterSelects.status);
  state.filters.cnpj = getSelectedValues(filterSelects.cnpj);
  state.filters.month = getSelectedValues(filterSelects.month);
}

function resetFilters() {
  Object.keys(filterSelects).forEach((key) => {
    const select = filterSelects[key];
    if (!select) return;
    Array.from(select.options).forEach((option) => {
      option.selected = false;
    });
  });
  state.filters = { ugr: [], pi: [], descricao: [], status: [], cnpj: [], month: [] };
}

function renderWarnings(warnings) {
  if (!warningBox) return;
  if (warnings && warnings.length) {
    warningBox.classList.remove('hidden');
    warningBox.innerHTML = '';
    const list = document.createElement('ul');
    warnings.forEach((warning) => {
      const item = document.createElement('li');
      item.textContent = warning;
      list.appendChild(item);
    });
    warningBox.appendChild(list);
  } else {
    warningBox.classList.add('hidden');
    warningBox.innerHTML = '';
  }
}

function renderKpis(kpis) {
  if (!kpis) {
    KPI_KEYS.forEach((key) => {
      if (kpiElements[key]) {
        kpiElements[key].textContent = '—';
      }
    });
    return;
  }
  if (kpiElements.totalEstimado) {
    kpiElements.totalEstimado.textContent = formatCurrency(kpis.totalEstimado);
  }
  if (kpiElements.empenhado) {
    kpiElements.empenhado.textContent = formatCurrency(kpis.empenhado);
  }
  if (kpiElements.executado) {
    kpiElements.executado.textContent = formatCurrency(kpis.executado);
  }
  if (kpiElements.execucaoPercentual) {
    kpiElements.execucaoPercentual.textContent = formatPercent(kpis.execucaoPercentual);
  }
  if (kpiElements.contratosVencendo) {
    kpiElements.contratosVencendo.textContent = Number(kpis.contratosVencendo || 0).toString();
  }
  if (kpiElements.contratosVencidos) {
    kpiElements.contratosVencidos.textContent = Number(kpis.contratosVencidos || 0).toString();
  }
}

function renderAlerts(alerts) {
  alertsTableBody.innerHTML = '';
  if (!alerts || !alerts.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 7;
    cell.className = 'muted';
    cell.textContent = 'Nenhum alerta cadastrado para os filtros atuais.';
    row.appendChild(cell);
    alertsTableBody.appendChild(row);
    return;
  }

  alerts.forEach((alert) => {
    const row = document.createElement('tr');
    row.classList.add(`severity-${alert.severity || 'info'}`);

    const iconCell = document.createElement('td');
    iconCell.textContent = alert.icon || '';
    row.appendChild(iconCell);

    const descricaoCell = document.createElement('td');
    descricaoCell.textContent = alert.descricao || '—';
    row.appendChild(descricaoCell);

    const ugrCell = document.createElement('td');
    ugrCell.textContent = alert.ugr || '—';
    row.appendChild(ugrCell);

    const piCell = document.createElement('td');
    piCell.textContent = alert.pi || '—';
    row.appendChild(piCell);

    const statusCell = document.createElement('td');
    statusCell.textContent = alert.status || '—';
    row.appendChild(statusCell);

    const vigenciaCell = document.createElement('td');
    vigenciaCell.textContent = alert.vigencia || '—';
    row.appendChild(vigenciaCell);

    const motivoCell = document.createElement('td');
    motivoCell.textContent = alert.motivo || '—';
    row.appendChild(motivoCell);

    alertsTableBody.appendChild(row);
  });
}

function createOrUpdateChart(reference, canvas, config) {
  if (!canvas) return null;
  if (reference) {
    reference.destroy();
  }
  return new Chart(canvas, config);
}

function renderCharts(charts) {
  if (!charts) {
    Object.values(state.charts).forEach((chart) => chart && chart.destroy());
    state.charts = { mensal: null, descricao: null, ugr: null, planejado: null };
    return;
  }

  const monthlyCanvas = document.getElementById('chart-mensal');
  const descricaoCanvas = document.getElementById('chart-descricao');
  const ugrCanvas = document.getElementById('chart-ugr');
  const planejadoCanvas = document.getElementById('chart-planejado');

  if (monthlyCanvas) {
    state.charts.mensal = createOrUpdateChart(state.charts.mensal, monthlyCanvas, {
      type: 'line',
      data: {
        labels: charts.execucaoMensal?.labels || [],
        datasets: [
          {
            label: 'Executado',
            data: charts.execucaoMensal?.values || [],
            borderColor: '#c94b32',
            backgroundColor: 'rgba(201, 75, 50, 0.15)',
            tension: 0.25,
            fill: true,
            pointRadius: 4,
            pointBackgroundColor: '#c94b32',
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => ` ${formatCurrency(context.raw)}`,
            },
          },
        },
        scales: {
          y: {
            ticks: {
              callback: (value) => formatCurrency(value),
            },
          },
        },
      },
    });
  }

  if (descricaoCanvas) {
    state.charts.descricao = createOrUpdateChart(state.charts.descricao, descricaoCanvas, {
      type: 'doughnut',
      data: {
        labels: charts.distribuicaoDescricao?.labels || [],
        datasets: [
          {
            data: charts.distribuicaoDescricao?.values || [],
            backgroundColor: [
              '#c94b32',
              '#5b68c5',
              '#38726c',
              '#f0a202',
              '#8c4a7c',
              '#d97f30',
              '#33658a',
              '#6f4f8b',
              '#1d7874',
              '#4361ee',
              '#a83279',
            ],
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'bottom',
          },
          tooltip: {
            callbacks: {
              label: (context) => ` ${context.label}: ${formatCurrency(context.raw)}`,
            },
          },
        },
      },
    });
  }

  if (ugrCanvas) {
    state.charts.ugr = createOrUpdateChart(state.charts.ugr, ugrCanvas, {
      type: 'bar',
      data: {
        labels: charts.despesasUGR?.labels || [],
        datasets: [
          {
            label: 'Executado',
            data: charts.despesasUGR?.values || [],
            backgroundColor: '#5b68c5',
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => ` ${formatCurrency(context.raw)}`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              callback: (value) => formatCurrency(value),
            },
          },
        },
      },
    });
  }

  if (planejadoCanvas) {
    const datasets = charts.planejadoEmpenhadoExecutado?.datasets || {};
    const labels = charts.planejadoEmpenhadoExecutado?.labels || [];
    state.charts.planejado = createOrUpdateChart(state.charts.planejado, planejadoCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Planejado',
            data: datasets.planejado || [],
            backgroundColor: '#5b68c5',
          },
          {
            label: 'Empenhado',
            data: datasets.empenhado || [],
            backgroundColor: '#38726c',
          },
          {
            label: 'Executado',
            data: datasets.executado || [],
            backgroundColor: '#c94b32',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            callbacks: {
              label: (context) => ` ${context.dataset.label}: ${formatCurrency(context.raw)}`,
            },
          },
        },
        scales: {
          y: {
            ticks: {
              callback: (value) => formatCurrency(value),
            },
          },
        },
      },
    });
  }

  if (charts.planejadoEmpenhadoExecutado?.mode) {
    state.chartMode = charts.planejadoEmpenhadoExecutado.mode;
    chartModeButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === state.chartMode);
    });
  }
}

function renderHeatmap(heatmap) {
  const header = heatmapTable.querySelector('thead');
  const body = heatmapTable.querySelector('tbody');
  header.innerHTML = '';
  body.innerHTML = '';

  if (!heatmap || !heatmap.months || !heatmap.months.length) {
    const headerRow = document.createElement('tr');
    const cell = document.createElement('th');
    cell.textContent = 'Sem dados mensais disponíveis.';
    headerRow.appendChild(cell);
    header.appendChild(headerRow);
    return;
  }

  const headerRow = document.createElement('tr');
  const descHeader = document.createElement('th');
  descHeader.textContent = 'Descrição';
  headerRow.appendChild(descHeader);

  heatmap.months.forEach((month) => {
    const th = document.createElement('th');
    th.textContent = month.label;
    headerRow.appendChild(th);
  });
  header.appendChild(headerRow);

  const maxValue = heatmap.maxValue || 0;

  if (!heatmap.rows || !heatmap.rows.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = heatmap.months.length + 1;
    cell.className = 'muted';
    cell.textContent = 'Nenhum dado disponível para o heatmap.';
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  heatmap.rows.forEach((rowData) => {
    const row = document.createElement('tr');
    const descCell = document.createElement('td');
    descCell.textContent = rowData.descricao || '—';
    row.appendChild(descCell);

    (rowData.values || []).forEach((value, index) => {
      const cell = document.createElement('td');
      const intensity = maxValue > 0 ? Math.min(1, Math.abs(value) / maxValue) : 0;
      cell.className = 'heatmap-cell';
      cell.style.setProperty('--intensity', intensity.toString());
      cell.textContent = formatCurrency(value);
      if (rowData.highlights && rowData.highlights[index]) {
        cell.classList.add('highlight');
      }
      row.appendChild(cell);
    });

    body.appendChild(row);
  });
}

function sortTableRows(rows, sortConfig) {
  if (!sortConfig.column) return rows;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const valueA = a[sortConfig.column];
    const valueB = b[sortConfig.column];
    if (typeof valueA === 'number' && typeof valueB === 'number') {
      return sortConfig.direction === 'asc' ? valueA - valueB : valueB - valueA;
    }
    const strA = String(valueA || '').toLowerCase();
    const strB = String(valueB || '').toLowerCase();
    if (strA < strB) return sortConfig.direction === 'asc' ? -1 : 1;
    if (strA > strB) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });
  return sorted;
}

function filterTableRows(rows, searchTerm) {
  if (!searchTerm) return rows;
  const term = searchTerm.toLowerCase();
  return rows.filter((row) =>
    Object.values(row).some((value) => String(value || '').toLowerCase().includes(term)),
  );
}

function drawTable() {
  const filtered = filterTableRows(state.tableData, state.searchTerm);
  const sorted = sortTableRows(filtered, state.tableSort);

  dataTableBody.innerHTML = '';

  if (!sorted.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = state.tableColumns.length || 1;
    cell.className = 'muted';
    cell.textContent = 'Nenhum registro encontrado.';
    row.appendChild(cell);
    dataTableBody.appendChild(row);
  } else {
    sorted.forEach((row) => {
      const tr = document.createElement('tr');
      state.tableColumns.forEach((column) => {
        const td = document.createElement('td');
        const value = row[column.key];
        if (typeof value === 'number' && ['empenhado_total', 'executado_total', 'total_estimado', 'saldo_previsto'].includes(column.key)) {
          td.textContent = formatCurrency(value);
        } else if (typeof value === 'number' && column.key === 'execucao_pct') {
          td.textContent = formatPercent(value);
        } else {
          td.textContent = value || '—';
        }
        tr.appendChild(td);
      });
      dataTableBody.appendChild(tr);
    });
  }

  if (tableCountLabel) {
    tableCountLabel.textContent = `${sorted.length} registro(s) exibido(s)`;
  }
}

function renderTable(table) {
  state.tableColumns = table?.columns || [];
  state.tableData = table?.rows || [];
  state.tableSort = { column: null, direction: 'asc' };

  dataTableHead.innerHTML = '';
  const headerRow = document.createElement('tr');
  state.tableColumns.forEach((column) => {
    const th = document.createElement('th');
    th.textContent = column.label || column.key;
    th.dataset.key = column.key;
    th.className = 'sortable';
    headerRow.appendChild(th);
  });
  dataTableHead.appendChild(headerRow);

  if (tableSearchInput && tableSearchInput.value !== state.searchTerm) {
    tableSearchInput.value = state.searchTerm;
  }

  drawTable();
}

function renderScenarioSummary(summary) {
  simDeltaPlanejado.textContent = formatCurrency(summary.deltaPlanejado || 0);
  simDeltaExecutado.textContent = formatCurrency(summary.deltaExecutado || 0);
  simDeltaEmpenhado.textContent = formatCurrency(summary.deltaEmpenhado || 0);

  simList.innerHTML = '';
  if (!state.scenario.adjustments.length) {
    const emptyItem = document.createElement('li');
    emptyItem.className = 'muted';
    emptyItem.textContent = 'Nenhum ajuste cadastrado.';
    simList.appendChild(emptyItem);
    return;
  }

  state.scenario.adjustments.forEach((adjustment, index) => {
    const item = document.createElement('li');
    const fieldLabel = {
      total_estimado: 'Total estimado',
      executado_total: 'Executado',
      empenhado_total: 'Empenhado',
    }[adjustment.field] || adjustment.field;

    const value = Number(adjustment.delta || 0);
    item.innerHTML = `<span><strong>${adjustment.ugr}</strong> – ${fieldLabel}: ${formatCurrency(value)}</span>`;
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'tiny-button danger';
    removeButton.textContent = 'Remover';
    removeButton.addEventListener('click', () => {
      state.scenario.adjustments.splice(index, 1);
      fetchDashboardData();
    });
    item.appendChild(removeButton);
    simList.appendChild(item);
  });
}

async function uploadDashboardBase(file) {
  const formData = new FormData();
  formData.append('file', file);
  try {
    setLoading(true);
    const response = await fetch(buildDashboardUrl('/api/dashboard/upload'), {
      method: 'POST',
      body: formData,
    });
    if (redirectToLoginIfNeeded(response)) {
      return;
    }
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Falha ao carregar a base para o dashboard.');
    }
    if (uploadName) {
      uploadName.textContent = `Base carregada: ${file.name}`;
    }
    state.datasetId = result.dataset?.id || null;
    populateDatasetOptions(result.datasets || [], state.datasetId);
    state.scenario.adjustments = [];
    fetchDashboardData();
  } catch (error) {
    showMessage(error.message || 'Erro ao carregar base.', 'error');
  } finally {
    setLoading(false);
  }
}

async function fetchDashboardData() {
  if (!state.datasetId) {
    showMessage('Nenhuma base carregada. Selecione ou carregue uma planilha de despesas.', 'info');
    return;
  }

  updateFiltersFromUI();
  clearMessage();
  setLoading(true);

  try {
    const response = await fetch(buildDashboardUrl('/api/dashboard/query'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        datasetId: state.datasetId,
        filters: state.filters,
        scenario: state.scenario,
        chartMode: state.chartMode,
      }),
    });
    if (redirectToLoginIfNeeded(response)) {
      return;
    }
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Falha ao gerar o dashboard.');
    }

    populateDatasetOptions(data.datasets || [], data.datasetId);
    updateFilterOptions(data.filterOptions || {});
    renderWarnings(data.warnings || []);
    renderKpis(data.kpis || {});
    renderAlerts(data.alerts || []);
    renderCharts(data.charts || {});
    renderHeatmap(data.charts?.heatmap || {});
    renderTable(data.table || {});
    if (data.scenario && Array.isArray(data.scenario.adjustments)) {
      state.scenario.adjustments = data.scenario.adjustments;
    }
    renderScenarioSummary(data.scenario || {});

    if (updatedAtLabel) {
      updatedAtLabel.textContent = data.generatedAt
        ? `Atualizado em ${new Date(data.generatedAt).toLocaleString('pt-BR')}`
        : 'Atualização não disponível.';
    }
  } catch (error) {
    showMessage(error.message || 'Não foi possível atualizar o dashboard.', 'error');
  } finally {
    setLoading(false);
  }
}

async function exportDashboardData(target, format) {
  if (!state.datasetId) {
    showMessage('Carregue uma base antes de exportar.', 'error');
    return;
  }
  try {
    setLoading(true);
    const response = await fetch(buildDashboardUrl('/api/dashboard/export'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        datasetId: state.datasetId,
        filters: state.filters,
        scenario: state.scenario,
        target,
        format,
      }),
    });
    if (redirectToLoginIfNeeded(response)) {
      return;
    }
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || 'Falha na exportação.');
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition');
    let filename = `${target}.${format}`;
    if (disposition) {
      const match = /filename="?([^";]+)"?/i.exec(disposition);
      if (match) {
        filename = match[1];
      }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    showMessage(error.message || 'Falha ao exportar dados.', 'error');
  } finally {
    setLoading(false);
  }
}

function handleUploadClick() {
  if (uploadInput) {
    uploadInput.click();
  }
}

function handleUploadChange(event) {
  const files = event.target.files || [];
  if (!files.length) return;
  const file = files[0];
  uploadDashboardBase(file);
  uploadInput.value = '';
}

function handleDatasetChange(event) {
  state.datasetId = event.target.value || null;
  state.scenario.adjustments = [];
  fetchDashboardData();
}

function handleFilterChange() {
  fetchDashboardData();
}

function handleClearFilters() {
  resetFilters();
  updateFilterOptions(state.filterOptions);
  fetchDashboardData();
}

function handleChartModeSwitch(event) {
  const button = event.target.closest('.toggle-button');
  if (!button) return;
  const mode = button.dataset.mode || 'total';
  state.chartMode = mode;
  chartModeButtons.forEach((btn) => btn.classList.toggle('active', btn === button));
  fetchDashboardData();
}

function handleTableHeaderClick(event) {
  const th = event.target.closest('th');
  if (!th || !th.dataset.key) return;
  const key = th.dataset.key;
  if (state.tableSort.column === key) {
    state.tableSort.direction = state.tableSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    state.tableSort.column = key;
    state.tableSort.direction = 'asc';
  }
  drawTable();
}

function handleTableSearch(event) {
  state.searchTerm = event.target.value || '';
  drawTable();
}

function handleExportClick(event) {
  const target = event.currentTarget.dataset.exportTarget;
  const format = event.currentTarget.dataset.exportFormat;
  if (!target || !format) return;
  exportDashboardData(target, format);
}

function handleSimulationAdd(event) {
  event.preventDefault();
  const ugr = simUGRSelect.value;
  const field = simFieldSelect.value || 'total_estimado';
  const delta = Number(simDeltaInput.value);

  if (!ugr) {
    showMessage('Selecione uma UGR para simular.', 'error');
    return;
  }
  if (!Number.isFinite(delta) || delta === 0) {
    showMessage('Informe um valor diferente de zero para a simulação.', 'error');
    return;
  }

  state.scenario.adjustments.push({ ugr, field, delta });
  simDeltaInput.value = '';
  fetchDashboardData();
}

function handleSimulationClear(event) {
  event.preventDefault();
  state.scenario.adjustments = [];
  fetchDashboardData();
}

function setupEventListeners() {
  if (uploadButton) {
    uploadButton.addEventListener('click', handleUploadClick);
  }
  if (uploadInput) {
    uploadInput.addEventListener('change', handleUploadChange);
  }
  if (datasetSelect) {
    datasetSelect.addEventListener('change', handleDatasetChange);
  }
  Object.values(filterSelects).forEach((select) => {
    if (!select) return;
    select.addEventListener('change', handleFilterChange);
  });
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', handleClearFilters);
  }
  chartModeButtons.forEach((button) => {
    button.addEventListener('click', handleChartModeSwitch);
  });
  dataTableHead.addEventListener('click', handleTableHeaderClick);
  if (tableSearchInput) {
    tableSearchInput.addEventListener('input', handleTableSearch);
  }
  exportButtons.forEach((button) => {
    button.addEventListener('click', handleExportClick);
  });
  if (simAddButton) {
    simAddButton.addEventListener('click', handleSimulationAdd);
  }
  if (simClearButton) {
    simClearButton.addEventListener('click', handleSimulationClear);
  }
}

async function initializeDashboard() {
  setupEventListeners();
  try {
    setLoading(true);
    const response = await fetch(buildDashboardUrl('/api/dashboard'));
    if (redirectToLoginIfNeeded(response)) {
      return;
    }
    if (response.status === 404) {
      showMessage('Nenhuma base foi carregada. Utilize o botão "Carregar base" para iniciar.', 'info');
      return;
    }
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Não foi possível carregar o dashboard.');
    }
    state.datasetId = data.datasetId || null;
    populateDatasetOptions(data.datasets || [], state.datasetId);
    updateFilterOptions(data.filterOptions || {});
    renderWarnings(data.warnings || []);
    renderKpis(data.kpis || {});
    renderAlerts(data.alerts || []);
    renderCharts(data.charts || {});
    renderHeatmap(data.charts?.heatmap || {});
    renderTable(data.table || {});
    renderScenarioSummary(data.scenario || {});
    if (updatedAtLabel) {
      updatedAtLabel.textContent = data.generatedAt
        ? `Atualizado em ${new Date(data.generatedAt).toLocaleString('pt-BR')}`
        : 'Atualização não disponível.';
    }
  } catch (error) {
    showMessage(error.message || 'Não foi possível carregar o dashboard.', 'error');
  } finally {
    setLoading(false);
  }
}

document.addEventListener('DOMContentLoaded', initializeDashboard);
