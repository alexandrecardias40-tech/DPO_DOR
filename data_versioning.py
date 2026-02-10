"""
Sistema de Versionamento de Dados do Dashboard
Mantém histórico de todas as atualizações de dados com possibilidade de rollback
"""
import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

# Diretórios
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data_versions"
CURRENT_DATA_FILE = BASE_DIR / "unb-budget-dashboard" / "dashboard_data.json"
UPLOADS_DIR = BASE_DIR / "uploads"

# Criar diretórios se não existirem
DATA_DIR.mkdir(exist_ok=True)
UPLOADS_DIR.mkdir(exist_ok=True)


def get_version_filename(version_id: str) -> str:
    """Gera nome de arquivo para uma versão"""
    return f"dashboard_data_{version_id}.json"


def create_version(description: str = "", source_file: Optional[str] = None) -> Dict:
    """
    Cria uma nova versão dos dados atuais
    
    Args:
        description: Descrição da atualização
        source_file: Nome do arquivo fonte (planilha) usado nesta atualização
    
    Returns:
        Informações da versão criada
    """
    # Gerar ID da versão (timestamp)
    version_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Copiar dados atuais para versão
    version_file = DATA_DIR / get_version_filename(version_id)
    
    if CURRENT_DATA_FILE.exists():
        shutil.copy2(CURRENT_DATA_FILE, version_file)
    else:
        raise FileNotFoundError("Arquivo de dados atual não encontrado")
    
    # Copiar arquivo fonte se fornecido
    source_backup = None
    if source_file and Path(source_file).exists():
        source_backup = DATA_DIR / f"source_{version_id}_{Path(source_file).name}"
        shutil.copy2(source_file, source_backup)
    
    # Criar metadados da versão
    metadata = {
        "version_id": version_id,
        "timestamp": datetime.now().isoformat(),
        "description": description,
        "source_file": Path(source_file).name if source_file else None,
        "source_backup": str(source_backup.name) if source_backup else None,
        "data_file": version_file.name,
    }
    
    # Salvar metadados
    metadata_file = DATA_DIR / f"metadata_{version_id}.json"
    with open(metadata_file, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)
    
    # Atualizar índice de versões
    update_versions_index(metadata)
    
    return metadata


def update_versions_index(new_version: Dict):
    """Atualiza o índice de todas as versões"""
    index_file = DATA_DIR / "versions_index.json"
    
    # Carregar índice existente
    if index_file.exists():
        with open(index_file, "r", encoding="utf-8") as f:
            index = json.load(f)
    else:
        index = {"versions": []}
    
    # Adicionar nova versão
    index["versions"].insert(0, new_version)  # Mais recente primeiro
    index["last_updated"] = datetime.now().isoformat()
    index["total_versions"] = len(index["versions"])
    
    # Salvar índice atualizado
    with open(index_file, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)


def list_versions() -> List[Dict]:
    """Lista todas as versões disponíveis"""
    index_file = DATA_DIR / "versions_index.json"
    
    if not index_file.exists():
        return []
    
    with open(index_file, "r", encoding="utf-8") as f:
        index = json.load(f)
    
    return index.get("versions", [])


def get_version(version_id: str) -> Optional[Dict]:
    """Obtém dados de uma versão específica"""
    version_file = DATA_DIR / get_version_filename(version_id)
    
    if not version_file.exists():
        return None
    
    with open(version_file, "r", encoding="utf-8") as f:
        return json.load(f)


def restore_version(version_id: str, create_backup: bool = True) -> bool:
    """
    Restaura uma versão anterior como versão atual
    
    Args:
        version_id: ID da versão a restaurar
        create_backup: Se True, cria backup da versão atual antes de restaurar
    
    Returns:
        True se restauração foi bem-sucedida
    """
    version_file = DATA_DIR / get_version_filename(version_id)
    
    if not version_file.exists():
        raise FileNotFoundError(f"Versão {version_id} não encontrada")
    
    # Criar backup da versão atual antes de restaurar
    if create_backup and CURRENT_DATA_FILE.exists():
        create_version(description=f"Backup automático antes de restaurar versão {version_id}")
    
    # Restaurar versão
    shutil.copy2(version_file, CURRENT_DATA_FILE)
    
    # Criar registro da restauração
    create_version(description=f"Restaurado da versão {version_id}")
    
    return True


def delete_version(version_id: str) -> bool:
    """
    Deleta uma versão específica (exceto a atual)
    
    Args:
        version_id: ID da versão a deletar
    
    Returns:
        True se deleção foi bem-sucedida
    """
    # Arquivos a deletar
    version_file = DATA_DIR / get_version_filename(version_id)
    metadata_file = DATA_DIR / f"metadata_{version_id}.json"
    
    # Deletar arquivos
    deleted = False
    if version_file.exists():
        version_file.unlink()
        deleted = True
    
    if metadata_file.exists():
        metadata_file.unlink()
    
    # Atualizar índice
    index_file = DATA_DIR / "versions_index.json"
    if index_file.exists():
        with open(index_file, "r", encoding="utf-8") as f:
            index = json.load(f)
        
        index["versions"] = [v for v in index["versions"] if v["version_id"] != version_id]
        index["total_versions"] = len(index["versions"])
        
        with open(index_file, "w", encoding="utf-8") as f:
            json.dump(index, f, indent=2, ensure_ascii=False)
    
    return deleted


def cleanup_old_versions(keep_last: int = 10):
    """
    Remove versões antigas, mantendo apenas as N mais recentes
    
    Args:
        keep_last: Número de versões recentes a manter
    """
    versions = list_versions()
    
    if len(versions) <= keep_last:
        return
    
    # Deletar versões antigas
    for version in versions[keep_last:]:
        delete_version(version["version_id"])


def get_version_metadata(version_id: str) -> Optional[Dict]:
    """Obtém metadados de uma versão específica"""
    metadata_file = DATA_DIR / f"metadata_{version_id}.json"
    
    if not metadata_file.exists():
        return None
    
    with open(metadata_file, "r", encoding="utf-8") as f:
        return json.load(f)
