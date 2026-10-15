import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ===========================================================
   Testes: Cliente da Base — seleção e exclusão por permissão
   (can_leads_delete / can_leads_transferir na matriz)
   - helpers canDelete/canTransfer/canSelectLeadsClientes
   - checkbox do card + "Selecionar todos" + barra de massa
   - guards de execução (excluir / transferir)
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSource = readFileSync(join(root, 'app.js'), 'utf8');

const DELETE_KEY = 'can_leads_delete';
const TRANSFER_KEY = 'can_leads_transferir';

function extrairFuncao(nome) {
  const inicio = appSource.indexOf(`function ${nome}(`);
  assert.notEqual(inicio, -1, `função ${nome} não encontrada em app.js`);
  const fim = appSource.indexOf('\n}', inicio);
  assert.ok(fim > inicio, `fim da função ${nome} não encontrado`);
  return appSource.slice(inicio, fim + 2);
}

function extrairFuncaoAsync(nome) {
  const inicio = appSource.indexOf(`async function ${nome}(`);
  assert.notEqual(inicio, -1, `função ${nome} não encontrada em app.js`);
  const fim = appSource.indexOf('\n}', inicio);
  assert.ok(fim > inicio, `fim da função ${nome} não encontrado`);
  return appSource.slice(inicio, fim + 2);
}

function extrairConst(nome) {
  const inicio = appSource.indexOf(`const ${nome} = `);
  assert.notEqual(inicio, -1, `const ${nome} não encontrada em app.js`);
  const fim = appSource.indexOf('\n];', inicio);
  assert.ok(fim > inicio, `fim de ${nome} não encontrado`);
  return appSource.slice(inicio, fim + 3);
}

function matrizRows() {
  return new Function(`return ${extrairConst('PERM_MATRIX_ROWS').replace('const PERM_MATRIX_ROWS = ', '')}`)();
}

/* ===========================================================
   Suite: Definição das permissões na matriz
   =========================================================== */
describe('Permissões de exclusão/transferência · matriz', () => {
  const keys = new Function(`return ${extrairConst('PERM_CRUD_KEYS').replace('const PERM_CRUD_KEYS = ', '')}`)();

  it('can_leads_delete faz parte de PERM_CRUD_KEYS', () => {
    assert.ok(keys.includes(DELETE_KEY));
  });

  it('can_leads_transferir faz parte de PERM_CRUD_KEYS', () => {
    assert.ok(keys.includes(TRANSFER_KEY));
  });

  it('matriz exibe "Apagar Lead" e "Transferir Lead" no grupo Leads / Clientes', () => {
    const grupo = matrizRows().find(g => g.group === 'Leads / Clientes');
    assert.ok(grupo);
    assert.equal(grupo.perms.find(p => p.key === DELETE_KEY)?.label, 'Apagar Lead');
    assert.equal(grupo.perms.find(p => p.key === TRANSFER_KEY)?.label, 'Transferir Lead');
  });
});

/* ===========================================================
   Suite: Helpers (comportamento)
   =========================================================== */
describe('Helpers de seleção/exclusão · comportamento', () => {
  const deleteSrc = extrairFuncao('canDeleteLeadsClientes');
  const transferSrc = extrairFuncao('canTransferLeadsClientes');
  const selectSrc = extrairFuncao('canSelectLeadsClientes');

  const makeDelete = new Function('isCurrentUserAdmin', 'can', `${deleteSrc}; return canDeleteLeadsClientes;`);
  const makeTransfer = new Function('isCurrentUserAdmin', 'can', `${transferSrc}; return canTransferLeadsClientes;`);
  const makeSelect = new Function('canDeleteLeadsClientes', 'canTransferLeadsClientes', `${selectSrc}; return canSelectLeadsClientes;`);

  function selectWith(isAdmin, perms) {
    const del = makeDelete(() => isAdmin, k => perms.includes(k));
    const trf = makeTransfer(() => isAdmin, k => perms.includes(k));
    return makeSelect(del, trf);
  }

  it('admin pode excluir e transferir (bypass)', () => {
    assert.equal(makeDelete(() => true, () => false)(), true);
    assert.equal(makeTransfer(() => true, () => false)(), true);
    assert.equal(selectWith(true, [])(), true);
  });

  it('perfil com "Apagar Lead" pode excluir, mas não transferir', () => {
    const del = makeDelete(() => false, k => k === DELETE_KEY);
    const trf = makeTransfer(() => false, k => k === DELETE_KEY);
    assert.equal(del(), true);
    assert.equal(trf(), false);
  });

  it('perfil com "Transferir Lead" pode transferir, mas não excluir', () => {
    const del = makeDelete(() => false, k => k === TRANSFER_KEY);
    const trf = makeTransfer(() => false, k => k === TRANSFER_KEY);
    assert.equal(del(), false);
    assert.equal(trf(), true);
  });

  it('canSelect = exclusão OU transferência', () => {
    assert.equal(selectWith(false, [DELETE_KEY])(), true, 'só exclusão deve poder selecionar');
    assert.equal(selectWith(false, [TRANSFER_KEY])(), true, 'só transferência deve poder selecionar');
    assert.equal(selectWith(false, [DELETE_KEY, TRANSFER_KEY])(), true);
    assert.equal(selectWith(false, [])(), false, 'sem permissão não pode selecionar');
  });

  it('helpers referenciam as keys corretas da matriz', () => {
    assert.ok(deleteSrc.includes(`can('${DELETE_KEY}')`));
    assert.ok(transferSrc.includes(`can('${TRANSFER_KEY}')`));
  });
});

