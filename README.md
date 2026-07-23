# Painel de Controle — Migração TOTVS Protheus → Domínio Sistemas

Painel de acompanhamento da migração dos clientes do Grupo Paraná do ERP
TOTVS Protheus para a Domínio Sistemas, controlado por **cliente ×
departamento** (Fiscal, Contabilidade, Departamento Pessoal).

> Site estático (HTML/CSS/JS puro, sem build step, sem framework), hospedado
> no GitHub Pages. A fonte da verdade dos dados é uma **planilha Google
> Sheets**, publicada na web — o painel só lê essa planilha, nunca escreve
> nela. Editar fase, responsável, datas ou observações é feito direto na
> planilha (ferramenta que a equipe já usa no dia a dia).

---

## 0. Privacidade e LGPD

O painel e o repositório GitHub são **públicos** (decisão de 23/07/2026,
para não depender de plano pago). Isso é seguro para os 27 clientes pessoa
jurídica: CNPJ, razão social e endereço empresarial são dados de **pessoa
jurídica**, fora do escopo da LGPD (Lei 13.709/2018, art. 5º, I — a lei
protege pessoa *natural*) e já são públicos via consulta gratuita no site
da Receita Federal.

**Não é seguro** para os 4 clientes pessoa física (CPF) do arquivo — nome
completo + CPF + endereço residencial é dado pessoal no sentido exato do
art. 5º, I da LGPD. Por isso, `scripts/gerar_dados.py` **mascara
automaticamente** CPF e endereço completo de todo registro `TipoNI = cpf`
antes de gerar qualquer arquivo (planilha ou JSON) — mantém só nome e
cidade/UF, o suficiente para o painel. Isso é o padrão; só desligue com
`--sem-mascara` se o resultado for ficar 100% privado (nunca publicado).

A planilha de origem do Protheus (`GOB_CLIENTES.xlsx`, sem máscara nenhuma)
nunca deve ir para o GitHub nem para a planilha pública do Google Sheets —
fica só local, na pasta `docs_fonte/` (já no `.gitignore`).

---

## 1. Como o painel e a planilha se conectam

```
┌─────────────────────┐   "Publicar na Web"   ┌──────────────────────┐
│  Google Sheets        │ ────── (CSV) ──────▶ │  index.html (painel)  │
│  "Controle de         │                        │  hospedado no          │
│  Migração..."         │ ◀──── equipe edita ── │  GitHub Pages          │
│  (fonte da verdade)   │        aqui            │  (só leitura)          │
└─────────────────────┘                        └──────────────────────┘
```

- A equipe (Fiscal, Contabilidade, Departamento Pessoal) muda a **Fase
  Atual**, **Responsável**, **Prioridade**, **datas** e **Observações**
  direto nas linhas da planilha, usando menus suspensos.
- O painel busca (`fetch`) o CSV publicado da planilha toda vez que a
  página é aberta ou quando alguém clica em **"Atualizar agora"**.
- Histórico de quem mudou o quê e quando é o **Histórico de versões**
  nativo do Google Sheets (menu Arquivo → Histórico de versões) — não
  precisa preencher nada manualmente para isso.

---

## 2. Estrutura do projeto

```
implantacao-dominio/
├── index.html                → o painel em si (publicar no GitHub Pages)
├── css/style.css               → tema visual (paleta validada para daltonismo, dark mode)
├── js/
│   ├── app.js                   → toda a lógica: busca o CSV, filtros, KPIs, gráficos, Kanban, tabela
│   └── config.js                → onde você cola o link do CSV publicado da planilha
├── data/
│   └── clientes.json            → cópia de referência (histórico de geração; não é mais a fonte ao vivo)
├── scripts/
│   ├── gerar_dados.py           → gera data/clientes.json a partir do Protheus (mascara CPF/LGPD)
│   ├── gerar_planilha.py        → gera controle_migracao.xlsx a partir de data/clientes.json
│   └── build_snapshot.py        → gera um HTML único com os dados embutidos (prévia offline)
├── docs_fonte/                  → planilha original do Protheus (NUNCA publicar — ver seção 0)
└── README.md                     → este arquivo
```

---

## 3. Publicar a planilha na Web (o passo que faz o painel atualizar sozinho)

1. Abra a planilha **"Controle de Migração — TOTVS Protheus para Domínio
   Sistemas"** no Google Sheets.
2. **Arquivo → Compartilhar → Publicar na Web.**
3. Em "Link", escolha a aba com os dados (ou "Documento inteiro", se só
   tiver uma aba) e o formato **"Valores separados por vírgula (.csv)"**.
4. Marque a opção de **republicar automaticamente quando houver
   alterações** (senão o CSV fica parado na versão publicada até você
   clicar em "Publicar" de novo).
5. Clique em **Publicar**, confirme, e copie o link gerado.
6. Cole esse link em `js/config.js`, no campo `sheetCsvUrl`.

Também é importante checar o compartilhamento geral da planilha (botão
"Compartilhar", canto superior direito): **Acesso geral → Qualquer pessoa
com o link → Leitor**. Sem isso, o painel não consegue buscar os dados.

---

## 4. Como abrir localmente

```bash
python3 -m http.server 8080
```

Depois acesse `http://localhost:8080`. (Não dá para abrir `index.html`
direto via duplo-clique — o navegador bloqueia o `fetch` do CSV em
arquivos abertos como `file://`.)

---

## 5. As 8 fases da migração

1. Não Iniciado
2. Levantamento
3. Parametrização
4. Migração de Dados
5. Testes/Homologação
6. Treinamento
7. Go-live
8. Estabilização

