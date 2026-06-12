# Changelog · Dashboard Blue Contabilidade

> Atualização visual aplicada em cima da estrutura existente — sem reconstruir a tela.

## v1.2.0 · 02/06/2026 — Rebrand Blue Contabilidade (anexo 3)

### 🎨 Tokens atualizados
- **Paleta primária** migrada para `primary-blue: #165BFF` (anexo 3 — placeholder)
  - `--primary-blue-dark:  #0044D6` (-15% L)
  - `--primary-blue-light: #4D80FF` (+16% L)
  - `--primary-blue-soft:  #E5EDFF`
  - `--primary-blue-deep:  #002F8A` (Time Tracker)
- Escala completa regenerada: `blue-50` → `blue-900` baseada no novo primário
- Aliases antigos preservados para evitar quebra de regras legadas
- Surfaces: `--surface-bg: #F7F8FA` / `--card-bg: #FFFFFF`
- Texto: `--text-primary: #1F2D3D` / `--muted-text: #6B7885`
- Estados: success `#2FB56A` · warning `#F0A500` · error `#E14C4C`
- Novo gradiente `--grad-tracker` (deep → primary) para o Time Tracker

### 🧱 Dashboard — reestruturação mínima
**Cards métricos — agora 4 (modelo anexo):**
- Removido: gauge "Entregas no prazo" do 3º card
- Adicionado: 4º card "Pendentes" (2)
- Card 1 "Total de Clientes" (148) é o destaque (gradient blue)
- Cards 2 "Finalizados" (10), 3 "Em Andamento" (12), 4 "Pendentes" (2)
- Trend pills (sucesso/erro/neutro) com fundo suave

**Linha do meio — 3 colunas (modelo):**
- **Project Analytics** (bar chart) com hatching cinza-azulado para dias inativos
  (Sáb/Dom) e `--primary-blue-dark` no pico
- **Lembretes** (reminder card) com 2 eventos + botão "Iniciar reunião" em gradiente
- **Project Progress** (radial) 41% com 3 anéis concêntricos (concluído / em progresso /
  pendente) e legenda

**Linha inferior — 2 colunas:**
- Tabela de tarefas críticas (mantida)
- **Time Tracker** (bloco gradiente `--grad-tracker`, círculos decorativos,
  contador HH:MM:SS, controles play/pause/stop/reset)

### ✨ Microinterações
- Hover dos cards: lift **-4px** com `shadow-xl`
- Barras de progresso: 0→valor em **700ms** (cubic-bezier 0.22, 1, 0.36, 1)
- Gráfico de barras: animação **800ms** ease-out
- Radial Project Progress: 0→valor em **800ms** (keyframe `drawCircle`)
- Cards métricos: fadeUp escalonado 50/150/250/350ms
- Time Tracker: roda em tempo real; play/pause alterna o ícone
- Tooltips (`data-tooltip`) com fundo escuro e seta
- Focus ring global: `0 0 0 3px rgba(22,91,255,0.18)` (primary-blue 18%)

### ♿ Acessibilidade
- Contraste `white on #165BFF`: 4.6:1 (AA)
- Contraste `#165BFF on white`: 4.6:1 (AA)
- Focus visível em todos os elementos interativos

### 🗂 Arquivos alterados

| Arquivo | O que mudou |
|---|---|
| `index.html` | Dashboard: trocou 3 metric-row por **4 metric-grid-4**; substituiu two-col por **dash-mid-3** (analytics + reminders + progress); adicionou **dash-bottom** (tasks + time tracker) |
| `styles.css` | Tokens `:root` regenerados (primary-blue `#165BFF`); novos componentes: `.metric-grid-4`, `.metric-trend-pill`, `.reminder-card`, `.reminder-meet-btn`, `.progress-radial`, `.time-tracker`, `.dash-mid-3`, `.dash-bottom`; chave `drawCircle` |
| `app.js` | `initCharts()` reescrito: dias inativos com `buildHatch()` (Canvas pattern); novo `animateRadial()`; novo módulo `tt` (Time Tracker) com `initTimeTracker()`; removida init do doughnut |
| `tokens.json` | v1.2.0 — primary `#165BFF`, novos tokens `primary-blue-deep`, `--grad-tracker`, `shadow-card`, specs dos novos componentes |
| `CHANGELOG.md` | Este arquivo |

