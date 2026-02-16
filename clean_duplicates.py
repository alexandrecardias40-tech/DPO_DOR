
import pandas as pd
import sys

def clean_file(input_path):
    print(f"Lendo: {input_path}")
    try:
        # Lê o Excel (assumindo header na linha 3, index 2)
        df = pd.read_excel(input_path, header=2)
    except:
        # Tenta header padrão se falhar
        df = pd.read_excel(input_path, header=0)
    
    print(f"Linhas originais: {len(df)}")
    
    # Identificar coluna do PI
    pi_col = None
    for col in df.columns:
        if "PI" in str(col) and "20" in str(col): # PI 2025, PI 2026...
             pi_col = col
             break
    
    if not pi_col:
        print("Erro: Coluna PI não encontrada.")
        return

    # Remover duplicatas (mantendo a primeira ocorrencia)
    df_clean = df.drop_duplicates(subset=[pi_col], keep='first')
    
    print(f"Linhas após limpeza: {len(df_clean)}")
    removed = len(df) - len(df_clean)
    print(f"Duplicatas removidas: {removed}")
    
    output_name = "PLANILHA_LIMPA.xlsx"
    df_clean.to_excel(output_name, index=False)
    print(f"\nArquivo criado: {output_name}")
    print("FAÇA UPLOAD DESTE ARQUIVO NO DASHBOARD AGORA!")

if __name__ == "__main__":
    file = sys.argv[1] if len(sys.argv) > 1 else "testezerado.xlsx"
    clean_file(file)
