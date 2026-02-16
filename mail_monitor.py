
import imaplib
import email
import os
import time
import smtplib
from email.header import decode_header
from email.message import EmailMessage
from pathlib import Path
from datetime import datetime

# Importa a função de ingestão do app.py (precisa refatorar app.py para expor isso, ou importar de lá)
# Como app.py é o entrypoint, melhor mover a lógica de ingestão para um módulo comum ou importá-la aqui com cuidado.
# Para evitar import circular, vou assumir que posso importar `_ingest_dashboard_spreadsheet` de `app` se estiver disponível,
# ou melhor: mover a lógica de ingestão para `cpor_data_processing` ou similar.
# Porem, `_ingest_dashboard_spreadsheet` está em `app.py`. Vou importá-la dentro da função para evitar ciclo no topo.

def format_subject(subject_bytes):
    """Decodifica o assunto do e-mail."""
    decoded_list = decode_header(subject_bytes)
    subject = ""
    for decoded_part, encoding in decoded_list:
        if isinstance(decoded_part, bytes):
            if encoding:
                subject += decoded_part.decode(encoding)
            else:
                subject += decoded_part.decode("utf-8", errors="ignore")
        else:
            subject += str(decoded_part)
    return subject

def send_reply(to_email, subject, body):
    """Envia resposta automática."""
    email_user = os.environ.get("EMAIL_USER")
    email_pass = os.environ.get("EMAIL_PASSWORD")
    
    if not email_user or not email_pass:
        return

    msg = EmailMessage()
    msg.set_content(body)
    msg["Subject"] = f"Re: {subject}"
    msg["From"] = email_user
    msg["To"] = to_email
    
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
            smtp.login(email_user, email_pass)
            smtp.send_message(msg)
            print(f"Reply sent to {to_email}")
    except Exception as e:
        print(f"Failed to send reply: {e}")

def process_attachment(part, filename):
    """Lê o anexo e tenta processar."""
    # Importação tardia para evitar ciclo
    from data_manager import ingest_dashboard_spreadsheet
    
    file_bytes = part.get_payload(decode=True)
    if not file_bytes:
        return None
        
    try:
        print(f"Processing attachment: {filename}")
        result = ingest_dashboard_spreadsheet(file_bytes, filename)
        return result
    except Exception as e:
        print(f"Error processing attachment {filename}: {e}")
        raise e

def check_emails():
    """Verifica novos e-mails e processa planilhas."""
    email_user = os.environ.get("EMAIL_USER")
    email_pass = os.environ.get("EMAIL_PASSWORD")
    
    if not email_user or not email_pass:
        print("Email credentials not set. Monitor requires EMAIL_USER and EMAIL_PASSWORD.")
        return

    try:
        # Conexão IMAP
        mail = imaplib.IMAP4_SSL("imap.gmail.com")
        mail.login(email_user, email_pass)
        mail.select("INBOX")
        
        # Buscar e-mails não lidos
        status, messages = mail.search(None, "UNSEEN")
        if status != "OK":
            return

        email_ids = messages[0].split()
        
        for email_id in email_ids:
            # Buscar o e-mail
            res, msg_data = mail.fetch(email_id, "(RFC822)")
            for response_part in msg_data:
                if isinstance(response_part, tuple):
                    msg = email.message_from_bytes(response_part[1])
                    subject = format_subject(msg["Subject"])
                    from_email = msg.get("From")
                    
                    print(f"Analyzing email from {from_email}: {subject}")
                    
                    processed = False
                    error_msg = None
                    
                    if msg.is_multipart():
                        for part in msg.walk():
                            content_disposition = str(part.get("Content-Disposition"))
                            if "attachment" in content_disposition:
                                filename = part.get_filename()
                                if filename and filename.lower().endswith((".xlsx", ".xls")):
                                    try:
                                        result = process_attachment(part, filename)
                                        processed = True
                                        count = result.get("linhas_processadas", 0) if result else 0
                                        send_reply(from_email, subject, 
                                            f"Dashboard atualizado com sucesso!\n\nArquivo processado: {filename}\nLinhas importadas: {count}\n\nEste é um e-mail automático.")
                                    except Exception as e:
                                        error_msg = str(e)
                                        send_reply(from_email, subject, 
                                            f"Erro ao processar o arquivo {filename}.\n\nDetalhe do erro: {error_msg}\n\nVerifique se a planilha está no formato correto.")
                    
                    if not processed and not error_msg:
                        # Se não achou anexo válido xlsx, mas o assunto sugere dashboard, avisa
                         if "dashboard" in subject.lower() or "despesa" in subject.lower():
                            send_reply(from_email, subject, 
                                "Recebemos seu e-mail mas não encontramos uma planilha Excel (.xlsx) válida em anexo.\nPor favor, envie o arquivo novamente.")

        mail.close()
        mail.logout()
        
    except Exception as e:
        print(f"Error checking emails: {e}")

def run_email_monitor():
    """Loop principal do monitor."""
    print("Starting email monitor loop...")
    while True:
        check_emails()
        # Verifica a cada 60 segundos
        time.sleep(60)

if __name__ == "__main__":
    # Teste local
    run_email_monitor()
