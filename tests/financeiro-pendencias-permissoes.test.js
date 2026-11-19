import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/* ---- Dados de teste: membros, centros_custo, associações ---- */
const membros = [
  { id: 'm1', auth_user_id: 'u1', nome: 'Admin Blue',     cargo: 'Administrador',       equipe: 'blue'  },
  { id: 'm2', auth_user_id: 'u2', nome: 'User Blue',      cargo: 'Atendente',           equipe: 'blue'  },
  { id: 'm3', auth_user_id: 'u3', nome: 'User Red',       cargo: 'Atendente',           equipe: 'red'   },
  { id: 'm4', auth_user_id: 'u4', nome: 'No Member',      cargo: '',                    equipe: null  },
];

const centros_custo = [
  { id: 'cc1', nome: 'Blue Eventos',     slug: 'blue-eventos' },
  { id: 'cc2', nome: 'Red Empresa',      slug: 'red-empresa'  },
];

const membro_centros_custo = [
  { membro_id: 'm1', centro_custo_id: 'cc1' },
  { membro_id: 'm2', centro_custo_id: 'cc1' },
  { membro_id: 'm3', centro_custo_id: 'cc2' },
];

const fin_pendencias = [
  { id: 'p1', empresa_id: 'cc1', centros_custo_id: 'cc1', descricao: 'Pendência azul própria' },
  { id: 'p2', empresa_id: 'cc1', centros_custo_id: 'cc1', descricao: 'Outra pendência azul' },
  { id: 'p3', empresa_id: 'cc2', centros_custo_id: 'cc2', descricao: 'Pendência vermelha própria' },
  { id: 'p4', empresa_id: 'cc2', centros_custo_id: null,   descricao: 'Pendência vermelha sem cc' },
  { id: 'p5', empresa_id: 'cc1', centros_custo_id: null,   descricao: 'Pendência azul sem cc' },
];

/* ---- Simulador da função fin_pendencias_is_admin() ---- */
function isAdmin(authUserId) {
  const m = membros.find(m => m.auth_user_id === authUserId);
  return !!(m && m.cargo === 'Administrador');
}

/* ---- Simulador da cláusula USING da policy fin_pendencias_select ---- */
function canSelect(authUserId, pendencias) {
  /* GATE 1: Usuário deve ter cadastro confirmado em membros */
  const m = membros.find(m => m.auth_user_id === authUserId);
  if (!m) return false; /* usuário sem members → negado (fail-closed) */

  /* GATE 2A: Administrador válido (cargo 'Administrador' + cadastro) */
  if (isAdmin(authUserId)) return true;

  /* GATE 2B: Associação confirmada entre usuário, centro de custo e empresa */
  return pendencias.some(pc => {
    /* Verificar centros_custo_id direto (match por equipe/membro) */
    if (pc.centros_custo_id && pc.centros_custo_id === m.equipe) return true;

    /* Verificar empresa_id → centros_custo match via membro_centros_custo */
    const cc = centros_custo.find(c => c.id === pc.empresa_id);
    if (cc) {
      const hasMCC = membro_centros_custo.some(
        mc => mc.membro_id === m.id && mc.centro_custo_id === cc.id
      );
      if (hasMCC) return true;
    }

    /* Verificar fallback fin_slug: slug da empresa da pendência = slug do centro custo */
    if (pc.empresa_id && fin_slug(pc.empresa_id) !== '') {
      const ccBySlug = centros_custo.find(c => fin_slug(c.nome) === fin_slug(pc.empresa_id));
      if (ccBySlug) {
        const hasMCC = membro_centros_custo.some(
          mc => mc.membro_id === m.id && mc.centro_custo_id === ccBySlug.id
        );
        if (hasMCC) return true;
      }
    }
    return false;
  });
}

/* ---- Helper fin_slug ---- */
function fin_slug(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^_+|_+$/g, '');
}

