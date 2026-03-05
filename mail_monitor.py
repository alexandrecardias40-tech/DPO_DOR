
import imaplib
import email
import os
import time
import smtplib
import socket
from email.header import decode_header
from email.message import EmailMessage
from datetime import datetime

# ─── Utilitários ──────────────────────────────────────────────────────────────

def _log(msg: str):
    """Log com timestamp para facilitar diagnóstico nos logs do Render."""
    ts = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[EmailMonitor {ts}] {msg}", flush=True)


def format_subject(subject_raw):
    """Decodifica o assunto do e-mail."""
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
    """Loga a estrutura MIME completa (útil para diagnosticar formato SERPRO)."""
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
    """
    Percorre toda a estrutura MIME e retorna lista de (part, filename)
    para todos os anexos Excel. Funciona com emails multipart e single-part.
    """
    results = []

    # Email não-multipart: pode ser ele mesmo o anexo
    if not msg.is_multipart():
        content_type = str(msg.get_content_type() or "").lower()
        filename = msg.get_filename()
        if (filename and filename.lower().endswith((".xlsx", ".xls"))) or \
           (content_type in EXCEL_MIMETYPES and filename):
            results.append((msg, filename or "attachment.xlsx"))
        return results

    # Email multipart: percorre todas as partes
    for part in msg.walk():
        if part.is_multipart():
            continue
        content_type = str(part.get_content_type() or "").lower()
        filename = part.get_filename()
        is_excel_by_name = filename and filename.lower().endswith((".xlsx", ".xls"))
        is_excel_by_mime = content_type in EXCEL_MIMETYPES and filename
        if is_excel_by_name or is_excel_by_mime:
            results.append((part, filename or "attachment.xlsx"))

    return results


# ─── Envio de resposta ─────────────────────────────────────────────────────────

def send_reply(to_email, subject, body):
    """Envia resposta automática via SMTP."""
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

def process_attachment(part, filename):
    """Lê o anexo e chama a ingestão de dados."""
    from data_manager import ingest_dashboard_spreadsheet

    file_bytes = part.get_payload(decode=True)
    if not file_bytes:
        _log(f"Anexo '{filename}' vazio, ignorado.")
        return None

    _log(f"Processando anexo: {filename} ({len(file_bytes)} bytes)")
    result = ingest_dashboard_spreadsheet(file_bytes, filename)
    return result


# ─── Verificação de e-mails ────────────────────────────────────────────────────

def check_emails():
    """
    Verifica APENAS e-mails NOVOS (não lidos) e processa planilhas Excel.

    Após processar um email com sucesso, marca-o como LIDO (SEEN) no Gmail.
    Isso garante que:
    - Nunca seja reprocessado, mesmo após reinício do servidor
    - Não haja loop infinito de deploy no Render
    - O GitHub sempre tenha o dado mais atual (via auto-commit no data_manager)
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

        # Busca APENAS emails não lidos (UNSEEN)
        # Após processar, marcamos como lido → nunca reprocessa
        status, messages = mail.search(None, "UNSEEN")
        if status != "OK" or not messages[0]:
            _log(f"Nenhum e-mail novo. ({datetime.utcnow().strftime('%H:%M:%S')} UTC)")
            return True

        email_ids = messages[0].split()
        _log(f"{len(email_ids)} e-mail(s) novo(s) encontrado(s).")

        for email_id in email_ids:
            res, msg_data = mail.fetch(email_id, "(RFC822)")
            for response_part in msg_data:
                if not isinstance(response_part, tuple):
                    continue

                msg = email.message_from_bytes(response_part[1])
                subject = format_subject(msg["Subject"])
                from_email = msg.get("From", "desconhecido")
                date_header = msg.get("Date", "?")
                _log(f"--- E-mail de [{from_email}] em {date_header}: '{subject}'")

                # Loga estrutura MIME completa (diagnóstico)
                _log_mime_structure(msg)

                # Encontra anexos Excel
                excel_parts = _find_excel_parts(msg)

                if not excel_parts:
                    _log("  → Sem anexo Excel. Marcando como lido e ignorando.")
                    # Marca como lido para não processar de novo
                    mail.store(email_id, "+FLAGS", "\\Seen")
                    continue

                processed = False
                error_msg = None

                for part, filename in excel_parts:
                    content_type = str(part.get_content_type() or "").lower()
                    disposition = str(part.get("Content-Disposition", "")).strip()
                    _log(
                        f"  → Processando: '{filename}' | "
                        f"type='{content_type}' | disposition='{disposition}'"
                    )
                    try:
                        result = process_attachment(part, filename)
                        processed = True
                        count = result.get("linhas_processadas", 0) if result else 0
                        _log(f"  ✅ Dashboard atualizado! Linhas: {count}")
                        send_reply(
                            from_email, subject,
                            f"Dashboard atualizado com sucesso!\n\n"
                            f"Arquivo processado: {filename}\n"
                            f"Linhas importadas: {count}\n\n"
                            f"Este é um e-mail automático."
                        )
                    except Exception as e:
                        error_msg = str(e)
                        _log(f"  ❌ ERRO ao processar '{filename}': {error_msg}")
                        send_reply(
                            from_email, subject,
                            f"Erro ao processar o arquivo {filename}.\n\n"
                            f"Detalhe: {error_msg}\n\n"
                            f"Verifique se a planilha está no formato correto."
                        )

                # ── Marca como LIDO após processar ─────────────────────────────
                # IMPORTANTE: garante que este email NUNCA seja reprocessado,
                # mesmo após reinício do servidor ou redeploy do Render.
                mail.store(email_id, "+FLAGS", "\\Seen")
                _log(f"  → E-mail marcado como lido (não será reprocessado).")

        return True

    except imaplib.IMAP4.error as e:
        err_str = str(e)
        if "AUTHENTICATIONFAILED" in err_str or "Invalid credentials" in err_str:
            _log(
                f"IMAP ERRO DE AUTENTICAÇÃO: {err_str}\n"
                "  → Gere nova Senha de App em: myaccount.google.com/apppasswords"
            )
        elif "UNAVAILABLE" in err_str or "Too many simultaneous" in err_str:
            _log(f"IMAP INDISPONÍVEL (bloqueio temporário Google): {err_str}")
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
    """Loop principal com backoff em caso de erros."""
    _log("Monitor de e-mail iniciado. Verificando apenas emails NÃO LIDOS a cada 60s.")
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
