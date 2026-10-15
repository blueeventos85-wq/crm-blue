import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ===========================================================
   Testes: Padronização global de perfis/cargos/equipes
   - lista oficial única: Administrador, Atendente, Marketing,
     Pré Vendas, Membro (storage 'Pre Vendas', exibição 'Pré Vendas')
   - modal Criar/Editar Membro: selects Cargo e Equipe sem opções legadas
   - canonPerfil: fallback 'Atendimento'→'Atendente', desconhecido→null
   - ordem oficial na aba Cadências (thead + CADENCIA_VIS_PERFIS)
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSource = readFileSync(join(root, 'app.js'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

const ORDEM_EXIBICAO = ['Administrador', 'Atendente', 'Marketing', 'Pré Vendas', 'Membro'];
const VALORES_CANONICOS = ['Administrador', 'Atendente', 'Marketing', 'Pre Vendas', 'Membro'];
const OPCOES_SELECT = ['', ...VALORES_CANONICOS];

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

function valoresSelect(id) {
  const inicio = indexHtml.indexOf(`<select id="${id}">`);
  assert.notEqual(inicio, -1, `select #${id} não encontrado no index.html`);
  const fim = indexHtml.indexOf('</select>', inicio);
  assert.ok(fim > inicio, `fim do select #${id} não encontrado`);
  const bloco = indexHtml.slice(inicio, fim);
  return Array.from(bloco.matchAll(/<option value="([^"]*)"/g)).map(m => m[1]);
}

function thsTabelaCadenciaVis() {
  const tbodyIdx = indexHtml.indexOf('<tbody id="adminCadenciaVisBody">');
  assert.notEqual(tbodyIdx, -1, 'tbody adminCadenciaVisBody não encontrado');
  const antes = indexHtml.slice(0, tbodyIdx);
  const theadIdx = antes.lastIndexOf('<thead>');
  assert.notEqual(theadIdx, -1, 'thead da tabela de visibilidade não encontrado');
  const bloco = indexHtml.slice(theadIdx, tbodyIdx);
  return Array.from(bloco.matchAll(/<th[^>]*>([^<]*)<\/th>/g)).map(m => m[1].trim());
}

function carregarCanon() {
  const constSrc = extrairRegex(/const PERFIS_OFICIAIS = \[[^\]]*\];/, 'PERFIS_OFICIAIS não encontrada');
  return new Function(
    `${constSrc}; ${extrairFuncao('normPerfilVis')}; ${extrairFuncao('canonPerfil')}; ${extrairFuncao('cargoExibicao')}; return { normPerfilVis, canonPerfil, cargoExibicao };`
  )();
}

/* ===========================================================
   Suite: modal de membro (Cargo e Equipe)
   =========================================================== */
describe('Modal de membro · selects Cargo e Equipe', () => {
  it('#adminMemberRole tem exatamente as 5 opções oficiais (com Selecione…)', () => {
    assert.deepEqual(valoresSelect('adminMemberRole'), OPCOES_SELECT);
  });

  it('#adminMemberTeam tem exatamente as mesmas 5 opções oficiais', () => {
    assert.deepEqual(valoresSelect('adminMemberTeam'), OPCOES_SELECT);
  });

  it("exibe 'Pré Vendas' com o value canônico 'Pre Vendas'", () => {
    assert.ok(indexHtml.includes('<option value="Pre Vendas">Pré Vendas</option>'),
      'option Pré Vendas ausente/errada');
  });

  it('sem opções legadas (Atendimento, Contador, Auxiliar, Comercial, Operações, Administrativo, TI)', () => {
    ['value="Atendimento"', 'value="Contador"', 'value="Auxiliar"',
      'value="Comercial"', 'value="Operações"', 'value="Administrativo"', 'value="TI"']
      .forEach(v => {
        assert.ok(!indexHtml.includes(v), `opção legada ainda presente: ${v}`);
      });
  });
});

/* ===========================================================
   Suite: fonte única + ordem oficial
   =========================================================== */
describe('Perfis oficiais · fonte única e ordem', () => {
  it('PERFIS_OFICIAIS = lista canônica (storage sem acento em Pre Vendas)', () => {
    const src = extrairRegex(/const PERFIS_OFICIAIS = \[[^\]]*\];/, 'PERFIS_OFICIAIS não encontrada');
    const lista = new Function(`return ${src.replace('const PERFIS_OFICIAIS = ', '').replace(/;$/, '')}`)();
    assert.deepEqual(lista, VALORES_CANONICOS);
  });

  it('CADENCIA_VIS_PERFIS segue a ordem oficial de exibição', () => {
    const src = extrairRegex(/const CADENCIA_VIS_PERFIS = \[[^\]]*\];/, 'CADENCIA_VIS_PERFIS não encontrada');
    const lista = new Function(`return ${src.replace('const CADENCIA_VIS_PERFIS = ', '').replace(/;$/, '')}`)();
    assert.deepEqual(lista, ORDEM_EXIBICAO);
  });

  it('thead da tabela de visibilidade de cadências segue a ordem oficial', () => {
    assert.deepEqual(thsTabelaCadenciaVis(), ['Cadência', ...ORDEM_EXIBICAO]);
  });
});

