import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ===========================================================
   Testes: Ocultação de cadências no CRM por perfil
   (aba Cadências · Visibilidade por Perfil → cadencia_visibility)
   - perfis suportados (coluna Marketing) + colspans
   - normalização de perfil ('Pré Vendas' x 'Pre Vendas')
   - getVisibleCadences (regra admin/não-admin)
   - totais do Pipeline só com cadências visíveis
   - Resumo/filtros derivam de getVisibleCadences
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSource = readFileSync(join(root, 'app.js'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

function extrairFuncao(nome) {
  const inicio = appSource.indexOf(`function ${nome}(`);
  assert.notEqual(inicio, -1, `função ${nome} não encontrada em app.js`);
  const fim = appSource.indexOf('\n}', inicio);
  assert.ok(fim > inicio, `fim da função ${nome} não encontrado`);
  return appSource.slice(inicio, fim + 2);
}

function extrairRegex(regex, msg) {
  const m = appSource.match(regex);
  assert.ok(m, msg);
  return m[0];
}

function perfisLista() {
  const src = extrairRegex(/const CADENCIA_VIS_PERFIS = \[[^\]]*\];/, 'CADENCIA_VIS_PERFIS não encontrada');
  return new Function(`return ${src.replace('const CADENCIA_VIS_PERFIS = ', '').replace(/;$/, '')}`)();
}

function matrizDeTeste() {
  const norm = new Function(`${extrairFuncao('normPerfilVis')}; return normPerfilVis;`)();
  const cadencias = [
    { id: 'cad-fm', nome: 'Faturamento Mensal', ordem: 1, cor: '#f00' },
    { id: 'cad-nl', nome: 'Novos Leads', ordem: 2, cor: '#0f0' },
    { id: 'cad-ft', nome: 'Faturamento Trimestral', ordem: 3, cor: '#00f' },
  ];
  const make = new Function(
    'getDbCadencias', 'isCurrentUserAdmin', 'currentUser', '_cadenciaVisibilityData',
    'vinculosCadencias', 'dbCadenciaToCrmFormat', 'normPerfilVis',
    `${extrairFuncao('getVisibleCadences')}; return getVisibleCadences;`
  );
  return { norm, cadencias, make };
}

/* ===========================================================
   Suite: Perfis suportados (UI da aba Cadências)
   =========================================================== */
describe('Visibilidade de cadências · perfis suportados', () => {
  const perfis = perfisLista();

  it('CADENCIA_VIS_PERFIS contém os 5 perfis, incluindo Marketing', () => {
    ['Administrador', 'Atendente', 'Marketing', 'Pré Vendas', 'Membro'].forEach(p => {
      assert.ok(perfis.includes(p), `perfil ${p} ausente em CADENCIA_VIS_PERFIS`);
    });
  });

  it('ordem oficial da lista (Administrador → Membro)', () => {
    assert.deepEqual(perfis, ['Administrador', 'Atendente', 'Marketing', 'Pré Vendas', 'Membro']);
  });

  it('fallback do modal de cadência inclui Marketing na ordem oficial', () => {
    assert.ok(appSource.includes(`const perfis = CADENCIA_VIS_PERFIS || ['Administrador', 'Atendente', 'Marketing', 'Pré Vendas', 'Membro']`),
      'fallback de renderCadenciaVisibilityChecks fora da ordem oficial');
  });

  it('thead da tabela de visibilidade no index.html tem coluna Marketing', () => {
    assert.ok(indexHtml.includes('<th style="text-align:center">Marketing</th>'),
      'coluna Marketing ausente no index.html');
  });

  it('colspans das mensagens da tabela foram atualizados para 6', () => {
    assert.ok(appSource.includes(`colspan="6" style="text-align:center;padding:24px;color:var(--muted-text)">Carregando...`),
      'colspan de loading ainda é 5');
    assert.ok(appSource.includes(`colspan="6" style="text-align:center;padding:32px;color:var(--muted-text)">Nenhuma cadência encontrada`),
      'colspan de vazio ainda é 5');
  });
});

/* ===========================================================
   Suite: normPerfilVis (acentos/caixa/espaços)
   =========================================================== */
describe('normPerfilVis · normalização', () => {
  const norm = new Function(`${extrairFuncao('normPerfilVis')}; return normPerfilVis;`)();

  it("'Pré Vendas' e 'Pre Vendas' normalizam para o mesmo valor", () => {
    assert.equal(norm('Pré Vendas'), norm('Pre Vendas'));
    assert.equal(norm('Pré Vendas'), 'pre_vendas');
    assert.equal(norm('Pre Vendas'), 'pre_vendas');
  });

  it('normaliza caixa e espaços', () => {
    assert.equal(norm('Marketing'), 'marketing');
    assert.equal(norm('  Membro '), 'membro');
  });

  it('aceita null/undefined sem lançar', () => {
    assert.equal(norm(null), '');
    assert.equal(norm(undefined), '');
  });
});

/* ===========================================================
   Suite: getVisibleCadences (regra de visibilidade)
   =========================================================== */
describe('getVisibleCadences · regra por perfil', () => {
  const { norm, cadencias, make } = matrizDeTeste();
  const dbFormat = c => ({ id: c.id, label: c.nome, ordem: c.ordem, color: c.cor });

  function visiveis({ admin, perfil, rows, vinculos = [] }) {
    const fn = make(
      () => cadencias,
      () => admin,
      { perfil },
      rows,
      vinculos,
      dbFormat,
      norm
    );
    return fn().map(c => c.id);
  }

  it('Administrador vê todas mesmo com linhas bloqueadas', () => {
    const rows = cadencias.map(c => ({ cadencia_id: c.id, perfil: 'Marketing', visible: false }));
    const ids = visiveis({ admin: true, perfil: 'Marketing', rows });
    assert.deepEqual(ids, ['cad-fm', 'cad-nl', 'cad-ft']);
  });

  it('não-admin com linha visible=false tem a cadência oculta', () => {
    const rows = [{ cadencia_id: 'cad-fm', perfil: 'Atendente', visible: false }];
    const ids = visiveis({ admin: false, perfil: 'Atendente', rows });
    assert.ok(!ids.includes('cad-fm'), 'cadência bloqueada não deve aparecer');
    assert.ok(ids.includes('cad-nl'));
  });

  it('perfil Marketing é bloqueado (coluna nova funciona)', () => {
    const rows = [
      { cadencia_id: 'cad-fm', perfil: 'Marketing', visible: false },
      { cadencia_id: 'cad-ft', perfil: 'Marketing', visible: false },
    ];
    const ids = visiveis({ admin: false, perfil: 'Marketing', rows });
    assert.deepEqual(ids, ['cad-nl'], 'Faturamento Mensal e Trimestral devem estar ocultos p/ Marketing');
  });

  it("dados legados 'Pré Vendas' bloqueiam o perfil canônico 'Pre Vendas'", () => {
    const rows = [{ cadencia_id: 'cad-fm', perfil: 'Pré Vendas', visible: false }];
    const ids = visiveis({ admin: false, perfil: 'Pre Vendas', rows });
    assert.ok(!ids.includes('cad-fm'), 'normalização de acento não aplicada');
  });

  it('linha visible=true mantém a cadência visível', () => {
    const rows = [{ cadencia_id: 'cad-fm', perfil: 'Membro', visible: true }];
    const ids = visiveis({ admin: false, perfil: 'Membro', rows });
    assert.ok(ids.includes('cad-fm'));
  });

  it('sem linhas no banco, default é visível (todas)', () => {
    const ids = visiveis({ admin: false, perfil: 'Marketing', rows: [] });
    assert.deepEqual(ids, ['cad-fm', 'cad-nl', 'cad-ft']);
  });

  it('filtra por centro de custo quando vinculação existe (comportamento preservado)', () => {
    const vinculos = [{ centro_custo_id: 'cc-1', cadencia_id: 'cad-nl' }];
    const fn = make(() => cadencias, () => false, { perfil: 'Marketing' }, [], vinculos, dbFormat, norm);
    const ids = fn('cc-1').map(c => c.id);
    assert.deepEqual(ids, ['cad-nl']);
  });
});

/* ===========================================================
   Suite: Pipeline — totais só com cadências visíveis
   =========================================================== */
describe('Pipeline · totais por cadências visíveis', () => {
  const src = extrairFuncao('renderKanban');

  it('renderKanban monta colunas a partir de visibleCadences', () => {
    assert.ok(src.includes('const visibleCadences = getVisibleCadences(currentCrmEmpresaFilter);'));
    assert.ok(src.includes('board.innerHTML = visibleCadences.map(c => {'));
  });

  it('updateKanbanMeta recebe apenas leads de cadências visíveis', () => {
    assert.ok(src.includes('const visibleCadenceIds = new Set(visibleCadences.map(c => c.id));'),
      'conjunto de ids visíveis ausente');
    assert.ok(src.includes('updateKanbanMeta(allLeads.filter(l => visibleCadenceIds.has(l.status)));'),
      'meta está contando leads de cadências ocultas');
    assert.ok(!src.includes('updateKanbanMeta(allLeads);'), 'meta antiga (todos os leads) ainda presente');
  });
});

/* ===========================================================
   Suite: Resumo e filtros derivam de getVisibleCadences
   =========================================================== */
describe('Resumo e filtros de cadência', () => {
  it('cadencesSummary (Resumo por Cadência) usa getVisibleCadences', () => {
    const src = extrairFuncao('cadencesSummary');
    assert.ok(src.includes('getVisibleCadences(currentCrmEmpresaFilter)'));
  });

  it('populateCadenceFilter (filtro da UI) usa getVisibleCadences', () => {
    const src = extrairFuncao('populateCadenceFilter');
    assert.ok(src.includes('getVisibleCadences().forEach'));
  });

  it('menu "Mover para..." só lista cadências visíveis', () => {
    const src = extrairFuncao('openLeadMoveMenu');
    assert.ok(src.includes('getVisibleCadences(currentCrmEmpresaFilter)'));
  });
});

/* ===========================================================
   Suite: Painel admin + hardening
   =========================================================== */
describe('Painel admin e hardening', () => {
  it('painel admin grava/lê visMap com chave normalizada', () => {
    assert.ok(extrairFuncao('loadCadenciaVisibilityAdmin').includes('cad.visMap[normPerfilVis(v.perfil)] = v.visible'));
    assert.ok(extrairFuncao('renderCadenciaVisibilityTable').includes('cad.visMap[normPerfilVis(perfil)] !== false'));
  });

  it('modal de cadência lê visibilidade com chave normalizada', () => {
    assert.ok(extrairFuncao('renderCadenciaVisibilityChecks').includes('existingVis[normPerfilVis(perfil)]'));
    assert.ok(extrairFuncao('openCadenciaModalForEdit').includes('visMap[normPerfilVis(v.perfil)] = v.visible'));
  });

  it('refreshCadenciasCache limpa filtro ativo que aponte p/ cadência oculta', () => {
    const src = extrairFuncao('refreshCadenciasCache');
    assert.ok(src.includes('_cadenciaVisibilityData = await fetchCadenciaVisibility();'));
    assert.ok(src.includes('activeCadenceFilter = null'), 'reset do filtro ativo ausente');
    assert.ok(src.includes('getVisibleCadences()'));
  });
});
