import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ===========================================================
   Testes: Permissão "Ver todos os leads e clientes da base"
   (can_leads_view_all)
   - definição da flag + matriz por perfil
   - trava imutável do Administrador
   - helper canViewAllLeadsClientes
   - aplicação em Pipeline (CRM) e Cliente da Base
   - persistência perfis_permissoes → membros_permissoes
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSource = readFileSync(join(root, 'app.js'), 'utf8');
const clientSource = readFileSync(join(root, 'supabaseClient.js'), 'utf8');
const seedSql = readFileSync(join(root, 'Colunas:Tabelas/migration_perfis_permissoes.sql'), 'utf8');

const KEY = 'can_leads_view_all';
const LABEL = 'Ver todos os leads e clientes da base';

function extrairFuncao(nome, source = appSource) {
  const inicio = source.indexOf(`function ${nome}(`);
  assert.notEqual(inicio, -1, `função ${nome} não encontrada`);
  const fim = source.indexOf('\n}', inicio);
  assert.ok(fim > inicio, `fim da função ${nome} não encontrado`);
  return source.slice(inicio, fim + 2);
}

function extrairFuncaoAsync(nome, source = appSource) {
  const inicio = source.indexOf(`async function ${nome}(`);
  assert.notEqual(inicio, -1, `função ${nome} não encontrada`);
  const fim = source.indexOf('\n}', inicio);
  assert.ok(fim > inicio, `fim da função ${nome} não encontrado`);
  return source.slice(inicio, fim + 2);
}

function extrairConst(nome) {
  const inicio = appSource.indexOf(`const ${nome} = `);
  assert.notEqual(inicio, -1, `const ${nome} não encontrada em app.js`);
  const fim = appSource.indexOf('\n];', inicio);
  assert.ok(fim > inicio, `fim de ${nome} não encontrado`);
  return appSource.slice(inicio, fim + 3);
}

function extrairObjeto(nome) {
  const inicio = appSource.indexOf(`const ${nome} = `);
  assert.notEqual(inicio, -1, `const ${nome} não encontrada em app.js`);
  const fim = appSource.indexOf('\n};', inicio);
  assert.ok(fim > inicio, `fim de ${nome} não encontrado`);
  return appSource.slice(inicio, fim + 3);
}

/* ===========================================================
   Suite: Definição da flag
   =========================================================== */
describe('can_leads_view_all · definição', () => {
  const { PERM_CRUD_KEYS, PERFIL_DEFAULTS } = new Function(
    `${extrairConst('PERM_CRUD_KEYS')}; ${extrairObjeto('PERFIL_DEFAULTS')}; return { PERM_CRUD_KEYS, PERFIL_DEFAULTS };`
  )();

  it('key faz parte de PERM_CRUD_KEYS (persiste no JSONB permissions)', () => {
    assert.ok(PERM_CRUD_KEYS.includes(KEY), `${KEY} deve estar em PERM_CRUD_KEYS`);
  });

  it('Administrador tem a permissão true por padrão', () => {
    assert.equal(PERFIL_DEFAULTS['Administrador'][KEY], true);
  });

  it('demais perfis não têm a permissão por padrão (desmarcada)', () => {
    ['Atendente', 'Marketing', 'Pre Vendas', 'Membro'].forEach(perfil => {
      assert.notEqual(PERFIL_DEFAULTS[perfil][KEY], true,
        `${perfil} não deve ter ${KEY} true por padrão`);
    });
  });

  it('label exato existe na matriz (grupo Leads / Clientes)', () => {
    const rows = new Function(`return ${extrairConst('PERM_MATRIX_ROWS').replace('const PERM_MATRIX_ROWS = ', '')}`)();
    const grupo = rows.find(g => g.group === 'Leads / Clientes');
    assert.ok(grupo, 'grupo Leads / Clientes ausente');
    const row = grupo.perms.find(p => p.key === KEY);
    assert.ok(row, `${KEY} ausente na matriz`);
    assert.equal(row.label, LABEL);
  });

  it('seed SQL inclui a flag para Administrador', () => {
    assert.ok(seedSql.includes(`"${KEY}": true`), 'seed perfis_permissoes sem a flag');
  });
});

/* ===========================================================
   Suite: Matriz — trava imutável do Administrador
   =========================================================== */
