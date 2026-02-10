# Sistema de Versionamento de Dados

## Visão Geral

O dashboard agora possui um sistema completo de versionamento que:
- ✅ Cria backup automático antes de cada atualização
- ✅ Mantém histórico completo de todas as atualizações
- ✅ Permite visualizar dados de versões anteriores
- ✅ Permite restaurar qualquer versão anterior
- ✅ Funciona tanto localmente quanto no Render

## Como Funciona

### 1. Backup Automático
Toda vez que você faz upload de uma nova planilha:
1. O sistema cria um backup da versão atual
2. Processa os novos dados
3. Salva a nova versão com metadados

### 2. Estrutura de Versões
Cada versão contém:
- **ID da Versão**: Timestamp único (formato: YYYYMMDD_HHMMSS)
- **Timestamp**: Data e hora da criação
- **Descrição**: Descrição da atualização
- **Arquivo Fonte**: Cópia da planilha original usada
- **Dados**: Snapshot completo do dashboard_data.json

### 3. Armazenamento
As versões são armazenadas em:
```
data_versions/
├── versions_index.json          # Índice de todas as versões
├── dashboard_data_20260210_120000.json  # Dados da versão
├── metadata_20260210_120000.json        # Metadados da versão
├── source_20260210_120000_planilha.xlsx # Arquivo fonte
└── ...
```

## Usando o Sistema

### Interface Web
Acesse: `http://seu-site.com/api/versions/ui`

Na interface você pode:
- 📋 Ver lista de todas as versões
- 🔄 Restaurar uma versão anterior
- 🗑️ Deletar versões antigas
- 📊 Ver metadados de cada versão

### API REST

#### Listar Versões
```bash
GET /api/versions/list
```
Retorna lista de todas as versões disponíveis.

#### Obter Versão Específica
```bash
GET /api/versions/{version_id}
```
Retorna dados completos de uma versão.

#### Obter Metadados
```bash
GET /api/versions/{version_id}/metadata
```
Retorna apenas metadados (mais rápido).

#### Restaurar Versão
```bash
POST /api/versions/{version_id}/restore
```
Restaura uma versão anterior. Cria backup automático da versão atual.

#### Deletar Versão
```bash
DELETE /api/versions/{version_id}
```
Remove uma versão específica.

#### Limpar Versões Antigas
```bash
POST /api/versions/cleanup
Content-Type: application/json

{
  "keep_last": 10
}
```
Mantém apenas as N versões mais recentes.

## Uso no Render

### Persistência de Dados
⚠️ **IMPORTANTE**: O Render usa armazenamento efêmero por padrão. Para manter as versões entre deploys:

1. **Opção 1: Usar Render Disks** (Recomendado)
   - Configure um Render Disk para o diretório `data_versions/`
   - As versões serão persistidas entre deploys

2. **Opção 2: Usar S3/Cloud Storage**
   - Configure para salvar versões em bucket S3
   - Mais robusto para produção

### Configuração no Render

Adicione variáveis de ambiente:
```bash
DATA_VERSIONS_DIR=/opt/render/project/src/data_versions
KEEP_VERSIONS=20  # Número de versões a manter
```

## Fluxo de Atualização

```
1. Usuário faz upload de nova planilha
   ↓
2. Sistema cria backup da versão atual
   ↓
3. Processa novos dados
   ↓
4. Salva nova versão
   ↓
5. Atualiza índice de versões
   ↓
6. Dashboard atualizado!
```

## Restauração de Versão

```
1. Usuário seleciona versão para restaurar
   ↓
2. Sistema cria backup da versão atual
   ↓
3. Copia dados da versão selecionada
   ↓
4. Substitui dashboard_data.json
   ↓
5. Cria nova versão (registro da restauração)
   ↓
6. Dashboard restaurado!
```

## Manutenção

### Limpeza Automática
Configure limpeza automática para evitar uso excessivo de disco:

```python
from data_versioning import cleanup_old_versions

# Manter apenas as 10 versões mais recentes
cleanup_old_versions(keep_last=10)
```

### Monitoramento
Verifique o espaço usado:
```bash
du -sh data_versions/
```

## Segurança

- ✅ Cada versão é imutável após criação
- ✅ Restauração sempre cria backup primeiro
- ✅ Metadados rastreiam todas as mudanças
- ✅ Arquivos fonte são preservados

## Troubleshooting

### Erro: "Versão não encontrada"
- Verifique se o ID da versão está correto
- Confirme que o arquivo existe em `data_versions/`

### Erro: "Arquivo de dados atual não encontrado"
- Primeira vez usando o sistema
- Execute um upload para criar a primeira versão

### Espaço em disco cheio
- Execute limpeza de versões antigas
- Configure `KEEP_VERSIONS` para um número menor

## Exemplo de Uso

### Python
```python
from data_versioning import (
    list_versions,
    restore_version,
    get_version_metadata
)

# Listar versões
versions = list_versions()
for v in versions:
    print(f"{v['version_id']}: {v['description']}")

# Restaurar versão
restore_version('20260210_120000')

# Ver metadados
metadata = get_version_metadata('20260210_120000')
print(metadata)
```

### JavaScript (Frontend)
```javascript
// Listar versões
const response = await fetch('/api/versions/list');
const data = await response.json();
console.log(data.versions);

// Restaurar versão
await fetch('/api/versions/20260210_120000/restore', {
    method: 'POST'
});
```

## Próximos Passos

1. ✅ Sistema implementado
2. ⏳ Configurar Render Disk (se necessário)
3. ⏳ Testar restauração em produção
4. ⏳ Configurar limpeza automática agendada