Mais uma opção especial, **"Não Aplicável"**, para quando um departamento
não se aplica a um cliente (ex.: pessoa física sem Fiscal/DP — ver seção
7). Fica fora dos cálculos de % concluído.

Essas fases estão definidas em dois lugares que precisam ficar em sincronia
se um dia mudarem: `scripts/gerar_planilha.py` (constante `FASES`, usada
nos menus suspensos da planilha) e `js/app.js` (constante `FASES`, usada
para desenhar o Kanban e calcular progresso).

### Por que a fase não tem uma cor própria no Kanban

Testei uma rampa de 8 tons de azul (uma cor por fase) contra o validador de
acessibilidade cromática (skill de dataviz) e ela **reprova** — 8 degraus
não cabem com segurança numa única matiz sem que fases vizinhas fiquem
indistinguíveis para quem tem daltonismo. A fase é 100% legível pela
**posição da coluna** e pelo **rótulo do cabeçalho**; cor fica reservada
para **departamento** (Fiscal = azul, Contabilidade = laranja, Depto
Pessoal = água-marinha) e para o **status de prazo** (selo com ícone +
texto, nunca cor sozinha).

---

## 6. Atualizando a base de clientes (cliente novo no Protheus)

Quando entrar cliente novo (ou mudar dado cadastral), regenere a partir de
uma exportação nova do `GOB_CLIENTES`:

```bash
python3 scripts/gerar_dados.py caminho/para/GOB_CLIENTES_novo.xlsx
python3 scripts/gerar_planilha.py
```

O primeiro comando é **aditivo** (nunca apaga progresso de quem já existia
— ver docstring do script). O segundo gera um novo `controle_migracao.xlsx`
a partir do JSON atualizado.

**Importante:** hoje não existe automação para mesclar linhas novas direto
na planilha do Google já publicada sem sobrescrever o que a equipe já
editou nela. Pra cliente novo isolado, o mais simples é adicionar a linha
manualmente na planilha (copiar uma linha existente, trocar os dados). Se
isso virar rotina frequente, o próximo passo natural é eu montar um script
de mesclagem via API do Google Sheets — me avise quando fizer sentido.

---

## 7. Premissas assumidas — validar com a equipe

- **Departamentos por tipo de cliente:** CNPJ → Fiscal + Contabilidade +
  Departamento Pessoal; CPF → só Contabilidade (ex.: acompanhamento tipo
  IRPF). Afeta os 4 clientes pessoa física do arquivo. Se algum precisar de
  outro departamento (ou não precisar de Contabilidade), ajuste marcando a
  "Fase Atual" daquela linha como **"Não Aplicável"** direto na planilha —
  não precisa mexer em código.
- **Granularidade por CNPJ** (matriz e cada filial separadas), não por
  grupo econômico — ex.: VT Paraná Supermercado aparece como 4 linhas.

---

## 8. Lógica do status de prazo (badge no card)

| Badge | Quando aparece |
|---|---|
| **Concluído** (verde) | Fase atual = Go-live ou Estabilização |
| **No prazo** (verde) | Tem "Conclusão Prevista", e faltam mais de 7 dias |
| **Atenção** (amarelo) | Tem "Conclusão Prevista", faltam 7 dias ou menos |
| **Atrasado** (vermelho) | "Conclusão Prevista" já passou |
| **Sem data definida** (cinza) | Nenhuma "Conclusão Prevista" preenchida ainda |
| **Não aplicável** (cinza) | Fase Atual = "Não Aplicável" |

---

## 9. Publicar o painel no GitHub Pages

Dentro do repositório já criado no GitHub: **Add file → Upload files**, e
arraste **estes arquivos e pastas** (extraia o zip primeiro):

```
✅ index.html
✅ README.md
✅ .gitignore
✅ css/       (pasta inteira)
✅ js/        (pasta inteira, com config.js já preenchido — seção 3)
✅ data/
✅ scripts/
❌ docs_fonte/  ← NÃO subir (dado sensível sem máscara — ver seção 0)
```

Role até o fim da página e clique em **"Commit changes"**.

Depois: **Settings → Pages → Build and deployment → Source: "Deploy from a
branch"** → branch `main`, pasta `/ (root)` → Save. Em alguns minutos o
painel fica em `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

<details>
<summary>Alternativa: via git (linha de comando), para quem já usa</summary>

```bash
git add -A
git commit -m "Painel de controle de migração — versão inicial"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/NOME-DO-REPO.git
git push -u origin main
```
</details>

---

## 10. Limitações conhecidas / próximos passos sugeridos

- **Sem edição multiusuário simultânea de verdade:** o Google Sheets já
  resolve isso nativamente (duas pessoas podem editar ao mesmo tempo sem
  conflito) — não é uma limitação do painel, é uma vantagem de usar Sheets
  como fonte.
- **Atraso de propagação:** a planilha publicada demora alguns segundos a
  minutos para refletir uma edição recente (cache do Google). O botão
  "Atualizar agora" força uma nova busca, mas se a planilha ainda não
  republicou, o painel mostra o valor antigo por um instante.
- **Sem notificações automáticas:** o painel não avisa proativamente
  quando uma trilha fica atrasada. Automação natural: um Apps Script
  agendado (a própria Ananda já usa Apps Script) que varre a planilha
  diariamente e manda e-mail para os responsáveis com trilhas em atraso —
  posso montar isso quando fizer sentido.
- **Reimportação de clientes novos** ainda é manual na planilha (seção 6).

---

## 11. Créditos dos dados

Fonte: exportação `GOB_CLIENTES` do TOTVS Protheus, Grupo Paraná (arquivo
de referência em `docs_fonte/`, nunca publicado).
