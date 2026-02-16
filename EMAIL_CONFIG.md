
# 📧 Configuração da Automação de E-mail

Para que o dashboard seja atualizado automaticamente ao receber e-mails em `dashboarddor@gmail.com`, siga os passos abaixo:

## 1. Gerar Senha de App no Gmail

O Google exige uma "Senha de App" para conexões seguras, não use sua senha normal.

1. Acesse sua conta Google: [https://myaccount.google.com/](https://myaccount.google.com/)
2. Vá em **Segurança** > **Verificação em duas etapas** (ative se não estiver).
3. Na busca das configurações, digite **"Senhas de app"**.
4. Crie uma nova senha de app:
   - **App:** Outro (Personalizado) -> Dê o nome "Dashboard Render"
   - Clique em **Gerar**
5. Copie a senha de 16 caracteres gerada (sem espaços).

## 2. Configurar Variáveis no Render

1. Acesse o painel do seu serviço no [Render.com](https://dashboard.render.com/)
2. Vá na aba **Environment**
3. Adicione as seguintes variáveis:

| Key | Value |
|---|---|
| `EMAIL_USER` | `dashboarddor@gmail.com` |
| `EMAIL_PASSWORD` | `<senha_de_app_gerada_no_passo_1>` |

## 3. Testando

Envie um e-mail para `dashboarddor@gmail.com` com:
- **Assunto:** Qualquer coisa (ex: "Atualização Despesas")
- **Anexo:** A planilha `.xlsx` do Tesouro Gerencial

O sistema irá:
1. Detectar o e-mail em até 1 minuto.
2. Atualizar o dashboard.
3. Responder seu e-mail confirmando o sucesso.

---

## ⚡ Bônus: Upload via API

Além do e-mail, você também pode atualizar mandando um POST para a API:

**Endpoint:** `https://seu-app.onrender.com/api/upload-data`
**Header:** `Authorization: Bearer <seu_token>`
**Body:** form-data com arquivo `file`

Configure `API_UPLOAD_TOKEN` nas variáveis de ambiente do Render para proteger essa rota.
