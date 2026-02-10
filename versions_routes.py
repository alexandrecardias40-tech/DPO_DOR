"""
Rotas Flask para gerenciamento de versões de dados
"""
from flask import Blueprint, jsonify, request, render_template_string
from data_versioning import (
    list_versions,
    get_version,
    restore_version,
    delete_version,
    get_version_metadata,
    cleanup_old_versions
)

versions_bp = Blueprint('versions', __name__, url_prefix='/api/versions')


@versions_bp.route('/list', methods=['GET'])
def api_list_versions():
    """Lista todas as versões disponíveis"""
    try:
        versions = list_versions()
        return jsonify({
            "success": True,
            "versions": versions,
            "total": len(versions)
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@versions_bp.route('/<version_id>', methods=['GET'])
def api_get_version(version_id):
    """Obtém dados de uma versão específica"""
    try:
        data = get_version(version_id)
        if data is None:
            return jsonify({"success": False, "error": "Versão não encontrada"}), 404
        
        metadata = get_version_metadata(version_id)
        return jsonify({
            "success": True,
            "version_id": version_id,
            "metadata": metadata,
            "data": data
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@versions_bp.route('/<version_id>/metadata', methods=['GET'])
def api_get_version_metadata(version_id):
    """Obtém apenas metadados de uma versão"""
    try:
        metadata = get_version_metadata(version_id)
        if metadata is None:
            return jsonify({"success": False, "error": "Versão não encontrada"}), 404
        
        return jsonify({
            "success": True,
            "metadata": metadata
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@versions_bp.route('/<version_id>/restore', methods=['POST'])
def api_restore_version(version_id):
    """Restaura uma versão anterior"""
    try:
        success = restore_version(version_id, create_backup=True)
        return jsonify({
            "success": success,
            "message": f"Versão {version_id} restaurada com sucesso",
            "version_id": version_id
        })
    except FileNotFoundError as e:
        return jsonify({"success": False, "error": str(e)}), 404
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@versions_bp.route('/<version_id>', methods=['DELETE'])
def api_delete_version(version_id):
    """Deleta uma versão específica"""
    try:
        success = delete_version(version_id)
        if not success:
            return jsonify({"success": False, "error": "Versão não encontrada"}), 404
        
        return jsonify({
            "success": True,
            "message": f"Versão {version_id} deletada com sucesso"
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@versions_bp.route('/cleanup', methods=['POST'])
def api_cleanup_versions():
    """Remove versões antigas, mantendo apenas as N mais recentes"""
    try:
        keep_last = request.json.get('keep_last', 10) if request.json else 10
        cleanup_old_versions(keep_last=keep_last)
        return jsonify({
            "success": True,
            "message": f"Limpeza concluída. Mantidas as {keep_last} versões mais recentes"
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# Interface HTML simples para gerenciar versões
VERSIONS_UI_TEMPLATE = """
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gerenciamento de Versões - Dashboard UnB</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        }
        h1 {
            color: #333;
            margin-bottom: 10px;
            font-size: 28px;
        }
        .subtitle {
            color: #666;
            margin-bottom: 30px;
            font-size: 14px;
        }
        .versions-list {
            margin-top: 20px;
        }
        .version-card {
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 15px;
            transition: all 0.3s;
        }
        .version-card:hover {
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            border-color: #667eea;
        }
        .version-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .version-id {
            font-weight: bold;
            color: #667eea;
            font-size: 16px;
        }
        .version-timestamp {
            color: #999;
            font-size: 12px;
        }
        .version-description {
            color: #555;
            margin: 10px 0;
            font-size: 14px;
        }
        .version-actions {
            display: flex;
            gap: 10px;
            margin-top: 15px;
        }
        button {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s;
        }
        .btn-restore {
            background: #667eea;
            color: white;
        }
        .btn-restore:hover {
            background: #5568d3;
        }
        .btn-delete {
            background: #f44336;
            color: white;
        }
        .btn-delete:hover {
            background: #da190b;
        }
        .btn-view {
            background: #4caf50;
            color: white;
        }
        .btn-view:hover {
            background: #45a049;
        }
        .loading {
            text-align: center;
            padding: 40px;
            color: #999;
        }
        .error {
            background: #ffebee;
            color: #c62828;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
        }
        .success {
            background: #e8f5e9;
            color: #2e7d32;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
        }
        .back-link {
            display: inline-block;
            margin-bottom: 20px;
            color: #667eea;
            text-decoration: none;
            font-weight: 500;
        }
        .back-link:hover {
            text-decoration: underline;
        }
        
        /* Mobile Responsive */
        @media (max-width: 768px) {
            body {
                padding: 10px;
            }
            .container {
                padding: 20px 15px;
                border-radius: 8px;
            }
            h1 {
                font-size: 22px;
            }
            .subtitle {
                font-size: 13px;
            }
            .version-card {
                padding: 15px;
            }
            .version-header {
                flex-direction: column;
                align-items: flex-start;
                gap: 5px;
            }
            .version-id {
                font-size: 14px;
            }
            .version-timestamp {
                font-size: 11px;
            }
            .version-description {
                font-size: 13px;
            }
            .version-actions {
                flex-direction: column;
                gap: 8px;
            }
            button {
                width: 100%;
                padding: 12px 16px;
                font-size: 14px;
            }
        }
        
        @media (max-width: 480px) {
            h1 {
                font-size: 20px;
            }
            .container {
                padding: 15px 10px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <a href="/" class="back-link">← Voltar ao Dashboard</a>
        <h1>📦 Gerenciamento de Versões</h1>
        <p class="subtitle">Visualize, restaure ou delete versões anteriores dos dados</p>
        
        <div id="message"></div>
        <div id="versions-container" class="loading">Carregando versões...</div>
    </div>

    <script>
        async function loadVersions() {
            try {
                const response = await fetch('/api/versions/list');
                const data = await response.json();
                
                if (!data.success) {
                    showError('Erro ao carregar versões: ' + data.error);
                    return;
                }
                
                displayVersions(data.versions);
            } catch (error) {
                showError('Erro ao carregar versões: ' + error.message);
            }
        }
        
        function displayVersions(versions) {
            const container = document.getElementById('versions-container');
            
            if (versions.length === 0) {
                container.innerHTML = '<p class="loading">Nenhuma versão encontrada.</p>';
                return;
            }
            
            container.innerHTML = versions.map(v => `
                <div class="version-card">
                    <div class="version-header">
                        <div>
                            <div class="version-id">Versão ${v.version_id}</div>
                            <div class="version-timestamp">${new Date(v.timestamp).toLocaleString('pt-BR')}</div>
                        </div>
                    </div>
                    <div class="version-description">${v.description || 'Sem descrição'}</div>
                    ${v.source_file ? `<div style="font-size: 12px; color: #999;">Arquivo: ${v.source_file}</div>` : ''}
                    <div class="version-actions">
                        <button class="btn-restore" onclick="restoreVersion('${v.version_id}')">
                            🔄 Restaurar
                        </button>
                        <button class="btn-delete" onclick="deleteVersion('${v.version_id}')">
                            🗑️ Deletar
                        </button>
                    </div>
                </div>
            `).join('');
        }
        
        async function restoreVersion(versionId) {
            if (!confirm(`Tem certeza que deseja restaurar a versão ${versionId}?\\n\\nA versão atual será salva como backup.`)) {
                return;
            }
            
            try {
                const response = await fetch(`/api/versions/${versionId}/restore`, {
                    method: 'POST'
                });
                const data = await response.json();
                
                if (data.success) {
                    showSuccess('Versão restaurada com sucesso! Recarregando...');
                    setTimeout(() => location.reload(), 2000);
                } else {
                    showError('Erro ao restaurar: ' + data.error);
                }
            } catch (error) {
                showError('Erro ao restaurar: ' + error.message);
            }
        }
        
        async function deleteVersion(versionId) {
            if (!confirm(`Tem certeza que deseja deletar a versão ${versionId}?\\n\\nEsta ação não pode ser desfeita.`)) {
                return;
            }
            
            try {
                const response = await fetch(`/api/versions/${versionId}`, {
                    method: 'DELETE'
                });
                const data = await response.json();
                
                if (data.success) {
                    showSuccess('Versão deletada com sucesso!');
                    loadVersions();
                } else {
                    showError('Erro ao deletar: ' + data.error);
                }
            } catch (error) {
                showError('Erro ao deletar: ' + error.message);
            }
        }
        
        function showError(message) {
            const msgDiv = document.getElementById('message');
            msgDiv.innerHTML = `<div class="error">${message}</div>`;
            setTimeout(() => msgDiv.innerHTML = '', 5000);
        }
        
        function showSuccess(message) {
            const msgDiv = document.getElementById('message');
            msgDiv.innerHTML = `<div class="success">${message}</div>`;
            setTimeout(() => msgDiv.innerHTML = '', 5000);
        }
        
        // Carregar versões ao iniciar
        loadVersions();
    </script>
</body>
</html>
"""

@versions_bp.route('/ui', methods=['GET'])
def versions_ui():
    """Interface web para gerenciar versões"""
    return render_template_string(VERSIONS_UI_TEMPLATE)
