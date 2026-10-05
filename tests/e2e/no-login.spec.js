import { test, expect } from '@playwright/test';

/* ===========================================================
   Testes E2E SEM login — boot, navegação e estabilidade
   -----------------------------------------------------------
   Cenários cobertos sem credenciais:
     1. o boot não lança exceção não tratada nem destrói a UI;
     2. a tela de login aparece e o app por trás continua íntegro;
     3. a navegação funciona (delegação da sidebar) e uma rota
        inexistente não deixa a tela em branco.
   Os cenários pós-login (dados reais, cadastro visível sem F5)
   exigem credenciais e ficam para verificação manual.
   =========================================================== */

const BASE = 'http://localhost:5175';

/** Abre a página e aguarda o estado inicial (overlay de login). */
async function openApp(page) {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(String(err)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#authOverlay', { state: 'attached', timeout: 20000 });
  // tempo para o boot completo (cargas paralelas + auth + render inicial)
  await page.waitForTimeout(4000);
  return pageErrors;
}

test.describe('Boot sem login', () => {
  test('não lança exceção não tratada durante a inicialização', async ({ page }) => {
    const errors = await openApp(page);
    expect(errors, `Exceções não tratadas: ${errors.join(' | ')}`).toEqual([]);
  });

  test('mantém a UI intacta (sem tela de erro destrutiva)', async ({ page }) => {
    await openApp(page);
    // O catch do boot não pode mais substituir document.body
    const texto = await page.locator('body').innerText();
    expect(texto).not.toContain('Erro ao inicializar');
    await expect(page.locator('#authOverlay')).toBeVisible();
    await expect(page.locator('.app')).toHaveCount(1);
    await expect(page.locator('#page-home')).toHaveCount(1);
    await expect(page.locator('.sidebar-nav')).toHaveCount(1);
  });

  test('scripts do head não bloqueiam o parse (defer)', async ({ page }) => {
    await openApp(page);
    const bloqueantes = await page.evaluate(() =>
      [...document.scripts]
        .filter(s => s.src && !s.defer && s.type !== 'module')
        .map(s => s.src)
    );
    expect(bloqueantes).toEqual([]);
  });

  test('funções usadas por onclick inline estão em window', async ({ page }) => {
    await openApp(page);
    const tipos = await page.evaluate(() => ({
      setActivePage: typeof window.setActivePage,
      convToggleArchive: typeof window.convToggleArchive,
      openCcModal: typeof window.openCcModal
    }));
    expect(tipos.setActivePage).toBe('function');
    expect(tipos.convToggleArchive).toBe('function');
    expect(tipos.openCcModal).toBe('function');
  });
});

test.describe('Navegação sem login', () => {
  test('setActivePage troca a página e atualiza o destaque do menu', async ({ page }) => {
    const errors = await openApp(page);
    await page.evaluate(() => window.setActivePage('dashboard'));
    await expect(page.locator('#page-dashboard')).toHaveClass(/active/);
    await expect(page.locator('#page-home')).not.toHaveClass(/active/);
    const navAtiva = await page.locator('.nav-item.active').getAttribute('data-page');
    expect(navAtiva).toBe('dashboard');
    expect(errors).toEqual([]);
  });

  test('rota inexistente não deixa a tela em branco', async ({ page }) => {
    await openApp(page);
    const antes = await page.locator('.page.active').count();
    expect(antes).toBeGreaterThan(0);

    await page.evaluate(() => window.setActivePage('pagina-que-nao-existe'));

    const depois = await page.locator('.page.active').count();
    expect(depois).toBe(antes);
  });

  test('sidebar navega por delegação (clique troca a rota)', async ({ page }) => {
    const errors = await openApp(page);
    const delegado = await page.evaluate(() =>
      !!document.querySelector('.sidebar-nav')._navClickBound
    );
    expect(delegado).toBe(true);

    await page.evaluate(() => {
      document.querySelector('.sidebar-nav .nav-item[data-page="crm"]')?.click();
    });
    await expect(page.locator('#page-crm')).toHaveClass(/active/);
    expect(errors).toEqual([]);
  });

  test('repetir a mesma rota mantém exatamente uma página ativa', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      window.setActivePage('rotina');
      window.setActivePage('rotina');
    });
    const ativas = await page.locator('.page.active').count();
    expect(ativas).toBe(1);
    await expect(page.locator('#page-rotina')).toHaveClass(/active/);
  });
});
