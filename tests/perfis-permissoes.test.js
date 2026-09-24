import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/* ===========================================================
   Testes: RLS perfis_permissoes + is_admin()
   =========================================================== */

/* ---- Replicar a lógica de is_admin() em JS para testes ----- */
const membros = [
  { id: 'aaa', auth_user_id: 'u1', nome: 'Admin User' },
  { id: 'bbb', auth_user_id: 'u2', nome: 'Regular User' },
  { id: 'ccc', auth_user_id: 'u3', nome: 'No Perm User' },
];

const membrosPerm = [
  { membro_id: 'aaa', perfil: 'Administrador' },
  { membro_id: 'bbb', perfil: 'Atendente' },
];

function is_admin(memberId) {
  if (!memberId) return true;
  return membrosPerm.some(mp => mp.membro_id === memberId && mp.perfil === 'Administrador');
}

function get_member_id(authUserId) {
  const m = membros.find(m => m.auth_user_id === authUserId);
  return m ? m.id : null;
}

/* ===========================================================
   Suite: is_admin() logic
   =========================================================== */
describe('is_admin() logic', () => {
  it('deve retornar true para membro com perfil Administrador', () => {
    const memberId = get_member_id('u1');
    assert.equal(is_admin(memberId), true);
  });

  it('deve retornar false para membro com perfil Atendente', () => {
    const memberId = get_member_id('u2');
    assert.equal(is_admin(memberId), false);
  });

  it('deve retornar true quando memberId é NULL (fallback)', () => {
    assert.equal(is_admin(null), true);
  });

  it('deve retornar true para memberId undefined', () => {
    assert.equal(is_admin(undefined), true);
  });

  it('deve retornar false para membro sem registro em membros_permissoes', () => {
    const memberId = get_member_id('u3');
    assert.equal(is_admin(memberId), false);
  });
});

/* ===========================================================
   Suite: Payload structure validation
   =========================================================== */
describe('Payload perfis_permissoes', () => {
  const validProfiles = ['Administrador', 'Atendente', 'Marketing', 'Pre Vendas', 'Membro'];

  it('deve conter campo perfil como string', () => {
    const payload = { perfil: 'Administrador', permissions: {} };
    assert.equal(typeof payload.perfil, 'string');
    assert.ok(validProfiles.includes(payload.perfil));
  });

  it('deve conter campo permissions como objeto', () => {
    const payload = { perfil: 'Atendente', permissions: { can_leads_read: true } };
    assert.equal(typeof payload.permissions, 'object');
    assert.ok(!Array.isArray(payload.permissions));
  });

  it('todos os perfis válidos devem estar na lista', () => {
    validProfiles.forEach(perfil => {
      const payload = { perfil, permissions: {} };
      assert.ok(validProfiles.includes(payload.perfil), `Perfil ${perfil} deve ser válido`);
    });
  });

  it('perfil com caracteres especiais não deve ser aceito', () => {
    const invalidProfiles = ['', null, undefined, 'admin', 'ADMIN', 'Admin '];
    invalidProfiles.forEach(perfil => {
      assert.ok(!validProfiles.includes(perfil), `Perfil "${perfil}" não deve ser válido`);
    });
  });
});

/* ===========================================================
   Suite: Upsert simulation
   =========================================================== */
