# Sistema de Atualização Automática de Dados

## Visão Geral
O dashboard foi configurado para aceitar planilhas com diferentes formatações, identificando automaticamente os campos corretos através de padrões de nomenclatura.

## Como Funciona

### 1. Mapeamento Automático de Colunas
O sistema utiliza um dicionário de aliases (`FIELD_ALIASES`) que mapeia nomes de colunas variados para campos padronizados. Por exemplo:

**Campo: Despesa**
- Aceita: "despesa", "descricao", "descricao_despesa", "nome_despesa", "historico", "item", etc.

**Campo: Saldo_Empenhos_2025**
- Aceita: "saldo_empenhos_2025", "saldo_2025", "saldo_empenho_2025", "saldo_empenhos_2026", "saldo_2026", "empenhos_2025", etc.

**Campo: UGR**
- Aceita: "ugr", "uorg", "uo", "unidade_gestora", "unidade", "ug", etc.

### 2. Normalização de Nomes
Antes de comparar, o sistema:
- Remove acentos e caracteres especiais
- Converte para minúsculas
- Substitui espaços por underscores
- Remove caracteres não alfanuméricos

Exemplo: "Descrição das Despesas" → "descricao_das_despesas"

### 3. Campos Suportados

#### Campos Obrigatórios:
- **Despesa/Descrição**: Nome ou descrição da despesa
- **UGR**: Unidade Gestora Responsável
- **PI_2025**: Plano Interno

#### Campos Financeiros:
- **Total_Anual_Estimado**: Orçamento total anual
- **Saldo_Empenhos_2025**: Saldo de empenhos do ano corrente
- **Saldo_Empenhos_RAP**: Restos a Pagar
- **Total_Empenho_RAP**: Total de RAP + Empenho
- **Valor_Mensal_Medio_Contrato**: Valor médio mensal
- **Saldo_Disponivel_NC**: Saldo disponível em Nota de Crédito

#### Campos de Contrato:
- **nº Contrato**: Número do contrato
- **CNPJ**: CNPJ do fornecedor
- **Processo**: Número do processo
- **Data_Vigencia_Fim**: Data de vencimento/vigência
- **Status_Contrato**: Status atual do contrato

#### Campos de Meses:
- Colunas com formato de data (2026-01-01, 2026-02-01, etc.)
- São automaticamente detectadas e processadas como consumo mensal

## Como Atualizar os Dados

### Passo 1: Preparar a Planilha
1. Use qualquer nome de coluna que se aproxime dos campos listados acima
2. Não precisa usar exatamente os mesmos nomes
3. O sistema tentará identificar automaticamente

### Passo 2: Upload
1. Acesse o dashboard
2. Vá em "⚙️ Atualizações" → "Atualizar Dados"
3. Faça upload da planilha Excel (.xlsx)

### Passo 3: Verificação Automática
O sistema irá:
1. Normalizar os nomes das colunas
2. Mapear para os campos padrão usando os aliases
3. Processar os dados numéricos
4. Detectar colunas de meses automaticamente
5. Atualizar todos os indicadores, gráficos e comparativos

## Exemplos de Variações Aceitas

### Para "Despesa":
✅ Despesa
✅ Descrição
✅ Descrição das Despesas
✅ Nome da Despesa
✅ Item
✅ Histórico

### Para "Saldo Empenhos 2025":
✅ Saldo Empenhos 2025
✅ Saldo 2025
✅ Saldo Empenho 2025
✅ Saldo Empenhos 2026
✅ Empenhos 2025

### Para "Total Anual Estimado":
✅ Total Anual Estimado
✅ Total Estimado
✅ Estimado Anual
✅ Valor Anual
✅ Orçamento Anual

## Campos Calculados Automaticamente

O sistema calcula automaticamente:
- **Total_Empenho_RAP**: Soma de Saldo_Empenhos_2025 + Saldo_Empenhos_RAP
- **Executado_Total**: Baseado nos valores mensais
- **Taxa_Execucao**: Percentual de execução orçamentária
- **Consumo_Mensal**: Agregação dos valores por mês

## Troubleshooting

### Problema: Campo não foi reconhecido
**Solução**: Verifique se o nome da coluna se aproxima de algum dos aliases listados. Se necessário, renomeie a coluna na planilha para um nome mais próximo.

### Problema: Valores numéricos não aparecem
**Solução**: Certifique-se de que as células contêm números, não texto. Remova formatações especiais como "R$" ou "%".

### Problema: Datas não são reconhecidas
**Solução**: Use formato de data padrão (YYYY-MM-DD) ou texto que contenha "vigencia", "vencimento", etc.

## Adicionando Novos Aliases

Se você frequentemente usa um nome de coluna que não é reconhecido, pode solicitar a adição de um novo alias ao sistema. Entre em contato com o administrador informando:
1. Nome do campo que deseja mapear
2. Variações de nome que você usa
3. Tipo de dado (texto, número, data)