describe('can_leads_view_all · matriz de permissões', () => {
  const renderSrc = extrairFuncao('renderPermMatrix');
  const rows = new Function(`return ${extrairConst('PERM_MATRIX_ROWS').replace('const PERM_MATRIX_ROWS = ', '')}`)();
  const cols = new Function(`return ${extrairConst('PERM_MATRIX_COLS').replace('const PERM_MATRIX_COLS = ', '')}`)();

  function renderCom(perfilPerms) {
    const tbody = { innerHTML: '' };
    const fakeDocument = { getElementById: id => (id === 'adminPermMatrixBody' ? tbody : null) };
    const make = new Function(
      'document', 'PERM_MATRIX_ROWS', 'PERM_MATRIX_COLS', 'getProfilePermissions', 'escapeHtml', 'initIcons',
      `${renderSrc}; return renderPermMatrix;`
    );
    const render = make(fakeDocument, rows, cols, () => perfilPerms, s => String(s), () => {});
    render({}, {});
    return tbody.innerHTML;
  }

  it('renderiza a linha com o label exato', () => {
    const html = renderCom({});
    assert.ok(html.includes(LABEL), 'label da permissão ausente na matriz');
    assert.ok(html.includes(`data-perm="${KEY}"`), 'checkbox da permissão ausente');
  });

  it('checkbox do Administrador é checked e disabled (imutável)', () => {
    const html = renderCom({ administrador: { [KEY]: false }, atendente: {} });
    const re = new RegExp(`data-perm="${KEY}" data-profile="administrador" checked disabled`);
    assert.ok(re.test(html), 'checkbox do Administrador deve ser checked+disabled mesmo se o banco digitar false');
  });

  it('checkbox dos demais perfis é editável', () => {
    const html = renderCom({ atendente: {} });
    assert.ok(html.includes(`data-perm="${KEY}" data-profile="atendente">`),
      'checkbox do Atendente deve ser normal (editável)');
  });

  it('checkbox marcado quando o perfil tem a permissão', () => {
    const html = renderCom({ pre_vendas: { [KEY]: true } });
    const re = new RegExp(`data-perm="${KEY}" data-profile="pre_vendas" checked`);
    assert.ok(re.test(html));
  });
});

/* ===========================================================
   Suite: Helper canViewAllLeadsClientes
   =========================================================== */
describe('canViewAllLeadsClientes · comportamento', () => {
  const src = extrairFuncao('canViewAllLeadsClientes');
  const make = new Function('isCurrentUserAdmin', 'can', `${src}; return canViewAllLeadsClientes;`);

  it('Administrador sempre vê todos (bypass)', () => {
    assert.equal(make(() => true, () => false)(), true);
  });

  it('não-admin com a permissão ativa vê todos', () => {
    const fn = make(() => false, k => k === KEY);
    assert.equal(fn(), true);
  });

  it('não-admin sem a permissão NÃO vê todos', () => {
    const fn = make(() => false, k => k === 'can_leads_read');
    assert.equal(fn(), false);
  });

  it('canViewAllData permanece restrito a Administrador (módulos intactos)', () => {
    const srcViewAll = extrairFuncao('canViewAllData');
    assert.ok(srcViewAll.includes('return isCurrentUserAdmin();'),
      'canViewAllData não deve ser alterado para não afetar Rotinas/Contratos/Dashboard');
  });
});

/* ===========================================================
   Suite: Aplicação — Pipeline (CRM)
   =========================================================== */
describe('Regra aplicada · Pipeline / CRM', () => {
  it('boot de leads usa canViewAllLeadsClientes', () => {
    const bootIdx = appSource.indexOf(`bootLoad('leads'`);
    assert.notEqual(bootIdx, -1);
    const trecho = appSource.slice(bootIdx, bootIdx + 300);
    assert.ok(trecho.includes('canViewAllLeadsClientes() ? null : getCurrentUserId()'),
      'boot de leads ainda usa canViewAllData');
  });

  it('refresh do cache usa canViewAllLeadsClientes', () => {
    const src = extrairFuncao('refreshLeadsEClientsCache');
    assert.ok(src.includes('canViewAllLeadsClientes() ? null : getCurrentUserId()'),
      'refreshLeadsEClientsCache ainda usa canViewAllData');
    assert.ok(!src.includes('canViewAllData()'));
  });

  it('getSearchFilteredLeads aplica a nova regra e mantém filtro de 3 colunas', () => {
    const src = extrairFuncao('getSearchFilteredLeads');
    assert.ok(src.includes('canViewAllLeadsClientes()'), 'filtro de render não usa a nova regra');
    assert.ok(!src.includes('canViewAllData()'));
    assert.ok(src.includes('membroId !== userId && qualificadorId !== userId'),
      'filtro membro/qualificador/owner deve ser mantido quando sem permissão');
    assert.ok(src.includes('currentCrmEmpresaFilter'), 'recorte por centro de custo (UI) deve ser mantido');
  });

  it('fetchLeadsSupabase mantém filtro por membro/qualificador/owner sem permissão', () => {
    const inicio = clientSource.indexOf('async function fetchLeadsSupabase(');
    assert.notEqual(inicio, -1);
    const fim = clientSource.indexOf('\n}', inicio);
    const src = clientSource.slice(inicio, fim + 2);
    assert.ok(src.includes(`.eq('membro_id', filterMemberId)`));
    assert.ok(src.includes(`.eq('qualificador_id', filterMemberId)`));
    assert.ok(src.includes(`.eq('owner_id', filterMemberId)`));
  });
});

/* ===========================================================
   Suite: Aplicação — Cliente da Base
   =========================================================== */
