# Guia: Manter o Site Sempre Ativo no Render (Plano Free)

## 🔄 Problema

No plano **Free** do Render, o serviço entra em "sleep mode" (modo de descanso) após **15 minutos de inatividade**. Quando alguém acessa novamente, leva ~30-60 segundos para "acordar" (cold start).

## ✅ Soluções Implementadas

### **Opção 1: Keep-Alive Interno** (Já Implementado)

O sistema agora tem um keep-alive interno que faz ping a cada 10 minutos.

#### **Como Configurar no Render:**

1. **Acesse seu serviço no Render Dashboard**
2. **Vá em Environment → Environment Variables**
3. **Adicione as variáveis:**

```bash
SERVICE_URL=https://sua-url.onrender.com
ENABLE_KEEP_ALIVE=true
```

**Importante:** Substitua `sua-url.onrender.com` pela URL real do seu app!

#### **Como Funciona:**
- ✅ Faz auto-ping a cada 10 minutos
- ✅ Endpoint `/health` retorna status
- ✅ Roda em thread separada (não bloqueia o app)
- ✅ Pode ser desabilitado com `ENABLE_KEEP_ALIVE=false`

### **Opção 2: UptimeRobot** (Recomendado - Mais Confiável) ⭐

Serviço externo gratuito que monitora seu site.

#### **Passo a Passo:**

1. **Criar Conta:**
   - Acesse: https://uptimerobot.com
   - Clique em "Sign Up Free"
   - Crie sua conta gratuita

2. **Adicionar Monitor:**
   - Clique em "+ Add New Monitor"
   - **Monitor Type:** HTTP(s)
   - **Friendly Name:** Dashboard UnB
   - **URL:** `https://sua-url.onrender.com/health`
   - **Monitoring Interval:** 5 minutes
   - Clique em "Create Monitor"

3. **Configurar Alertas (Opcional):**
   - Configure email para receber alertas se o site cair
   - Adicione notificações via Slack, Telegram, etc.

#### **Vantagens:**
- ✅ 100% confiável (serviço externo)
- ✅ Monitora uptime real
- ✅ Alertas se o site cair
- ✅ Dashboard com estatísticas
- ✅ Grátis até 50 monitores

### **Opção 3: Cron-job.org**

Alternativa ao UptimeRobot.

#### **Configuração:**

1. Acesse: https://cron-job.org
2. Registre-se gratuitamente
3. Crie um novo cronjob:
   - **Title:** Keep Dashboard Alive
   - **URL:** `https://sua-url.onrender.com/health`
   - **Schedule:** Every 10 minutes
   - **Enabled:** Yes

### **Opção 4: GitHub Actions** (Avançado)

Usar GitHub Actions para fazer ping automático.

#### **Criar arquivo `.github/workflows/keep-alive.yml`:**

```yaml
name: Keep Render Service Alive

on:
  schedule:
    # Roda a cada 10 minutos
    - cron: '*/10 * * * *'
  workflow_dispatch:

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping service
        run: |
          curl -f https://sua-url.onrender.com/health || exit 0
```

## 📊 Comparação das Opções

| Opção | Confiabilidade | Configuração | Custo | Recomendado |
|-------|---------------|--------------|-------|-------------|
| Keep-Alive Interno | ⭐⭐⭐ | Fácil | Grátis | ✅ Sim |
| UptimeRobot | ⭐⭐⭐⭐⭐ | Muito Fácil | Grátis | ⭐ Melhor |
| Cron-job.org | ⭐⭐⭐⭐ | Fácil | Grátis | ✅ Sim |
| GitHub Actions | ⭐⭐⭐⭐ | Médio | Grátis | Avançado |

## 🎯 Recomendação

**Use as duas primeiras opções juntas:**

1. ✅ **Keep-Alive Interno** (já está implementado)
2. ✅ **UptimeRobot** (configure em 5 minutos)

Isso garante redundância: se uma falhar, a outra mantém o serviço ativo.

## ⚙️ Configuração no Render

### **Variáveis de Ambiente Necessárias:**

```bash
# Obrigatório para keep-alive interno
SERVICE_URL=https://sua-url-real.onrender.com

# Opcional - habilitar/desabilitar keep-alive
ENABLE_KEEP_ALIVE=true

# Outras variáveis úteis
PORT=8050
KEEP_VERSIONS=20
```

### **Como Adicionar:**

1. Dashboard do Render → Seu Serviço
2. Environment → Environment Variables
3. Clique em "Add Environment Variable"
4. Adicione cada variável
5. Clique em "Save Changes"
6. O serviço será reiniciado automaticamente

## 🔍 Verificar se Está Funcionando

### **Teste o Endpoint de Health:**

```bash
curl https://sua-url.onrender.com/health
```

**Resposta esperada:**
```json
{
  "status": "healthy",
  "timestamp": "2026-02-10T18:30:00.000000",
  "service": "DPO Dashboard UnB"
}
```

### **Monitorar Logs:**

1. Render Dashboard → Seu Serviço → Logs
2. Procure por mensagens:
   ```
   ✅ Keep-alive thread iniciada
   🔄 Keep-alive iniciado. Ping a cada 10 minutos
   ✅ Keep-alive ping successful
   ```

## ⚠️ Limitações do Plano Free

Mesmo com keep-alive, o Render Free tem limitações:

- **750 horas/mês** de uptime grátis
- Se usar keep-alive 24/7, consome ~720 horas/mês
- **Solução:** Desabilite keep-alive em horários de baixo uso

### **Desabilitar em Horários Específicos:**

Você pode configurar o UptimeRobot para fazer ping apenas em horário comercial:
- Segunda a Sexta: 7h - 20h
- Sábado: 8h - 14h
- Domingo: Desabilitado

Isso economiza horas e mantém o site rápido quando mais usado.

## 🚀 Upgrade para Plano Pago (Opcional)

Se precisar de 100% uptime sem cold starts:

**Render Starter Plan:**
- **$7/mês** por serviço
- Sem sleep mode
- Sempre ativo
- Mais recursos (CPU, RAM)

**Vale a pena se:**
- Site é usado profissionalmente
- Precisa de resposta instantânea
- Mais de 750h/mês de uso

## 📞 Troubleshooting

### **Keep-alive não funciona:**
1. Verifique se `SERVICE_URL` está correto
2. Confirme que `ENABLE_KEEP_ALIVE=true`
3. Veja os logs para erros
4. Teste o endpoint `/health` manualmente

### **Site ainda dorme:**
1. Verifique se o UptimeRobot está ativo
2. Confirme intervalo de 5-10 minutos
3. Veja se atingiu limite de 750h/mês

### **Erro "Connection refused":**
- Serviço pode estar reiniciando
- Aguarde 1-2 minutos
- Verifique logs no Render

## ✅ Checklist de Configuração

- [ ] Keep-alive interno implementado (já feito)
- [ ] Variável `SERVICE_URL` configurada no Render
- [ ] Variável `ENABLE_KEEP_ALIVE=true` configurada
- [ ] Conta criada no UptimeRobot
- [ ] Monitor adicionado no UptimeRobot
- [ ] Endpoint `/health` testado
- [ ] Logs verificados
- [ ] Site testado após 15 minutos de inatividade

## 🎉 Resultado Final

Com tudo configurado:
- ✅ Site responde instantaneamente
- ✅ Sem tela de "inicialização"
- ✅ Uptime de ~99%
- ✅ Monitoramento automático
- ✅ Alertas se cair
- ✅ Tudo grátis!
