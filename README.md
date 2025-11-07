# Portal unificado dos dashboards

Este repositório reúne três experiências diferentes (dois apps em Dash e um portal em React) em um único site Flask. Assim você consegue subir um único servidor e navegar por:

- `/caor/` — Dashboard CAOR (crédito disponível x empenhado).
- `/loa/` — Dashboard Limites LOA 2025.
- `/dashboard/` — Portal interativo em React (unb-budget-dashboard).

## Pré-requisitos

- Python 3.11+ com `pip`.
- Node 18+ e `pnpm` (apenas se desejar rebuildar o frontend).
- Pacotes listados em `requirements.txt`.

## 1. Preparar as planilhas

Antes de iniciar o portal copie para a raiz do projeto os mesmos arquivos Excel usados originalmente nos dashboards:

| Dashboard | Arquivo esperado |
| --- | --- |
| CAOR | `Tabela Aprovado - Copia (2).xlsx` |
| CAOR | `Credito disponível e valor empenhado.xlsx` |
| CAOR | `Conrazao Pulverizado (4).xlsx` |
| LOA | `Limites LOA 2025 20.10.2025.xlsx` |

Sem eles o carregamento dos dados falhará na inicialização.

## 2. Instalar dependências Python

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 3. (Opcional) Atualizar o portal React

Caso altere o projeto `unb-budget-dashboard`, gere novamente o build:

```bash
cd unb-budget-dashboard
pnpm install
pnpm build
cd ..
```

Os arquivos serão emitidos em `unb-budget-dashboard/dist/public` e servidos pela rota `/dashboard/`.

### Atualizar os dados do dashboard CPOR

O dashboard em React usa o arquivo `unb-budget-dashboard/dashboard_data.json`. Você pode atualizá-lo direto da interface:

1. Abra `http://localhost:8050/dashboard/data-upload`.
2. Envie uma planilha `.xlsx/.xls` com as colunas de contratos (Despesa, UGR, PI, vigência, valores mensais, etc.).
3. O servidor converte automaticamente para o JSON esperado (KPIs, séries mensais, análise por UGR, contratos vencidos/vencendo).

Também é possível gerar o arquivo manualmente e sobrescrever `dashboard_data.json`.

## 4. Executar o site unificado

```bash
python site_portal.py
```

O servidor sobe em `http://localhost:8050` (altere a porta com `PORT=9000 python site_portal.py`).

### Rotas disponíveis

- `http://localhost:8050/` — Landing page com os três cartões.
- `http://localhost:8050/caor/` — Dashboard CAOR.
- `http://localhost:8050/loa/` — Dashboard LOA 2025.
- `http://localhost:8050/dashboard/` — Portal React.

Para ambientes de produção execute, por exemplo:

```bash
gunicorn -w 2 -b 0.0.0.0:8050 site_portal:application
```

Assim o `DispatcherMiddleware` montará os apps Dash sob `/caor` e `/loa` e o Flask servirá o build do React em `/dashboard`.
