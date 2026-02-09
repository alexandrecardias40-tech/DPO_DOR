# Diretoria de Orçamento (DOR) - Saiku Lite

Uma aplicação web minimalista inspirada na experiência de tabelas dinâmicas do Saiku. Permite carregar dados tabulares em vários formatos, escolher dimensões/medidas e gerar rapidamente um pivot interativo no navegador, com um único comando `python`.

## Recursos

- Upload de bases em `CSV`, `TSV`, `XLS/XLSX` ou `JSON` (lista de objetos ou `{ "data": [...] }`).
- Detecção automática de separador (CSV, TSV, TXT) e normalização de colunas.
- Painel de campos com listas (Dimensões/Medidas) e zonas de arrastar-soltar (Linhas, Colunas, Medidas) inspirado no Saiku.
- Possibilidade de excluir/restaurar campos temporariamente da análise diretamente na UI.
- Zona específica para Filtros com seleção de valores (busca e múltipla escolha).
- Abas simultâneas para múltiplas bases com alternância rápida e fechamento individual.
- Escolha de agregações (`Sum`, `Average`, `Count`, `Distinct Count`, `Min`, `Max`) com ajuste rápido no painel.
- Geração de totais por linha, coluna e total geral, com interface HTML/JS leve, responsiva e barra de ações estilo Saiku.
- Exportação rápida da tabela dinâmica para Excel (.xlsx) ou PDF com um clique.
- Armazenamento em memória dos datasets enviados durante a sessão (sem banco, zero configuração).

## Como executar

```bash
cd saiku_lite
python -m venv .venv
source .venv/bin/activate  # ou .venv\\Scripts\\Activate.ps1 no Windows
pip install -r requirements.txt
python -m saiku_lite.src.app
```

O aplicativo iniciará em modo debug, por padrão em http://127.0.0.1:5000. Abra no navegador, envie um arquivo e configure a tabela dinâmica.

## Estrutura

```
saiku_lite/
├── __init__.py          # expõe create_app para uso em servidores WSGI
├── requirements.txt     # dependências (Flask, pandas, leitores Excel)
├── README.md            # este guia
└── src/
    ├── __init__.py
    ├── app.py           # rotas Flask (upload, pivot, listagem)
    ├── data_loader.py   # carregamento/normalização de dados
    ├── pivot.py         # lógica de montagem da tabela dinâmica
    ├── templates/
    │   └── index.html   # página principal
    └── static/
        ├── css/style.css
        └── js/app.js
```

## Notas

- Limitações: datasets grandes podem consumir muita memória, já que tudo fica em RAM. Para produção recomenda-se adicionar persistência e limites de tamanho.
- Ao reiniciar o servidor os datasets são descartados.
- Para habilitar acesso externo, configure `FLASK_RUN_HOST=0.0.0.0` ou ajuste `app.run(host="0.0.0.0")`.

Sinta-se à vontade para expandir com autenticação, exportação, ou conexão com cubos OLAP no futuro.
