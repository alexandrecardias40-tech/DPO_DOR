
import pandas as pd
import io
from cpor_data_processing import process_dashboard_upload, load_dashboard_data

def test_force_zero():
    print("--- TESTE DE INTEGRIDADE: FORÇANDO ZERO NO CÓDIGO ---")
    
    # 1. Carregar dados atuais para ter histórico
    existing = load_dashboard_data()
    print("Histórico carregado.")

    # 2. Criar um DataFrame FALSO na memória com o valor ZERO
    # Vamos simular uma planilha que tem APENAS a linha de Estagiários, com valor 0.
    data = {
        "PI 2026": ["VGM01N01N2N"],
        "Descrição das despesas": ["- Estagiários UnB (novo PI - estagiários)"],
        "UGR": ["DGP"],
        "Total estimado Anual": [0.0],  # <--- ZERO EXPLÍCITO AQUI
        "Executado Total": [0.0],       # <--- ZERO EXPLÍCITO AQUI
        "Saldo Empenhos 2025": [0.0],
        "Saldo de Empenhos RAP": [0.0]
    }
    df_fake = pd.DataFrame(data)
    
    # Converter para Excel bytes (como se fosse um upload)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df_fake.to_excel(writer, index=False, header=True, startrow=2) # Header na linha 3 (index 2)
    excel_bytes = output.getvalue()
    
    print("\nProcessando planilha simulada com ZERO...")
    
    # 3. Processar
    try:
        # Passamos existing para testar se ele vai ignorar o histórico quando vier zero
        result = process_dashboard_upload(excel_bytes, existing_data=existing)
        new_rows = result.get("raw_data_for_filters", [])
        
        # Verificar resultado
        record = next((r for r in new_rows if r.get("PI_2025") == "VGM01N01N2N"), None)
        
        if record:
            val = record.get("Total_Anual_Estimado")
            print(f"\nResultado no Dashboard: {val}")
            
            if val == 0:
                print("✅ SUCESSO! O sistema aceitou o ZERO e atualizou corretamente.")
                print("CONCLUSÃO: O código funciona. O arquivo Excel do usuário NÃO tinha o zero salvo.")
            else:
                print(f"❌ FALHA! O sistema ignorou o zero e manteve {val}.")
                print("CONCLUSÃO: O código ainda tem um bug que protege o histórico.")
        else:
            print("Erro: Registro não encontrado no resultado.")
            
    except Exception as e:
        print(f"Erro ao processar: {e}")

if __name__ == "__main__":
    test_force_zero()
