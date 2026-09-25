# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/cadencia-modal.test.js >> Cadência Modal Flow >> should open modal and show validation error when name is empty
- Location: tests/cadencia-modal.test.js:18:3

# Error details

```
Error: page.click: Target page, context or browser has been closed
Call log:
  - waiting for locator('text=Administrador')
    - locator resolved to 6 elements. Proceeding with the first one: <span>Administrador</span>
  - attempting click action
    - waiting for element to be visible, enabled and stable

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
      |                ^ Error: page.click: Target page, context or browser has been closed
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