describe('Regra aplicada · Cliente da Base', () => {
  it('boot de clientes usa canViewAllLeadsClientes', () => {
    const bootIdx = appSource.indexOf(`bootLoad('clientes'`);
    assert.notEqual(bootIdx, -1);
    const trecho = appSource.slice(bootIdx, bootIdx + 300);
    assert.ok(trecho.includes('canViewAllLeadsClientes() ? null : getCurrentUserId()'),
      'boot de clientes ainda usa canViewAllData');
  });

  it('getFilteredClients aplica a nova regra e mantém escopo do membro', () => {
    const src = extrairFuncao('getFilteredClients');
    assert.ok(src.includes('canViewAllLeadsClientes()'), 'filtro de clientes não usa a nova regra');
    assert.ok(!src.includes('canViewAllData()'));
    assert.ok(src.includes('membroId === userId || qualificadorId === userId'),
      'filtro membro/qualificador/owner deve ser mantido quando sem permissão');
    assert.ok(src.includes('clienteCcFilter'), 'recorte por centro de custo (UI) deve ser mantido');
  });

  it('fetchClientsSupabase mantém filtro por membro/qualificador/owner sem permissão', () => {
    const inicio = clientSource.indexOf('async function fetchClientsSupabase(');
    assert.notEqual(inicio, -1);
    const fim = clientSource.indexOf('\n}', inicio);
    const src = clientSource.slice(inicio, fim + 2);
    assert.ok(src.includes(`.eq('membro_id', filterMemberId)`));
    assert.ok(src.includes(`.eq('qualificador_id', filterMemberId)`));
    assert.ok(src.includes(`.eq('owner_id', filterMemberId)`));
  });

  it('exatamente 6 pontos de chamada + 1 definição do helper + loadContratoLeads', () => {
    // 8 = 1 definição + 5 usos diretos + 2 na linha do guard typeof em loadContratoLeads
    const total = (appSource.match(/canViewAllLeadsClientes/g) || []).length;
    assert.equal(total, 8, `esperado 8 ocorrências, encontrado ${total}`);
  });
});

/* ===========================================================
   Suite: Aplicação — Modal Gerar Contrato (Selecionar Lead)
   =========================================================== */
describe('Regra aplicada · Modal Gerar Contrato (loadContratoLeads)', () => {
  const src = extrairFuncaoAsync('loadContratoLeads');

  it('busca de leads do modal usa canViewAllLeadsClientes', () => {
    assert.ok(src.includes('canViewAllLeadsClientes()'),
      'loadContratoLeads não usa a permissão can_leads_view_all');
  });

  it('loadContratoLeads não usa mais canViewAllData (admin-only)', () => {
    assert.ok(!src.includes('canViewAllData()'),
      'loadContratoLeads ainda restringe a lista a Administrador');
  });

  it('mantém filtro de 3 colunas (membro/qualificador/owner) sem permissão', () => {
    assert.ok(src.includes(`.eq('membro_id', filterId)`));
    assert.ok(src.includes(`.eq('qualificador_id', filterId)`));
    assert.ok(src.includes(`.eq('owner_id', filterId)`));
  });
});

/* ===========================================================
   Suite: Persistência (Salvar Permissões Globais)
   =========================================================== */
describe('can_leads_view_all · persistência', () => {
  const saveSrc = extrairFuncaoAsync('handlePermMatrixSave');
  const loadSrc = extrairFuncaoAsync('loadUserPermissions');

  it('save força true para Administrador (imutável)', () => {
    assert.ok(saveSrc.includes(`updates.administrador.${KEY} = true;`),
      'handlePermMatrixSave não força a flag do Administrador');
  });

  it('save coleta todos os checkboxes da matriz', () => {
    assert.ok(saveSrc.includes(`#adminPermMatrixBody .perm-matrix-check`));
  });

  it('save persiste em perfis_permissoes (JSONB)', () => {
    assert.ok(saveSrc.includes(`.from('perfis_permissoes')`));
    assert.ok(saveSrc.includes('upsert'));
  });

  it('save propaga para membros_permissoes via PERM_CRUD_KEYS', () => {
    assert.ok(saveSrc.includes('PERM_CRUD_KEYS.forEach(k =>'), 'propagação CRUD ausente');
    assert.ok(saveSrc.includes(`.from('membros_permissoes')`));
    const keys = new Function(`return ${extrairConst('PERM_CRUD_KEYS').replace('const PERM_CRUD_KEYS = ', '')}`)();
    assert.ok(keys.includes(KEY), 'flag deve ser propagada por estar em PERM_CRUD_KEYS');
  });

  it('loadUserPermissions carrega a flag no cache do usuário', () => {
    assert.ok(loadSrc.includes('PERM_CRUD_KEYS.forEach(k =>'), 'cache de permissões não itera PERM_CRUD_KEYS');
    assert.ok(loadSrc.includes('merged.permissions[k] = profilePerms[k] === true;'));
    assert.ok(loadSrc.includes(`.from('perfis_permissoes')`), 'não lê permissões do perfil');
    assert.ok(loadSrc.includes(`.from('membros_permissoes')`), 'não lê overrides individuais');
  });
});
