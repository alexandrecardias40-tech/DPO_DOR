
import imaplib
import email
import os
import time
import smtplib
import socket
from email.header import decode_header
from email.message import EmailMessage
from datetime import datetime, timedelta

# ─── Utilitários ──────────────────────────────────────────────────────────────

def _log(msg: str):
    ts = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[EmailMonitor {ts}] {msg}", flush=True)


def format_subject(subject_raw):
    if not subject_raw:
        return "(sem assunto)"
    decoded_list = decode_header(subject_raw)
    subject = ""
    for decoded_part, encoding in decoded_list:
        if isinstance(decoded_part, bytes):
            subject += decoded_part.decode(encoding or "utf-8", errors="ignore")
        else:
            subject += str(decoded_part)
    return subject


# ─── Diagnóstico MIME ──────────────────────────────────────────────────────────

def _log_mime_structure(msg, prefix=""):
    content_type = msg.get_content_type()
    filename = msg.get_filename()
    disposition = str(msg.get("Content-Disposition", "")).strip()
    is_multipart = msg.is_multipart()
    payload_size = 0
    if not is_multipart:
        payload = msg.get_payload(decode=True)
        payload_size = len(payload) if payload else 0

    _log(
        f"{prefix}MIME: type='{content_type}' | "
        f"filename='{filename}' | disposition='{disposition}' | "
        f"multipart={is_multipart} | size={payload_size}b"
    )
    if is_multipart:
        for i, sub in enumerate(msg.get_payload()):
            _log_mime_structure(sub, prefix=prefix + f"  [{i}] ")


# ─── Detecção de anexos Excel ──────────────────────────────────────────────────

EXCEL_MIMETYPES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/octet-stream",
    "application/zip",
}


def _find_excel_parts(msg):
    """Retorna lista de (part, filename) para todos os anexos Excel no email."""
    results = []

    if not msg.is_multipart():
        content_type = str(msg.get_content_type() or "").lower()
        filename = msg.get_filename()
        if (filename and filename.lower().endswith((".xlsx", ".xls", ".csv"))) or \
           (content_type in EXCEL_MIMETYPES and filename):
            results.append((msg, filename or "attachment.xlsx"))
        return results

    for part in msg.walk():
        if part.is_multipart():
            continue
        content_type = str(part.get_content_type() or "").lower()
        filename = part.get_filename()
        is_excel_by_name = filename and filename.lower().endswith((".xlsx", ".xls", ".csv"))
        is_excel_by_mime = content_type in EXCEL_MIMETYPES and filename
        if is_excel_by_name or is_excel_by_mime:
            results.append((part, filename or "attachment.xlsx"))

    return results


# ─── Rastreio de emails processados ───────────────────────────────────────────

def _get_processed_ids() -> set:
    """Carrega o conjunto de Message-IDs já processados do dashboard_data.json."""
    try:
        from cpor_data_processing import load_dashboard_data
        data = load_dashboard_data()
        ids = data.get("metadata", {}).get("processed_email_ids", [])
        return set(ids)
    except Exception:
        return set()


def _add_processed_id(message_id: str):
    """Adiciona um Message-ID ao conjunto de processados e salva."""
    if not message_id:
        return
    try:
        from cpor_data_processing import load_dashboard_data, save_dashboard_data
        data = load_dashboard_data()
        ids = set(data.get("metadata", {}).get("processed_email_ids", []))
        ids.add(message_id)
        # Mantém apenas os últimos 200 IDs para não crescer indefinidamente
        if len(ids) > 200:
            ids = set(list(ids)[-200:])
        if "metadata" not in data:
            data["metadata"] = {}
        data["metadata"]["processed_email_ids"] = list(ids)
        save_dashboard_data(data)
    except Exception as e:
        _log(f"Aviso: não foi possível salvar processed_email_ids: {e}")


# ─── Envio de resposta ─────────────────────────────────────────────────────────

def send_reply(to_email, subject, body):
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
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as smtp:
            smtp.login(email_user, email_pass)
            smtp.send_message(msg)
            _log(f"Resposta enviada para {to_email}")
    except smtplib.SMTPAuthenticationError as e:
        _log(f"SMTP ERRO DE AUTENTICAÇÃO: {e}")
    except Exception as e:
        _log(f"SMTP erro: {type(e).__name__}: {e}")


# ─── Processamento de anexo ────────────────────────────────────────────────────

def process_attachment(part, filename, sender_email=None, message_id=None):
    """Lê o anexo e chama a ingestão de dados."""
    from data_manager import ingest_dashboard_spreadsheet

    file_bytes = part.get_payload(decode=True)
    if not file_bytes:
        _log(f"Anexo '{filename}' vazio, ignorado.")
        return None

    _log(f"Processando anexo: {filename} ({len(file_bytes)} bytes) de {sender_email}")
    result = ingest_dashboard_spreadsheet(
        file_bytes,
        filename,
        sender_email=sender_email,
        message_id=message_id,
    )
    return result


# ─── Verificação de e-mails ────────────────────────────────────────────────────

