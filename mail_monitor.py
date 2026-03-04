
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
    """
    Loga a estrutura MIME completa de um email.
    Fundamental para entender como o Tesouro Gerencial/SERPRO envia o arquivo.
    """
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
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # .xlsx
    "application/vnd.ms-excel",    # .xls
    "application/octet-stream",    # genérico
    "application/zip",             # xlsx é internamente um zip
}

def _find_excel_parts(msg):
    """
    Percorre toda a estrutura MIME e retorna lista de (part, filename)
    para todos os anexos Excel encontrados.

    Funciona com:
    - Emails multipart (formato padrão com corpo + anexo)
    - Emails single-part (apenas o anexo, sem corpo de texto)
    - Emails do Tesouro Gerencial/SERPRO (que podem usar inline ou outros formatos)
    """
    results = []

    # Caso: email não-multipart (é direto um único arquivo)
    if not msg.is_multipart():
        content_type = str(msg.get_content_type() or "").lower()
        filename = msg.get_filename()
        if (filename and filename.lower().endswith((".xlsx", ".xls"))) or \
           (content_type in EXCEL_MIMETYPES and filename):
            results.append((msg, filename or "attachment.xlsx"))
        return results

    # Caso: email multipart — percorre TODAS as partes recursivamente
    for part in msg.walk():
        if part.is_multipart():
            continue  # walk() já desce nos filhos
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
    Verifica e-mails recentes e processa planilhas Excel em anexo.

    Estratégia dupla de busca:
    1. E-mails NÃO LIDOS (UNSEEN) — captura emails novos
    2. E-mails das ÚLTIMAS 48h — captura emails que o usuário já leu
       (ex: abriu o email do Tesouro Gerencial antes do monitor processar)
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

        # Busca 2: últimas 48h (inclui lidos)
        since_date = (datetime.utcnow() - timedelta(hours=48)).strftime("%d-%b-%Y")
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

        for email_id in sorted(all_ids):
            res, msg_data = mail.fetch(email_id, "(RFC822)")
            for response_part in msg_data:
                if not isinstance(response_part, tuple):
                    continue

                msg = email.message_from_bytes(response_part[1])
                subject = format_subject(msg["Subject"])
                from_email = msg.get("From", "desconhecido")
                date_header = msg.get("Date", "?")
                _log(f"--- E-mail de [{from_email}] em {date_header}: '{subject}'")

                # Loga estrutura MIME completa (diagnóstico Tesouro Gerencial)
                _log_mime_structure(msg)

                # Encontra anexos Excel (funciona com multipart e single-part)
                excel_parts = _find_excel_parts(msg)

                if not excel_parts:
                    _log("  → Sem anexo Excel neste e-mail. Ignorando.")
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
                        _log(f"  ✅ Dashboard atualizado! Linhas importadas: {count}")
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

        return True

    except imaplib.IMAP4.error as e:
        err_str = str(e)
        if "AUTHENTICATIONFAILED" in err_str or "Invalid credentials" in err_str:
            _log(
                f"IMAP ERRO DE AUTENTICAÇÃO: {err_str}\n"
                "  → Gere nova senha em: myaccount.google.com/apppasswords\n"
                "  → Verifique se IMAP está ativo no Gmail"
            )
        elif "UNAVAILABLE" in err_str or "Too many simultaneous" in err_str:
            _log(f"IMAP INDISPONÍVEL (bloqueio temporário do Google): {err_str}")
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
    """Loop principal com backoff em caso de erros consecutivos."""
    _log("Monitor de e-mail iniciado. Verificando a cada 60 segundos.")
    consecutive_failures = 0

    while True:
        try:
            ok = check_emails()
            if ok:
                consecutive_failures = 0
                time.sleep(60)
            else:
                _log("Credenciais ausentes. Aguardando 5 minutos para nova tentativa.")
                time.sleep(300)
        except Exception as e:
            consecutive_failures += 1
            wait = min(60 * consecutive_failures, 600)
            _log(f"Erro no loop ({consecutive_failures}x): {type(e).__name__}: {e}. Aguardando {wait}s.")
            time.sleep(wait)


if __name__ == "__main__":
    run_email_monitor()
