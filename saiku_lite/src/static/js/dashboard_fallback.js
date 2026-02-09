(function () {
  const basePath = (() => {
    const raw = window.SAIKU_BASE_PATH || '';
    if (!raw || raw === '/') {
      return '';
    }
    return raw.endsWith('/') ? raw.slice(0, -1) : raw;
  })();

  function buildUrl(path) {
    if (!path) {
      return basePath || '/';
    }
    let normalized = path;
    if (!normalized.startsWith('/')) {
      normalized = `/${normalized}`;
    }
    if (!basePath) {
      return normalized;
    }
    return `${basePath}${normalized}`;
  }
  const bootstrap = window.DashboardBootstrap || { datasets: [], initialDatasetId: null };
  const state = {
    datasetId: bootstrap.initialDatasetId || null,
    datasets: bootstrap.datasets || [],
  };

  const els = {
    select: document.getElementById('dashboard-dataset-select'),
    deleteBtn: document.getElementById('dashboard-delete-btn'),
    uploadForm: document.getElementById('dashboard-upload-form'),
    uploadStatus: document.getElementById('dashboard-upload-status'),
    updatedAt: document.getElementById('dashboard-updated-at'),
    refreshBtn: document.getElementById('dashboard-refresh-btn'),
    message: document.getElementById('dashboard-message'),
    kpis: document.getElementById('dashboard-kpis'),
    alerts: document.getElementById('dashboard-alerts'),
    units: document.getElementById('dashboard-units'),
    table: document.getElementById('dashboard-table'),
    emptyHint: document.getElementById('dashboard-empty-hint'),
  };

  function formatCurrency(value) {
    if (!isFinite(value)) return 'R$ 0,00';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
  }

  function formatPercent(value) {
    if (!isFinite(value)) return '0%';
    return `${value.toFixed(1)}%`;
  }

  function setMessage(text, variant = 'info') {
    if (!els.message) return;
    if (!text) {
      els.message.classList.add('hidden');
      els.message.textContent = '';
      return;
    }
    els.message.textContent = text;
    els.message.classList.remove('hidden');
    els.message.className = `flash-message ${variant}`;
  }

  function setPlaceholder(element, text) {
    if (!element) return;
    element.innerHTML = `<p class="muted small">${text}</p>`;
    element.classList.add('placeholder');
  }

  function clearPlaceholder(element) {
    if (!element) return;
    element.classList.remove('placeholder');
  }

  function refreshSelectOptions() {
    if (!els.select) return;
    const current = state.datasetId;
    els.select.innerHTML = '';
    if (!state.datasets.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Nenhuma base disponível';
      option.selected = true;
      els.select.appendChild(option);
      els.select.disabled = true;
    } else {
      state.datasets.forEach((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.name;
        if (item.id === current) option.selected = true;
        els.select.appendChild(option);
      });
      els.select.disabled = false;
    }
    if (els.deleteBtn) {
      els.deleteBtn.disabled = state.datasets.length === 0;
    }
    if (els.emptyHint) {
      if (state.datasets.length) {
        els.emptyHint.classList.add('hidden');
      } else {
        els.emptyHint.classList.remove('hidden');
      }
    }
  }

  function updateDatasets(list) {
    if (Array.isArray(list)) {
      state.datasets = list;
      if (list.length && !list.some((item) => item.id === state.datasetId)) {
        state.datasetId = list[0].id;
      }
      if (!list.length) {
        state.datasetId = null;
      }
      refreshSelectOptions();
    }
  }

  function renderKpis(kpis) {
    if (!els.kpis) return;
    if (!kpis) {
      setPlaceholder(els.kpis, 'Carregue uma base para calcular os indicadores.');
      return;
    }
    clearPlaceholder(els.kpis);
    const items = [
      { key: 'totalEstimado', label: 'Total estimado', formatter: formatCurrency },
      { key: 'empenhado', label: 'Empenhado total', formatter: formatCurrency },
      { key: 'executado', label: 'Executado total', formatter: formatCurrency },
      { key: 'execucaoPercentual', label: 'Execução (%)', formatter: formatPercent },
      { key: 'contratosVencendo', label: 'Contratos vencendo', formatter: (v) => `${v}` },
      { key: 'contratosVencidos', label: 'Contratos vencidos', formatter: (v) => `${v}` },
    ];
    els.kpis.innerHTML = items
      .map((item) => {
        const value = kpis[item.key];
        return `
          <div class="kpi-card">
            <span class="kpi-label">${item.label}</span>
            <strong class="kpi-value">${item.formatter(Number(value) || 0)}</strong>
          </div>
        `;
      })
      .join('');
  }

  function renderAlerts(alerts) {
    if (!els.alerts) return;
    if (!alerts || !alerts.length) {
      setPlaceholder(els.alerts, 'Nenhum alerta para a base selecionada.');
      return;
    }
    clearPlaceholder(els.alerts);
    const limited = alerts.slice(0, 6);
    els.alerts.innerHTML = limited
      .map(
        (alert) => `
        <div class="alert-card" data-severity="${alert.severity || 'info'}">
          <div class="alert-icon">${alert.icon || '•'}</div>
          <div>
            <strong>${alert.descricao || 'Contrato'}</strong>
            <p class="muted small">${alert.motivo || ''}</p>
            <p class="muted tiny">UGR: ${alert.ugr || 'N/A'} • Status: ${alert.status || '—'}</p>
          </div>
        </div>
      `
      )
      .join('');
  }

  function renderUnits(units) {
    if (!els.units) return;
    if (!units || !units.length) {
      setPlaceholder(els.units, 'Nenhum detalhamento disponível.');
      return;
    }
    clearPlaceholder(els.units);
    const headers = ['UGR', 'Planejado', 'Executado', 'Empenhado', 'Saldo previsto', 'Contratos'];
    const rows = units.slice(0, 10).map(
      (unit) => `
        <tr>
          <td>${unit.ugr}</td>
          <td>${formatCurrency(unit.totalEstimado)}</td>
          <td>${formatCurrency(unit.executadoTotal)}</td>
          <td>${formatCurrency(unit.empenhadoTotal)}</td>
          <td>${formatCurrency(unit.saldoPrevisto)}</td>
          <td>${unit.quantidadeContratos}</td>
        </tr>
      `
    );
    els.units.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr>
          </thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    `;
  }

  function renderTable(table) {
    if (!els.table) return;
    if (!table || !table.rows || !table.rows.length) {
      setPlaceholder(els.table, 'Ainda não existem registros para exibir.');
      return;
    }
    clearPlaceholder(els.table);
    const columns = table.columns || [];
    const rows = table.rows.slice(0, 50);
    els.table.innerHTML = `
      <div class="table-wrapper scrollable">
        <table>
          <thead>
            <tr>${columns.map((col) => `<th>${col.label}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) => `
              <tr>
                ${columns
                  .map((col) => `<td>${row[col.key] !== undefined ? row[col.key] : ''}</td>`)
                  .join('')}
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <p class="muted tiny">Mostrando ${rows.length} de ${table.rows.length} registros.</p>
    `;
  }

  function renderView(view) {
    if (!view) return;
    updateDatasets(view.datasets);
    if (view.datasetId) {
      state.datasetId = view.datasetId;
      refreshSelectOptions();
    }
    renderKpis(view.kpis);
    renderAlerts(view.alerts);
    renderUnits(view.unitBreakdown);
    renderTable(view.table);
    if (els.updatedAt && view.generatedAt) {
      const date = new Date(view.generatedAt);
      els.updatedAt.textContent = `Atualizado em ${date.toLocaleString('pt-BR')}`;
    }
    if (view.warnings && view.warnings.length) {
      setMessage(view.warnings.join(' '), 'warning');
    } else {
      setMessage('');
    }
  }

  async function fetchView(showMessage = true) {
    if (!state.datasetId) {
      renderKpis(null);
      renderAlerts([]);
      renderUnits([]);
      renderTable(null);
      setMessage('Nenhuma base ativa. Envie um arquivo para visualizar o dashboard.', 'info');
      return;
    }
    try {
      if (showMessage) {
        setMessage('Carregando dados do dashboard...', 'info');
      }
      const response = await fetch(buildUrl(`/api/dashboard?datasetId=${encodeURIComponent(state.datasetId)}`));
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Falha ao carregar os dados.');
      }
      renderView(payload);
      setMessage('');
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Erro ao carregar o dashboard.', 'error');
    }
  }

  async function handleUpload(event) {
    event.preventDefault();
    if (!els.uploadForm) return;
    const fileInput = document.getElementById('dashboard-file');
    if (!fileInput || !fileInput.files.length) {
      setMessage('Selecione um arquivo antes de enviar.', 'warning');
      return;
    }
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    if (els.uploadStatus) {
      els.uploadStatus.textContent = 'Enviando base...';
    }
    try {
      const response = await fetch(buildUrl('/api/dashboard/upload'), {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Falha ao enviar a base.');
      }
      updateDatasets(payload.datasets);
      state.datasetId = payload.dataset.id;
      refreshSelectOptions();
      fileInput.value = '';
      if (els.uploadStatus) {
        els.uploadStatus.textContent = `Base "${payload.dataset.name}" carregada com sucesso.`;
      }
      setMessage('');
      await fetchView(false);
    } catch (error) {
      console.error(error);
      if (els.uploadStatus) {
        els.uploadStatus.textContent = error.message || 'Erro ao enviar a base.';
      }
      setMessage(error.message || 'Erro ao enviar a base.', 'error');
    }
  }

  async function handleDelete() {
    if (!state.datasetId) return;
    const confirmDelete = window.confirm('Remover a base atual do dashboard? Esta ação não pode ser desfeita.');
    if (!confirmDelete) return;
    try {
      const response = await fetch(buildUrl(`/api/dashboard/dataset/${encodeURIComponent(state.datasetId)}`), {
        method: 'DELETE',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Não foi possível remover a base.');
      }
      updateDatasets(payload.datasets);
      if (payload.view) {
        state.datasetId = payload.view.datasetId;
        renderView(payload.view);
      } else {
        state.datasetId = null;
        refreshSelectOptions();
        renderKpis(null);
        renderAlerts([]);
        renderUnits([]);
        renderTable(null);
      }
      setMessage('Base removida com sucesso.', 'success');
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Erro ao remover a base.', 'error');
    }
  }

  function bindEvents() {
    if (els.select) {
      els.select.addEventListener('change', (event) => {
        state.datasetId = event.target.value || null;
        fetchView(true);
      });
    }
    if (els.uploadForm) {
      els.uploadForm.addEventListener('submit', handleUpload);
    }
    if (els.deleteBtn) {
      els.deleteBtn.addEventListener('click', handleDelete);
    }
    if (els.refreshBtn) {
      els.refreshBtn.addEventListener('click', () => fetchView(true));
    }
  }

  function init() {
    refreshSelectOptions();
    bindEvents();
    fetchView(false);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