/* ===========================================================
   Suite: clientCardHTML (checkbox + select de transferência)
   =========================================================== */
describe('clientCardHTML · exibição por permissão', () => {
  const src = extrairFuncao('clientCardHTML');
  const make = new Function(
    'statusMap', 'MAX_SERVICES_CARD', 'selectedClientIds', 'formatEventDate',
    'canSelectLeadsClientes', 'canTransferLeadsClientes',
    `${src}; return clientCardHTML;`
  );

  const cliente = { id: 'c1', status: 'novo', services: ['Totem de Fotos'], eventDate: null, name: 'Cliente X', initials: 'CX', avatar: '', _membroNome: '' };

  function render({ select, transfer, selected = false } = {}) {
    const fn = make({}, 3, new Set(selected ? ['c1'] : []), () => '—', () => select, () => transfer);
    return fn(cliente);
  }

  it('sem permissão: sem checkbox e sem select de transferência', () => {
    const html = render({ select: false, transfer: false });
    assert.ok(!html.includes('client-select-cb'), 'checkbox não deve aparecer sem permissão');
    assert.ok(!html.includes('client-transfer-select'), 'select de transferência não deve aparecer');
    assert.ok(!html.includes('has-admin-actions'), 'classe de layout não deve ser aplicada');
  });

  it('com "Apagar Lead": checkbox aparece (com classe de layout)', () => {
    const html = render({ select: true, transfer: false });
    assert.ok(html.includes('client-select-cb'), 'checkbox deve aparecer com permissão de exclusão');
    assert.ok(html.includes('has-admin-actions'));
    assert.ok(!html.includes('client-transfer-select'), 'transferência continua oculta sem a permissão');
  });

  it('com "Transferir Lead": checkbox e select de transferência aparecem', () => {
    const html = render({ select: true, transfer: true });
    assert.ok(html.includes('client-select-cb'));
    assert.ok(html.includes('client-transfer-select'), 'select de transferência deve respeitar a permissão');
  });

  it('marca o checkbox quando o cliente está selecionado', () => {
    const html = render({ select: true, transfer: false, selected: true });
    assert.ok(html.includes('checked'), 'checkbox deve refletir o estado de seleção');
    assert.ok(html.includes('client-card selected'));
  });
});

/* ===========================================================
   Suite: updateMassBar ("Selecionar todos" + barra de massa)
   =========================================================== */
describe('updateMassBar · gate por permissão', () => {
  const src = extrairFuncao('updateMassBar');

  it('"Selecionar todos" respeita canSelectLeadsClientes', () => {
    assert.ok(src.includes(`selectAllWrap.style.display = canSelect ? '' : 'none'`),
      'selectAllWrap ainda é controlado por isAdmin');
    assert.ok(!src.includes('selectAllWrap.style.display = isAdmin'));
  });

  it('barra de massa só abre com permissão e seleção', () => {
    assert.ok(src.includes('if (!canSelect || selectedClientIds.size === 0)'));
    assert.ok(!src.includes('if (!isAdmin || selectedClientIds.size === 0)'));
  });

  it('campos de transferência + Salvar ficam ocultos sem "Transferir Lead"', () => {
    assert.ok(src.includes(`$$('.mass-bar-field').forEach`), 'campos da barra não são ocultados');
    assert.ok(src.includes(`transferBtn.style.display = canTransfer ? '' : 'none'`), 'botão Salvar não respeita a permissão');
  });

  it('botão Excluir respeita "Apagar Lead"', () => {
    assert.ok(src.includes(`deleteBtnBar.style.display = canDelete ? '' : 'none'`),
      'botão de exclusão não respeita a permissão');
  });
});

/* ===========================================================
   Suite: Guards de execução
   =========================================================== */
describe('Guards de execução · excluir e transferir', () => {
  it('deleteMassLeads verifica canDeleteLeadsClientes antes de agir', () => {
    const src = extrairFuncaoAsync('deleteMassLeads');
    const guardIdx = src.indexOf('canDeleteLeadsClientes()');
    assert.notEqual(guardIdx, -1, 'deleteMassLeads sem guard de permissão');
    assert.ok(guardIdx < src.indexOf('selectedClientIds.size === 0'),
      'guard deve vir antes da lógica de exclusão');
    assert.ok(!src.includes('isCurrentUserAdmin()'), 'guard antigo por admin ainda presente');
  });

  it('saveMassTransfer verifica canTransferLeadsClientes', () => {
    const src = extrairFuncaoAsync('saveMassTransfer');
    assert.ok(src.includes('canTransferLeadsClientes()'), 'saveMassTransfer sem guard de permissão');
    assert.ok(!src.includes('Apenas administradores'), 'mensagem antiga (admin-only) ainda presente');
  });

  it('transferSingleClient verifica canTransferLeadsClientes', () => {
    const src = extrairFuncaoAsync('transferSingleClient');
    assert.ok(src.includes('canTransferLeadsClientes()'), 'transferSingleClient sem guard de permissão');
    assert.ok(!src.includes('Apenas administradores'), 'mensagem antiga (admin-only) ainda presente');
  });
});
