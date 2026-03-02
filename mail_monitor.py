
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

def format_subject(subject_bytes):
    """Decodifica o assunto do e-mail."""
    if not subject_bytes:
        return "(sem assunto)"
    decoded_list = decode_header(subject_bytes)
    subject = ""
    for decoded_part, encoding in decoded_list:
        if isinstance(decoded_part, bytes):
            if encoding:
                subject += decoded_part.decode(encoding, errors="ignore")
            else:
                subject += decoded_part.decode("utf-8", errors="ignore")
        else:
            subject += str(decoded_part)
    return subject

# ─── Envio de resposta ─────────────────────────────────────────────────────────

def send_reply(to_email, subject, body):
    """Envia resposta automática via SMTP."""
    email_user = os.environ.get("EMAIL_USER")
    email_pass = os.environ.get("EMAIL_PASSWORD")

    if not email_user or not email_pass:
        _log("SMTP: credenciais não configuradas, resposta não enviada.")
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
        _log(f"SMTP ERRO DE AUTENTICAÇÃO: {e} — verifique EMAIL_PASSWORD (Senha de App do Gmail).")
    except Exception as e:
        _log(f"SMTP erro ao enviar resposta: {type(e).__name__}: {e}")

# ─── Processamento de Anexo ────────────────────────────────────────────────────

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
    """Verifica novos e-mails não lidos e processa planilhas em anexo."""
    email_user = os.environ.get("EMAIL_USER")
    email_pass = os.environ.get("EMAIL_PASSWORD")

    if not email_user or not email_pass:
        _log("AVISO: EMAIL_USER ou EMAIL_PASSWORD não definidos. Monitor inativo.")
        return False  # retorna False para sinalizar que não deve continuar

    mail = None
    try:
        _log(f"Conectando ao IMAP Gmail como {email_user}...")
        mail = imaplib.IMAP4_SSL("imap.gmail.com", timeout=30)
        mail.login(email_user, email_pass)
        _log("Login IMAP bem-sucedido.")
        mail.select("INBOX")

        # Buscar e-mails não lidos
        status, messages = mail.search(None, "UNSEEN")
        if status != "OK":
            _log(f"Busca IMAP retornou status inesperado: {status}")
            return True

        email_ids = messages[0].split()
        if not email_ids:
            _log(f"Nenhum e-mail não lido. (verificado em {datetime.utcnow().strftime('%H:%M:%S')} UTC)")
            return True

        _log(f"{len(email_ids)} e-mail(s) não lido(s) encontrado(s).")

        for email_id in email_ids:
            res, msg_data = mail.fetch(email_id, "(RFC822)")
            for response_part in msg_data:
                if not isinstance(response_part, tuple):
                    continue

                msg = email.message_from_bytes(response_part[1])
                subject = format_subject(msg["Subject"])
                from_email = msg.get("From", "desconhecido")
                _log(f"Analisando e-mail de [{from_email}]: '{subject}'")

                processed = False
                error_msg = None

                if msg.is_multipart():
                    for part in msg.walk():
                        content_disposition = str(part.get("Content-Disposition", ""))
                        if "attachment" not in content_disposition:
                            continue
                        filename = part.get_filename()
                        if not filename:
                            continue
                        if not filename.lower().endswith((".xlsx", ".xls")):
                            _log(f"Anexo ignorado (não é Excel): {filename}")
                            continue
                        try:
                            result = process_attachment(part, filename)
                            processed = True
                            count = result.get("linhas_processadas", 0) if result else 0
                            _log(f"Dashboard atualizado com sucesso! Linhas: {count}")
                            send_reply(
                                from_email, subject,
                                f"Dashboard atualizado com sucesso!\n\n"
                                f"Arquivo processado: {filename}\n"
                                f"Linhas importadas: {count}\n\n"
                                f"Este é um e-mail automático."
                            )
                        except Exception as e:
                            error_msg = str(e)
                            _log(f"ERRO ao processar '{filename}': {error_msg}")
                            send_reply(
                                from_email, subject,
                                f"Erro ao processar o arquivo {filename}.\n\n"
                                f"Detalhe: {error_msg}\n\n"
                                f"Verifique se a planilha está no formato correto."
                            )

                if not processed and not error_msg:
                    subj_lower = subject.lower()
                    if "dashboard" in subj_lower or "despesa" in subj_lower or "planilha" in subj_lower:
                        _log("E-mail recebido sem anexo Excel válido. Enviando aviso.")
                        send_reply(
                            from_email, subject,
                            "Recebemos seu e-mail mas não encontramos uma planilha Excel (.xlsx) válida em anexo.\n"
                            "Por favor, envie o arquivo novamente com a planilha em anexo."
                        )

        return True

    except imaplib.IMAP4.error as e:
        err_str = str(e)
        if "AUTHENTICATIONFAILED" in err_str or "Invalid credentials" in err_str:
            _log(
                f"IMAP ERRO DE AUTENTICAÇÃO: {err_str}\n"
                "  → Possíveis causas:\n"
                "    1. Senha de App inválida/revogada — gere uma nova em myaccount.google.com/apppasswords\n"
                "    2. IMAP desativado no Gmail — ative em Configurações > Ver todos > Encaminhamento e POP/IMAP\n"
                "    3. Google bloqueou acesso do IP do servidor"
            )
        elif "UNAVAILABLE" in err_str or "Too many simultaneous" in err_str:
            _log(f"IMAP INDISPONÍVEL (possível bloqueio temporário do Google): {err_str}")
        else:
            _log(f"IMAP erro: {type(e).__name__}: {err_str}")
        return True  # mantém o loop rodando

    except (socket.timeout, TimeoutError, ConnectionError) as e:
        _log(f"IMAP TIMEOUT/CONEXÃO: {type(e).__name__}: {e} — o Render pode ter bloqueado a conexão de saída.")
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
    """Loop principal do monitor com backoff progressivo em caso de erros."""
    _log("Monitor de e-mail iniciado. Verificando a cada 60 segundos.")
    consecutive_failures = 0
    CHECK_INTERVAL = 60  # segundos entre verificações normais

    while True:
        try:
            ok = check_emails()
            if ok:
                consecutive_failures = 0
                time.sleep(CHECK_INTERVAL)
            else:
                # Credenciais não configuradas — verifica de vez em quando se foram adicionadas
                _log("Aguardando 5 minutos para nova tentativa (credenciais ausentes).")
                time.sleep(300)
        except Exception as e:
            consecutive_failures += 1
            wait = min(60 * consecutive_failures, 600)  # máximo 10 minutos
            _log(f"Erro no loop ({consecutive_failures}x): {type(e).__name__}: {e}. Aguardando {wait}s.")
            time.sleep(wait)

if __name__ == "__main__":
    # Teste local
    run_email_monitor()