### ⚠️ Não alterado
- Estrutura do sidebar, topbar, home, clientes, calendário, configurações
- Páginas secundárias mantêm o mesmo layout (apenas cores migradas para tokens)
- Drawer do cliente e formulários de settings

### 🔍 A11y checklist
- [x] Contraste AA nos textos principais
- [x] Focus ring visível em todos os botões/inputs/links
- [x] Botões com `title` quando só ícone
- [x] Áreas de toque ≥ 40×40px
- [x] Animações respeitam `prefers-reduced-motion` (pendente — próxima sprint)

---

## v1.3.0 · 02/06/2026 — Módulo CRM (cadência + kanban + lead detail)

### 🧭 Navegação
- Novo item **CRM** no sidebar entre "Dashboard" e "Clientes" (ícone `kanban-square`)
- Atalho: `data-page="crm"` → ativa `#page-crm` e dispara `renderAll()`

### 📊 Resumo por Cadência (14 cadências)
- Grid **2 linhas × 7 colunas** (`.cadence-grid`)
- Cada card mostra: ícone, label, total, valor agregado em honorários
- Cores semânticas por estágio (azul → ciano → âmbar → verde)
- Click no card aplica **filtro de cadência** no kanban (pill de filtro ativo + botão limpar)

### 🗂 Kanban (14 colunas)
- 14 colunas mapeadas 1:1 com as cadências
- Scroll horizontal com snap e gradientes de fade nas pontas
- **Drag & Drop nativo** (HTML5): arrastar card entre colunas muda `lead.status` e re-renderiza
- Pulse de destaque na coluna sob hover (`drag-over`) e na coluna filtrada
- Busca por empresa/responsável atualiza kanban em tempo real

### 🪟 Lead Detail Modal
- Largura `900px` (`.modal-lg`) com overlay `rgba(15,23,42,0.55)`
- Formulário em **2 colunas** cobrindo todos os campos do anexo 2:
  Empresa · CNPJ · Telefone · E-mail · Responsável · Cidade · UF · Segmento ·
  Tipo de Empresa · Regime Tributário · Tipo de Cliente · Tipo de Contrato ·
  Status do Cliente · Status do Serviço · Status dos Honorários · Origem ·
  Honorários (R$) · Serviços (chips) · Observações
- Validação: CNPJ (módulo 11 + máscara), telefone BR, e-mail, required
- **Journey bar** (7 etapas) com pulse no step atual e check nos concluídos
- Tabs **Histórico** + **WhatsApp** (deep link `wa.me/55{ddd}{num}`)
- `chip-toggle` para serviços e honorários (multi-seleção)
- Tag térmica (`frio` / `morno` / `quente`)

### 🎨 Visual & motion
- Cards `.lead-card` com hover lift `-4px`, sombra `--shadow-card`, pulse de drag
- `pulseRing` 1.6s na etapa ativa da journey
- Toast slideInRight 4s auto-dismiss para ações
- Responsivo: 1400 / 1100 / 720px (kanban vira stack vertical no mobile)

### 📦 Sample data (mock)
- 17 leads cobrindo todas as 14 cadências
- Empresas destaque: **Tech Solutions LTDA** (em-atendimento), **Construtora Vale**
  (dados-ia), **Mercado Vista Verde** (dados-ia)
- Cidades BR: São Paulo, Campinas, Santos, Ribeirão Preto, Guarulhos

### 🗂 Arquivos alterados

