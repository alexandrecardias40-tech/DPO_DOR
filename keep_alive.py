"""
Sistema de Keep-Alive para manter o serviço ativo no Render
Faz auto-ping a cada 10 minutos para evitar que o serviço durma
"""
import requests
import time
import threading
import os
from datetime import datetime

# URL do próprio serviço (será definida via variável de ambiente)
SERVICE_URL = os.getenv('SERVICE_URL', 'http://localhost:8050')
PING_INTERVAL = 600  # 10 minutos em segundos
ENABLE_KEEP_ALIVE = os.getenv('ENABLE_KEEP_ALIVE', 'true').lower() == 'true'


def ping_service():
    """Faz ping no próprio serviço para mantê-lo ativo"""
    try:
        response = requests.get(f"{SERVICE_URL}/health", timeout=10)
        if response.status_code == 200:
            print(f"[{datetime.now()}] ✅ Keep-alive ping successful")
        else:
            print(f"[{datetime.now()}] ⚠️ Keep-alive ping returned {response.status_code}")
    except Exception as e:
        print(f"[{datetime.now()}] ❌ Keep-alive ping failed: {e}")


def keep_alive_loop():
    """Loop que mantém o serviço ativo"""
    if not ENABLE_KEEP_ALIVE:
        print("Keep-alive desabilitado via ENABLE_KEEP_ALIVE=false")
        return
    
    print(f"🔄 Keep-alive iniciado. Ping a cada {PING_INTERVAL//60} minutos em {SERVICE_URL}")
    
    # Aguardar 2 minutos antes do primeiro ping (dar tempo do serviço iniciar)
    time.sleep(120)
    
    while True:
        ping_service()
        time.sleep(PING_INTERVAL)


def start_keep_alive():
    """Inicia o keep-alive em uma thread separada"""
    if not ENABLE_KEEP_ALIVE:
        return
    
    thread = threading.Thread(target=keep_alive_loop, daemon=True)
    thread.start()
    print("✅ Keep-alive thread iniciada")