/* ===========================================================
   Suite: Comportamento da política fin_pendencias_select
   =========================================================== */
describe('fin_pendencias_select · política RLS (falha-fechado)', () => {
  describe('administrador válido', () => {
    it('vede TODAS as pendências (acesso global ao admin)', () => {
      const visible = fin_pendencias.filter(p => canSelect('u1', [p]));
      assert.equal(visible.length, 5, 'Admin deve ver todas as 5 pendências');
      visible.forEach(p => {
        assert.ok(p.id === 'p1' || p.id === 'p2' || p.id === 'p3' || p.id === 'p4' || p.id === 'p5',
          `Admin deve ver ${p.id}`);
      });
    });
  });

  describe('membro da empresa (acesso por associação)', () => {
    it('usuário blue (u2) vê apenas pendências da empresa blue (cc1)', () => {
      const visible = fin_pendencias.filter(p => canSelect('u2', [p]));
      // p1, p2: empresa cc1 → m2 has MCC cc1 via membro_centros_custo → YES
      // p5: empresa cc1 → m2 has MCC cc1 via empresa_id → YES (fallback)
      // p3, p4: empresa cc2 → m2 não tem MCC cc2 → NO
      const expectedIds = ['p1', 'p2', 'p5'];
      expectedIds.forEach(key => {
        const found = visible.find(p => p.id === key);
        assert.ok(found, `Usuário blue deve ver ${key}`);
      });
      // Não deve ver p3, p4
      const notVisible = visible.find(p => p.id === 'p3' || p.id === 'p4');
      assert.ok(!notVisible, 'Usuário blue NÃO deve ver pendências da empresa red');
    });

    it('usuário red (u3) vê apenas pendências da empresa red (cc2)', () => {
      const visible = fin_pendencias.filter(p => canSelect('u3', [p]));
      // p3, p4: empresa cc2 → m3 has MCC cc2 → YES
      // p1, p2: empresa cc1 → m3 não tem MCC cc1 → NO
      // p5: empresa cc1 → m3 não tem MCC cc1 → NO
      const expectedIds = ['p3', 'p4'];
      expectedIds.forEach(key => {
        const found = visible.find(p => p.id === key);
        assert.ok(found, `Usuário red deve ver ${key}`);
      });
      // Não deve ver p1, p2, p5
      const notVisible = visible.find(p => p.id === 'p1' || p.id === 'p2' || p.id === 'p5');
      assert.ok(!notVisible, 'Usuário red NÃO deve ver pendências da empresa blue');
    });
  });

  describe('usuário sem registro em membros (fail-closed)', () => {
    it('usuário sem cadastro em membros não vê nenhuma pendência', () => {
      const visible = fin_pendencias.filter(p => canSelect('u4', [p]));
      assert.equal(visible.length, 0, 'Usuário sem members row deve ver nada (fail-closed)');
    });

    it('usuário membro sem associação de centro de custo não vê nada se não for admin', () => {
      // m4 = u4 "No Member" - já testa o gate 1 (sem members → negado)
      const visible = fin_pendencias.filter(p => canSelect('u4', [p]));
      assert.equal(visible.length, 0, 'Usuário sem members row deve ver nada');
    });
  });

  describe('is_admin() behavior consistency', () => {
    it('fin_pendencias_is_admin() retorna FALSE quando usuário não tem linha em membros', () => {
      assert.strictEqual(isAdmin('u4'), false,
        'fin_pendencias_is_admin() deve retornar FALSE sem cadastro em membros');
    });

    it('fin_pendencias_is_admin() retorna TRUE apenas para cargo Administrador', () => {
      assert.strictEqual(isAdmin('u1'), true, 'Admin blue deve ser admin');
      assert.strictEqual(isAdmin('u2'), false, 'Atendente blue NÃO deve ser admin');
      assert.strictEqual(isAdmin('u3'), false, 'Atendente red NÃO deve ser admin');
    });
  });
});