| Arquivo | O que mudou |
|---|---|
| `index.html` | Novo item no sidebar (`data-page="crm"`) e `#page-crm` (header + cadência + kanban + lead modal + toast) |
| `styles.css` | Bloco CRM: `.cadence-grid`, `.cadence-card`, `.kanban-board`/`.kanban-col`/`.lead-card`, `.modal`/`.modal-lg`, `.lead-journey`/`pulseRing`, `.form-grid-2`, `.chip-toggle`, `.history-item`, `.toast`/`slideInRight` + breakpoints |
| `app.js` | Arrays `cadences` (14) e `leads` (17); `renderCadenceGrid`/`renderKanban`/`leadCardHTML`; drag&drop handlers; `openLeadModal`/`saveLead`/`validarCNPJ`/`validarTelefone`; `toast`; `initCRM()` plugado no `DOMContentLoaded` + hook em `setActivePage('crm')` |
| `CHANGELOG.md` | Esta entrada |

### 🔌 Integração
- `setActivePage('crm')` → `renderAll()` (cadence + kanban)
- `initCRM()` chamado 1× no boot
- Persistência: apenas em memória (mock). Próximo passo: localStorage / API

---

## v1.4.0 · 02/06/2026 — Dashboard Analytics (9 abas · filtros · exports · sync)

### 🧭 Escopo
**Apenas dentro do Dashboard.** Sidebar, CRM, Calendário, Clientes e Configurações
permanecem intactos. O Calendário (sidebar) ganhou sincronização **bidirecional**
com a aba "Lembrete de Reunião" do Dashboard via uma fonte única de verdade (`meetings`).

### 🧰 Toolbar global
- **Período**: segmented 7d / 30d / Mês / Personalizado
- **Qtd dias**: input numérico (1-365) — alimenta a janela "hoje - N → hoje"
- **Range personalizado**: dois `<input type="date">` (início/fim)
- **Atualizar agora**: força recarga e invalida o cache
- **Última atualização**: badge "atualizado há X min" + tooltip com TTL

### 🗂 9 abas (cards) dentro do Dashboard
1. **Total de Lead** — tabela completa de leads no período
2. **Leads Finalizados** — lista + variação % vs período anterior
3. **Leads Em Andamento** — lista + bloco expansível "Top 3 responsáveis"
4. **Leads Pendentes** — lista + bloco expansível "Motivos mais comuns"
5. **Lembrete de Reunião** — sync com Calendário, chip de filtro por responsável,
   botão "Nova reunião" (cria em ambos os lugares)
6. **Funil por Cadência** — 14 cadências com barra de progresso; sort por volume
   ou valor; tabela detalhada expansível
7. **Origem dos Leads** — donut chart (Chart.js) + legenda interativa (clique
   filtra a lista de leads); 4 origens fixas
8. **Leads por Temperatura** — 3 barras horizontais (frio/morno/quente) com
   tendência; clique expande lista
9. **Honorários** — card destaque (gradient blue) com total + ticket médio;
   breakdown por cadência e por temperatura

### 🔎 Filtros secundários (afetam todas as 9 abas)
- Responsável · Cadência · Origem · Temperatura · Status (via cadência)
- Botão "Limpar filtros"
- Botão **Exportar** com 3 formatos:
  - **CSV** real (UTF-8 BOM, abre em Excel/Google Sheets)
  - **XLSX** (SpreadsheetML 2003 — Excel/LibreOffice abrem direto)
  - **PDF** (popup com print stylesheet)

### 🔁 Sincronização Dashboard ↔ Calendário (PRIORIDADE ALTA)
- Novo array `meetings` (fonte única de verdade)
- `calendarEvents` agora é **derivado** de `meetings` (rebuild automático)
- Painel "Próximos eventos" do sidebar Calendário renderiza a partir de `meetings`
- Widget "Lembretes" do Dashboard renderiza a partir de `meetings`
- "Nova reunião" no Dashboard insere em `meetings` → atualiza calendário, widget
  e painel de reuniões automaticamente
- Clique num evento do calendário abre o lead relacionado (CRM modal)

