
import os
import sys
from pathlib import Path

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cpor_data_processing import process_dashboard_upload, save_dashboard_data, load_dashboard_data

EXCEL_PATH = Path("Planilha de Despesas .xlsx")

def migrate():
    if not EXCEL_PATH.exists():
        print(f"Error: {EXCEL_PATH} not found.")
        return

    print("Loading existing data...")
    existing = load_dashboard_data()
    
    print(f"Processing {EXCEL_PATH} with reverted logic...")
    file_bytes = EXCEL_PATH.read_bytes()
    try:
        payload = process_dashboard_upload(file_bytes, existing)
        save_dashboard_data(payload)
        print("Dashboard data reverted successfully.")
        
        # Verify keys
        if payload['raw_data_for_filters']:
            first = payload['raw_data_for_filters'][0]
            print("Sample keys:", list(first.keys()))
            if "Despesa" in first:
                print("SUCCESS: Despesa found.")
            else:
                print("FAILURE: Despesa NOT found.")
            
            if "Saldo_Empenhos_2025" in first:
                print("SUCCESS: Saldo_Empenhos_2025 found.")
            else:
                print("FAILURE: Saldo_Empenhos_2025 NOT found.")

            if "Data_Vigencia_Fim" in first:
                print("SUCCESS: Data_Vigencia_Fim found.")
            else:
                # It might be missing if the row doesn't have it, but usually it should be there if logic is reverted
                print("WARNING: Data_Vigencia_Fim NOT found.")
                
    except Exception as e:
        print(f"Error processing upload: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    migrate()