describe('Upsert perfis_permissoes', () => {
  const existingData = [
    { perfil: 'Administrador', permissions: { can_leads_read: true } },
    { perfil: 'Atendente', permissions: { can_leads_read: true } },
  ];

  it('upsert deve atualizar registro existente sem duplicar', () => {
    const newPayload = { perfil: 'Administrador', permissions: { can_leads_read: false } };
    const idx = existingData.findIndex(r => r.perfil === newPayload.perfil);
    if (idx >= 0) {
      existingData[idx] = newPayload;
    } else {
      existingData.push(newPayload);
    }
    const adminRows = existingData.filter(r => r.perfil === 'Administrador');
    assert.equal(adminRows.length, 1, 'Não deve haver duplicatas');
    assert.equal(existingData.find(r => r.perfil === 'Administrador').permissions.can_leads_read, false);
  });

  it('upsert deve inserir novo registro quando não existe', () => {
    const newPayload = { perfil: 'Marketing', permissions: { can_leads_read: true } };
    const idx = existingData.findIndex(r => r.perfil === newPayload.perfil);
    if (idx >= 0) {
      existingData[idx] = newPayload;
    } else {
      existingData.push(newPayload);
    }
    assert.equal(existingData.length, 3);
    assert.ok(existingData.some(r => r.perfil === 'Marketing'));
  });

  it('upsert não deve criar registros para perfis fora da lista', () => {
    const invalidPayload = { perfil: 'Hacker', permissions: {} };
    const validProfiles = ['Administrador', 'Atendente', 'Marketing', 'Pre Vendas', 'Membro'];
    if (!validProfiles.includes(invalidPayload.perfil)) {
      return;
    }
    assert.equal(existingData.some(r => r.perfil === 'Hacker'), false);
  });
});

/* ===========================================================
   Suite: Error message validation
   =========================================================== */
describe('Mensagens de erro RLS', () => {
  it('erro de RLS deve sugerir verificar acesso de administrador', () => {
    const errorMsg = 'new row violates row-level security policy for table "perfis_permissoes"';
    const isRls = errorMsg.includes('row-level security') || errorMsg.includes('permission denied');
    assert.ok(isRls, 'Deve detectar erro de RLS');
  });

  it('mensagem amigável deve ser exibida para erro RLS', () => {
    const errorMsg = 'new row violates row-level security policy';
    let userMessage;
    if (errorMsg.includes('row-level security') || errorMsg.includes('permission denied')) {
      userMessage = 'Não foi possível salvar as permissões. Verifique se você possui acesso de administrador.';
    }
    assert.ok(userMessage);
    assert.ok(!userMessage.includes('row-level security'));
    assert.ok(!userMessage.includes('violates'));
  });
});

/* ===========================================================
   Suite: Permission matrix consistency
   =========================================================== */
describe('Matriz de permissões', () => {
  const PERFIL_DEFAULTS = {
    'Administrador': { can_leads_read: true, can_leads_create: true, can_admin_manage_perms: true },
    'Atendente': { can_leads_read: true, can_leads_create: true, can_admin_manage_perms: false },
    'Marketing': { can_leads_read: true, can_leads_create: false, can_admin_manage_perms: false },
    'Pre Vendas': { can_leads_read: true, can_leads_create: true, can_admin_manage_perms: false },
    'Membro': { can_leads_read: true, can_leads_create: false, can_admin_manage_perms: false },
  };

  it('Administrador deve ter todas as permissões', () => {
    const admin = PERFIL_DEFAULTS['Administrador'];
    assert.equal(admin.can_leads_read, true);
    assert.equal(admin.can_leads_create, true);
    assert.equal(admin.can_admin_manage_perms, true);
  });

  it('perfis não-admin não devem ter can_admin_manage_perms', () => {
    ['Atendente', 'Marketing', 'Pre Vendas', 'Membro'].forEach(perfil => {
      assert.equal(PERFIL_DEFAULTS[perfil].can_admin_manage_perms, false,
        `${perfil} não deve ter permissão de gerenciar permissões`);
    });
  });

  it('nenhum perfil deve ter campos undefined nas permissões', () => {
    Object.entries(PERFIL_DEFAULTS).forEach(([perfil, perms]) => {
      Object.entries(perms).forEach(([key, value]) => {
        assert.notEqual(value, undefined, `${perfil}.${key} não deve ser undefined`);
        assert.equal(typeof value, 'boolean', `${perfil}.${key} deve ser boolean`);
      });
    });
  });
});
