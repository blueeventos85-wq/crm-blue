# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/cadencia-modal.test.js >> Cadência Modal Flow >> should have visible buttons on mobile viewport
- Location: tests/cadencia-modal.test.js:65:3

# Error details

```
Test timeout of 30000ms exceeded while running "beforeEach" hook.
```

```
Error: page.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('text=Administrador')
    - locator resolved to 6 elements. Proceeding with the first one: <span>Administrador</span>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="auth-bg"></div> from <div id="authOverlay" class="auth-overlay">…</div> subtree intercepts pointer events
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="auth-bg"></div> from <div id="authOverlay" class="auth-overlay">…</div> subtree intercepts pointer events
    - retrying click action
      - waiting 100ms
    40 × waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <div class="auth-bg"></div> from <div id="authOverlay" class="auth-overlay">…</div> subtree intercepts pointer events
     - retrying click action
       - waiting 500ms
    - waiting for element to be visible, enabled and stable

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - img "Blue Group" [ref=e6]
      - paragraph [ref=e7]: Acesse sua conta para gerenciar o CRM.
    - generic [ref=e8]:
      - generic [ref=e9]:
        - generic [ref=e10]: E-mail
        - textbox "E-mail" [active] [ref=e15]:
          - /placeholder: seu@email.com
          - text: pedro@agenciabluepro
      - generic [ref=e16]:
        - generic [ref=e17]: Senha
        - generic [ref=e18]:
          - textbox "Senha" [ref=e22]:
            - /placeholder: Sua senha
          - button "Mostrar senha" [ref=e23] [cursor=pointer]
      - generic [ref=e27]:
        - generic [ref=e28] [cursor=pointer]:
          - checkbox "Lembrar de mim" [ref=e29]
          - generic [ref=e30]: Lembrar de mim
        - link "Esqueceu a senha?" [ref=e31] [cursor=pointer]:
          - /url: "#"
      - button "Entrar" [ref=e32] [cursor=pointer]
  - generic [ref=e36]:
    - complementary [ref=e37]:
      - img "Blue Group" [ref=e39]
      - navigation [ref=e40]:
        - paragraph [ref=e41]: Principal
        - list [ref=e42]:
          - listitem [ref=e43]:
            - link "Home" [ref=e44] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e49]:
            - link "Dashboard" [ref=e50] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e57]:
            - link "CRM" [ref=e58] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e62]:
            - link "Conversas" [ref=e63] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e67]:
            - link "Contratos" [ref=e68] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e73]:
            - link "Cliente da Base" [ref=e74] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e81]:
            - link "Calendário" [ref=e82] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e86]:
            - link "Rotina Blue" [ref=e87] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e92]:
            - link "Pomodoro" [ref=e93] [cursor=pointer]:
              - /url: "#"
        - paragraph [ref=e98]: Ferramentas
        - list [ref=e99]:
          - listitem [ref=e100]:
            - link "Configurações" [ref=e101] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e106]:
            - link "Auditoria" [ref=e107] [cursor=pointer]:
              - /url: "#"
          - listitem [ref=e111]:
            - link "Administrador" [ref=e112] [cursor=pointer]:
              - /url: "#"
      - generic [ref=e118]:
        - generic [ref=e119]: CS
        - paragraph [ref=e121]: Usuário
        - button "Sair" [ref=e122] [cursor=pointer]
    - main [ref=e126]:
      - generic [ref=e127]:
        - generic [ref=e128]:
          - button "Menu" [ref=e129] [cursor=pointer]
          - generic [ref=e131]:
            - heading "Home" [level=1] [ref=e132]
            - paragraph [ref=e133]: Bem-vindo ao Blue Group
        - generic [ref=e134]:
          - button "Ativar tema escuro" [ref=e135] [cursor=pointer]
          - button "Notificações" [ref=e138] [cursor=pointer]
      - generic [ref=e143]:
        - generic [ref=e144]:
          - generic [ref=e145]:
            - generic [ref=e146]:
              - heading "Bem vindo ao Blue Group" [level=1] [ref=e147]
              - paragraph [ref=e148]: Acesse rapidamente os módulos e recursos do sistema
            - generic [ref=e149]:
              - textbox "Buscar módulos" [ref=e153]:
                - /placeholder: Buscar módulos...
              - generic [ref=e154]: /
          - main [ref=e155]:
            - generic [ref=e156]:
              - heading "Principal" [level=2] [ref=e157]
              - list [ref=e160]:
                - listitem [ref=e161]:
                  - button "Abrir Home" [ref=e162] [cursor=pointer]:
                    - generic [ref=e167]:
                      - heading "Home" [level=3] [ref=e168]
                      - paragraph [ref=e169]: Acesse rapidamente os principais módulos do sistema.
                - listitem [ref=e173]:
                  - button "Abrir Dashboard" [ref=e174] [cursor=pointer]:
                    - generic [ref=e181]:
                      - heading "Dashboard" [level=3] [ref=e182]
                      - paragraph [ref=e183]: Indicadores e métricas em tempo real.
                - listitem [ref=e187]:
                  - button "Abrir CRM" [ref=e188] [cursor=pointer]:
                    - generic [ref=e192]:
                      - heading "CRM" [level=3] [ref=e193]
                      - paragraph [ref=e194]: Centralize o relacionamento com clientes.
                - listitem [ref=e198]:
                  - button "Abrir Conversas" [ref=e199] [cursor=pointer]:
                    - generic [ref=e203]:
                      - heading "Conversas" [level=3] [ref=e204]
                      - paragraph [ref=e205]: Central de conversas e mensagens da equipe.
                - listitem [ref=e209]:
                  - button "Abrir Contratos" [ref=e210] [cursor=pointer]:
                    - generic [ref=e215]:
                      - heading "Contratos" [level=3] [ref=e216]
                      - paragraph [ref=e217]: Gere e gerencie contratos de prestação de serviços.
                - listitem [ref=e221]:
                  - button "Abrir Cliente da Base" [ref=e222] [cursor=pointer]:
                    - generic [ref=e229]:
                      - heading "Cliente da Base" [level=3] [ref=e230]
                      - paragraph [ref=e231]: Organize e qualifique os clientes.
                - listitem [ref=e235]:
                  - button "Abrir Calendário" [ref=e236] [cursor=pointer]:
                    - generic [ref=e240]:
                      - heading "Calendário" [level=3] [ref=e241]
                      - paragraph [ref=e242]: Organize as datas dos eventos.
                - listitem [ref=e246]:
                  - button "Abrir Rotina Blue" [ref=e247] [cursor=pointer]:
                    - generic [ref=e252]:
                      - heading "Rotina Blue" [level=3] [ref=e253]
                      - paragraph [ref=e254]: Organize tarefas, reuniões e lembretes do dia a dia.
                - listitem [ref=e258]:
                  - button "Abrir Pomodoro" [ref=e259] [cursor=pointer]:
                    - generic [ref=e264]:
                      - heading "Pomodoro" [level=3] [ref=e265]
                      - paragraph [ref=e266]: Gestão de tempo e foco com ciclos de trabalho.
            - generic [ref=e270]:
              - heading "Ferramentas" [level=2] [ref=e271]
              - list [ref=e274]:
                - listitem [ref=e275]:
                  - button "Abrir Configurações" [ref=e276] [cursor=pointer]:
                    - generic [ref=e281]:
                      - heading "Configurações" [level=3] [ref=e282]
                      - paragraph [ref=e283]: Personalize conta e equipe.
                - listitem [ref=e287]:
                  - button "Abrir Auditoria" [ref=e288] [cursor=pointer]:
                    - generic [ref=e292]:
                      - heading "Auditoria" [level=3] [ref=e293]
                      - paragraph [ref=e294]: Rastreamento completo de ações e histórico do sistema.
                - listitem [ref=e298]:
                  - button "Abrir Administrador" [ref=e299] [cursor=pointer]:
                    - generic [ref=e304]:
                      - heading "Administrador" [level=3] [ref=e305]
                      - paragraph [ref=e306]: Gerencie usuários, permissões e configurações do sistema.
                - listitem [ref=e310]:
                  - button "Abrir Calibragem" [ref=e311] [cursor=pointer]:
                    - generic [ref=e316]:
                      - heading "Calibragem" [level=3] [ref=e317]
                      - paragraph [ref=e318]: Calibre e ajuste parâmetros do sistema.
        - text: ✓ ✓ ✓ ✓ ✓
  - complementary [ref=e322]:
    - generic [ref=e323]:
      - generic [ref=e324]:
        - generic [ref=e325]: TS
        - generic [ref=e326]:
          - heading "Tech Solutions LTDA" [level=3] [ref=e327]
          - paragraph [ref=e328]: 12.345.678/0001-90
      - button [ref=e329] [cursor=pointer]
    - generic [ref=e333]:
      - button "Visão geral" [ref=e334] [cursor=pointer]
      - button "Documentos" [ref=e335] [cursor=pointer]
      - button "Histórico" [ref=e336] [cursor=pointer]
      - button "Obrigações" [ref=e337] [cursor=pointer]
    - generic [ref=e338]:
      - generic [ref=e339]:
        - generic [ref=e340]:
          - paragraph [ref=e341]: Regime
          - paragraph [ref=e342]: Lucro Presumido
        - generic [ref=e343]:
          - paragraph [ref=e344]: Status
          - paragraph [ref=e345]:
            - generic [ref=e346]: Ativo
        - generic [ref=e347]:
          - paragraph [ref=e348]: Responsável
          - paragraph [ref=e349]: Camila Souza
        - generic [ref=e350]:
          - paragraph [ref=e351]: Cliente desde
          - paragraph [ref=e352]: Mar/2022
      - heading "Situação fiscal/contábil" [level=4] [ref=e353]
      - generic [ref=e354]:
        - generic [ref=e359]:
          - paragraph [ref=e360]: Certidões negativas
          - text: Regular · vence em 45 dias
        - generic [ref=e364]:
          - paragraph [ref=e365]: SPED Contribuições
          - text: Pendente · vence 10/06
        - generic [ref=e370]:
          - paragraph [ref=e371]: Folha de pagamento
          - text: Em dia · próxima em 05/06
        - generic [ref=e376]:
          - paragraph [ref=e377]: Conciliação bancária
          - text: Concluída · 100%
      - heading "Histórico de interações" [level=4] [ref=e378]
      - list [ref=e379]:
        - listitem [ref=e380]:
          - generic [ref=e382]:
            - paragraph [ref=e383]: Reunião de fechamento · Abril
            - paragraph [ref=e384]: 28/04/2026 · 45 min · com João Silva
            - paragraph [ref=e385]: Apresentados resultados do trimestre e alinhamento de estratégias tributárias.
        - listitem [ref=e386]:
          - generic [ref=e388]:
            - paragraph [ref=e389]: E-mail · Documentos recebidos
            - paragraph [ref=e390]: 22/04/2026 · Notas fiscais de abril
            - paragraph [ref=e391]: Cliente enviou XMLs de NF-e para conciliação.
        - listitem [ref=e392]:
          - generic [ref=e394]:
            - paragraph [ref=e395]: Ligação · Planejamento tributário
            - paragraph [ref=e396]: 15/04/2026 · 20 min · com a sócia Ana
            - paragraph [ref=e397]: Avaliação de mudança de regime para 2027.
        - listitem [ref=e398]:
          - generic [ref=e400]:
            - paragraph [ref=e401]: Entrega · ECF 2025
            - paragraph [ref=e402]: 10/04/2026 · Sistema
            - paragraph [ref=e403]: Obrigação entregue no prazo com sucesso.
  - text: Este lead espelha o registro em Clientes da Base
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | test.describe('Cadência Modal Flow', () => {
  4   |   test.beforeEach(async ({ page }) => {
  5   |     await page.goto('http://localhost:5173');
  6   |     // Wait for app to load
  7   |     await page.waitForLoadState('networkidle');
  8   |     
  9   |     // Navigate to Administrador tab
> 10  |     await page.click('text=Administrador');
      |                ^ Error: page.click: Test timeout of 30000ms exceeded.
  11  |     await page.waitForTimeout(500);
  12  |     
  13  |     // Click Cadências tab
  14  |     await page.click('[data-admin-tab="cadencias"]');
  15  |     await page.waitForTimeout(500);
  16  |   });
  17  | 
  18  |   test('should open modal and show validation error when name is empty', async ({ page }) => {
  19  |     // Click Nova Cadência button
  20  |     await page.click('#cadenciaNewBtn');
  21  |     await page.waitForSelector('#cadenciaModal.open', { state: 'visible' });
  22  |     
  23  |     // Verify modal is open
  24  |     await expect(page.locator('#cadenciaModal')).toBeVisible();
  25  |     await expect(page.locator('#cadenciaModalTitle')).toHaveText('Nova Cadência');
  26  |     
  27  |     // Click Salvar Cadência without filling name
  28  |     await page.click('#cadenciaSaveBtn');
  29  |     
  30  |     // Should show toast error
  31  |     await expect(page.locator('.toast')).toBeVisible();
  32  |     await expect(page.locator('.toast')).toContainText('Preencha o nome da cadência');
  33  |     
  34  |     // Should show inline validation error
  35  |     await expect(page.locator('#cadenciaNomeInput')).toHaveClass(/invalid/);
  36  |     await expect(page.locator('#cadenciaNomeError')).toBeVisible();
  37  |     await expect(page.locator('#cadenciaNomeError')).toHaveText('O nome da cadência é obrigatório');
  38  |   });
  39  | 
  40  |   test('should create cadência with valid data', async ({ page }) => {
  41  |     // Click Nova Cadência button
  42  |     await page.click('#cadenciaNewBtn');
  43  |     await page.waitForSelector('#cadenciaModal.open', { state: 'visible' });
  44  |     
  45  |     // Fill name
  46  |     await page.fill('#cadenciaNomeInput', 'Teste Cadência E2E');
  47  |     
  48  |     // Select a color (click second color swatch)
  49  |     await page.click('#cadenciaColorPicker .color-swatch:nth-child(2)');
  50  |     
  51  |     // Click Salvar Cadência
  52  |     await page.click('#cadenciaSaveBtn');
  53  |     
  54  |     // Wait for toast success
  55  |     await expect(page.locator('.toast')).toBeVisible();
  56  |     await expect(page.locator('.toast')).toContainText('Cadência criada com sucesso');
  57  |     
  58  |     // Modal should close
  59  |     await expect(page.locator('#cadenciaModal')).not.toHaveClass(/open/);
  60  |     
  61  |     // Verify cadência appears in list
  62  |     await expect(page.locator('#cadenciaList .cadencia-name')).toContainText('Teste Cadência E2E');
  63  |   });
  64  | 
  65  |   test('should have visible buttons on mobile viewport', async ({ page }) => {
  66  |     // Set mobile viewport
  67  |     await page.setViewportSize({ width: 375, height: 667 });
  68  |     
  69  |     // Click Nova Cadência button
  70  |     await page.click('#cadenciaNewBtn');
  71  |     await page.waitForSelector('#cadenciaModal.open', { state: 'visible' });
  72  |     
  73  |     // Verify modal is full width on mobile
  74  |     const modal = page.locator('#cadenciaModal');
  75  |     await expect(modal).toBeVisible();
  76  |     
  77  |     // Verify footer buttons are visible and stacked
  78  |     const cancelBtn = page.locator('[data-action="close-cadencia-modal"]');
  79  |     const saveBtn = page.locator('#cadenciaSaveBtn');
  80  |     
  81  |     await expect(cancelBtn).toBeVisible();
  82  |     await expect(saveBtn).toBeVisible();
  83  |     
  84  |     // Buttons should be full width on mobile
  85  |     const cancelBox = await cancelBtn.boundingBox();
  86  |     const saveBox = await saveBtn.boundingBox();
  87  |     const modalBox = await modal.boundingBox();
  88  |     
  89  |     // Buttons should be nearly full width of modal (within 20px margin)
  90  |     expect(cancelBox.width).toBeGreaterThan(modalBox.width - 40);
  91  |     expect(saveBox.width).toBeGreaterThan(modalBox.width - 40);
  92  |   });
  93  | 
  94  |   test('should scroll content when modal is tall', async ({ page }) => {
  95  |     // Set small height viewport
  96  |     await page.setViewportSize({ width: 400, height: 500 });
  97  |     
  98  |     // Click Nova Cadência button
  99  |     await page.click('#cadenciaNewBtn');
  100 |     await page.waitForSelector('#cadenciaModal.open', { state: 'visible' });
  101 |     
  102 |     // Verify modal body is scrollable
  103 |     const modalBody = page.locator('.admin-member-body');
  104 |     await expect(modalBody).toBeVisible();
  105 |     
  106 |     // The visibility checkboxes section should be scrollable into view
  107 |     const visibilitySection = page.locator('#cadenciaVisibilidadeChecks');
  108 |     await expect(visibilitySection).toBeVisible();
  109 |     
  110 |     // Footer should still be visible
```