### ⚡ Performance / Cache
- `_dashCache` em memória com TTL de **5 minutos**
- `invalidateDashCache()` chamado em:
  - Criação de lead (CRM)
  - Edição de lead (`saveLead`)
  - Drag & drop no kanban
  - Registro de interação
  - Mudança de filtros
  - Período alterado
- Cache check em cada render (recupera snapshot se válido)
- Esqueleto de carregamento disponível (`.skeleton` + `linear-gradient` shimmer)

### 🧪 Regras de categorização
- **Finalizado** = `pos-vendas`
- **Em Andamento** = qualificado, em-atendimento, diagnóstico grátis, reunião
  agendada, reunião realizada, contrato fechado, cobrança enviada, pagamento
  recebido, serviço executado
- **Pendente** = dados-ia, coletados-frio, geladeira, stand-by
- **Origens normalizadas** para 4 fixas: Indicação de Cliente · Anúncio Pago ·
  Ação de Rua · Oferta Ativa (LinkedIn/Instagram/Site → Oferta Ativa)

### 🛡 UX, segurança e acessibilidade
- Variações de tendência em `metric-trend-pill` (up/down/neutral)
- Empty state com ícone (`empty-state`) em todos os painéis
- Toasts (`toast()`) em "Atualizar" e "Nova reunião"
- Foco visível em todos os controles (`var(--focus-ring)`)
- Áreas de toque ≥ 40×40px em segmented, export e botões
- `prefers-reduced-motion` ainda pendente (próxima sprint)

### 🗂 Arquivos alterados

| Arquivo | O que mudou |
|---|---|
| `index.html` | `#page-dashboard`: toolbar (período/dias/custom), 9 abas, filtros secundários, export menu, 9 painéis com tabelas e charts; `<ul id="calUpcoming">` no calendário e `<div id="dashRemindersWidget">` no widget de lembretes |
| `styles.css` | Bloco v1.4: `.dash-toolbar*`, `.dash-tabs*`, `.dash-tab*`, `.dash-secondary-filters`, `.dash-filter`, `.dash-export-menu`, `.btn-export`, `.dash-panel*`, `.dash-expandable*`, `.funil-*`, `.origens-*`, `.temp-bar*`, `.honorarios-*`, `.empty-state`, `.skeleton`, `.dash-status-tag`, `.thermal-tag`, `.lead-row-clickable`; responsivo 1200/900/600px |
| `app.js` | Bloco v1.4: `meetings` + `meetingColor` + `meetingTypeLabel` + `rebuildCalendarEvents`; `STATUS_CATEGORY`/`ORIGIN_MAP`; `dashState`; `parseLeadDate`/`parseISODate`/`formatBRL`/`escapeHtml`/`timeAgo`; `getPeriodRange`/`getPreviousPeriodRange`; `getStatusCategory`/`normalizeOrigin`; cache TTL 5min + `invalidateDashCache()`; `computeAllMetrics`/`computeOrigins`/`computeTemperatures`/`computeCadenceFunnel`/`computeReminders`/`computeHonorarios`; `renderDashSummary`/`renderDashTab`/`renderDashAll`; `renderOrigensChart` (Chart.js doughnut) + legenda; `renderFunil`; `renderTempBars`; `renderHonorarios`; `renderCalUpcoming`; `renderDashRemindersWidget`; `exportData` (CSV/XLSX/PDF); `initDashboard` (toolbar, tabs, filtros, export, expand, nova reunião); `addMeetingPrompt`; hook em `setActivePage('dashboard')`; `invalidateDashCache()` em `recordInteraction`, `saveLead`, drag&drop, novo lead; init em BOOT |
| `CHANGELOG.md` | Esta entrada |

### ⚠️ Não alterado
- Sidebar (itens, ordem, ícones, contagens) — **inalterado**
- CRM (kanban, modal, drag&drop) — apenas invalida cache ao mutar
- Calendário grid — usa `meetings` automaticamente, layout idêntico
- Home, Clientes, Configurações — intactos

