/* ============================================
   BLUE CONTABILIDADE · CRM
   Interatividade
   ============================================ */

const $  = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => Array.from(ctx.querySelectorAll(s));

/* ============================================
   AUTH STATE · Controle de permissão
   ============================================
   Perfis de acesso:
   - Administrador: visão global, vê todos os dados de todos os membros
   - Atendente: visão individual, vê apenas seus próprios dados (criou/atribuído)
   - Marketing: visão individual, vê apenas seus próprios dados (criou/atribuído)
   ============================================ */
let currentUser = {
  id: null,
  authUserId: null,
  nome: 'Usuário',
  perfil: 'Atendente',
  centro_custo_id: null,
  centro_custo_ids: [],
  foto_url: null
};

/* ============================================
   AUTH · Supabase Authentication
   ============================================ */
let _authUser = null;

function showAuthOverlay() {
  const overlay = document.getElementById('authOverlay');
  if (overlay) overlay.classList.remove('hidden');
}

function hideAuthOverlay() {
  const overlay = document.getElementById('authOverlay');
  if (overlay) overlay.classList.add('hidden');
}

function setAuthLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.dataset.originalHtml = btn.innerHTML;
    btn.innerHTML = '<span class="auth-spinner"></span>';
  } else {
    btn.disabled = false;
    if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
  }
}

function showAuthError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.hidden = false; }
}
function hideAuthError(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
}
function showAuthSuccess(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.hidden = false; }
}

function resetAuthState() {
  _authUser = null;
  _userPermCache = null;
  _adminMembersCache = [];
  _adminPermCache = [];
  currentUser.id = null;
  currentUser.authUserId = null;
  currentUser.nome = 'Usuário';
  currentUser.centro_custo_id = null;
  currentUser.centro_custo_ids = [];
  currentUser.foto_url = null;
  currentUser.role = 'admin';
  activePage = 'home';

  // Reconstruir sidebar com todos os itens
  _userPermCache = null;
  renderSidebar();

  // Limpar cache do admin
  const permTbody = document.getElementById('adminPermBody');
  if (permTbody) permTbody.innerHTML = '';
  const usersTbody = document.getElementById('adminUsersBody');
  if (usersTbody) usersTbody.innerHTML = '';
}

async function loadMemberFromAuth(authUserId, authEmail) {
  if (!_supabase || !authUserId) return null;
  try {
    // Primary: lookup by auth_user_id
    const { data, error } = await _supabase.from('membros')
      .select('id, nome, email, cargo, foto_url, centro_custo_id, auth_user_id').eq('auth_user_id', authUserId).maybeSingle();
    if (data) {
      // Load multiple centros de custo from pivot table
      const { data: ccData } = await _supabase.from('membro_centros_custo')
        .select('centro_custo_id').eq('membro_id', data.id);
      data._centro_custo_ids = (ccData || []).map(r => r.centro_custo_id);
      return data;
    }
    if (error) console.warn('[Auth] loadMemberFromAuth lookup by auth_user_id failed:', error.message);

    // Fallback: lookup by email (in case auth_user_id was never linked)
    if (authEmail) {
      const { data: byEmail, error: emailErr } = await _supabase.from('membros')
        .select('id, nome, email, cargo, foto_url, centro_custo_id, auth_user_id').eq('email', authEmail).maybeSingle();
      if (byEmail) {
        console.warn('[Auth] Member found by email fallback, linking auth_user_id...');
        await _supabase.from('membros').update({ auth_user_id: authUserId }).eq('id', byEmail.id);
        // Load multiple centros de custo from pivot table
        const { data: ccData } = await _supabase.from('membro_centros_custo')
          .select('centro_custo_id').eq('membro_id', byEmail.id);
        byEmail._centro_custo_ids = (ccData || []).map(r => r.centro_custo_id);
        return byEmail;
      }
      if (emailErr) console.warn('[Auth] Email fallback also failed:', emailErr.message);
    }

    console.warn('[Auth] No member found for authUserId:', authUserId, 'email:', authEmail);
    return null;
  } catch (err) {
    console.error('[Auth] loadMemberFromAuth exception:', err);
    return null;
  }
}

async function initAuth() {
  if (!_supabase) { showAuthOverlay(); return; }

  const { data: { session } } = await _supabase.auth.getSession();
  if (session && session.user) {
    _authUser = session.user;
    currentUser.authUserId = session.user.id;

    const member = await loadMemberFromAuth(session.user.id, session.user.email);
    if (member) {
      currentUser.id = member.id;
      currentUser.nome = member.nome || session.user.email?.split('@')[0] || 'Usuário';
      currentUser.centro_custo_id = member.centro_custo_id || null;
      currentUser.centro_custo_ids = member._centro_custo_ids || [];
      currentUser.foto_url = member.foto_url || null;
    } else {
      // Don't overwrite currentUser.id if already set — loadUserPermissions will resolve it
      if (!currentUser.id) {
        currentUser.nome = session.user.user_metadata?.nome || session.user.email?.split('@')[0] || 'Usuário';
      }
      console.warn('[Auth] loadMemberFromAuth failed in initAuth, loadUserPermissions will attempt resolution');
    }

    hideAuthOverlay();
    await onAuthReady();
  } else {
    showAuthOverlay();
  }

  _supabase.auth.onAuthStateChange(async (event, session) => {
    console.log('[Auth] onAuthStateChange:', event, 'userId:', session?.user?.id);

    if (event === 'SIGNED_OUT' || !session || !session.user) {
      resetAuthState();
      showAuthOverlay();
      return;
    }

    // For SIGNED_IN or INITIAL_SESSION: only re-initialize if user actually changed
    const newAuthUserId = session.user.id;
    if (currentUser.authUserId === newAuthUserId && currentUser.id && _userPermCache) {
      console.log('[Auth] Same user, permissions already loaded, skipping re-init');
      return;
    }

    _authUser = session.user;
    currentUser.authUserId = newAuthUserId;

    const member = await loadMemberFromAuth(session.user.id, session.user.email);
    if (member) {
      currentUser.id = member.id;
      currentUser.nome = member.nome || session.user.email?.split('@')[0] || 'Usuário';
      currentUser.centro_custo_id = member.centro_custo_id || null;
      currentUser.centro_custo_ids = member._centro_custo_ids || [];
      currentUser.foto_url = member.foto_url || null;
    } else if (!currentUser.id) {
      // Only set nome if we can't resolve — loadUserPermissions will try to find member
      currentUser.nome = session.user.user_metadata?.nome || session.user.email?.split('@')[0] || 'Usuário';
      console.warn('[Auth] loadMemberFromAuth failed in onAuthStateChange, loadUserPermissions will attempt resolution');
    }

    _userPermCache = null;
    hideAuthOverlay();
    await onAuthReady();
  });
}

function bindAuthForms() {
  const loginForm = document.getElementById('loginForm');
  const forgotForm = document.getElementById('forgotForm');
  const backLink = document.getElementById('authBackToLogin');
  const forgotLink = document.getElementById('authForgotLink');
  const forgotFooter = document.getElementById('forgotFooter');
  const tagline = document.getElementById('authTagline');

  // Forgot password
  if (forgotLink) {
    forgotLink.addEventListener('click', (e) => {
      e.preventDefault();
      loginForm.style.display = 'none';
      forgotForm.style.display = '';
      if (forgotFooter) forgotFooter.style.display = '';
      tagline.textContent = 'Informe seu e-mail para recuperar a senha.';
    });
  }
  if (backLink) {
    backLink.addEventListener('click', (e) => {
      e.preventDefault();
      forgotForm.style.display = 'none';
      if (forgotFooter) forgotFooter.style.display = 'none';
      loginForm.style.display = '';
      tagline.textContent = 'Acesse sua conta para gerenciar o CRM.';
      hideAuthError('forgotError');
      document.getElementById('forgotSuccess').hidden = true;
    });
  }

  // Password visibility toggles
  document.querySelectorAll('.auth-pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      const icon = btn.querySelector('i');
      if (icon) icon.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye');
      initIcons();
    });
  });

  // Login submit
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAuthError('loginError');
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      const btn = document.getElementById('loginSubmitBtn');

      if (!email || !password) { showAuthError('loginError', 'Preencha todos os campos.'); return; }

      setAuthLoading(btn, true);
      try {
        const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Session will be handled by onAuthStateChange
      } catch (err) {
        showAuthError('loginError', err.message || 'Erro ao fazer login. Verifique suas credenciais.');
      } finally {
        setAuthLoading(btn, false);
      }
    });
  }

  // Forgot password submit
  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAuthError('forgotError');
      document.getElementById('forgotSuccess').hidden = true;
      const email = document.getElementById('forgotEmail').value.trim();
      if (!email) { showAuthError('forgotError', 'Informe seu e-mail.'); return; }

      try {
        const { error } = await _supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin
        });
        if (error) throw error;
        showAuthSuccess('forgotSuccess', 'Link de recuperação enviado! Verifique sua caixa de entrada.');
        forgotForm.reset();
      } catch (err) {
        showAuthError('forgotError', err.message || 'Erro ao enviar link de recuperação.');
      }
    });
  }
}

async function onAuthReady() {
  _settingsBound = false;

  const userNameEl = document.getElementById('sidebarUserName');
  const userAvatarEl = document.getElementById('sidebarUserAvatar');
  const pageSubtitle = document.getElementById('pageSubtitle');

  if (userNameEl) userNameEl.textContent = currentUser.nome || 'Usuário';
  if (userAvatarEl) {
    const initials = (currentUser.nome || 'Usuário').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    userAvatarEl.textContent = initials;
    userAvatarEl.style.background = '';
    if (currentUser.foto_url) {
      userAvatarEl.innerHTML = `<img src="${currentUser.foto_url}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover" />`;
      userAvatarEl.style.background = 'none';
    }
  }
  if (pageSubtitle) pageSubtitle.textContent = `Bem-vindo de volta, ${(currentUser.nome || 'Usuário').split(' ')[0]} ✨`;

  // Logout button
  const logoutBtn = document.getElementById('sidebarLogoutBtn');
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      resetAuthState();
      if (_supabase) await _supabase.auth.signOut();
    };
  }

  initIcons();

  // Load permissions BEFORE rendering sidebar and home
  await loadUserPermissions();
  console.log('[Auth] onAuthReady: permissions loaded, _userPermCache =', _userPermCache ? 'YES' : 'NULL');
  console.log('[Auth] onAuthReady: currentUser.id =', currentUser.id);

  renderSidebar();
  renderHomeModules();
}

/* ============================================
   ADMIN · CRUD completo de membros
   ============================================ */
let _adminEditingId = null;
let _adminDeleteId = null;
let _adminMembersCache = [];
let _adminPermCache = [];
let _adminBound = false;

/* ── Estado da aba Empresas ── */
let _empresaEditingId = null;
let _empresaDeleteId = null;
let _empresaOriginalServicoIds = [];
let _empresaOriginalMembroIds = [];
let _empresaOriginalCadenciaIds = [];


function initAdminView() {
  console.log('[Admin] initAdminView called, bound=', _adminBound);
  if (centrosCustoData.length === 0) {
    loadCentrosCustoFromSupabase();
  }
  populateDashCcFilter();

  // ── Tabs: bind direto em todas as abas (sempre executado, evita duplicatas por flag no elemento) ──
  document.querySelectorAll('.admin-tab').forEach(tab => {
    if (tab._adminTabBound) return;
    tab._adminTabBound = true;
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.adminTab;
      const content = document.getElementById('adminTab' + target.charAt(0).toUpperCase() + target.slice(1));
      if (content) content.classList.add('active');
      if (target === 'permissoes') loadPermissionsFromSupabase();
      if (target === 'empresas') loadEmpresasAdmin();
      if (target === 'servicos') loadServicosAdmin();
      if (target === 'cadencias') loadCadenciaVisibilityAdmin();
      initIcons();
    });
  });

  if (!_adminBound) {
    _adminBound = true;

    const addBtn = document.getElementById('adminNewMemberBtn');
    const overlay = document.getElementById('adminMemberOverlay');
    const closeBtns = document.querySelectorAll('[data-action="close-admin-member"]');
    const saveBtn = document.getElementById('adminMemberSaveBtn');
    const searchInput = document.getElementById('adminSearchInput');
    const pwToggle = document.getElementById('adminMemberPwToggle');
    const delOverlay = document.getElementById('adminDeleteOverlay');
    const delCloseBtns = document.querySelectorAll('[data-action="close-admin-delete"]');
    const delConfirmBtn = document.getElementById('adminDeleteConfirmBtn');

    // ── Abrir modal: Criar novo ──
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        _adminEditingId = null;
        resetMemberForm();
        setMemberFormMode('create');
        openMemberModal();
      });
    }

    // ── Fechar modal membro ──
    closeBtns.forEach(btn => btn.addEventListener('click', closeMemberModal));
    if (overlay) overlay.addEventListener('click', closeMemberModal);

    // ── Toggle senha ──
    if (pwToggle) {
      pwToggle.addEventListener('click', () => {
        const input = pwToggle.parentElement.querySelector('input');
        if (!input) return;
        const isPw = input.type === 'password';
        input.type = isPw ? 'text' : 'password';
        const icon = pwToggle.querySelector('i');
        if (icon) icon.setAttribute('data-lucide', isPw ? 'eye-off' : 'eye');
        initIcons();
      });
    }

    // ── Máscaras ──
    applyMask('adminMemberCPF', maskCPF);
    applyMask('adminMemberPhone', maskPhone);

    // ── Salvar membro ──
    if (saveBtn) saveBtn.addEventListener('click', handleMemberSave);

    // ── Busca membros ──
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        document.querySelectorAll('#adminUsersBody tr').forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });
    }

    // ── Modal de exclusão ──
    delCloseBtns.forEach(btn => btn.addEventListener('click', closeDeleteModal));
    if (delOverlay) delOverlay.addEventListener('click', closeDeleteModal);
    if (delConfirmBtn) delConfirmBtn.addEventListener('click', handleMemberDelete);

    // ── Modal de permissões ──
    const permOverlay = document.getElementById('adminPermOverlay');
    const permCloseBtns = document.querySelectorAll('[data-action="close-admin-perm"]');
    const permSaveBtn = document.getElementById('adminPermSaveBtn');
    permCloseBtns.forEach(btn => btn.addEventListener('click', closePermModal));
    if (permOverlay) permOverlay.addEventListener('click', closePermModal);
    if (permSaveBtn) permSaveBtn.addEventListener('click', handlePermSave);

    // ── Busca permissões ──
    const permSearch = document.getElementById('adminPermSearchInput');
    if (permSearch) {
      permSearch.addEventListener('input', () => {
        const q = permSearch.value.toLowerCase().trim();
        document.querySelectorAll('#adminPermBody tr').forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });
    }

    // ── Auto-fill perfil checkboxes ──
    const perfilSel = document.getElementById('adminPermPerfil');
    if (perfilSel) {
      perfilSel.addEventListener('change', () => applyPerfilDefaults(perfilSel.value));
    }
  }

  loadMembersFromSupabase();
}

/* ── Modal helpers ── */
function openMemberModal() {
  const overlay = document.getElementById('adminMemberOverlay');
  const modal = document.getElementById('adminMemberModal');
  if (overlay) overlay.classList.add('open');
  if (modal) { modal.classList.add('open'); modal.scrollTop = 0; }
  populateDashCcFilter();
  initIcons();
}

function closeMemberModal() {
  const overlay = document.getElementById('adminMemberOverlay');
  const modal = document.getElementById('adminMemberModal');
  if (overlay) overlay.classList.remove('open');
  if (modal) modal.classList.remove('open');
  _adminEditingId = null;
}

function openDeleteModal() {
  const overlay = document.getElementById('adminDeleteOverlay');
  const modal = document.getElementById('adminDeleteModal');
  if (overlay) overlay.classList.add('open');
  if (modal) modal.classList.add('open');
  initIcons();
}

function closeDeleteModal() {
  const overlay = document.getElementById('adminDeleteOverlay');
  const modal = document.getElementById('adminDeleteModal');
  if (overlay) overlay.classList.remove('open');
  if (modal) modal.classList.remove('open');
  _adminDeleteId = null;
}

/* ── Form helpers ── */
function resetMemberForm() {
  const ids = ['adminMemberId','adminMemberName','adminMemberEmail','adminMemberPassword','adminMemberCPF','adminMemberBirth','adminMemberPhone'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const selects = ['adminMemberRole','adminMemberTeam'];
  selects.forEach(id => { const el = document.getElementById(id); if (el) el.selectedIndex = 0; });
  document.getElementById('adminMemberPessoa').value = 'Pessoa Física';
  ['adminMemberNotifEmail','adminMemberNotifWhats','adminMemberNotifSound'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = 'Sim';
  });
  // Reset CC checkboxes
  const ccSection = document.getElementById('adminMemberCcSection');
  if (ccSection) ccSection.style.display = 'none';
  const container = document.getElementById('adminMemberCcChecks');
  if (container) container.innerHTML = '';
}

function setMemberFormMode(mode) {
  const title = document.getElementById('adminMemberTitle');
  const subtitle = document.getElementById('adminMemberSubtitle');
  const saveText = document.getElementById('adminSaveBtnText');
  const pwReq = document.getElementById('adminPwReq');
  const pwHint = document.getElementById('adminPwHint');
  const pwInput = document.getElementById('adminMemberPassword');
  const footNote = document.getElementById('adminFootNote');

  if (mode === 'edit') {
    if (title) title.textContent = 'Editar Membro';
    if (subtitle) subtitle.textContent = 'Altere os dados do funcionário';
    if (saveText) saveText.textContent = 'Salvar Alterações';
    if (pwReq) pwReq.style.display = 'none';
    if (pwHint) pwHint.textContent = 'Deixe em branco para manter a senha atual';
    if (pwInput) { pwInput.required = false; pwInput.placeholder = 'Nova senha (opcional)'; }
    if (footNote) footNote.textContent = 'Os dados serão atualizados no sistema.';
  } else {
    if (title) title.textContent = 'Criar Novo Membro';
    if (subtitle) subtitle.textContent = 'Adicione um novo funcionário ao sistema';
    if (saveText) saveText.textContent = 'Salvar Membro';
    if (pwReq) pwReq.style.display = '';
    if (pwHint) pwHint.textContent = '';
    if (pwInput) { pwInput.required = true; pwInput.placeholder = 'Min. 6 caracteres'; }
    if (footNote) footNote.textContent = 'O membro será criado com status aprovado. Sem necessidade de convite por e-mail.';
  }
}

function fillMemberForm(member) {
  document.getElementById('adminMemberId').value = member.id || '';
  document.getElementById('adminMemberName').value = member.nome || '';
  document.getElementById('adminMemberEmail').value = member.email || '';
  document.getElementById('adminMemberPassword').value = '';
  setSelectValue('adminMemberRole', member.cargo);
  setSelectValue('adminMemberTeam', member.equipe);
  document.getElementById('adminMemberPessoa').value = member.pessoa || 'Pessoa Física';
  document.getElementById('adminMemberCPF').value = member.cpf || '';
  // Converter dd/mm/aaaa para YYYY-MM-DD se necessário (dados antigos)
  let birthVal = member.data_aniversario || '';
  if (birthVal && /^\d{2}\/\d{2}\/\d{4}$/.test(birthVal)) {
    const [d, m, y] = birthVal.split('/');
    birthVal = `${y}-${m}-${d}`;
  }
  document.getElementById('adminMemberBirth').value = birthVal;
  document.getElementById('adminMemberPhone').value = member.telefone || '';
  setSelectValue('adminMemberNotifEmail', member.notificacao_email !== false ? 'Sim' : 'Não');
  setSelectValue('adminMemberNotifWhats', member.notificacao_whatsapp !== false ? 'Sim' : 'Não');
  setSelectValue('adminMemberNotifSound', member.notificacao_som !== false ? 'Sim' : 'Não');
  // Preencher checkboxes de centros de custo (pivot)
  const ccSection = document.getElementById('adminMemberCcSection');
  const container = document.getElementById('adminMemberCcChecks');
  if (ccSection && container) {
    const memberCcIds = member._centro_custo_ids || [];
    container.innerHTML = centrosCustoData.map(cc => {
      const checked = memberCcIds.includes(cc.id);
      return `<label class="perm-check"><input type="checkbox" class="member-cc-cb" value="${cc.id}" ${checked ? 'checked' : ''} /> ${escapeHtml(cc.nome)}</label>`;
    }).join('');
    ccSection.style.display = '';
  }
}

function setSelectValue(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  for (let i = 0; i < el.options.length; i++) {
    if (el.options[i].value === val) { el.selectedIndex = i; return; }
  }
  el.selectedIndex = 0;
}

/* ── Save handler (criar ou editar) ── */
async function handleMemberSave() {
  console.log('[Admin] handleMemberSave called, editingId=', _adminEditingId);

  const name = document.getElementById('adminMemberName')?.value?.trim();
  const email = document.getElementById('adminMemberEmail')?.value?.trim();
  const password = document.getElementById('adminMemberPassword')?.value;
  const role = document.getElementById('adminMemberRole')?.value;
  const team = document.getElementById('adminMemberTeam')?.value;
  const pessoa = document.getElementById('adminMemberPessoa')?.value;
  const cpf = document.getElementById('adminMemberCPF')?.value?.trim();
  const birthRaw = document.getElementById('adminMemberBirth')?.value?.trim();
  const birth = birthRaw || null;
  const phone = document.getElementById('adminMemberPhone')?.value?.trim();
  const notifEmail = document.getElementById('adminMemberNotifEmail')?.value;
  const notifWhats = document.getElementById('adminMemberNotifWhats')?.value;
  const notifSound = document.getElementById('adminMemberNotifSound')?.value;

  console.log('[Admin] Dados do form:', { name, email, role, team });

  // Validação
  if (!name || !email) { toast('Preencha nome e e-mail', 'error'); return; }
  if (!_adminEditingId && !password) { toast('Preencha a senha', 'error'); return; }
  if (password && password.length < 6) { toast('A senha deve ter pelo menos 6 caracteres', 'error'); return; }

  const saveBtn = document.getElementById('adminMemberSaveBtn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="auth-spinner"></span>';

  try {
    if (_adminEditingId) {
      // ═══ EDITAR ═══
      console.log('[Admin] Editando membro:', _adminEditingId);
      const payload = {
        nome: name, email, cargo: role || '', equipe: team || '',
        pessoa: pessoa || 'Pessoa Física', cpf: cpf || '',
        data_aniversario: birth, telefone: phone || '',
        notificacao_email: notifEmail === 'Sim',
        notificacao_whatsapp: notifWhats === 'Sim',
        notificacao_som: notifSound === 'Sim'
      };

      const { data, error } = await _supabase.from('membros').update(payload).eq('id', _adminEditingId).select();
      if (error) {
        console.error('[Admin] Erro ao atualizar:', error.message, error.code, error.details, error.hint);
        throw error;
      }

      // Atualizar vínculos de centros de custo (pivot)
      const selectedCcIds = Array.from(document.querySelectorAll('.member-cc-cb:checked')).map(cb => cb.value);
      // Buscar vínculos atuais
      const { data: currentVinculos } = await _supabase.from('membro_centros_custo')
        .select('centro_custo_id').eq('membro_id', _adminEditingId);
      const currentCcIds = (currentVinculos || []).map(r => r.centro_custo_id);

      // Remover desmarcados
      const toRemove = currentCcIds.filter(id => !selectedCcIds.includes(id));
      if (toRemove.length > 0) {
        await _supabase.from('membro_centros_custo').delete()
          .eq('membro_id', _adminEditingId)
          .in('centro_custo_id', toRemove);
      }

      // Adicionar novos
      const toAdd = selectedCcIds.filter(id => !currentCcIds.includes(id));
      for (const ccId of toAdd) {
        await _supabase.from('membro_centros_custo').insert([{ membro_id: _adminEditingId, centro_custo_id: ccId }]);
      }

      console.log('[Admin] Membro atualizado:', data);
      toast('Membro atualizado com sucesso!');
      if (typeof registrarAuditoria === 'function') registrarAuditoria({ acao: 'Atualizações', caminho_url: '/administrador', modulo: 'Administrador' });

    } else {
      // ═══ CRIAR ═══
      console.log('[Admin] Criando novo membro via Edge Function...');

      const payload = {
        name, email, password, role, team, pessoa, cpf, birth, phone,
        notifEmail, notifWhats, notifSound
      };

      const { data, error } = await _supabase.functions.invoke('create-member', {
        body: payload
      });

      if (error) {
        console.error('[Admin] Edge Function error:', error.message, error.context);
        throw new Error(error.message || 'Erro ao criar membro');
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Erro ao criar membro');
      }

      console.log('[Admin] Membro criado:', data.member);
      toast('Membro criado com sucesso!');
      if (typeof registrarAuditoria === 'function') registrarAuditoria({ acao: 'Inclusões', caminho_url: '/administrador', modulo: 'Administrador' });
    }

    closeMemberModal();
    await loadMembersFromSupabase();

  } catch (err) {
    console.error('[Admin] Erro ao salvar membro:', err);
    const msg = err.message || 'Erro ao salvar membro';
    const hint = err.hint ? ` — ${err.hint}` : '';
    toast(msg + hint, 'error');
  } finally {
    saveBtn.disabled = false;
    const txt = _adminEditingId ? 'Salvar Alterações' : 'Salvar Membro';
    saveBtn.innerHTML = `<i data-lucide="save"></i> <span id="adminSaveBtnText">${txt}</span>`;
    initIcons();
  }
}

/* ── Delete handler ── */
async function handleMemberDelete() {
  if (!_adminDeleteId) return;
  console.log('[Admin] Excluindo membro:', _adminDeleteId);

  const delBtn = document.getElementById('adminDeleteConfirmBtn');
  delBtn.disabled = true;
  delBtn.innerHTML = '<span class="auth-spinner"></span>';

  try {
    const { error } = await _supabase.from('membros').delete().eq('id', _adminDeleteId);
    if (error) {
      console.error('[Admin] Erro ao excluir:', error.message, error.code, error.details, error.hint);
      throw error;
    }

    toast('Membro removido com sucesso!');
    if (typeof registrarAuditoria === 'function') registrarAuditoria({ acao: 'Exclusões', caminho_url: '/administrador', modulo: 'Administrador' });
    closeDeleteModal();
    await loadMembersFromSupabase();

  } catch (err) {
    console.error('[Admin] Erro ao excluir:', err);
    toast(err.message || 'Erro ao excluir membro', 'error');
  } finally {
    delBtn.disabled = false;
    delBtn.innerHTML = '<i data-lucide="trash-2"></i> Remover';
    initIcons();
  }
}

/* ── Bind ações (lápis / lixeira) em uma row ── */
function bindRowActions(row, member) {
  const editBtn = row.querySelector('.btn-icon[title="Editar"]');
  const delBtn = row.querySelector('.btn-icon-danger');

  if (editBtn) {
    editBtn.addEventListener('click', () => {
      _adminEditingId = member.id;
      fillMemberForm(member);
      setMemberFormMode('edit');
      openMemberModal();
    });
  }

  if (delBtn) {
    delBtn.addEventListener('click', () => {
      _adminDeleteId = member.id;
      const text = document.getElementById('adminDeleteText');
      if (text) text.textContent = `Tem certeza que deseja remover o membro ${member.nome}? Essa ação não poderá ser desfeita.`;
      openDeleteModal();
    });
  }
}

/* ── Renderizar row ── */
function renderMemberRow(m) {
  const initials = (m.nome || '').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const badgeClass = m.cargo === 'Administrador' ? 'admin-badge-admin' :
                     m.cargo === 'Marketing' ? 'admin-badge-marketing' : 'admin-badge-attend';
  const row = document.createElement('tr');
  row.dataset.memberId = m.id;
  row.innerHTML = `
    <td><div class="admin-user-cell"><span class="admin-avatar">${escapeHtml(initials)}</span> ${escapeHtml(m.nome || '')}</div></td>
    <td>${escapeHtml(m.email || '')}</td>
    <td><span class="admin-badge ${badgeClass}">${escapeHtml(m.cargo || '—')}</span></td>
    <td><span class="admin-status admin-status-ativo">${escapeHtml(m.status || 'Ativo')}</span></td>
    <td>${m.created_at ? new Date(m.created_at).toLocaleDateString('pt-BR') : '—'}</td>
    <td class="admin-actions-cell">
      <button class="btn-icon" title="Editar"><i data-lucide="pencil"></i></button>
      <button class="btn-icon btn-icon-danger" title="Remover"><i data-lucide="trash-2"></i></button>
    </td>`;
  bindRowActions(row, m);
  return row;
}

/* ── Carregar membros do Supabase ── */
async function loadMembersFromSupabase() {
  console.log('[Admin] loadMembersFromSupabase called');
  if (!_supabase) { console.error('[Admin] _supabase é null!'); return; }
  try {
    const { data, error } = await _supabase.from('membros').select('id, nome, email, cargo, foto_url, centro_custo_id, auth_user_id, created_at').order('created_at', { ascending: false });
    if (error) {
      console.error('[Admin] Erro ao buscar membros:', error.message, error.code, error.details, error.hint);
      return;
    }

    console.log('[Admin] Membros encontrados:', data?.length || 0, data);
    _adminMembersCache = data || [];

    // Carregar vínculos de centros de custo para cada membro
    if (_adminMembersCache.length > 0) {
      const { data: vinculos } = await _supabase.from('membro_centros_custo').select('*');
      if (vinculos) {
        const ccMap = {};
        vinculos.forEach(v => {
          if (!ccMap[v.membro_id]) ccMap[v.membro_id] = [];
          ccMap[v.membro_id].push(v.centro_custo_id);
        });
        _adminMembersCache.forEach(m => {
          m._centro_custo_ids = ccMap[m.id] || [];
        });
      }
    }

    const tbody = document.getElementById('adminUsersBody');
    if (!tbody) { console.error('[Admin] adminUsersBody não encontrado'); return; }
    tbody.innerHTML = '';

    if (_adminMembersCache.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--muted-text)">Nenhum membro cadastrado</td></tr>';
      return;
    }

    _adminMembersCache.forEach(m => tbody.appendChild(renderMemberRow(m)));
    initIcons();
  } catch (err) {
    console.error('[Admin] Erro ao carregar membros:', err);
  }
}

/* ============================================
   ADMIN · PERMISSÕES
   ============================================ */

/* ── Modal helpers permissões ── */
function openPermModal() {
  const overlay = document.getElementById('adminPermOverlay');
  const modal = document.getElementById('adminPermModal');
  if (overlay) overlay.classList.add('open');
  if (modal) { modal.classList.add('open'); modal.scrollTop = 0; }
  initIcons();
}

function closePermModal() {
  const overlay = document.getElementById('adminPermOverlay');
  const modal = document.getElementById('adminPermModal');
  if (overlay) overlay.classList.remove('open');
  if (modal) modal.classList.remove('open');
}

/* ── Perfil defaults ── */
function applyPerfilDefaults(perfil) {
  const allModules = [
    'permHome','permDashboard','permCrm','permClienteBase','permCalendario',
    'permRotinaBlue','permPomodoro','permConversas','permConfiguracoes',
    'permAuditoria','permAdministrador','permObrigacoes','permDocumentos','permSuporte'
  ];
  const presets = {
    'Administrador': {
      home:true, dashboard:true, crm:true, cliente_base:true, calendario:true,
      rotina_blue:true, pomodoro:true, conversas:true, configuracoes:true,
      auditoria:true, administrador:true,
      calibragem: true,
      delete_telefone: true
    },
    'Atendente': {
      home:false, dashboard:false, crm:true, cliente_base:true, calendario:true,
      rotina_blue:true, pomodoro:true, conversas:true, configuracoes:false,
      auditoria:false, administrador:false,
      calibragem: false,
      delete_telefone: false
    },
    'Marketing': {
      home:true, dashboard:true, crm:true, cliente_base:true, calendario:true,
      rotina_blue:false, pomodoro:false, conversas:false, configuracoes:true,
      auditoria:true, administrador:false,
      calibragem: false,
      delete_telefone: true
    }
  };
  const p = presets[perfil] || presets['Atendente'];
  document.getElementById('permHome').checked = p.home;
  document.getElementById('permDashboard').checked = p.dashboard;
  document.getElementById('permCrm').checked = p.crm;
  document.getElementById('permClienteBase').checked = p.cliente_base;
  document.getElementById('permCalendario').checked = p.calendario;
  document.getElementById('permRotinaBlue').checked = p.rotina_blue;
  document.getElementById('permPomodoro').checked = p.pomodoro;
  document.getElementById('permConversas').checked = p.conversas;
  document.getElementById('permConfiguracoes').checked = p.configuracoes;
  document.getElementById('permAuditoria').checked = p.auditoria;
  document.getElementById('permAdministrador').checked = p.administrador;
  document.getElementById('permDeleteTelefone').checked = p.delete_telefone;
  document.getElementById('permCalibragem').checked = !!p.calibragem;
}

/* ── Render row de permissões ── */
function renderPermRow(m, perm) {
  const initials = (m.nome || '').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const badgeClass = m.cargo === 'Administrador' ? 'admin-badge-admin' :
                     m.cargo === 'Marketing' ? 'admin-badge-marketing' : 'admin-badge-attend';
  const perfil = perm ? perm.perfil : 'Sem permissão';
  const perfilCls = perm ? ({
    'Administrador': 'perm-badge-admin',
    'Atendente': 'perm-badge-atend',
    'Marketing': 'perm-badge-marketing'
  })[perm.perfil] || 'perm-badge-readonly' : 'perm-badge-readonly';

  const row = document.createElement('tr');
  row.dataset.membroId = m.id;
  row.innerHTML = `
    <td><div class="admin-user-cell"><span class="admin-avatar">${escapeHtml(initials)}</span> ${escapeHtml(m.nome || '')}</div></td>
    <td>${escapeHtml(m.email || '')}</td>
    <td><span class="admin-badge ${badgeClass}">${escapeHtml(m.cargo || '—')}</span></td>
    <td><span class="perm-badge ${perfilCls}">${escapeHtml(perfil)}</span></td>
    <td class="admin-actions-cell">
      <button class="btn-icon" title="Editar Permissões" data-perm-edit="${m.id}"><i data-lucide="pencil"></i></button>
    </td>`;

  const editBtn = row.querySelector('[data-perm-edit]');
  if (editBtn) {
    editBtn.addEventListener('click', () => openPermModalForMember(m, perm));
  }
  return row;
}

/* ── Abrir modal de permissões para um membro ── */
function openPermModalForMember(member, perm) {
  document.getElementById('adminPermMembroId').value = member.id;
  document.getElementById('adminPermTitle').textContent = 'Permissões – ' + member.nome;
  document.getElementById('adminPermSubtitle').textContent = member.email;

  if (perm) {
    document.getElementById('adminPermPerfil').value = perm.perfil || 'Somente leitura';
    document.getElementById('permHome').checked = !!perm.can_home;
    document.getElementById('permDashboard').checked = !!perm.can_dashboard;
    document.getElementById('permCrm').checked = !!perm.can_crm;
    document.getElementById('permClienteBase').checked = !!perm.can_cliente_base;
    document.getElementById('permCalendario').checked = !!perm.can_calendario;
    document.getElementById('permRotinaBlue').checked = !!perm.can_rotina_blue;
    document.getElementById('permPomodoro').checked = !!perm.can_pomodoro;
    document.getElementById('permConversas').checked = !!perm.can_conversas;
    document.getElementById('permConfiguracoes').checked = !!perm.can_configuracoes;
    document.getElementById('permAuditoria').checked = !!perm.can_auditoria;
    document.getElementById('permAdministrador').checked = !!perm.can_administrador;
    document.getElementById('permDeleteTelefone').checked = !!perm.can_delete_cliente_telefone;
    document.getElementById('permCalibragem').checked = !!perm.can_calibragem;
  } else {
    applyPerfilDefaults('Somente leitura');
  }

  openPermModal();
}

/* ── Salvar permissões (upsert) ── */
async function handlePermSave() {
  const membroId = document.getElementById('adminPermMembroId').value;
  if (!membroId) return;

  const saveBtn = document.getElementById('adminPermSaveBtn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="auth-spinner"></span>';

  const payload = {
    membro_id: membroId,
    perfil: document.getElementById('adminPermPerfil').value,
    can_home: document.getElementById('permHome').checked,
    can_dashboard: document.getElementById('permDashboard').checked,
    can_crm: document.getElementById('permCrm').checked,
    can_cliente_base: document.getElementById('permClienteBase').checked,
    can_calendario: document.getElementById('permCalendario').checked,
    can_rotina_blue: document.getElementById('permRotinaBlue').checked,
    can_pomodoro: document.getElementById('permPomodoro').checked,
    can_conversas: document.getElementById('permConversas').checked,
    can_configuracoes: document.getElementById('permConfiguracoes').checked,
    can_auditoria: document.getElementById('permAuditoria').checked,
    can_administrador: document.getElementById('permAdministrador').checked,
    can_obrigacoes: document.getElementById('permObrigacoes').checked,
    can_documentos: document.getElementById('permDocumentos').checked,
    can_suporte: document.getElementById('permSuporte').checked,
    can_calibragem: document.getElementById('permCalibragem').checked,
    can_delete_cliente_telefone: document.getElementById('permDeleteTelefone').checked,
    updated_at: new Date().toISOString()
  };

  try {
    const { data: existing } = await _supabase.from('membros_permissoes')
      .select('id').eq('membro_id', membroId).maybeSingle();

    let error;
    if (existing) {
      const res = await _supabase.from('membros_permissoes').update(payload).eq('id', existing.id);
      error = res.error;
    } else {
      const res = await _supabase.from('membros_permissoes').insert([payload]);
      error = res.error;
    }

    if (error) {
      console.error('[Admin] Erro ao salvar permissões:', error.message, error.code, error.hint);
      throw error;
    }

    toast('Permissões salvas com sucesso!');
    if (typeof registrarAuditoria === 'function') registrarAuditoria({ acao: 'Atualizações', caminho_url: '/administrador', modulo: 'Administrador' });
    closePermModal();
    await loadPermissionsFromSupabase();

  } catch (err) {
    console.error('[Admin] Erro ao salvar permissões:', err);
    toast(err.message || 'Erro ao salvar permissões', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i data-lucide="save"></i> Salvar Permissões';
    initIcons();
  }
}

/* ── Carregar permissões do Supabase ── */
async function loadPermissionsFromSupabase() {
  if (!_supabase) return;

  if (_adminMembersCache.length === 0) {
    const { data } = await _supabase.from('membros').select('*').order('created_at', { ascending: false });
    _adminMembersCache = data || [];
  }

  try {
    const { data, error } = await _supabase.from('membros_permissoes').select('*');
    if (error) {
      console.warn('[Admin] Tabela membros_permissoes não encontrada:', error.message);
      _adminPermCache = [];
    } else {
      _adminPermCache = data || [];
    }
  } catch (err) {
    console.error('[Admin] Erro ao buscar permissões:', err);
    _adminPermCache = [];
  }

  const permMap = {};
  _adminPermCache.forEach(p => { permMap[p.membro_id] = p; });

  const tbody = document.getElementById('adminPermBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (_adminMembersCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--muted-text)">Nenhum membro cadastrado</td></tr>';
    return;
  }

  _adminMembersCache.forEach(m => {
    tbody.appendChild(renderPermRow(m, permMap[m.id] || null));
  });
  initIcons();
}

/* ============================================
   ADMIN · ABA EMPRESAS (Centros de Custo)
   ============================================ */
function initEmpresasAdmin() {
  const container = document.getElementById('page-administrador');
  if (!container || container.dataset.empresaBound) return;
  container.dataset.empresaBound = 'true';

  container.addEventListener('click', (e) => {
    if (e.target.closest('#empresaNewBtn')) {
      _empresaEditingId = null;
      document.getElementById('empresaId').value = '';
      document.getElementById('empresaNomeInput').value = '';
      document.getElementById('empresaModalTitle').textContent = 'Nova Empresa';
      document.getElementById('empresaModalSubtitle').textContent = 'Cadastre uma nova empresa';
      document.getElementById('empresaSaveBtnText').textContent = 'Salvar Empresa';
      document.getElementById('empresaFootNote').textContent = 'Os vínculos serão salvos no Supabase.';
      _empresaOriginalServicoIds = [];
      _empresaOriginalMembroIds = [];
      openEmpresaModal();
      return;
    }
    if (e.target.closest('#empresaModalOverlay') || e.target.closest('[data-action="close-empresa-modal"]')) {
      closeEmpresaModal();
      return;
    }
    if (e.target.closest('#empresaDeleteOverlay') || e.target.closest('[data-action="close-empresa-delete"]')) {
      closeEmpresaDeleteModal();
      return;
    }
    if (e.target.closest('#empresaSaveBtn')) {
      handleEmpresaSave();
      return;
    }
    if (e.target.closest('#empresaDeleteConfirmBtn')) {
      handleEmpresaDelete();
      return;
    }
  });
}

async function loadEmpresasAdmin() {
  console.log('[Empresas] loadEmpresasAdmin');
  initEmpresasAdmin();

  if (!_supabase) { console.error('[Empresas] _supabase is null'); return; }

  const { data: empresas, error: errEmp } = await _supabase
    .from('centros_custo')
    .select('*')
    .order('nome');
  if (errEmp) { console.error('[Empresas] Erro ao buscar empresas:', errEmp); return; }

  const { data: vinculos, error: errVin } = await _supabase
    .from('centro_custo_servicos')
    .select('*');
  if (errVin) { console.error('[Empresas] Erro ao buscar vínculos de serviços:', errVin); }

  const vinculoMap = {};
  if (vinculos) {
    vinculos.forEach(v => {
      if (!vinculoMap[v.centro_custo_id]) vinculoMap[v.centro_custo_id] = [];
      vinculoMap[v.centro_custo_id].push(v.servico_id);
    });
  }

  const { data: servicos, error: errSvc } = await _supabase
    .from('servicos')
    .select('*')
    .order('nome');
  if (errSvc) { console.error('[Empresas] Erro ao buscar serviços:', errSvc); }

  const servicoMap = {};
  if (servicos) servicos.forEach(s => { servicoMap[s.id] = s.nome; });

  const { data: membros, error: errMem } = await _supabase
    .from('membros')
    .select('id, nome')
    .order('nome');
  if (errMem) { console.error('[Empresas] Erro ao buscar membros:', errMem); }

  // Carregar vínculos de membros com centros de custo
  const { data: membrosCc, error: errMemCc } = await _supabase
    .from('membro_centros_custo')
    .select('*');
  if (errMemCc) { console.error('[Empresas] Erro ao buscar vínculos membro-cc:', errMemCc); }

  const membroCcMap = {};
  if (membrosCc) {
    membrosCc.forEach(v => {
      if (!membroCcMap[v.centro_custo_id]) membroCcMap[v.centro_custo_id] = [];
      membroCcMap[v.centro_custo_id].push(v.membro_id);
    });
  }

  const { data: vinculosCad, error: errCad } = await _supabase
    .from('centro_custo_cadencias')
    .select('*');
  if (errCad) { console.error('[Empresas] Erro ao buscar vínculos de cadências:', errCad); }

  const cadenciaMap = {};
  if (vinculosCad) {
    vinculosCad.forEach(v => {
      if (!cadenciaMap[v.centro_custo_id]) cadenciaMap[v.centro_custo_id] = [];
      cadenciaMap[v.centro_custo_id].push(v.cadencia_id);
    });
  }

  renderEmpresasTable(empresas || [], vinculoMap, servicoMap, membros || [], cadenciaMap, membroCcMap || {});
}

function renderEmpresasTable(empresas, vinculoMap, servicoMap, membros, cadenciaMap, membroCcMap) {
  const tbody = document.getElementById('adminEmpresasBody');
  if (!tbody) return;

  if (empresas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--muted-text)">Nenhuma empresa cadastrada</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  empresas.forEach(emp => {
    const servicoNomes = (vinculoMap[emp.id] || []).map(sid => servicoMap[sid]).filter(Boolean);
    const servicoStr = servicoNomes.length > 0 ? servicoNomes.join(', ') : '—';
    const membroIdsDaEmpresa = (membroCcMap[emp.id] || []);
    const membrosDaEmpresa = membros.filter(m => membroIdsDaEmpresa.includes(m.id));
    const membroStr = membrosDaEmpresa.length > 0
      ? membrosDaEmpresa.map(m => m.nome).join(', ')
      : '—';
    const cadenciaNomes = (cadenciaMap[emp.id] || []).map(cid => {
      const found = cadences.find(c => c.id === cid);
      return found ? found.label : cid;
    }).filter(Boolean);
    const cadenciaStr = cadenciaNomes.length > 0 ? cadenciaNomes.join(', ') : '—';
    const created = emp.created_at ? new Date(emp.created_at).toLocaleDateString('pt-BR') : '—';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(emp.nome)}</strong></td>
      <td style="font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(servicoStr)}">${escapeHtml(servicoStr)}</td>
      <td style="font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(cadenciaStr)}">${escapeHtml(cadenciaStr)}</td>
      <td style="font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(membroStr)}">${escapeHtml(membroStr)}</td>
      <td>${created}</td>
      <td class="admin-actions-cell">
        <button class="btn-icon" title="Editar" data-emp-edit="${emp.id}"><i data-lucide="pencil"></i></button>
        <button class="btn-icon btn-icon-danger" title="Remover" data-emp-delete="${emp.id}"><i data-lucide="trash-2"></i></button>
      </td>`;
    tbody.appendChild(tr);

    const editBtn = tr.querySelector('[data-emp-edit]');
    if (editBtn) {
      editBtn.addEventListener('click', () => openEmpresaModal(emp, vinculoMap, membros, cadenciaMap, membroCcMap));
    }
    const delBtn = tr.querySelector('[data-emp-delete]');
    if (delBtn) {
      delBtn.addEventListener('click', () => openEmpresaDeleteModal(emp));
    }
  });
  initIcons();
}

async function openEmpresaModal(emp, vinculoMap, membros, cadenciaMap, membroCcMap) {
  const overlay = document.getElementById('empresaModalOverlay');
  const modal = document.getElementById('empresaModal');
  if (!overlay || !modal) return;

  if (emp) {
    _empresaEditingId = emp.id;
    document.getElementById('empresaId').value = emp.id;
    document.getElementById('empresaNomeInput').value = emp.nome;
    document.getElementById('empresaModalTitle').textContent = 'Editar Empresa';
    document.getElementById('empresaModalSubtitle').textContent = 'Altere os dados da empresa';
    document.getElementById('empresaSaveBtnText').textContent = 'Salvar Alterações';
    document.getElementById('empresaFootNote').textContent = 'Os vínculos serão atualizados no Supabase.';
  } else {
    _empresaEditingId = null;
    document.getElementById('empresaId').value = '';
    document.getElementById('empresaNomeInput').value = '';
  }

  // Carregar serviços checados
  const servicosCheckContainer = document.getElementById('empresaServicosChecks');
  if (servicosCheckContainer) {
    const { data: servicos } = await _supabase.from('servicos').select('id, nome').order('nome');
    const linkedServicos = emp ? (vinculoMap[emp.id] || []) : [];
    _empresaOriginalServicoIds = [...linkedServicos];
    servicosCheckContainer.innerHTML = '';
    (servicos || []).forEach(s => {
      const checked = linkedServicos.includes(s.id);
      const label = document.createElement('label');
      label.className = 'perm-check';
      label.innerHTML = `<input type="checkbox" class="empresa-servico-cb" value="${s.id}" ${checked ? 'checked' : ''} /> ${escapeHtml(s.nome)}`;
      servicosCheckContainer.appendChild(label);
    });
  }

  // Carregar membros checados (pivot)
  const membrosCheckContainer = document.getElementById('empresaMembrosChecks');
  if (membrosCheckContainer) {
    const { data: allMembros } = await _supabase.from('membros').select('id, nome').order('nome');
    const linkedMembroIds = emp
      ? (membroCcMap[emp.id] || [])
      : [];
    _empresaOriginalMembroIds = [...linkedMembroIds];
    membrosCheckContainer.innerHTML = '';
    (allMembros || []).forEach(m => {
      const checked = linkedMembroIds.includes(m.id);
      const label = document.createElement('label');
      label.className = 'perm-check';
      label.innerHTML = `<input type="checkbox" class="empresa-membro-cb" value="${m.id}" ${checked ? 'checked' : ''} /> ${escapeHtml(m.nome)}`;
      membrosCheckContainer.appendChild(label);
    });
  }

  // Carregar cadências checadas
  const cadenciasCheckContainer = document.getElementById('empresaCadenciasChecks');
  if (cadenciasCheckContainer) {
    const linkedCadencias = emp ? (cadenciaMap[emp.id] || []) : [];
    _empresaOriginalCadenciaIds = [...linkedCadencias];
    cadenciasCheckContainer.innerHTML = '';
    cadences.forEach(c => {
      const checked = linkedCadencias.includes(c.id);
      const label = document.createElement('label');
      label.className = 'perm-check';
      label.innerHTML = `<input type="checkbox" class="empresa-cadencia-cb" value="${c.id}" ${checked ? 'checked' : ''} /> ${escapeHtml(c.label)}`;
      cadenciasCheckContainer.appendChild(label);
    });
  }

  overlay.classList.add('open');
  modal.classList.add('open');
  modal.scrollTop = 0;
  initIcons();
}

function closeEmpresaModal() {
  const overlay = document.getElementById('empresaModalOverlay');
  const modal = document.getElementById('empresaModal');
  if (overlay) overlay.classList.remove('open');
  if (modal) modal.classList.remove('open');
  _empresaEditingId = null;
}

async function handleEmpresaSave() {
  const nome = document.getElementById('empresaNomeInput').value.trim();
  if (!nome) { toast('Informe o nome da empresa', 'error'); return; }

  const saveBtn = document.getElementById('empresaSaveBtn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="auth-spinner"></span>';

  try {
    let empresaId = _empresaEditingId;

    if (empresaId) {
      // UPDATE
      const { error } = await _supabase.from('centros_custo').update({ nome }).eq('id', empresaId);
      if (error) throw error;
    } else {
      // INSERT
      const { data, error } = await _supabase.from('centros_custo').insert([{ nome }]).select();
      if (error) throw error;
      empresaId = data[0].id;
    }

    // ── Gerenciar vínculo de serviços (pivot centro_custo_servicos) ──
    const selectedServicoIds = Array.from(document.querySelectorAll('.empresa-servico-cb:checked')).map(cb => cb.value);

    // Remover vínculos que foram desmarcados
    const toRemove = _empresaOriginalServicoIds.filter(id => !selectedServicoIds.includes(id));
    if (toRemove.length > 0 && empresaId) {
      await _supabase.from('centro_custo_servicos').delete().eq('centro_custo_id', empresaId).in('servico_id', toRemove);
    }

    // Adicionar novos vínculos
    const toAdd = selectedServicoIds.filter(id => !_empresaOriginalServicoIds.includes(id));
    for (const svcId of toAdd) {
      await _supabase.from('centro_custo_servicos').insert([{ centro_custo_id: empresaId, servico_id: svcId }]);
    }

    // ── Gerenciar vínculo de membros (pivot membro_centros_custo) ──
    const selectedMembroIds = Array.from(document.querySelectorAll('.empresa-membro-cb:checked')).map(cb => cb.value);

    // Membros desmarcados que antes pertenciam a esta empresa → remover da pivot
    const membrosToRemove = _empresaOriginalMembroIds.filter(id => !selectedMembroIds.includes(id));
    if (membrosToRemove.length > 0 && empresaId) {
      await _supabase.from('membro_centros_custo').delete()
        .eq('centro_custo_id', empresaId)
        .in('membro_id', membrosToRemove);
    }

    // Membros marcados agora → inserir na pivot
    const membrosToAdd = selectedMembroIds.filter(id => !_empresaOriginalMembroIds.includes(id));
    for (const mid of membrosToAdd) {
      await _supabase.from('membro_centros_custo').insert([{ membro_id: mid, centro_custo_id: empresaId }]);
    }

    // ── Gerenciar vínculo de cadências (pivot centro_custo_cadencias) ──
    const selectedCadenciaIds = Array.from(document.querySelectorAll('.empresa-cadencia-cb:checked')).map(cb => cb.value);

    const cadenciasToRemove = _empresaOriginalCadenciaIds.filter(id => !selectedCadenciaIds.includes(id));
    if (cadenciasToRemove.length > 0 && empresaId) {
      await _supabase.from('centro_custo_cadencias').delete().eq('centro_custo_id', empresaId).in('cadencia_id', cadenciasToRemove);
    }

    const cadenciasToAdd = selectedCadenciaIds.filter(id => !_empresaOriginalCadenciaIds.includes(id));
    for (const cid of cadenciasToAdd) {
      await _supabase.from('centro_custo_cadencias').insert([{ centro_custo_id: empresaId, cadencia_id: cid }]);
    }

    toast(_empresaEditingId ? 'Empresa atualizada com sucesso!' : 'Empresa criada com sucesso!');

    // Invalidar cache global para forçar recarga
    if (typeof invalidateCentrosCustoCache === 'function') invalidateCentrosCustoCache();
    await loadVinculosCadencias();

    closeEmpresaModal();
    await loadEmpresasAdmin();
  } catch (err) {
    console.error('[Empresas] Erro ao salvar:', err);
    toast(err.message || 'Erro ao salvar empresa', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i data-lucide="save"></i> <span id="empresaSaveBtnText">' + (_empresaEditingId ? 'Salvar Alterações' : 'Salvar Empresa') + '</span>';
    initIcons();
  }
}

function openEmpresaDeleteModal(emp) {
  _empresaDeleteId = emp.id;
  const text = document.getElementById('empresaDeleteText');
  if (text) text.textContent = `Tem certeza que deseja remover a empresa "${emp.nome}"? Esta ação não poderá ser desfeita.`;
  const overlay = document.getElementById('empresaDeleteOverlay');
  const modal = document.getElementById('empresaDeleteModal');
  if (overlay) overlay.classList.add('open');
  if (modal) modal.classList.add('open');
}

function closeEmpresaDeleteModal() {
  const overlay = document.getElementById('empresaDeleteOverlay');
  const modal = document.getElementById('empresaDeleteModal');
  if (overlay) overlay.classList.remove('open');
  if (modal) modal.classList.remove('open');
  _empresaDeleteId = null;
}

async function handleEmpresaDelete() {
  if (!_empresaDeleteId) return;

  const delBtn = document.getElementById('empresaDeleteConfirmBtn');
  delBtn.disabled = true;
  delBtn.innerHTML = '<span class="auth-spinner"></span>';

  try {
    // Remover vínculos de serviços
    await _supabase.from('centro_custo_servicos').delete().eq('centro_custo_id', _empresaDeleteId);
    // Remover vínculo dos membros (pivot)
    await _supabase.from('membro_centros_custo').delete().eq('centro_custo_id', _empresaDeleteId);
    // Deletar a empresa
    await _supabase.from('centros_custo').delete().eq('id', _empresaDeleteId);

    toast('Empresa removida com sucesso!');
    if (typeof invalidateCentrosCustoCache === 'function') invalidateCentrosCustoCache();

    closeEmpresaDeleteModal();
    await loadEmpresasAdmin();
  } catch (err) {
    console.error('[Empresas] Erro ao excluir:', err);
    toast(err.message || 'Erro ao excluir empresa', 'error');
  } finally {
    delBtn.disabled = false;
    delBtn.innerHTML = '<i data-lucide="trash-2"></i> Remover';
    initIcons();
  }
}

/* ============================================
   ADMIN · ABA SERVIÇOS
   ============================================ */
let _servicoEditingId = null;
let _servicoDeleteId = null;

function initServicosAdmin() {
  const container = document.getElementById('page-administrador');
  if (!container || container.dataset.servicoBound) return;
  container.dataset.servicoBound = 'true';

  container.addEventListener('click', (e) => {
    if (e.target.closest('#servicoNewBtn')) {
      _servicoEditingId = null;
      document.getElementById('servicoId').value = '';
      document.getElementById('servicoNomeInput').value = '';
      document.getElementById('servicoModalTitle').textContent = 'Novo Serviço';
      document.getElementById('servicoModalSubtitle').textContent = 'Cadastre um novo serviço';
      document.getElementById('servicoSaveBtnText').textContent = 'Salvar Serviço';
      openServicoModal();
      return;
    }
    if (e.target.closest('#servicoModalOverlay') || e.target.closest('[data-action="close-servico-modal"]')) {
      closeServicoModal();
      return;
    }
    if (e.target.closest('#servicoDeleteOverlay') || e.target.closest('[data-action="close-servico-delete"]')) {
      closeServicoDeleteModal();
      return;
    }
    if (e.target.closest('#servicoSaveBtn')) {
      handleServicoSave();
      return;
    }
    if (e.target.closest('#servicoDeleteConfirmBtn')) {
      handleServicoDelete();
      return;
    }
  });
}

async function loadServicosAdmin() {
  console.log('[Servicos] loadServicosAdmin');
  initServicosAdmin();

  if (!_supabase) { console.error('[Servicos] _supabase is null'); return; }

  const { data: servicos, error } = await _supabase
    .from('servicos')
    .select('id, nome, created_at')
    .order('nome');
  if (error) { console.error('[Servicos] Erro ao buscar serviços:', error); return; }

  renderServicosTable(servicos || []);
}

function renderServicosTable(servicos) {
  const tbody = document.getElementById('adminServicosBody');
  if (!tbody) return;

  if (servicos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:32px;color:var(--muted-text)">Nenhum serviço cadastrado</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  servicos.forEach(svc => {
    const created = svc.created_at ? new Date(svc.created_at).toLocaleDateString('pt-BR') : '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(svc.nome)}</strong></td>
      <td>${created}</td>
      <td class="admin-actions-cell">
        <button class="btn-icon btn-icon-danger" title="Remover" data-servico-delete="${svc.id}"><i data-lucide="trash-2"></i></button>
      </td>`;
    tbody.appendChild(tr);

    const delBtn = tr.querySelector('[data-servico-delete]');
    if (delBtn) {
      delBtn.addEventListener('click', () => openServicoDeleteModal(svc));
    }
  });
  initIcons();
}

function openServicoModal() {
  const overlay = document.getElementById('servicoModalOverlay');
  const modal = document.getElementById('servicoModal');
  if (!overlay || !modal) return;
  overlay.classList.add('open');
  modal.classList.add('open');
  modal.scrollTop = 0;
  const input = document.getElementById('servicoNomeInput');
  if (input) setTimeout(() => input.focus(), 100);
}

function closeServicoModal() {
  const overlay = document.getElementById('servicoModalOverlay');
  const modal = document.getElementById('servicoModal');
  if (overlay) overlay.classList.remove('open');
  if (modal) modal.classList.remove('open');
  _servicoEditingId = null;
}

async function handleServicoSave() {
  const nomeInput = document.getElementById('servicoNomeInput');
  const nome = nomeInput.value.trim();
  if (!nome) { toast('Informe o nome do serviço.', 'error'); return; }

  const saveBtn = document.getElementById('servicoSaveBtn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="auth-spinner"></span>';

  try {
    if (_servicoEditingId) {
      await _supabase.from('servicos').update({ nome }).eq('id', _servicoEditingId);
      toast('Serviço atualizado com sucesso!');
    } else {
      await _supabase.from('servicos').insert({ nome });
      toast('Serviço cadastrado com sucesso!');
    }

    closeServicoModal();
    await loadServicosAdmin();
  } catch (err) {
    console.error('[Servicos] Erro ao salvar:', err);
    toast(err.message || 'Erro ao salvar serviço', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i data-lucide="save"></i> <span id="servicoSaveBtnText">' + (_servicoEditingId ? 'Salvar Alterações' : 'Salvar Serviço') + '</span>';
    initIcons();
  }
}

function openServicoDeleteModal(svc) {
  _servicoDeleteId = svc.id;
  const text = document.getElementById('servicoDeleteText');
  if (text) text.textContent = `Tem certeza que deseja remover o serviço "${svc.nome}"? Esta ação não poderá ser desfeita.`;
  const overlay = document.getElementById('servicoDeleteOverlay');
  const modal = document.getElementById('servicoDeleteModal');
  if (overlay) overlay.classList.add('open');
  if (modal) modal.classList.add('open');
}

function closeServicoDeleteModal() {
  const overlay = document.getElementById('servicoDeleteOverlay');
  const modal = document.getElementById('servicoDeleteModal');
  if (overlay) overlay.classList.remove('open');
  if (modal) modal.classList.remove('open');
  _servicoDeleteId = null;
}

async function handleServicoDelete() {
  if (!_servicoDeleteId) return;

  const delBtn = document.getElementById('servicoDeleteConfirmBtn');
  delBtn.disabled = true;
  delBtn.innerHTML = '<span class="auth-spinner"></span>';

  try {
    await _supabase.from('centro_custo_servicos').delete().eq('servico_id', _servicoDeleteId);
    await _supabase.from('servicos').delete().eq('id', _servicoDeleteId);

    toast('Serviço removido com sucesso!');

    closeServicoDeleteModal();
    await loadServicosAdmin();
  } catch (err) {
    console.error('[Servicos] Erro ao excluir:', err);
    toast(err.message || 'Erro ao excluir serviço', 'error');
  } finally {
    delBtn.disabled = false;
    delBtn.innerHTML = '<i data-lucide="trash-2"></i> Remover';
    initIcons();
  }
}

/* ============================================
   ADMIN · ABA CADÊNCIAS (Visibilidade por Perfil)
   ============================================ */
const CADENCIA_VIS_PERFIS = ['Administrador', 'Membro', 'Pré Vendas', 'Atendente'];

async function loadCadenciaVisibilityAdmin() {
  if (!_supabase) return;
  const tbody = document.getElementById('adminCadenciaVisBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted-text)">Carregando...</td></tr>';

  const visData = await fetchCadenciaVisibility();

  // Build cadence list using mapaCadencias for UUID lookup
  const allCadences = cadences.map(c => ({
    slug: c.id,
    uuid: mapaCadencias[c.id] || null,
    label: c.label || c.short || c.id,
    visMap: {}
  }));

  // Match visibility records by UUID
  visData.forEach(v => {
    const cad = allCadences.find(c => c.uuid === v.cadencia_id);
    if (cad) cad.visMap[v.perfil] = v.visible;
  });

  renderCadenciaVisibilityTable(allCadences);
}

function renderCadenciaVisibilityTable(allCadences) {
  const tbody = document.getElementById('adminCadenciaVisBody');
  if (!tbody) return;

  if (allCadences.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--muted-text)">Nenhuma cadência encontrada</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  allCadences.forEach(cad => {
    if (!cad.uuid) {
      console.warn('[CadVis] Cadência sem UUID mapeado:', cad.slug, cad.label);
    }
    const tr = document.createElement('tr');
    const checksHtml = CADENCIA_VIS_PERFIS.map(perfil => {
      const checked = perfil === 'Administrador' || cad.visMap[perfil] === true;
      const disabled = perfil === 'Administrador';
      return `<td style="text-align:center">
        <input type="checkbox" class="cad-vis-check" data-cadencia-uuid="${cad.uuid || ''}" data-perfil="${perfil}" ${checked ? 'checked' : ''} ${disabled ? 'disabled title="Administrador sempre vê todas"' : ''} ${!cad.uuid ? 'disabled title="Cadência não encontrada no banco"' : ''} />
      </td>`;
    }).join('');
    tr.innerHTML = `<td><strong>${escapeHtml(cad.label)}</strong><span style="color:var(--gray-400);font-size:11px;margin-left:6px">${cad.slug}</span></td>${checksHtml}`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.cad-vis-check').forEach(cb => {
    cb.addEventListener('change', async (e) => {
      const cadenciaUuid = e.target.dataset.cadenciaUuid;
      const perfil = e.target.dataset.perfil;
      const visible = e.target.checked;
      if (!cadenciaUuid) {
        toast('Cadência não encontrada no banco de dados', 'error');
        e.target.checked = !e.target.checked;
        return;
      }
      try {
        await upsertCadenciaVisibility(cadenciaUuid, perfil, visible);
        console.log('[CadVis] Salvo:', cadenciaUuid, perfil, visible);
      } catch (err) {
        console.error('[CadVis] Erro ao salvar:', err);
        toast('Erro ao salvar visibilidade', 'error');
      }
    });
  });
}

/* ============================================
   CONFIGURAÇÕES · Perfil, Avatar, Equipe
   ============================================ */

let _settingsBound = false;

function showSettingsTab(tab) {
  $$('.settings-content > .card').forEach(c => c.style.display = '');
  if (tab === 'perfil') {
    $$('.settings-content > .card')[0].style.display = '';
    $$('.settings-content > .card')[1].style.display = '';
  } else if (tab === 'equipe') {
    $$('.settings-content > .card')[0].style.display = 'none';
    $$('.settings-content > .card')[1].style.display = '';
  } else {
    $$('.settings-content > .card').forEach(c => c.style.display = 'none');
  }
}

async function uploadAvatar(file) {
  if (!_supabase || !currentUser.id) return null;
  const ext = file.name.split('.').pop();
  const filePath = `avatar-${currentUser.id}-${Date.now()}.${ext}`;

  const { data: uploadData, error: uploadError } = await _supabase.storage
    .from('avatars')
    .upload(filePath, file, { cacheControl: '3600', upsert: true });

  if (uploadError) {
    console.error('[Settings] Erro ao fazer upload do avatar:', uploadError.message);
    toast('Erro ao fazer upload da imagem.', 'error');
    return null;
  }

  const { data: urlData } = _supabase.storage.from('avatars').getPublicUrl(filePath);
  const fotoUrl = urlData?.publicUrl || null;

  if (!fotoUrl) {
    toast('Erro ao obter URL pública da imagem.', 'error');
    return null;
  }

  const { error: updateError } = await _supabase
    .from('membros')
    .update({ foto_url: fotoUrl })
    .eq('id', currentUser.id);

  if (updateError) {
    console.error('[Settings] Erro ao atualizar foto_url:', updateError.message);
    toast('Erro ao salvar a foto no perfil.', 'error');
    return null;
  }

  return fotoUrl;
}

function updateAvatarUI(fotoUrl) {
  const settingsAvatar = document.getElementById('settingsAvatar');
  const sidebarAvatar = document.getElementById('sidebarUserAvatar');
  if (fotoUrl) {
    const imgHtml = `<img src="${fotoUrl}" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover" />`;
    if (settingsAvatar) settingsAvatar.innerHTML = imgHtml;
    if (sidebarAvatar) {
      const initials = (currentUser.nome || 'Usuário').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
      sidebarAvatar.innerHTML = imgHtml;
      sidebarAvatar.style.background = 'none';
    }
  } else {
    const initials = (currentUser.nome || 'Usuário').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    if (settingsAvatar) { settingsAvatar.textContent = initials; settingsAvatar.style.background = ''; }
    if (sidebarAvatar) { sidebarAvatar.textContent = initials; sidebarAvatar.style.background = ''; }
  }
}

async function loadCurrentUserProfile() {
  if (!_supabase || !currentUser.id) return;
  const { data, error } = await _supabase
    .from('membros')
    .select('nome, email, telefone, cargo, bio, foto_url, data_aniversario')
    .eq('id', currentUser.id)
    .maybeSingle();

  if (error || !data) {
    console.warn('[Settings] Erro ao carregar perfil:', error?.message);
    return;
  }

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('settingsNome', data.nome);
  setVal('settingsCargo', data.cargo);
  setVal('settingsEmail', data.email);
  setVal('settingsTelefone', data.telefone);
  setVal('settingsBio', data.bio);

  updateAvatarUI(data.foto_url);
}

async function loadTeamMembers() {
  if (!_supabase) return;
  const list = document.getElementById('settingsTeamList');
  if (!list) return;

  const isAdmin = isCurrentUserAdmin();

  let query = _supabase.from('membros').select('id, nome, email, cargo, foto_url');

  if (!isAdmin && currentUser.centro_custo_ids && currentUser.centro_custo_ids.length > 0) {
    const { data: vinculos } = await _supabase
      .from('membro_centros_custo')
      .select('membro_id')
      .in('centro_custo_id', currentUser.centro_custo_ids);
    const memberIds = [...new Set((vinculos || []).map(v => v.membro_id))];
    if (memberIds.length > 0) {
      query = query.in('id', memberIds);
    } else {
      list.innerHTML = '<li style="padding:16px;text-align:center;color:var(--muted-text)">Nenhum membro encontrado na mesma empresa.</li>';
      return;
    }
  }

  const { data: members, error } = await query.order('nome');
  if (error) {
    console.error('[Settings] Erro ao carregar equipe:', error.message);
    list.innerHTML = '<li style="padding:16px;text-align:center;color:var(--error)">Erro ao carregar equipe.</li>';
    return;
  }

  if (!members || members.length === 0) {
    list.innerHTML = '<li style="padding:16px;text-align:center;color:var(--muted-text)">Nenhum membro encontrado.</li>';
    return;
  }

  list.innerHTML = members.map(m => {
    const initials = (m.nome || '').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const badgeClass = m.cargo === 'Administrador' ? 'tag-blue' :
      m.cargo === 'Marketing' ? 'tag-purple' : 'tag-green';
    const avatarContent = m.foto_url
      ? `<img src="${m.foto_url}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover" />`
      : initials;
    const avatarStyle = m.foto_url ? 'background:none' : '';
    return `<li class="team-item">
      <div class="avatar ${badgeClass}" style="${avatarStyle}">${avatarContent}</div>
      <div>
        <p class="client-name">${escapeHtml(m.nome || '')}</p>
        <p class="client-cnpj">${escapeHtml(m.email || '')}</p>
      </div>
      <span class="tag ${badgeClass}">${escapeHtml(m.cargo || 'Membro')}</span>
    </li>`;
  }).join('');
}

function initConfiguracoes() {
  loadCurrentUserProfile();
  loadTeamMembers();
  initBrandingSection();

  if (_settingsBound) return;
  _settingsBound = true;

  const avatarBtn = document.getElementById('settingsAvatarBtn');
  const avatarInput = document.getElementById('settingsAvatarInput');
  if (avatarBtn && avatarInput) {
    avatarBtn.addEventListener('click', () => avatarInput.click());
    avatarInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const fotoUrl = await uploadAvatar(file);
      if (fotoUrl) {
        updateAvatarUI(fotoUrl);
        toast('Foto de perfil atualizada com sucesso!');
      }
      avatarInput.value = '';
    });
  }

  const saveBtn = document.querySelector('.settings-content .btn-primary');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const getVal = (id) => (document.getElementById(id)?.value || '').trim();
      const payload = {
        nome: getVal('settingsNome'),
        cargo: getVal('settingsCargo'),
        email: getVal('settingsEmail'),
        telefone: getVal('settingsTelefone'),
        bio: getVal('settingsBio')
      };
      const { error } = await _supabase
        .from('membros')
        .update(payload)
        .eq('id', currentUser.id);
      if (error) {
        toast('Erro ao salvar perfil: ' + error.message, 'error');
      } else {
        currentUser.nome = payload.nome;
        const sidebarName = document.getElementById('sidebarUserName');
        if (sidebarName) sidebarName.textContent = payload.nome;
        toast('Perfil atualizado com sucesso!');
      }
    });
  }
}

/* ============================================
   BRANDING · Identidade Visual (Logo + Favicon)
   ============================================ */

const BRANDING_BUCKET = 'branding';
const BRANDING_SEED_ID = '00000000-0000-0000-0000-000000000000';
const BRANDING_DEFAULT_LOGO = 'assets/blue-group.png?v=2';
const BRANDING_DEFAULT_FAVICON = 'assets/blue-group.png?v=2';

async function loadBranding() {
  if (!_supabase) {
    applyBranding(null, null, null);
    return;
  }
  try {
    const { data, error } = await _supabase
      .from('configuracoes_sistema')
      .select('logo_url, favicon_url, login_logo_url')
      .eq('id', BRANDING_SEED_ID)
      .maybeSingle();
    if (error) {
      console.warn('[Branding] Erro ao carregar configuracoes:', error.message);
      applyBranding(null, null, null);
      return;
    }
    applyBranding(data?.logo_url || null, data?.favicon_url || null, data?.login_logo_url || null);
  } catch (err) {
    console.error('[Branding] Erro ao carregar branding:', err.message);
    applyBranding(null, null, null);
  }
}

function applyBranding(logoUrl, faviconUrl, loginLogoUrl) {
  const finalLogo = logoUrl || BRANDING_DEFAULT_LOGO;
  const finalFavicon = faviconUrl || BRANDING_DEFAULT_FAVICON;
  const finalLoginLogo = loginLogoUrl || finalLogo;

  const sidebarImg = document.getElementById('sidebarBrandImg');
  if (sidebarImg) sidebarImg.src = finalLogo;

  const authImg = document.getElementById('authBrandImg');
  if (authImg) authImg.src = finalLoginLogo;

  const links = document.querySelectorAll(
    'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
  );
  links.forEach(link => { link.href = finalFavicon; });
  if (links.length === 0 && finalFavicon) {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = finalFavicon;
    document.head.appendChild(link);
  }
}

async function uploadBrandingImage(file, type) {
  if (!_supabase || !currentUser || !currentUser.id) return null;
  const ext = file.name.split('.').pop();
  const filePath = `branding-${type}-${Date.now()}.${ext}`;

  const { data: uploadData, error: uploadError } = await _supabase.storage
    .from(BRANDING_BUCKET)
    .upload(filePath, file, { cacheControl: '3600', upsert: true });

  if (uploadError) {
    console.error('[Branding] Erro ao fazer upload:', uploadError.message);
    toast('Erro ao fazer upload da imagem.', 'error');
    return null;
  }

  const { data: urlData } = _supabase.storage.from(BRANDING_BUCKET).getPublicUrl(filePath);
  const publicUrl = urlData?.publicUrl || null;
  if (!publicUrl) {
    toast('Erro ao obter URL pública da imagem.', 'error');
    return null;
  }
  return publicUrl;
}

async function saveBranding(logoUrl, faviconUrl, loginLogoUrl) {
  if (!_supabase) return false;
  const { error } = await _supabase
    .from('configuracoes_sistema')
    .update({ logo_url: logoUrl, favicon_url: faviconUrl, login_logo_url: loginLogoUrl, updated_at: new Date().toISOString() })
    .eq('id', BRANDING_SEED_ID);
  if (error) {
    console.error('[Branding] Erro ao salvar:', error.message);
    toast('Erro ao salvar identidade visual.', 'error');
    return false;
  }
  return true;
}

function initBrandingSection() {
  const card = document.getElementById('settingsBrandingCard');
  if (!card) return;

  const isAdmin = isCurrentUserAdmin();
  card.style.display = isAdmin ? '' : 'none';

  if (!isAdmin) return;

  const logoInput = document.getElementById('brandingLogoInput');
  const logoBtn = document.getElementById('brandingLogoBtn');
  const logoPreview = document.getElementById('brandingLogoPreview');
  const logoRemove = document.getElementById('brandingLogoRemove');
  const faviconInput = document.getElementById('brandingFaviconInput');
  const faviconBtn = document.getElementById('brandingFaviconBtn');
  const faviconPreview = document.getElementById('brandingFaviconPreview');
  const faviconRemove = document.getElementById('brandingFaviconRemove');
  const loginLogoInput = document.getElementById('brandingLoginLogoInput');
  const loginLogoBtn = document.getElementById('brandingLoginLogoBtn');
  const loginLogoPreview = document.getElementById('brandingLoginLogoPreview');
  const loginLogoRemove = document.getElementById('brandingLoginLogoRemove');
  const saveBtn = document.getElementById('brandingSaveBtn');

  let logoUrl = null;
  let faviconUrl = null;
  let loginLogoUrl = null;

  if (logoBtn && logoInput) {
    logoBtn.addEventListener('click', () => logoInput.click());
    logoInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const url = await uploadBrandingImage(file, 'logo');
      if (url) {
        logoUrl = url;
        if (logoPreview) { logoPreview.src = url; logoPreview.style.display = ''; }
        if (logoRemove) logoRemove.style.display = '';
        toast('Logo selecionado.');
      }
      logoInput.value = '';
    });
  }

  if (logoRemove && logoPreview) {
    logoRemove.addEventListener('click', () => {
      logoUrl = null;
      logoPreview.src = '';
      logoPreview.style.display = 'none';
      logoRemove.style.display = 'none';
    });
  }

  if (faviconBtn && faviconInput) {
    faviconBtn.addEventListener('click', () => faviconInput.click());
    faviconInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const url = await uploadBrandingImage(file, 'favicon');
      if (url) {
        faviconUrl = url;
        if (faviconPreview) { faviconPreview.src = url; faviconPreview.style.display = ''; }
        if (faviconRemove) faviconRemove.style.display = '';
        toast('Favicon selecionado.');
      }
      faviconInput.value = '';
    });
  }

  if (faviconRemove && faviconPreview) {
    faviconRemove.addEventListener('click', () => {
      faviconUrl = null;
      faviconPreview.src = '';
      faviconPreview.style.display = 'none';
      faviconRemove.style.display = 'none';
    });
  }

  if (loginLogoBtn && loginLogoInput) {
    loginLogoBtn.addEventListener('click', () => loginLogoInput.click());
    loginLogoInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const url = await uploadBrandingImage(file, 'login-logo');
      if (url) {
        loginLogoUrl = url;
        if (loginLogoPreview) { loginLogoPreview.src = url; loginLogoPreview.style.display = ''; }
        if (loginLogoRemove) loginLogoRemove.style.display = '';
        toast('Logo da tela de login selecionado.');
      }
      loginLogoInput.value = '';
    });
  }

  if (loginLogoRemove && loginLogoPreview) {
    loginLogoRemove.addEventListener('click', () => {
      loginLogoUrl = null;
      loginLogoPreview.src = '';
      loginLogoPreview.style.display = 'none';
      loginLogoRemove.style.display = 'none';
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const ok = await saveBranding(logoUrl, faviconUrl, loginLogoUrl);
      if (ok) {
        applyBranding(logoUrl, faviconUrl, loginLogoUrl);
        toast('Identidade visual salva com sucesso!');
      }
    });
  }
}

let _userPermCache = null;

const _sidebarMenuItems = [
  { page: 'home',          icon: 'home',             label: 'Home' },
  { page: 'dashboard',     icon: 'layout-dashboard', label: 'Dashboard' },
  { page: 'crm',           icon: 'kanban-square',    label: 'CRM' },
  { page: 'clientes',      icon: 'users',            label: 'Cliente da Base' },
  { page: 'calendario',    icon: 'calendar-days',    label: 'Calendário' },
  { page: 'rotina',        icon: 'clipboard-list',   label: 'Rotina Blue' },
  { page: 'pomodoro',      icon: 'timer',            label: 'Pomodoro' },
  { page: 'conversas',     icon: 'message-circle',   label: 'Conversas' },
  { page: 'configuracoes', icon: 'settings',         label: 'Configurações' },
  { page: 'auditoria',     icon: 'shield',           label: 'Auditoria' },
  { page: 'administrador', icon: 'shield-check',     label: 'Administrador' }
];
const _sidebarShortcuts = [
  { page: 'calibragem',    icon: 'gauge',            label: 'Calibragem' }
];

const _permKeyMap = {
  home: 'can_home', dashboard: 'can_dashboard', crm: 'can_crm',
  clientes: 'can_cliente_base', calendario: 'can_calendario',
  rotina: 'can_rotina_blue', pomodoro: 'can_pomodoro',
  conversas: 'can_conversas', configuracoes: 'can_configuracoes',
  auditoria: 'can_auditoria', administrador: 'can_administrador',
  calibragem: 'can_calibragem'
};

async function loadUserPermissions() {
  if (!_supabase) {
    console.warn('[Perm] _supabase is null, returning null');
    return null;
  }

  // Step 1: Ensure we have the membros.id (UUID from membros table)
  if (!currentUser.id) {
    console.warn('[Perm] currentUser.id is null, attempting to resolve member...');
    const authUser = _authUser || (await _supabase.auth.getUser()).data?.user;
    if (!authUser) {
      console.error('[Perm] No auth user available');
      return null;
    }
    // Try by auth_user_id
    const { data: byAuth } = await _supabase.from('membros')
      .select('id, nome, email, foto_url').eq('auth_user_id', authUser.id).maybeSingle();
    if (byAuth) {
      currentUser.id = byAuth.id;
      currentUser.nome = currentUser.nome || byAuth.nome;
      currentUser.foto_url = byAuth.foto_url || null;
      console.log('[Perm] Resolved member by auth_user_id:', byAuth.id);
    } else {
      // Try by email
      const { data: byEmail } = await _supabase.from('membros')
        .select('id, nome, email, foto_url').eq('email', authUser.email).maybeSingle();
      if (byEmail) {
        currentUser.id = byEmail.id;
        currentUser.nome = currentUser.nome || byEmail.nome;
        currentUser.foto_url = byEmail.foto_url || null;
        // Link auth_user_id for future lookups
        await _supabase.from('membros').update({ auth_user_id: authUser.id }).eq('id', byEmail.id);
        console.log('[Perm] Resolved member by email and linked auth_user_id:', byEmail.id);
      } else {
        console.error('[Perm] Could not find member for auth user:', authUser.id, authUser.email);
        return null;
      }
    }
  }

  // Popula currentUser.centro_custo_ids a partir do pivot caso ainda esteja
  // vazio (loadMemberFromAuth pode ter falhado e a resolução acima ter sido a
  // única fonte). Sem isso os filtros de empresa ficam vazios.
  if (currentUser.id && (!currentUser.centro_custo_ids || currentUser.centro_custo_ids.length === 0)) {
    const { data: ccData, error: ccErr } = await _supabase.from('membro_centros_custo')
      .select('centro_custo_id').eq('membro_id', currentUser.id);
    if (ccErr) {
      console.warn('[Perm] Erro ao carregar centros de custo do membro:', ccErr.message);
    } else {
      currentUser.centro_custo_ids = (ccData || []).map(r => r.centro_custo_id);
      console.log('[Perm] currentUser.centro_custo_ids populados:', currentUser.centro_custo_ids);
    }
  }

  // Step 2: Query permissions
  console.log('[Perm] Querying membros_permissoes for membro_id:', currentUser.id);
  try {
    const { data, error } = await _supabase.from('membros_permissoes')
      .select('*').eq('membro_id', currentUser.id).maybeSingle();
    if (error) {
      console.error('[Perm] Query error:', error.message, error.code);
      return null;
    }
    if (!data) {
      console.warn('[Perm] No permission record found for membro_id:', currentUser.id);
      return null;
    }
    console.log('[Perm] Permissions loaded:', JSON.stringify(data));
    _userPermCache = data;
    currentUser.perfil = data.perfil || currentUser.perfil;
    return data;
  } catch (err) {
    console.error('[Perm] Exception:', err);
    return null;
  }
}

function isPageAllowed(page, perm) {
  if (!perm) return true;
  const key = _permKeyMap[page];
  if (!key) return true;
  return perm[key] !== false;
}

function renderSidebar() {
  const nav = document.querySelector('.sidebar-nav');
  if (!nav) return;

  console.log('[Sidebar] Rendering, _userPermCache =', _userPermCache ? 'loaded' : 'null');

  const allowedMenu = _sidebarMenuItems.filter(m => isPageAllowed(m.page, _userPermCache));
  // Calibragem: exclusivo do Administrador (sobresai permissão do banco)
  const isAdmin = _userPermCache && _userPermCache.perfil === 'Administrador';
  const allowedShortcuts = _sidebarShortcuts.filter(m =>
    m.page === 'calibragem' ? (isAdmin && isPageAllowed(m.page, _userPermCache)) : isPageAllowed(m.page, _userPermCache)
  );

  console.log('[Sidebar] Allowed menu items:', allowedMenu.map(m => m.page).join(', '));
  console.log('[Sidebar] Allowed shortcuts:', allowedShortcuts.map(m => m.page).join(', '));

  let html = '<p class="nav-label">Menu principal</p><ul>';
  allowedMenu.forEach((item, i) => {
    const activeClass = (item.page === activePage) ? ' active' : '';
    html += `<li><a href="#" class="nav-item${activeClass}" data-page="${item.page}">
      <i data-lucide="${item.icon}"></i><span>${item.label}</span></a></li>`;
  });
  html += '</ul>';

  if (allowedShortcuts.length > 0) {
    html += '<p class="nav-label">Atalhos</p><ul>';
    allowedShortcuts.forEach(item => {
      const activeClass = (item.page === activePage) ? ' active' : '';
      html += `<li><a href="#" class="nav-item${activeClass}" data-page="${item.page}">
        <i data-lucide="${item.icon}"></i><span>${item.label}</span></a></li>`;
    });
    html += '</ul>';
  }

  nav.innerHTML = html;

  $$('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      if (page) setActivePage(page);
    });
  });

  initIcons();
}

function canDeleteClienteTelefone() {
  if (!_userPermCache) return true;
  return !!_userPermCache.can_delete_cliente_telefone;
}

/* ============================================
   INPUT MASKS
   ============================================ */
function applyMask(id, maskFn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => { el.value = maskFn(el.value); });
}

function maskCPF(v) {
  v = v.replace(/\D/g, '').slice(0, 11);
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return v;
}

function maskDate(v) {
  v = v.replace(/\D/g, '').slice(0, 8);
  v = v.replace(/(\d{2})(\d)/, '$1/$2');
  v = v.replace(/(\d{2})(\d)/, '$1/$2');
  return v;
}

function maskPhone(v) {
  v = v.replace(/\D/g, '').slice(0, 11);
  v = v.replace(/^(\d{2})(\d)/g, '($1) $2');
  v = v.replace(/(\d{5})(\d)/, '$1-$2');
  return v;
}

function canEditEvent(event) {
  if (currentUser.perfil === 'Administrador') return true;
  if (event.createdBy && String(event.createdBy) === String(currentUser.id)) return true;
  return false;
}

function canDeleteEvent(event) {
  return currentUser.perfil === 'Administrador';
}

function isReadOnly(event) {
  return !canEditEvent(event);
}

/* ---------- Init ícones Lucide ---------- */
function initIcons() {
  if (window.lucide && lucide.createIcons) lucide.createIcons();
}

/* ============================================
   HOME · RENDER (grid de módulos)
   ============================================ */
function getSectionIcon(section) {
  return ({
    'Principal': 'star'
  })[section] || 'circle';
}

function renderHomeModules(filter = '') {
  const wrap = document.getElementById('page-home');
  if (!wrap) return;

  // Reconstrói hero + search + main se o conteúdo foi removido (navegação away -> back)
  if (!wrap.querySelector('.home-main')) {
    wrap.innerHTML = `
      <header class="home-hero">
        <div class="home-hero-content">
          <h1 class="home-hero-title">Bem vindo ao Blue Group</h1>
          <p class="home-hero-sub">Acesse rapidamente os módulos e recursos do sistema</p>
        </div>
        <div class="home-hero-search">
          <i data-lucide="search" aria-hidden="true"></i>
          <input type="text" id="homeSearchInput" placeholder="Buscar módulos..." aria-label="Buscar módulos" />
          <kbd>/</kbd>
        </div>
      </header>
      <main class="home-main"></main>`;
    homeSearchBound = false;
  }

  const q = filter.toLowerCase().trim();
  const permMap = _userPermCache ? {
    home: _userPermCache.can_home,
    dashboard: _userPermCache.can_dashboard,
    crm: _userPermCache.can_crm,
    clientes: _userPermCache.can_cliente_base,
    calendario: _userPermCache.can_calendario,
    configuracoes: _userPermCache.can_configuracoes,
    rotina: _userPermCache.can_rotina_blue,
    pomodoro: _userPermCache.can_pomodoro,
    conversas: _userPermCache.can_conversas,
    auditoria: _userPermCache.can_auditoria,
    calibragem: _userPermCache.can_calibragem
  } : null;
  const permFiltered = permMap
    ? homeModules.filter(m => permMap[m.id] !== false)
    : homeModules;
  const filtered = q
    ? permFiltered.filter(m => m.title.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q))
    : permFiltered;
  const sections = {};
  filtered.forEach(m => {
    if (!sections[m.section]) sections[m.section] = [];
    sections[m.section].push(m);
  });

  const main = wrap.querySelector('.home-main');
  if (!main) return;

  let html = '';
  Object.keys(sections).forEach(section => {
    const items = sections[section];
    html += `
      <section class="home-section" data-section="${section}">
        <h2 class="home-section-title">
          <i data-lucide="${getSectionIcon(section)}" aria-hidden="true"></i>
          ${section}
        </h2>
        <ul class="home-grid" role="list">
          ${items.map(m => `
            <li role="listitem">
              <div class="home-card"
                   role="button"
                   tabindex="0"
                   aria-label="Abrir ${m.title}"
                   data-id="${m.id}"
                   data-route="${m.route}">
                <div class="home-card-icon">
                  <i data-lucide="${m.icon}" aria-hidden="true"></i>
                </div>
                <div class="home-card-body">
                  <h3 class="home-card-title">${m.title}</h3>
                  <p class="home-card-desc">${m.desc}</p>
                </div>
                <div class="home-card-action" aria-hidden="true">
                  <i data-lucide="chevron-right"></i>
                </div>
              </div>
            </li>
          `).join('')}
        </ul>
      </section>`;
  });

  main.innerHTML = html;

  // Se nenhum resultado
  if (!filtered.length && q) {
    main.innerHTML = `<div class="home-empty"><i data-lucide="search-x" aria-hidden="true"></i><p>Nenhum módulo encontrado para "<strong>${escapeHtml(q)}</strong>"</p></div>`;
  }

  initIcons();
  bindHomeCards();
  bindHomeSearch();
}

function bindHomeCards() {
  $$('.home-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const route = card.dataset.route;
      navigateToRoute(id, route);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const id = card.dataset.id;
        const route = card.dataset.route;
        navigateToRoute(id, route);
      }
    });
  });
}

let homeSearchDebounce = null;
let homeSearchBound = false;
function bindHomeSearch() {
  if (homeSearchBound) return;
  const input = document.getElementById('homeSearchInput');
  if (!input) return;
  homeSearchBound = true;
  input.addEventListener('input', (e) => {
    clearTimeout(homeSearchDebounce);
    homeSearchDebounce = setTimeout(() => {
      renderHomeModules(e.target.value);
    }, 200);
  });
}
// Atalho "/" para focar busca (bind uma vez só)
document.addEventListener('keydown', function homeSearchShortcut(e) {
  if (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) {
    const input = document.getElementById('homeSearchInput');
    if (input) { e.preventDefault(); input.focus(); }
  }
});

function navigateToRoute(id, route) {
  if (knownPages.has(id)) {
    setActivePage(id);
  } else {
    toast('Página não disponível', 'error');
  }
}

/* ============================================
   NAVEGAÇÃO ENTRE PÁGINAS
   ============================================ */
/* ============================================
   HOME · MÓDULOS (JSON dinâmico)
   ============================================ */
const homeModules = [
  { id: 'home',          title: 'Home',           desc: 'Acesse rapidamente os principais módulos do sistema.',    icon: 'home',             route: '/home',           section: 'Principal' },
  { id: 'dashboard',     title: 'Dashboard',      desc: 'Indicadores e métricas em tempo real.',                  icon: 'layout-dashboard', route: '/dashboard',      section: 'Principal' },
  { id: 'crm',           title: 'CRM',            desc: 'Centralize o relacionamento com clientes.',              icon: 'kanban-square',    route: '/crm',            section: 'Principal' },
  { id: 'clientes',      title: 'Cliente da Base',desc: 'Organize e qualifique os clientes.',                     icon: 'users',            route: '/cliente-da-base', section: 'Principal' },
  { id: 'calendario',    title: 'Calendário',     desc: 'Organize as datas dos eventos.',                         icon: 'calendar-days',    route: '/calendario',     section: 'Principal' },
  { id: 'configuracoes', title: 'Configurações',  desc: 'Personalize conta e equipe.',                             icon: 'settings',         route: '/configuracoes',  section: 'Principal' },
  { id: 'rotina',        title: 'Rotina Blue',    desc: 'Organize tarefas, reuniões e lembretes do dia a dia.',    icon: 'clipboard-list',   route: '/rotina',         section: 'Ferramentas' },
  { id: 'pomodoro',      title: 'Pomodoro',       desc: 'Gestão de tempo e foco com ciclos de trabalho.',          icon: 'timer',            route: '/pomodoro',       section: 'Ferramentas' },
  { id: 'conversas',     title: 'Conversas',      desc: 'Central de conversas e mensagens da equipe.',            icon: 'message-circle',   route: '/conversas',      section: 'Ferramentas' },
  { id: 'auditoria',     title: 'Auditoria',      desc: 'Rastreamento completo de ações e histórico do sistema.', icon: 'shield',           route: '/auditoria',      section: 'Ferramentas' }
];

const knownPages = new Set(['home','dashboard','crm','clientes','calendario','configuracoes','rotina','pomodoro','conversas','auditoria','administrador','obrigacoes','documentos','suporte','calibragem','centros-custo','centro-custo-detail']);

const pageConfig = {
  home: {
    title: 'Home',
    subtitle: 'Bem-vindo ao Blue Group',
    primary: 'Novo cliente',
    primaryIcon: 'plus'
  },
  dashboard: {
    title: 'Dashboard',
    subtitle: 'Visão gerencial · Junho 2026',
    primary: 'Exportar',
    primaryIcon: 'download'
  },
  crm: {
    title: 'CRM',
    subtitle: 'Pipeline de leads e cadências',
    primary: '+ Lead',
    primaryIcon: 'plus'
  },
  clientes: {
    title: 'Cliente da Base',
    subtitle: 'clientes cadastrados',
    primary: 'Adicionar cliente',
    primaryIcon: 'user-plus'
  },
  calendario: {
    title: 'Calendário',
    subtitle: 'Compromissos e obrigações contábeis',
    primary: 'Novo evento',
    primaryIcon: 'plus'
  },
  configuracoes: {
    title: 'Configurações',
    subtitle: 'Personalize sua conta e a da equipe',
    primary: 'Salvar',
    primaryIcon: 'save'
  },
  rotina: {
    title: 'Rotina Blue',
    subtitle: 'Organize seu dia a dia',
    primary: 'Nova tarefa',
    primaryIcon: 'plus'
  },
  pomodoro: {
    title: 'Pomodoro',
    subtitle: 'Gestão de tempo e foco',
    primary: '',
    primaryIcon: 'timer'
  },
  conversas: {
    title: 'Conversas',
    subtitle: 'Central de conversas',
    primary: '',
    primaryIcon: 'message-circle'
  },
  auditoria: {
    title: 'Auditoria',
    subtitle: 'Rastreamento completo de todas as ações do sistema',
    primary: '',
    primaryIcon: 'shield'
  },
  administrador: {
    title: 'Administrador',
    subtitle: 'Gerencie membros, permissões e convites',
    primary: '',
    primaryIcon: 'shield-check'
  },
  obrigacoes: {
    title: 'Obrigações',
    subtitle: 'Obrigações contábeis e prazos',
    primary: '',
    primaryIcon: 'file-text'
  },
  documentos: {
    title: 'Documentos',
    subtitle: 'Documentos e arquivos do sistema',
    primary: '',
    primaryIcon: 'inbox'
  },
  suporte: {
    title: 'Suporte',
    subtitle: 'Central de ajuda e suporte',
    primary: '',
    primaryIcon: 'life-buoy'
  },
  calibragem: {
    title: 'Calibragem',
    subtitle: 'Análise de performance da equipe',
    primary: '',
    primaryIcon: 'gauge'
  },
  'centros-custo': {
    title: 'Centros de Custo',
    subtitle: 'Gerencie os centros de custo do sistema',
    primary: '',
    primaryIcon: 'building-2'
  },
  'centro-custo-detail': {
    title: 'Centro de Custo',
    subtitle: 'Dados e funcionalidades deste centro de custo',
    primary: '',
    primaryIcon: 'building-2'
  }
};

let activePage = 'home';

function setActivePage(page) {
  const prevPage = activePage;

  // Verificação de permissão: bloquear acesso a módulos sem permissão
  if (_userPermCache) {
    const permPageMap = {
      home: 'can_home', dashboard: 'can_dashboard', crm: 'can_crm',
      clientes: 'can_cliente_base', calendario: 'can_calendario',
      rotina: 'can_rotina_blue', pomodoro: 'can_pomodoro',
      conversas: 'can_conversas', configuracoes: 'can_configuracoes',
      auditoria: 'can_auditoria', administrador: 'can_administrador',
      obrigacoes: 'can_obrigacoes', documentos: 'can_documentos',
      suporte: 'can_suporte', calibragem: 'can_calibragem'
    };
    const permKey = permPageMap[page];
    if (permKey && _userPermCache[permKey] === false) {
      toast('Você não tem permissão para acessar esta página.', 'error');
      return;
    }
  }

  activePage = page;

  // Auditoria: registrar acesso à página
  if (typeof registrarAuditoria === 'function') {
    const pageLabel = {
      home: 'Home', dashboard: 'Dashboard', crm: 'CRM', clientes: 'Cliente da Base',
      calendario: 'Calendário', configuracoes: 'Configurações', rotina: 'Rotina Blue',
      pomodoro: 'Pomodoro', conversas: 'Conversas', auditoria: 'Auditoria',
      administrador: 'Administrador', obrigacoes: 'Obrigações',
      documentos: 'Documentos', suporte: 'Suporte',
      calibragem: 'Calibragem'
    };
    registrarAuditoria({
      acao: 'Acessos',
      caminho_url: '/' + page,
      modulo: pageLabel[page] || page
    });
  }

  // Limpa conteúdo do Home ao sair da rota /home (remove do DOM, não apenas CSS)
  if (prevPage === 'home' && page !== 'home') {
    const homeWrap = document.getElementById('page-home');
    if (homeWrap) {
      homeWrap.innerHTML = '';
      homeSearchBound = false;
    }
  }

  // Limpa seleção de clientes ao sair da rota clientes
  if (prevPage === 'clientes' && page !== 'clientes') {
    selectedClientIds.clear();
    const massBar = document.getElementById('clientMassBar');
    if (massBar) massBar.hidden = true;
  }

  // Restaura o Dashboard principal caso estivéssemos na tela de Centro de Custo
  if (prevPage === 'centro-custo-detail' && page !== 'centro-custo-detail') {
    const dashContainer = document.querySelector('.dash-container');
    const pageDashboard = document.getElementById('page-dashboard');
    if (dashContainer && pageDashboard && dashContainer.parentElement !== pageDashboard) {
      pageDashboard.appendChild(dashContainer);
      const dashHeader = document.querySelector('.dash-header');
      if (dashHeader) dashHeader.style.display = '';
      dashCcFilter = 'all';
      const btn = document.getElementById('dashCcFilterBtn');
      if (btn) btn.innerHTML = '<i data-lucide="building-2"></i> Centro de Custo <i data-lucide="chevron-down"></i>';
      const badge = document.getElementById('dashCcActiveBadge');
      if (badge) badge.hidden = true;
      invalidateDashCache();
    }
  }

  $$('.page').forEach(p => p.classList.remove('active'));
  const target = $(`#page-${page}`);
  if (target) target.classList.add('active');

  $$('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = $$('.nav-item').find(n => n.dataset.page === page);
  if (navItem) navItem.classList.add('active');

  // Pomodoro full-screen mode
  const mainEl = $('main.main');
  const sidebarEl = $('.sidebar');
  if (mainEl) {
    if (page === 'pomodoro') {
      mainEl.classList.add('pomo-mode');
      if (sidebarEl) sidebarEl.classList.add('pomo-white');
    } else {
      mainEl.classList.remove('pomo-mode');
      if (sidebarEl) sidebarEl.classList.remove('pomo-white');
    }
  }

  // Header SEMPRE é atualizado a partir do pageConfig[page] (fonte única de verdade).
  // Se a rota não tiver entrada, limpamos o header para nunca reaproveitar
  // título/subtítulo/ação de uma rota anterior.
  const cfg = pageConfig[page];
  const titleEl = $('#pageTitle');
  const subtitleEl = $('#pageSubtitle');
  const btn = $('#primaryAction span');
  const icon = $('#primaryAction i');
  if (cfg) {
    if (titleEl) titleEl.textContent = cfg.title;
    if (subtitleEl) subtitleEl.textContent = cfg.subtitle;
    if (btn) btn.textContent = cfg.primary || '';
    if (icon && cfg.primaryIcon) {
      icon.setAttribute('data-lucide', cfg.primaryIcon);
    }
  } else {
    if (titleEl) titleEl.textContent = '';
    if (subtitleEl) subtitleEl.textContent = '';
    if (btn) btn.textContent = '';
    if (icon) icon.setAttribute('data-lucide', 'plus');
  }
  if (icon) initIcons();

  // Ocultar botões de ação do topbar na Home, Dashboard, Calendário, Rotina e Pomodoro
  const chatBtn = $('#topbarChatBtn');
  const primaryBtn = $('#primaryAction');
  const hideTopbarActions = page === 'home' || page === 'dashboard' || page === 'calendario' || page === 'rotina' || page === 'pomodoro' || page === 'conversas' || page === 'configuracoes' || page === 'auditoria' || page === 'administrador' || page === 'calibragem';
  if (chatBtn) chatBtn.style.display = hideTopbarActions ? 'none' : '';
  if (primaryBtn) primaryBtn.style.display = hideTopbarActions ? 'none' : '';

  // Inicializa coisas específicas da página
  if (page === 'dashboard') {
    initDashboardPeriod();
    refreshDashboard();
  }
  if (page === 'home') {
    renderHomeModules();
  }
  if (page === 'clientes' && !window._clientsInited) {
    renderClients();
  }
  if (page === 'clientes') {
    populateCadenceFilter();
  }
  if (page === 'clientes' && subtitleEl) {
    subtitleEl.textContent = `${clientsData.length} clientes cadastrados`;
  }
  if (page === 'crm') {
    renderAll();
  }
  if (page === 'calendario') {
    renderCalendar();
  }
  if (page === 'rotina') {
    renderRotina();
  }
  if (page === 'auditoria') {
    initAuditoria();
  }
  if (page === 'administrador') {
    initAdminView();
  }
  if (page === 'calibragem') {
    initCalibragem();
  }
  if (page === 'configuracoes') {
    initConfiguracoes();
  }
  if (page === 'centros-custo') {
    initCentrosCusto();
  }
}

/* ============================================
   CLIENTES — DATA + RENDER
   ============================================ */
let clientsData = [];
let selectedClientIds = new Set();
let _clientMassBarBound = false;

const statusMap = {
  active: { label: 'Ativo',        cls: 'status-active' },
  impl:   { label: 'Implantação',  cls: 'status-impl' },
  late:   { label: 'Inadimplente', cls: 'status-late' },
  warn:   { label: 'Atenção',      cls: 'status-warn' }
};

const ALL_EVENT_SERVICES = [];

async function populateServiceFilter() {
  const dropdown = $('#servicoDropdown');
  if (!dropdown) return;

  const allServicos = await fetchServicosSupabase();

  const isAdmin = _userPermCache && _userPermCache.perfil === 'Administrador';
  let empresaId = null;
  if (isAdmin) {
    empresaId = clienteCcFilter !== 'all' ? clienteCcFilter : null;
  } else {
    empresaId = currentUser.centro_custo_ids?.[0] || null;
  }

  let servicos = [];
  if (empresaId) {
    const linkedSvcIds = vinculosServicos
      .filter(v => v.centro_custo_id === empresaId)
      .map(v => v.servico_id);
    servicos = allServicos.filter(s => linkedSvcIds.includes(s.id));
  } else {
    // Non-admin with multiple CCs: show services from all linked CCs
    if (!isAdmin && currentUser.centro_custo_ids?.length > 1) {
      const linkedSvcIds = vinculosServicos
        .filter(v => currentUser.centro_custo_ids.includes(v.centro_custo_id))
        .map(v => v.servico_id);
      servicos = allServicos.filter(s => linkedSvcIds.includes(s.id));
    } else {
      servicos = allServicos;
    }
  }

  dropdown.innerHTML = '<button class="filter-dropdown-item" data-svc="all">Todos</button>';
  servicos.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'filter-dropdown-item';
    btn.dataset.svc = s.nome;
    btn.textContent = s.nome;
    dropdown.appendChild(btn);
  });
}

function populateCadenceFilter() {
  const dropdown = $('#cadenciaDropdown');
  if (!dropdown) return;

  dropdown.innerHTML = '<button class="filter-dropdown-item" data-cad="all">Todas</button>';
  getVisibleCadences().forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'filter-dropdown-item';
    btn.dataset.cad = c.id;
    btn.textContent = c.label;
    dropdown.appendChild(btn);
  });
}

function initCadenceFilter() {
  const btn = $('#cadenciaFilterBtn');
  const dropdown = $('#cadenciaDropdown');
  if (!btn || !dropdown) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    $$('.filter-dropdown').forEach(d => { if (d !== dropdown) d.classList.remove('open'); });
    dropdown.classList.toggle('open');
  });

  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.filter-dropdown-item');
    if (!item) return;
    e.stopPropagation();
    const val = item.dataset.cad || 'all';
    clienteCadenceFilter = val;
    dropdown.classList.remove('open');

    const label = val === 'all' ? 'Cadência' : (getVisibleCadences().find(c => c.id === val)?.label || 'Cadência');
    btn.innerHTML = `<i data-lucide="git-branch"></i> ${label} <i data-lucide="chevron-down"></i>`;
    initIcons();

    const badge = $('#activeFilterBadge');
    const badgeLabel = $('#activeFilterLabel');
    if (val !== 'all' && badge && badgeLabel) {
      badge.hidden = false;
      badge.style.display = '';
      badgeLabel.textContent = label;
    } else if (badge) {
      badge.hidden = true;
      badge.style.display = 'none!important';
    }
    renderClients();
  });
}

function populateEmpresaFilter() {
  const dropdown = $('#clienteCcDropdown');
  if (!dropdown) return;
  const isAdmin = isCurrentUserAdmin();
  const empresas = isAdmin
    ? centrosCustoData
    : centrosCustoData.filter(cc => currentUser.centro_custo_ids?.includes(cc.id));
  dropdown.innerHTML = (isAdmin || empresas.length > 1)
    ? '<button class="filter-dropdown-item" data-cc="all">Todas as Empresas</button>'
    : '';
  empresas.forEach(cc => {
    const btn = document.createElement('button');
    btn.className = 'filter-dropdown-item';
    btn.dataset.cc = cc.id;
    btn.textContent = cc.nome;
    dropdown.appendChild(btn);
  });
  // Se for membro com apenas uma empresa, já seleciona e atualiza o botão
  if (!isAdmin && empresas.length === 1) {
    const cc = empresas[0];
    clienteCcFilter = cc.id;
    const btn = $('#clienteCcFilterBtn');
    if (btn) {
      btn.innerHTML = `<i data-lucide="building-2"></i> ${cc.nome} <i data-lucide="chevron-down"></i>`;
      initIcons();
    }
  }
}

function initEmpresaFilter() {
  console.log('[CC Filter] initEmpresaFilter() chamada');
  const btn = $('#clienteCcFilterBtn');
  const dropdown = $('#clienteCcDropdown');
  if (!btn || !dropdown) {
    console.warn('[CC Filter] Elementos não encontrados:', { btn: !!btn, dropdown: !!dropdown });
    return;
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    console.log('[CC Filter] Botão Empresa clicado, open class:', dropdown.classList.contains('open'));
    $$('.filter-dropdown').forEach(d => { if (d !== dropdown) d.classList.remove('open'); });
    dropdown.classList.toggle('open');
  });

  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.filter-dropdown-item');
    if (!item) return;
    e.stopPropagation();
    const val = item.dataset.cc || 'all';
    clienteCcFilter = val;
    dropdown.classList.remove('open');

    const label = val === 'all' ? 'Empresa' : (centrosCustoData.find(cc => cc.id === val)?.nome || 'Empresa');
    btn.innerHTML = `<i data-lucide="building-2"></i> ${label} <i data-lucide="chevron-down"></i>`;
    initIcons();

    const badge = $('#activeFilterBadge');
    const badgeLabel = $('#activeFilterLabel');
    if (val !== 'all' && badge && badgeLabel) {
      badge.hidden = false;
      badge.style.display = '';
      badgeLabel.textContent = label;
    } else if (badge) {
      badge.hidden = true;
      badge.style.display = 'none!important';
    }
    populateServiceFilter();
    renderClients();
  });
}

let clienteSearchQuery = '';
let clienteServiceFilter = 'all';
let clienteCadenceFilter = 'all';
let clienteCcFilter = 'all';
let clienteViewMode = 'grid';

function getFilteredClients() {
  const q = clienteSearchQuery.toLowerCase().trim();
  const canViewAll = canViewAllData();
  const userId = getCurrentUserId();
  
  return clientsData.filter(c => {
    if (q && !c.name.toLowerCase().includes(q) && !c.cnpj.includes(q)) return false;
    if (clienteServiceFilter !== 'all' && !c.services.includes(clienteServiceFilter)) return false;
    if (clienteCadenceFilter !== 'all' && c._cadenciaId !== clienteCadenceFilter) return false;
    if (clienteCcFilter !== 'all' && c._centroCustoId !== clienteCcFilter) return false;
    
    // Se não é admin, filtrar apenas clientes do próprio usuário (membro_id, qualificador_id, owner_id)
    if (!canViewAll && userId) {
      const membroId = c._membroId || c._ownerId;
      const qualificadorId = c._qualificadorId;
      if (membroId === userId || qualificadorId === userId) return true;
      return false;
    }
    return true;
  });
}

function formatEventDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function clientCardHTML(c) {
  const st = statusMap[c.status];
  const evDate = formatEventDate(c.eventDate);
  const svcBadges = c.services.slice(0, MAX_SERVICES_CARD).map(s =>
    `<span class="lead-card-svc-badge" aria-label="Serviço: ${s}">${s}</span>`
  ).join('');
  const overflow = c.services.length - MAX_SERVICES_CARD;
  const more = overflow > 0
    ? `<span class="lead-card-svc-more" tabindex="0" role="button" aria-label="Mais ${overflow} serviço${overflow > 1 ? 's' : ''}" title="${c.services.slice(MAX_SERVICES_CARD).join(', ')}">+${overflow}</span>`
    : '';
  const isAdmin = isCurrentUserAdmin();
  const isSelected = selectedClientIds.has(String(c.id));
  const checkboxHtml = isAdmin
    ? `<label class="client-select-label" onclick="event.stopPropagation()">
        <input type="checkbox" class="client-select-cb" data-client-id="${c.id}" ${isSelected ? 'checked' : ''} />
       </label>`
    : '';
  const transferSelectHtml = isAdmin
    ? `<div class="client-transfer-select-wrap" onclick="event.stopPropagation()">
        <label class="client-transfer-label">Transferir para:</label>
        <select class="client-transfer-select" data-client-id="${c.id}">
          <option value="">Selecionar membro...</option>
        </select>
       </div>`
    : '';
  return `
    <article class="client-card${isSelected ? ' selected' : ''}${isAdmin ? ' has-admin-actions' : ''}" data-name="${c.name}" data-client-id="${c.id}" tabindex="0"
             aria-label="${c.name}${c.services.length ? ', ' + c.services.length + ' serviço' + (c.services.length > 1 ? 's' : '') : ''}">
      ${checkboxHtml}
      ${transferSelectHtml}
      <div class="client-card-head">
        <div class="avatar ${c.avatar}">${c.initials}</div>
        <div class="client-card-info">
          <p class="client-card-name">${c.name}</p>
        </div>
      </div>
      <div class="client-card-meta">
        <div class="row">
          <span class="lbl">Serviço</span>
          <span class="val client-card-svc-val">${svcBadges || '—'}${more}</span>
        </div>
        <div class="row">
          <span class="lbl">Data do Evento</span>
          <span class="val">${evDate}</span>
        </div>
        ${c._membroNome ? `<div class="lead-card-member-badge"><i data-lucide="user"></i> ${c._membroNome}</div>` : ''}
      </div>
    </article>
  `;
}

function removeClientService(clientName, svcName) {
  const client = clientsData.find(c => c.name === clientName);
  if (!client) return;
  const idx = client.services.indexOf(svcName);
  if (idx === -1) return;
  client.services.splice(idx, 1);
  renderClients();
  toast(`Serviço removido — <button class="toast-undo" data-undo-svc="${svcName}" data-undo-client="${clientName}">Desfazer</button>`);
  setTimeout(() => {
    document.querySelectorAll('.toast-undo').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = clientsData.find(cl => cl.name === btn.dataset.undoClient);
        if (c && !c.services.includes(btn.dataset.undoSvc)) {
          c.services.push(btn.dataset.undoSvc);
          renderClients();
          toast('Serviço restaurado');
        }
      });
    });
  }, 50);
}

function removeLeadService(leadId, svcName) {
  const lead = leads.find(l => String(l.id) === String(leadId));
  if (!lead) return;
  const allSvc = normalizeServices(lead.servicos);
  const idx = allSvc.indexOf(svcName);
  if (idx === -1) return;
  allSvc.splice(idx, 1);
  lead.servicos = allSvc;
  renderAll();
  toast(`Serviço removido — <button class="toast-undo" data-undo-svc="${svcName}" data-undo-lead="${leadId}">Desfazer</button>`);
  setTimeout(() => {
    document.querySelectorAll('.toast-undo').forEach(btn => {
      btn.addEventListener('click', () => {
        const l = leads.find(ld => String(ld.id) === String(btn.dataset.undoLead));
        if (l) {
          const svc = normalizeServices(l.servicos);
          if (!svc.includes(btn.dataset.undoSvc)) {
            svc.push(btn.dataset.undoSvc);
            l.servicos = svc;
            renderAll();
            toast('Serviço restaurado');
          }
        }
      });
    });
  }, 50);
}

let _clientsLoaded = false;

function renderClients() {
  const grid = $('#clientGrid');
  if (!grid) return;

  if (clientsData.length === 0) {
    if (!_clientsLoaded) {
      grid.innerHTML = `
        <div class="client-loading">
          <div class="skeleton-card"></div>
          <div class="skeleton-card"></div>
          <div class="skeleton-card"></div>
          <div class="skeleton-card"></div>
          <div class="skeleton-card"></div>
          <div class="skeleton-card"></div>
        </div>
      `;
      const summary = $('#clienteBaseSummary');
      if (summary) summary.innerHTML = '<p class="summary-text">Carregando clientes...</p>';
    } else {
      grid.innerHTML = `
        <div class="empty-state">
          <i data-lucide="users"></i>
          <p>Nenhum cliente encontrado</p>
        </div>
      `;
      const summary = $('#clienteBaseSummary');
      if (summary) summary.innerHTML = '<p class="summary-text">0 clientes encontrados</p>';
      if (window.initIcons) initIcons();
    }
    return;
  }

  const filtered = getFilteredClients();
  grid.innerHTML = filtered.map(c => clientCardHTML(c)).join('');
  grid.classList.toggle('client-grid-list', clienteViewMode === 'list');
  initIcons();

  $$('.client-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.client-select-label') || e.target.closest('.client-transfer-select-wrap')) return;
      openClientInLeadModal(card);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!e.target.closest('.client-select-label') && !e.target.closest('.client-transfer-select-wrap')) {
          openClientInLeadModal(card);
        }
      }
    });
  });

  // Bind checkboxes
  $$('.client-select-cb').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      const clientId = String(cb.dataset.clientId);
      if (cb.checked) {
        selectedClientIds.add(clientId);
      } else {
        selectedClientIds.delete(clientId);
      }
      const card = cb.closest('.client-card');
      if (card) card.classList.toggle('selected', cb.checked);
      updateMassBar();
    });
  });

  // Bind per-card transfer selects (admin only)
  $$('.client-transfer-select').forEach(sel => {
    const clientId = sel.dataset.clientId;
    const client = clientsData.find(c => String(c.id) === String(clientId));
    const currentMembroId = client?._membroId || null;
    populateClientTransferSelect(sel, currentMembroId);
    sel.addEventListener('change', (e) => {
      e.stopPropagation();
      const memberId = sel.value;
      if (!memberId) return;
      transferSingleClient(clientId, memberId);
    });
  });

  // Close filter dropdowns on outside click (only once)
  if (!window._transferDropdownListenerBound) {
    document.addEventListener('click', () => {
      $$('.filter-dropdown').forEach(d => d.classList.remove('open'));
    });
    window._transferDropdownListenerBound = true;
  }

  const summary = $('#clienteBaseSummary');
  if (summary) {
    summary.innerHTML = `<p class="summary-text">${filtered.length} cliente${filtered.length !== 1 ? 's' : ''} encontrado${filtered.length !== 1 ? 's' : ''}</p>`;
  }

  updateMassBar();
  bindClientMassBar();
  window._clientsInited = true;
}

/* ============================================
   CLIENTES · TRANSFERÊNCIA (individual + massa)
   ============================================ */

function populateClientTransferSelect(sel, currentMembroId) {
  if (!_membersCache) {
    _supabase.from('membros')
      .select('id, nome, email')
      .eq('status', 'Ativo')
      .order('nome')
      .then(({ data, error }) => {
        if (!error && data) {
          _membersCache = data;
          fillMemberOptions(sel, currentMembroId);
        }
      });
  } else {
    fillMemberOptions(sel, currentMembroId);
  }
}

function fillMemberOptions(sel, currentMembroId) {
  if (!_membersCache || !sel) return;
  sel.innerHTML = '<option value="">Selecionar membro...</option>';
  _membersCache.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.nome + (m.email ? ' (' + m.email + ')' : '');
    if (String(m.id) === String(currentMembroId)) opt.selected = true;
    sel.appendChild(opt);
  });
}

async function transferSingleClient(clientId, memberId) {
  if (!isCurrentUserAdmin()) { toast('Apenas administradores podem transferir leads', 'error'); return; }
  const member = _membersCache?.find(m => m.id === memberId);
  const memberName = member?.nome || 'Membro';

  try {
    const { error } = await _supabase.from('leads')
      .update({ membro_id: memberId })
      .eq('id', String(clientId));

    if (error) throw error;

    const client = clientsData.find(c => String(c.id) === String(clientId));
    if (client) {
      client._membroId = memberId;
    }

    selectedClientIds.delete(String(clientId));
    toast(`Cliente transferido para ${memberName}`);
    renderClients();
  } catch (err) {
    console.error('[Transfer] Erro ao transferir cliente:', err);
    toast(err.message || 'Erro ao transferir cliente', 'error');
  }
}

function updateMassBar() {
  const bar = $('#clientMassBar');
  const countEl = $('#massBarCount');
  const selectAllWrap = $('#selectAllWrap');
  const selectAllCb = $('#selectAllClients');
  if (!bar) return;

  const isAdmin = isCurrentUserAdmin();

  if (selectAllWrap) selectAllWrap.style.display = isAdmin ? '' : 'none';

  if (!isAdmin || selectedClientIds.size === 0) {
    bar.hidden = true;
    if (selectAllCb) selectAllCb.checked = false;
    return;
  }

  bar.hidden = false;
  if (countEl) countEl.textContent = `${selectedClientIds.size} LEAD(S) SELECIONADO(S)`;

  const filtered = getFilteredClients();
  if (selectAllCb) {
    selectAllCb.checked = filtered.length > 0 && filtered.every(c => selectedClientIds.has(String(c.id)));
  }

  const memberSelect = $('#massNewMember');
  const qualSelect = $('#massNewQualificador');
  if (_membersCache) {
    if (memberSelect && memberSelect.options.length <= 1) populateBarSelect(memberSelect);
    if (qualSelect && qualSelect.options.length <= 1) populateBarSelect(qualSelect);
  } else {
    if (memberSelect && memberSelect.options.length <= 1) loadMembersForClientBar(memberSelect);
    if (qualSelect && qualSelect.options.length <= 1) loadMembersForClientBar(qualSelect);
  }

  const saveBtn = $('#massTransferBtn');
  if (saveBtn) {
    const hasAction = !!(memberSelect?.value || qualSelect?.value || $('#massLostReason')?.value);
    saveBtn.disabled = !hasAction;
    if (memberSelect) memberSelect.onchange = updateSaveBtnState;
    if (qualSelect) qualSelect.onchange = updateSaveBtnState;
    const lostSel = $('#massLostReason');
    if (lostSel) lostSel.onchange = updateSaveBtnState;
  }

  initIcons();
}

function updateSaveBtnState() {
  const saveBtn = $('#massTransferBtn');
  if (!saveBtn) return;
  const memberSelect = $('#massNewMember');
  const qualSelect = $('#massNewQualificador');
  const lostSel = $('#massLostReason');
  const hasAction = !!(memberSelect?.value || qualSelect?.value || lostSel?.value);
  saveBtn.disabled = !hasAction;
}

function populateBarSelect(sel) {
  if (!_membersCache || !sel) return;
  sel.innerHTML = '<option value="">Selecionar...</option>';
  _membersCache.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.nome + (m.email ? ' (' + m.email + ')' : '');
    sel.appendChild(opt);
  });
}

async function loadMembersForClientBar(select) {
  if (!_supabase) return;
  try {
    const { data, error } = await _supabase.from('membros')
      .select('id, nome, email')
      .eq('status', 'Ativo')
      .order('nome');
    if (error || !data) return;
    _membersCache = data;
    populateBarSelect(select);
  } catch (err) {
    console.error('[ClientBar] Erro ao buscar membros:', err);
  }
}

function bindClientMassBar() {
  if (_clientMassBarBound) return;
  _clientMassBarBound = true;

  const saveBtn = $('#massTransferBtn');
  const deleteBtn = $('#massDeleteBtn');
  const cancelBtn = $('#massTransferCancel');
  const selectAllCb = $('#selectAllClients');

  if (saveBtn) saveBtn.addEventListener('click', saveMassTransfer);
  if (deleteBtn) deleteBtn.addEventListener('click', deleteMassLeads);
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      selectedClientIds.clear();
      renderClients();
    });
  }

  if (selectAllCb) {
    selectAllCb.addEventListener('change', () => {
      const filtered = getFilteredClients();
      if (selectAllCb.checked) {
        filtered.forEach(c => selectedClientIds.add(String(c.id)));
      } else {
        filtered.forEach(c => selectedClientIds.delete(String(c.id)));
      }
      renderClients();
    });
  }
}

async function saveMassTransfer() {
  if (!isCurrentUserAdmin()) { toast('Apenas administradores podem transferir leads', 'error'); return; }
  const memberSelect = $('#massNewMember');
  const qualSelect = $('#massNewQualificador');
  const lostSel = $('#massLostReason');
  const memberId = memberSelect?.value || null;
  const qualId = qualSelect?.value || null;
  const lostReason = lostSel?.value || null;
  if (!memberId && !qualId && !lostReason) return;
  if (selectedClientIds.size === 0) return;

  const ids = [...selectedClientIds];
  const saveBtn = $('#massTransferBtn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i data-lucide="loader"></i> <span>Salvando...</span>';
    initIcons();
  }

  try {
    let member = null;
    const updates = {};
    if (memberId) {
      updates.membro_id = memberId;
      member = _membersCache?.find(m => m.id === memberId);
    }
    if (lostReason) updates.status = lostReason;

    if (Object.keys(updates).length > 0) {
      const { error } = await _supabase.from('leads')
        .update(updates)
        .in('id', ids);
      if (error) throw error;
    }

    if (qualId) {
      const { error: qualErr } = await _supabase.from('leads')
        .update({ qualificador_id: qualId })
        .in('id', ids);
      if (qualErr) console.warn('[MassTransfer] Erro ao atualizar qualificador:', qualErr);
    }

    ids.forEach(id => {
      const client = clientsData.find(c => String(c.id) === String(id));
      if (client) {
        if (memberId) {
          client._membroId = memberId;
        }
      }
    });

    const parts = [];
    if (memberId) parts.push('membro');
    if (qualId) parts.push('qualificador');
    if (lostReason) parts.push(`status: ${lostReason}`);

    selectedClientIds.clear();
    toast(`${ids.length} lead(s) atualizado(s) — ${parts.join(', ')}`);
    if (memberSelect) memberSelect.value = '';
    if (qualSelect) qualSelect.value = '';
    if (lostSel) lostSel.value = '';
    renderClients();
  } catch (err) {
    console.error('[MassTransfer] Erro ao salvar:', err);
    toast(err.message || 'Erro ao salvar alterações', 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i data-lucide="check"></i> <span>Salvar</span>';
      initIcons();
    }
  }
}

async function deleteMassLeads() {
  if (selectedClientIds.size === 0) return;
  const ids = [...selectedClientIds];
  const confirmed = confirm(`Tem certeza que deseja excluir ${ids.length} lead(s)? Esta ação não pode ser desfeita.`);
  if (!confirmed) return;

  const deleteBtn = $('#massDeleteBtn');
  if (deleteBtn) {
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '<i data-lucide="loader"></i> <span>Excluindo...</span>';
    initIcons();
  }

  try {
    const { error } = await _supabase.from('leads')
      .delete()
      .in('id', ids);
    if (error) throw error;

    clientsData = clientsData.filter(c => !ids.includes(String(c.id)));
    selectedClientIds.clear();
    toast(`${ids.length} lead(s) excluído(s)`);
    renderClients();
    populateServiceFilter();
    populateCadenceFilter();
  } catch (err) {
    console.error('[MassDelete] Erro ao excluir:', err);
    toast(err.message || 'Erro ao excluir leads', 'error');
  } finally {
    if (deleteBtn) {
      deleteBtn.disabled = false;
      deleteBtn.innerHTML = '<i data-lucide="trash-2"></i> <span>Excluir Lead</span>';
      initIcons();
    }
  }
}

function openClientInLeadModal(card) {
  const name = card.dataset.name;
  const client = clientsData.find(c => c.name === name);
  if (!client) return;

  currentLeadId = client.id || null;

  const modal = $('#leadModal');
  modal.classList.remove('is-new');
  modal.dataset.mode = 'client-view';

  const initials = client.initials;
  $('#leadModalAvatar').textContent = initials;
  $('#leadModalTitle').textContent = client.name;
  $('#leadModalCreated').textContent = client.cnpj || 'Cliente da base';
  $('#leadModalMetaCreate').textContent = client.cnpj || 'Cliente da base';
  $('#leadModalMetaLast').textContent = '—';
  $('#leadModalLastTouch').textContent = '—';

  const thermal = client.thermal || 'frio';
  const tag = $('#leadModalThermal');
  tag.textContent = thermal.charAt(0).toUpperCase() + thermal.slice(1);
  tag.className = 'thermal-tag ' + thermal;

  const fullLead = leads.find(l => String(l.id) === String(client.id));
  const telefone = fullLead ? (fullLead.telefone || '') : (client.telefone || '');
  const enderecoEvento = fullLead ? (fullLead.enderecoEvento || '') : (client.enderecoEvento || '');
  const quantidadeHoras = fullLead ? (fullLead.quantidadeHoras || '') : (client.quantidadeHoras || '');
  const observacoes = fullLead ? (fullLead.observacoes || '') : (client.observacoes || '');
  const honorariosVal = fullLead ? (fullLead.honorarios || 0) : (client.honorarios || 0);

  const formFields = $$('#leadModal [name]');
  formFields.forEach(el => {
    if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = false;
    } else if (el.name === 'empresa') {
      el.value = client.name;
    } else if (el.name === 'telefone') {
      el.value = telefone;
    } else if (el.name === 'dataEvento') {
      el.value = client.eventDate || '';
    } else if (el.name === 'enderecoEvento') {
      el.value = enderecoEvento;
    } else if (el.name === 'quantidadeHoras') {
      el.value = quantidadeHoras;
    } else if (el.name === 'honorarios') {
      el.value = '';
    } else if (el.name === 'thermal') {
      el.value = thermal;
    } else if (el.name === 'observacoes') {
      el.value = observacoes;
    } else {
      el.value = '';
    }
  });

  const thermalSel = $('#leadThermal');
  if (thermalSel) {
    thermalSel.value = thermal;
    thermalSel.onchange = () => {
      const v = thermalSel.value;
      tag.textContent = v.charAt(0).toUpperCase() + v.slice(1);
      tag.className = 'thermal-tag ' + v;
    };
  }

  bindHonMask();

  const svcNames = client.services || [];
  $$('.chip-group .chip-toggle').forEach(chip => {
    const chipVal = chip.dataset.value;
    chip.classList.toggle('active', svcNames.includes(chipVal));
  });

  const cadenceIdx = cadences.findIndex(c => c.id === 'contrato-fechado');
  $$('.journey-step').forEach((step, i) => {
    step.classList.remove('done', 'active');
    if (i < cadenceIdx) step.classList.add('done');
    else if (i === cadenceIdx) step.classList.add('active');
  });

  switchLeadTab('edit');
  renderLeadHistory({
    createdAt: client.eventDate ? `Evento em ${formatEventDate(client.eventDate)}` : '—',
    history: [
      { icon: 'user-check', title: 'Cliente na base', meta: 'Dados cadastrais', desc: `${svcNames.length} serviço(s) vinculado(s)` },
      ...(honorariosVal > 0 ? [{ icon: 'banknote', title: 'Valor de Faturamento definido', meta: `R$ ${honorariosVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, desc: '' }] : [])
    ]
  });

  modal.classList.add('open');
  $('#leadModalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  initIcons();
}

function closeDrawer() {
  $('#drawerOverlay').classList.remove('open');
  $('#clientDrawer').classList.remove('open');
}

/* ============================================
   CALENDÁRIO · MEETINGS (fonte única de verdade)
   Sincronizado com Dashboard · Lembrete de Reunião
   ============================================ */
let meetings = [];

function meetingColor(type) {
  return ({
    reuniao:     '#165BFF',
    casamento:   '#165BFF',
    festa15:     '#a855f7',
    aniversario: '#f59e0b',
    corporativo: '#10b981',
    evento:      '#2F80ED',
    fiscal:      '#f59e0b',
    financeiro:  '#10b981',
    implantacao: '#a855f7',
    vencimento:  '#ef4444'
  })[type] || '#165BFF';
}

function meetingTypeLabel(type) {
  return ({
    casamento:    'Casamento',
    festa15:      'Festa de 15 anos',
    aniversario:  'Aniversário',
    corporativo:  'Corporativo',
    evento:       'Evento'
  })[type] || 'Outro';
}

// calendarEvents é derivado de meetings (mantém grid do calendário funcionando)
/* ============================================
   CALENDAR STATE + NAVIGATION + VIEWS
   ============================================ */
let calView = (sessionStorage.getItem('calViewMode') || 'month'); // day | week | month
let calCurrentDate = new Date();  // always tracks the "focus" date
let calNavBusy = false;
let calEmpresaFilter = 'all';     // empresa filter for calendar

let calendarEvents = {};
function rebuildCalendarEvents() {
  calendarEvents = {};
  meetings.forEach(m => {
    if (!calendarEvents[m.iso]) calendarEvents[m.iso] = [];
    calendarEvents[m.iso].push({ id: m.id, color: m.color || meetingColor(m.type), title: m.title });
  });
}
rebuildCalendarEvents();

function getFilteredMeetings() {
  if (calEmpresaFilter === 'all') return meetings;
  return meetings.filter(m => {
    if (m.empresa_id && String(m.empresa_id) === String(calEmpresaFilter)) return true;
    if (!m.leadId) return false;
    const lead = leads.find(l => String(l.id) === String(m.leadId));
    return lead && String(lead._centroCustoId) === String(calEmpresaFilter);
  });
}

const MONTH_NAMES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const WEEKDAY_HEADERS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const HOUR_LABELS = Array.from({length:24},(_,i)=>`${String(i).padStart(2,'0')}:00`);

function getTodayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function isoFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function updateCalTitle() {
  const el = $('#calTitle');
  if (!el) return;
  if (calView === 'day') {
    el.textContent = `${calCurrentDate.getDate()} de ${MONTH_NAMES_PT[calCurrentDate.getMonth()]} ${calCurrentDate.getFullYear()}`;
  } else if (calView === 'week') {
    const startOfWeek = getWeekStart(calCurrentDate);
    const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(endOfWeek.getDate()+6);
    if (startOfWeek.getMonth() === endOfWeek.getMonth()) {
      el.textContent = `${startOfWeek.getDate()}–${endOfWeek.getDate()} de ${MONTH_NAMES_PT[startOfWeek.getMonth()]} ${startOfWeek.getFullYear()}`;
    } else {
      el.textContent = `${MONTH_NAMES_PT[startOfWeek.getMonth()].slice(0,3)} ${startOfWeek.getDate()} – ${MONTH_NAMES_PT[endOfWeek.getMonth()].slice(0,3)} ${endOfWeek.getDate()} ${endOfWeek.getFullYear()}`;
    }
  } else {
    el.textContent = `${MONTH_NAMES_PT[calCurrentDate.getMonth()]} ${calCurrentDate.getFullYear()}`;
  }
}

function getWeekStart(d) {
  const r = new Date(d);
  r.setDate(r.getDate() - r.getDay()); // Sunday
  return r;
}

function setCalView(mode) {
  calView = mode;
  sessionStorage.setItem('calViewMode', mode);
  document.querySelectorAll('.cal-views .seg').forEach(b => {
    const isActive = b.dataset.view === mode;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-selected', isActive);
  });
  renderCalendar();
}

function calNavDebounced(fn) {
  if (calNavBusy) return;
  calNavBusy = true;
  fn();
  setTimeout(() => { calNavBusy = false; }, 200);
}

function calPrev() {
  calNavDebounced(() => {
    if (calView === 'month') {
      calCurrentDate.setMonth(calCurrentDate.getMonth() - 1);
    } else if (calView === 'week') {
      calCurrentDate.setDate(calCurrentDate.getDate() - 7);
    } else {
      calCurrentDate.setDate(calCurrentDate.getDate() - 1);
    }
    renderCalendar();
  });
}

function calNext() {
  calNavDebounced(() => {
    if (calView === 'month') {
      calCurrentDate.setMonth(calCurrentDate.getMonth() + 1);
    } else if (calView === 'week') {
      calCurrentDate.setDate(calCurrentDate.getDate() + 7);
    } else {
      calCurrentDate.setDate(calCurrentDate.getDate() + 1);
    }
    renderCalendar();
  });
}

function calGoToday() {
  calCurrentDate = new Date();
  renderCalendar();
}

/* ---- RENDER ---- */

function initCalEmpresaFilter() {
  const select = document.getElementById('calEmpresaFilter');
  if (!select) return;

  const isAdmin = isCurrentUserAdmin();
  const empresas = isAdmin
    ? centrosCustoData
    : centrosCustoData.filter(cc => currentUser.centro_custo_ids?.includes(cc.id));

  select.innerHTML = '<option value="all">Todas as Empresas</option>';
  empresas.forEach(cc => {
    const opt = document.createElement('option');
    opt.value = cc.id;
    opt.textContent = cc.nome;
    select.appendChild(opt);
  });

  if (!isAdmin && empresas.length === 1) {
    calEmpresaFilter = empresas[0].id;
    select.value = empresas[0].id;
  }

  if (!select._calEmpresaBound) {
    select._calEmpresaBound = true;
    select.addEventListener('change', () => {
      calEmpresaFilter = select.value;
      renderCalendar();
      renderCalUpcoming();
    });
  }
}

function renderCalendar() {
  const grid = $('#calGrid');
  const weekdays = $('#calWeekdays');
  if (!grid) return;

  updateCalTitle();

  const filteredMs = getFilteredMeetings();
  const filteredEvents = {};
  filteredMs.forEach(m => {
    if (!filteredEvents[m.iso]) filteredEvents[m.iso] = [];
    filteredEvents[m.iso].push({ id: m.id, color: m.color || meetingColor(m.type), title: m.title });
  });

  if (calView === 'month') renderMonthView(grid, weekdays, filteredEvents);
  else if (calView === 'week') renderWeekView(grid, weekdays, filteredEvents, filteredMs);
  else renderDayView(grid, weekdays, filteredEvents, filteredMs);
}

/* -- Month View -- */
function renderMonthView(grid, weekdays, eventsMap) {
  weekdays.style.display = '';
  const y = calCurrentDate.getFullYear();
  const m = calCurrentDate.getMonth();
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevMonthDays = new Date(y, m, 0).getDate();
  const todayIso = getTodayIso();

  const cells = [];
  for (let i = firstDay; i > 0; i--) cells.push({ day: prevMonthDays - i + 1, other: true, iso: '' });
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells.push({ day: d, other: false, iso });
  }
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) cells.push({ day: d, other: true, iso: '' });

  grid.className = 'cal-grid';
  grid.innerHTML = cells.map(c => {
    const isToday = c.iso === todayIso;
    const events = c.iso ? (eventsMap || calendarEvents)[c.iso] || [] : [];
    const eventsHtml = events.map(e =>
      `<span class="cal-event" role="button" tabindex="0" data-iso="${c.iso}" data-meeting-id="${e.id}" style="background:${e.color}">${e.title}</span>`
    ).join('');
    return `<div class="cal-day ${c.other ? 'other-month' : ''} ${isToday ? 'today' : ''}" role="button" tabindex="0" data-iso="${c.iso}">
      <span class="cal-day-num">${c.day}</span>${eventsHtml}</div>`;
  }).join('');
}

/* -- Week View -- */
function renderWeekView(grid, weekdays, eventsMap, ms) {
  weekdays.style.display = 'none';
  const weekStart = getWeekStart(calCurrentDate);
  const todayIso = getTodayIso();
  const hours = HOUR_LABELS;

  grid.className = 'cal-grid cal-grid-week';
  let html = '<div class="cal-week-header"><div class="cal-week-time-gutter"></div>';
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart); d.setDate(d.getDate()+i);
    const iso = isoFromDate(d);
    const isToday = iso === todayIso;
    html += `<div class="cal-week-day-head ${isToday ? 'today' : ''}">${WEEKDAY_HEADERS[i]} ${d.getDate()}</div>`;
  }
  html += '</div><div class="cal-week-body">';

  const evtSource = eventsMap || calendarEvents;
  const meetingSource = ms || meetings;

  for (const h of hours) {
    html += `<div class="cal-week-row"><div class="cal-week-time-gutter">${h}</div>`;
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart); d.setDate(d.getDate()+i);
      const iso = isoFromDate(d);
      const hourNum = parseInt(h);
      const evts = (evtSource[iso] || []).filter(e => {
        const meeting = meetingSource.find(m => iso === m.iso && m.title === e.title);
        if (!meeting || !meeting.time) return hourNum === 9;
        return parseInt(meeting.time.split(':')[0]) === hourNum;
      });
      const evtHtml = evts.map(e => `<span class="cal-event cal-event-week" role="button" tabindex="0" data-iso="${iso}" data-meeting-id="${e.id}" style="background:${e.color}">${e.title}</span>`).join('');
      html += `<div class="cal-week-cell" role="button" tabindex="0" data-iso="${iso}" data-hour="${hourNum}">${evtHtml}</div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  grid.innerHTML = html;
}

/* -- Day View -- */
function renderDayView(grid, weekdays, eventsMap, ms) {
  weekdays.style.display = 'none';
  const iso = isoFromDate(calCurrentDate);
  const evtSource = eventsMap || calendarEvents;
  const events = evtSource[iso] || [];
  const meetingSource = ms || meetings;
  const hours = HOUR_LABELS;

  grid.className = 'cal-grid cal-grid-day';
  let html = '<div class="cal-day-header">' + WEEKDAY_HEADERS[calCurrentDate.getDay()] + ' ' + calCurrentDate.getDate() + '</div><div class="cal-day-body">';
  for (const h of hours) {
    const hourNum = parseInt(h);
    const evts = events.filter(e => {
      const meeting = meetingSource.find(m => m.iso === iso && m.title === e.title);
      if (!meeting || !meeting.time) return hourNum === 9;
      return parseInt(meeting.time.split(':')[0]) === hourNum;
    });
    const evtHtml = evts.map(e => `<span class="cal-event cal-event-day" role="button" tabindex="0" data-iso="${iso}" data-meeting-id="${e.id}" style="background:${e.color}">${e.title}</span>`).join('');
    html += `<div class="cal-day-row"><div class="cal-week-time-gutter">${h}</div><div class="cal-week-cell" role="button" tabindex="0" data-iso="${iso}" data-hour="${hourNum}">${evtHtml}</div></div>`;
  }
  html += '</div>';
  grid.innerHTML = html;
}

/* ============================================
   CHARTS (DASHBOARD)
   ============================================ */
function buildHatch(ctx, color) {
  // Cria um pattern com listras diagonais (dias inativos)
  const c = document.createElement('canvas');
  const size = 8;
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-2, size + 2); g.lineTo(size + 2, -2);
  g.moveTo(-2, -2);       g.lineTo(size + 2, size + 2);
  g.stroke();
  return ctx.createPattern(c, 'repeat');
}

function initCharts() {
  // Project Analytics (bar com hatching para dias inativos)
  const ctx1 = document.getElementById('chartClientes');
  if (ctx1) {
    const ctx = ctx1.getContext('2d');
    const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    const data   = [12, 18, 0, 22, 16, 0, 8];  // Sáb e Dom = inativos
    const activeIdx = data.indexOf(Math.max(...data));

    const hatch = buildHatch(ctx, '#C8D6FF');

    // Cor: ativo = primary-blue, destaque = primary-blue-dark, inativo = hatch
    const bg = data.map((v, i) => {
      if (v === 0) return hatch;
      if (i === activeIdx) return '#0044D6';     // primary-blue-dark
      return '#165BFF';                          // primary-blue
    });

    new Chart(ctx1, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Atividade',
          data,
          backgroundColor: bg,
          borderColor: 'transparent',
          borderWidth: 0,
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 32,
          categoryPercentage: 0.7,
          barPercentage: 0.8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0F172A',
            padding: 10,
            cornerRadius: 8,
            titleColor: '#fff',
            bodyColor: '#E2E8F0',
            titleFont: { family: 'Inter', weight: '600', size: 12 },
            bodyFont:  { family: 'Inter', size: 12 },
            callbacks: {
              label: (c) => c.parsed.y === 0 ? 'Sem atividade' : `${c.parsed.y} entregas`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#6B7885', font: { family: 'Inter', size: 11 } }
          },
          y: {
            grid: { color: '#F1F4F8', drawBorder: false },
            ticks: { color: '#6B7885', font: { family: 'Inter', size: 11 }, stepSize: 5 },
            beginAtZero: true,
            suggestedMax: 25
          }
        }
      }
    });
  }

  // Project Progress (radial SVG) — animar traços
  animateRadial();

  window._chartsInited = true;
}

function animateRadial() {
  // 41% concluído, 35% em progresso, 24% pendente
  const fg  = document.getElementById('prFg');
  const mid = document.getElementById('prMid');
  if (!fg || !mid) return;

  const C = 2 * Math.PI * 60; // ~376.99
  const total = 41 + 35 + 24; // 100
  const dashFg  = C * (1 - (41 / 100));
  const dashMid = C * (1 - ((41 + 35) / 100));
  fg.style.strokeDashoffset  = String(dashFg);
  mid.style.strokeDashoffset = String(dashMid);

  // Re-dispara animação ao entrar
  [fg, mid].forEach(el => {
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  });
}

/* ============================================
   PROGRESS BARS · ANIMAÇÃO
   ============================================ */
function animateProgressBars() {
  $$('.metric-bar > span[data-width]').forEach(bar => {
    const target = bar.getAttribute('data-width');
    bar.style.width = '0';
    requestAnimationFrame(() => {
      setTimeout(() => { bar.style.width = target; }, 150);
    });
  });
}

/* ============================================
   INTERAÇÕES GERAIS
   ============================================ */
function initInteractions() {
  // Navegação sidebar
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      if (page) setActivePage(page);
    });
  });

  // Busca de clientes
  const clienteSearch = $('#clienteBaseSearch');
  if (clienteSearch) {
    let searchTimeout;
    clienteSearch.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        clienteSearchQuery = clienteSearch.value;
        renderClients();
      }, 180);
    });
  }

  // Dropdown de filtro por serviço
  const servicoBtn = $('#servicoFilterBtn');
  const servicoDropdown = $('#servicoDropdown');
  if (servicoBtn && servicoDropdown) {
    servicoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      $$('.filter-dropdown').forEach(d => { if (d !== servicoDropdown) d.classList.remove('open'); });
      servicoDropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => servicoDropdown.classList.remove('open'));

    servicoDropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.filter-dropdown-item');
      if (!item) return;
      e.stopPropagation();
      clienteServiceFilter = item.dataset.svc;
      servicoDropdown.classList.remove('open');
      const badge = $('#activeFilterBadge');
      const label = $('#activeFilterLabel');
      if (clienteServiceFilter === 'all') {
        badge.hidden = true;
        servicoBtn.innerHTML = '<i data-lucide="filter"></i> Tipo de Serviço <i data-lucide="chevron-down"></i>';
      } else {
        badge.hidden = true;
        servicoBtn.innerHTML = '<i data-lucide="filter"></i> ' + clienteServiceFilter + ' <i data-lucide="chevron-down"></i>';
      }
      initIcons();
      renderClients();
    });
  }

  const clearFilterBtn = $('#clearFilterBtn');
  if (clearFilterBtn) {
    clearFilterBtn.addEventListener('click', () => {
      clienteServiceFilter = 'all';
      clienteCadenceFilter = 'all';
      clienteCcFilter = 'all';
      $('#activeFilterBadge').hidden = true;
      const svcBtn = $('#servicoFilterBtn');
      if (svcBtn) {
        svcBtn.innerHTML = '<i data-lucide="filter"></i> Tipo de Serviço <i data-lucide="chevron-down"></i>';
      }
      const cadBtn = $('#cadenciaFilterBtn');
      if (cadBtn) {
        cadBtn.innerHTML = '<i data-lucide="git-branch"></i> Cadência <i data-lucide="chevron-down"></i>';
      }
      const ccBtn = $('#clienteCcFilterBtn');
      if (ccBtn) {
        ccBtn.innerHTML = '<i data-lucide="building-2"></i> Empresa <i data-lucide="chevron-down"></i>';
      }
      initIcons();
      renderClients();
    });
  }

  // View toggle (grid/list)
  $$('.vt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.vt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      clienteViewMode = btn.dataset.view || 'grid';
      renderClients();
    });
  });

  // Tabs do drawer
  $$('.d-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.d-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });

  // Settings nav
  $$('.settings-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      $$('.settings-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      const tab = link.dataset.settingsTab;
      if (tab) showSettingsTab(tab);
    });
  });

  // Drawer close
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerOverlay').addEventListener('click', closeDrawer);

  // Esc fecha drawer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });

  // Seg controls (calendário, dashboard)
  $$('.seg').forEach(s => {
    s.addEventListener('click', () => {
      const group = s.parentElement;
      $$('.seg', group).forEach(x => x.classList.remove('active'));
      s.classList.add('active');
    });
  });

  // Menu toggle (mobile) + swipe gestures
  initSidebarSwipe();

  // Time Tracker controls
  initTimeTracker();

  // Dark mode toggle
  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
}

/* ============================================
   SIDEBAR · SWIPE (mobile)
   ============================================ */
function initSidebarSwipe() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!sidebar) return;

  const menuToggle = document.querySelector('.menu-toggle');

  function isMobile() { return window.innerWidth <= 1024; }
  function isOpen() { return sidebar.classList.contains('open'); }

  function openSidebar() {
    sidebar.classList.add('open');
    overlay?.classList.add('open');
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay?.classList.remove('open');
  }

  // Menu hamburger abre/fecha
  menuToggle?.addEventListener('click', () => {
    if (isOpen()) closeSidebar(); else openSidebar();
  });

  // Pomodoro menu button
  const pomoMenu = document.getElementById('pomoMenuToggle');
  pomoMenu?.addEventListener('click', () => {
    if (isOpen()) closeSidebar(); else openSidebar();
  });

  // Clique no overlay fecha
  overlay?.addEventListener('click', closeSidebar);

  // ── Swipe ──
  let dragging = false;
  let startX = 0;
  let currentX = 0;
  let sidebarWidth = 0;
  let wasOpen = false;

  sidebar.addEventListener('touchstart', (e) => {
    if (!isMobile()) return;
    const touch = e.touches[0];
    const x = touch.clientX;
    sidebarWidth = sidebar.offsetWidth || 260;
    wasOpen = isOpen();

    // Abrir: toque na borda esquerda (sidebar fechada)
    if (!wasOpen && x <= 20) {
      dragging = true;
      startX = x;
      currentX = x;
      sidebar.classList.add('sidebar--dragging');
      return;
    }
    // Fechar: arrastar na sidebar (quando aberta)
    if (wasOpen) {
      dragging = true;
      startX = x;
      currentX = x;
      sidebar.classList.add('sidebar--dragging');
    }
  }, { passive: true });

  sidebar.addEventListener('touchmove', (e) => {
    if (!dragging || !isMobile()) return;
    const touch = e.touches[0];
    currentX = touch.clientX;
    const deltaX = currentX - startX;
    let tx;

    if (!wasOpen) {
      // Abrindo: de -100% até 0%
      const progress = Math.max(0, Math.min(1, deltaX / sidebarWidth));
      tx = (progress - 1) * sidebarWidth;
      sidebar.style.transform = `translateX(${tx}px)`;
      // Overlay acompanha
      if (overlay) overlay.style.opacity = progress * 0.45;
    } else {
      // Fechando: de 0 até -sidebarWidth
      const progress = Math.max(-1, Math.min(0, deltaX / sidebarWidth));
      tx = progress * sidebarWidth;
      sidebar.style.transform = `translateX(${tx}px)`;
      if (overlay) overlay.style.opacity = (1 + progress) * 0.45;
    }
  }, { passive: true });

  sidebar.addEventListener('touchend', () => {
    if (!dragging || !isMobile()) return;
    dragging = false;
    sidebar.classList.remove('sidebar--dragging');

    const deltaX = currentX - startX;
    const threshold = sidebarWidth * 0.3;

    if (!wasOpen) {
      if (deltaX > threshold) openSidebar(); else closeSidebar();
    } else {
      if (deltaX < -threshold) closeSidebar(); else openSidebar();
    }

    // Limpar inline styles
    sidebar.style.transform = '';
    if (overlay) overlay.style.opacity = '';
  });

  // Overlay: swipe para fechar (quando aberto, arrastar na overlay fecha)
  overlay?.addEventListener('touchstart', (e) => {
    if (!isMobile() || !isOpen()) return;
    const touch = e.touches[0];
    sidebarWidth = sidebar.offsetWidth || 260;
    dragging = true;
    wasOpen = true;
    startX = touch.clientX;
    currentX = startX;
    sidebar.classList.add('sidebar--dragging');
  }, { passive: true });

  overlay?.addEventListener('touchmove', (e) => {
    if (!dragging || !isMobile()) return;
    const touch = e.touches[0];
    currentX = touch.clientX;
    const deltaX = currentX - startX;
    if (deltaX < 0) {
      const progress = Math.max(-1, Math.min(0, deltaX / sidebarWidth));
      sidebar.style.transform = `translateX(${progress * sidebarWidth}px)`;
      if (overlay) overlay.style.opacity = (1 + progress) * 0.45;
    }
  }, { passive: true });

  overlay?.addEventListener('touchend', () => {
    if (!dragging || !isMobile()) return;
    dragging = false;
    sidebar.classList.remove('sidebar--dragging');
    const deltaX = currentX - startX;
    const threshold = sidebarWidth * 0.3;
    if (deltaX < -threshold) closeSidebar(); else openSidebar();
    sidebar.style.transform = '';
    if (overlay) overlay.style.opacity = '';
  });
}

/* ============================================
   TIME TRACKER
   ============================================ */
const tt = {
  hours: 2, minutes: 34, seconds: 18,
  running: true, interval: null,

  render() {
    const h = $('#ttHours'), m = $('#ttMinutes'), s = $('#ttSeconds');
    if (h) h.textContent = String(this.hours).padStart(2, '0');
    if (m) m.textContent = String(this.minutes).padStart(2, '0');
    if (s) s.textContent = String(this.seconds).padStart(2, '0');
  },

  tick() {
    this.seconds++;
    if (this.seconds >= 60) { this.seconds = 0; this.minutes++; }
    if (this.minutes >= 60) { this.minutes = 0; this.hours++; }
    this.render();
  },

  start() {
    if (this.interval) return;
    this.running = true;
    this.interval = setInterval(() => this.tick(), 1000);
    this._updateIcon();
  },

  pause() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    this.running = false;
    this._updateIcon();
  },

  toggle() {
    this.running ? this.pause() : this.start();
  },

  reset() {
    this.pause();
    this.hours = 0; this.minutes = 0; this.seconds = 0;
    this.render();
  },

  _updateIcon() {
    const btn = $('#ttPlayPause');
    if (!btn) return;
    const icon = btn.querySelector('[data-lucide]');
    if (icon) {
      icon.setAttribute('data-lucide', this.running ? 'pause' : 'play');
      if (window.lucide) lucide.createIcons();
    }
    btn.title = this.running ? 'Pausar' : 'Retomar';
  }
};

function initTimeTracker() {
  const playPause = $('#ttPlayPause');
  const stop      = $('#ttStop');
  const reset     = $('#ttReset');
  if (!playPause) return;

  tt.render();
  tt.start();

  playPause.addEventListener('click', () => tt.toggle());
  stop.addEventListener('click', () => tt.pause());
  reset.addEventListener('click', () => tt.reset());
}

/* ============================================
   CRM · DADOS
   ============================================ */
const cadences = [
  { id: 'novo-lead',           label: 'NOVO LEAD',                  short: 'Novo Lead' },
  { id: 'dados-ia',            label: 'DADOS IA',                  short: 'Dados IA' },
  { id: 'coletados-frio',      label: 'COLETADOS FRIOS',           short: 'Coletados Frios' },
  { id: 'qualificado',         label: 'QUALIFICADO IA',            short: 'Qualificado IA' },
  { id: 'em-atendimento',      label: 'AGUARDANDO RESPOSTA',       short: 'Aguardando Resposta' },
  { id: 'geladeira',           label: 'EM ATENDIMENTO',            short: 'Em Atendimento' },
  { id: 'stand-by',            label: 'FOLLOW-UP 1',               short: 'Follow-up 1' },
  { id: 'diagnostico-gratis',  label: 'FOLLOW-UP 2',               short: 'Follow-up 2' },
  { id: 'reuniao-agendada',    label: 'FOLLOW-UP 3',               short: 'Follow-up 3' },
  { id: 'reuniao-realizada',   label: 'FOLLOW-UP 4',               short: 'Follow-up 4' },
  { id: 'contrato-enviado',    label: 'CONTRATO ENVIADO',          short: 'Contrato Enviado' },
  { id: 'contrato-fechado',    label: 'PARCEIROS',                 short: 'Parceiros' },
  { id: 'cobranca-enviada',    label: 'STANDY-BY',                 short: 'Standy-by' },
  { id: 'pagamento-recebido',  label: 'GELADEIRA',                 short: 'Geladeira' },
  { id: 'servico-executado',   label: 'ACOMPANHAMENTO',            short: 'Acompanhamento' },
  { id: 'pos-vendas',          label: 'GERAÇÃO DE CONTRATO',       short: 'Geração de Contrato' }
];

// Mapeamento fixo: slug da coluna Kanban → UUID real da tabela cadencias no Supabase
// IMPORTANTE: Execute migration_novo_lead_cadencia.sql e substitua o UUID abaixo
const mapaCadencias = {
  "novo-lead":           "50dafcf2-00d1-491d-9297-98bf0906f5c4",
  "dados-ia":            "3cf00875-b5e8-471b-8dd7-c389f8c9d22a",
  "coletados-frio":      "509aa84e-5bcb-43f6-ba63-96ceee4adf3b",
  "qualificado":         "0ec70bba-f34b-4658-a95a-1463ed621d86",
  "aguardando-resposta": "1a18bc95-3aaf-4de1-8d9e-efab7762fee0",
  "em-atendimento":      "61182408-299b-49cc-9ce6-91bf9b4be190",
  "geladeira":           "74426e6b-e5cb-40bd-9c01-04f8a71a8b27",
  "stand-by":            "2b543a5f-eeba-4256-8043-84e8a93ed469",
  "diagnostico-gratis":  "8c58c670-7cdc-486d-88dd-1f746d2e554d",
  "follow-up-1":         "4847febb-1a1c-4a0c-a988-85d72309bce2",
  "follow-up-2":         "8c58c670-7cdc-486d-88dd-1f746d2e554d",
  "follow-up-3":         "4e1eee02-ede7-433a-bf7b-60144ed496b8",
  "follow-up-4":         "ac1c4d91-3964-44cc-b375-3f67e2252a7f",
  "reuniao-agendada":    "4e1eee02-ede7-433a-bf7b-60144ed496b8",
  "reuniao-realizada":   "ac1c4d91-3964-44cc-b375-3f67e2252a7f",
  "contrato-enviado":    "87fdfa17-c356-4363-b036-b703fcdf8a24",
  "contrato-fechado":    "87fdfa17-c356-4363-b036-b703fcdf8a24",
  "cobranca-enviada":    "2b543a5f-eeba-4256-8043-84e8a93ed469",
  "pagamento-recebido":  "74426e6b-e5cb-40bd-9c01-04f8a71a8b27",
  "servico-executado":   "a914c5c0-c5cc-4bca-9a13-91eb827abf0d",
  "acompanhamento":      "a914c5c0-c5cc-4bca-9a13-91eb827abf0d",
  "pos-vendas":          "1c8d3c69-442a-49bf-9eef-9840f4e8d415",
  "geracao-de-contrato": "1c8d3c69-442a-49bf-9eef-9840f4e8d415"
};

function getVisibleCadences(centroCustoId) {
  // Admin sees everything
  let visible = isCurrentUserAdmin() ? cadences : cadences.slice();

  // Filter by visibility settings for non-admins
  if (!isCurrentUserAdmin() && _cadenciaVisibilityData.length > 0) {
    const perfil = currentUser.perfil || 'Atendente';
    const allowedUuids = _cadenciaVisibilityData
      .filter(v => v.perfil === perfil && v.visible)
      .map(v => v.cadencia_id);
    if (allowedUuids.length > 0) {
      // Convert cadence slugs to UUIDs using mapaCadencias, then check against allowed UUIDs
      visible = visible.filter(c => {
        const uuid = mapaCadencias[c.id];
        return uuid && allowedUuids.includes(uuid);
      });
    }
  }

  // Filter by centro de custo (empresa) if selected
  if (centroCustoId && centroCustoId !== 'all') {
    const linkedIds = vinculosCadencias
      .filter(v => v.centro_custo_id === centroCustoId)
      .map(v => v.cadencia_id);
    if (linkedIds.length > 0) {
      visible = visible.filter(c => linkedIds.includes(c.id));
    }
  }
  return visible;
}

// Leads são carregados do Supabase na inicialização (ver boot)
let leads = [];
let vinculosServicos = [];
let vinculosCadencias = [];
let _cadenciaVisibilityData = []; // cache de visibilidade por perfil

// Mapas de referência para cadências e serviços (preenchidos durante a inicialização)
// _cadenciaColToUri é definido em supabaseClient.js e exposto em window
let _servicosByName = {};

/* ============================================
   CRM · SERVIÇOS DINÂMICOS
   ============================================ */
async function loadVinculosServicos() {
  if (!_supabase) return;
  const { data, error } = await _supabase.from('centro_custo_servicos').select('*');
  if (error) { console.error('[Vinculos] Erro ao carregar vínculos:', error); return; }
  vinculosServicos = data || [];
}

async function loadVinculosCadencias() {
  if (!_supabase) return;
  const { data, error } = await _supabase.from('centro_custo_cadencias').select('*');
  if (error) { console.error('[Vinculos] Erro ao carregar vínculos de cadências:', error); return; }
  vinculosCadencias = data || [];
}
let _servicosLoaded = false;

async function loadServiceChips(empresaId) {
  const container = document.getElementById('leadServiceChips');
  if (!container) return;

  const servicos = await fetchServicosSupabase();
  _servicosByName = {};
  (servicos || []).forEach(s => { _servicosByName[s.nome] = s; });

  if (!empresaId) {
    if (currentUser.perfil === 'Administrador') {
      empresaId = currentCrmEmpresaFilter !== 'all' ? currentCrmEmpresaFilter : null;
    } else {
empresaId = currentUser.centro_custo_ids?.[0] || null;
    }
  }

  let filteredServicos = servicos;
  if (empresaId) {
    const linkedSvcIds = vinculosServicos
      .filter(v => v.centro_custo_id === empresaId)
      .map(v => v.servico_id);
    filteredServicos = servicos.filter(s => linkedSvcIds.includes(s.id));
  }

  if (filteredServicos.length === 0) {
    container.innerHTML = '<span style="opacity:0.5;font-size:0.85rem">Nenhum serviço disponível para esta empresa</span>';
    return;
  }

  container.innerHTML = filteredServicos.map(s =>
    `<button type="button" class="chip-toggle" data-value="${escapeHtml(s.nome)}" data-svc-id="${s.id}">${escapeHtml(s.nome)}</button>`
  ).join('');

  _servicosLoaded = true;

  if (!container._chipDelegBound) {
    container._chipDelegBound = true;
    container.addEventListener('click', async (e) => {
      const chip = e.target.closest('.chip-toggle');
      if (!chip) return;
      chip.classList.toggle('active');

      if (!currentLeadId) return;

      const lead = leads.find(l => String(l.id) === String(currentLeadId));
      if (!lead) return;

      const activeNames = getActiveServiceChips();
      lead.tiposServico = activeNames;

      const activeIds = Array.from(
        container.querySelectorAll('.chip-toggle.active')
      ).map(c => c.dataset.svcId).filter(Boolean);

      lead._tipoServicoIds = activeIds;

      try {
        await updateLeadSupabase(lead.id, { tipo_servico_id: activeIds });
        console.log('[Supabase] tipo_servico_id salvo (array):', activeIds);
      } catch (err) {
        console.error('[Chips] Erro ao salvar tipo_servico_id:', err);
        toast('Erro ao salvar serviços: ' + (err.message || err), 'error');
      }

      renderAll();
    });
  }
}

function setServiceChipsActive(values) {
  const container = document.getElementById('leadServiceChips');
  if (!container) return;
  container.querySelectorAll('.chip-toggle').forEach(chip => {
    chip.classList.toggle('active', values.includes(chip.dataset.value));
  });
}

async function loadCalServiceChips(empresaId, selectedNames) {
  const container = document.getElementById('calEventServices');
  if (!container) return;

  const servicos = await fetchServicosSupabase();
  if (servicos.length === 0) return;

  let filtered = servicos;
  if (empresaId) {
    const linkedSvcIds = vinculosServicos
      .filter(v => v.centro_custo_id === empresaId)
      .map(v => v.servico_id);
    filtered = servicos.filter(s => linkedSvcIds.includes(s.id));
  }

  if (filtered.length === 0) {
    container.innerHTML = '<span class="chip-empty" style="font-size:11px;color:var(--muted-text);">Nenhum serviço vinculado a esta empresa</span>';
    return;
  }

  container.innerHTML = filtered.map(s =>
    `<button type="button" class="chip-toggle" data-value="${escapeHtml(s.nome)}" data-svc-id="${s.id}">${escapeHtml(s.nome)}</button>`
  ).join('');

  if (selectedNames && selectedNames.length > 0) {
    container.querySelectorAll('.chip-toggle').forEach(chip => {
      chip.classList.toggle('active', selectedNames.includes(chip.dataset.value));
    });
  }

  container.querySelectorAll('.chip-toggle').forEach(chip => {
    chip.onclick = () => chip.classList.toggle('active');
  });
}

function getActiveServiceChips() {
  const container = document.getElementById('leadServiceChips');
  if (!container) return [];
  return Array.from(container.querySelectorAll('.chip-toggle.active')).map(c => c.dataset.value);
}

function populateLeadEmpresaSelect() {
  const select = document.getElementById('leadEmpresa');
  if (!select) return;
  const isAdmin = isCurrentUserAdmin();
  const empresas = isAdmin
    ? centrosCustoData
    : centrosCustoData.filter(cc => currentUser.centro_custo_ids?.includes(cc.id));
  select.innerHTML = '<option value="">Selecione uma empresa...</option>';
  empresas.forEach(cc => {
    const opt = document.createElement('option');
    opt.value = cc.id;
    opt.textContent = cc.nome;
    select.appendChild(opt);
  });
}

let activeCadenceFilter = null;
let currentCrmEmpresaFilter = 'all';
let leadSearchQuery = '';

/* ============================================
   CRM · PAGINAÇÃO DO PIPELINE (Ver mais)
   ============================================
   Cada coluna começa mostrando VISIBLE_CARDS_PER_COLUMN cards.
   Ao clicar em "Ver mais" a coluna revela mais PAGE_STEP cards.
   O estado é persistido por coluna (kanbanExpanded[cadenceId]) e
   recalculado a cada render conforme o conjunto de leads visíveis
   (filtros de cadência + busca textual).
   ============================================ */
const VISIBLE_CARDS_PER_COLUMN = 5;
const PAGE_STEP = 5;
let kanbanExpanded = {};

/* ============================================
   CRM · FONTE ÚNICA DE VERDADE
   ============================================
   Tanto o "Resumo por Cadência" quanto o "Pipeline de Leads"
   derivam seus contadores daqui:
   - `cadences`   → define as cadências (id + label + short)
   - `leads`      → fonte primária dos dados
   - `getVisibleLeads()` → aplica os filtros ativos (cadência + busca)
   Qualquer mutation em `leads` (criar / mover / excluir / editar) deve
   chamar `renderAll()` para que ambos os componentes atualizem juntos.
   ============================================ */

/**
 * Retorna os leads visíveis após aplicar os filtros ativos
 * (filtro de cadência + busca textual). Usado como base tanto
 * pelo Resumo por Cadência quanto pelo Pipeline de Leads para
 * garantir que ambos mostrem contagens idênticas.
 */
function getVisibleLeads() {
  const q = leadSearchQuery.toLowerCase().trim();
  return leads.filter(l => {
    if (activeCadenceFilter && l.status !== activeCadenceFilter) return false;
    if (q && !l.empresa.toLowerCase().includes(q) && !l.telefone.includes(q) && !l.cnpj.includes(q)) return false;
    return true;
  });
}

function cadencesSummary() {
  const allLeads = getSearchFilteredLeads();
  return getVisibleCadences(currentCrmEmpresaFilter).map(c => {
    const list = allLeads.filter(l => l.status === c.id);
    const value = list.reduce((s, l) => s + (l.honorarios || 0), 0);
    return { id: c.id, label: c.short, count: list.length, value };
  });
}

function renderCadenceGrid() {
  const grid = $('#cadenceGrid');
  if (!grid) return;

  const data = cadencesSummary();
  grid.innerHTML = data.map(c => `
    <div class="cadence-card ${activeCadenceFilter === c.id ? 'active' : ''}" data-cadence="${c.id}" data-action="filter-cadence">
      <div class="cadence-card-head">
        <span class="cadence-card-name" title="${c.label}">${c.label}</span>
        <span class="cadence-card-badge">${c.count}</span>
      </div>
      <div class="cadence-card-value">${c.value > 0 ? 'R$ ' + c.value.toLocaleString('pt-BR') : '—'}</div>
    </div>
  `).join('');

  initIcons();
}

function isCurrentUserAdmin() {
  const permIsAdmin = _userPermCache && _userPermCache.perfil === 'Administrador';
  const currentPerfilIsAdmin = currentUser && currentUser.perfil === 'Administrador';
  return !!permIsAdmin || !!currentPerfilIsAdmin;
}

function isUserProfile(perfil) {
  if (!_userPermCache) return false;
  return _userPermCache.perfil === perfil;
}

function canViewAllData() {
  return isCurrentUserAdmin();
}

function getCurrentUserId() {
  return currentUser.id;
}

function getSearchFilteredLeads() {
  const q = leadSearchQuery.toLowerCase().trim();
  const canViewAll = canViewAllData();
  const userId = getCurrentUserId();
  
  return leads.filter(l => {
    if (q && !l.empresa.toLowerCase().includes(q) && !l.telefone.includes(q) && !l.cnpj.includes(q)) return false;
    
    // Se não é admin, filtrar apenas leads do próprio usuário (membro_id ou qualificador_id)
    if (!canViewAll && userId) {
      const membroId = l._membroId || l._ownerId;
      const qualificadorId = l._qualificadorId;
      if (membroId !== userId && qualificadorId !== userId) return false;
    }

    // Filtro por empresa (centro de custo)
    if (currentCrmEmpresaFilter !== 'all' && l._centroCustoId !== currentCrmEmpresaFilter) return false;

    return true;
  });
}

function initCrmEmpresaFilter() {
  const btn = document.getElementById('crmEmpresaFilterBtn');
  const dropdown = document.getElementById('crmEmpresaDropdown');
  if (!btn || !dropdown) return;

  const isAdmin = isCurrentUserAdmin();
  const empresas = isAdmin
    ? centrosCustoData
    : centrosCustoData.filter(cc => currentUser.centro_custo_ids?.includes(cc.id));

  // Membro com uma única empresa: já define a empresa vinculada ao perfil
  if (!isAdmin && empresas.length === 1) {
    currentCrmEmpresaFilter = empresas[0].id;
  } else if (currentCrmEmpresaFilter !== 'all' && !empresas.some(cc => cc.id === currentCrmEmpresaFilter)) {
    currentCrmEmpresaFilter = 'all';
  }

  dropdown.innerHTML = (isAdmin || empresas.length !== 1)
    ? '<button class="filter-dropdown-item" data-cc="all">Todas as Empresas</button>'
    : '';
  empresas.forEach(cc => {
    const item = document.createElement('button');
    item.className = 'filter-dropdown-item';
    item.dataset.cc = cc.id;
    item.textContent = cc.nome;
    dropdown.appendChild(item);
  });

  const label = currentCrmEmpresaFilter === 'all'
    ? 'Todas as Empresas'
    : (centrosCustoData.find(cc => cc.id === currentCrmEmpresaFilter)?.nome || 'Todas as Empresas');
  btn.innerHTML = `<i data-lucide="building-2"></i> ${label} <i data-lucide="chevron-down"></i>`;

  if (!btn._crmEmpresaBound) {
    btn._crmEmpresaBound = true;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      $$('.filter-dropdown').forEach(d => { if (d !== dropdown) d.classList.remove('open'); });
      dropdown.classList.toggle('open');
    });
    dropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.filter-dropdown-item');
      if (!item) return;
      e.stopPropagation();
      const val = item.dataset.cc || 'all';
      currentCrmEmpresaFilter = val;
      dropdown.classList.remove('open');

      const newLabel = val === 'all'
        ? 'Todas as Empresas'
        : (centrosCustoData.find(cc => cc.id === val)?.nome || 'Todas as Empresas');
      btn.innerHTML = `<i data-lucide="building-2"></i> ${newLabel} <i data-lucide="chevron-down"></i>`;
      initIcons();
      loadServiceChips();
      renderAll();
    });
  }
  initIcons();
}

let _membersCache = null;

async function loadMembersForTransfer(currentMembroId) {
  const select = $('#leadTransferMember');
  if (!select) return;

  if (!_membersCache) {
    const { data, error } = await _supabase.from('membros')
      .select('id, nome, email')
      .eq('status', 'Ativo')
      .order('nome');
    if (error || !data) {
      console.error('[Transfer] Erro ao buscar membros:', error?.message);
      return;
    }
    _membersCache = data;
  }

  select.innerHTML = '<option value="">Selecione um membro...</option>';
  _membersCache.forEach(m => {
    if (m.id === currentMembroId) return;
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.nome + (m.email ? ' (' + m.email + ')' : '');
    select.appendChild(opt);
  });

  const transferBtn = $('#leadTransferBtn');
  if (transferBtn) {
    transferBtn.disabled = true;
    select.onchange = () => { transferBtn.disabled = !select.value; };
  }
}

async function transferLead() {
  if (!isCurrentUserAdmin()) { toast('Apenas administradores podem transferir leads', 'error'); return; }
  const select = $('#leadTransferMember');
  const newOwnerId = select?.value;
  if (!newOwnerId || !currentLeadId) return;

  const lead = leads.find(l => String(l.id) === String(currentLeadId));
  if (!lead) return;

  const newMember = _membersCache?.find(m => m.id === newOwnerId);
  const newMemberName = newMember?.nome || 'Membro';

  const transferBtn = $('#leadTransferBtn');
  if (transferBtn) {
    transferBtn.disabled = true;
    transferBtn.innerHTML = '<i data-lucide="loader"></i> Transferindo...';
    initIcons();
  }

  try {
    const { error } = await _supabase.from('leads')
      .update({ membro_id: newOwnerId })
      .eq('id', String(currentLeadId));

    if (error) throw error;

    lead._membroId = newOwnerId;
    lead.responsavel = newMemberName;
    lead.lastTouch = new Date().toLocaleDateString('pt-BR');
    if (!lead.history) lead.history = [];
    lead.history.unshift({
      type: 'transfer',
      icon: 'arrow-right-left',
      title: 'Lead transferido',
      meta: new Date().toLocaleString('pt-BR'),
      desc: `Transferido para ${newMemberName}`
    });

    toast(`Lead transferido para ${newMemberName} com sucesso!`);

    // Notificar o novo responsável (salva notificação)
    addNotification(`Novo lead atribuído a você: ${lead.empresa} (de ${currentUser.nome})`);

    // Recarregar leads do Supabase para manter filtro consistente
    const isAdmin = isCurrentUserAdmin();
    const filterId = isAdmin ? null : currentUser.id;
    const refreshed = await fetchLeadsSupabase(filterId);
    leads = refreshed;

    renderAll();
    closeLeadModal();
  } catch (err) {
    console.error('[Transfer] Erro ao transferir lead:', err);
    toast(err.message || 'Erro ao transferir lead', 'error');
  } finally {
    if (transferBtn) {
      transferBtn.disabled = false;
      transferBtn.innerHTML = '<i data-lucide="arrow-right-left"></i> Transferir';
      initIcons();
    }
  }
}

function renderKanban() {
  const board = $('#kanbanBoard');
  if (!board) return;

  const allLeads = getSearchFilteredLeads();

  board.innerHTML = getVisibleCadences(currentCrmEmpresaFilter).map(c => {
    const list = allLeads.filter(l => l.status === c.id);
    const total = list.length;
    const isHighlighted = activeCadenceFilter === c.id;
    const expanded = kanbanExpanded[c.id] || VISIBLE_CARDS_PER_COLUMN;
    const showCount = Math.min(total, expanded);
    const visibleList = list.slice(0, showCount);
    const hasMore = total > showCount;
    const remaining = total - showCount;
    const cards = visibleList.map(l => leadCardHTML(l)).join('');
    return `
      <div class="kanban-col${isHighlighted ? ' kanban-col-highlight' : ''}" data-cadence="${c.id}">
        <div class="kanban-col-head">
          <span class="kanban-col-title" title="${c.label}">${c.short}</span>
          <span class="kanban-col-count" aria-label="${total} leads">${total}</span>
        </div>
        <div class="kanban-col-list" data-drop-zone="${c.id}">
          ${cards || '<div class="kanban-empty">Nenhum lead nesta etapa</div>'}
          ${hasMore ? `
            <button type="button"
                    class="kanban-load-more"
                    data-action="load-more"
                    data-cadence="${c.id}"
                    aria-label="Ver mais leads (${remaining} restantes)"
                    role="button">
              <i data-lucide="chevron-down" aria-hidden="true"></i>
              <span>Ver mais</span>
              <span class="kanban-load-more-count">+${remaining}</span>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  initIcons();
  bindLeadCards();
  bindDropZones();
  bindLoadMore();
  updateKanbanMeta(allLeads);
}

/**
 * Expande a coluna de uma cadência revelando mais PAGE_STEP cards.
 * Anuncia a quantidade carregada para leitores de tela via aria-live.
 */
function expandCadence(cadenceId) {
  const cur = kanbanExpanded[cadenceId] || VISIBLE_CARDS_PER_COLUMN;
  const next = cur + PAGE_STEP;
  kanbanExpanded[cadenceId] = next;
  renderKanban();

  // Acessibilidade: anuncia para leitores de tela quantos cards estão visíveis agora
  const visibleCount = Math.min(next, getSearchFilteredLeads().filter(l => l.status === cadenceId).length);
  announce(`${visibleCount} leads visíveis nesta etapa`);
}

function bindLoadMore() {
  $$('.kanban-load-more').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cadenceId = btn.dataset.cadence;
      // Feedback visual de loading (spinner) — operação é síncrona mas UX consistente
      btn.classList.add('loading');
      btn.disabled = true;
      // Pequeno delay para que o usuário perceba o feedback
      setTimeout(() => expandCadence(cadenceId), 120);
    });
  });
}

function announce(text) {
  const region = $('#kanbanAnnouncer');
  if (!region) return;
  // Força repetição do mesmo texto limpando primeiro
  region.textContent = '';
  setTimeout(() => { region.textContent = text; }, 30);
}

function updateKanbanMeta(visible) {
  const totalEl = $('#kanbanTotal');
  const valEl = $('#kanbanValue');
  if (totalEl) totalEl.textContent = visible.length;
  if (valEl) {
    const sum = visible.reduce((s, l) => s + (l.honorarios || 0), 0);
    valEl.textContent = sum.toLocaleString('pt-BR');
  }
}

const MAX_SERVICES_CARD = 3;

function normalizeServices(services) {
  if (!services) return [];
  if (Array.isArray(services)) return services.filter(Boolean);
  if (typeof services === 'string') return services.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}


function servicesHTML(services, leadId) {
  const all = normalizeServices(services);
  if (!all.length) return '';
  const shown = all.slice(0, MAX_SERVICES_CARD);
  const overflow = all.length - shown.length;
  const badges = shown.map(s =>
    `<span class="lead-card-svc-badge" aria-label="Serviço: ${s}">${s}</span>`
  ).join('');
  const more = overflow > 0
    ? `<span class="lead-card-svc-more" tabindex="0" role="button" aria-label="Mais ${overflow} serviço${overflow > 1 ? 's' : ''}" title="${all.slice(shown.length).join(', ')}">+${overflow}</span>`
    : '';
  return `<div class="lead-card-services" aria-label="Serviços">${badges}${more}</div>`;
}

function leadCardHTML(l) {
  const initials = l.empresa.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const rawServices = (l.servicos && l.servicos.length > 0) ? l.servicos : (l.tiposServico || []);
  const allServices = normalizeServices(rawServices);
  const svcCount = allServices.length;
  const evDate = l.dataEvento ? formatEventDate(l.dataEvento) : '—';
  const svcBadges = allServices.slice(0, MAX_SERVICES_CARD).map(s =>
    `<span class="lead-card-svc-badge" aria-label="Serviço: ${s}">${s}</span>`
  ).join('');
  const overflow = allServices.length - MAX_SERVICES_CARD;
  const more = overflow > 0
    ? `<span class="lead-card-svc-more" tabindex="0" role="button" aria-label="Mais ${overflow} serviço${overflow > 1 ? 's' : ''}" title="${allServices.slice(MAX_SERVICES_CARD).join(', ')}">+${overflow}</span>`
    : '';
  const respName = l.responsavel || '—';
  return `
    <article class="lead-card" draggable="true" data-lead-id="${l.id}" tabindex="0"
             aria-label="${l.empresa}${svcCount ? ', ' + svcCount + ' serviço' + (svcCount > 1 ? 's' : '') : ''}">
      <div class="lead-card-head">
        <span class="lead-card-avatar">${initials}</span>
        <span class="lead-card-name">${l.empresa}</span>
        <span class="lead-card-thermal ${l.thermal}" title="Status térmico: ${l.thermal}"></span>
      </div>
      <div class="lead-card-meta">
        <div class="row"><span class="lbl">Serviço</span><span class="val">${svcBadges || '—'}${more}</span></div>
        <div class="row"><span class="lbl">Data do Evento</span><span class="val">${evDate}</span></div>
        <div class="lead-card-member-badge"><i data-lucide="user"></i> ${respName}</div>
      </div>
    </article>
  `;
}

function formatCnpj(c) {
  return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function bindLeadCards() {
  $$('.lead-card').forEach(card => {
    card.addEventListener('dragstart', onDragStart);
    card.addEventListener('dragend', onDragEnd);
  });
  $$('.lead-card [data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id, 10);
      const action = btn.dataset.action;
      handleLeadAction(action, id);
    });
  });
  $$('.lead-card').forEach(card => {
    card.addEventListener('dblclick', () => openLeadModal(card.dataset.leadId));
  });
}

function bindDropZones() {
  $$('.kanban-col-list').forEach(zone => {
    zone.addEventListener('dragover',  onDragOver);
    zone.addEventListener('dragleave', onDragLeave);
    zone.addEventListener('drop',      onDrop);
  });
}

function handleLeadAction(action, id) {
  const lead = leads.find(l => String(l.id) === String(id));
  if (!lead) return;
  switch (action) {
    case 'open-lead':       openLeadModal(id); break;
    case 'call-lead':       recordInteraction(id, 'Ligação', 'phone'); break;
    case 'schedule-lead':   recordInteraction(id, 'Reunião agendada', 'calendar'); break;
    case 'note-lead':       {
      const note = prompt('Adicionar nota rápida:');
      if (note) recordInteraction(id, 'Nota', 'sticky-note', note);
      break;
    }
    case 'transfer-lead':   {
      const resp = prompt('Transferir para (Camila / Rafaela / João / Marina):', lead.responsavel);
      if (resp) {
        lead.responsavel = resp;
        toast('Lead transferido para ' + resp);
        renderAll();
      }
      break;
    }
  }
}

/* ============================================
   CRM · DRAG & DROP
   ============================================ */
let draggedId = null;

function onDragStart(e) {
  draggedId = this.dataset.leadId;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', draggedId); } catch {}
}

function onDragEnd() {
  this.classList.remove('dragging');
  $$('.kanban-col').forEach(c => c.classList.remove('drag-over'));
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  this.parentElement.classList.add('drag-over');
}

function onDragLeave() {
  this.parentElement.classList.remove('drag-over');
}

async function onDrop(e) {
  e.preventDefault();
  this.parentElement.classList.remove('drag-over');
  const id = e.dataTransfer.getData('text/plain') || draggedId;
  const newStatus = this.dataset.dropZone;
  const lead = leads.find(l => String(l.id) === String(id));
  if (!lead || !newStatus || lead.status === newStatus) return;

  const oldStatus = lead.status;
  lead.status = newStatus;
  lead.lastTouch = new Date().toLocaleDateString('pt-BR');
  invalidateDashCache();

  const _cadMap = window._cadenciaColToUuid || {};
  let newCadenciaUuid = _cadMap[newStatus] || null;

  if (!newCadenciaUuid && Object.keys(_cadMap).length === 0) {
    console.warn('[onDrop] Mapa cadência vazio, reconstruindo...');
    try {
      const rebuilt = await rebuildCadenciaMaps();
      newCadenciaUuid = (window._cadenciaColToUuid || {})[newStatus] || null;
    } catch {}
  }

  if (newCadenciaUuid) {
    lead._cadenciaId = newCadenciaUuid;
    updateLeadSupabase(lead.id, { cadencia_id: newCadenciaUuid })
      .then(() => console.log('[Supabase] cadencia_id salvo:', newCadenciaUuid))
      .catch(err => console.error('[Supabase] Erro ao salvar cadencia_id:', err));
  } else {
    console.warn('[onDrop] Não encontrou UUID para coluna:', newStatus, '| Mapa:', window._cadenciaColToUuid);
  }

  // visual feedback
  const card = $(`.lead-card[data-lead-id="${id}"]`);
  if (card) card.classList.add('just-moved');
  setTimeout(() => card && card.classList.remove('just-moved'), 1200);

  // log no histórico
  if (!lead.history) lead.history = [];
  lead.history.unshift({
    type: 'status',
    icon: 'arrow-right-circle',
    title: `Cadência: ${labelOf(oldStatus)} → ${labelOf(newStatus)}`,
    meta: new Date().toLocaleString('pt-BR'),
    desc: ''
  });

  toast(`Lead movido para ${labelOf(newStatus)}`);
  if (typeof registrarAuditoria === 'function') {
    registrarAuditoria({ acao: 'Atualizações', caminho_url: '/crm', modulo: 'CRM' });
  }
  renderAll();
}

function labelOf(id) {
  const c = cadences.find(x => x.id === id);
  return c ? c.label : id;
}

/* ============================================
   CRM · FILTRO POR CADÊNCIA
   ============================================ */
function setCadenceFilter(id) {
  activeCadenceFilter = activeCadenceFilter === id ? null : id;
  renderAll();
  if (activeCadenceFilter) {
    const col = $(`.kanban-col[data-cadence="${activeCadenceFilter}"]`);
    if (col) col.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
}

/* ============================================
   CRM · MODAL (criação + edição)
   ============================================
   `currentLeadId === null` indica modo de CRIAÇÃO (novo lead via +Lead).
   Caso contrário, é modo de EDIÇÃO do lead com esse id.
   ============================================ */
let currentLeadId = null;

function openNewLeadModal() {
  currentLeadId = null;

  // Limpa a busca do CRM para evitar que o valor preencha o telefone
  const searchEl = $('#crmSearch');
  if (searchEl) {
    searchEl.value = '';
    leadSearchQuery = '';
  }

  // Marca o modal em modo criação (esconde journey/sync-badge via CSS)
  const modal = $('#leadModal');
  modal.classList.add('is-new');
  modal.dataset.mode = 'new';

  // Cabeçalho
  $('#leadModalAvatar').textContent = 'NL';
  $('#leadModalTitle').textContent = 'Novo lead';
  $('#leadModalCreated').textContent = '—';
  $('#leadModalMetaCreate').textContent = '—';
  $('#leadModalMetaLast').textContent = '—';
  $('#leadModalLastTouch').textContent = '—';

  const tag = $('#leadModalThermal');
  tag.textContent = 'Frio';
  tag.className = 'thermal-tag frio';

  // Limpa todos os campos do formulário
  $$('#leadModal [name]').forEach(el => {
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
    else if (el.name === 'thermal') el.value = 'frio';
    else el.value = '';
  });

  // Limpa chip-groups e recarrega com filtro de empresa
  loadServiceChips();
  setServiceChipsActive([]);

  // Popula dropdown de empresa
  populateLeadEmpresaSelect();
  const empresaSelect = $('#leadEmpresa');
  if (empresaSelect) {
    let preSelected = null;
    if (currentCrmEmpresaFilter !== 'all') {
      preSelected = currentCrmEmpresaFilter;
    } else if (currentUser.centro_custo_ids?.length > 0) {
      preSelected = currentUser.centro_custo_ids[0];
    }
    if (preSelected && [...empresaSelect.options].some(o => o.value === preSelected)) {
      empresaSelect.value = preSelected;
      loadServiceChips(preSelected);
    }
    if (!empresaSelect._leadEmpresaBound) {
      empresaSelect._leadEmpresaBound = true;
      empresaSelect.addEventListener('change', () => {
        loadServiceChips(empresaSelect.value || undefined);
      });
    }
  }

  // Limpa erros
  $$('.form-error').forEach(e => e.textContent = '');
  $$('.invalid').forEach(e => e.classList.remove('invalid'));

  // Garante aba de edição
  switchLeadTab('edit');

  // Bind thermal select → update header tag
  const thermalSel = $('#leadThermal');
  if (thermalSel) {
    thermalSel.value = 'frio';
    thermalSel.onchange = () => {
      const v = thermalSel.value;
      tag.textContent = v.charAt(0).toUpperCase() + v.slice(1);
      tag.className = 'thermal-tag ' + v;
    };
  }

  // Bind honorários mask
  bindHonMask();

  // Bind CPF mask
  bindCpfMask();

  // Hide transfer tab for new leads
  const transferTab = $('#leadTransferTab');
  const transferHeaderBtn = $('#leadTransferHeaderBtn');
  if (transferTab) transferTab.style.display = 'none';
  if (transferHeaderBtn) transferHeaderBtn.style.display = 'none';

  // Show
  modal.classList.add('open');
  $('#leadModalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';

  initIcons();

  // Foco no primeiro campo
  setTimeout(() => {
    const first = $('#leadModal [name="empresa"]');
    if (first) first.focus();
  }, 50);
}

function renderJourneyBar(activeId) {
  const bar = $('#leadJourneyBar');
  if (!bar) return;
  bar.innerHTML = '';
  const activeIdx = cadences.findIndex(c => c.id === activeId);
  cadences.forEach((c, i) => {
    const chevron = document.createElement('div');
    chevron.className = 'journey-chevron';
    chevron.title = c.label;
    chevron.textContent = c.short;
    if (activeIdx === -1) {
      chevron.classList.add('pending');
    } else if (i < activeIdx) {
      chevron.classList.add('done');
    } else if (i === activeIdx) {
      chevron.classList.add('active');
    } else {
      chevron.classList.add('pending');
    }
    bar.appendChild(chevron);
  });
}

function openLeadModal(id) {
  const lead = leads.find(l => String(l.id) === String(id));
  if (!lead) return;
  currentLeadId = id;

  const modal = $('#leadModal');
  modal.classList.remove('is-new');
  modal.dataset.mode = 'edit';

  const initials = lead.empresa.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  $('#leadModalAvatar').textContent = initials;
  $('#leadModalTitle').textContent = lead.empresa;
  $('#leadModalCreated').textContent = `Criado em ${lead.createdAt}`;
  $('#leadModalMetaCreate').textContent = `Criado em ${lead.createdAt}`;
  $('#leadModalMetaLast').textContent = lead.lastTouch || '—';
  $('#leadModalLastTouch').textContent = lead.lastTouch || '—';

  const thermal = lead.thermal || 'frio';
  const tag = $('#leadModalThermal');
  tag.textContent = thermal.charAt(0).toUpperCase() + thermal.slice(1);
  tag.className = 'thermal-tag ' + thermal;

  // Preenche campos
  const form = $$('#leadModal [name]');
  form.forEach(el => {
    if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = !!lead[el.name];
    } else {
      el.value = lead[el.name] != null ? lead[el.name] : '';
    }
  });

  // Desabilitar campo telefone se não tem permissão de exclusão
  const telField = $('#leadModal [name="telefone"]');
  if (telField) {
    if (!canDeleteClienteTelefone()) {
      telField.readOnly = true;
      telField.title = 'Você não tem permissão para alterar o telefone deste cliente.';
      telField.style.opacity = '0.6';
      telField.style.cursor = 'not-allowed';
    } else {
      telField.readOnly = false;
      telField.title = '';
      telField.style.opacity = '';
      telField.style.cursor = '';
    }
  }

  // Bind thermal select → update header tag
  const thermalSel = $('#leadThermal');
  if (thermalSel) {
    thermalSel.value = thermal;
    thermalSel.onchange = () => {
      const v = thermalSel.value;
      tag.textContent = v.charAt(0).toUpperCase() + v.slice(1);
      tag.className = 'thermal-tag ' + v;
    };
  }

  // Bind honorários mask
  bindHonMask();

  // Bind CPF mask
  bindCpfMask();

  // Popula dropdown de empresa e seleciona a do lead
  populateLeadEmpresaSelect();
  const empresaSelect = $('#leadEmpresa');
  if (empresaSelect) {
    const leadEmpresaId = lead._centroCustoId || '';
    if (leadEmpresaId && [...empresaSelect.options].some(o => o.value === leadEmpresaId)) {
      empresaSelect.value = leadEmpresaId;
    }
    if (!empresaSelect._leadEmpresaBound) {
      empresaSelect._leadEmpresaBound = true;
      empresaSelect.addEventListener('change', () => {
        loadServiceChips(empresaSelect.value || undefined);
      });
    }
  }

  // Chip groups — serviços dinâmicos (recarrega com filtro de empresa)
  loadServiceChips().then(() => {
    const svcValues = lead.tiposServico || [];
    setServiceChipsActive(svcValues);
  });

  // Journey bar: renderizar chevrons conforme cadência atual
  renderJourneyBar(lead.status);

  // Transfer tab: show only for admins
  const transferTab = $('#leadTransferTab');
  const transferHeaderBtn = $('#leadTransferHeaderBtn');
  if (isCurrentUserAdmin()) {
    if (transferTab) transferTab.style.display = '';
    if (transferHeaderBtn) transferHeaderBtn.style.display = '';
    loadMembersForTransfer(lead._membroId);
  } else {
    if (transferTab) transferTab.style.display = 'none';
    if (transferHeaderBtn) transferHeaderBtn.style.display = 'none';
  }

  // Reset tab to edit
  switchLeadTab('edit');

  // Render history
  renderLeadHistory(lead);

  // Show
  modal.classList.add('open');
  $('#leadModalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';

  initIcons();
}

function bindHonMask() {
  const honEl = $('#leadHon');
  if (!honEl) return;

  const newHonEl = honEl.cloneNode(true);
  honEl.parentNode.replaceChild(newHonEl, honEl);

  const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function formatDisplay(val) {
    if (val == null || isNaN(val) || val === 0) return '';
    return fmt.format(val);
  }

  function parseInput(str) {
    const digits = str.replace(/\D/g, '');
    if (!digits) return 0;
    return parseInt(digits, 10) / 100;
  }

  let currentVal = 0;

  const lead = currentLeadId ? leads.find(l => String(l.id) === String(currentLeadId)) : null;
  if (lead && typeof lead.honorarios === 'number' && lead.honorarios > 0) {
    currentVal = lead.honorarios;
  }

  if (currentVal === 0) {
    const client = currentLeadId ? clientsData.find(c => String(c.id) === String(currentLeadId)) : null;
    if (client && typeof client.honorarios === 'number' && client.honorarios > 0) {
      currentVal = client.honorarios;
    }
  }

  newHonEl.value = formatDisplay(currentVal);

  newHonEl.addEventListener('input', () => {
    const val = parseInput(newHonEl.value);
    if (lead) lead.honorarios = val;
    newHonEl.value = formatDisplay(val);
    const len = newHonEl.value.length;
    newHonEl.setSelectionRange(len, len);
  });

  newHonEl.addEventListener('blur', () => {
    const val = parseInput(newHonEl.value);
    if (lead) lead.honorarios = val;
    newHonEl.value = formatDisplay(val);
  });

  newHonEl.addEventListener('focus', () => {
    const val = parseInput(newHonEl.value);
    const raw = val > 0 ? String(Math.round(val * 100)) : '';
    newHonEl.value = raw;
    newHonEl.setSelectionRange(raw.length, raw.length);
  });
}

function bindCpfMask() {
  const cpfEl = $('#leadModal [name="cpf"]');
  if (!cpfEl) return;

  const newCpfEl = cpfEl.cloneNode(true);
  cpfEl.parentNode.replaceChild(newCpfEl, cpfEl);

  function formatCpf(v) {
    v = v.replace(/\D/g, '').slice(0, 11);
    if (v.length > 9) return v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
    if (v.length > 6) return v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
    if (v.length > 3) return v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
    return v;
  }

  newCpfEl.addEventListener('input', () => {
    const pos = newCpfEl.selectionStart;
    const prevLen = newCpfEl.value.length;
    newCpfEl.value = formatCpf(newCpfEl.value);
    const diff = newCpfEl.value.length - prevLen;
    newCpfEl.setSelectionRange(pos + diff, pos + diff);
  });
}

function closeLeadModal() {
  $('#leadModal').classList.remove('open', 'is-new');
  delete $('#leadModal').dataset.mode;
  $('#leadModalOverlay').classList.remove('open');
  document.body.style.overflow = '';
  currentLeadId = null;
  // clear errors
  $$('.form-error').forEach(e => e.textContent = '');
  $$('.invalid').forEach(e => e.classList.remove('invalid'));
}

function switchLeadTab(tab) {
  $$('.lead-tab').forEach(t => t.dataset.active = (t.dataset.tab === tab) ? 'true' : 'false');
}

function renderLeadHistory(lead) {
  const list = $('#leadHistoryList');
  if (!list) return;
  const items = lead.history || defaultHistory(lead);
  list.innerHTML = items.map(h => `
    <li class="history-item">
      <div class="history-icon"><i data-lucide="${h.icon || 'circle'}"></i></div>
      <div class="history-content">
        <p class="history-title">${h.title}</p>
        <p class="history-meta">${h.meta}</p>
        ${h.desc ? `<p class="history-desc">${h.desc}</p>` : ''}
      </div>
    </li>
  `).join('');
  initIcons();
}

function defaultHistory(lead) {
  return [
    { icon: 'user-plus',   title: 'Lead criado',                 meta: lead.createdAt,                                  desc: 'Importação automática · origem: ' + (lead.origem || '—') },
    { icon: 'phone',       title: 'Ligação de qualificação',     meta: '28/05/2026 14:20',                              desc: 'Conversa inicial · lead demonstrou interesse em contabilidade mensal.' },
    { icon: 'mail',        title: 'E-mail de follow-up',         meta: '30/05/2026 09:10',                              desc: 'Envio da proposta de faturamento.' },
    { icon: 'calendar',    title: 'Reunião agendada',            meta: '02/06/2026 11:00',                              desc: 'Reunião marcada para 10/06 às 14h.' }
  ];
}

function recordInteraction(id, title, icon, desc) {
  const lead = leads.find(l => String(l.id) === String(id));
  if (!lead) return;
  if (!lead.history) lead.history = [];
  lead.history.unshift({
    type: 'interaction',
    icon, title,
    meta: new Date().toLocaleString('pt-BR'),
    desc: desc || ''
  });
  lead.lastTouch = new Date().toLocaleDateString('pt-BR');
  invalidateDashCache();
  toast('Interação registrada: ' + title);
  renderAll();
}

/* ============================================
   CRM · SALVAR LEAD (criação ou edição)
   ============================================
   Campos obrigatórios do formulário:
     - Nome (empresa) *
     - Número (telefone) *
     - Data do Evento (dataEvento) (opcional)
     - Tipo de Serviço (tiposServico) *  →  ao menos 1 chip selecionado
   Campos opcionais:
     - Endereço do Evento, Quantidade de Horas, Valor de Faturamento, Observações
   ============================================ */
async function saveLead() {
  const isNew = currentLeadId === null;
  const lead = isNew ? null : leads.find(l => String(l.id) === String(currentLeadId));
  if (!isNew && !lead) return;

  invalidateDashCache();

  // Coletar valores
  const fields = {};
  $$('#leadModal [name]').forEach(el => {
    if (el.type === 'checkbox' || el.type === 'radio') {
      fields[el.name] = el.checked;
    } else {
      fields[el.name] = el.value.trim();
    }
  });

  // Chip groups — serviços dinâmicos
  fields.tiposServico = getActiveServiceChips();

  // Validação (alinhada aos campos do formulário)
  const errors = {};
  if (!fields.empresa)        errors.empresa = 'Obrigatório';
  if (!fields.telefone)       errors.telefone = 'Obrigatório';
  else if (!validarTelefone(fields.telefone)) errors.telefone = 'Telefone inválido';

  if (!fields.empresaId)      errors.empresaId = 'Selecione uma empresa';
  if (!fields.tiposServico || fields.tiposServico.length === 0) {
    errors.tiposServico = 'Selecione ao menos um serviço';
  }

  // Mostrar erros
  $$('.form-error').forEach(e => e.textContent = '');
  $$('.invalid').forEach(e => e.classList.remove('invalid'));
  let hasError = false;
  Object.keys(errors).forEach(name => {
    const errEl = $(`#leadModal [data-error="${name}"]`);
    if (errEl) errEl.textContent = errors[name];
    const input = $(`#leadModal [name="${name}"]`);
    if (input) input.classList.add('invalid');
    hasError = true;
  });

  // Destacar visualmente o chip-group com erro
  if (errors.tiposServico) {
    const grp = $('#leadModal [data-name="tiposServico"]');
    if (grp) grp.classList.add('invalid');
  }

  if (hasError) {
    toast('Verifique os campos destacados', 'error');
    return;
  }

  // Conversões numéricas
  const leadForHon = currentLeadId ? leads.find(l => String(l.id) === String(currentLeadId)) : null;
  if (leadForHon && typeof leadForHon.honorarios === 'number') {
    fields.honorarios = leadForHon.honorarios;
  } else {
    const honStr = String(fields.honorarios || '').trim();
    const digits = honStr.replace(/\D/g, '');
    fields.honorarios = digits ? parseInt(digits, 10) / 100 : 0;
  }
  if (fields.honorarios < 0) fields.honorarios = 0;

  if (fields.quantidadeHoras) {
    fields.quantidadeHoras = parseInt(fields.quantidadeHoras, 10) || 0;
  } else {
    fields.quantidadeHoras = 0;
  }

  const now = new Date();
  const nowStr = now.toLocaleString('pt-BR');
  const today = now.toLocaleDateString('pt-BR');

  // Feedback visual: botão em loading
  const saveBtn = $('#leadSaveBtn');
  const saveBtnOriginalHTML = saveBtn ? saveBtn.innerHTML : '';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i data-lucide="loader"></i> Salvando...';
    initIcons();
  }

  if (isNew) {
    const newLead = {
      id: Math.max(...leads.map(l => l.id), 0) + 1,
      empresa: fields.empresa,
      cnpj: '',
      telefone: fields.telefone,
      cpf: fields.cpf || '',
      email: fields.email || '',
      responsavel: currentUser.nome || 'Camila',
      _ownerId: currentUser.id || null,
      _membroId: null,
      _centroCustoId: fields.empresaId || null,
      status: 'novo-lead',
      thermal: fields.thermal || 'frio',
      honorarios: fields.honorarios,
      servicos: [],
      dataEvento: fields.dataEvento,
      tiposServico: fields.tiposServico,
      _tipoServicoIds: fields.tiposServico.map(name => _servicosByName[name]?.id).filter(Boolean),
      _cadenciaId: (window._cadenciaColToUuid || {})['novo-lead'] || null,
      enderecoEvento: fields.enderecoEvento || '',
      enderecoResidencial: fields.enderecoResidencial || '',
      quantidadeHoras: fields.quantidadeHoras,
      cidade: '',
      estado: '',
      segmento: '',
      tipoEmpresa: '',
      regime: '',
      tipoCliente: '',
      tipoContrato: '',
      statusCliente: 'Prospect',
      statusServico: 'Pendente',
      statusHonorarios: 'Pendente',
      origem: 'Manual',
      observacoes: fields.observacoes || '',
      createdAt: nowStr,
      lastTouch: today,
      history: [{
        type: 'create',
        icon: 'user-plus',
        title: 'Lead criado',
        meta: nowStr,
        desc: 'Cadastro via formulário "Novo lead"'
      }]
    };
    leads.push(newLead);
    currentLeadId = newLead.id;

    // Inserir no Supabase
    try {
      const result = await insertLeadSupabase({
        nome: fields.empresa,
        telefone: fields.telefone,
        data_evento: fields.dataEvento || null,
        endereco_evento: fields.enderecoEvento || '',
        endereco_residencial: fields.enderecoResidencial || '',
        quantidade_horas: fields.quantidadeHoras || 0,
        temperatura: fields.thermal || 'frio',
        honorarios: fields.honorarios,
        observacoes: fields.observacoes || '',
        tipo_servico_id: newLead._tipoServicoIds.length > 0 ? newLead._tipoServicoIds : null,
        cadencia_id: newLead._cadenciaId || null,
        owner_id: currentUser.id || null,
        centro_custo_id: fields.empresaId || null,
        cpf: fields.cpf || '',
        email: fields.email || ''
      });
      if (result && result[0] && result[0].id) {
        newLead.id = result[0].id;
        currentLeadId = result[0].id;
      }
      toast('Lead criado e salvo no Supabase: ' + newLead.empresa);
if (typeof registrarAuditoria === 'function') {
    registrarAuditoria({ acao: 'Inclusões', caminho_url: '/crm', modulo: 'CRM' });
  }
    } catch (err) {
      console.error('[Insert] Erro completo:', err);
      const errMsg = err.message || String(err);
      toast('Erro ao salvar no Supabase: ' + errMsg, 'error');
    }
  } else {
    // Proteção: não apagar telefone sem permissão
    if (!fields.telefone && lead.telefone && !canDeleteClienteTelefone()) {
      fields.telefone = lead.telefone;
      toast('Você não tem permissão para apagar o telefone do cliente.', 'error');
    }
    Object.assign(lead, fields);
    lead.lastTouch = today;
    if (!lead.history) lead.history = [];
    lead.history.unshift({
      type: 'edit',
      icon: 'save',
      title: 'Lead atualizado',
      meta: nowStr,
      desc: 'Edição manual via modal'
    });

    // Atualizar no Supabase
    try {
      const payload = {
        nome: fields.empresa,
        telefone: fields.telefone,
        data_evento: fields.dataEvento || null,
        endereco_evento: fields.enderecoEvento || '',
        endereco_residencial: fields.enderecoResidencial || '',
        quantidade_horas: fields.quantidadeHoras || 0,
        temperatura: fields.thermal || 'frio',
        honorarios: fields.honorarios,
        observacoes: fields.observacoes || '',
        cpf: fields.cpf || '',
        email: fields.email || ''
      };

      if (fields.tiposServico) {
        const ids = fields.tiposServico.map(name => _servicosByName[name]?.id).filter(Boolean);
        if (ids.length > 0) payload.tipo_servico_id = ids;
      }

      const cadUuid = (window._cadenciaColToUuid || {})[lead.status] || lead._cadenciaId;
      if (cadUuid) payload.cadencia_id = cadUuid;

      console.log('[Edit] Payload para Supabase:', JSON.stringify(payload, null, 2));
      console.log('[Edit] tipo_servico_id type:', typeof payload.tipo_servico_id, Array.isArray(payload.tipo_servico_id), payload.tipo_servico_id);
      console.log('[Edit] cadencia_id type:', typeof payload.cadencia_id, payload.cadencia_id);

      await updateLeadSupabase(lead.id, payload);
      toast('Lead atualizado no Supabase: ' + lead.empresa);
if (typeof registrarAuditoria === 'function') {
    registrarAuditoria({ acao: 'Atualizações', caminho_url: '/crm', modulo: 'CRM' });
  }
    } catch (err) {
      console.error('[Edit] Erro completo:', err);
      const errMsg = err.message || String(err);
      toast('Erro ao salvar no Supabase: ' + errMsg, 'error');
    }
  }

  // Restaurar botão
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.innerHTML = saveBtnOriginalHTML;
    initIcons();
  }

  closeLeadModal();
  renderAll();
}

function validarCNPJ(v) {
  v = v.replace(/\D/g, '');
  return v.length === 14;
}

function validarTelefone(v) {
  v = v.replace(/\D/g, '');
  return v.length >= 10 && v.length <= 11;
}

/* ============================================
   CRM · TOAST
   ============================================ */
let toastTimer = null;
function toast(text, type = 'success') {
  const el = $('#toast');
  const txt = $('#toastText');
  if (!el || !txt) return;
  txt.textContent = text;
  el.hidden = false;
  el.dataset.type = type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.hidden = true, 2500);
}

/* ============================================
   NOTIFICAÇÕES · Bell badge + localStorage
   ============================================ */
function _getNotifications() {
  try { return JSON.parse(localStorage.getItem('blue_notifications') || '[]'); } catch { return []; }
}
function _saveNotifications(list) {
  localStorage.setItem('blue_notifications', JSON.stringify(list));
}
function addNotification(msg) {
  const list = _getNotifications();
  list.unshift({ msg, time: Date.now(), read: false });
  _saveNotifications(list);
  _updateNotifDot();
}
function _updateNotifDot() {
  const dot = $('#notifDot');
  const list = _getNotifications();
  const unread = list.filter(n => !n.read).length;
  if (dot) dot.hidden = unread === 0;
}
function clearNotifications() {
  const list = _getNotifications().map(n => ({ ...n, read: true }));
  _saveNotifications(list);
  _updateNotifDot();
}
function initNotifications() {
  _updateNotifDot();
  const bellBtn = $('#notifBellBtn');
  if (bellBtn) {
    bellBtn.addEventListener('click', () => {
      clearNotifications();
      const list = _getNotifications();
      if (list.length > 0) {
        toast('Notificações limpas');
      } else {
        toast('Nenhuma notificação');
      }
    });
  }
}

function renderAll() {
  renderCadenceGrid();
  renderKanban();
}

/* ============================================
   CRM · INTERAÇÕES
   ============================================ */
function initCRM() {
  // Click no card de cadência
  document.addEventListener('click', (e) => {
    const card = e.target.closest('[data-action="filter-cadence"]');
    if (card) {
      setCadenceFilter(card.dataset.cadence);
    }
  });

  // Busca com debounce
  const search = $('#crmSearch');
  let searchTimeout;
  if (search) search.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { leadSearchQuery = search.value; renderAll(); }, 180);
  });

  // Botão + Lead → abre modal em modo criação
  const newLead = $('#crmNewLeadBtn');
  if (newLead) newLead.addEventListener('click', openNewLeadModal);

  // Botão + Lead do header global (top-right) também abre o mesmo modal
  const primaryAction = $('#primaryAction');
  if (primaryAction) primaryAction.addEventListener('click', openNewLeadModal);

  // Modal: fechar
  $$('#leadModal [data-action="close-modal"]').forEach(b => b.addEventListener('click', closeLeadModal));
  $('#leadModalOverlay').addEventListener('click', closeLeadModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#leadModal').classList.contains('open')) closeLeadModal();
  });

  // Salvar
  $('#leadSaveBtn').addEventListener('click', saveLead);

  // Histórico / WhatsApp
  $$('#leadModal [data-action="history"]').forEach(b =>
    b.addEventListener('click', () => switchLeadTab('history')));
  $$('#leadModal [data-action="back-to-edit"]').forEach(b =>
    b.addEventListener('click', () => switchLeadTab('edit')));
  $$('#leadModal [data-action="whatsapp"]').forEach(b =>
    b.addEventListener('click', () => {
      const lead = leads.find(l => String(l.id) === String(currentLeadId));
      if (!lead) return;
      const phone = lead.telefone.replace(/\D/g, '');
      const text = encodeURIComponent(`Olá ${lead.empresa.split(' ')[0]}, tudo bem? Aqui é da Blue Contabilidade.`);
      window.open(`https://wa.me/55${phone}?text=${text}`, '_blank');
    }));

  // Transferência (admin)
  $$('#leadModal [data-action="transfer"]').forEach(b =>
    b.addEventListener('click', () => switchLeadTab('transfer')));
  const transferBtnEl = $('#leadTransferBtn');
  if (transferBtnEl) transferBtnEl.addEventListener('click', transferLead);

  // Inicial: esconder journey arrows errados
  renderAll();
}

/* ============================================
   DASHBOARD · ANALYTICS v1.4
   ============================================ */

// ----- Constantes de status / cadência / temperatura
const STATUS_CATEGORY = {
  'novo-lead':          'pendente',
  'dados-ia':           'pendente',
  'coletados-frio':     'pendente',
  'geladeira':          'pendente',
  'stand-by':           'pendente',
  'qualificado':        'andamento',
  'em-atendimento':     'andamento',
  'diagnostico-gratis': 'andamento',
  'reuniao-agendada':   'andamento',
  'reuniao-realizada':  'andamento',
  'contrato-fechado':   'andamento',
  'cobranca-enviada':   'andamento',
  'pagamento-recebido': 'andamento',
  'servico-executado':  'andamento',
  'pos-vendas':         'finalizado'
};

// Normaliza a origem do lead para as 4 categorias fixas
const ORIGIN_MAP = {
  'Indicação':           'Indicação de Cliente',
  'Indicação de Cliente':'Indicação de Cliente',
  'Google Ads':          'Anúncio Pago',
  'Facebook Ads':        'Anúncio Pago',
  'Instagram Ads':       'Anúncio Pago',
  'LinkedIn Ads':        'Anúncio Pago',
  'Anúncio Pago':        'Anúncio Pago',
  'Ação de Rua':         'Ação de Rua',
  'Acao de Rua':         'Ação de Rua',
  'Oferta Ativa':        'Oferta Ativa',
  'LinkedIn':            'Oferta Ativa',
  'Instagram':           'Oferta Ativa',
  'Site':                'Oferta Ativa',
  'Orgânico':            'Oferta Ativa',
  'Outro':               'Oferta Ativa'
};
const ORIGENS_FIXAS = ['Indicação de Cliente', 'Anúncio Pago', 'Ação de Rua', 'Oferta Ativa'];
const ORIGEM_COLOR = {
  'Indicação de Cliente': '#165BFF',
  'Anúncio Pago':         '#F59E0B',
  'Ação de Rua':          '#10B981',
  'Oferta Ativa':         '#A855F7'
};
const TEMP_COLOR = { frio: '#0284C7', morno: '#D97706', quente: '#DC2626' };

// ----- Estado atual do Dashboard
const dashState = {
  period: 'today',     // today | yesterday | week | month | custom
  startDate: null,
  endDate: null,
  activeTab: 'total',
  filters: { responsavel: '', cadencia: '', origem: '', thermal: '' },
  cache: { ts: 0, payload: null }
};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

// ----- Datas (parsing + range)
function parseLeadDate(s) {
  if (!s) return null;
  // 'DD/MM/YYYY HH:MM'  |  'DD/MM/YYYY'
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const d = parseInt(m[1], 10), mo = parseInt(m[2], 10) - 1, y = parseInt(m[3], 10);
  const h = m[4] ? parseInt(m[4], 10) : 0;
  const mi = m[5] ? parseInt(m[5], 10) : 0;
  return new Date(y, mo, d, h, mi, 0);
}
function parseISODate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0);
}
function formatBR(d) {
  if (!d) return '—';
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}
function formatBRShort(d) {
  if (!d) return '—';
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
}
function formatBRL(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 60)  return 'agora';
  if (s < 3600) return `há ${Math.floor(s/60)} min`;
  if (s < 86400) return `há ${Math.floor(s/3600)}h`;
  return `há ${Math.floor(s/86400)}d`;
}

function getPeriodRange() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let start, end;

  switch (dashState.period) {
    case 'today':
      start = new Date(today);
      end = new Date(today);
      end.setHours(23, 59, 59, 999);
      break;
    case 'yesterday':
      start = new Date(today);
      start.setDate(start.getDate() - 1);
      end = new Date(start);
      end.setHours(23, 59, 59, 999);
      break;
    case 'week': {
      const day = today.getDay();
      const diff = day === 0 ? 6 : day - 1;
      start = new Date(today);
      start.setDate(start.getDate() - diff);
      end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case 'month':
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'custom':
      if (dashState.startDate && dashState.endDate) {
        start = new Date(dashState.startDate);
        start.setHours(0, 0, 0, 0);
        end = new Date(dashState.endDate);
        end.setHours(23, 59, 59, 999);
      } else {
        start = new Date(today);
        end = new Date(today);
        end.setHours(23, 59, 59, 999);
      }
      break;
    default:
      start = new Date(today);
      end = new Date(today);
      end.setHours(23, 59, 59, 999);
  }
  return { start, end };
}

function getPreviousPeriodRange() {
  const { start, end } = getPeriodRange();
  const days = Math.ceil((end - start) / 86400000) + 1;
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  prevEnd.setHours(23, 59, 59, 999);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - days + 1);
  prevStart.setHours(0, 0, 0, 0);
  return { start: prevStart, end: prevEnd };
}

function formatPeriodBadge(start, end) {
  const fmt = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  if (start.getTime() === end.getTime()) return fmt(start);
  return `${fmt(start)} — ${fmt(end)}`;
}

// ----- Categorização de leads
function getStatusCategory(status) {
  return STATUS_CATEGORY[status] || 'andamento';
}
function normalizeOrigin(orig) {
  if (!orig) return 'Oferta Ativa';
  return ORIGIN_MAP[orig] || 'Oferta Ativa';
}

// ----- Cache
function getCachedPayload() {
  if (!dashState.cache.payload) return null;
  if (Date.now() - dashState.cache.ts > CACHE_TTL_MS) return null;
  return dashState.cache.payload;
}
function setCachedPayload(p) {
  dashState.cache = { ts: Date.now(), payload: p };
}
function invalidateDashCache() {
  dashState.cache = { ts: 0, payload: null };
  _selectsPopulated = false; // repopula selects caso novo responsável/cadência tenha surgido
}

// ----- Filtros
function applyPeriod(leads, range) {
  return leads.filter(l => {
    const d = parseLeadDate(l.createdAt) || parseLeadDate(l.lastTouch);
    if (!d) return false;
    return d >= range.start && d <= range.end;
  });
}
function applySecondaryFilters(leads) {
  const f = dashState.filters;
  return leads.filter(l => {
    if (f.responsavel && l.responsavel !== f.responsavel) return false;
    if (f.cadencia   && l.status      !== f.cadencia)      return false;
    if (f.origem     && normalizeOrigin(l.origem) !== f.origem) return false;
    if (f.thermal    && l.thermal     !== f.thermal)       return false;
    return true;
  });
}

// ----- Computações
function computeAllMetrics(leads) {
  const { start, end } = getPeriodRange();
  const current = applySecondaryFilters(applyPeriod(leads, { start, end }));
  const prev = applyPeriod(leads, getPreviousPeriodRange());

  const categorize = (arr) => {
    const m = { total: arr.length, finalizado: 0, andamento: 0, pendente: 0 };
    arr.forEach(l => {
      const cat = getStatusCategory(l.status);
      if (cat === 'finalizado') m.finalizado++;
      else if (cat === 'andamento') m.andamento++;
      else m.pendente++;
    });
    return m;
  };
  const cur = categorize(current);
  const prevM = categorize(prev);

  const variation = (c, p) => {
    if (p === 0) return c > 0 ? 100 : 0;
    return Math.round(((c - p) / p) * 1000) / 10;
  };

  return {
    current,
    metrics: {
      total:       { count: cur.total,       var: variation(cur.total,       prevM.total) },
      finalizado:  { count: cur.finalizado,  var: variation(cur.finalizado,  prevM.finalizado) },
      andamento:   { count: cur.andamento,   var: variation(cur.andamento,   prevM.andamento) },
      pendente:    { count: cur.pendente,    var: variation(cur.pendente,    prevM.pendente) }
    },
    range: { start, end }
  };
}

function computeOrigins(leads) {
  const map = {};
  ORIGENS_FIXAS.forEach(o => { map[o] = { count: 0, leads: [], value: 0 }; });
  leads.forEach(l => {
    const o = normalizeOrigin(l.origem);
    if (!map[o]) map[o] = { count: 0, leads: [], value: 0 };
    map[o].count++;
    map[o].value += l.honorarios || 0;
    map[o].leads.push(l);
  });
  return map;
}

function computeTemperatures(leads) {
  const map = { frio: [], morno: [], quente: [] };
  leads.forEach(l => { (map[l.thermal] || map.frio).push(l); });
  return {
    frio:   { count: map.frio.length,   leads: map.frio,   value: map.frio.reduce((s,l)   => s + (l.honorarios||0), 0) },
    morno:  { count: map.morno.length,  leads: map.morno,  value: map.morno.reduce((s,l)  => s + (l.honorarios||0), 0) },
    quente: { count: map.quente.length, leads: map.quente, value: map.quente.reduce((s,l) => s + (l.honorarios||0), 0) }
  };
}

function computeCadenceFunnel(leads) {
  const map = {};
  cadences.forEach(c => { map[c.id] = { id: c.id, label: c.label, count: 0, value: 0, leads: [] }; });
  leads.forEach(l => {
    if (!map[l.status]) {
      // se status é desconhecido, ignora (não cai em categoria fantasma)
      return;
    }
    map[l.status].count++;
    map[l.status].value += l.honorarios || 0;
    map[l.status].leads.push(l);
  });
  return Object.values(map);
}

function computeReminders(leads) {
  const { start, end } = getPeriodRange();
  const inRange = meetings.filter(m => {
    const d = parseISODate(m.iso);
    return d && d >= start && d <= end;
  });
  // Se o lead relacionado tem o status correspondente, linka-o
  return inRange
    .map(m => {
      const lead = m.leadId ? leads.find(l => String(l.id) === String(m.leadId)) : null;
      return { ...m, lead };
    })
    .sort((a, b) => (a.iso + a.time).localeCompare(b.iso + b.time));
}

function computeHonorarios(leads) {
  const total = leads.reduce((s, l) => s + (l.honorarios || 0), 0);
  const byCadence = cadences
    .map(c => {
      const ls = leads.filter(l => l.status === c.id);
      return { id: c.id, label: c.label, value: ls.reduce((s,l)=>s+(l.honorarios||0),0), count: ls.length };
    })
    .filter(x => x.value > 0)
    .sort((a,b) => b.value - a.value);
  const byTemp = ['quente','morno','frio']
    .map(t => {
      const ls = leads.filter(l => l.thermal === t);
      return { id: t, label: t[0].toUpperCase()+t.slice(1), value: ls.reduce((s,l)=>s+(l.honorarios||0),0), count: ls.length };
    });
  return { total, byCadence, byTemp, count: leads.length, avg: leads.length ? total / leads.length : 0 };
}

// ----- Render helpers
function trendPill(varPct) {
  const cls = varPct > 0 ? 'up' : varPct < 0 ? 'down' : 'neutral';
  const ico = varPct > 0 ? 'trending-up' : varPct < 0 ? 'trending-down' : 'minus';
  const txt = varPct === 0 ? 'sem alteração' : `${varPct > 0 ? '+' : ''}${varPct}%`;
  return `<span class="metric-trend-pill ${cls}"><i data-lucide="${ico}"></i> ${txt}</span>`;
}
function emptyStateHtml(msg) {
  return `<div class="empty-state"><i data-lucide="inbox"></i><p>${escapeHtml(msg)}</p></div>`;
}
function statusTag(status) {
  const c = cadences.find(x => x.id === status);
  return `<span class="dash-status-tag t-${status}">${escapeHtml(c ? c.short : status)}</span>`;
}
function thermalTag(t) {
  return `<span class="thermal-tag ${t}">${t}</span>`;
}

// ----- Render: Summary (4 metric cards)
function renderDashSummary(payload) {
  const wrap = document.getElementById('dashSummary');
  if (!wrap) return;
  const m = payload.metrics;
  const cfg = [
    { key: 'total',       label: 'Total de Lead',       ico: 'users-round',   tip: 'Total de leads no período' },
    { key: 'finalizado',  label: 'Leads Finalizados',   ico: 'check-circle-2',tip: 'Leads que chegaram ao pós-vendas' },
    { key: 'andamento',   label: 'Leads Em Andamento',  ico: 'loader',        tip: 'Leads ativos em cadências intermediárias' },
    { key: 'pendente',    label: 'Leads Pendentes',     ico: 'alert-circle',  tip: 'Aguardando primeiro atendimento' }
  ];
  wrap.innerHTML = cfg.map(c => {
    const data = m[c.key];
    return `
      <div class="metric-card${c.key==='total'?' highlight':''}" data-tooltip="${c.tip}" data-tab-link="${c.key==='finalizado'?'finalizados':c.key==='andamento'?'andamento':c.key==='pendente'?'pendentes':'total'}">
        <div class="metric-head">
          <span class="metric-label">${c.label}</span>
          <i data-lucide="${c.ico}" class="metric-ico"></i>
        </div>
        <h2 class="metric-value">${data.count}</h2>
        ${trendPill(data.var)}
        <div class="metric-bar"><span data-width="${Math.min(100, data.count * (c.key==='total' ? 4 : 8))}%"></span></div>
      </div>`;
  }).join('');
  if (window.initIcons) window.initIcons();
  // re-anima barras
  if (typeof animateProgressBars === 'function') setTimeout(animateProgressBars, 50);
  // Click handler para trocar de aba
  wrap.querySelectorAll('[data-tab-link]').forEach(el => {
    el.addEventListener('click', () => setDashTab(el.dataset.tabLink));
  });
}

// ----- Render: Tabelas
function renderTableTotal(tbody, leads) {
  if (!leads.length) { tbody.closest('.card').querySelector('.table-wrap').innerHTML = emptyStateHtml('Nenhum lead encontrado nesse período'); return; }
  tbody.innerHTML = leads.slice(0, 200).map(l => `
    <tr class="lead-row-clickable" data-lead-id="${l.id}">
      <td>${escapeHtml(l.empresa)}</td>
      <td>${statusTag(l.status)}</td>
      <td>${thermalTag(l.thermal)}</td>
      <td>${escapeHtml(normalizeOrigin(l.origem))}</td>
      <td>${escapeHtml(l.responsavel)}</td>
      <td>${formatBRL(l.honorarios||0)}</td>
      <td>${escapeHtml((l.createdAt||'').split(' ')[0])}</td>
      <td>${escapeHtml(l.lastTouch||'—')}</td>
    </tr>`).join('');
}
function renderTableFinalizados(tbody, leads) {
  if (!leads.length) { tbody.closest('.card').querySelector('.table-wrap').innerHTML = emptyStateHtml('Nenhum lead finalizado no período'); return; }
  tbody.innerHTML = leads.map(l => `
    <tr class="lead-row-clickable" data-lead-id="${l.id}">
      <td>${escapeHtml(l.empresa)}</td>
      <td>${statusTag(l.status)}</td>
      <td>${escapeHtml(normalizeOrigin(l.origem))}</td>
      <td>${escapeHtml(l.responsavel)}</td>
      <td>${formatBRL(l.honorarios||0)}</td>
      <td>${escapeHtml((l.createdAt||'').split(' ')[0])}</td>
    </tr>`).join('');
}
function renderTableAndamento(tbody, leads) {
  if (!leads.length) { tbody.closest('.card').querySelector('.table-wrap').innerHTML = emptyStateHtml('Nenhum lead em andamento no período'); return; }
  tbody.innerHTML = leads.map(l => `
    <tr class="lead-row-clickable" data-lead-id="${l.id}">
      <td>${escapeHtml(l.empresa)}</td>
      <td>${statusTag(l.status)}</td>
      <td>${escapeHtml(normalizeOrigin(l.origem))}</td>
      <td>${escapeHtml(l.responsavel)}</td>
      <td>${formatBRL(l.honorarios||0)}</td>
      <td>${escapeHtml(l.lastTouch||'—')}</td>
    </tr>`).join('');
}
function renderTablePendentes(tbody, leads) {
  if (!leads.length) { tbody.closest('.card').querySelector('.table-wrap').innerHTML = emptyStateHtml('Nenhum lead pendente no período'); return; }
  tbody.innerHTML = leads.map(l => `
    <tr class="lead-row-clickable" data-lead-id="${l.id}">
      <td>${escapeHtml(l.empresa)}</td>
      <td>${statusTag(l.status)}</td>
      <td>${escapeHtml(normalizeOrigin(l.origem))}</td>
      <td>${escapeHtml(l.responsavel)}</td>
      <td>${formatBRL(l.honorarios||0)}</td>
      <td>${escapeHtml(l.lastTouch||'—')}</td>
    </tr>`).join('');
}
function renderTableReunioes(tbody, meetings) {
  if (!meetings.length) { tbody.closest('.card').querySelector('.table-wrap').innerHTML = emptyStateHtml('Nenhuma reunião no período'); return; }
  tbody.innerHTML = meetings.map(m => {
    const d = parseISODate(m.iso);
    const tagCls = m.type === 'reuniao' ? 'tag-blue' : m.type === 'fiscal' ? 'tag-amber' : m.type === 'financeiro' ? 'tag-green' : 'tag-purple';
    return `
      <tr data-meeting-id="${m.id}"${m.leadId?` data-lead-id="${m.leadId}"`:''}>
        <td>${formatBRShort(d)}</td>
        <td>${escapeHtml(m.time || '—')}${m.duration?` <span style="color:var(--muted-text);font-size:11px">(${m.duration}min)</span>`:''}</td>
        <td>${escapeHtml(m.cliente || '—')}</td>
        <td>${escapeHtml(m.empresa)}</td>
        <td>${escapeHtml(m.responsavel || '—')}</td>
        <td><span class="tag ${tagCls}">${meetingTypeLabel(m.type)}</span></td>
        <td>${m.lead?`<button class="icon-btn small" data-action="open-lead" data-lead-id="${m.leadId}" title="Abrir lead"><i data-lucide="external-link"></i></button>`:''}</td>
      </tr>`;
  }).join('');
}

// ----- Render: Top responsáveis / Motivos
function renderTopResponsaveis(leads) {
  const wrap = document.getElementById('dashTopResponsaveis');
  if (!wrap) return;
  const counts = {};
  leads.forEach(l => { counts[l.responsavel] = (counts[l.responsavel] || 0) + 1; });
  const top = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,3);
  if (!top.length) { wrap.innerHTML = '<p class="empty-state" style="margin:0">Sem dados</p>'; return; }
  const max = top[0][1];
  wrap.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      ${top.map(([name, count], i) => `
        <div style="display:grid;grid-template-columns:24px 1fr 50px;align-items:center;gap:10px">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${['#165BFF','#A855F7','#10B981'][i]};color:#fff;font-size:11px;font-weight:600">${i+1}</span>
          <div>
            <div style="font:500 13px 'Inter';color:var(--text-primary)">${escapeHtml(name)}</div>
            <div style="height:6px;background:var(--gray-200);border-radius:999px;overflow:hidden;margin-top:4px"><span style="display:block;height:100%;width:${(count/max)*100}%;background:${['#165BFF','#A855F7','#10B981'][i]};border-radius:999px"></span></div>
          </div>
          <span style="font:600 14px 'Inter';color:var(--text-primary);text-align:right">${count}</span>
        </div>`).join('')}
    </div>`;
}
function renderPenMotivos(leads) {
  const wrap = document.getElementById('dashPenMotivos');
  if (!wrap) return;
  // Heurística: extrai palavras-chave das observações
  const buckets = { 'Sem contato inicial': 0, 'Aguardando retorno': 0, 'Sem interesse claro': 0, 'Outro': 0 };
  leads.forEach(l => {
    const o = (l.observacoes || '').toLowerCase();
    if (!o || o.includes('sem contato')) buckets['Sem contato inicial']++;
    else if (o.includes('retorno') || o.includes('aguardando')) buckets['Aguardando retorno']++;
    else if (o.includes('interesse') || o.includes('desistiu')) buckets['Sem interesse claro']++;
    else buckets['Sem contato inicial']++;
  });
  const list = Object.entries(buckets).sort((a,b)=>b[1]-a[1]);
  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">
      ${list.map(([motivo, count]) => `
        <div style="padding:10px 12px;background:var(--card-bg);border:1px solid var(--gray-100);border-radius:8px">
          <div style="font:500 12px 'Inter';color:var(--muted-text)">${escapeHtml(motivo)}</div>
          <div style="font:700 18px 'Inter';color:var(--text-primary);margin-top:4px">${count}</div>
        </div>`).join('')}
    </div>`;
}

// ----- Render: Funil por cadência
function renderFunil(funnel, sortBy = 'value') {
  const wrap = document.getElementById('dashFunilList');
  if (!wrap) return;
  const sorted = [...funnel].sort((a,b) => sortBy === 'value' ? b.value - a.value : b.count - a.count);
  const max = Math.max(...sorted.map(s => sortBy === 'value' ? s.value : s.count), 1);
  wrap.innerHTML = sorted.map(row => {
    const pct = ((sortBy === 'value' ? row.value : row.count) / max) * 100;
    return `
      <div class="funil-row" data-cadence="${row.id}">
        <span class="funil-row-name">${statusTag(row.id)}</span>
        <div class="funil-row-bar"><span style="width:${pct}%"></span></div>
        <span class="funil-row-count">${row.count}</span>
        <span class="funil-row-value">${formatBRL(row.value)}</span>
      </div>`;
  }).join('');
}
function renderFunilTable(funnel) {
  const wrap = document.getElementById('dashFunilTable');
  if (!wrap) return;
  const rows = funnel.flatMap(f => f.leads.map(l => ({ ...l, cadId: f.id, cadLabel: f.label })));
  if (!rows.length) { wrap.innerHTML = emptyStateHtml('Sem leads nas cadências no período'); return; }
  wrap.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Nome</th><th>Empresa</th><th>Data de entrada</th><th>Status atual</th><th>Valor de Faturamento</th></tr></thead>
        <tbody>
          ${rows.map(l => `
            <tr class="lead-row-clickable" data-lead-id="${l.id}">
              <td>${escapeHtml(l.cliente || l.responsavel || '—')}</td>
              <td>${escapeHtml(l.empresa)}</td>
              <td>${escapeHtml((l.createdAt||'').split(' ')[0])}</td>
              <td>${statusTag(l.status)}</td>
              <td>${formatBRL(l.honorarios||0)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ----- Render: Origem chart (donut)
let _origensChart = null;
function renderOrigensChart(origins) {
  const canvas = document.getElementById('chartOrigens');
  if (!canvas || typeof Chart === 'undefined') return;
  const labels = ORIGENS_FIXAS;
  const data   = labels.map(l => origins[l]?.count || 0);
  const colors = labels.map(l => ORIGEM_COLOR[l]);
  const total  = data.reduce((a,b)=>a+b,0);
  document.getElementById('dashOrigensTotal').innerHTML = `<strong>${total}</strong><span>leads</span>`;

  if (_origensChart) { _origensChart.destroy(); }
  _origensChart = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 3, borderColor: '#fff' }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#0F172A', padding: 10, cornerRadius: 8, titleColor: '#fff', bodyColor: '#E2E8F0',
          callbacks: { label: c => `${c.label}: ${c.parsed} (${total ? Math.round(c.parsed/total*100) : 0}%)` } }
      }
    }
  });
}
function renderOrigensLegend(origins) {
  const wrap = document.getElementById('dashOrigensLegend');
  if (!wrap) return;
  const total = Object.values(origins).reduce((s,o)=>s+o.count,0);
  wrap.innerHTML = ORIGENS_FIXAS.map(o => {
    const d = origins[o] || { count: 0 };
    const pct = total ? Math.round(d.count / total * 100) : 0;
    return `
      <li data-origem="${o}">
        <i style="background:${ORIGEM_COLOR[o]}"></i>
        <span class="ol-name">${escapeHtml(o)}</span>
        <span class="ol-count">${d.count}</span>
        <span class="ol-pct">${pct}%</span>
      </li>`;
  }).join('');
  // click para filtrar e mostrar leads
  wrap.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => {
      const origem = li.dataset.origem;
      wrap.querySelectorAll('li').forEach(x => x.classList.toggle('active', x === li));
      const body = document.getElementById('dashOrigensList');
      const filtered = (origins[origem]?.leads || []);
      if (!filtered.length) { body.innerHTML = emptyStateHtml('Sem leads dessa origem'); return; }
      body.innerHTML = `
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Empresa</th><th>Cadência</th><th>Responsável</th><th>Valor de Faturamento</th></tr></thead>
            <tbody>${filtered.map(l => `
              <tr class="lead-row-clickable" data-lead-id="${l.id}">
                <td>${escapeHtml(l.empresa)}</td>
                <td>${statusTag(l.status)}</td>
                <td>${escapeHtml(l.responsavel)}</td>
                <td>${formatBRL(l.honorarios||0)}</td>
              </tr>`).join('')}
          </tbody></table>
        </div>`;
      body.hidden = false;
    });
  });
}

// ----- Render: Temperatura bars
function renderTempBars(temps) {
  const wrap = document.getElementById('dashTempBars');
  if (!wrap) return;
  const max = Math.max(temps.frio.count, temps.morno.count, temps.quente.count, 1);
  const total = temps.frio.count + temps.morno.count + temps.quente.count;
  ['frio','morno','quente'].forEach(t => {
    const pct = (temps[t].count / max) * 100;
    const el = wrap.querySelector(`.temp-bar-${t}`);
    if (!el) return;
    el.querySelector('.temp-bar-count').textContent = temps[t].count;
    el.querySelector('.temp-bar-fill').style.width = pct + '%';
    el.querySelector('.temp-bar-trend').textContent = total ? Math.round(temps[t].count / total * 100) + '%' : '0%';
  });
  // click handlers
  wrap.querySelectorAll('.temp-bar').forEach(el => {
    el.addEventListener('click', () => {
      const t = el.dataset.temp;
      wrap.querySelectorAll('.temp-bar').forEach(x => x.classList.toggle('active', x === el));
      const body = document.getElementById('dashTempList');
      const filtered = temps[t]?.leads || [];
      if (!filtered.length) { body.innerHTML = emptyStateHtml('Sem leads dessa temperatura'); body.hidden = false; return; }
      body.innerHTML = `
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Empresa</th><th>Responsável</th><th>Último contato</th><th>Valor Faturamento</th></tr></thead>
            <tbody>${filtered.map(l => `
              <tr class="lead-row-clickable" data-lead-id="${l.id}">
                <td>${escapeHtml(l.empresa)}</td>
                <td>${escapeHtml(l.responsavel)}</td>
                <td>${escapeHtml(l.lastTouch||'—')}</td>
                <td>${formatBRL(l.honorarios||0)}</td>
              </tr>`).join('')}
          </tbody></table>
        </div>`;
      body.hidden = false;
    });
  });
}
function ensureTempBarsDom() {
  const wrap = document.getElementById('dashTempBars');
  if (!wrap || wrap.children.length) return;
  wrap.innerHTML = ['frio','morno','quente'].map(t => `
    <div class="temp-bar temp-bar-${t}" data-temp="${t}">
      <span class="temp-bar-name">${t[0].toUpperCase()+t.slice(1)}</span>
      <div class="temp-bar-track"><div class="temp-bar-fill" style="width:0%"></div></div>
      <span class="temp-bar-count">0</span>
      <span class="temp-bar-trend">0%</span>
    </div>`).join('');
}

// ----- Render: Honorários
function renderHonorarios(hon) {
  const maxCad = Math.max(...hon.byCadence.map(x => x.value), 1);
  const maxTemp = Math.max(...hon.byTemp.map(x => x.value), 1);
  document.getElementById('dashHonTotal').textContent = formatBRL(hon.total);
  document.getElementById('dashHonMeta').textContent = `${hon.count} leads · ticket médio ${formatBRL(hon.avg || 0)}`;
  document.getElementById('dashHonTrend').innerHTML = `<i data-lucide="trending-up"></i> Período atual`;
  document.getElementById('dashHonCadList').innerHTML = (hon.byCadence.length ? hon.byCadence : [{ id:'_', label:'Sem dados', value:0, count:0 }])
    .map(x => `
      <li>
        <span class="hl-name">${escapeHtml(x.label)} <span style="color:var(--muted-text);font-weight:400">· ${x.count}</span></span>
        <span class="hl-value">${formatBRL(x.value)}</span>
        <span class="hl-bar"><span style="width:${(x.value/maxCad)*100}%"></span></span>
      </li>`).join('');
  document.getElementById('dashHonTempList').innerHTML = hon.byTemp
    .map(x => `
      <li>
        <span class="hl-name"><span class="thermal-tag ${x.id}">${escapeHtml(x.label)}</span> <span style="color:var(--muted-text);font-weight:400;margin-left:6px">· ${x.count}</span></span>
        <span class="hl-value">${formatBRL(x.value)}</span>
        <span class="hl-bar"><span style="width:${(x.value/maxTemp)*100}%;background:${TEMP_COLOR[x.id]}"></span></span>
      </li>`).join('');
  if (window.initIcons) window.initIcons();
}

// ----- Render: Chips filtro de responsáveis (reuniões)
function renderReunRespChips() {
  const wrap = document.getElementById('dashReunRespChips');
  if (!wrap) return;
  const resps = [...new Set(meetings.map(m => m.responsavel).filter(Boolean))];
  wrap.innerHTML = resps.map(r => `<button type="button" class="chip-toggle" data-resp="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join('');
  // toggle
  wrap.querySelectorAll('.chip-toggle').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('active'));
  });
}

// ----- Render: Sidebar calendar (Próximos eventos)
function renderCalUpcoming() {
  const wrap = document.getElementById('calUpcoming');
  if (!wrap) return;
  const today = new Date(); today.setHours(0,0,0,0);
  const weekLater = new Date(today); weekLater.setDate(weekLater.getDate() + 7);
  const isAdmin = isCurrentUserAdmin();
  const userId = getCurrentUserId();
  let items = getFilteredMeetings()
    .filter(m => { const d = parseISODate(m.iso); return d >= today && d <= weekLater; });
  if (!isAdmin && userId) {
    items = items.filter(m => {
      const lead = leads.find(l => String(l.id) === String(m.leadId));
      if (!lead) return false;
      const membroId = lead._membroId || lead._ownerId;
      return membroId === userId;
    });
  }
  items = items
    .sort((a,b) => (a.iso+a.time).localeCompare(b.iso+b.time))
    .slice(0, 8);
  if (!items.length) { wrap.innerHTML = '<li class="empty-state"><i data-lucide="inbox"></i><p>Sem eventos próximos</p></li>'; if (window.initIcons) window.initIcons(); return; }
  wrap.innerHTML = items.map(m => {
    const d = parseISODate(m.iso);
    const tagCls = m.type === 'reuniao' ? 'tag-blue' : m.type === 'fiscal' ? 'tag-amber' : m.type === 'financeiro' ? 'tag-green' : 'tag-purple';
    const leadName = m.lead ? m.lead.nome : (m.cliente || '');
    const leadPhone = m.lead ? m.lead.telefone : (m.phone || '');
    return `
      <li class="event-item" data-meeting-id="${m.id}">
        <div class="event-date"><strong>${String(d.getDate()).padStart(2,'0')}</strong><span>${['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][d.getMonth()]}</span></div>
        <div class="event-bar" style="background:${meetingColor(m.type)}"></div>
        <div class="event-info">
          <p class="event-title">${escapeHtml(m.title)}</p>
          <p class="event-meta">${escapeHtml(m.time || '')}${leadName?' · '+escapeHtml(leadName):''}${leadPhone?' · '+escapeHtml(leadPhone):''}</p>
        </div>
        <span class="tag ${tagCls}">${meetingTypeLabel(m.type)}</span>
      </li>`;
  }).join('');
}

// ----- Render: Dashboard "Lembretes" widget (small, top 2)
function renderDashRemindersWidget() {
  const wrap = document.getElementById('dashRemindersWidget');
  if (!wrap) return;
  const today = new Date(); today.setHours(0,0,0,0);
  const items = meetings
    .filter(m => m.type === 'reuniao' && parseISODate(m.iso) >= today)
    .sort((a,b) => (a.iso+a.time).localeCompare(b.iso+b.time))
    .slice(0, 2);
  if (!items.length) { wrap.innerHTML = '<div class="empty-state" style="padding:20px"><i data-lucide="inbox"></i><p>Sem reuniões próximas</p></div>'; if (window.initIcons) window.initIcons(); return; }
  wrap.innerHTML = items.map(m => {
    const d = parseISODate(m.iso);
    const leadName = m.lead ? m.lead.nome : (m.cliente || '');
    return `
      <div class="reminder-event">
        <div class="reminder-event-time">
          <strong>${escapeHtml(m.time || '—')}</strong>
          <span>${m.duration ? m.duration + ' min' : formatBRShort(d)}</span>
        </div>
        <div class="reminder-event-info">
          <p class="reminder-event-title">${escapeHtml(m.title)}</p>
          <p class="reminder-event-meta">${escapeHtml(leadName || '')}</p>
        </div>
      </div>`;
  }).join('');
}

// ----- Render: Sub-cabeçalhos e trend pills
function renderDashSubHeaders(payload) {
  const r = payload.range;
  const fmt = `${formatBR(r.start)} — ${formatBR(r.end)}`;
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  set('dashTotalSub',  `${payload.current.length} leads no período · ${fmt}`);
  set('dashFinSub',    `${payload.metrics.finalizado.count} finalizados · ${fmt}`);
  set('dashAndSub',    `${payload.metrics.andamento.count} em andamento · ${fmt}`);
  set('dashPenSub',    `${payload.metrics.pendente.count} pendentes · ${fmt}`);
  set('dashReunSub',   `Reuniões no período · ${fmt} <span style="opacity:0.7">· sync com Calendário</span>`);
  set('dashFunilSub',  `Soma de leads e faturamento por cadência · ${fmt}`);
  set('dashOrigSub',   `Distribuição por origem (4 fixas) · ${fmt}`);
  set('dashTempSub',   `Frio · Morno · Quente · ${fmt}`);
  set('dashHonSub',    `Soma de faturamento no período · ${fmt}`);
  set('dashTotalTrend', trendPill(payload.metrics.total.var));
  set('dashFinTrend',   trendPill(payload.metrics.finalizado.var));
  set('dashAndTrend',   trendPill(payload.metrics.andamento.var));
  set('dashPenTrend',   trendPill(payload.metrics.pendente.var));
}

// ----- Render: Painel de reunião (filtro por chip)
function renderReunioesPanel(meetings) {
  const activeChips = document.querySelectorAll('#dashReunRespChips .chip-toggle.active');
  const filter = activeChips.length ? new Set([...activeChips].map(c => c.dataset.resp)) : null;
  const filtered = filter ? meetings.filter(m => filter.has(m.responsavel)) : meetings;
  const tbody = document.querySelector('#dashTableReunioes tbody');
  if (tbody) renderTableReunioes(tbody, filtered);
}

// ----- Render principal: 1 aba
function renderDashTab(tabId, payload) {
  const panel = document.querySelector(`.dash-panel[data-panel="${tabId}"]`);
  if (!panel) return;

  const leads = payload.current;
  const leadsFinalizados = leads.filter(l => getStatusCategory(l.status) === 'finalizado');
  const leadsAndamento   = leads.filter(l => getStatusCategory(l.status) === 'andamento');
  const leadsPendentes   = leads.filter(l => getStatusCategory(l.status) === 'pendente');

  if (tabId === 'total') {
    renderTableTotal(panel.querySelector('#dashTableTotal tbody'), leads);
  } else if (tabId === 'finalizados') {
    renderTableFinalizados(panel.querySelector('#dashTableFinalizados tbody'), leadsFinalizados);
  } else if (tabId === 'andamento') {
    renderTableAndamento(panel.querySelector('#dashTableAndamento tbody'), leadsAndamento);
    renderTopResponsaveis(leadsAndamento);
  } else if (tabId === 'pendentes') {
    renderTablePendentes(panel.querySelector('#dashTablePendentes tbody'), leadsPendentes);
    renderPenMotivos(leadsPendentes);
  } else if (tabId === 'reunioes') {
    renderReunioesPanel(payload.reminders);
  } else if (tabId === 'funil') {
    const sortBy = document.querySelector('#dashFunilSort .seg.active')?.dataset.sort || 'value';
    renderFunil(payload.funnel, sortBy);
    renderFunilTable(payload.funnel);
  } else if (tabId === 'origens') {
    renderOrigensChart(payload.origins);
    renderOrigensLegend(payload.origins);
  } else if (tabId === 'temperatura') {
    ensureTempBarsDom();
    renderTempBars(payload.temperatures);
  } else if (tabId === 'honorarios') {
    renderHonorarios(payload.honorarios);
  }
}

// ----- Render ALL (summary + active tab)
function renderDashAll(force = false) {
  let payload = force ? null : getCachedPayload();
  if (!payload) {
    // Aplicar filtro de centro de custo
    let filteredLeads = leads;
    if (dashCcFilter !== 'all') {
      filteredLeads = leads.filter(l => l._centroCustoId === dashCcFilter);
    }
    // Se NÃO é Administrador, filtrar apenas leads do próprio usuário
    const isAdmin = _userPermCache && _userPermCache.perfil === 'Administrador';
    if (!isAdmin) {
      const userId = getCurrentUserId();
      if (userId) {
        filteredLeads = filteredLeads.filter(l => {
          const membroId = l._membroId || l._ownerId;
          const qualificadorId = l._qualificadorId;
          if (membroId === userId || qualificadorId === userId) return true;
          return false;
        });
      }
    }
    const metrics = computeAllMetrics(filteredLeads);
    payload = {
      ...metrics,
      origins:      computeOrigins(metrics.current),
      temperatures: computeTemperatures(metrics.current),
      funnel:       computeCadenceFunnel(metrics.current),
      reminders:    computeReminders(filteredLeads),
      honorarios:   computeHonorarios(metrics.current)
    };
    setCachedPayload(payload);
  }
  // filtros secundários populam selects (uma vez)
  populateFilterSelects();
  renderDashSubHeaders(payload);
  renderDashSummary(payload);
  renderDashTab(dashState.activeTab, payload);
  const upd = document.getElementById('dashUpdated');
  if (upd) {
    upd.innerHTML = `<i data-lucide="clock" style="width:12px;height:12px"></i> atualizado ${timeAgo(dashState.cache.ts)}`;
    if (window.initIcons) window.initIcons();
  }
  // sync indicator (lembretes)
  const sync = document.getElementById('dashSyncIndicator');
  if (sync) sync.innerHTML = `<i data-lucide="refresh-cw"></i> sincronizado ${timeAgo(dashState.cache.ts)}`;
  if (window.initIcons) window.initIcons();
  // renderiza também os widgets que precisam estar atualizados fora do dashboard
  renderCalUpcoming();
  renderDashRemindersWidget();
}

// ----- Trocar aba
function setDashTab(tabId) {
  dashState.activeTab = tabId;
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('.dash-panel').forEach(p => p.hidden = p.dataset.panel !== tabId);
  const p = getCachedPayload();
  if (p) renderDashTab(tabId, p);
}

// ----- Popular selects de filtro secundário
let _selectsPopulated = false;
function populateFilterSelects() {
  if (_selectsPopulated) return;
  const resps = [...new Set(leads.map(l => l.responsavel).filter(Boolean))].sort();
  const selR = document.getElementById('dashFilterResponsavel');
  if (selR) selR.innerHTML = '<option value="">Todos os responsáveis</option>' + resps.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
  const selC = document.getElementById('dashFilterCadencia');
  if (selC) selC.innerHTML = '<option value="">Todas as cadências</option>' + getVisibleCadences().map(c => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('');
  _selectsPopulated = true;
}

// ----- Exports (CSV / XLSX / PDF)
function exportData(format) {
  const p = getCachedPayload();
  if (!p) return;
  const tabId = dashState.activeTab;
  let rows = [];
  let filename = `dashboard-${tabId}`;

  if (tabId === 'total') {
    rows = p.current.map(l => ({ Empresa: l.empresa, Cadência: cadences.find(c=>c.id===l.status)?.label||l.status, Temperatura: l.thermal, Origem: normalizeOrigin(l.origem), Responsável: l.responsavel, 'Valor de Faturamento': l.honorarios||0, Entrada: (l.createdAt||'').split(' ')[0], 'Último contato': l.lastTouch||'' }));
  } else if (tabId === 'finalizados') {
    rows = p.current.filter(l => getStatusCategory(l.status)==='finalizado').map(l => ({ Empresa: l.empresa, 'Cadência final': cadences.find(c=>c.id===l.status)?.label||l.status, Origem: normalizeOrigin(l.origem), Responsável: l.responsavel, 'Valor de Faturamento': l.honorarios||0, 'Concluído em': (l.createdAt||'').split(' ')[0] }));
  } else if (tabId === 'andamento') {
    rows = p.current.filter(l => getStatusCategory(l.status)==='andamento').map(l => ({ Empresa: l.empresa, 'Cadência atual': cadences.find(c=>c.id===l.status)?.label||l.status, Origem: normalizeOrigin(l.origem), Responsável: l.responsavel, 'Valor de Faturamento': l.honorarios||0, 'Último contato': l.lastTouch||'' }));
  } else if (tabId === 'pendentes') {
    rows = p.current.filter(l => getStatusCategory(l.status)==='pendente').map(l => ({ Empresa: l.empresa, Cadência: cadences.find(c=>c.id===l.status)?.label||l.status, Origem: normalizeOrigin(l.origem), Responsável: l.responsavel, 'Valor de Faturamento': l.honorarios||0, 'Último contato': l.lastTouch||'' }));
  } else if (tabId === 'reunioes') {
    rows = p.reminders.map(m => ({ Dia: m.iso, Horário: m.time||'', Cliente: m.cliente||'', Empresa: m.empresa, Responsável: m.responsavel||'', Tipo: meetingTypeLabel(m.type) }));
  } else if (tabId === 'funil') {
    rows = p.funnel.flatMap(f => f.leads.map(l => ({ Cadência: f.label, Nome: l.responsavel||'', Empresa: l.empresa, 'Data de entrada': (l.createdAt||'').split(' ')[0], 'Status atual': cadences.find(c=>c.id===l.status)?.label||l.status, 'Valor de Faturamento': l.honorarios||0 })));
  } else if (tabId === 'origens') {
    rows = [];
    ORIGENS_FIXAS.forEach(o => (p.origins[o]?.leads || []).forEach(l => rows.push({ Origem: o, Empresa: l.empresa, Cadência: cadences.find(c=>c.id===l.status)?.label||l.status, Responsável: l.responsavel, 'Valor de Faturamento': l.honorarios||0 })));
  } else if (tabId === 'temperatura') {
    rows = [];
    ['frio','morno','quente'].forEach(t => (p.temperatures[t]?.leads || []).forEach(l => rows.push({ Temperatura: t, Empresa: l.empresa, Responsável: l.responsavel, 'Último contato': l.lastTouch||'', 'Valor de Faturamento': l.honorarios||0 })));
  } else if (tabId === 'honorarios') {
    rows = p.current.filter(l => (l.honorarios||0) > 0).map(l => ({ Empresa: l.empresa, Cadência: cadences.find(c=>c.id===l.status)?.label||l.status, Temperatura: l.thermal, Responsável: l.responsavel, 'Valor de Faturamento': l.honorarios }));
  }

  if (!rows.length) { alert('Nenhum dado para exportar neste painel.'); return; }
  filename = `blue-${tabId}-${formatBR(new Date()).replace(/\//g,'-')}`;

  if (format === 'csv') downloadCSV(filename + '.csv', rows);
  else if (format === 'xlsx') downloadXLSX(filename + '.xls', rows);
  else if (format === 'pdf') downloadPrintable(filename, rows, tabId);
}
function downloadCSV(name, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, name);
}
function downloadXLSX(name, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  // SpreadsheetML 2003 — Excel/LibreOffice abrem direto
  const cell = (v) => `<Cell><Data ss:Type="String">${escapeHtml(String(v ?? ''))}</Data></Cell>`;
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Dados"><Table>
    <Row>${cols.map(c => `<Cell ss:StyleID="hdr"><Data ss:Type="String">${escapeHtml(c)}</Data></Cell>`).join('')}</Row>
    ${rows.map(r => `<Row>${cols.map(c => cell(r[c])).join('')}</Row>`).join('')}
  </Table></Worksheet>
</Workbook>`;
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  triggerDownload(blob, name);
}
function downloadPrintable(name, rows, tabId) {
  const cols = Object.keys(rows[0]);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title>
    <style>
      body { font: 13px 'Inter', sans-serif; color: #1F2D3D; padding: 24px; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      p { color: #6B7885; margin: 0 0 16px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #E5E7EB; }
      th { background: #F7F8FA; font-weight: 600; }
      tr:nth-child(even) td { background: #FAFBFC; }
    </style></head><body>
    <h1>Dashboard · ${escapeHtml(tabId)}</h1>
    <p>${escapeHtml(name)} · gerado em ${new Date().toLocaleString('pt-BR')}</p>
    <table><thead><tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${escapeHtml(String(r[c]??''))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
    <script>window.onload = () => { window.print(); }<\/script>
    </body></html>`;
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}
function triggerDownload(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
}

// ----- Init: bind dashboard events
function initDashboard() {
  // Periodo segmented
  document.querySelectorAll('#dashPeriodSeg .seg').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#dashPeriodSeg .seg').forEach(b => b.classList.toggle('active', b === btn));
      dashState.period = btn.dataset.period;
      const custom = document.getElementById('dashCustomRange');
      if (custom) custom.hidden = dashState.period !== 'custom';
      if (dashState.period === 'custom' && !dashState.startDate) {
        const today = new Date();
        const ago = new Date(); ago.setDate(ago.getDate() - 30);
        document.getElementById('dashStartDate').value = ago.toISOString().slice(0,10);
        document.getElementById('dashEndDate').value = today.toISOString().slice(0,10);
        dashState.startDate = ago.toISOString().slice(0,10);
        dashState.endDate = today.toISOString().slice(0,10);
      }
      invalidateDashCache();
      renderDashAll();
    });
  });
  // Qtd dias
  const daysInput = document.getElementById('dashDaysInput');
  if (daysInput) {
    daysInput.addEventListener('change', () => {
      let n = parseInt(daysInput.value, 10);
      if (isNaN(n) || n < 1) n = 30;
      if (n > 365) n = 365;
      daysInput.value = n;
      dashState.days = n;
      // se não está em modo "custom", muda para "days" implícito (mantém o botão ativo)
      // (a função getPeriodRange trata 7d/30d vs days)
      invalidateDashCache();
      renderDashAll();
    });
  }
  // Custom range
  ['dashStartDate','dashEndDate'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      dashState.startDate = document.getElementById('dashStartDate').value;
      dashState.endDate   = document.getElementById('dashEndDate').value;
      // muda automaticamente para "custom"
      document.querySelectorAll('#dashPeriodSeg .seg').forEach(b => b.classList.toggle('active', b.dataset.period === 'custom'));
      dashState.period = 'custom';
      invalidateDashCache();
      renderDashAll();
    });
  });
  // Refresh
  const refresh = document.getElementById('dashRefreshBtn');
  if (refresh) refresh.addEventListener('click', () => { invalidateDashCache(); renderDashAll(true); toast('Dashboard atualizado'); });
  // Tabs
  document.querySelectorAll('#dashTabs .dash-tab').forEach(tab => {
    tab.addEventListener('click', () => setDashTab(tab.dataset.tab));
  });
  // Filtros secundários
  ['dashFilterResponsavel','dashFilterCadencia','dashFilterOrigem','dashFilterTemp'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      const k = el.dataset.filter;
      dashState.filters[k] = el.value;
      invalidateDashCache();
      renderDashAll();
    });
  });
  // Limpar filtros
  const clearF = document.getElementById('dashClearFilters');
  if (clearF) clearF.addEventListener('click', () => {
    dashState.filters = { responsavel:'', cadencia:'', origem:'', thermal:'' };
    ['dashFilterResponsavel','dashFilterCadencia','dashFilterOrigem','dashFilterTemp'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    invalidateDashCache();
    renderDashAll();
  });
  // Expand toggles
  document.querySelectorAll('.dash-expand-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('open');
      const body = btn.parentElement.querySelector('.dash-expand-body');
      if (body) body.hidden = !btn.classList.contains('open');
    });
  });
  // Funil sort
  document.querySelectorAll('#dashFunilSort .seg').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#dashFunilSort .seg').forEach(b => b.classList.toggle('active', b === btn));
      const p = getCachedPayload();
      if (p) renderFunil(p.funnel, btn.dataset.sort);
    });
  });
  // Export menu
  const expBtn = document.getElementById('dashExportBtn');
  const expMenu = document.getElementById('dashExportDropdown');
  if (expBtn && expMenu) {
    expBtn.addEventListener('click', (e) => { e.stopPropagation(); expMenu.hidden = !expMenu.hidden; });
    document.addEventListener('click', () => { expMenu.hidden = true; });
    expMenu.querySelectorAll('button[data-format]').forEach(b => {
      b.addEventListener('click', (e) => { e.stopPropagation(); expMenu.hidden = true; exportData(b.dataset.format); });
    });
  }
  // Nova reunião (placeholder rápido)
  const newReun = document.getElementById('dashNovaReuniaoBtn');
  if (newReun) newReun.addEventListener('click', () => addMeetingPrompt());
  // Open lead row
  document.body.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-lead-id]');
    if (row) {
      const id = row.dataset.leadId;
      const lead = leads.find(l => String(l.id) === String(id));
      if (lead && typeof openLeadModal === 'function') {
        // leva o usuário até o CRM
        if (typeof setActivePage === 'function') setActivePage('crm');
        setTimeout(() => openLeadModal(id), 220);
      }
    }
    const mrow = e.target.closest('tr[data-meeting-id]');
    if (mrow) {
      const id = mrow.dataset.meetingId;
      const meeting = meetings.find(m => String(m.id) === String(id));
      if (meeting) toast(`Reunião: ${meeting.title} · ${meeting.iso} ${meeting.time||''}`);
    }
    const mli = e.target.closest('li.event-item');
    if (mli) {
      const id = mli.dataset.meetingId;
      const meeting = meetings.find(m => String(m.id) === String(id));
      if (meeting?.leadId && typeof openLeadModal === 'function') {
        if (typeof setActivePage === 'function') setActivePage('crm');
        setTimeout(() => openLeadModal(meeting.leadId), 220);
      }
    }
  });
  // Chips de responsáveis (reunião) — re-render ao clicar
  const reunChips = document.getElementById('dashReunRespChips');
  if (reunChips) reunChips.addEventListener('click', () => {
    const p = getCachedPayload();
    if (p) renderReunioesPanel(p.reminders);
  });
  // Dashboard: filtro por centro de custo
  initDashCcFilter();
}

function addMeetingPrompt() {
  const titulo = prompt('Título da reunião:');
  if (!titulo) return;
  const data = prompt('Data (AAAA-MM-DD):', new Date().toISOString().slice(0,10));
  if (!data) return;
  const hora = prompt('Horário (HH:MM):', '10:00') || '10:00';
  const id = Math.max(...meetings.map(m=>m.id), 0) + 1;
  meetings.push({ id, iso: data, time: hora, duration: 30, title: titulo, cliente: '', empresa: 'A definir', responsavel: 'Camila', type: 'reuniao', leadId: null, status: 'agendada' });
  rebuildCalendarEvents();
  invalidateDashCache();
  if (typeof renderCalendar === 'function') renderCalendar();
  renderCalUpcoming();
  renderDashRemindersWidget();
  renderDashAll();
  toast('Reunião adicionada e sincronizada');
}

/* ============================================
   CALENDAR EVENT MODAL
   ============================================ */
let calEventEditId = null;

function openCalEventModal(isoDate, meetingId) {
  calEventEditId = meetingId || null;
  const modal = $('#calEventModal');
  const overlay = $('#calEventOverlay');
  const isEdit = calEventEditId !== null;

  // Title
  $('#calEventTitle').textContent = isEdit ? 'Editar evento' : 'Adicionar evento';
  $('#calEventDeleteBtn').style.display = isEdit ? '' : 'none';

  // Date
  const dateStr = isoDate || new Date().toISOString().slice(0, 10);
  $('#calEventDate').value = dateStr;
  const d = parseISODate(dateStr);
  const monthNames = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  $('#calEventDateLabel').textContent = `${d.getDate()} de ${monthNames[d.getMonth()]} de ${d.getFullYear()}`;

  // Clear errors
  $$('#calEventModal .form-error').forEach(e => e.textContent = '');
  $$('#calEventModal .invalid').forEach(e => e.classList.remove('invalid'));

  if (isEdit) {
    const m = meetings.find(ev => String(ev.id) === String(calEventEditId));
    if (m) {
      $('#calEventInputTitle').value = m.title || '';
      $('#calEventType').value = m.type || '';
      $('#calEventClient').value = m.lead ? m.lead.nome : (m.cliente || '');
      $('#calEventClientId').value = m.leadId || '';
      $('#calEventPhone').value = m.lead ? m.lead.telefone : (m.phone || '');
      $('#calEventLocation').value = m.location || '';
      $('#calEventDate').value = m.iso || dateStr;
      $('#calEventTimeStart').value = m.time || '09:00';
      $('#calEventTimeEnd').value = m.timeEnd || '';
      $('#calEventTemperature').value = m.temperature || '';
      $('#calEventHon').value = m.honorarios ? m.honorarios.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
      $('#calEventNotes').value = m.notes || '';
      // Color
      const color = m.color || '#2F80ED';
      $('#calEventColor').value = color;
      $$('#calEventColorPicker .color-swatch').forEach(s => {
        const isActive = s.dataset.color === color;
        s.setAttribute('aria-checked', isActive);
      });
      // Duration
      if (m.time && m.timeEnd) {
        const [sh, sm] = m.time.split(':').map(Number);
        const [eh, em] = m.timeEnd.split(':').map(Number);
        const dur = (eh * 60 + em) - (sh * 60 + sm);
        if (dur > 0) {
          const h = Math.floor(dur / 60);
          const min = dur % 60;
          $('#calEventDuration').value = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        } else {
          $('#calEventDuration').value = '';
        }
      } else if (m.duration) {
        $('#calEventDuration').value = m.duration;
      } else {
        $('#calEventDuration').value = '';
      }
      // Services chips — resolve UUIDs to names (deferred to after loadCalServiceChips)
      const rawServices = m.servicos || m.services || [];
      window._calEventEditSvcNames = rawServices.map(s => window._servicosById && window._servicosById[s] ? window._servicosById[s].nome : s);
    }
  } else {
    // Clear form
    $$('#calEventModal [name]').forEach(el => {
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
      else if (el.name === 'calTimeStart') el.value = '09:00';
      else if (el.name === 'calDate') el.value = dateStr;
      else el.value = '';
    });
    $$('#calEventServices .chip-toggle').forEach(c => c.classList.remove('active'));
    window._calEventEditSvcNames = [];
    $('#calEventDuration').value = '';
    // Reset color to default
    $('#calEventColor').value = '#2F80ED';
    $$('#calEventColorPicker .color-swatch').forEach(s => {
      s.setAttribute('aria-checked', s.dataset.color === '#2F80ED');
    });
  }

  // Populate empresa dropdown
  const empresaSelect = $('#calEventEmpresa');
  if (empresaSelect) {
    const isAdmin = isCurrentUserAdmin();
    const empresas = isAdmin
      ? centrosCustoData
      : centrosCustoData.filter(cc => currentUser.centro_custo_ids?.includes(cc.id));
    empresaSelect.innerHTML = '<option value="">Selecione uma empresa...</option>';
    empresas.forEach(cc => {
      const opt = document.createElement('option');
      opt.value = cc.id;
      opt.textContent = cc.nome;
      empresaSelect.appendChild(opt);
    });

    if (isEdit) {
      const m = meetings.find(ev => String(ev.id) === String(calEventEditId));
      if (m && m.empresa_id) {
        empresaSelect.value = m.empresa_id;
      }
    }

    // On change: filter services and clear previously selected chips
    empresaSelect.onchange = () => {
      const selectedId = empresaSelect.value;
      $$('#calEventServices .chip-toggle').forEach(c => c.classList.remove('active'));
      loadCalServiceChips(selectedId || undefined);
    };

    // Load initial services based on selected empresa (with edit pre-selection if applicable)
    const editSvcNames = window._calEventEditSvcNames || [];
    delete window._calEventEditSvcNames;
    loadCalServiceChips(empresaSelect.value || undefined, editSvcNames.length > 0 ? editSvcNames : undefined);
  }

  // Bind honorários mask
  bindCalHonMask();

  // Bind phone mask
  bindCalPhoneMask();

  // Bind time/duration bidirectional sync
  const timeStart = $('#calEventTimeStart');
  const timeEnd = $('#calEventTimeEnd');
  const durEl = $('#calEventDuration');

  const calcDurFromTimes = () => {
    if (timeStart.value && timeEnd.value) {
      const [sh, sm] = timeStart.value.split(':').map(Number);
      const [eh, em] = timeEnd.value.split(':').map(Number);
      const dur = (eh * 60 + em) - (sh * 60 + sm);
      if (dur > 0) {
        const h = Math.floor(dur / 60);
        const m = dur % 60;
        durEl.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      } else {
        durEl.value = '';
      }
    } else {
      durEl.value = '';
    }
  };

  const calcEndFromDuration = () => {
    if (!timeStart.value || !durEl.value) return;
    const parts = durEl.value.split(':');
    const dur = parts.length === 2 ? (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0) : parseInt(durEl.value, 10);
    if (isNaN(dur) || dur < 0) return;
    const [sh, sm] = timeStart.value.split(':').map(Number);
    const totalMin = sh * 60 + sm + dur;
    const eh = Math.floor(totalMin / 60) % 24;
    const em = totalMin % 60;
    timeEnd.value = `${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`;
  };

  timeStart.onchange = () => { calcDurFromTimes(); };
  timeEnd.onchange = () => { calcDurFromTimes(); };
  durEl.oninput = () => { calcEndFromDuration(); };
  durEl.onchange = () => { calcEndFromDuration(); };

  // Bind client autocomplete
  bindCalClientAutocomplete();

  // Bind chip toggles
  modal.querySelectorAll('.chip-toggle').forEach(chip => {
    chip.onclick = () => chip.classList.toggle('active');
  });

  // Bind color picker
  $$('#calEventColorPicker .color-swatch').forEach(swatch => {
    swatch.onclick = () => {
      $$('#calEventColorPicker .color-swatch').forEach(s => s.setAttribute('aria-checked', 'false'));
      swatch.setAttribute('aria-checked', 'true');
      $('#calEventColor').value = swatch.dataset.color;
    };
    swatch.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); swatch.click(); }
    };
  });

  // === AUTHORIZATION: read-only vs editable ===
  const currentMeeting = isEdit ? meetings.find(ev => String(ev.id) === String(calEventEditId)) : null;
  const readOnly = isEdit && currentMeeting && isReadOnly(currentMeeting);

  const allInputs = modal.querySelectorAll('input, select, textarea');
  const saveBtn = $('#calEventSaveBtn');
  const deleteBtn = $('#calEventDeleteBtn');
  const readOnlyBadge = $('#calEventReadOnlyBadge');

  if (readOnly) {
    allInputs.forEach(el => { el.disabled = true; el.setAttribute('tabindex', '-1'); });
    modal.querySelectorAll('.chip-toggle').forEach(c => { c.style.pointerEvents = 'none'; c.style.opacity = '0.5'; });
    modal.querySelectorAll('.color-swatch').forEach(s => { s.style.pointerEvents = 'none'; s.style.opacity = '0.5'; });
    if (saveBtn) saveBtn.style.display = 'none';
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (readOnlyBadge) { readOnlyBadge.style.display = ''; readOnlyBadge.textContent = 'Somente leitura'; }
    $('#calEventTitle').textContent = 'Visualizar evento';
  } else {
    allInputs.forEach(el => { el.disabled = false; el.removeAttribute('tabindex'); });
    modal.querySelectorAll('.chip-toggle').forEach(c => { c.style.pointerEvents = ''; c.style.opacity = ''; });
    modal.querySelectorAll('.color-swatch').forEach(s => { s.style.pointerEvents = ''; s.style.opacity = ''; });
    if (saveBtn) saveBtn.style.display = isEdit ? '' : '';
    if (deleteBtn) deleteBtn.style.display = isEdit ? '' : 'none';
    if (readOnlyBadge) readOnlyBadge.style.display = 'none';
  }

  // Show
  modal.classList.add('open');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  initIcons();

  setTimeout(() => { const first = $('#calEventInputTitle'); if (first && !readOnly) first.focus(); }, 50);
}

function closeCalEventModal() {
  const modal = $('#calEventModal');
  modal.classList.remove('open');
  $('#calEventOverlay').classList.remove('open');
  document.body.style.overflow = '';
  calEventEditId = null;
  // Reset read-only state
  modal.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = false; el.removeAttribute('tabindex'); });
  modal.querySelectorAll('.chip-toggle').forEach(c => { c.style.pointerEvents = ''; c.style.opacity = ''; });
  modal.querySelectorAll('.color-swatch').forEach(s => { s.style.pointerEvents = ''; s.style.opacity = ''; });
  const saveBtn = $('#calEventSaveBtn');
  const deleteBtn = $('#calEventDeleteBtn');
  if (saveBtn) saveBtn.style.display = '';
  if (deleteBtn) deleteBtn.style.display = 'none';
  const badge = $('#calEventReadOnlyBadge');
  if (badge) badge.style.display = 'none';
}

/* ============================================
   COMPACT EVENT POPUP (single click)
   ============================================ */
function openCalEventPopup(iso, meetingId) {
  const m = meetings.find(ev => String(ev.id) === String(meetingId));
  if (!m) return;
  const popup = $('#calEventPopup');
  if (!popup) return;

  $('#calPopupTitle').textContent = m.title || '';
  const d = parseISODate(m.iso || iso);
  const dayNames = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  const monthNames = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  $('#calPopupDate').textContent = d ? `${dayNames[d.getDay()]}, ${d.getDate()} de ${monthNames[d.getMonth()]} de ${d.getFullYear()}` : iso;

  // Time
  const timeStart = m.time || '';
  const timeEnd = m.timeEnd || '';
  $('#calPopupTimeStart').textContent = timeStart || '--:--';
  const endEl = $('#calPopupTimeEnd');
  if (timeEnd) {
    endEl.textContent = ` até ${timeEnd}`;
  } else {
    endEl.textContent = '';
  }

  // Phone
  const phone = m.lead ? m.lead.telefone : (m.phone || '');
  const phoneRow = $('#calPopupPhoneRow');
  if (phone) {
    $('#calPopupPhone').textContent = phone;
    phoneRow.style.display = '';
  } else {
    phoneRow.style.display = 'none';
  }

  // Location
  const loc = m.location || '';
  const locEl = $('#calPopupLocation');
  const locRow = $('#calPopupLocationRow');
  if (loc) {
    locEl.textContent = loc;
    locEl.title = loc;
    locRow.style.display = '';
  } else {
    locRow.style.display = 'none';
  }

  // Color
  $('#calPopupColor').style.background = m.color || '#2F80ED';

  // Services chips
  const svcWrap = $('#calPopupServices');
  const svcList = normalizeServices(m.servicos || m.services || []);
  if (svcList.length) {
    svcWrap.innerHTML = svcList.map(s =>
      `<span class="cal-popup-svc-chip">${escapeHtml(s)}</span>`
    ).join('');
    svcWrap.style.display = '';
  } else {
    svcWrap.innerHTML = '';
    svcWrap.style.display = 'none';
  }

  popup.hidden = false;
  popup.dataset.meetingId = meetingId;
  popup.dataset.iso = iso;
  initIcons();
  popup.focus();

  popup.style.left = '';
  popup.style.top = '';
}

function closeCalEventPopup() {
  const popup = $('#calEventPopup');
  if (popup) popup.hidden = true;
}

/* ============================================
   POPUP: Editar Lead do Calendário
   ============================================ */
let calLeadPopupMeetingId = null;

function openLeadEditPopup(meetingId) {
  const m = meetings.find(ev => String(ev.id) === String(meetingId));
  if (!m || !m.leadId) return;

  const lead = leads.find(l => String(l.id) === String(m.leadId));
  if (!lead) return;

  calLeadPopupMeetingId = meetingId;
  const popup = $('#calLeadPopup');
  if (!popup) return;

  $('#calLeadPopupTitle').textContent = lead.empresa || 'Editar lead';
  $('#calLeadPopupColor').style.background = m.color || meetingColor(m.type);

  $('#calLeadPopupNome').value = lead.empresa || '';
  $('#calLeadPopupTelefone').value = lead.telefone || '';
  $('#calLeadPopupEndereco').value = lead.dataEvento || '';
  $('#calLeadPopupTemperatura').value = lead.thermal || '';
  $('#calLeadPopupHon').value = lead.honorarios ? lead.honorarios.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
  $('#calLeadPopupObs').value = '';

  // Desabilitar campo telefone se não tem permissão de exclusão
  const calTelField = $('#calLeadPopupTelefone');
  if (calTelField) {
    if (!canDeleteClienteTelefone()) {
      calTelField.readOnly = true;
      calTelField.title = 'Você não tem permissão para alterar o telefone deste cliente.';
      calTelField.style.opacity = '0.6';
      calTelField.style.cursor = 'not-allowed';
    } else {
      calTelField.readOnly = false;
      calTelField.title = '';
      calTelField.style.opacity = '';
      calTelField.style.cursor = '';
    }
  }

  popup.hidden = false;
  popup.dataset.meetingId = meetingId;
  popup.dataset.leadId = m.leadId;
  initIcons();
  popup.focus();

  popup.style.left = '';
  popup.style.top = '';
}

function closeLeadEditPopup() {
  const popup = $('#calLeadPopup');
  if (popup) popup.hidden = true;
  calLeadPopupMeetingId = null;
}

function saveLeadFromCalendar() {
  const popup = $('#calLeadPopup');
  if (!popup) return;
  const leadId = popup.dataset.leadId;
  if (!leadId) return;

  const lead = leads.find(l => String(l.id) === String(leadId));
  if (!lead) return;

  const nome = $('#calLeadPopupNome').value.trim();
  const telefone = $('#calLeadPopupTelefone').value.trim();
  const endereco = $('#calLeadPopupEndereco').value.trim();
  const temperatura = $('#calLeadPopupTemperatura').value;
  const honStr = $('#calLeadPopupHon').value.replace(/\D/g, '');
  const honorarios = honStr ? parseInt(honStr, 10) / 100 : 0;
  const obs = $('#calLeadPopupObs').value.trim();

  lead.empresa = nome || lead.empresa;
  // Proteção: não apagar telefone sem permissão
  if (!telefone && lead.telefone && !canDeleteClienteTelefone()) {
    lead.telefone = lead.telefone;
    toast('Você não tem permissão para apagar o telefone do cliente.', 'error');
  } else {
    lead.telefone = telefone;
  }
  lead.dataEvento = endereco;
  lead.thermal = temperatura || lead.thermal;
  lead.honorarios = honorarios;

  const saveBtn = $('#calLeadPopupSaveBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i data-lucide="loader"></i>'; initIcons(); }

  async function doSave() {
    try {
      await updateLeadSupabase(leadId, {
        nome: lead.empresa,
        telefone: lead.telefone,
        endereco_evento: lead.dataEvento,
        temperatura: lead.thermal,
        honorarios: lead.honorarios
      });
      toast('Lead atualizado no Supabase');
    } catch (err) {
      console.error('[Calendário] Erro ao atualizar lead:', err);
      toast('Salvo localmente. Erro ao sincronizar: ' + (err.message || err), 'error');
    }

    rebuildCalendarEvents();
    renderCalendar();
    renderCalUpcoming();
    renderDashRemindersWidget();
    closeLeadEditPopup();
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i data-lucide="check"></i>'; initIcons(); }
  }
  doSave();
}

function bindCalHonMask() {
  const honEl = $('#calEventHon');
  if (!honEl) return;

  const newHonEl = honEl.cloneNode(true);
  honEl.parentNode.replaceChild(newHonEl, honEl);

  const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function formatDisplay(val) {
    if (val == null || isNaN(val) || val === 0) return '';
    return fmt.format(val);
  }

  function parseInput(str) {
    const digits = str.replace(/\D/g, '');
    if (!digits) return 0;
    return parseInt(digits, 10) / 100;
  }

  newHonEl.addEventListener('input', () => {
    const val = parseInput(newHonEl.value);
    newHonEl.value = formatDisplay(val);
    const len = newHonEl.value.length;
    newHonEl.setSelectionRange(len, len);
  });

  newHonEl.addEventListener('blur', () => {
    const val = parseInput(newHonEl.value);
    newHonEl.value = formatDisplay(val);
  });

  newHonEl.addEventListener('focus', () => {
    const val = parseInput(newHonEl.value);
    const raw = val > 0 ? String(Math.round(val * 100)) : '';
    newHonEl.value = raw;
    newHonEl.setSelectionRange(raw.length, raw.length);
  });
}

function bindCalPhoneMask() {
  const el = $('#calEventPhone');
  if (!el) return;
  el.addEventListener('input', () => {
    let digits = el.value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 10) {
      // (XX) XXXX-XXXX
      digits = digits.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
    } else {
      // (XX) XXXXX-XXXX
      digits = digits.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
    }
    el.value = digits;
  });
}

function bindCalClientAutocomplete() {
  const input = $('#calEventClient');
  const dropdown = $('#calClientDropdown');
  const hiddenId = $('#calEventClientId');
  if (!input || !dropdown) return;

  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const q = input.value.toLowerCase().trim();
      if (q.length < 1) { dropdown.hidden = true; dropdown.classList.remove('open'); return; }
      const allClients = [...clientsData.map(c => ({ name: c.name, phone: c.telefone || '', services: c.services, id: c.id })),
                          ...leads.map(l => ({ name: l.empresa, phone: l.telefone, services: normalizeServices(l.servicos), id: l.id }))];
      const matches = allClients.filter(c => c.name.toLowerCase().includes(q)).slice(0, 6);
      if (!matches.length) { dropdown.hidden = true; dropdown.classList.remove('open'); return; }
      dropdown.innerHTML = matches.map(c =>
        `<button type="button" class="autocomplete-item" data-client-name="${escapeHtml(c.name)}" data-client-phone="${escapeHtml(c.phone)}" data-client-id="${c.id}">${escapeHtml(c.name)}<small>${escapeHtml(c.phone || '')}</small></button>`
      ).join('');
      dropdown.hidden = false;
      dropdown.classList.add('open');
      dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', () => {
          input.value = item.dataset.clientName;
          hiddenId.value = item.dataset.clientId;
          if (item.dataset.clientPhone) $('#calEventPhone').value = item.dataset.clientPhone;
          // Auto-fill services
          const client = clientsData.find(c => c.name === item.dataset.clientName);
          const lead = leads.find(l => l.empresa === item.dataset.clientName);
          const services = client ? client.services : (lead ? normalizeServices(lead.servicos) : []);
          if (services.length) {
            $$('#calEventServices .chip-toggle').forEach(chip => {
              chip.classList.toggle('active', services.includes(chip.dataset.value));
            });
          }
          dropdown.hidden = true;
          dropdown.classList.remove('open');
        });
      });
    }, 200);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { dropdown.hidden = true; dropdown.classList.remove('open'); }, 150);
  });
}

function saveCalEvent() {
  // Safety: block save if read-only
  if (calEventEditId) {
    const m = meetings.find(ev => String(ev.id) === String(calEventEditId));
    if (m && isReadOnly(m)) { toast('Sem permissão para editar este evento', 'error'); return; }
  }

  const title = $('#calEventInputTitle').value.trim();
  const type = $('#calEventType').value;
  const date = $('#calEventDate').value;
  const errors = {};

  if (!title) errors.calTitle = 'Preencha o título';
  if (!type) errors.calType = 'Selecione o tipo de evento';
  if (!date) errors.calDate = 'Selecione a data';

  const timeStart = $('#calEventTimeStart').value;
  const timeEnd = $('#calEventTimeEnd').value;
  if (timeStart && timeEnd && timeEnd <= timeStart) {
    errors.calTimeEnd = 'Hora de término deve ser depois da hora de início';
  }

  $$('#calEventModal .form-error').forEach(e => e.textContent = '');
  $$('#calEventModal .invalid').forEach(e => e.classList.remove('invalid'));

  let hasError = false;
  Object.keys(errors).forEach(name => {
    const errEl = $(`#calEventModal [data-error="${name}"]`);
    if (errEl) errEl.textContent = errors[name];
    const input = $(`#calEventModal [name="${name}"]`);
    if (input) input.classList.add('invalid');
    hasError = true;
  });

  if (hasError) { toast('Verifique os campos destacados', 'error'); return; }

  const serviceChips = Array.from($$('#calEventServices .chip-toggle.active'));
  const serviceNames = serviceChips.map(c => c.dataset.value);
  const serviceIds = serviceChips.map(c => c.dataset.svcId).filter(Boolean);

  let honorarios = 0;
  const honStr = $('#calEventHon').value.replace(/\D/g, '');
  if (honStr) honorarios = parseInt(honStr, 10) / 100;

  const duration = $('#calEventDuration').value || '';

  const payload = {
    title,
    type,
    empresa_id: $('#calEventEmpresa').value || null,
    cliente: $('#calEventClient').value,
    leadId: $('#calEventClientId').value || null,
    phone: $('#calEventPhone').value,
    location: $('#calEventLocation').value,
    iso: date,
    time: timeStart || '',
    timeEnd: timeEnd || '',
    duration,
    services: serviceNames,
    servicos_ids: serviceIds.length > 0 ? serviceIds : null,
    temperature: $('#calEventTemperature').value,
    honorarios,
    notes: $('#calEventNotes').value,
    color: $('#calEventColor').value || '#2F80ED',
    status: 'agendada',
    created_by: currentUser.id || null
  };

  const saveBtn = $('#calEventSaveBtn');
  const saveBtnOriginal = saveBtn ? saveBtn.innerHTML : '';
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i data-lucide="loader"></i> Salvando...'; initIcons(); }

  async function doSave() {
    try {
      if (calEventEditId) {
        const idx = meetings.findIndex(m => String(m.id) === String(calEventEditId));
        if (idx !== -1) {
          Object.assign(meetings[idx], payload);
          try {
            await updateEventoSupabase(calEventEditId, payload);
            toast('Evento atualizado no Supabase');
if (typeof registrarAuditoria === 'function') {
    registrarAuditoria({ acao: 'Atualizações', caminho_url: '/calendario', modulo: 'Calendário' });
  }
          } catch (syncErr) {
            console.error('[Calendário] Erro ao atualizar no Supabase:', syncErr);
            toast('Salvo localmente. Erro ao sincronizar: ' + (syncErr.message || syncErr), 'error');
          }
        }
      } else {
        const result = await insertEventoSupabase(payload);
        if (result && result[0] && result[0].id) {
          payload.id = result[0].id;
        } else {
          payload.id = Math.max(...meetings.map(m => m.id), 0) + 1;
        }
        meetings.push(payload);
        toast('Evento salvo no Supabase');
if (typeof registrarAuditoria === 'function') {
    registrarAuditoria({ acao: 'Inclusões', caminho_url: '/calendario', modulo: 'Calendário' });
  }
      }
    } catch (err) {
      console.error('[Calendário] Erro ao salvar evento:', err);
      if (!calEventEditId) {
        payload.id = Math.max(...meetings.map(m => m.id), 0) + 1;
        meetings.push(payload);
      }
      toast('Erro ao salvar no Supabase: ' + (err.message || err), 'error');
    }

    rebuildCalendarEvents();
    invalidateDashCache();
    renderCalendar();
    renderCalUpcoming();
    renderDashRemindersWidget();
    renderDashAll();
    closeCalEventModal();
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = saveBtnOriginal; initIcons(); }
  }

  doSave();
}

function deleteCalEvent() {
  if (!calEventEditId) return;
  const m = meetings.find(ev => String(ev.id) === String(calEventEditId));
  if (!m) return;
  if (!canDeleteEvent(m)) { toast('Sem permissão para excluir este evento', 'error'); return; }
  if (!confirm(`Excluir evento "${m.title}"?`)) return;

  const deletedId = calEventEditId;
  meetings.splice(meetings.indexOf(m), 1);
  rebuildCalendarEvents();
  invalidateDashCache();
  renderCalendar();
  renderCalUpcoming();
  renderDashRemindersWidget();
  renderDashAll();
  closeCalEventModal();
  if (typeof registrarAuditoria === 'function') {
    registrarAuditoria({ acao: 'Exclusões', caminho_url: '/calendario', modulo: 'Calendário' });
  }

  async function doDelete() {
    try {
      await deleteEventoSupabase(deletedId);
      toast('Evento excluído do Supabase');
    } catch (err) {
      console.error('[Calendário] Erro ao excluir do Supabase:', err);
      toast('Excluído localmente. Erro ao sincronizar: ' + (err.message || err), 'error');
    }
  }
  doDelete();
}

// Calendar: single click → popup, double click → edit modal, nav + view seg
document.addEventListener('click', (e) => {
  if (activePage !== 'calendario') return;

  // Single click on event → open full edit modal with all data
  const eventEl = e.target.closest('.cal-event');
  if (eventEl) {
    e.preventDefault();
    e.stopPropagation();
    const evIso = eventEl.dataset.iso || '';
    const meetingId = eventEl.dataset.meetingId;
    if (meetingId && meetingId !== 'undefined' && meetingId !== 'null') {
      openCalEventModal(evIso, meetingId);
    }
    return;
  }

  // Popup: Edit button → open edit modal, then close popup
  if (e.target.closest('#calPopupEditBtn')) {
    const popup = $('#calEventPopup');
    if (popup) {
      openCalEventModal(popup.dataset.iso, popup.dataset.meetingId);
      closeCalEventPopup();
    }
    return;
  }
  // Popup: Delete button
  if (e.target.closest('#calPopupDeleteBtn')) {
    const popup = $('#calEventPopup');
    if (popup) {
      calEventEditId = popup.dataset.meetingId;
      closeCalEventPopup();
      deleteCalEvent();
    }
    return;
  }
  // Popup: Close button
  if (e.target.closest('[data-action="close-cal-popup"]')) { closeCalEventPopup(); return; }

  // Lead popup: Save button
  if (e.target.closest('#calLeadPopupSaveBtn')) { saveLeadFromCalendar(); return; }
  // Lead popup: Close button
  if (e.target.closest('[data-action="close-lead-popup"]')) { closeLeadEditPopup(); return; }
  // Lead popup: click outside → close
  const leadPopup = $('#calLeadPopup');
  if (leadPopup && !leadPopup.hidden && !e.target.closest('#calLeadPopup') && !e.target.closest('.cal-event')) {
    closeLeadEditPopup();
  }

  // Cell click (not on event) → open new event modal (only on double-click area or direct cell)
  const cell = e.target.closest('.cal-day:not(.other-month), .cal-week-cell, .cal-day-row .cal-week-cell');
  if (cell && !e.target.closest('.cal-event')) {
    const iso = cell.dataset.iso;
    if (iso) openCalEventModal(iso);
  }

  // "Novo evento" button
  const novoBtn = e.target.closest('#page-calendario .btn-primary');
  if (novoBtn) {
    e.preventDefault();
    openCalEventModal(new Date().toISOString().slice(0, 10));
  }

  // Nav arrows
  if (e.target.closest('#calPrev')) calPrev();
  if (e.target.closest('#calNext')) calNext();
  if (e.target.closest('#calToday')) calGoToday();

  // View seg buttons
  const segBtn = e.target.closest('.cal-views .seg[data-view]');
  if (segBtn) setCalView(segBtn.dataset.view);

  // Close modal buttons
  if (e.target.closest('[data-action="close-cal-event"]')) closeCalEventModal();
  if (e.target.id === 'calEventOverlay') closeCalEventModal();
  if (e.target.closest('#calEventSaveBtn')) saveCalEvent();
  if (e.target.closest('#calEventDeleteBtn')) deleteCalEvent();
});

// Calendar: double-click on event → open full edit modal
document.addEventListener('dblclick', (e) => {
  if (activePage !== 'calendario') return;

  const eventEl = e.target.closest('.cal-event');
  if (!eventEl) return;

  e.preventDefault();
  e.stopPropagation();

  const evIso = eventEl.dataset.iso || '';
  const meetingId = eventEl.dataset.meetingId;
  if (!meetingId || meetingId === 'undefined' || meetingId === 'null') return;

  // Close any open popups before opening the full modal
  closeLeadEditPopup();
  closeCalEventPopup();

  openCalEventModal(evIso, meetingId);
});

// ESC to close calendar modal or popup
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('#calEventModal')?.classList.contains('open')) closeCalEventModal();
    else if ($('#calLeadPopup') && !$('#calLeadPopup').hidden) closeLeadEditPopup();
    else closeCalEventPopup();
  }
});

/* ============================================
   DASHBOARD WIDGETS v3 — Date-Filtered
   ============================================ */
function initDashboardPeriod() {
  const saved = sessionStorage.getItem('dashPeriod');
  if (saved) {
    try {
      const p = JSON.parse(saved);
      dashState.period = p.period || 'today';
      dashState.startDate = p.startDate || null;
      dashState.endDate = p.endDate || null;
    } catch(e) { /* ignore */ }
  }
  const segBtns = document.querySelectorAll('#dashPeriodSeg .seg');
  segBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === dashState.period);
    btn.setAttribute('aria-selected', btn.dataset.period === dashState.period ? 'true' : 'false');
  });
  const customRange = document.getElementById('dashCustomRange');
  if (customRange) customRange.style.display = dashState.period === 'custom' ? '' : 'none';
  if (dashState.period === 'custom' && dashState.startDate) {
    const si = document.getElementById('dashStartDate');
    const ei = document.getElementById('dashEndDate');
    if (si) si.value = dashState.startDate;
    if (ei) ei.value = dashState.endDate || '';
  }
  segBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const period = btn.dataset.period;
      dashState.period = period;
      segBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-selected','true');
      const cr = document.getElementById('dashCustomRange');
      if (cr) cr.style.display = period === 'custom' ? '' : 'none';
      persistDashPeriod();
      refreshDashboard();
    });
  });
  const si = document.getElementById('dashStartDate');
  const ei = document.getElementById('dashEndDate');
  if (si) si.addEventListener('change', () => { dashState.startDate = si.value; persistDashPeriod(); refreshDashboard(); });
  if (ei) ei.addEventListener('change', () => { dashState.endDate = ei.value; persistDashPeriod(); refreshDashboard(); });
  const cta = document.getElementById('eventosCta');
  if (cta) cta.addEventListener('click', () => setActivePage('calendario'));
}

function persistDashPeriod() {
  sessionStorage.setItem('dashPeriod', JSON.stringify({
    period: dashState.period,
    startDate: dashState.startDate,
    endDate: dashState.endDate
  }));
}

function refreshDashboard() {
  const { start, end } = getPeriodRange();
  // Aplicar filtro de centro de custo
  let filteredLeads = leads;
  const isAdmin = isCurrentUserAdmin();
  if (dashCcFilter !== 'all') {
    filteredLeads = filteredLeads.filter(l => l._centroCustoId === dashCcFilter);
  } else if (!isAdmin && currentUser.centro_custo_ids && currentUser.centro_custo_ids.length > 0) {
    filteredLeads = filteredLeads.filter(l => currentUser.centro_custo_ids.includes(l._centroCustoId));
  }
  // Se NÃO é Administrador, filtrar apenas leads do próprio usuário
  if (!isAdmin) {
    const userId = getCurrentUserId();
    if (userId) {
      filteredLeads = filteredLeads.filter(l => {
        const membroId = l._membroId || l._ownerId;
        const qualificadorId = l._qualificadorId;
        if (membroId === userId || qualificadorId === userId) return true;
        return false;
      });
    }
  }
  // KPIs: filtrados pelo período selecionado (para todos os perfis)
  const metrics = computeAllMetrics(filteredLeads);
  const fm = metrics.metrics;
  renderKpiTotal(fm.total);
  renderKpiFinalizados(fm.finalizado, fm.total);
  renderKpiAndamento(fm.andamento, fm.total);
  renderKpiPendentes(fm.pendente, fm.total);
  renderSparkTotal(fm.total.count);
  // Gráficos: sempre filtrados por período
  renderFunnel(computeCadenceFunnel(metrics.current));
  renderOrigins(computeOrigins(metrics.current));
  renderTemperatura(computeTemperatures(metrics.current));
  renderHonorariosChart(computeHonorarios(metrics.current));
  renderProximosEventos(start, end);
  const badge = document.getElementById('dashPeriodBadge');
  if (badge) badge.textContent = formatPeriodBadge(start, end);
}

function renderKpiTotal(t) {
  const val = document.getElementById('kpiTotal');
  const trend = document.getElementById('kpiTotalTrend');
  const card = document.querySelector('[data-kpi="total"]');
  if (val) val.textContent = t.count.toLocaleString('pt-BR');
  if (trend) {
    const sign = t.var >= 0 ? '+' : '';
    trend.className = 'kpi-trend ' + (t.var > 0 ? 'up' : t.var < 0 ? 'down' : 'neutral');
    trend.innerHTML = `<i data-lucide="${t.var > 0 ? 'trending-up' : t.var < 0 ? 'trending-down' : 'minus'}"></i> ${sign}${t.var}% vs período anterior`;
  }
  if (card) card.setAttribute('aria-label', `Total de Leads: ${t.count.toLocaleString('pt-BR')}, ${t.var >= 0 ? 'aumento' : 'queda'} ${Math.abs(t.var)}%`);
  if (window.initIcons) window.initIcons();
}

function renderKpiFinalizados(f, total) {
  const val = document.getElementById('kpiFin');
  const trend = document.getElementById('kpiFinTrend');
  const card = document.querySelector('[data-kpi="finalizados"]');
  if (val) val.textContent = f.count.toLocaleString('pt-BR');
  const pct = total.count > 0 ? Math.round(f.count / total.count * 100) : 0;
  if (trend) {
    const sign = f.var >= 0 ? '+' : '';
    trend.className = 'kpi-trend ' + (f.var > 0 ? 'up' : f.var < 0 ? 'down' : 'neutral');
    trend.innerHTML = `<i data-lucide="${f.var > 0 ? 'trending-up' : f.var < 0 ? 'trending-down' : 'minus'}"></i> ${pct}% do total`;
  }
  if (card) card.setAttribute('aria-label', `Finalizados: ${f.count.toLocaleString('pt-BR')}, ${pct}% do total`);
  renderDonutFin(f.count, total.count);
}

function renderKpiAndamento(a, total) {
  const val = document.getElementById('kpiAnd');
  const trend = document.getElementById('kpiAndTrend');
  const card = document.querySelector('[data-kpi="andamento"]');
  const bar = card ? card.querySelector('.kpi-bar-fill') : null;
  if (val) val.textContent = a.count.toLocaleString('pt-BR');
  const pct = total.count > 0 ? Math.round(a.count / total.count * 100) : 0;
  if (trend) {
    trend.className = 'kpi-trend neutral';
    trend.innerHTML = `<i data-lucide="minus"></i> ${pct}% do total`;
  }
  if (bar) bar.style.width = pct + '%';
  if (card) card.setAttribute('aria-label', `Em Andamento: ${a.count.toLocaleString('pt-BR')}, ${pct}% do total`);
}

function renderKpiPendentes(p, total) {
  const val = document.getElementById('kpiPen');
  const trend = document.getElementById('kpiPenTrend');
  const card = document.querySelector('[data-kpi="pendentes"]');
  const bar = card ? card.querySelector('.kpi-bar-fill') : null;
  if (val) val.textContent = p.count.toLocaleString('pt-BR');
  const pct = total.count > 0 ? Math.round(p.count / total.count * 100) : 0;
  if (trend) {
    trend.className = 'kpi-trend ' + (p.count > 0 ? 'down' : 'neutral');
    trend.innerHTML = `<i data-lucide="${p.count > 0 ? 'trending-down' : 'minus'}"></i> ${pct}% do total`;
  }
  if (bar) bar.style.width = pct + '%';
  if (card) card.setAttribute('aria-label', `Pendentes: ${p.count.toLocaleString('pt-BR')}, ${pct}% do total`);
}

function renderFunnel(funnelData) {
  const el = document.getElementById('funnelContainer');
  if (!el) return;
  const items = funnelData.filter(f => f.count > 0);
  if (!items.length) { el.innerHTML = '<p class="empty-state">Nenhum dado no período.</p>'; return; }
  const max = Math.max(...items.map(f => f.count));
  const colors = ['#165BFF', '#4D80FF', '#9CB3FF', '#C8D6FF', '#E8F0FE'];
  el.innerHTML = items.map((f, i) => {
    const pct = (f.count / max * 100).toFixed(0);
    return `<div class="funnel-step">
      <span class="funnel-label">${f.label}</span>
      <div class="funnel-bar-wrap">
        <div class="funnel-bar" style="width:${pct}%;background:${colors[i % colors.length]}">${f.count}</div>
      </div>
      <span class="funnel-count">${f.count}</span>
    </div>`;
  }).join('');
}

function renderOrigins(originsMap) {
  const canvas = document.getElementById('chartOrigins');
  const legend = document.getElementById('originsLegend');
  if (!canvas || !legend) return;
  const entries = Object.entries(originsMap).filter(([,v]) => v.count > 0).sort((a,b) => b[1].count - a[1].count);
  if (!entries.length) { canvas.style.display = 'none'; legend.innerHTML = '<li class="empty-state">Nenhum dado.</li>'; return; }
  canvas.style.display = '';
  const ctx = canvas.getContext('2d');
  const total = entries.reduce((s, [,v]) => s + v.count, 0);
  const colors = ['#165BFF', '#10b981', '#F0A500', '#a855f7', '#94A3B8'];
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentElement.offsetWidth - 40;
  canvas.width = w * dpr; canvas.height = 180 * dpr;
  canvas.style.width = w + 'px'; canvas.style.height = '180px';
  ctx.scale(dpr, dpr);
  const cx = w / 2, cy = 90, r = 70;
  let startAngle = -Math.PI / 2;
  entries.forEach(([,v], i) => {
    const slice = (v.count / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, startAngle + slice);
    ctx.closePath(); ctx.fillStyle = colors[i % colors.length]; ctx.fill();
    startAngle += slice;
  });
  ctx.beginPath(); ctx.arc(cx, cy, 38, 0, Math.PI * 2);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--card-bg').trim() || '#fff';
  ctx.fill();
  ctx.font = 'bold 18px Inter, sans-serif';
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#1F2D3D';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(total.toLocaleString('pt-BR'), cx, cy);
  legend.innerHTML = entries.map(([k,v], i) =>
    `<li><span class="dot" style="background:${colors[i % colors.length]}"></span>${k}: ${v.count}</li>`
  ).join('');
}

function renderTemperatura(tempData) {
  const el = document.getElementById('tempContainer');
  if (!el) return;
  const total = tempData.quente.count + tempData.morno.count + tempData.frio.count;
  if (!total) { el.innerHTML = '<p class="empty-state">Nenhum dado no período.</p>'; return; }
  el.innerHTML = [
    { label: 'Quente', count: tempData.quente.count, cls: 'hot' },
    { label: 'Morno',  count: tempData.morno.count,  cls: 'warm' },
    { label: 'Frio',   count: tempData.frio.count,   cls: 'cold' }
  ].map(item => {
    const pct = (item.count / total * 100).toFixed(0);
    return `<div class="temp-row">
      <span class="temp-label">${item.label}</span>
      <div class="temp-bar-wrap">
        <div class="temp-bar ${item.cls}" style="width:${pct}%">${pct}%</div>
      </div>
      <span class="temp-count">${item.count}</span>
    </div>`;
  }).join('');
}

function renderHonorariosChart(honData) {
  const canvas = document.getElementById('chartHon');
  const totalEl = document.getElementById('honTotal');
  if (totalEl) totalEl.textContent = 'R$ ' + (honData.total || 0).toLocaleString('pt-BR');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const byCad = honData.byCadence || [];
  if (!byCad.length) { canvas.style.display = 'none'; return; }
  canvas.style.display = '';
  const max = Math.max(...byCad.map(d => d.value), 1) * 1.15;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentElement.offsetWidth - 40;
  canvas.width = w * dpr; canvas.height = 160 * dpr;
  canvas.style.width = w + 'px'; canvas.style.height = '160px';
  ctx.scale(dpr, dpr);
  const padL = 50, padR = 20, padT = 10, padB = 30;
  const chartW = w - padL - padR, chartH = 160 - padT - padB;
  const barW = chartW / byCad.length * 0.6, gap = chartW / byCad.length;
  ctx.strokeStyle = '#E2E8F0'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + chartH - (chartH * i / 4);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillStyle = '#94A3B8'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('R$' + Math.round(max * i / 4 / 1000) + 'k', padL - 6, y + 4);
  }
  byCad.forEach((d, i) => {
    const x = padL + gap * i + gap / 2 - barW / 2;
    const barH = (d.value / max) * chartH;
    const y = padT + chartH - barH;
    const grad = ctx.createLinearGradient(x, y, x, padT + chartH);
    grad.addColorStop(0, '#165BFF'); grad.addColorStop(1, '#4D80FF');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]); ctx.fill();
    ctx.fillStyle = '#94A3B8'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center';
    const label = d.label.length > 8 ? d.label.slice(0, 7) + '…' : d.label;
    ctx.fillText(label, padL + gap * i + gap / 2, padT + chartH + 18);
  });
}

function renderSparkTotal(total) {
  const canvas = document.getElementById('sparkTotal');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const base = total || 0;
  const points = [base * 0.65, base * 0.72, base * 0.78, base * 0.83, base * 0.88, base * 0.92, base * 0.96, base];
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 120 * dpr; canvas.height = 32 * dpr;
  canvas.style.width = '120px'; canvas.style.height = '32px';
  ctx.scale(dpr, dpr);
  const max = Math.max(...points, 1);
  const min = Math.min(...points);
  const range = max - min || 1;
  const step = 120 / (points.length - 1);
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = i * step, y = 30 - ((p - min) / range) * 26;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#165BFF'; ctx.lineWidth = 2; ctx.stroke();
  const lastX = (points.length - 1) * step;
  const lastY = 30 - ((points[points.length - 1] - min) / range) * 26;
  ctx.beginPath(); ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#165BFF'; ctx.fill();
}

function renderDonutFin(finCount, totalCount) {
  const canvas = document.getElementById('donutFin');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 40 * dpr; canvas.height = 40 * dpr;
  canvas.style.width = '40px'; canvas.style.height = '40px';
  ctx.scale(dpr, dpr);
  const pct = totalCount > 0 ? finCount / totalCount : 0;
  ctx.beginPath(); ctx.arc(20, 20, 16, 0, Math.PI * 2);
  ctx.strokeStyle = '#E2E8F0'; ctx.lineWidth = 5; ctx.stroke();
  ctx.beginPath(); ctx.arc(20, 20, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
  ctx.strokeStyle = '#10b981'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.stroke();
}

function renderProximosEventos(start, end) {
  const el = document.getElementById('eventosList');
  if (!el) return;

  const events = meetings
    .filter(m => {
      const d = parseISODate(m.iso);
      if (d < start || d > end) return false;
      if (dashCcFilter !== 'all' && m.empresa_id !== dashCcFilter) return false;
      return true;
    })
    .sort((a, b) => (a.iso + a.time).localeCompare(b.iso + b.time))
    .slice(0, 5);
  if (!events.length) {
    el.innerHTML = `<div class="empty-state">
      <i data-lucide="calendar-x"></i>
      <p>Nenhum evento encontrado no período selecionado.</p>
    </div>`;
    if (window.initIcons) window.initIcons();
    return;
  }
  el.innerHTML = events.map(m => {
    const d = parseISODate(m.iso);
    const tagCls = m.type === 'reuniao' ? 'tag-blue' : m.type === 'fiscal' ? 'tag-amber'
      : m.type === 'financeiro' ? 'tag-green' : 'tag-purple';
    const monthNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const leadName = m.lead ? m.lead.nome : (m.cliente || '');
    const leadPhone = m.lead ? m.lead.telefone : (m.phone || '');
    return `<div class="evento-item" data-meeting-id="${m.id}">
      <div class="evento-date">
        <strong>${String(d.getDate()).padStart(2,'0')}</strong>
        <span>${monthNames[d.getMonth()]}</span>
      </div>
      <div class="evento-bar" style="background:${meetingColor(m.type)}"></div>
      <div class="evento-info">
        <p class="evento-title">${escapeHtml(m.title)}</p>
        <p class="evento-meta">${m.time || ''}${m.duration ? ' · ' + m.duration + 'min' : ''}${leadName ? ' · ' + escapeHtml(leadName) : ''}${leadPhone ? ' · ' + escapeHtml(leadPhone) : ''}</p>
      </div>
      <span class="tag ${tagCls}">${meetingTypeLabel(m.type)}</span>
    </div>`;
  }).join('');
}


/* ============================================
   ADMINISTRADOR · GERENCIAMENTO
   ============================================ */
const adminModulos = [
  { nome: 'Home',             chave: 'home' },
  { nome: 'Dashboard',        chave: 'dashboard' },
  { nome: 'CRM',              chave: 'crm' },
  { nome: 'Kanban',           chave: 'kanban' },
  { nome: 'Cliente da Base',  chave: 'clientes' },
  { nome: 'Calendário',       chave: 'calendario' },
  { nome: 'Rotina Blue',      chave: 'rotina' },
  { nome: 'Pomodoro',         chave: 'pomodoro' },
  { nome: 'Conversas',        chave: 'conversas' },
  { nome: 'Auditoria',        chave: 'auditoria' },
  { nome: 'Configurações',    chave: 'configuracoes' },
  { nome: 'Administrador',    chave: 'administrador' },
  { nome: 'Ação: Apagar Clientes', chave: 'apagar_clientes' }
];

let adminPermissoes = {
  administrador: {},
  marketing: {}
};

function initAdminPerms() {
  adminModulos.forEach(m => {
    adminPermissoes.administrador[m.chave] = true;
    adminPermissoes.marketing[m.chave] = m.chave === 'apagar_clientes' ? false : true;
  });
}

function renderAdminPermsTable() {
  const tbody = document.getElementById('adminPermsBody');
  if (!tbody) return;

  if (Object.keys(adminPermissoes.administrador).length === 0) initAdminPerms();

  tbody.innerHTML = adminModulos.map(mod => {
    const adminChecked = adminPermissoes.administrador[mod.chave] ? 'checked' : '';
    const mktChecked = adminPermissoes.marketing[mod.chave] ? 'checked' : '';
    return `<tr>
      <td>${escapeHtml(mod.nome)}</td>
      <td>
        <label class="admin-toggle">
          <input type="checkbox" data-perm-role="administrador" data-perm-mod="${mod.chave}" ${adminChecked}>
          <span class="admin-toggle-slider"></span>
        </label>
      </td>
      <td>
        <label class="admin-toggle">
          <input type="checkbox" data-perm-role="marketing" data-perm-mod="${mod.chave}" ${mktChecked}>
          <span class="admin-toggle-slider"></span>
        </label>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const role = cb.dataset.permRole;
      const mod = cb.dataset.permMod;
      adminPermissoes[role][mod] = cb.checked;
    });
  });
}

/* ============================================
   ROTINA BLUE · DASHBOARD PESSOAL
   ============================================ */
const rotinaItems = [];

/* Carregar rotinas do Supabase */
async function loadRotinas() {
  const canViewAll = canViewAllData();
  const filterId = canViewAll ? null : getCurrentUserId();
  const data = await fetchRotinas(filterId);
  if (data.length === 0) {
    console.log('[Rotina] Nenhuma rotina no Supabase, usando dados locais');
    return;
  }
  rotinaItems.length = 0;
  data.forEach(row => {
    const membroNome = row.membros ? row.membros.nome : '';
    rotinaItems.push({
      id:        row.id,
      type:      row.tipo || 'tarefa',
      column:    row.status || 'cadencia',
      title:     row.titulo || '',
      time:      row.hora_tarefa || null,
      date:      row.data_tarefa || null,
      assignees: [],
      pastel:    row.cor || 'blue',
      done:      (row.status === 'concluido'),
      desc:      row.observacoes || '',
      fixado:    row.fixado || false,
      _supabaseId: row.id,
      _membroId: row.membro_id || null,
      _membroNome: membroNome
    });
  });
  console.log('[Rotina] Rotinas carregadas:', rotinaItems.length);
}

let rotinaFilters = { tarefa: true, reuniao: true, prazo: true, concluido: true };
const rotinaTeam = {
  CS: { name: 'Camila Souza',     initials: 'CS', color: 'avatar-blue' },
  RF: { name: 'Rafaela Ferreira', initials: 'RF', color: 'avatar-green' },
  JP: { name: 'João Pedro',       initials: 'JP', color: 'avatar-amber' },
  MA: { name: 'Marina Alves',     initials: 'MA', color: 'avatar-purple' }
};

function rotinaGetFiltered() {
  const canViewAll = canViewAllData();
  const userId = getCurrentUserId();
  
  return rotinaItems.filter(i => {
    if (i.done && !rotinaFilters.concluido) return false;
    if (!i.done && !rotinaFilters[i.type]) return false;
    
    // Se não é admin, exibir apenas rotinas associadas ao próprio usuário
    if (!canViewAll && userId && i._membroId !== userId) return false;
    return true;
  });
}

function rotinaCardHTML(item) {
  const typeIcon = item.type === 'reuniao' ? 'video' : item.type === 'prazo' ? 'clock' : 'check-square';
  const typeLabel = item.type === 'reuniao' ? 'Reunião' : item.type === 'prazo' ? 'Prazo' : 'Tarefa';

  return `
    <div class="rotina-card-item pastel-${item.pastel} ${item.done ? 'done' : ''}"
         draggable="true" data-id="${item.id}" tabindex="0" role="button" aria-label="${item.title}">
      <div class="rotina-card-top">
        <label class="rotina-checkbox-wrap" onclick="event.stopPropagation()">
          <input type="checkbox" class="rotina-checkbox" data-id="${item.id}" ${item.done ? 'checked' : ''} />
          <span class="rotina-checkmark"></span>
        </label>
        <span class="rotina-type-badge ${item.type}"><i data-lucide="${typeIcon}"></i> ${typeLabel}</span>
        ${item.column === 'concluido' ? `<button class="rotina-delete-btn" data-delete-id="${item.id}" onclick="event.stopPropagation()" title="Apagar card"><i data-lucide="trash-2"></i></button>` : ''}
      </div>
      <h4 class="rotina-card-title">${escapeHtml(item.title)}</h4>
      <div class="rotina-card-meta">
        ${item.date ? `<span class="rotina-meta-item"><i data-lucide="calendar"></i> ${formatEventDate(item.date)}</span>` : ''}
        ${item.time ? `<span class="rotina-meta-item"><i data-lucide="clock"></i> ${item.time}</span>` : ''}
        ${item.location ? `<span class="rotina-meta-item"><i data-lucide="map-pin"></i> ${escapeHtml(item.location)}</span>` : ''}
        ${item._membroNome ? `<span class="rotina-member-badge"><i data-lucide="user"></i> ${item._membroNome}</span>` : ''}
      </div>
    </div>`;
}

function renderRotina() {
  renderRotinaReminder();
  renderRotinaKanban();
  bindRotinaFilters();
  bindRotinaDragDrop();
  bindRotinaCheckboxes();
  bindRotinaCards();
  bindRotinaCreateBtn();
  initRotinaCreateModal();
}

function renderRotinaKanban() {
  const items = rotinaGetFiltered();
  const cadencia = items.filter(i => i.column === 'cadencia');
  const andamento = items.filter(i => i.column === 'andamento');
  const pendentes = items.filter(i => i.column === 'pendentes');
  const concluido = items.filter(i => i.column === 'concluido');

  const emptyHTML = (icon, msg) => `<div class="rotina-empty"><i data-lucide="${icon}"></i><p>${msg}</p></div>`;

  const listC = $('#rotinaListCadencia');
  const listA = $('#rotinaListAndamento');
  const listP = $('#rotinaListPendentes');
  const listX = $('#rotinaListConcluido');
  if (listC) listC.innerHTML = cadencia.length ? cadencia.map(rotinaCardHTML).join('') : emptyHTML('inbox', 'Nenhum item nesta cadência');
  if (listA) listA.innerHTML = andamento.length ? andamento.map(rotinaCardHTML).join('') : emptyHTML('loader', 'Nada em andamento');
  if (listP) listP.innerHTML = pendentes.length ? pendentes.map(rotinaCardHTML).join('') : emptyHTML('clock', 'Sem pendências');
  if (listX) listX.innerHTML = concluido.length ? concluido.map(rotinaCardHTML).join('') : emptyHTML('check-circle-2', 'Nenhum concluído');

  const cC = $('#rotinaCountCadencia');
  const cA = $('#rotinaCountAndamento');
  const cP = $('#rotinaCountPendentes');
  const cX = $('#rotinaCountConcluido');
  if (cC) cC.textContent = cadencia.length;
  if (cA) cA.textContent = andamento.length;
  if (cP) cP.textContent = pendentes.length;
  if (cX) cX.textContent = concluido.length;

  initIcons();
}

function renderRotinaReminder() {
  const el = $('#rotinaReminder');
  if (!el) return;
  const today = getTodayIso();
  const upcoming = rotinaItems
    .filter(i => !i.done && i.date && i.date >= today)
    .sort((a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')));

  if (!upcoming.length) {
    el.innerHTML = `<div class="rotina-reminder-empty">
      <i data-lucide="calendar-check" aria-hidden="true"></i>
      <p>Nenhum evento agendado</p>
    </div>`;
    initIcons();
    return;
  }

  const cardsHtml = upcoming.slice(0, 5).map((item, idx) => {
    const typeIcon = item.type === 'reuniao' ? 'video' : item.type === 'prazo' ? 'clock' : 'check-square';
    return `
      <div class="rotina-reminder-item" data-reminder-id="${item.id}">
        <div class="rotina-reminder-item-top">
          <span class="rotina-type-badge ${item.type}"><i data-lucide="${typeIcon}"></i></span>
          <span class="rotina-reminder-item-title">${escapeHtml(item.title)}</span>
        </div>
        <div class="rotina-reminder-details">
          <span><i data-lucide="calendar"></i> ${formatEventDate(item.date)}</span>
          ${item.time ? `<span><i data-lucide="clock"></i> ${item.time}</span>` : ''}
          ${item.location ? `<span><i data-lucide="map-pin"></i> ${escapeHtml(item.location)}</span>` : ''}
        </div>
        <div class="rotina-reminder-actions">
          <button class="rotina-action-btn confirm" data-action="confirm" data-id="${item.id}"><i data-lucide="check"></i> Confirmar</button>
          <button class="rotina-action-btn snooze" data-action="snooze" data-id="${item.id}"><i data-lucide="clock"></i> Adiar</button>
          <button class="rotina-action-btn cancel" data-action="cancel" data-id="${item.id}"><i data-lucide="x"></i> Cancelar</button>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="rotina-reminder-badge">Próximos eventos (${upcoming.length})</div>
    <div class="rotina-reminder-list">${cardsHtml}</div>`;

  initIcons();

  el.querySelectorAll('.rotina-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const item = rotinaItems.find(i => String(i.id) === String(id));
      if (!item) return;

      const supabaseId = item._supabaseId || item.id;
      const canSupabase = supabaseId && typeof supabaseId === 'string' && supabaseId.includes('-');

      if (action === 'confirm') {
        item.done = true;
        item.column = 'concluido';
        if (canSupabase) {
          updateRotina(supabaseId, { status: 'concluido' })
            .catch(err => console.error('[Rotina] Erro ao confirmar no Supabase:', err));
        }
        toast('Evento confirmado e concluído!');
        renderRotina();
      } else if (action === 'snooze') {
        openSnoozePanel(item);
      } else if (action === 'cancel') {
        const idx = rotinaItems.indexOf(item);
        if (idx !== -1) rotinaItems.splice(idx, 1);
        if (canSupabase) {
          deleteRotina(supabaseId)
            .catch(err => console.error('[Rotina] Erro ao cancelar no Supabase:', err));
        }
        toast('Evento cancelado', 'error');
        renderRotina();
      }
    });
  });
}

function openSnoozePanel(item) {
  const el = $('#rotinaReminder');
  if (!el) return;
  el.innerHTML = `
    <div class="rotina-reminder-badge">Reagendar</div>
    <h4 class="rotina-reminder-title">${escapeHtml(item.title)}</h4>
    <div class="rotina-snooze-fields">
      <label class="rotina-snooze-label">Nova data:</label>
      <input type="date" class="rotina-datetime-input" id="rotinaSnoozeDate" value="${item.date || getTodayIso()}" min="${getTodayIso()}" />
      <label class="rotina-snooze-label">Novo horário:</label>
      <input type="time" class="rotina-datetime-input" id="rotinaSnoozeTime" value="${item.time || '09:00'}" />
    </div>
    <div class="rotina-reminder-actions">
      <button class="rotina-action-btn confirm" id="rotinaSnoozeSave"><i data-lucide="check"></i> Salvar</button>
      <button class="rotina-action-btn cancel" id="rotinaSnoozeCancel"><i data-lucide="x"></i> Voltar</button>
    </div>`;
  initIcons();

  $('#rotinaSnoozeSave')?.addEventListener('click', () => {
    const newDate = $('#rotinaSnoozeDate')?.value;
    const newTime = $('#rotinaSnoozeTime')?.value;
    if (!newDate) { toast('Informe uma data válida', 'error'); return; }
    item.date = newDate;
    item.time = newTime || null;

    const supabaseId = item._supabaseId || item.id;
    if (supabaseId && typeof supabaseId === 'string' && supabaseId.includes('-')) {
      updateRotina(supabaseId, { data_tarefa: newDate, hora_tarefa: newTime || null })
        .then(() => console.log('[Rotina] Reagendamento salvo no Supabase'))
        .catch(err => {
          console.error('[Rotina] Erro ao reagendar no Supabase:', err);
          toast('Erro ao sincronizar: ' + (err.message || err), 'error');
        });
    }

    toast(`Reagendado: ${formatEventDate(newDate)}${newTime ? ' às ' + newTime : ''}`);
    renderRotina();
  });
  $('#rotinaSnoozeCancel')?.addEventListener('click', () => renderRotina());
}

/* Filtros (checkboxes) */
function bindRotinaFilters() {
  $$('.rotina-filter-check input').forEach(cb => {
    cb.addEventListener('change', () => {
      const f = cb.dataset.filter;
      rotinaFilters[f] = cb.checked;
      renderRotinaKanban();
      bindRotinaDragDrop();
      bindRotinaCheckboxes();
      bindRotinaCards();
    });
  });
}

/* Checkboxes nos cards */
function bindRotinaCheckboxes() {
  $$('.rotina-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      const id = cb.dataset.id;
      const item = rotinaItems.find(i => String(i.id) === String(id));
      if (item) {
        item.done = cb.checked;
        item.column = cb.checked ? 'concluido' : 'pendentes';

        const supabaseId = item._supabaseId || item.id;
        if (supabaseId && typeof supabaseId === 'string' && supabaseId.includes('-')) {
          updateRotina(supabaseId, { status: item.column })
            .then(() => console.log('[Rotina] Status atualizado no Supabase:', item.column))
            .catch(err => {
              console.error('[Rotina] Erro ao atualizar status no Supabase:', err);
              toast('Erro ao sincronizar: ' + (err.message || err), 'error');
            });
        }

        toast(item.done ? 'Tarefa concluída!' : 'Tarefa reaberta');
if (typeof registrarAuditoria === 'function') {
    registrarAuditoria({ acao: 'Atualizações', caminho_url: '/rotina', modulo: 'Rotina Blue' });
  }
        renderRotinaKanban();
        renderRotinaReminder();
        bindRotinaCheckboxes();
        bindRotinaCards();
      }
    });
  });
}

/* Click nos cards → detalhe */
function bindRotinaCards() {
  $$('.rotina-card-item').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.rotina-checkbox-wrap')) return;
      if (e.target.closest('.rotina-delete-btn')) return;
      const id = card.dataset.id;
      openRotinaDetail(id);
    });
  });

  /* Botão apagar no card concluído */
  $$('.rotina-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteId;
      const idx = rotinaItems.findIndex(i => String(i.id) === String(id));
      if (idx !== -1) {
        const item = rotinaItems[idx];
        const supabaseId = item._supabaseId || item.id;
        if (supabaseId && typeof supabaseId === 'string' && supabaseId.includes('-')) {
          deleteRotina(supabaseId)
            .then(() => console.log('[Rotina] Deletada do Supabase'))
            .catch(err => {
              console.error('[Rotina] Erro ao deletar do Supabase:', err);
              toast('Erro ao sincronizar: ' + (err.message || err), 'error');
            });
        }
        rotinaItems.splice(idx, 1);
        toast('Card apagado');
if (typeof registrarAuditoria === 'function') {
    registrarAuditoria({ acao: 'Exclusões', caminho_url: '/rotina', modulo: 'Rotina Blue' });
  }
        renderRotinaKanban();
        renderRotinaReminder();
        bindRotinaCheckboxes();
        bindRotinaCards();
      }
    });
  });
}

let rotinaDetailEditId = null;

function openRotinaDetail(id) {
  const item = rotinaItems.find(i => i.id === id);
  if (!item) return;
  const overlay = $('#rotinaDetailOverlay');
  const modal = $('#rotinaDetailModal');
  const title = $('#rotinaDetailTitle');
  const body = $('#rotinaDetailBody');
  const edited = $('#rotinaDetailEdited');
  if (!overlay || !modal) return;

  rotinaDetailEditId = id;

  overlay.classList.remove('rotina-hidden');
  modal.classList.remove('rotina-hidden');

  title.value = item.title || '';
  body.value = item.desc || '';

  const pastelMap = { blue: '#DBEAFE', pink: '#FCE7F3', yellow: '#FEF9C3', purple: '#EDE9FE', green: '#D1FAE5' };
  modal.style.background = pastelMap[item.pastel] || pastelMap.blue;

  $$('#rotinaDetailColors .rotina-color-dot').forEach(d => {
    d.classList.toggle('active', d.dataset.color === item.pastel);
  });

  edited.textContent = item.date ? `Editada: ${formatEventDate(item.date)}` : '';

  initIcons();

  overlay.onclick = closeRotinaDetail;
  $('#rotinaDetailClose').onclick = closeRotinaDetail;

  $$('#rotinaDetailColors .rotina-color-dot').forEach(dot => {
    dot.onclick = () => {
      $$('#rotinaDetailColors .rotina-color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      const color = dot.dataset.color;
      const colorMap = { blue: '#DBEAFE', pink: '#FCE7F3', yellow: '#FEF9C3', purple: '#EDE9FE', green: '#D1FAE5' };
      modal.style.background = colorMap[color] || colorMap.blue;
    };
  });

  setTimeout(() => { if (title) title.focus(); }, 100);

  const escHandler = (e) => {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', escHandler);
      closeRotinaDetail();
    }
  };
  document.addEventListener('keydown', escHandler);
}

function closeRotinaDetail() {
  if (rotinaDetailEditId !== null) {
    const item = rotinaItems.find(i => i.id === rotinaDetailEditId);
    if (item) {
      const title = $('#rotinaDetailTitle');
      const body = $('#rotinaDetailBody');
      const activeColor = $('#rotinaDetailColors .rotina-color-dot.active');
      if (title) item.title = title.value.trim() || item.title;
      if (body) item.desc = body.value.trim();
      if (activeColor) item.pastel = activeColor.dataset.color;

      const supabaseId = item._supabaseId || item.id;
      if (supabaseId && typeof supabaseId === 'string' && supabaseId.includes('-')) {
        updateRotina(supabaseId, {
          titulo:      item.title,
          observacoes: item.desc,
          cor:         item.pastel
        }).then(() => {
          toast('Alterações salvas no Supabase');
        }).catch(err => {
          console.error('[Rotina] Erro ao atualizar no Supabase:', err);
          toast('Salvo localmente. Erro ao sincronizar: ' + (err.message || err), 'error');
        });
      } else {
        toast('Alterações salvas');
      }

      renderRotinaKanban();
      bindRotinaCheckboxes();
      bindRotinaCards();
    }
  }
  rotinaDetailEditId = null;
  const overlay = $('#rotinaDetailOverlay');
  const modal = $('#rotinaDetailModal');
  if (overlay) overlay.classList.add('rotina-hidden');
  if (modal) modal.classList.add('rotina-hidden');
}

/* Criar Card (botão) */
function bindRotinaCreateBtn() {
  const btn = $('#rotinaCreateBtn');
  if (btn) btn.onclick = openRotinaCreateModal;
}

/* Modal Criar Card — lógica completa */
let rotinaSelectedColor = 'blue';
let rotinaCreateModalInited = false;
let rotinaScheduledDate = null;
let rotinaScheduledTime = null;

function initRotinaCreateModal() {
  if (rotinaCreateModalInited) return;
  rotinaCreateModalInited = true;

  const overlay = $('#rotinaCreateOverlay');
  const modal = $('#rotinaCreateModal');
  const closeBtn = $('#rotinaCreateClose');
  const pinBtn = $('#rotinaCreatePin');
  const colorBtn = $('#rotinaColorBtn');
  const reminderBtn = $('#rotinaReminderBtn');

  if (!overlay || !modal) return;

  overlay.onclick = saveAndCloseRotinaCreate;
  if (closeBtn) closeBtn.onclick = saveAndCloseRotinaCreate;

  /* Pin toggle */
  if (pinBtn) pinBtn.onclick = () => pinBtn.classList.toggle('pinned');

  /* Color palette toggle */
  if (colorBtn) colorBtn.onclick = () => {
    const colors = $('#rotinaCreateColors');
    if (colors) colors.style.display = colors.style.display === 'none' ? 'flex' : 'none';
  };

  /* Color dots */
  $$('.rotina-color-dot').forEach(dot => {
    dot.onclick = () => {
      $$('.rotina-color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      rotinaSelectedColor = dot.dataset.color;
      modal.className = 'rotina-create-modal rotina-create-' + rotinaSelectedColor;
    };
  });

  /* Reminder dropdown → abre date/time picker */
  if (reminderBtn) {
    reminderBtn.onclick = (e) => {
      e.stopPropagation();
      const dd = $('#rotinaReminderDropdown');
      if (dd) dd.hidden = !dd.hidden;
    };
  }

  /* "Escolher data e hora" → mostra painel de date/time */
  $$('.rotina-dropdown-item[data-reminder="custom"]').forEach(item => {
    item.onclick = () => {
      const dd = $('#rotinaReminderDropdown');
      const panel = $('#rotinaDateTimePanel');
      if (dd) dd.hidden = true;
      if (panel) panel.classList.remove('rotina-hidden');
      /* Preenche com data mínima = hoje */
      const picker = $('#rotinaDatePicker');
      if (picker) {
        const today = new Date();
        picker.min = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
        if (!picker.value) picker.value = picker.min;
      }
    };
  });

  /* Confirmar data/hora */
  const dtConfirm = $('#rotinaDateTimeConfirm');
  if (dtConfirm) {
    dtConfirm.onclick = () => {
      const dateVal = $('#rotinaDatePicker')?.value;
      const timeVal = $('#rotinaTimePicker')?.value;
      if (!dateVal) { toast('Selecione uma data', 'error'); return; }
      rotinaScheduledDate = dateVal;
      rotinaScheduledTime = timeVal || '09:00';
      const panel = $('#rotinaDateTimePanel');
      if (panel) panel.classList.add('rotina-hidden');
      toast(`Agendado: ${formatEventDate(dateVal)} às ${rotinaScheduledTime}`);
    };
  }

  /* Cancelar date/time picker */
  const dtCancel = $('#rotinaDateTimeCancel');
  if (dtCancel) {
    dtCancel.onclick = () => {
      rotinaScheduledDate = null;
      rotinaScheduledTime = null;
      const panel = $('#rotinaDateTimePanel');
      if (panel) panel.classList.add('rotina-hidden');
    };
  }

  /* Close dropdowns on outside click */
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.rotina-toolbar-dropdown-wrap')) {
      const dd = $('#rotinaReminderDropdown');
      if (dd) dd.hidden = true;
    }
  });

  /* Enter no título foca descrição */
  const titleInput = $('#rotinaCreateTitle');
  if (titleInput) titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#rotinaCreateDesc')?.focus(); }
  });

  /* Escape fecha */
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') saveAndCloseRotinaCreate();
  });
}

function openRotinaCreateModal() {
  const overlay = $('#rotinaCreateOverlay');
  const modal = $('#rotinaCreateModal');
  const title = $('#rotinaCreateTitle');
  const desc = $('#rotinaCreateDesc');
  if (!overlay || !modal) return;

  /* Reset */
  if (title) title.value = '';
  if (desc) { desc.value = ''; desc.placeholder = 'Criar uma nota...'; }
  rotinaSelectedColor = 'blue';
  rotinaScheduledDate = null;
  rotinaScheduledTime = null;
  modal.className = 'rotina-create-modal';
  $$('.rotina-color-dot').forEach(d => d.classList.remove('active'));
  $$('.rotina-color-dot')[0]?.classList.add('active');
  const colors = $('#rotinaCreateColors');
  if (colors) colors.style.display = 'flex';
  const dd = $('#rotinaReminderDropdown');
  if (dd) dd.hidden = true;
  const dtPanel = $('#rotinaDateTimePanel');
  if (dtPanel) dtPanel.classList.add('rotina-hidden');

  overlay.classList.remove('rotina-hidden');
  modal.classList.remove('rotina-hidden');
  setTimeout(() => title?.focus(), 100);
}

function saveAndCloseRotinaCreate() {
  const title = $('#rotinaCreateTitle');
  const desc = $('#rotinaCreateDesc');
  const t = title?.value?.trim();
  const d = desc?.value?.trim();

  if (t || d) {
    const newType = rotinaScheduledDate ? 'reuniao' : 'tarefa';
    const payload = {
      titulo:      t || 'Nota sem título',
      observacoes: d || '',
      status:      'cadencia',
      cor:         rotinaSelectedColor,
      data_tarefa: rotinaScheduledDate || null,
      hora_tarefa: rotinaScheduledTime || null,
      tipo:        newType,
      fixado:      false,
      membro_id:   currentUser.id || null
    };

    async function doInsert() {
      let insertSuccess = false;
      try {
        const result = await insertRotina(payload);
        if (result && result[0]) {
          payload.id = result[0].id;
          payload._supabaseId = result[0].id;
        } else {
          payload.id = Date.now();
        }
        insertSuccess = true;
      } catch (err) {
        console.error('[Rotina] Erro ao inserir no Supabase:', err);
        toast('Erro ao salvar no Supabase: ' + (err.message || err), 'error');
        return;
      }

      if (insertSuccess) {
        const newItem = {
          id:          payload.id,
          type:        payload.tipo,
          column:      payload.status,
          title:       payload.titulo,
          time:        payload.hora_tarefa,
          date:        payload.data_tarefa,
          assignees:   [],
          pastel:      payload.cor,
          done:        false,
          desc:        payload.observacoes,
          fixado:      payload.fixado,
          _supabaseId: payload._supabaseId || payload.id,
          _membroId:   currentUser.id || null
        };
        rotinaItems.push(newItem);
        toast('Card criado com sucesso!');
        if (typeof registrarAuditoria === 'function') {
          registrarAuditoria({ acao: 'Inclusões', caminho_url: '/rotina', modulo: 'Rotina Blue' });
        }
        renderRotinaKanban();
        renderRotinaReminder();
        bindRotinaCheckboxes();
        bindRotinaCards();
      }
    }
    doInsert();
  }

  const overlay = $('#rotinaCreateOverlay');
  const modal = $('#rotinaCreateModal');
  if (overlay) overlay.classList.add('rotina-hidden');
  if (modal) modal.classList.add('rotina-hidden');
}

/* Drag & Drop — delegação de eventos (bind uma única vez) */
let rotinaDragBound = false;
function bindRotinaDragDrop() {
  if (rotinaDragBound) return;
  rotinaDragBound = true;

  const kanban = document.getElementById('rotinaKanban');
  if (!kanban) return;

  /* dragstart delegado */
  kanban.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.rotina-card-item');
    if (!card) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.id);
    requestAnimationFrame(() => card.classList.add('dragging'));
  });

  /* dragend delegado */
  kanban.addEventListener('dragend', (e) => {
    const card = e.target.closest('.rotina-card-item');
    if (card) card.classList.remove('dragging');
    $$('.rotina-col-list').forEach(z => z.classList.remove('drag-over'));
  });

  /* drop zones */
  $$('.rotina-col-list').forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const col = zone.closest('.rotina-col')?.dataset.col;
      if (!col || !id) return;
      const item = rotinaItems.find(i => String(i.id) === String(id));
      if (!item) return;

      const oldColumn = item.column;
      item.column = col;
      item.done = (col === 'concluido');

      const newStatus = col;
      const supabaseId = item._supabaseId || item.id;
      if (supabaseId && typeof supabaseId === 'string' && supabaseId.includes('-')) {
        updateRotina(supabaseId, { status: newStatus })
          .then(() => console.log('[Rotina] Status atualizado no Supabase:', newStatus))
          .catch(err => {
            console.error('[Rotina] Erro ao atualizar status no Supabase:', err);
            toast('Erro ao sincronizar: ' + (err.message || err), 'error');
          });
      }

      const labels = { cadencia: 'Cadência / Demanda Recorrente', andamento: 'Em Andamento', pendentes: 'Pendentes', concluido: 'Concluído' };
      toast(`Movido para "${labels[col] || col}"`);
if (typeof registrarAuditoria === 'function') {
    registrarAuditoria({ acao: 'Atualizações', caminho_url: '/rotina', modulo: 'Rotina Blue' });
  }
      renderRotinaKanban();
      renderRotinaReminder();
      bindRotinaCheckboxes();
      bindRotinaCards();
    });
  });
}

/* ============================================
   DARK MODE TOGGLE
   ============================================ */
function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (saved === 'dark' || (!saved && prefersDark)) {
    document.documentElement.classList.add('theme-dark');
    updateThemeIcon(true);
  }
}

function updateThemeIcon(isDark) {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  const icon = btn.querySelector('[data-lucide]');
  if (icon) {
    icon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
    initIcons();
  }
  btn.setAttribute('aria-pressed', String(isDark));
  btn.setAttribute('aria-label', isDark ? 'Desativar tema escuro' : 'Ativar tema escuro');
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('theme-dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  updateThemeIcon(isDark);
}

/* ============================================
   POMODORO · GESTÃO DE TEMPO E FOCO
   ============================================ */

const POMO_MODES = {
  pomodoro:   { label: 'Pomodoro',   defaultMin: 25 },
  shortBreak: { label: 'Short Break', defaultMin: 5  },
  longBreak:  { label: 'Long Break',  defaultMin: 15 }
};

let pomoSettings = {
  pomodoroMin: 25,
  shortMin: 5,
  longMin: 15,
  interval: 4,
  autoBreak: false,
  autoPomodoro: false,
  alarmSound: 'digital',
  volume: 70
};

let pomoState = {
  mode: 'pomodoro',
  running: false,
  secondsLeft: 25 * 60,
  cycle: 1,
  timer: null
};

let pomoTasks = [];
let pomoTaskNextId = 1;

function initPomodoro() {
  bindPomoTabs();
  bindPomoStart();
  bindPomoReset();
  bindPomoSettings();
  renderPomoClock();
  renderPomoCycleInfo();
  renderPomoDots();
}

function renderPomoClock() {
  const el = $('#pomoClock');
  if (!el) return;
  const m = Math.floor(pomoState.secondsLeft / 60);
  const s = pomoState.secondsLeft % 60;
  el.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function renderPomoCycleInfo() {
  const numEl = $('#pomoCycleNum');
  if (numEl) numEl.textContent = `#${pomoState.cycle}`;
}

function renderPomoDots() {
  const el = $('#pomoDots');
  if (!el) return;
  const interval = pomoSettings.interval;
  const currentInCycle = ((pomoState.cycle - 1) % interval);
  let html = '';
  for (let i = 0; i < interval; i++) {
    html += `<span class="pomo-dot ${i < currentInCycle ? 'filled' : ''} ${i === currentInCycle && pomoState.mode === 'pomodoro' ? 'active' : ''}"></span>`;
  }
  el.innerHTML = html;
}

function setPomoMode(mode) {
  if (pomoState.running) return;
  pomoState.mode = mode;
  pomoState.secondsLeft = getPomoMinutes(mode) * 60;
  renderPomoClock();
  renderPomoCycleInfo();
  renderPomoDots();
  updatePomoPlayIcon();

  $$('.pomo-tab').forEach(t => t.classList.remove('active'));
  const tab = $(`.pomo-tab[data-mode="${mode}"]`);
  if (tab) tab.classList.add('active');
}

function getPomoMinutes(mode) {
  switch (mode) {
    case 'pomodoro': return pomoSettings.pomodoroMin;
    case 'shortBreak': return pomoSettings.shortMin;
    case 'longBreak': return pomoSettings.longMin;
    default: return 25;
  }
}

function bindPomoTabs() {
  $$('.pomo-tab').forEach(tab => {
    tab.addEventListener('click', () => setPomoMode(tab.dataset.mode));
  });
}

function bindPomoStart() {
  const btn = $('#pomoStartBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!pomoState.running) {
      startPomoTimer();
    } else {
      pausePomoTimer();
    }
  });
}

function updatePomoPlayIcon() {
  const icon = $('#pomoPlayIcon');
  if (!icon) return;
  icon.setAttribute('data-lucide', pomoState.running ? 'pause' : 'play');
  initIcons();
}

function startPomoTimer() {
  pomoState.running = true;
  updatePomoPlayIcon();

  pomoState.timer = setInterval(() => {
    if (pomoState.secondsLeft <= 0) {
      clearInterval(pomoState.timer);
      pomoState.running = false;
      updatePomoPlayIcon();
      onPomoTimerEnd();
      return;
    }
    pomoState.secondsLeft--;
    renderPomoClock();
  }, 1000);
}

function pausePomoTimer() {
  clearInterval(pomoState.timer);
  pomoState.running = false;
  updatePomoPlayIcon();
}

function bindPomoReset() {
  const btn = $('#pomoResetBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    clearInterval(pomoState.timer);
    pomoState.running = false;
    pomoState.secondsLeft = getPomoMinutes(pomoState.mode) * 60;
    renderPomoClock();
    updatePomoPlayIcon();
  });
}

function onPomoTimerEnd() {
  playPomoAlarm();

  if (pomoState.mode === 'pomodoro') {
    if (pomoState.cycle % pomoSettings.interval === 0) {
      setPomoMode('longBreak');
      if (pomoSettings.autoBreak) startPomoTimer();
    } else {
      setPomoMode('shortBreak');
      if (pomoSettings.autoBreak) startPomoTimer();
    }
    pomoState.cycle++;
    renderPomoCycleInfo();
    renderPomoDots();
  } else {
    setPomoMode('pomodoro');
    if (pomoSettings.autoPomodoro) startPomoTimer();
  }
}

function playPomoAlarm() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = pomoSettings.alarmSound === 'bell' ? 880 : pomoSettings.alarmSound === 'chime' ? 660 : 440;
    gain.gain.value = pomoSettings.volume / 200;
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = pomoSettings.alarmSound === 'bell' ? 1100 : pomoSettings.alarmSound === 'chime' ? 880 : 660;
      gain2.gain.value = pomoSettings.volume / 200;
      osc2.start();
      osc2.stop(ctx.currentTime + 0.3);
    }, 200);
  } catch (e) {}
}

/* ---- Settings ---- */
function bindPomoSettings() {
  const btn = $('#pomoSettingsBtn');
  const overlay = $('#pomoSettingsOverlay');
  const closeBtn = $('#pomoSettingsClose');
  const okBtn = $('#pomoSettingsOk');

  if (btn) btn.addEventListener('click', () => {
    $('#pomoInputPomodoro').value = pomoSettings.pomodoroMin;
    $('#pomoInputShort').value = pomoSettings.shortMin;
    $('#pomoInputLong').value = pomoSettings.longMin;
    $('#pomoInputInterval').value = pomoSettings.interval;
    $('#pomoAutoBreak').checked = pomoSettings.autoBreak;
    $('#pomoAutoPomodoro').checked = pomoSettings.autoPomodoro;
    $('#pomoAlarmSound').value = pomoSettings.alarmSound;
    $('#pomoVolume').value = pomoSettings.volume;
    overlay?.classList.remove('rotina-hidden');
  });
  if (closeBtn) closeBtn.addEventListener('click', () => overlay?.classList.add('rotina-hidden'));
  if (okBtn) okBtn.addEventListener('click', () => {
    pomoSettings.pomodoroMin = Math.max(1, Math.min(90, Number($('#pomoInputPomodoro')?.value) || 25));
    pomoSettings.shortMin = Math.max(1, Math.min(30, Number($('#pomoInputShort')?.value) || 5));
    pomoSettings.longMin = Math.max(1, Math.min(60, Number($('#pomoInputLong')?.value) || 15));
    pomoSettings.interval = Math.max(2, Math.min(10, Number($('#pomoInputInterval')?.value) || 4));
    pomoSettings.autoBreak = $('#pomoAutoBreak')?.checked || false;
    pomoSettings.autoPomodoro = $('#pomoAutoPomodoro')?.checked || false;
    pomoSettings.alarmSound = $('#pomoAlarmSound')?.value || 'digital';
    pomoSettings.volume = Number($('#pomoVolume')?.value) || 70;

    if (!pomoState.running) {
      pomoState.secondsLeft = getPomoMinutes(pomoState.mode) * 60;
      renderPomoClock();
    }
    renderPomoDots();
    overlay?.classList.add('rotina-hidden');
    toast('Configurações salvas!');
  });
}

/* ============================================
   AUDITORIA · DADOS REAIS SUPABASE + MOCK FALLBACK
   ============================================ */
let auditData = [];
let auditPage = 1;
const auditPageSize = 15;

async function initAuditoria() {
  // Carregar dados reais do Supabase
  try {
    const dados = await buscarAuditoria({ limit: 500 });
    if (dados.length > 0) {
      auditData = dados.map(row => ({
        id:         row.id,
        user:       row.usuario_nome,
        hash:       row.usuario_id,
        action:     row.acao,
        actionUrl:  row.caminho_url,
        module:     row.modulo,
        device:     row.dispositivo,
        deviceIcon: (row.dispositivo || '').toLowerCase() === 'mobile' ? 'smartphone' : 'monitor',
        datetime:   formatAuditDate(row.created_at)
      }));
    } else {
      auditData = generateAuditMockData(120);
    }
  } catch (err) {
    console.error('[Auditoria] Erro ao buscar dados reais:', err);
    auditData = generateAuditMockData(120);
  }

  // Atualizar KPIs com dados reais
  updateAuditKPIs();
  renderAuditTable();
  renderAuditPagination();
  renderAuditTempoTable();
  bindAuditTabs();
  bindAuditFilters();
}

function formatAuditDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(2);
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  const secs = String(d.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${mins}:${secs}`;
}

async function updateAuditKPIs() {
  const acoesEl = document.getElementById('auditKpiAcoes');
  const usersEl = document.getElementById('auditKpiUsuarios');
  const totalEl = document.getElementById('auditKpiTotal');

  try {
    const [acoes, users, total] = await Promise.all([
      contarAcoesHoje(),
      contarUsuariosAtivosHoje(),
      contarAuditoria()
    ]);
    if (acoesEl) acoesEl.textContent = acoes.toLocaleString('pt-BR');
    if (usersEl) usersEl.textContent = users;
    if (totalEl) totalEl.textContent = total.toLocaleString('pt-BR');
  } catch (err) {
    console.error('[Auditoria] Erro ao atualizar KPIs:', err);
  }

  // Páginas visitadas (estimativa baseada nos registros)
  const paginasEl = document.getElementById('auditKpiPaginas');
  if (paginasEl) {
    const paginas = new Set(auditData.map(r => r.actionUrl));
    paginasEl.textContent = paginas.size;
  }
}

/* Mock data fallback */
const auditMockUsers = [
  { name: 'Camila Souza',     hash: 'CS-8a2f' },
  { name: 'Rafaela Ferreira', hash: 'RF-3b1c' },
  { name: 'João Pedro',       hash: 'JP-7d4e' },
  { name: 'Marina Alves',     hash: 'MA-9f6a' }
];
const auditMockActions = [
  { name: 'LOGIN',        url: '/auth/login' },
  { name: 'VIEW_LEAD',    url: '/crm' },
  { name: 'EDIT_LEAD',    url: '/crm/edit' },
  { name: 'CREATE_LEAD',  url: '/crm/new' },
  { name: 'VIEW_EVENT',   url: '/calendario' },
  { name: 'VIEW_ROTINA',  url: '/rotina' },
  { name: 'EDIT_ROTINA',  url: '/rotina/edit' },
  { name: 'VIEW_DASH',    url: '/dashboard' }
];
const auditMockModules = ['CRM', 'Clientes', 'Calendário', 'Rotina', 'Dashboard', 'Configurações'];
const auditMockDevices = [
  { type: 'desktop', icon: 'monitor', label: 'Desktop' },
  { type: 'mobile',  icon: 'smartphone', label: 'Mobile' }
];

function generateAuditMockData(count) {
  const data = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const user = auditMockUsers[Math.floor(Math.random() * auditMockUsers.length)];
    const action = auditMockActions[Math.floor(Math.random() * auditMockActions.length)];
    const module = auditMockModules[Math.floor(Math.random() * auditMockModules.length)];
    const device = auditMockDevices[Math.floor(Math.random() * auditMockDevices.length)];
    const date = new Date(now);
    date.setMinutes(date.getMinutes() - Math.floor(Math.random() * 1440));
    data.push({
      id: i + 1,
      user: user.name,
      hash: user.hash,
      action: action.name,
      actionUrl: action.url,
      module,
      device: device.label,
      deviceIcon: device.icon,
      datetime: formatAuditDate(date.toISOString())
    });
  }
  return data.sort((a, b) => b.id - a.id);
}

const auditTempoData = [
  { page: '/crm',            tempoMedio: '4m 32s', visitas: 342, usuarios: 6, retorno: '68%' },
  { page: '/clientes',       tempoMedio: '3m 15s', visitas: 287, usuarios: 5, retorno: '54%' },
  { page: '/calendario',     tempoMedio: '2m 48s', visitas: 215, usuarios: 7, retorno: '42%' },
  { page: '/dashboard',      tempoMedio: '5m 10s', visitas: 198, usuarios: 4, retorno: '71%' },
  { page: '/rotina',         tempoMedio: '3m 55s', visitas: 176, usuarios: 8, retorno: '63%' },
  { page: '/configuracoes',  tempoMedio: '1m 22s', visitas: 89,  usuarios: 3, retorno: '22%' },
  { page: '/home',           tempoMedio: '0m 45s', visitas: 421, usuarios: 8, retorno: '35%' },
  { page: '/auditoria',      tempoMedio: '2m 10s', visitas: 54,  usuarios: 2, retorno: '48%' }
];

function getFilteredAuditData() {
  const search = ($('#auditSearchInput')?.value || '').toLowerCase().trim();
  const modulo = $('#auditFilterModulo')?.value || 'all';
  const acao = $('#auditFilterAcao')?.value || 'all';
  const func = $('#auditFilterFunc')?.value || 'all';
  const device = $('#auditFilterDevice')?.value || 'all';

  return auditData.filter(row => {
    if (search && !row.user.toLowerCase().includes(search) && !row.action.toLowerCase().includes(search) && !row.actionUrl.toLowerCase().includes(search)) return false;
    if (modulo !== 'all' && row.module.toLowerCase() !== modulo) return false;
    if (acao !== 'all' && row.action !== acao) return false;
    if (func !== 'all') {
      const nameMap = { camila: 'Camila', rafaela: 'Rafaela', joao: 'João', marina: 'Marina' };
      if (!row.user.includes(nameMap[func] || func)) return false;
    }
    if (device !== 'all' && row.device.toLowerCase() !== device) return false;
    return true;
  });
}

function renderAuditTable() {
  const tbody = $('#auditTableBody');
  if (!tbody) return;
  const filtered = getFilteredAuditData();
  const start = (auditPage - 1) * auditPageSize;
  const pageData = filtered.slice(start, start + auditPageSize);

  if (!pageData.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--muted-text)">
      <i data-lucide="inbox" style="width:32px;height:32px;opacity:0.3;display:block;margin:0 auto 8px"></i>
      Nenhum registro encontrado
    </td></tr>`;
    initIcons();
    return;
  }

  tbody.innerHTML = pageData.map(row => `
    <tr>
      <td>
        <span class="audit-user-name">${escapeHtml(row.user)}</span>
        <span class="audit-user-hash">${escapeHtml(row.hash)}</span>
      </td>
      <td>
        <span class="audit-action-name">${escapeHtml(row.action)}</span>
        <span class="audit-action-url">${escapeHtml(row.actionUrl)}</span>
      </td>
      <td><span class="audit-module-badge">${escapeHtml(row.module)}</span></td>
      <td>
        <span class="audit-device">
          <i data-lucide="${row.deviceIcon}"></i> ${escapeHtml(row.device)}
        </span>
      </td>
      <td>${escapeHtml(row.datetime)}</td>
    </tr>
  `).join('');
  initIcons();
}

function renderAuditPagination() {
  const el = $('#auditPagination');
  if (!el) return;
  const filtered = getFilteredAuditData();
  const totalPages = Math.ceil(filtered.length / auditPageSize);
  const start = (auditPage - 1) * auditPageSize + 1;
  const end = Math.min(auditPage * auditPageSize, filtered.length);

  el.innerHTML = `
    <span>Mostrando ${start}–${end} de ${filtered.length} registros</span>
    <div class="audit-pagination-btns">
      <button class="audit-pagination-btn" data-page="prev" ${auditPage <= 1 ? 'disabled' : ''}>Anterior</button>
      ${Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
        const p = i + 1;
        return `<button class="audit-pagination-btn ${p === auditPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
      }).join('')}
      <button class="audit-pagination-btn" data-page="next" ${auditPage >= totalPages ? 'disabled' : ''}>Próximo</button>
    </div>`;

  el.querySelectorAll('.audit-pagination-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.page;
      if (val === 'prev' && auditPage > 1) auditPage--;
      else if (val === 'next' && auditPage < totalPages) auditPage++;
      else if (!isNaN(val)) auditPage = parseInt(val);
      renderAuditTable();
      renderAuditPagination();
    });
  });
}

function renderAuditTempoTable() {
  const tbody = $('#auditTempoBody');
  if (!tbody) return;
  tbody.innerHTML = auditTempoData.map(row => `
    <tr>
      <td style="font-weight:600">${escapeHtml(row.page)}</td>
      <td>${escapeHtml(row.tempoMedio)}</td>
      <td>${row.visitas}</td>
      <td>${row.usuarios}</td>
      <td>${escapeHtml(row.retorno)}</td>
    </tr>
  `).join('');
}

function bindAuditTabs() {
  $$('.audit-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.audit-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.audit-tab-content').forEach(c => c.classList.remove('active'));
      const target = tab.dataset.auditTab;
      if (target === 'historico') $('#auditTabHistorico')?.classList.add('active');
      else if (target === 'tempo') $('#auditTabTempo')?.classList.add('active');
      else if (target === 'educacao') $('#auditTabEducacao')?.classList.add('active');
    });
  });
}

function bindAuditFilters() {
  ['auditFilterRows','auditFilterPeriodo','auditFilterAcao','auditFilterModulo','auditFilterFunc','auditFilterDevice'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      auditPage = 1;
      renderAuditTable();
      renderAuditPagination();
    });
  });
  const search = $('#auditSearchInput');
  if (search) {
    let debounce;
    search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        auditPage = 1;
        renderAuditTable();
        renderAuditPagination();
      }, 200);
    });
  }
  const refresh = $('#auditRefreshBtn');
  if (refresh) refresh.addEventListener('click', async () => {
    try {
      const dados = await buscarAuditoria({ limit: 500 });
      if (dados.length > 0) {
        auditData = dados.map(row => ({
          id:         row.id,
          user:       row.usuario_nome,
          hash:       row.usuario_id,
          action:     row.acao,
          actionUrl:  row.caminho_url,
          module:     row.modulo,
          device:     row.dispositivo,
          deviceIcon: (row.dispositivo || '').toLowerCase() === 'mobile' ? 'smartphone' : 'monitor',
          datetime:   formatAuditDate(row.created_at)
        }));
      } else {
        auditData = generateAuditMockData(120);
      }
    } catch (err) {
      console.error('[Auditoria] Erro ao atualizar:', err);
      auditData = generateAuditMockData(120);
    }
    auditPage = 1;
    updateAuditKPIs();
    renderAuditTable();
    renderAuditPagination();
    toast('Auditoria atualizada');
  });
  const exportBtn = $('#auditExportBtn');
  if (exportBtn) exportBtn.addEventListener('click', () => {
    const filtered = getFilteredAuditData();
    const cols = ['Usuário', 'Hash', 'Ação', 'URL', 'Módulo', 'Dispositivo', 'Data/Hora'];
    const rows = filtered.map(r => ({ 'Usuário': r.user, 'Hash': r.hash, 'Ação': r.action, 'URL': r.actionUrl, 'Módulo': r.module, 'Dispositivo': r.device, 'Data/Hora': r.datetime }));
    if (!rows.length) { toast('Nenhum dado para exportar', 'error'); return; }
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `auditoria-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
    toast('CSV exportado');
  });
}

/* ============================================
   CALIBRAGEM · Performance dos funcionários
   ============================================ */
let _calibSelectedMember = null;
let _calibMembersCache = [];

function initCalibragem() {
  if (!isCurrentUserAdmin()) {
    console.warn('[Calibragem] Acesso negado: usuário não é Administrador');
    setActivePage('home');
    return;
  }
  loadCalibragemMembers();
  bindCalibragemTabs();
  bindCalibragemReport();
}

async function loadCalibragemMembers() {
  if (!_supabase) return;
  try {
    const { data, error } = await _supabase.from('membros').select('id, nome, cargo, foto_url').order('nome');
    if (error) throw error;
    _calibMembersCache = data || [];
    renderCalibMemberTabs();
    if (_calibMembersCache.length > 0) {
      selectCalibMember(_calibMembersCache[0].id);
    }
  } catch (err) {
    console.error('[Calibragem] Erro ao carregar membros:', err);
  }
}

function renderCalibMemberTabs() {
  const wrap = document.getElementById('calibMemberTabs');
  if (!wrap) return;
  wrap.innerHTML = _calibMembersCache.map(m => {
    const initials = (m.nome || '').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    return `<button class="calib-member-tab" data-member-id="${m.id}"><span class="calib-member-avatar">${escapeHtml(initials)}</span> ${escapeHtml(m.nome || '')}</button>`;
  }).join('');

  wrap.querySelectorAll('.calib-member-tab').forEach(btn => {
    btn.addEventListener('click', () => selectCalibMember(btn.dataset.memberId));
  });
}

async function selectCalibMember(memberId) {
  _calibSelectedMember = _calibMembersCache.find(m => String(m.id) === String(memberId));
  if (!_calibSelectedMember) return;

  document.querySelectorAll('.calib-member-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`.calib-member-tab[data-member-id="${memberId}"]`);
  if (activeTab) activeTab.classList.add('active');

  const initials = (_calibSelectedMember.nome || '').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  document.getElementById('calibProfileAvatar').textContent = initials;
  document.getElementById('calibProfileName').textContent = _calibSelectedMember.nome || '—';
  document.getElementById('calibProfileRole').textContent = _calibSelectedMember.cargo || '—';

  document.getElementById('calibLastUpdate').textContent = new Date().toLocaleDateString('pt-BR') + ' às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  await loadCalibragemData(memberId);
}

async function loadCalibragemData(memberId) {
  const member = _calibMembersCache.find(m => String(m.id) === String(memberId));
  const memberName = member ? member.nome : '';

  const allLeads = leads.filter(l => {
    if (!memberName) return true;
    return (l.responsavel || '').toLowerCase() === memberName.toLowerCase();
  });

  const total = allLeads.length;
  const quentes = allLeads.filter(l => (l.thermal || '').toLowerCase() === 'quente').length;
  const mornos = allLeads.filter(l => (l.thermal || '').toLowerCase() === 'morno').length;
  const frios = allLeads.filter(l => (l.thermal || '').toLowerCase() === 'frio').length;
  const finalizados = allLeads.filter(l => {
    const cad = (l.status || '').toLowerCase();
    return cad.includes('fechado') || cad.includes('contrato');
  }).length;
  const semAtendimento = allLeads.filter(l => {
    const cad = (l.status || '').toLowerCase();
    return cad.includes('frio') || cad.includes('geladeira');
  }).length;
  const conversao = total > 0 ? Math.round((finalizados / total) * 100) : 0;

    document.getElementById('calibLeadsTotal').textContent = total;
    document.getElementById('calibLeadsQuentes').textContent = quentes;
    document.getElementById('calibTempoResposta').textContent = total > 0 ? '—' : '—';
    document.getElementById('calibSemAtendimento').textContent = semAtendimento;
    document.getElementById('calibVisitas').textContent = finalizados;
    document.getElementById('calibConversao').textContent = conversao + '%';

    document.getElementById('calibQtdQuente').textContent = quentes;
    document.getElementById('calibQtdMorno').textContent = mornos;
    document.getElementById('calibQtdFrio').textContent = frios;
    const pctQ = total > 0 ? Math.round((quentes / total) * 100) : 0;
    const pctM = total > 0 ? Math.round((mornos / total) * 100) : 0;
    const pctF = total > 0 ? Math.round((frios / total) * 100) : 0;
    document.getElementById('calibPctQuente').textContent = pctQ + '%';
    document.getElementById('calibPctMorno').textContent = pctM + '%';
    document.getElementById('calibPctFrio').textContent = pctF + '%';

    drawCalibDonut(quentes, mornos, frios);

    document.getElementById('calibPerfTotal').textContent = total;
    document.getElementById('calibPerfFinalizados').textContent = finalizados;
    document.getElementById('calibPerfAndamento').textContent = total - finalizados - semAtendimento;
    document.getElementById('calibPerfPendentes').textContent = semAtendimento;

    let status, statusCls, pontosFortes, pontosMelhorar;
    if (conversao >= 30) {
      status = 'EXCELENTE'; statusCls = 'calib-status-excellent';
      pontosFortes = 'Alta taxa de conversão e boa qualificação de leads.';
      pontosMelhorar = 'Manter consistência e buscar novos canais de captação.';
    } else if (conversao >= 15) {
      status = 'BOM'; statusCls = 'calib-status-good';
      pontosFortes = 'Performance acima da média com bons resultados.';
      pontosMelhorar = 'Focar na qualificação de leads para aumentar conversão.';
    } else if (conversao >= 5) {
      status = 'REGULAR'; statusCls = 'calib-status-regular';
      pontosFortes = 'Participação ativa na equipe.';
      pontosMelhorar = 'Melhorar tempo de resposta e follow-up com leads.';
    } else {
      status = 'CRÍTICO'; statusCls = 'calib-status-critical';
      pontosFortes = 'Presença na equipe.';
      pontosMelhorar = 'Necessário revisão de abordagem e aumento da atividade comercial.';
    }

    const statusBadge = document.getElementById('calibStatusBadge');
    statusBadge.textContent = status;
    statusBadge.className = 'calib-status-badge ' + statusCls;
    document.getElementById('calibRanking').textContent = '#—';
    document.getElementById('calibEvolucao').textContent = conversao > 0 ? '+' + conversao + '%' : '—';
    document.getElementById('calibDiagStatus').textContent = status;
    document.getElementById('calibDiagStatus').className = 'calib-diag-status ' + statusCls;
    document.getElementById('calibDiagPontosFortes').textContent = pontosFortes;
    document.getElementById('calibDiagPontosMelhorar').textContent = pontosMelhorar;

    const baseEmpty = document.getElementById('calibBaseEmpty');
    if (total === 0 && baseEmpty) {
      baseEmpty.innerHTML = '<i data-lucide="inbox"></i><p>Nenhum dado no período</p>';
      initIcons();
    }
}

function setCalibragemPlaceholders() {
  ['calibLeadsTotal','calibLeadsQuentes','calibTempoResposta','calibSemAtendimento','calibVisitas','calibConversao'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = id === 'calibConversao' ? '0%' : '0';
  });
  ['calibQtdQuente','calibQtdMorno','calibQtdFrio'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '0';
  });
  ['calibPctQuente','calibPctMorno','calibPctFrio'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '0%';
  });
  drawCalibDonut(0, 0, 0);
}

function drawCalibDonut(quente, morno, frio) {
  const canvas = document.getElementById('calibDonutCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const total = quente + morno + frio;
  const cx = 100, cy = 100, r = 80, lw = 24;
  ctx.clearRect(0, 0, 200, 200);

  if (total === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#E5E7EB';
    ctx.lineWidth = lw;
    ctx.stroke();
    return;
  }

  const colors = ['#EF4444', '#F59E0B', '#3B82F6'];
  const values = [quente, morno, frio];
  let start = -Math.PI / 2;
  values.forEach((val, i) => {
    if (val === 0) return;
    const slice = (val / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + slice);
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = lw;
    ctx.stroke();
    start += slice;
  });
}

function bindCalibragemTabs() {
  document.querySelectorAll('.calib-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.calib-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.calib-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.calibTab;
      const map = {
        'base-clientes': 'calibTabBaseClientes',
        'performance': 'calibTabPerformance',
        'educacao': 'calibTabEducacao',
        'diagnostico': 'calibTabDiagnostico'
      };
      const content = document.getElementById(map[target]);
      if (content) content.classList.add('active');
      initIcons();
    });
  });
}

function bindCalibragemReport() {
  const btn = document.getElementById('calibReportBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      toast('Relatório PDF será implementado em breve.', 'info');
    });
  }
  const viewAllBtn = document.getElementById('calibViewAllLeads');
  if (viewAllBtn) {
    viewAllBtn.addEventListener('click', () => {
      setActivePage('crm');
    });
  }
}

/* ============================================
   CONVERSAS - CENTRAL DE MENSAGENS
   ============================================ */
let conversasState = {
  chats: [],
  selectedChatId: null,
  messages: [],
  members: [],
  realtimeChannel: null
};

async function loadConversasChats() {
  const list = $('#conversasList');
  if (!list) return;

  try {
    const canViewAll = canViewAllData();
    const userId = getCurrentUserId();

    let query = _supabase
      .from('chats')
      .select('id, contact_name, contact_phone, status, assigned_to, lead_id, last_message, last_message_at, created_at')
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (!canViewAll && userId) {
      query = query.eq('assigned_to', userId);
    }

    const { data, error } = await query;
    if (error) throw error;

    conversasState.chats = data || [];
    renderConversasList();

    // Carregar membros para o select de atribuição
    const { data: membrosData } = await _supabase
      .from('membros')
      .select('id, nome')
      .eq('status', 'Ativo')
      .order('nome');
    conversasState.members = membrosData || [];

  } catch (err) {
    console.error('[Conversas] Erro ao carregar chats:', err);
    list.innerHTML = '<div class="conversas-empty-state"><p>Erro ao carregar conversas</p></div>';
  }
}

function renderConversasList() {
  const list = $('#conversasList');
  if (!list) return;

  const chats = conversasState.chats;

  if (!chats.length) {
    list.innerHTML = `<div class="conversas-empty-state">
      <i data-lucide="message-circle"></i>
      <p>Nenhuma conversa encontrada</p>
    </div>`;
    initIcons();
    return;
  }

  list.innerHTML = chats.map(chat => {
    const initials = (chat.contact_name || chat.contact_phone || '?')
      .split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const time = chat.last_message_at
      ? new Date(chat.last_message_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : '';
    const isActive = chat.id === conversasState.selectedChatId;
    const statusColors = { open: '#22c55e', pending: '#f59e0b', closed: '#94a3b8' };
    const dotColor = statusColors[chat.status] || '#94a3b8';

    return `
      <div class="conversas-chat-item${isActive ? ' active' : ''}" data-chat-id="${chat.id}">
        <div class="conversas-chat-avatar">${initials}</div>
        <div class="conversas-chat-info">
          <div class="conversas-chat-name">${escapeHtml(chat.contact_name || chat.contact_phone)}</div>
          <div class="conversas-chat-preview">${escapeHtml(chat.last_message || 'Sem mensagens')}</div>
        </div>
        <div class="conversas-chat-meta">
          <span class="conversas-chat-time">${time}</span>
          <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};display:inline-block;"></span>
        </div>
      </div>`;
  }).join('');

  initIcons();

  list.querySelectorAll('.conversas-chat-item').forEach(item => {
    item.addEventListener('click', () => selectConversasChat(item.dataset.chatId));
  });
}

async function selectConversasChat(chatId) {
  conversasState.selectedChatId = chatId;
  const chat = conversasState.chats.find(c => c.id === chatId);
  if (!chat) return;

  renderConversasList();

  // Coluna 2: Detalhes
  $('#conversasDetailEmpty').style.display = 'none';
  $('#conversasDetailContent').style.display = 'block';

  const initials = (chat.contact_name || chat.contact_phone || '?')
    .split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

  $('#detailAvatar').textContent = initials;
  $('#detailName').textContent = chat.contact_name || 'Sem nome';
  $('#detailPhone').textContent = chat.contact_phone ? `+${chat.contact_phone}` : '';
  $('#detailStatus').value = chat.status || 'open';

  // Select de responsável
  const assigneeSelect = $('#detailAssignee');
  assigneeSelect.innerHTML = '<option value="">Não atribuído</option>' +
    conversasState.members.map(m =>
      `<option value="${m.id}"${chat.assigned_to === m.id ? ' selected' : ''}>${m.nome}</option>`
    ).join('');

  // Lead vinculado
  const linkedLead = $('#detailLinkedLead');
  if (chat.lead_id) {
    const { data: lead } = await _supabase.from('leads').select('nome').eq('id', chat.lead_id).single();
    linkedLead.innerHTML = lead ? `<span style="color:var(--blue-600);font-weight:600;">${escapeHtml(lead.nome)}</span>` : '<span>Lead não encontrado</span>';
  } else {
    linkedLead.innerHTML = '<span>Nenhum lead vinculado</span>';
  }

  // Coluna 3: Mensagens
  $('#conversasChatEmpty').style.display = 'none';
  $('#conversasChatContent').style.display = 'flex';
  $('#chatHeaderName').textContent = chat.contact_name || chat.contact_phone;
  $('#chatHeaderStatus').textContent = chat.status === 'open' ? 'Online' : chat.status === 'pending' ? 'Pendente' : 'Fechado';

  await loadConversasMessages(chatId);
}

async function loadConversasMessages(chatId) {
  const container = $('#conversasMessages');
  if (!container) return;

  try {
    const { data, error } = await _supabase
      .from('messages')
      .select('id, chat_id, content, sender_type, sender_name, created_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    conversasState.messages = data || [];
    renderConversasMessages();

  } catch (err) {
    console.error('[Conversas] Erro ao carregar mensagens:', err);
    container.innerHTML = '<div class="conversas-empty-state"><p>Erro ao carregar mensagens</p></div>';
  }
}

function renderConversasMessages() {
  const container = $('#conversasMessages');
  if (!container) return;

  const msgs = conversasState.messages;

  if (!msgs.length) {
    container.innerHTML = `<div class="conversas-empty-state">
      <i data-lucide="message-square"></i>
      <p>Nenhuma mensagem ainda</p>
    </div>`;
    initIcons();
    return;
  }

  container.innerHTML = msgs.map(msg => {
    const type = msg.sender_type === 'agent' ? 'agent' : 'lead';
    const time = new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="conversas-msg ${type}">
        <div>${escapeHtml(msg.content)}</div>
        <div class="conversas-msg-time">${time}</div>
      </div>`;
  }).join('');

  container.scrollTop = container.scrollHeight;
  initIcons();
}

async function sendConversasMessage() {
  const input = $('#conversasMessageInput');
  if (!input) return;

  const content = input.value.trim();
  if (!content || !conversasState.selectedChatId) return;

  input.value = '';

  try {
    const { error } = await _supabase
      .from('messages')
      .insert([{
        chat_id: conversasState.selectedChatId,
        sender_type: 'agent',
        sender_name: currentUser?.nome || 'Atendente',
        content: content,
        status: 'sent'
      }]);

    if (error) throw error;

    // Atualizar last_message no chat
    await _supabase
      .from('chats')
      .update({
        last_message: content,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', conversasState.selectedChatId);

  } catch (err) {
    console.error('[Conversas] Erro ao enviar mensagem:', err);
    toast('Erro ao enviar mensagem');
  }
}

function subscribeConversasRealtime() {
  if (conversasState.realtimeChannel) {
    _supabase.removeChannel(conversasState.realtimeChannel);
  }

  conversasState.realtimeChannel = _supabase
    .channel('conversas-realtime')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        console.log('[Conversas] Nova mensagem recebida:', payload);
        const newMsg = payload.new;

        // Se é do chat selecionado, adicionar à lista
        if (newMsg.chat_id === conversasState.selectedChatId) {
          conversasState.messages.push(newMsg);
          renderConversasMessages();
        }

        // Atualizar last_message na lista de chats
        const chatItem = conversasState.chats.find(c => c.id === newMsg.chat_id);
        if (chatItem) {
          chatItem.last_message = newMsg.content;
          chatItem.last_message_at = newMsg.created_at;
          renderConversasList();
        }
      }
    )
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'chats' },
      (payload) => {
        console.log('[Conversas] Chat atualizado:', payload);
        const updatedChat = payload.new;
        const idx = conversasState.chats.findIndex(c => c.id === updatedChat.id);
        if (idx >= 0) {
          conversasState.chats[idx] = { ...conversasState.chats[idx], ...updatedChat };
          renderConversasList();
        }
      }
    )
    .subscribe();
}

function initConversas() {
  const searchInput = $('#conversasSearchInput');
  const sendBtn = $('#conversasSendBtn');
  const msgInput = $('#conversasMessageInput');
  const statusSelect = $('#detailStatus');
  const assigneeSelect = $('#detailAssignee');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      const filtered = conversasState.chats.filter(c =>
        (c.contact_name || '').toLowerCase().includes(term) ||
        (c.contact_phone || '').includes(term)
      );
      const list = $('#conversasList');
      if (!list) return;

      if (!filtered.length) {
        list.innerHTML = '<div class="conversas-empty-state"><p>Nenhuma conversa encontrada</p></div>';
        return;
      }

      const chats = filtered;
      list.innerHTML = chats.map(chat => {
        const initials = (chat.contact_name || chat.contact_phone || '?')
          .split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
        const time = chat.last_message_at
          ? new Date(chat.last_message_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          : '';
        const isActive = chat.id === conversasState.selectedChatId;
        const statusColors = { open: '#22c55e', pending: '#f59e0b', closed: '#94a3b8' };
        const dotColor = statusColors[chat.status] || '#94a3b8';

        return `
          <div class="conversas-chat-item${isActive ? ' active' : ''}" data-chat-id="${chat.id}">
            <div class="conversas-chat-avatar">${initials}</div>
            <div class="conversas-chat-info">
              <div class="conversas-chat-name">${escapeHtml(chat.contact_name || chat.contact_phone)}</div>
              <div class="conversas-chat-preview">${escapeHtml(chat.last_message || 'Sem mensagens')}</div>
            </div>
            <div class="conversas-chat-meta">
              <span class="conversas-chat-time">${time}</span>
              <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};display:inline-block;"></span>
            </div>
          </div>`;
      }).join('');

      list.querySelectorAll('.conversas-chat-item').forEach(item => {
        item.addEventListener('click', () => selectConversasChat(item.dataset.chatId));
      });
    });
  }

  if (sendBtn) sendBtn.addEventListener('click', sendConversasMessage);

  if (msgInput) {
    msgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendConversasMessage();
      }
    });
  }

  if (statusSelect) {
    statusSelect.addEventListener('change', async (e) => {
      if (!conversasState.selectedChatId) return;
      await _supabase
        .from('chats')
        .update({ status: e.target.value, updated_at: new Date().toISOString() })
        .eq('id', conversasState.selectedChatId);
    });
  }

  if (assigneeSelect) {
    assigneeSelect.addEventListener('change', async (e) => {
      if (!conversasState.selectedChatId) return;
      await _supabase
        .from('chats')
        .update({ assigned_to: e.target.value || null, updated_at: new Date().toISOString() })
        .eq('id', conversasState.selectedChatId);
    });
  }

  // Carregar dados e inscrever em realtime
  loadConversasChats();
  subscribeConversasRealtime();
}

/* ============================================
   CENTROS DE CUSTO · ESTADO + CRUD + RENDER
   ============================================ */
let centrosCustoData = [];
let _ccBound = false;
let _ccDeleteId = null;
let _ccDetailId = null;
let _ccDetailNome = null;

// Dashboard: filtro por centro de custo
let dashCcFilter = 'all';

async function initCentrosCusto() {
  if (_ccBound) return;
  _ccBound = true;

  // Carregar dados
  await loadCentrosCustoFromSupabase();

  // Botão "Novo Centro de Custo"
  const newBtn = document.getElementById('ccNewBtn');
  if (newBtn) newBtn.addEventListener('click', openCcModal);

  // Modal: fechar
  document.querySelectorAll('[data-action="close-cc-modal"]').forEach(b => b.addEventListener('click', closeCcModal));
  const ccOverlay = document.getElementById('ccModalOverlay');
  if (ccOverlay) ccOverlay.addEventListener('click', closeCcModal);

  // Modal: salvar
  const saveBtn = document.getElementById('ccSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', handleCcSave);

  // Modal: deletar fechar
  document.querySelectorAll('[data-action="close-cc-delete"]').forEach(b => b.addEventListener('click', closeCcDeleteModal));
  const delOverlay = document.getElementById('ccDeleteOverlay');
  if (delOverlay) delOverlay.addEventListener('click', closeCcDeleteModal);

  // Modal: deletar confirmar
  const delConfirmBtn = document.getElementById('ccDeleteConfirmBtn');
  if (delConfirmBtn) delConfirmBtn.addEventListener('click', handleCcDelete);

  // Botão voltar na página de detalhe
  const backBtn = document.getElementById('ccBackBtn');
  if (backBtn) backBtn.addEventListener('click', () => setActivePage('centros-custo'));
}

async function loadCentrosCustoFromSupabase() {
  try {
    centrosCustoData = await fetchCentrosCusto();
    console.log('[CC] Centros de custo carregados:', centrosCustoData.length);
  } catch (err) {
    console.error('[CC] Erro ao carregar centros de custo:', err);
    centrosCustoData = [];
  }
  renderCentrosCustoGrid();
  populateDashCcFilter();
  populateEmpresaFilter();
  initCrmEmpresaFilter();
}

function renderCentrosCustoGrid() {
  const grid = document.getElementById('ccGrid');
  if (!grid) return;

  if (centrosCustoData.length === 0) {
    grid.innerHTML = `
      <div class="cc-empty-state">
        <i data-lucide="building-2"></i>
        <p>Nenhum centro de custo cadastrado</p>
        <button class="btn-primary" onclick="openCcModal()"><i data-lucide="plus"></i> Criar Primeiro Centro</button>
      </div>`;
    initIcons();
    return;
  }

  grid.innerHTML = centrosCustoData.map(cc => {
    const isTodos = cc.nome === 'Todos';
    const leadCount = isTodos ? leads.length : leads.filter(l => l._centroCustoId === cc.id).length;
    const totalHonorarios = isTodos
      ? leads.reduce((sum, l) => sum + (l.honorarios || 0), 0)
      : leads.filter(l => l._centroCustoId === cc.id).reduce((sum, l) => sum + (l.honorarios || 0), 0);
    const iconColor = isTodos ? 'var(--blue-600)' : getCentroCustoColor(cc.nome);

    return `
      <div class="cc-card" data-cc-id="${cc.id}" data-cc-nome="${escapeHtml(cc.nome)}" tabindex="0" role="button" aria-label="Abrir centro de custo ${escapeHtml(cc.nome)}">
        <div class="cc-card-header">
          <div class="cc-card-icon" style="background:${iconColor}15;color:${iconColor}">
            <i data-lucide="${isTodos ? 'layers' : 'building-2'}"></i>
          </div>
          <div class="cc-card-actions">
            ${!isTodos ? `<button class="icon-btn small cc-delete-btn" data-cc-id="${cc.id}" data-cc-nome="${escapeHtml(cc.nome)}" title="Remover" aria-label="Remover ${escapeHtml(cc.nome)}"><i data-lucide="trash-2"></i></button>` : ''}
          </div>
        </div>
        <h3 class="cc-card-name">${escapeHtml(cc.nome)}</h3>
        <div class="cc-card-stats">
          <div class="cc-card-stat">
            <span class="cc-card-stat-value">${leadCount}</span>
            <span class="cc-card-stat-label">Lead${leadCount !== 1 ? 's' : ''}</span>
          </div>
          <div class="cc-card-stat">
            <span class="cc-card-stat-value">R$ ${totalHonorarios.toLocaleString('pt-BR')}</span>
            <span class="cc-card-stat-label">Faturamento</span>
          </div>
        </div>
        <div class="cc-card-footer">
          <span class="cc-card-link">Ver detalhes <i data-lucide="arrow-right"></i></span>
        </div>
      </div>`;
  }).join('');

  initIcons();

  // Bind clicks nos cards
  grid.querySelectorAll('.cc-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.cc-delete-btn')) return;
      const id = card.dataset.ccId;
      const nome = card.dataset.ccNome;
      openCentroCustoDetail(id, nome);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!e.target.closest('.cc-delete-btn')) {
          openCentroCustoDetail(card.dataset.ccId, card.dataset.ccNome);
        }
      }
    });
  });

  // Bind delete buttons
  grid.querySelectorAll('.cc-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _ccDeleteId = btn.dataset.ccId;
      const text = document.getElementById('ccDeleteText');
      if (text) text.textContent = `Tem certeza que deseja remover o centro de custo "${btn.dataset.ccNome}"? Leads vinculados perderão a referência.`;
      openCcDeleteModal();
    });
  });
}

function getCentroCustoColor(nome) {
  const colors = {
    'Blue PRO': '#165BFF',
    'Blue Eventos': '#10B981',
    'Blue Digital': '#A855F7'
  };
  return colors[nome] || '#6B7885';
}

/* ── Modal helpers ── */
function openCcModal() {
  const overlay = document.getElementById('ccModalOverlay');
  const modal = document.getElementById('ccModal');
  const input = document.getElementById('ccNameInput');
  if (overlay) overlay.classList.add('open');
  if (modal) { modal.classList.add('open'); modal.scrollTop = 0; }
  if (input) { input.value = ''; input.focus(); }
  initIcons();
}

function closeCcModal() {
  const overlay = document.getElementById('ccModalOverlay');
  const modal = document.getElementById('ccModal');
  if (overlay) overlay.classList.remove('open');
  if (modal) modal.classList.remove('open');
}

function openCcDeleteModal() {
  const overlay = document.getElementById('ccDeleteOverlay');
  const modal = document.getElementById('ccDeleteModal');
  if (overlay) overlay.classList.add('open');
  if (modal) modal.classList.add('open');
  initIcons();
}

function closeCcDeleteModal() {
  const overlay = document.getElementById('ccDeleteOverlay');
  const modal = document.getElementById('ccDeleteModal');
  if (overlay) overlay.classList.remove('open');
  if (modal) modal.classList.remove('open');
  _ccDeleteId = null;
}

/* ── Save handler ── */
async function handleCcSave() {
  const input = document.getElementById('ccNameInput');
  const nome = input?.value?.trim();
  if (!nome) { toast('Preencha o nome do centro de custo', 'error'); return; }

  // Verificar duplicata
  if (centrosCustoData.some(cc => cc.nome.toLowerCase() === nome.toLowerCase())) {
    toast('Já existe um centro de custo com este nome', 'error');
    return;
  }

  const saveBtn = document.getElementById('ccSaveBtn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="auth-spinner"></span>';

  try {
    await insertCentroCusto(nome);
    toast('Centro de custo criado com sucesso!');
    closeCcModal();
    await loadCentrosCustoFromSupabase();
    invalidateDashCache();
    populateDashCcFilter();
  } catch (err) {
    console.error('[CC] Erro ao criar centro de custo:', err);
    toast(err.message || 'Erro ao criar centro de custo', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i data-lucide="save"></i> Salvar';
    initIcons();
  }
}

/* ── Delete handler ── */
async function handleCcDelete() {
  if (!_ccDeleteId) return;

  const delBtn = document.getElementById('ccDeleteConfirmBtn');
  delBtn.disabled = true;
  delBtn.innerHTML = '<span class="auth-spinner"></span>';

  try {
    // Atualizar leads que tinham este centro de custo
    await _supabase.from('leads').update({ centro_custo_id: null }).eq('centro_custo_id', _ccDeleteId);

    await deleteCentroCusto(_ccDeleteId);
    toast('Centro de custo removido com sucesso!');
    closeCcDeleteModal();
    await loadCentrosCustoFromSupabase();
    invalidateDashCache();
    populateDashCcFilter();
  } catch (err) {
    console.error('[CC] Erro ao deletar centro de custo:', err);
    toast(err.message || 'Erro ao deletar centro de custo', 'error');
  } finally {
    delBtn.disabled = false;
    delBtn.innerHTML = '<i data-lucide="trash-2"></i> Remover';
    initIcons();
  }
}

/* ── Página de detalhe do centro de custo ── */
function openCentroCustoDetail(id, nome) {
  _ccDetailId = id;
  _ccDetailNome = nome;

  // Atualizar header
  const titleEl = document.getElementById('ccDetailTitle');
  const subtitleEl = document.getElementById('ccDetailSubtitle');
  if (titleEl) titleEl.textContent = nome;
  if (subtitleEl) subtitleEl.textContent = `Dados e funcionalidades do centro de custo "${nome}"`;

  // Mover o dashboard para a view do CC
  const dashboardContainer = document.querySelector('#page-dashboard > .dash-container') || document.querySelector('.dash-container');
  const ccWrapper = document.getElementById('ccDashboardWrapper');
  if (dashboardContainer && ccWrapper) {
    ccWrapper.appendChild(dashboardContainer);
  }
  
  // Esconder a barra superior de filtro original
  const dashHeader = document.querySelector('.dash-header');
  if (dashHeader) dashHeader.style.display = 'none';

  // Configurar Filtro para este Centro de Custo e atualizar Dashboard
  dashCcFilter = id;
  invalidateDashCache();
  refreshDashboard();

  // Navegar para a página de detalhe
  setActivePage('centro-custo-detail');
}

/* ── Dashboard: Filtro por Centro de Custo ── */
function initDashCcFilter() {
  const btn = document.getElementById('dashCcFilterBtn');
  const dropdown = document.getElementById('dashCcDropdown');
  if (!btn || !dropdown) return;

  // Popular dropdown
  populateDashCcFilter();

  // Toggle dropdown
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.filter-dropdown').forEach(d => { if (d !== dropdown) d.classList.remove('open'); });
    dropdown.classList.toggle('open');
  });

  // Seleção
  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.filter-dropdown-item');
    if (!item) return;
    e.stopPropagation();
    const val = item.dataset.cc || 'all';
    dashCcFilter = val;
    dropdown.classList.remove('open');

    const nome = val === 'all' ? 'Todos' : (centrosCustoData.find(cc => cc.id === val)?.nome || 'Todos');
    btn.innerHTML = `<i data-lucide="building-2"></i> ${escapeHtml(nome)} <i data-lucide="chevron-down"></i>`;

    const badge = document.getElementById('dashCcActiveBadge');
    const badgeLabel = document.getElementById('dashCcActiveLabel');
    if (val !== 'all' && badge && badgeLabel) {
      badge.hidden = false;
      badgeLabel.textContent = nome;
    } else if (badge) {
      badge.hidden = true;
    }
    initIcons();

    // Re-renderizar dashboard com filtro
    invalidateDashCache();
    refreshDashboard();
  });

  // Limpar filtro
  const clearBtn = document.getElementById('dashCcClearBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      dashCcFilter = 'all';
      btn.innerHTML = '<i data-lucide="building-2"></i> Centro de Custo <i data-lucide="chevron-down"></i>';
      document.getElementById('dashCcActiveBadge').hidden = true;
      initIcons();
      invalidateDashCache();
      refreshDashboard();
    });
  }

  // Fechar ao clicar fora
  document.addEventListener('click', () => dropdown.classList.remove('open'));
}

function populateDashCcFilter() {
  const dropdown = document.getElementById('dashCcDropdown');
  if (!dropdown) return;

  const isAdmin = isCurrentUserAdmin();
  const empresas = isAdmin
    ? centrosCustoData
    : (centrosCustoData || []).filter(cc => currentUser.centro_custo_ids?.includes(cc.id));

  let html = '<button class="filter-dropdown-item" data-cc="all">Todos</button>';

  empresas.forEach(cc => {
    html += `<button class="filter-dropdown-item" data-cc="${cc.id}">${escapeHtml(cc.nome)}</button>`;
  });

  dropdown.innerHTML = html;
}

/* ── Hook: filtrar leads por centro de custo no dashboard ── */
// O filtro é aplicado diretamente na função refreshDashboard (modificada abaixo)

/* ============================================
   BOOT
   ============================================ */
document.addEventListener('DOMContentLoaded', async () => {
  try {
  // Auth first - shows login screen or hides it
  bindAuthForms();
  await loadBranding();
  await initAuth();

  initTheme();
  initIcons();
  initInteractions();
  initCRM();
  renderCalendar();
  initDashboard();
  renderCalUpcoming();
  renderDashRemindersWidget();
  renderReunRespChips();
  initCalibragem();
  initNotifications();

  // Carregar serviços primeiro (necessário para mapear leads)
  try {
    await seedServicos();
    await fetchServicosSupabase();
  } catch (err) {
    console.error('[Boot] Erro ao carregar serviços:', err);
  }

  // Carregar leads do Supabase (Administrador vê todos, Atendente/Marketing veem apenas seus)
  try {
    const canViewAll = canViewAllData();
    const filterId = canViewAll ? null : getCurrentUserId();
    console.log('[Boot] Carregando leads, canViewAll:', canViewAll, 'filterId:', filterId, 'currentUser.id:', currentUser.id);
    const supabaseLeads = await fetchLeadsSupabase(filterId);
    if (supabaseLeads.length > 0) {
      leads = supabaseLeads;
      console.log('[Boot] Leads carregados do Supabase:', leads.length);
    } else {
      console.log('[Boot] Nenhum lead no Supabase, usando dados locais');
    }
  } catch (err) {
    console.error('[Boot] Erro ao carregar leads do Supabase:', err);
  }

  // Carregar eventos do Supabase
  try {
    const supabaseEvents = await fetchEventosSupabase();
    if (supabaseEvents.length > 0) {
      meetings = supabaseEvents;
      rebuildCalendarEvents();
      console.log('[Boot] Eventos carregados do Supabase:', meetings.length);
    } else {
      console.log('[Boot] Nenhum evento no Supabase, usando dados locais');
    }
  } catch (err) {
    console.error('[Boot] Erro ao carregar eventos do Supabase:', err);
  }

  // Re-renderizar calendário e próximos eventos após carregar dados do Supabase
  renderCalendar();
  renderCalUpcoming();
  renderDashRemindersWidget();

  // Carregar centros de custo do Supabase
  try {
    await loadCentrosCustoFromSupabase();
    console.log('[Boot] Centros de custo carregados:', centrosCustoData.length);
  } catch (err) {
    console.error('[Boot] Erro ao carregar centros de custo:', err);
  }

  // Carregar vínculos de serviços por empresa
  try {
    await loadVinculosServicos();
    console.log('[Boot] Vínculos de serviços carregados:', vinculosServicos.length);
  } catch (err) {
    console.error('[Boot] Erro ao carregar vínculos de serviços:', err);
  }

  // Carregar vínculos de cadências por empresa
  try {
    await loadVinculosCadencias();
    console.log('[Boot] Vínculos de cadências carregados:', vinculosCadencias.length);
  } catch (err) {
    console.error('[Boot] Erro ao carregar vínculos de cadências:', err);
  }

  // Carregar visibilidade de cadências por perfil
  try {
    _cadenciaVisibilityData = await fetchCadenciaVisibility();
    console.log('[Boot] Visibilidade de cadências carregada:', _cadenciaVisibilityData.length);
  } catch (err) {
    console.error('[Boot] Erro ao carregar visibilidade de cadências:', err);
  }

  // Inicializar filtro de empresa no CRM
  initCrmEmpresaFilter();

  // Inicializar filtro de empresa no Calendário
  initCalEmpresaFilter();

  // Carregar chips de serviços no modal
  try {
    await loadServiceChips();
    // Cal service chips are loaded dynamically when the modal opens (filtered by empresa)
    const calSvcContainer = document.getElementById('calEventServices');
    if (calSvcContainer) calSvcContainer.innerHTML = '<span style="font-size:11px;color:var(--muted-text);">Selecione uma empresa para ver os serviços</span>';
  } catch (err) {
    console.error('[Boot] Erro ao carregar chips de serviços:', err);
  }

  // Carregar rotinas do Supabase
  try {
    await loadRotinas();
  } catch (err) {
    console.error('[Boot] Erro ao carregar rotinas do Supabase:', err);
  }

  // Render inicial
  renderClients();
  renderAll();
  renderRotina();
  initPomodoro();
  initConversas();

  // Carregar clientes do Supabase para a página "Cliente da Base"
  try {
    const canViewAllClients = canViewAllData();
    const filterClientId = canViewAllClients ? null : getCurrentUserId();
    console.log('[Boot] Carregando clientes, canViewAll:', canViewAllClients, 'filterClientId:', filterClientId);
    const supabaseClients = await fetchClientsSupabase(filterClientId);
    if (supabaseClients.length > 0) {
      clientsData = supabaseClients;
      console.log('[Boot] Clientes carregados do Supabase:', clientsData.length);
    } else {
      console.log('[Boot] Nenhum cliente no Supabase');
    }
  } catch (err) {
    console.error('[Boot] Erro ao carregar clientes do Supabase:', err);
  }
  _clientsLoaded = true;

  populateServiceFilter();
  populateCadenceFilter();
  initCadenceFilter();
  populateEmpresaFilter();
  initEmpresaFilter();
  renderClients();
  setActivePage('home');

  // Auditoria: registrar login na inicialização da sessão
  if (typeof registrarAuditoria === 'function') {
    registrarAuditoria({
      acao: 'Logins',
      caminho_url: '/home',
      modulo: 'Sistema'
    });
  }

  // Charts inicializam quando o dashboard for aberto
  } catch (bootErr) {
    console.error('[Boot] ERRO FATAL:', bootErr);
    document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:red"><h2>Erro ao inicializar</h2><pre>' + (bootErr.message || bootErr) + '</pre></div>';
  }
});
