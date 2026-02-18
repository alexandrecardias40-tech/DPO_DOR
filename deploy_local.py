
import shutil
import os
from pathlib import Path

def deploy():
    base_dir = Path(__file__).parent.resolve()
    
    # Origem: Pasta onde o build do React foi gerado (assets estáticos estão em dist/public)
    source_dir = base_dir / "unb-budget-dashboard" / "dist" / "public"
    
    # Destino: Pasta onde o Flask (Python) busca os arquivos
    target_dir = base_dir / "static" / "cpor" / "public"
    
    print(f"--- INICIANDO DEPLOY LOCAL ---")
    print(f"Origem: {source_dir}")
    print(f"Destino: {target_dir}")
    
    if not source_dir.exists():
        print("ERRO: Pasta de origem não encontrada! Rode 'npm run build' primeiro.")
        return

    # Limpar destino
    if target_dir.exists():
        print("Limpando pasta de destino...")
        shutil.rmtree(target_dir)
    
    # Copiar novos arquivos
    print("Copiando novos arquivos...")
    shutil.copytree(source_dir, target_dir)
    
    print("--- DEPLOY CONCLUÍDO COM SUCESSO! ---")
    print("Agora recarregue o dashboard no navegador (F5).")

if __name__ == "__main__":
    deploy()