def check_emails():
    """
    Verifica e-mails e processa planilhas Excel.

    Estratégia:
    1. Busca e-mails NÃO LIDOS (UNSEEN) — emails novos
    2. Busca e-mails das ÚLTIMAS 24h — cobre emails que foram lidos antes do monitor

    Para evitar reprocessar o mesmo email duas vezes usamos Message-ID como chave,
    armazenado em dashboard_data.json (persistido via GitHub auto-commit).
    """
    email_user = os.environ.get("EMAIL_USER")
    email_pass = os.environ.get("EMAIL_PASSWORD")

    if not email_user or not email_pass:
        _log("AVISO: EMAIL_USER ou EMAIL_PASSWORD não definidos. Monitor inativo.")
        return False

    mail = None
    try:
        _log(f"Conectando ao IMAP Gmail como {email_user}...")
        mail = imaplib.IMAP4_SSL("imap.gmail.com", timeout=30)
        mail.login(email_user, email_pass)
        _log("Login IMAP bem-sucedido.")
        mail.select("INBOX")

        # Busca 1: não lidos
        status1, msgs1 = mail.search(None, "UNSEEN")
        unseen_ids = set(msgs1[0].split()) if status1 == "OK" and msgs1[0] else set()

        # Busca 2: últimas 24h (captura emails lidos antes do monitor rodar)
        since_date = (datetime.utcnow() - timedelta(hours=24)).strftime("%d-%b-%Y")
        status2, msgs2 = mail.search(None, f'(SINCE "{since_date}")')
        recent_ids = set(msgs2[0].split()) if status2 == "OK" and msgs2[0] else set()

        all_ids = unseen_ids | recent_ids

        if not all_ids:
            _log(f"Nenhum e-mail para processar. ({datetime.utcnow().strftime('%H:%M:%S')} UTC)")
            return True

        _log(
            f"{len(unseen_ids)} não lido(s) + "
            f"{len(recent_ids - unseen_ids)} lido(s) recentes = "
            f"{len(all_ids)} e-mail(s) para analisar."
        )

        # IDs já processados (persistidos no dashboard_data.json via GitHub)
        processed_ids = _get_processed_ids()

        for email_id in sorted(all_ids):
            res, msg_data = mail.fetch(email_id, "(RFC822)")
            for response_part in msg_data:
                if not isinstance(response_part, tuple):
                    continue

                msg = email.message_from_bytes(response_part[1])
                subject    = format_subject(msg["Subject"])
                from_email = msg.get("From", "desconhecido")
                date_hdr   = msg.get("Date", "?")
                message_id = msg.get("Message-ID", "").strip()

                _log(f"--- E-mail de [{from_email}] em {date_hdr}: '{subject}'")

                # Verifica se já foi processado (via Message-ID)
                if message_id and message_id in processed_ids:
                    _log(f"  → Já processado anteriormente (Message-ID={message_id}). Ignorando.")
                    continue

                # Log da estrutura MIME completa (diagnóstico SERPRO)
                _log_mime_structure(msg)

                excel_parts = _find_excel_parts(msg)

                if not excel_parts:
                    _log("  → Sem anexo Excel. Marcando como lido e ignorando.")
                    mail.store(email_id, "+FLAGS", "\\Seen")
                    # Registra como processado para não verificar de novo
                    if message_id:
                        _add_processed_id(message_id)
                    continue

                for part, filename in excel_parts:
                    content_type = str(part.get_content_type() or "").lower()
                    disposition  = str(part.get("Content-Disposition", "")).strip()
                    _log(
                        f"  → Processando: '{filename}' | "
                        f"type='{content_type}' | disposition='{disposition}'"
                    )
                    try:
                        result = process_attachment(
                            part, filename,
                            sender_email=from_email,
                            message_id=message_id,
                        )
                        count = result.get("linhas_processadas", 0) if result else 0
                        _log(f"  ✅ Dashboard atualizado! Linhas: {count} | Remetente: {from_email}")
                        send_reply(
                            from_email, subject,
                            f"Dashboard atualizado com sucesso!\n\n"
                            f"Arquivo processado: {filename}\n"
                            f"Linhas importadas: {count}\n\n"
                            f"Este é um e-mail automático."
                        )
                    except Exception as e:
                        _log(f"  ❌ ERRO ao processar '{filename}': {e}")
                        send_reply(
                            from_email, subject,
                            f"Erro ao processar o arquivo {filename}.\n\n"
                            f"Detalhe: {e}\n\n"
                            f"Verifique se a planilha está no formato correto."
                        )

                # Marca como lido e registra Message-ID como processado
                mail.store(email_id, "+FLAGS", "\\Seen")
                if message_id:
                    _add_processed_id(message_id)
                _log(f"  → E-mail marcado como lido e registrado como processado.")

        return True

    except imaplib.IMAP4.error as e:
        err_str = str(e)
        if "AUTHENTICATIONFAILED" in err_str or "Invalid credentials" in err_str:
            _log(f"IMAP ERRO DE AUTENTICAÇÃO: {err_str}")
        elif "UNAVAILABLE" in err_str or "Too many simultaneous" in err_str:
            _log(f"IMAP INDISPONÍVEL: {err_str}")
        else:
            _log(f"IMAP erro: {type(e).__name__}: {err_str}")
        return True

    except (socket.timeout, TimeoutError, ConnectionError) as e:
        _log(f"IMAP TIMEOUT: {type(e).__name__}: {e}")
        return True

    except Exception as e:
        _log(f"IMAP erro inesperado: {type(e).__name__}: {e}")
        return True

    finally:
        if mail:
            try:
                mail.close()
                mail.logout()
            except Exception:
                pass


# ─── Loop principal ────────────────────────────────────────────────────────────

def run_email_monitor():
    _log("Monitor de e-mail iniciado. Verificando a cada 60s (UNSEEN + últimas 24h).")
    consecutive_failures = 0

    while True:
        try:
            ok = check_emails()
            if ok:
                consecutive_failures = 0
                time.sleep(60)
            else:
                _log("Credenciais ausentes. Nova tentativa em 5 minutos.")
                time.sleep(300)
        except Exception as e:
            consecutive_failures += 1
            wait = min(60 * consecutive_failures, 600)
            _log(f"Erro no loop ({consecutive_failures}x): {type(e).__name__}: {e}. Aguardando {wait}s.")
            time.sleep(wait)


if __name__ == "__main__":
    run_email_monitor()
