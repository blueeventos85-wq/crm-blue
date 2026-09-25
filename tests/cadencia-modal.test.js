import { test, expect } from '@playwright/test';

test.describe('Cadência Modal Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
    // Wait for app to load
    await page.waitForLoadState('networkidle');
    
    // Navigate to Administrador tab
    await page.click('text=Administrador');
    await page.waitForTimeout(500);
    
    // Click Cadências tab
    await page.click('[data-admin-tab="cadencias"]');
    await page.waitForTimeout(500);
  });

  test('should open modal and show validation error when name is empty', async ({ page }) => {
    // Click Nova Cadência button
    await page.click('#cadenciaNewBtn');
    await page.waitForSelector('#cadenciaModal.open', { state: 'visible' });
    
    // Verify modal is open
    await expect(page.locator('#cadenciaModal')).toBeVisible();
    await expect(page.locator('#cadenciaModalTitle')).toHaveText('Nova Cadência');
    
    // Click Salvar Cadência without filling name
    await page.click('#cadenciaSaveBtn');
    
    // Should show toast error
    await expect(page.locator('.toast')).toBeVisible();
    await expect(page.locator('.toast')).toContainText('Preencha o nome da cadência');
    
    // Should show inline validation error
    await expect(page.locator('#cadenciaNomeInput')).toHaveClass(/invalid/);
    await expect(page.locator('#cadenciaNomeError')).toBeVisible();
    await expect(page.locator('#cadenciaNomeError')).toHaveText('O nome da cadência é obrigatório');
  });

  test('should create cadência with valid data', async ({ page }) => {
    // Click Nova Cadência button
    await page.click('#cadenciaNewBtn');
    await page.waitForSelector('#cadenciaModal.open', { state: 'visible' });
    
    // Fill name
    await page.fill('#cadenciaNomeInput', 'Teste Cadência E2E');
    
    // Select a color (click second color swatch)
    await page.click('#cadenciaColorPicker .color-swatch:nth-child(2)');
    
    // Click Salvar Cadência
    await page.click('#cadenciaSaveBtn');
    
    // Wait for toast success
    await expect(page.locator('.toast')).toBeVisible();
    await expect(page.locator('.toast')).toContainText('Cadência criada com sucesso');
    
    // Modal should close
    await expect(page.locator('#cadenciaModal')).not.toHaveClass(/open/);
    
    // Verify cadência appears in list
    await expect(page.locator('#cadenciaList .cadencia-name')).toContainText('Teste Cadência E2E');
  });

  test('should have visible buttons on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Click Nova Cadência button
    await page.click('#cadenciaNewBtn');
    await page.waitForSelector('#cadenciaModal.open', { state: 'visible' });
    
    // Verify modal is full width on mobile
    const modal = page.locator('#cadenciaModal');
    await expect(modal).toBeVisible();
    
    // Verify footer buttons are visible and stacked
    const cancelBtn = page.locator('[data-action="close-cadencia-modal"]');
    const saveBtn = page.locator('#cadenciaSaveBtn');
    
    await expect(cancelBtn).toBeVisible();
    await expect(saveBtn).toBeVisible();
    
    // Buttons should be full width on mobile
    const cancelBox = await cancelBtn.boundingBox();
    const saveBox = await saveBtn.boundingBox();
    const modalBox = await modal.boundingBox();
    
    // Buttons should be nearly full width of modal (within 20px margin)
    expect(cancelBox.width).toBeGreaterThan(modalBox.width - 40);
    expect(saveBox.width).toBeGreaterThan(modalBox.width - 40);
  });

  test('should scroll content when modal is tall', async ({ page }) => {
    // Set small height viewport
    await page.setViewportSize({ width: 400, height: 500 });
    
    // Click Nova Cadência button
    await page.click('#cadenciaNewBtn');
    await page.waitForSelector('#cadenciaModal.open', { state: 'visible' });
    
    // Verify modal body is scrollable
    const modalBody = page.locator('.admin-member-body');
    await expect(modalBody).toBeVisible();
    
    // The visibility checkboxes section should be scrollable into view
    const visibilitySection = page.locator('#cadenciaVisibilidadeChecks');
    await expect(visibilitySection).toBeVisible();
    
    // Footer should still be visible
    const footer = page.locator('.admin-member-foot');
    await expect(footer).toBeVisible();
  });
});