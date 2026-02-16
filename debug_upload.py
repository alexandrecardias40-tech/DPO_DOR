
import sys
import pandas as pd
from cpor_data_processing import process_dashboard_upload, load_dashboard_data

def debug_update(file_path):
    print(f"--- DIAGNÓSTICO COMPLETO ---")
    print(f"Planilha: {file_path}")
    
    try:
        with open(file_path, 'rb') as f:
            file_bytes = f.read()
    except FileNotFoundError:
        print(f"ERRO: Arquivo não encontrado em {file_path}")
        return

    # 1. Dados do Sistema (Antigo)
    print("Carregando sistema atual...")
    existing = load_dashboard_data()
    old_rows = existing.get("raw_data_for_filters", [])
    
    # 2. Dados da Planilha (Novo) - Processamento Puro sem Histórico
    print("Processando planilha nova...")
    try:
        # Importante: Passamos existing_data=None para ver o que a planilha traz PURA
        result_pure = process_dashboard_upload(file_bytes, existing_data=None)
        new_rows = result_pure.get("raw_data_for_filters", [])
    except Exception as e:
        print(f"ERRO ao processar planilha: {e}")
        return

    # 3. Comparação Focada em Estagiários (PI VGM01N01N2N) ou similar
    target_pi = "VGM01N01N2N"
    
    # Busca no Sistema
    old_record = next((r for r in old_rows if r.get("PI_2025") == target_pi), None)
    # Busca na Planilha Nova (LISTAR TODOS)
    all_new_records = [r for r in new_rows if r.get("PI_2025") == target_pi]
    
    print(f"\n--- ANÁLISE DETALHADA: Foram encontradas {len(all_new_records)} linhas para o PI {target_pi} ---")
    
    for i, new_record in enumerate(all_new_records):
        print(f"\n[Linha da Planilha #{i+1}]")
        # Comparar campo a campo
        all_keys = set(old_record.keys()) | set(new_record.keys())
        print(f"{'CAMPO':<30} | {'VALOR LIDO':<25}")
        print("-" * 60)
        
        # Ordenar chaves
        important_keys = ["Despesa", "Saldo_Empenhos_2025", "Saldo_Empenhos_RAP", "Total_Anual_Estimado"]
        
        for key in important_keys:
            val_new = new_record.get(key)
            print(f"{key:<30} | {str(val_new):<25}")

    # Finaliza aqui para este teste focado
    return

if __name__ == "__main__":
    import sys
    file = sys.argv[1] if len(sys.argv) > 1 else "cpor.xlsx"
    debug_update(file)
