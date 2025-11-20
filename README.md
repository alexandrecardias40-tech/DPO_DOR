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
3. O servidor cruza esses dados com `Variáveis Fixas.xlsx` (mantida no repositório) e gera o `dashboard_data.json` que alimenta o React.

> Importante: mantenha `Variáveis Fixas.xlsx` atualizado no repositório (ou no mesmo diretório do portal) para que o cruzamento preencha corretamente os campos estáticos.

#### Atualização automática via Google Drive

Se preferir manter a planilha "Contratos" em um Google Drive compartilhado:

1. Crie um link compartilhável (qualquer pessoa com o link pode visualizar) e anote o **file ID** presente na URL.
2. Defina as variáveis de ambiente no servidor:
   - `CPOR_DRIVE_FILE_ID`: ID do arquivo no Drive.
   - `CPOR_DRIVE_BOOT_SYNC` (opcional, padrão `1`): coloque `0`/`false` para desativar a sincronização automática na inicialização.
   - `CPOR_DRIVE_SYNC_TOKEN` (opcional): se definido, o endpoint manual exigirá o header `X-Portal-Token` com esse valor.
3. Reinicie o servidor. Na subida o portal baixa o arquivo do Drive, processa e publica o `dashboard_data.json` atualizado.

Você também pode acionar o processo a qualquer momento com:

```bash
curl -X POST "https://seu-servidor/api/dashboard/refresh-drive" \\
  -H "X-Portal-Token: $CPOR_DRIVE_SYNC_TOKEN"
```

Isso dispara o download mais recente e reaproveita o mesmo pipeline do upload manual.

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