/* ===========================================================
   Suite: canonPerfil / cargoExibicao (cargos legados)
   =========================================================== */
describe('canonPerfil · normalização de cargos legados', () => {
  const { normPerfilVis, canonPerfil, cargoExibicao } = carregarCanon();

  it("'Atendimento' (e variantes de caixa/espaço) → 'Atendente'", () => {
    assert.equal(canonPerfil('Atendimento'), 'Atendente');
    assert.equal(canonPerfil('atendimento'), 'Atendente');
    assert.equal(canonPerfil('  Atendimento '), 'Atendente');
  });

  it("'Pré Vendas' → 'Pre Vendas' (storage canônico)", () => {
    assert.equal(canonPerfil('Pré Vendas'), 'Pre Vendas');
    assert.equal(canonPerfil('Pre Vendas'), 'Pre Vendas');
  });

  it('as 5 oficiais retornam a si mesmas', () => {
    VALORES_CANONICOS.forEach(p => assert.equal(canonPerfil(p), p));
  });

  it('desconhecidos/vazios retornam null (callers aplicam fallback)', () => {
    assert.equal(canonPerfil('Contador'), null);
    assert.equal(canonPerfil('Auxiliar'), null);
    assert.equal(canonPerfil(''), null);
    assert.equal(canonPerfil(null), null);
    assert.equal(canonPerfil(undefined), null);
  });

  it("normPerfilVis('Atendimento') normaliza para 'atendente'", () => {
    assert.equal(normPerfilVis('Atendimento'), 'atendente');
    assert.equal(normPerfilVis('Atendente'), 'atendente');
  });

  it('cargoExibicao canoniza legados e mantém desconhecidos', () => {
    assert.equal(cargoExibicao('Atendimento'), 'Atendente');
    assert.equal(cargoExibicao('Contador'), 'Contador');
    assert.equal(cargoExibicao(''), null);
  });
});

/* ===========================================================
   Suite: integração (pontos de uso)
   =========================================================== */
describe('Padronização · pontos de uso no app.js', () => {
  it('loadUserPermissions valida o perfil via canonPerfil (fallback Membro)', () => {
    const src = extrairFuncao('loadUserPermissions');
    assert.ok(src.includes('canonPerfil(currentUser.perfil)'),
      'loadUserPermissions sem canonPerfil');
    assert.ok(!src.includes('validProfiles'),
      'validProfiles legado ainda presente em loadUserPermissions');
  });

  it('handlePermMatrixSave propaga permissões via canonPerfil(member.cargo)', () => {
    const src = extrairFuncao('handlePermMatrixSave');
    assert.ok(src.includes('const perfilName = canonPerfil(member.cargo);'),
      'propagação para membros_sem canonPerfil');
    assert.ok(!src.includes('perfilMap[perfilNorm]'),
      'perfilMap[perfilNorm] ainda presente na propagação');
  });

  it('fillMemberForm migra cargo legado e guarda a equipe original', () => {
    const src = extrairFuncao('fillMemberForm');
    assert.ok(src.includes("canonPerfil(member.cargo) || 'Membro'"),
      'fillMemberForm sem migração de cargo legado');
    assert.ok(src.includes('_adminEditingEquipe = member.equipe'),
      'fillMemberForm não grava _adminEditingEquipe');
  });

  it('handleMemberSave preserva equipe legada quando não alterada', () => {
    const src = extrairFuncao('handleMemberSave');
    assert.ok(src.includes('equipe: team || _adminEditingEquipe'),
      'handleMemberSave sem preservação de equipe');
  });

  it('resetMemberForm e closeMemberModal limpam _adminEditingEquipe', () => {
    assert.ok(extrairFuncao('resetMemberForm').includes("_adminEditingEquipe = ''"));
    assert.ok(extrairFuncao('closeMemberModal').includes("_adminEditingEquipe = ''"));
  });

  it('exibição de cargo usa cargoExibicao (tabela admin, lista Equipe, calibragem)', () => {
    assert.ok(extrairFuncao('renderMemberRow').includes('cargoExibicao(m.cargo)'),
      'renderMemberRow sem cargoExibicao');
    assert.ok(extrairFuncao('loadTeamMembers').includes('cargoExibicao(m.cargo)'),
      'loadTeamMembers sem cargoExibicao');
    assert.ok(appSource.includes('cargoExibicao(_calibSelectedMember.cargo)'),
      'calibragem sem cargoExibicao');
  });
});
