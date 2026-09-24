/* ============================================
   BLUE CONTABILIDADE · CRM
   Interatividade
   ============================================ */

const $ = (s, ctx = document) => ctx.querySelector(s);
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

  // Ensure no stale cache on fresh boot
  _userPermCache = null;

  const { data: { session } } = await _supabase.auth.getSession();
  if (session && session.user) {
    console.log('[Auth] initAuth: session found for user:', session.user.id);
    _authUser = session.user;
    currentUser.authUserId = session.user.id;

    const member = await loadMemberFromAuth(session.user.id, session.user.email);
    if (member) {
      currentUser.id = member.id;
      currentUser.nome = member.nome || session.user.email?.split('@')[0] || 'Usuário';
      currentUser.centro_custo_id = member.centro_custo_id || null;
      currentUser.centro_custo_ids = member._centro_custo_ids || [];
      currentUser.foto_url = member.foto_url || null;
      currentUser.perfil = member.cargo || 'Atendente';
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

    const newAuthUserId = session.user.id;

    // INITIAL_SESSION fires on every page load/refresh — always recalculate
    // permissions to avoid stale cache. Only skip re-init for SIGNED_IN when
    // the same user is already fully loaded.
    if (event === 'INITIAL_SESSION') {
      console.log('[Auth] INITIAL_SESSION — clearing permission cache and re-initializing');
      _userPermCache = null;
      _authUser = session.user;
      currentUser.authUserId = newAuthUserId;

      const member = await loadMemberFromAuth(session.user.id, session.user.email);
      if (member) {
        currentUser.id = member.id;
        currentUser.nome = member.nome || session.user.email?.split('@')[0] || 'Usuário';
        currentUser.centro_custo_id = member.centro_custo_id || null;
        currentUser.centro_custo_ids = member._centro_custo_ids || [];
        currentUser.foto_url = member.foto_url || null;
        currentUser.perfil = member.cargo || 'Atendente';
      } else if (!currentUser.id) {
        currentUser.nome = session.user.user_metadata?.nome || session.user.email?.split('@')[0] || 'Usuário';
        console.warn('[Auth] loadMemberFromAuth failed in INITIAL_SESSION, loadUserPermissions will attempt resolution');
      }

      hideAuthOverlay();
      await onAuthReady();
      return;
    }

    // SIGNED_IN: only re-initialize if user actually changed
    if (currentUser.authUserId === newAuthUserId && currentUser.id && _userPermCache) {
      console.log('[Auth] SIGNED_IN same user, permissions already loaded, skipping re-init');
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
      currentUser.perfil = member.cargo || 'Atendente';
    } else if (!currentUser.id) {
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

  // Refresh empresa filter after permissions are loaded (if centros de custo already loaded)
  if (centrosCustoData && centrosCustoData.length > 0) {
    populateEmpresaFilter();
    initCrmEmpresaFilter();
  }
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
      if (target === 'cadencias') {
        loadCadenciasAdmin();
        loadCadenciaVisibilityAdmin();
      }
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
      let adminDebounce;
      searchInput.addEventListener('input', () => {
        clearTimeout(adminDebounce);
        adminDebounce = setTimeout(() => {
          const q = searchInput.value.toLowerCase().trim();
          document.querySelectorAll('#adminUsersBody tr').forEach(row => {
            row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
          });
        }, 150);
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          clearTimeout(adminDebounce);
          const q = searchInput.value.toLowerCase().trim();
          document.querySelectorAll('#adminUsersBody tr').forEach(row => {
            row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
          });
        }
      });
    }

    // ── Modal de exclusão ──
    delCloseBtns.forEach(btn => btn.addEventListener('click', closeDeleteModal));
    if (delOverlay) delOverlay.addEventListener('click', closeDeleteModal);
    if (delConfirmBtn) delConfirmBtn.addEventListener('click', handleMemberDelete);

    // ── Busca permissões (antiga - agora usa matriz) ──
    const permSearch = document.getElementById('adminPermSearchInput');
    if (permSearch) {
      let permDebounce;
      permSearch.addEventListener('input', () => {
        clearTimeout(permDebounce);
        permDebounce = setTimeout(() => {
          const q = permSearch.value.toLowerCase().trim();
          document.querySelectorAll('#adminPermMatrixBody tr').forEach(row => {
            row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
          });
        }, 150);
      });
    }

    // ── Botão Salvar Permissões Globais ──
    const permSaveGlobalBtn = document.getElementById('adminPermSaveGlobal');
    if (permSaveGlobalBtn) permSaveGlobalBtn.addEventListener('click', handlePermMatrixSave);

    // ── Auto-fill perfil checkboxes ──
    const perfilSel = document.getElementById('adminPermPerfil');
    if (perfilSel) {
      perfilSel.addEventListener('change', () => applyPerfilDefaults(perfilSel.value));
    }
  }

  initCadenciaManagement();
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
  const ids = ['adminMemberId', 'adminMemberName', 'adminMemberEmail', 'adminMemberPassword', 'adminMemberCPF', 'adminMemberBirth', 'adminMemberPhone'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const selects = ['adminMemberRole', 'adminMemberTeam'];
  selects.forEach(id => { const el = document.getElementById(id); if (el) el.selectedIndex = 0; });
  document.getElementById('adminMemberPessoa').value = 'Pessoa Física';
  ['adminMemberNotifEmail', 'adminMemberNotifWhats', 'adminMemberNotifSound'].forEach(id => {
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
/* ── Permissões CRUD Granulares - Keys ─── */
const PERM_CRUD_KEYS = [
  // Contratos
  'can_contratos_create', 'can_contratos_read', 'can_contratos_update', 'can_contratos_delete',
  'can_contratos_assinado_upload', 'can_contratos_cancelar',
  // Leads
  'can_leads_create', 'can_leads_read', 'can_leads_update', 'can_leads_delete',
  'can_leads_export', 'can_leads_import', 'can_leads_add_phone', 'can_leads_transferir',
  // Conversas
  'can_conversas_create', 'can_conversas_read', 'can_conversas_update', 'can_conversas_delete',
  'can_conversas_transferir', 'can_conversas_delete_msg', 'can_conversas_sync_lead',
  // Calendário
  'can_calendario_create', 'can_calendario_read', 'can_calendario_update', 'can_calendario_delete',
  // Rotina
  'can_rotina_create', 'can_rotina_read', 'can_rotina_update', 'can_rotina_delete',
  // Config
  'can_config_read', 'can_config_update', 'can_config_whatsapp', 'can_config_integracao',
  // Auditoria
  'can_auditoria_read', 'can_auditoria_export',
  // Admin
  'can_admin_create_user', 'can_admin_read_user', 'can_admin_update_user', 'can_admin_delete_user',
  'can_admin_manage_perms', 'can_admin_manage_cc',
  // Sensível
  'can_delete_cliente_telefone'
];

/* ── Perfil defaults globais (expandido com CRUD) ── */
const PERFIL_DEFAULTS = {
  'Administrador': {
    home: true, dashboard: true, crm: true, contratos: true, cliente_base: true, calendario: true,
    rotina_blue: true, pomodoro: true, conversas: true, configuracoes: true,
    auditoria: true, administrador: true,
    calibragem: true,
    delete_telefone: true,
    ...Object.fromEntries(PERM_CRUD_KEYS.map(k => [k, true]))
  },
  'Atendente': {
    home: false, dashboard: false, crm: true, contratos: false, cliente_base: true, calendario: true,
    rotina_blue: true, pomodoro: true, conversas: true, configuracoes: false,
    auditoria: false, administrador: false,
    calibragem: false,
    delete_telefone: false,
    can_contratos_create: true, can_contratos_read: true, can_contratos_update: true,
    can_contratos_assinado_upload: true,
    can_leads_create: true, can_leads_read: true, can_leads_update: true,
    can_leads_add_phone: true,
    can_conversas_create: true, can_conversas_read: true, can_conversas_update: true,
    can_conversas_transferir: true, can_conversas_sync_lead: true,
    can_calendario_create: true, can_calendario_read: true, can_calendario_update: true,
    can_rotina_create: true, can_rotina_read: true, can_rotina_update: true,
    can_config_read: true,
    can_auditoria_read: true,
  },
  'Marketing': {
    home: true, dashboard: true, crm: true, contratos: false, cliente_base: true, calendario: true,
    rotina_blue: false, pomodoro: false, conversas: false, configuracoes: true,
    auditoria: true, administrador: false,
    calibragem: false,
    delete_telefone: true,
    can_leads_read: true, can_leads_export: true,
    can_contratos_read: true,
    can_conversas_read: true,
    can_config_read: true,
  },
  'Pre Vendas': {
    home: true, dashboard: true, crm: true, cliente_base: true,
    conversas: true,
    can_leads_create: true, can_leads_read: true, can_leads_update: true,
    can_conversas_create: true, can_conversas_read: true, can_conversas_sync_lead: true,
  },
  'Membro': {
    home: true, dashboard: true,
    can_leads_read: true,
  }
};

/* ── Perfil defaults (expandido com CRUD) ── */
function applyPerfilDefaults(perfil) {
  const allModules = [
    'permHome', 'permDashboard', 'permCrm', 'permContratos', 'permClienteBase', 'permCalendario',
    'permRotinaBlue', 'permPomodoro', 'permConversas', 'permConfiguracoes',
    'permAuditoria', 'permAdministrador', 'permObrigacoes', 'permDocumentos', 'permSuporte'
  ];
  const p = PERFIL_DEFAULTS[perfil] || PERFIL_DEFAULTS['Atendente'];
  
  // Sidebar modules (colunas booleanas)
  document.getElementById('permHome').checked = p.home;
  document.getElementById('permDashboard').checked = p.dashboard;
  document.getElementById('permCrm').checked = p.crm;
  document.getElementById('permContratos').checked = p.contratos;
  document.getElementById('permClienteBase').checked = p.cliente_base;
  document.getElementById('permCalendario').checked = p.calendario;
  document.getElementById('permRotinaBlue').checked = p.rotina_blue;
  document.getElementById('permPomodoro').checked = p.pomodoro;
  document.getElementById('permConversas').checked = p.conversas;
  document.getElementById('permConfiguracoes').checked = p.configuracoes;
  document.getElementById('permAuditoria').checked = p.auditoria;
  document.getElementById('permAdministrador').checked = p.administrador;
  document.getElementById('permObrigacoes').checked = p.obrigacoes || false;
  document.getElementById('permDocumentos').checked = p.documentos || false;
  document.getElementById('permSuporte').checked = p.suporte || false;
  document.getElementById('permDeleteTelefone').checked = p.delete_telefone;
  document.getElementById('permCalibragem').checked = !!p.calibragem;
  
  // CRUD granular (JSONB)
  PERM_CRUD_KEYS.forEach(k => {
    if (p[k] !== undefined) {
      const el = document.querySelector(`[data-perm="${k}"]`);
      if (el) el.checked = p[k];
    }
  });
}

/* ── Helper global para checar permissão CRUD ─── */
function can(permKey) {
  const cache = _userPermCache;
  if (!cache) return true; // fallback permissivo se cache não carregado
  // Colunas booleanas (sidebar/modules)
  if (cache[permKey] === true) return true;
  // JSONB granular (CRUD)
  return cache.permissions?.[permKey] === true;
}

/* ── Carregar permissões do Supabase e renderizar MATRIZ ── */
async function loadPermissionsFromSupabase() {
  if (!_supabase) return;

  if (_adminMembersCache.length === 0) {
    const { data } = await _supabase.from('membros').select('*').order('created_at', { ascending: false });
    _adminMembersCache = data || [];
  }

  // 1. Buscar permissões globais por perfil (nova tabela perfis_permissoes)
  let profilePermsFromDB = {};
  try {
    const { data, error } = await _supabase.from('perfis_permissoes').select('perfil, permissions');
    if (!error && data) {
      data.forEach(row => {
        const norm = (row.perfil || '').toLowerCase().replace(' ', '_');
        profilePermsFromDB[norm] = row.permissions || {};
      });
    }
  } catch (err) {
    console.warn('[Admin] Tabela perfis_permissoes não encontrada, usando fallback local:', err.message);
  }

  // 2. Buscar permissões individuais dos membros (membros_permissoes)
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

  // 3. Renderizar MATRIZ usando dados do banco (perfis_permissoes) com fallback para PERFIL_DEFAULTS
  renderPermMatrix(permMap, profilePermsFromDB);
}

const PERM_MATRIX_ROWS = [
  { group: 'Contratos', perms: [
    { key: 'can_contratos_create', label: 'Criar Contrato' },
    { key: 'can_contratos_read', label: 'Visualizar Contratos' },
    { key: 'can_contratos_update', label: 'Editar Contrato' },
    { key: 'can_contratos_delete', label: 'Apagar Contrato' },
    { key: 'can_contratos_assinado_upload', label: 'Upload Assinado' },
    { key: 'can_contratos_cancelar', label: 'Cancelar Contrato' },
  ]},
  { group: 'Leads / Clientes', perms: [
    { key: 'can_leads_create', label: 'Criar Lead' },
    { key: 'can_leads_read', label: 'Visualizar Leads' },
    { key: 'can_leads_update', label: 'Editar Lead' },
    { key: 'can_leads_delete', label: 'Apagar Lead' },
    { key: 'can_leads_export', label: 'Exportar Base' },
    { key: 'can_leads_import', label: 'Importar Leads' },
    { key: 'can_leads_add_phone', label: 'Adicionar Número' },
    { key: 'can_leads_transferir', label: 'Transferir Lead' },
  ]},
  { group: 'Conversas', perms: [
    { key: 'can_conversas_create', label: 'Nova Conversa' },
    { key: 'can_conversas_read', label: 'Visualizar Conversas' },
    { key: 'can_conversas_update', label: 'Editar Conversa' },
    { key: 'can_conversas_delete', label: 'Arquivar/Apagar' },
    { key: 'can_conversas_transferir', label: 'Transferir Conversa' },
    { key: 'can_conversas_delete_msg', label: 'Apagar Mensagem' },
    { key: 'can_conversas_sync_lead', label: 'Sincronizar como Lead' },
  ]},
  { group: 'Calendário', perms: [
    { key: 'can_calendario_create', label: 'Criar Evento' },
    { key: 'can_calendario_read', label: 'Visualizar Calendário' },
    { key: 'can_calendario_update', label: 'Editar Evento' },
    { key: 'can_calendario_delete', label: 'Apagar Evento' },
  ]},
  { group: 'Rotina Blue', perms: [
    { key: 'can_rotina_create', label: 'Criar Tarefa' },
    { key: 'can_rotina_read', label: 'Visualizar Rotina' },
    { key: 'can_rotina_update', label: 'Editar Tarefa' },
    { key: 'can_rotina_delete', label: 'Apagar Tarefa' },
  ]},
  { group: 'Configurações', perms: [
    { key: 'can_config_read', label: 'Visualizar Configurações' },
    { key: 'can_config_update', label: 'Editar Configurações' },
    { key: 'can_config_whatsapp', label: 'Gerenciar WhatsApp' },
    { key: 'can_config_integracao', label: 'Gerenciar Integrações' },
  ]},
  { group: 'Auditoria', perms: [
    { key: 'can_auditoria_read', label: 'Ver Auditoria' },
    { key: 'can_auditoria_export', label: 'Exportar Auditoria' },
  ]},
  { group: 'Administração', perms: [
    { key: 'can_admin_create_user', label: 'Criar Usuário' },
    { key: 'can_admin_read_user', label: 'Listar Usuários' },
    { key: 'can_admin_update_user', label: 'Editar Usuário' },
    { key: 'can_admin_delete_user', label: 'Apagar Usuário' },
    { key: 'can_admin_manage_perms', label: 'Gerenciar Permissões' },
    { key: 'can_admin_manage_cc', label: 'Gerenciar Centros de Custo' },
  ]},
  { group: 'Dados Sensíveis', perms: [
    { key: 'can_delete_cliente_telefone', label: 'Apagar Telefone do Cliente' },
  ]},
];

const PERM_MATRIX_COLS = [
  { key: 'administrador', label: 'Administrador' },
  { key: 'atendente', label: 'Atendente' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'pre_vendas', label: 'Pré Vendas' },
  { key: 'membro', label: 'Membro' },
];

function renderPermMatrix(permMap, profilePermsFromDB = {}) {
  const tbody = document.getElementById('adminPermMatrixBody');
  if (!tbody) return;

  const profilePerms = getProfilePermissions(permMap, profilePermsFromDB);

  let html = '';
  PERM_MATRIX_ROWS.forEach(({ group, perms }) => {
    html += `<tr class="perm-group-header"><td colspan="7" class="perm-group-label">${group}</td></tr>`;
    perms.forEach(({ key, label }) => {
      html += `<tr data-perm-key="${key}">`;
      html += `<td class="perm-name">${escapeHtml(label)}</td>`;
      PERM_MATRIX_COLS.forEach(col => {
        const checked = profilePerms[col.key]?.[key] === true;
        html += `<td style="text-align:center"><input type="checkbox" class="perm-matrix-check" data-perm="${key}" data-profile="${col.key}"${checked ? ' checked' : ''}></td>`;
      });
      html += `</tr>`;
    });
  });
  tbody.innerHTML = html;
  initIcons();
}

function getProfilePermissions(permMap, profilePermsFromDB = {}) {
  const profilePerms = {};
  Object.keys(PERFIL_DEFAULTS).forEach(perfil => {
    const norm = perfil.toLowerCase().replace(' ', '_');
    // Usa dados do banco (perfis_permissoes) como base, fallback para PERFIL_DEFAULTS
    profilePerms[norm] = { ...PERFIL_DEFAULTS[perfil], ...(profilePermsFromDB[norm] || {}) };
  });
  // Merge com permissões individuais dos membros (membros_permissoes)
  const seenProfiles = new Set();
  Object.values(permMap).forEach(p => {
    const perfilNorm = (p.perfil || '').toLowerCase().replace(' ', '_');
    if (!seenProfiles.has(perfilNorm)) {
      seenProfiles.add(perfilNorm);
      const merged = { ...p };
      if (p.permissions) Object.assign(merged, p.permissions);
      profilePerms[perfilNorm] = { ...profilePerms[perfilNorm], ...merged };
    }
  });
  return profilePerms;
}

async function handlePermMatrixSave() {
  const saveBtn = document.getElementById('adminPermSaveGlobal');
  if (!saveBtn) return;
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="auth-spinner"></span>';

  try {
    const updates = {};
    document.querySelectorAll('#adminPermMatrixBody .perm-matrix-check').forEach(cb => {
      const permKey = cb.dataset.perm;
      const profileKey = cb.dataset.profile;
      if (!updates[profileKey]) updates[profileKey] = {};
      updates[profileKey][permKey] = cb.checked;
    });

    // 1. Atualiza PERFIL_DEFAULTS em memória (para uso imediato)
    Object.entries(updates).forEach(([profileKey, perms]) => {
      const perfilMap = { administrador: 'Administrador', atendente: 'Atendente', marketing: 'Marketing', pre_vendas: 'Pre Vendas', membro: 'Membro' };
      const perfilName = perfilMap[profileKey];
      if (perfilName && PERFIL_DEFAULTS[perfilName]) {
        Object.assign(PERFIL_DEFAULTS[perfilName], perms);
      }
    });

    // 2. Salva na tabela perfis_permissoes (configurações globais por cargo)
    const perfilMap = { administrador: 'Administrador', atendente: 'Atendente', marketing: 'Marketing', pre_vendas: 'Pre Vendas', membro: 'Membro' };
    for (const [profileKey, perms] of Object.entries(updates)) {
      const perfilName = perfilMap[profileKey];
      if (!perfilName) continue;

      const { error } = await _supabase
        .from('perfis_permissoes')
        .upsert({
          perfil: perfilName,
          permissions: perms
          // updated_at é gerenciado pelo trigger
        }, { onConflict: 'perfil' });

      if (error) {
        console.error('[Admin] Erro ao salvar perfis_permissoes', perfilName, error);
        throw new Error(`perfis_permissoes: ${error.message}`);
      }
    }

    // 3. Propaga para membros_permissoes (cada membro herda do seu cargo)
    for (const member of _adminMembersCache) {
      const perfilNorm = (member.cargo || '').toLowerCase().replace(' ', '_');
      const perfilMap = { administrador: 'Administrador', atendente: 'Atendente', marketing: 'Marketing', pre_vendas: 'Pre Vendas', membro: 'Membro' };
      const perfilName = perfilMap[perfilNorm];
      if (!perfilName) continue;

      // Merge: PERFIL_DEFAULTS (already updated by matrix save) + CRUD from matrix
      const profileDefaults = PERFIL_DEFAULTS[perfilName] || {};
      const crudOverrides = updates[perfilNorm] || {};

      const existingPerm = _adminPermCache.find(p => p.membro_id === member.id);

      // Sidebar booleans: read from PERFIL_DEFAULTS (which has the correct profile values)
      const sidebarData = {};
      _sidebarPermKeys.forEach(k => {
        // Map can_xxx → profile key xxx
        const profileKey = k === 'can_delete_cliente_telefone' ? 'delete_telefone' : k.replace('can_', '');
        sidebarData[k] = profileDefaults[profileKey] === true;
      });

      // CRUD granular: use matrix checkbox values, fallback to profile defaults
      const crudData = {};
      PERM_CRUD_KEYS.forEach(k => {
        if (crudOverrides[k] !== undefined) {
          crudData[k] = crudOverrides[k] === true;
        } else {
          crudData[k] = profileDefaults[k] === true;
        }
      });

      const payload = {
        ...sidebarData,
        can_delete_cliente_telefone: profileDefaults.delete_telefone === true,
        permissions: crudData,
        updated_at: new Date().toISOString()
      };

      if (existingPerm) {
        const { error: memberError } = await _supabase
          .from('membros_permissoes')
          .update(payload)
          .eq('id', existingPerm.id);
        if (memberError) {
          console.error('[Admin] Erro ao atualizar membro_permissoes', member.id, memberError);
          throw new Error(`membros_permissoes: ${memberError.message}`);
        }
      } else {
        // Create membros_permissoes record for member that doesn't have one yet
        const insertPayload = {
          membro_id: member.id,
          perfil: perfilName,
          ...payload
        };
        const { error: insertError } = await _supabase
          .from('membros_permissoes')
          .insert(insertPayload);
        if (insertError) {
          console.error('[Admin] Erro ao criar membros_permissoes para membro', member.id, insertError);
        }
      }
    }

    toast('Permissões globais salvas com sucesso!', 'success');
    if (typeof registrarAuditoria === 'function') registrarAuditoria({ acao: 'Atualizações', caminho_url: '/administrador', modulo: 'Administrador' });

  } catch (err) {
    console.error('[Admin] Erro ao salvar matriz de permissões:', err);
    const msg = err.message || '';
    if (msg.includes('row-level security') || msg.includes('violates row-level security') || msg.includes('permission denied')) {
      toast('Não foi possível salvar as permissões. Verifique se você possui acesso de administrador.', 'error');
    } else if (msg.includes('perfis_permissoes')) {
      toast('Erro ao salvar permissões do perfil: ' + msg, 'error');
    } else if (msg.includes('membros_permissoes')) {
      toast('Erro ao atualizar permissões do membro: ' + msg, 'error');
    } else {
      toast('Erro ao salvar permissões: ' + msg, 'error');
    }
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i data-lucide="save"></i> Salvar Permissões Globais';
    initIcons();
  }
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
      const found = getCadenciaById(cid);
      return found ? found.nome : cid;
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
    getDbCadencias().forEach(c => {
      const checked = linkedCadencias.includes(c.id);
      const label = document.createElement('label');
      label.className = 'perm-check';
      label.innerHTML = `<input type="checkbox" class="empresa-cadencia-cb" value="${c.id}" ${checked ? 'checked' : ''} /> ${escapeHtml(c.nome)}`;
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

  // Build cadence list from database cadencias
  const dbCadencias = getDbCadencias();
  const allCadences = dbCadencias.map(c => ({
    uuid: c.id,
    label: c.nome,
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
      console.warn('[CadVis] Cadência sem UUID:', cad.label);
    }
    const tr = document.createElement('tr');
    const checksHtml = CADENCIA_VIS_PERFIS.map(perfil => {
      // Default to visible (checked) unless explicitly set to false
      const checked = perfil === 'Administrador' || cad.visMap[perfil] !== false;
      const disabled = perfil === 'Administrador';
      return `<td style="text-align:center">
        <input type="checkbox" class="cad-vis-check" data-cadencia-uuid="${cad.uuid || ''}" data-perfil="${perfil}" ${checked ? 'checked' : ''} ${disabled ? 'disabled title="Administrador sempre vê todas"' : ''} ${!cad.uuid ? 'disabled title="Cadência não encontrada no banco"' : ''} />
      </td>`;
    }).join('');
    tr.innerHTML = `<td><strong>${escapeHtml(cad.label)}</strong></td>${checksHtml}`;
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
   ADMIN · CADÊNCIAS MANAGEMENT (CRUD + Drag-Drop)
   ============================================ */
let _cadenciasCache = [];
let _cadenciaEditingId = null;
let _cadenciaDeleteId = null;
let _cadenciaBound = false;

async function loadCadenciasAdmin() {
  console.log('[Admin] loadCadenciasAdmin called');
  if (!_supabase) return;
  
  const list = document.getElementById('cadenciaList');
  if (!list) return;
  
  list.innerHTML = '<div class="cadencia-empty"><i data-lucide="loader"></i><p>Carregando...</p></div>';
  initIcons();

  try {
    const { data, error } = await _supabase
      .from('cadencias')
      .select('id, nome, cor, ordem, created_at')
      .order('ordem', { ascending: true });
    
    if (error) {
      console.error('[Admin] Erro ao buscar cadências:', error.message, error.code);
      list.innerHTML = `<div class="cadencia-empty"><i data-lucide="alert-triangle"></i><p>Erro ao carregar: ${escapeHtml(error.message)}</p></div>`;
      return;
    }

    _cadenciasCache = data || [];
    renderCadenciasList(_cadenciasCache);
    initCadenciaDragDrop();
    initIcons();
  } catch (err) {
    console.error('[Admin] Erro ao carregar cadências:', err);
    list.innerHTML = '<div class="cadencia-empty"><i data-lucide="alert-triangle"></i><p>Erro ao carregar cadências</p></div>';
  }
}

function renderCadenciasList(cadencias) {
  const list = document.getElementById('cadenciaList');
  if (!list) return;

  if (cadencias.length === 0) {
    list.innerHTML = '<div class="cadencia-empty"><i data-lucide="columns-3"></i><p>Nenhuma cadência cadastrada</p></div>';
    return;
  }

  list.innerHTML = cadencias.map((c, index) => `
    <div class="cadencia-item" data-cadencia-id="${escapeHtml(c.id)}" draggable="true" data-ordem="${c.ordem}">
      <button class="cadencia-drag-handle" title="Arraste para reordenar" aria-label="Arraste para reordenar">
        <i data-lucide="grip-vertical"></i>
      </button>
      <span class="cadencia-color-dot" style="background:${escapeHtml(c.cor || '#3B82F6')}"></span>
      <span class="cadencia-name">${escapeHtml(c.nome)}</span>
      <span class="cadencia-ordem">${c.ordem}</span>
      <div class="cadencia-actions">
        <button class="cadencia-action-btn edit" data-action="edit-cadencia" data-cadencia-id="${escapeHtml(c.id)}" title="Editar">
          <i data-lucide="pencil"></i>
        </button>
        <button class="cadencia-action-btn delete" data-action="delete-cadencia" data-cadencia-id="${escapeHtml(c.id)}" title="Excluir">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </div>
  `).join('');
}

function initCadenciaDragDrop() {
  const list = document.getElementById('cadenciaList');
  if (!list) return;

  let draggedItem = null;

  list.querySelectorAll('.cadencia-item').forEach(item => {
    item.addEventListener('dragstart', handleCadenciaDragStart);
    item.addEventListener('dragend', handleCadenciaDragEnd);
    item.addEventListener('dragover', handleCadenciaDragOver);
    item.addEventListener('dragleave', handleCadenciaDragLeave);
    item.addEventListener('drop', handleCadenciaDrop);
  });

  function handleCadenciaDragStart(e) {
    draggedItem = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.cadenciaId);
  }

  function handleCadenciaDragEnd(e) {
    this.classList.remove('dragging');
    list.querySelectorAll('.cadencia-item').forEach(item => {
      item.classList.remove('drag-over');
    });
    draggedItem = null;
  }

  function handleCadenciaDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (this !== draggedItem) {
      this.classList.add('drag-over');
    }
  }

  function handleCadenciaDragLeave(e) {
    if (!this.contains(e.relatedTarget)) {
      this.classList.remove('drag-over');
    }
  }

  async function handleCadenciaDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over');
    
    if (!draggedItem || this === draggedItem) return;

    const draggedId = draggedItem.dataset.cadenciaId;
    const targetId = this.dataset.cadenciaId;
    
    const draggedIndex = _cadenciasCache.findIndex(c => c.id === draggedId);
    const targetIndex = _cadenciasCache.findIndex(c => c.id === targetId);
    
    if (draggedIndex === -1 || targetIndex === -1) return;

    // Reorder in cache
    const [removed] = _cadenciasCache.splice(draggedIndex, 1);
    _cadenciasCache.splice(targetIndex, 0, removed);

    // Update ordem values
    _cadenciasCache.forEach((c, i) => {
      c.ordem = i + 1;
    });

    // Re-render list
    renderCadenciasList(_cadenciasCache);
    initCadenciaDragDrop();
    initIcons();

    // Persist to Supabase
    await persistCadenciasOrdem();
  }
}

async function persistCadenciasOrdem() {
  if (!_supabase) return;
  
  try {
    // Batch update all cadencias with new ordem
    const updates = _cadenciasCache.map(c => 
      _supabase.from('cadencias').update({ ordem: c.ordem }).eq('id', c.id)
    );
    
    const results = await Promise.all(updates);
    
    for (const result of results) {
      if (result.error) {
        console.error('[Admin] Erro ao atualizar ordem:', result.error.message);
        toast('Erro ao salvar ordem', 'error');
        return;
      }
    }
    
    console.log('[Admin] Ordem das cadências atualizada com sucesso');
    toast('Ordem salva com sucesso!');
    
    // Refresh CRM kanban if on CRM page
    if (activePage === 'crm' && typeof renderAll === 'function') {
      await rebuildCadenciaMaps();
      await renderAll();
    }
  } catch (err) {
    console.error('[Admin] Erro ao persistir ordem:', err);
    toast('Erro ao salvar ordem', 'error');
  }
}

function initCadenciaManagement() {
  if (_cadenciaBound) return;
  _cadenciaBound = true;

  const container = document.getElementById('page-administrador');
  if (!container) return;

  container.addEventListener('click', async (e) => {
    // New cadencia button
    if (e.target.closest('#cadenciaNewBtn')) {
      _cadenciaEditingId = null;
      resetCadenciaForm();
      setCadenciaFormMode('create');
      openCadenciaModal();
      return;
    }

    // Edit button
    if (e.target.closest('[data-action="edit-cadencia"]')) {
      const btn = e.target.closest('[data-action="edit-cadencia"]');
      const cadenciaId = btn.dataset.cadenciaId;
      await openCadenciaModalForEdit(cadenciaId);
      return;
    }

    // Delete button
    if (e.target.closest('[data-action="delete-cadencia"]')) {
      const btn = e.target.closest('[data-action="delete-cadencia"]');
      const cadenciaId = btn.dataset.cadenciaId;
      const cadencia = _cadenciasCache.find(c => c.id === cadenciaId);
      if (cadencia) {
        _cadenciaDeleteId = cadenciaId;
        const text = document.getElementById('cadenciaDeleteText');
        if (text) text.textContent = `Tem certeza que deseja remover a cadência "${cadencia.nome}"? Essa ação não poderá ser desfeita.`;
        openCadenciaDeleteModal();
      }
      return;
    }

    // Close modals
    if (e.target.closest('[data-action="close-cadencia-modal"]') || e.target.closest('#cadenciaModalOverlay')) {
      closeCadenciaModal();
      return;
    }
    if (e.target.closest('[data-action="close-cadencia-delete"]') || e.target.closest('#cadenciaDeleteOverlay')) {
      closeCadenciaDeleteModal();
      return;
    }

    // Save cadencia
    if (e.target.closest('#cadenciaSaveBtn')) {
      await handleCadenciaSave();
      return;
    }

    // Confirm delete
    if (e.target.closest('#cadenciaDeleteConfirmBtn')) {
      await handleCadenciaDelete();
      return;
    }
  });

  // Color picker
  const colorPicker = document.getElementById('cadenciaColorPicker');
  if (colorPicker) {
    colorPicker.addEventListener('click', (e) => {
      const swatch = e.target.closest('.color-swatch');
      if (!swatch) return;
      
      colorPicker.querySelectorAll('.color-swatch').forEach(s => {
        s.setAttribute('aria-checked', 'false');
      });
      swatch.setAttribute('aria-checked', 'true');
      document.getElementById('cadenciaCorInput').value = swatch.dataset.color;
    });
  }
}

function resetCadenciaForm() {
  document.getElementById('cadenciaId').value = '';
  document.getElementById('cadenciaNomeInput').value = '';
  document.getElementById('cadenciaCorInput').value = '#3B82F6';
  
  const colorPicker = document.getElementById('cadenciaColorPicker');
  if (colorPicker) {
    colorPicker.querySelectorAll('.color-swatch').forEach((s, i) => {
      s.setAttribute('aria-checked', i === 0 ? 'true' : 'false');
    });
  }

  // Reset visibility checkboxes - default all checked except Administrador (always visible)
  renderCadenciaVisibilityChecks();
}

/**
 * Renderiza os checkboxes de visibilidade por perfil no modal de cadência
 * @param {Object} existingVis - Mapa de visibilidade existente { perfil: boolean }
 */
function renderCadenciaVisibilityChecks(existingVis = {}) {
  const container = document.getElementById('cadenciaVisibilidadeChecks');
  if (!container) return;

  const perfis = CADENCIA_VIS_PERFIS || ['Administrador', 'Membro', 'Pré Vendas', 'Atendente'];
  
  container.innerHTML = perfis.map(perfil => {
    // Administrador sempre vê tudo (checkbox desabilitado e marcado)
    const isAdmin = perfil === 'Administrador';
    const checked = isAdmin || existingVis[perfil] !== false; // default true para não-admin
    const disabled = isAdmin;
    
    return `
      <label class="perm-check" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--surface-bg);border-radius:var(--radius);border:1px solid var(--gray-200);cursor:${disabled ? 'not-allowed' : 'pointer'}">
        <input type="checkbox" class="cad-vis-check" data-perfil="${perfil}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
        <span style="${disabled ? 'color:var(--muted-text)' : ''}">${perfil}</span>
      </label>
    `;
  }).join('');
}

function setCadenciaFormMode(mode) {
  const title = document.getElementById('cadenciaModalTitle');
  const subtitle = document.getElementById('cadenciaModalSubtitle');
  const saveText = document.getElementById('cadenciaSaveBtnText');
  
  if (mode === 'edit') {
    if (title) title.textContent = 'Editar Cadência';
    if (subtitle) subtitle.textContent = 'Altere os dados da etapa do funil';
    if (saveText) saveText.textContent = 'Salvar Alterações';
  } else {
    if (title) title.textContent = 'Nova Cadência';
    if (subtitle) subtitle.textContent = 'Cadastre uma nova etapa do funil';
    if (saveText) saveText.textContent = 'Salvar Cadência';
  }
}

async function openCadenciaModalForEdit(cadenciaId) {
  const cadencia = _cadenciasCache.find(c => c.id === cadenciaId);
  if (!cadencia) return;

  _cadenciaEditingId = cadenciaId;
  document.getElementById('cadenciaId').value = cadenciaId;
  document.getElementById('cadenciaNomeInput').value = cadencia.nome;
  document.getElementById('cadenciaCorInput').value = cadencia.cor || '#3B82F6';

  const colorPicker = document.getElementById('cadenciaColorPicker');
  if (colorPicker) {
    colorPicker.querySelectorAll('.color-swatch').forEach(s => {
      s.setAttribute('aria-checked', s.dataset.color === cadencia.cor ? 'true' : 'false');
    });
  }

  // Load existing visibility settings for this cadencia
  const visData = _cadenciaVisibilityData.filter(v => v.cadencia_id === cadenciaId);
  const visMap = {};
  visData.forEach(v => { visMap[v.perfil] = v.visible; });
  renderCadenciaVisibilityChecks(visMap);

  setCadenciaFormMode('edit');
  openCadenciaModal();
}

function openCadenciaModal() {
  const overlay = document.getElementById('cadenciaModalOverlay');
  const modal = document.getElementById('cadenciaModal');
  if (overlay) overlay.classList.add('open');
  if (modal) { modal.classList.add('open'); modal.scrollTop = 0; }
  initIcons();
}

function closeCadenciaModal() {
  const overlay = document.getElementById('cadenciaModalOverlay');
  const modal = document.getElementById('cadenciaModal');
  if (overlay) overlay.classList.remove('open');
  if (modal) modal.classList.remove('open');
  _cadenciaEditingId = null;
}

function openCadenciaDeleteModal() {
  const overlay = document.getElementById('cadenciaDeleteOverlay');
  const modal = document.getElementById('cadenciaDeleteModal');
  if (overlay) overlay.classList.add('open');
  if (modal) modal.classList.add('open');
  initIcons();
}

function closeCadenciaDeleteModal() {
  const overlay = document.getElementById('cadenciaDeleteOverlay');
  const modal = document.getElementById('cadenciaDeleteModal');
  if (overlay) overlay.classList.remove('open');
  if (modal) modal.classList.remove('open');
  _cadenciaDeleteId = null;
}

async function handleCadenciaSave() {
  const nome = document.getElementById('cadenciaNomeInput')?.value?.trim();
  const cor = document.getElementById('cadenciaCorInput')?.value;

  if (!nome) {
    toast('Preencha o nome da cadência', 'error');
    return;
  }

  // Collect visibility settings from checkboxes
  const visChecks = document.querySelectorAll('#cadenciaVisibilidadeChecks .cad-vis-check');
  const visibilitySettings = [];
  visChecks.forEach(cb => {
    const perfil = cb.dataset.perfil;
    const visible = cb.checked;
    visibilitySettings.push({ perfil, visible });
  });

  const saveBtn = document.getElementById('cadenciaSaveBtn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="auth-spinner"></span>';

  try {
    let cadenciaId = _cadenciaEditingId;
    let isNew = false;

    if (cadenciaId) {
      // EDIT
      console.log('[Admin] Editando cadência:', cadenciaId);
      const { error } = await _supabase
        .from('cadencias')
        .update({ nome, cor })
        .eq('id', cadenciaId);
      
      if (error) throw error;
      toast('Cadência atualizada com sucesso!');
    } else {
      // CREATE - get next ordem
      const maxOrdem = _cadenciasCache.length > 0 
        ? Math.max(..._cadenciasCache.map(c => c.ordem || 0)) 
        : 0;
      const newOrdem = maxOrdem + 1;

      console.log('[Admin] Criando nova cadência:', { nome, cor, ordem: newOrdem });
      const { data, error } = await _supabase
        .from('cadencias')
        .insert([{ nome, cor, ordem: newOrdem }])
        .select();
      
      if (error) throw error;
      toast('Cadência criada com sucesso!');
      
      // Add to cache
      if (data && data[0]) {
        _cadenciasCache.push(data[0]);
        cadenciaId = data[0].id;
        isNew = true;
      }
    }

    // Save visibility settings
    if (cadenciaId) {
      for (const { perfil, visible } of visibilitySettings) {
        if (perfil === 'Administrador') continue; // Admin always visible
        try {
          await upsertCadenciaVisibility(cadenciaId, perfil, visible);
        } catch (visErr) {
          console.error('[Admin] Erro ao salvar visibilidade:', visErr);
        }
      }
      // Refresh visibility cache
      _cadenciaVisibilityData = await fetchCadenciaVisibility();
    }

    closeCadenciaModal();
    await loadCadenciasAdmin();

    // Refresh CRM kanban if on CRM page
    if (activePage === 'crm' && typeof renderAll === 'function') {
      await rebuildCadenciaMaps();
      await renderAll();
    }

  } catch (err) {
    console.error('[Admin] Erro ao salvar cadência:', err);
    toast(err.message || 'Erro ao salvar cadência', 'error');
  } finally {
    saveBtn.disabled = false;
    const txt = _cadenciaEditingId ? 'Salvar Alterações' : 'Salvar Cadência';
    saveBtn.innerHTML = `<i data-lucide="save"></i> <span id="cadenciaSaveBtnText">${txt}</span>`;
    initIcons();
  }
}

async function handleCadenciaDelete() {
  if (!_cadenciaDeleteId) return;
  console.log('[Admin] Excluindo cadência:', _cadenciaDeleteId);

  const delBtn = document.getElementById('cadenciaDeleteConfirmBtn');
  delBtn.disabled = true;
  delBtn.innerHTML = '<span class="auth-spinner"></span>';

  try {
    const { error } = await _supabase
      .from('cadencias')
      .delete()
      .eq('id', _cadenciaDeleteId);
    
    if (error) throw error;

    toast('Cadência removida com sucesso!');
    closeCadenciaDeleteModal();
    await loadCadenciasAdmin();

    // Refresh CRM kanban if on CRM page
    if (activePage === 'crm' && typeof renderAll === 'function') {
      await rebuildCadenciaMaps();
      await renderAll();
    }

  } catch (err) {
    console.error('[Admin] Erro ao excluir cadência:', err);
    toast(err.message || 'Erro ao excluir cadência', 'error');
  } finally {
    delBtn.disabled = false;
    delBtn.innerHTML = '<i data-lucide="trash-2"></i> Remover';
    initIcons();
  }
}

/* ============================================
   CONFIGURAÇÕES · Perfil, Avatar, Equipe
   ============================================ */

let _settingsBound = false;

function showSettingsTab(tab) {
  $$('.settings-content > .card').forEach(c => c.style.display = '');
  $$('.settings-tab-content').forEach(c => c.style.display = 'none');
  if (tab === 'perfil') {
    $$('.settings-content > .card')[0].style.display = '';
    $$('.settings-content > .card')[1].style.display = '';
  } else if (tab === 'equipe') {
    $$('.settings-content > .card')[0].style.display = 'none';
    $$('.settings-content > .card')[1].style.display = '';
  } else if (tab === 'whatsapp') {
    $$('.settings-content > .card').forEach(c => c.style.display = 'none');
    const waTab = document.getElementById('settingsTabWhatsapp');
    if (waTab) { waTab.style.display = ''; initWhatsAppConfig(); }
  } else {
    $$('.settings-content > .card').forEach(c => c.style.display = 'none');
  }
}

/* ============================================
   WHATSAPP CONFIG · QR Code & Conexao
   ============================================ */
let _waConfigBound = false;
let _waQrPolling = null;

async function initWhatsAppConfig() {
  if (!currentUser.id) return;

  // Bind eventos uma unica vez
  if (!_waConfigBound) {
    _waConfigBound = true;
    const connectBtn = document.getElementById('waConnectBtn');
    const disconnectBtn = document.getElementById('waDisconnectBtn');
    const refreshBtn = document.getElementById('waRefreshBtn');
    const qrRefresh = document.getElementById('waQrRefresh');

    if (connectBtn) connectBtn.addEventListener('click', waHandleConnect);
    if (disconnectBtn) disconnectBtn.addEventListener('click', waHandleDisconnect);
    if (refreshBtn) refreshBtn.addEventListener('click', waLoadStatus);
    if (qrRefresh) qrRefresh.addEventListener('click', waHandleConnect);

    // Popular dropdown de centros de custo
    await _populateWaCentroCustoDropdown();
  }

  await waLoadStatus();
}

async function _populateWaCentroCustoDropdown() {
  const select = document.getElementById('waCentroCustoSelect');
  if (!select) return;

  const { data: mccData } = await _supabase
    .from('membro_centros_custo')
    .select('centro_custo_id, centros_custo(id, nome)')
    .eq('membro_id', currentUser.id);

  const list = (mccData || [])
    .map(r => r.centros_custo)
    .filter(Boolean)
    .sort((a, b) => a.nome.localeCompare(b.nome));

  select.innerHTML = '<option value="">Selecione a empresa...</option>' +
    list.map(cc => `<option value="${cc.id}">${escapeHtml(cc.nome)}</option>`).join('');

  // Ao trocar o centro de custo, recarregar status
  select.addEventListener('change', () => waLoadStatus());
}

async function waLoadStatus() {
  const dot = document.getElementById('waStatusDot');
  const label = document.getElementById('waStatusLabel');
  const sub = document.getElementById('waStatusSub');
  const connectBtn = document.getElementById('waConnectBtn');
  const disconnectBtn = document.getElementById('waDisconnectBtn');
  const refreshBtn = document.getElementById('waRefreshBtn');
  const qrSection = document.getElementById('waQrSection');
  const ccSelect = document.getElementById('waCentroCustoSelect');

  if (dot) dot.className = 'wa-status-dot';

  // Ler centro de custo selecionado
  const centrosCustoId = ccSelect?.value || null;

  try {
    const config = await waFetchConfig(currentUser.id, centrosCustoId);

    if (!config) {
      if (dot) dot.classList.add('disconnected');
      if (label) label.textContent = 'Nao conectado';
      if (sub) sub.textContent = 'Configure sua instancia WhatsApp';
      if (connectBtn) connectBtn.style.display = '';
      if (disconnectBtn) disconnectBtn.style.display = 'none';
      if (refreshBtn) refreshBtn.style.display = 'none';
      if (qrSection) qrSection.style.display = 'none';
      waStopQrPolling();
      return;
    }

    const status = config.status || 'disconnected';
    const instanceName = config.provider_config?.instanceName || '--';

    if (dot) dot.classList.add(status);
    if (sub) sub.textContent = 'Instance: ' + instanceName;

    if (status === 'connected') {
      if (label) label.textContent = 'Conectado';
      if (connectBtn) connectBtn.style.display = 'none';
      if (disconnectBtn) disconnectBtn.style.display = '';
      if (refreshBtn) refreshBtn.style.display = '';
      if (qrSection) qrSection.style.display = 'none';
      waStopQrPolling();
    } else if (status === 'connecting') {
      if (label) label.textContent = 'Aguardando leitura do QR Code...';
      if (connectBtn) connectBtn.style.display = 'none';
      if (disconnectBtn) disconnectBtn.style.display = 'none';
      if (refreshBtn) refreshBtn.style.display = '';
      if (qrSection) qrSection.style.display = '';
      waStartQrPolling(instanceName);
    } else {
      if (label) label.textContent = 'Desconectado';
      if (connectBtn) connectBtn.style.display = '';
      if (disconnectBtn) disconnectBtn.style.display = 'none';
      if (refreshBtn) refreshBtn.style.display = 'none';
      if (qrSection) qrSection.style.display = 'none';
      waStopQrPolling();
    }
  } catch (err) {
    console.error('[WA Config] Erro ao carregar status:', err);
    if (dot) dot.classList.add('error');
    if (label) label.textContent = 'Erro ao verificar status';
    if (sub) sub.textContent = err.message || 'Tente novamente';
    if (connectBtn) connectBtn.style.display = '';
    if (disconnectBtn) disconnectBtn.style.display = 'none';
  }
}

async function waHandleConnect() {
  const instanceInput = document.getElementById('waInstanceName');
  const integrationSelect = document.getElementById('waIntegration');
  const ccSelect = document.getElementById('waCentroCustoSelect');
  const qrSection = document.getElementById('waQrSection');
  const qrLoading = document.getElementById('waQrLoading');
  const qrImage = document.getElementById('waQrImage');

  const centrosCustoId = ccSelect?.value || null;

  let instanceName = instanceInput?.value?.trim() || '';
  if (!instanceName) {
    // Gerar nome baseado no centro de custo ou no usuário
    if (centrosCustoId) {
      const ccText = ccSelect.options[ccSelect.selectedIndex]?.text || '';
      instanceName = 'blue-crm-' + ccText.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    } else {
      instanceName = 'blue-crm-' + (currentUser.nome || 'user').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    }
    if (instanceInput) instanceInput.value = instanceName;
  }

  const integration = integrationSelect?.value || 'WHATSAPP-BAILEYS';

  // Mostrar QR section
  if (qrSection) qrSection.style.display = '';
  if (qrLoading) qrLoading.style.display = '';
  if (qrImage) qrImage.style.display = 'none';

  // Atualizar status
  const dot = document.getElementById('waStatusDot');
  const label = document.getElementById('waStatusLabel');
  if (dot) { dot.className = 'wa-status-dot'; dot.classList.add('connecting'); }
  if (label) label.textContent = 'Conectando...';

  try {
    const result = await waConnect(currentUser.id, instanceName, centrosCustoId);

    if (result.qr) {
      if (qrLoading) qrLoading.style.display = 'none';
      if (qrImage) {
        // Garantir que o prefixo data:image exista
        let qrSrc = result.qr;
        if (qrSrc && !qrSrc.startsWith('data:')) {
          qrSrc = 'data:image/png;base64,' + qrSrc;
        }
        qrImage.src = qrSrc;
        qrImage.style.display = '';
        qrImage.onerror = () => {
          console.error('[WA] Erro ao carregar QR Code');
          qrImage.style.display = 'none';
          qrLoading.style.display = '';
        };
      }
      waStartQrPolling(instanceName);
    } else {
      // QR ainda nao disponivel, iniciar polling
      waStartQrPolling(instanceName);
    }

    toast('Instancia criada. Escaneie o QR Code.');
  } catch (err) {
    console.error('[WA Config] Erro ao conectar:', err);
    toast('Erro ao conectar: ' + (err.message || 'Tente novamente'), 'error');
    if (qrSection) qrSection.style.display = 'none';
    await waLoadStatus();
  }
}

async function waHandleDisconnect() {
  if (!confirm('Desconectar WhatsApp? As mensagens anteriores serao mantidas.')) return;

  const ccSelect = document.getElementById('waCentroCustoSelect');
  const centrosCustoId = ccSelect?.value || null;

  try {
    await waDisconnect(currentUser.id, centrosCustoId);
    toast('WhatsApp desconectado');
    await waLoadStatus();
  } catch (err) {
    console.error('[WA Config] Erro ao desconectar:', err);
    toast('Erro ao desconectar: ' + err.message, 'error');
  }
}

function waStartQrPolling(instanceName) {
  waStopQrPolling();
  let attempts = 0;
  const maxAttempts = 30;

  _waQrPolling = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      waStopQrPolling();
      toast('QR Code expirado. Tente novamente.', 'error');
      await waLoadStatus();
      return;
    }

    try {
      const config = await waFetchConfig(currentUser.id);
      if (config?.status === 'connected') {
        waStopQrPolling();
        toast('WhatsApp conectado com sucesso!');
        await waLoadStatus();
      }
    } catch (e) {
      // Silently retry
    }
  }, 3000);
}

function waStopQrPolling() {
  if (_waQrPolling) {
    clearInterval(_waQrPolling);
    _waQrPolling = null;
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
  { category: 'Principal', items: [
    { page: 'home', icon: 'home', label: 'Home' },
    { page: 'dashboard', icon: 'layout-dashboard', label: 'Dashboard' },
    { page: 'crm', icon: 'kanban-square', label: 'CRM' },
    { page: 'conversas', icon: 'message-circle', label: 'Conversas' },
    { page: 'contratos', icon: 'file-text', label: 'Contratos' },
    { page: 'clientes', icon: 'users', label: 'Cliente da Base' },
    { page: 'calendario', icon: 'calendar-days', label: 'Calendário' },
    { page: 'rotina', icon: 'clipboard-list', label: 'Rotina Blue' },
    { page: 'pomodoro', icon: 'timer', label: 'Pomodoro' }
  ]},
  { category: 'Ferramentas', items: [
    { page: 'configuracoes', icon: 'settings', label: 'Configurações' },
    { page: 'auditoria', icon: 'shield', label: 'Auditoria' },
    { page: 'administrador', icon: 'shield-check', label: 'Administrador' },
    { page: 'calibragem', icon: 'gauge', label: 'Calibragem' }
  ]}
];

const _permKeyMap = {
  home: 'can_home', dashboard: 'can_dashboard', crm: 'can_crm',
  contratos: 'can_contratos', clientes: 'can_cliente_base', calendario: 'can_calendario',
  rotina: 'can_rotina_blue', pomodoro: 'can_pomodoro',
  conversas: 'can_conversas', configuracoes: 'can_configuracoes',
  auditoria: 'can_auditoria', administrador: 'can_administrador',
  calibragem: 'can_calibragem'
};

const _sidebarPermKeys = [
  'can_home','can_dashboard','can_crm','can_contratos','can_cliente_base',
  'can_calendario','can_rotina_blue','can_pomodoro','can_conversas','can_configuracoes',
  'can_auditoria','can_administrador','can_obrigacoes','can_documentos','can_suporte','can_calibragem'
];

const _profileToPermKey = {
  home: 'can_home', dashboard: 'can_dashboard', crm: 'can_crm',
  contratos: 'can_contratos', cliente_base: 'can_cliente_base', calendario: 'can_calendario',
  rotina_blue: 'can_rotina_blue', pomodoro: 'can_pomodoro', conversas: 'can_conversas',
  configuracoes: 'can_configuracoes', auditoria: 'can_auditoria', administrador: 'can_administrador',
  calibragem: 'can_calibragem', delete_telefone: 'can_delete_cliente_telefone',
  obrigacoes: 'can_obrigacoes', documentos: 'can_documentos', suporte: 'can_suporte'
};

async function loadUserPermissions() {
  console.log('[Perm] ─── loadUserPermissions() START ─── currentUser.id:', currentUser.id, 'perfil:', currentUser.perfil);
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

  // Step 2: Determine user's profile — robust fallback chain
  const validProfiles = ['Administrador', 'Atendente', 'Marketing', 'Pre Vendas', 'Membro'];
  let perfil = currentUser.perfil;
  if (!perfil || !validProfiles.includes(perfil)) {
    console.warn('[Perm] Invalid or missing perfil:', JSON.stringify(perfil), '— falling back to Membro');
    perfil = 'Membro';
  }
  currentUser.perfil = perfil;

  // Step 3: Load profile-level permissions from perfis_permissoes (fallback: PERFIL_DEFAULTS)
  let profilePerms = { ...(PERFIL_DEFAULTS[perfil] || PERFIL_DEFAULTS['Membro']) };
  try {
    const { data: profileData, error: profileError } = await _supabase
      .from('perfis_permissoes')
      .select('permissions')
      .eq('perfil', perfil)
      .maybeSingle();
    if (!profileError && profileData?.permissions) {
      profilePerms = { ...profilePerms, ...profileData.permissions };
    }
  } catch (err) {
    console.warn('[Perm] perfis_permissoes lookup failed, using PERFIL_DEFAULTS:', err.message);
  }
  console.log('[Perm] Profile permissions loaded for', perfil, '- home:', profilePerms.home, 'crm:', profilePerms.crm, 'conversas:', profilePerms.conversas);

  // Step 4: Load individual permissions from membros_permissoes
  console.log('[Perm] Querying membros_permissoes for membro_id:', currentUser.id);
  let memberPerm = null;
  try {
    const { data, error } = await _supabase.from('membros_permissoes')
      .select('*').eq('membro_id', currentUser.id).maybeSingle();
    if (error) {
      console.error('[Perm] Query error:', error.message, error.code);
    } else {
      memberPerm = data;
    }
  } catch (err) {
    console.error('[Perm] Exception:', err);
  }

  // Step 5: Build merged permission cache
  // Base: profile defaults converted to can_* format
  const merged = {};
  Object.entries(_profileToPermKey).forEach(([profileKey, permKey]) => {
    merged[permKey] = profilePerms[profileKey] === true;
  });
  merged.perfil = perfil;

  // Step 6: Overlay individual overrides from membros_permissoes
  if (memberPerm) {
    merged.perfil = memberPerm.perfil || perfil;
    merged.id = memberPerm.id;
    merged.membro_id = memberPerm.membro_id;
    merged.created_at = memberPerm.created_at;
    merged.updated_at = memberPerm.updated_at;

    // Sidebar booleans: use individual value if explicitly set (not null/undefined)
    _sidebarPermKeys.forEach(permKey => {
      if (memberPerm[permKey] !== undefined && memberPerm[permKey] !== null) {
        merged[permKey] = memberPerm[permKey] === true;
      }
    });
    merged.can_delete_cliente_telefone = memberPerm.can_delete_cliente_telefone === true;

    // CRUD granular permissions: merge from individual record
    if (memberPerm.permissions) {
      merged.permissions = { ...(merged.permissions || {}), ...memberPerm.permissions };
    }
  } else {
    // No individual record - create one from profile defaults
    console.warn('[Perm] No membros_permissoes record for', currentUser.id, '- creating from profile');
    try {
      const insertPayload = {
        membro_id: currentUser.id,
        perfil: perfil,
        permissions: profilePerms
      };
      _sidebarPermKeys.forEach(k => { insertPayload[k] = merged[k] === true; });
      insertPayload.can_delete_cliente_telefone = merged.can_delete_cliente_telefone === true;

      const { data: inserted, error: insertError } = await _supabase
        .from('membros_permissoes')
        .insert(insertPayload)
        .select()
        .single();
      if (!insertError && inserted) {
        merged.id = inserted.id;
        merged.membro_id = inserted.membro_id;
        console.log('[Perm] Created membros_permissoes from profile:', inserted.id);
      } else {
        console.warn('[Perm] Could not create membros_permissoes:', insertError?.message);
      }
    } catch (err) {
      console.warn('[Perm] Exception creating membros_permissoes:', err.message);
    }
  }

  _userPermCache = merged;
  currentUser.perfil = merged.perfil;
  console.log('[Perm] ═══ FINAL MERGED PERMISSIONS ═══');
  console.log('[Perm] Profile:', merged.perfil);
  console.log('[Perm] Sidebar modules:', {
    home: merged.can_home, dashboard: merged.can_dashboard, crm: merged.can_crm,
    contratos: merged.can_contratos, clientes: merged.can_cliente_base,
    calendario: merged.can_calendario, rotina: merged.can_rotina_blue,
    pomodoro: merged.can_pomodoro, conversas: merged.can_conversas,
    configuracoes: merged.can_configuracoes, auditoria: merged.can_auditoria,
    administrador: merged.can_administrador, calibragem: merged.can_calibragem
  });
  console.log('[Perm] Full object:', JSON.stringify(merged));
  return merged;
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

  const isAdmin = _userPermCache && _userPermCache.perfil === 'Administrador';

  let html = '';
  _sidebarMenuItems.forEach(category => {
    const allowedItems = category.items.filter(item => {
      if (item.page === 'calibragem') {
        return isAdmin && isPageAllowed(item.page, _userPermCache);
      }
      return isPageAllowed(item.page, _userPermCache);
    });

    if (allowedItems.length === 0) return;

    html += `<p class="nav-label">${category.category}</p><ul>`;
    allowedItems.forEach(item => {
      const activeClass = (item.page === activePage) ? ' active' : '';
      html += `<li><a href="#" class="nav-item${activeClass}" data-page="${item.page}">
        <i data-lucide="${item.icon}"></i><span>${item.label}</span></a></li>`;
    });
    html += '</ul>';
  });

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
  if (currentUser.perfil === 'Atendente') return true;
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
          <input type="text" id="search-query" name="search-query" placeholder="Buscar módulos..." aria-label="Buscar módulos" autocomplete="new-password" />
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
    contratos: _userPermCache.can_contratos,
    clientes: _userPermCache.can_cliente_base,
    calendario: _userPermCache.can_calendario,
    configuracoes: _userPermCache.can_configuracoes,
    rotina: _userPermCache.can_rotina_blue,
    pomodoro: _userPermCache.can_pomodoro,
    conversas: _userPermCache.can_conversas,
    auditoria: _userPermCache.can_auditoria,
    administrador: _userPermCache.can_administrador,
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
  const input = document.getElementById('search-query');
  if (!input) return;
  homeSearchBound = true;
  input.addEventListener('input', (e) => {
    clearTimeout(homeSearchDebounce);
    homeSearchDebounce = setTimeout(() => {
      renderHomeModules(e.target.value);
    }, 200);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(homeSearchDebounce);
      renderHomeModules(input.value);
    }
  });
}
// Atalho "/" para focar busca (bind uma vez só)
document.addEventListener('keydown', function homeSearchShortcut(e) {
  if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
    const input = document.getElementById('search-query');
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
  { id: 'home', title: 'Home', desc: 'Acesse rapidamente os principais módulos do sistema.', icon: 'home', route: '/home', section: 'Principal' },
  { id: 'dashboard', title: 'Dashboard', desc: 'Indicadores e métricas em tempo real.', icon: 'layout-dashboard', route: '/dashboard', section: 'Principal' },
  { id: 'crm', title: 'CRM', desc: 'Centralize o relacionamento com clientes.', icon: 'kanban-square', route: '/crm', section: 'Principal' },
  { id: 'conversas', title: 'Conversas', desc: 'Central de conversas e mensagens da equipe.', icon: 'message-circle', route: '/conversas', section: 'Principal' },
  { id: 'contratos', title: 'Contratos', desc: 'Gere e gerencie contratos de prestação de serviços.', icon: 'file-text', route: '/contratos', section: 'Principal' },
  { id: 'clientes', title: 'Cliente da Base', desc: 'Organize e qualifique os clientes.', icon: 'users', route: '/cliente-da-base', section: 'Principal' },
  { id: 'calendario', title: 'Calendário', desc: 'Organize as datas dos eventos.', icon: 'calendar-days', route: '/calendario', section: 'Principal' },
  { id: 'rotina', title: 'Rotina Blue', desc: 'Organize tarefas, reuniões e lembretes do dia a dia.', icon: 'clipboard-list', route: '/rotina', section: 'Principal' },
  { id: 'pomodoro', title: 'Pomodoro', desc: 'Gestão de tempo e foco com ciclos de trabalho.', icon: 'timer', route: '/pomodoro', section: 'Principal' },
  { id: 'configuracoes', title: 'Configurações', desc: 'Personalize conta e equipe.', icon: 'settings', route: '/configuracoes', section: 'Ferramentas' },
  { id: 'auditoria', title: 'Auditoria', desc: 'Rastreamento completo de ações e histórico do sistema.', icon: 'shield', route: '/auditoria', section: 'Ferramentas' },
  { id: 'administrador', title: 'Administrador', desc: 'Gerencie usuários, permissões e configurações do sistema.', icon: 'shield-check', route: '/administrador', section: 'Ferramentas' },
  { id: 'calibragem', title: 'Calibragem', desc: 'Calibre e ajuste parâmetros do sistema.', icon: 'gauge', route: '/calibragem', section: 'Ferramentas' }
];

const knownPages = new Set(['home', 'dashboard', 'crm', 'clientes', 'contratos', 'calendario', 'configuracoes', 'rotina', 'pomodoro', 'conversas', 'auditoria', 'administrador', 'obrigacoes', 'documentos', 'suporte', 'calibragem', 'centros-custo', 'centro-custo-detail']);

const pageConfig = {
  home: {
    title: 'Home',
    subtitle: 'Bem-vindo ao Blue Group',
    primary: 'Novo cliente',
    primaryIcon: 'plus'
  },
  dashboard: {
    title: 'Dashboard',
    subtitle: 'Visão gerencial',
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
    subtitle: 'Central de Atendimento WhatsApp',
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
  },
  contratos: {
    title: '',
    subtitle: '',
    primary: '',
    primaryIcon: ''
  }
};

let activePage = 'home';

function setActivePage(page) {
  const prevPage = activePage;

  // Verificação de permissão: bloquear acesso a módulos sem permissão
  if (_userPermCache) {
    const permPageMap = {
      home: 'can_home', dashboard: 'can_dashboard', crm: 'can_crm',
      contratos: 'can_contratos', clientes: 'can_cliente_base', calendario: 'can_calendario',
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
  const hideTopbarActions = page === 'home' || page === 'dashboard' || page === 'calendario' || page === 'rotina' || page === 'pomodoro' || page === 'conversas' || page === 'configuracoes' || page === 'auditoria' || page === 'administrador' || page === 'calibragem' || page === 'contratos';
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
  if (page === 'contratos') {
    initContratos();
  }
  if (page === 'conversas') {
    console.log('[Nav] Conversas page, pending:', !!_pendingConvNavigation);
    _initConvCentroCustoDropdown().then(() => {
      console.log('[Nav] CC dropdown ready, loading chats...');
      return loadConversasChats();
    }).then(() => {
      console.log('[Nav] Chats loaded, processing deep-link...');
      _processConvDeepLink();
    }).catch(err => {
      console.error('[Nav] Error in conversas navigation:', err);
    });
  }
}

/* ============================================
   CLIENTES — DATA + RENDER
   ============================================ */
let clientsData = [];
let selectedClientIds = new Set();
let _clientMassBarBound = false;

const statusMap = {
  active: { label: 'Ativo', cls: 'status-active' },
  impl: { label: 'Implantação', cls: 'status-impl' },
  late: { label: 'Inadimplente', cls: 'status-late' },
  warn: { label: 'Atenção', cls: 'status-warn' }
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
    const client = clientsData.find(c => String(c.id) === String(clientId));
    const oldMemberId = client?._membroId;
    const oldMember = _membersCache?.find(m => m.id === oldMemberId);
    const oldMemberName = oldMember?.nome || 'Desconhecido';

    const { error } = await _supabase.from('leads')
      .update({ membro_id: memberId })
      .eq('id', String(clientId));

    if (error) throw error;

    await insertMovement({
      lead_id: clientId,
      user_id: currentUser.id || null,
      movement_type: 'transferencia',
      from_value: oldMemberName,
      to_value: memberName
    });

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

    if (memberId) {
      const newMember = _membersCache?.find(m => m.id === memberId);
      const newMemberName = newMember?.nome || 'Membro';
      for (const id of ids) {
        const client = clientsData.find(c => String(c.id) === String(id));
        const oldMemberId = client?._membroId;
        const oldMember = _membersCache?.find(m => m.id === oldMemberId);
        const oldMemberName = oldMember?.nome || 'Desconhecido';
        await insertMovement({
          lead_id: id,
          user_id: currentUser.id || null,
          movement_type: 'transferencia',
          from_value: oldMemberName,
          to_value: newMemberName
        });
      }
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

  // Verificar contratos vinculados antes de excluir
  if (_supabase) {
    try {
      const { data: vinculados, error: vincErr } = await _supabase
        .from('contratos')
        .select('id, lead_id')
        .in('lead_id', ids);
      if (!vincErr && vinculados && vinculados.length > 0) {
        const leadsComContrato = [...new Set(vinculados.map(v => v.lead_id))];
        toast(`Este(s) lead(s) não pode(m) ser apagado(s) pois possui(m) contratos vinculados (${leadsComContrato.length}). Exclua ou desvincule os contratos associados primeiro.`, 'error');
        return;
      }
    } catch (e) {
      console.error('[MassDelete] Erro ao verificar contratos:', e);
    }
  }

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
  $('#leadModalMetaCreate').textContent = client.cnpj || 'Cliente da base';
  $('#leadModalMetaLast').textContent = '—';

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

  const dbCadenciasForJourney = getDbCadencias().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  const cadenceIdx = dbCadenciasForJourney.findIndex(c => c.nome === 'CONTRATO FECHADO' || c.nome === 'Contrato Fechado' || c.nome === 'contrato-fechado');
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
    reuniao: '#165BFF',
    casamento: '#165BFF',
    festa15: '#a855f7',
    aniversario: '#f59e0b',
    corporativo: '#10b981',
    evento: '#2F80ED',
    lembrete: '#3b82f6',
    fiscal: '#f59e0b',
    financeiro: '#10b981',
    implantacao: '#a855f7',
    vencimento: '#ef4444'
  })[type] || '#165BFF';
}

function meetingTypeLabel(type) {
  return ({
    casamento: 'Casamento',
    festa15: 'Festa de 15 anos',
    aniversario: 'Aniversário',
    corporativo: 'Corporativo',
    evento: 'Evento',
    lembrete: 'Lembrete'
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

const MONTH_NAMES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const WEEKDAY_HEADERS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

function getTodayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isoFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function updateCalTitle() {
  const el = $('#calTitle');
  if (!el) return;
  if (calView === 'day') {
    el.textContent = `${calCurrentDate.getDate()} de ${MONTH_NAMES_PT[calCurrentDate.getMonth()]} ${calCurrentDate.getFullYear()}`;
  } else if (calView === 'week') {
    const startOfWeek = getWeekStart(calCurrentDate);
    const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(endOfWeek.getDate() + 6);
    if (startOfWeek.getMonth() === endOfWeek.getMonth()) {
      el.textContent = `${startOfWeek.getDate()}–${endOfWeek.getDate()} de ${MONTH_NAMES_PT[startOfWeek.getMonth()]} ${startOfWeek.getFullYear()}`;
    } else {
      el.textContent = `${MONTH_NAMES_PT[startOfWeek.getMonth()].slice(0, 3)} ${startOfWeek.getDate()} – ${MONTH_NAMES_PT[endOfWeek.getMonth()].slice(0, 3)} ${endOfWeek.getDate()} ${endOfWeek.getFullYear()}`;
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
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, other: false, iso });
  }
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) cells.push({ day: d, other: true, iso: '' });

  grid.className = 'cal-grid';
  const MAX_VISIBLE = 3;
  grid.innerHTML = cells.map(c => {
    const isToday = c.iso === todayIso;
    const events = c.iso ? (eventsMap || calendarEvents)[c.iso] || [] : [];
    const visibleEvents = events.slice(0, MAX_VISIBLE);
    const remaining = events.length - MAX_VISIBLE;
    const eventsHtml = visibleEvents.map(e =>
      `<span class="cal-event" role="button" tabindex="0" data-iso="${c.iso}" data-meeting-id="${e.id}" style="background:${e.color}">${e.title}</span>`
    ).join('');
    const moreHtml = remaining > 0
      ? `<span class="cal-day-more" data-iso="${c.iso}">+${remaining} mais</span>`
      : '';
    return `<div class="cal-day ${c.other ? 'other-month' : ''} ${isToday ? 'today' : ''}" role="button" tabindex="0" data-iso="${c.iso}">
      <span class="cal-day-num">${c.day}</span>
      <div class="cal-day-events">${eventsHtml}${moreHtml}</div>
    </div>`;
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
    const d = new Date(weekStart); d.setDate(d.getDate() + i);
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
      const d = new Date(weekStart); d.setDate(d.getDate() + i);
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
  g.moveTo(-2, -2); g.lineTo(size + 2, size + 2);
  g.stroke();
  return ctx.createPattern(c, 'repeat');
}

function initCharts() {
  // Project Analytics (bar com hatching para dias inativos)
  const ctx1 = document.getElementById('chartClientes');
  if (ctx1) {
    const ctx = ctx1.getContext('2d');
    const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    const data = [12, 18, 0, 22, 16, 0, 8];  // Sáb e Dom = inativos
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
            bodyFont: { family: 'Inter', size: 12 },
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
  const fg = document.getElementById('prFg');
  const mid = document.getElementById('prMid');
  if (!fg || !mid) return;

  const C = 2 * Math.PI * 60; // ~376.99
  const total = 41 + 35 + 24; // 100
  const dashFg = C * (1 - (41 / 100));
  const dashMid = C * (1 - ((41 + 35) / 100));
  fg.style.strokeDashoffset = String(dashFg);
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
    clienteSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(searchTimeout);
        clienteSearchQuery = clienteSearch.value;
        renderClients();
      }
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
  if (themeBtn) themeBtn.addEventListener('click', (e) => toggleTheme(e));
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
  const stop = $('#ttStop');
  const reset = $('#ttReset');
  if (!playPause) return;

  tt.render();
  tt.start();

  playPause.addEventListener('click', () => tt.toggle());
  stop.addEventListener('click', () => tt.pause());
  reset.addEventListener('click', () => tt.reset());
}

/* ============================================
   CRM · DADOS
   Colunas do Kanban são 100% dinâmicas (tabela cadencias).
   ============================================ */

function getVisibleCadences(centroCustoId) {
  // Colunas 100% dinâmicas — fonte: tabela cadencias no Supabase
  let dbCadencias = getDbCadencias();
  
  if (dbCadencias.length === 0) {
    console.warn('[CRM] Nenhuma cadência carregada do banco');
    return [];
  }
  
  // Apply visibility filtering for non-admins
  let visible = dbCadencias.map(dbCadenciaToCrmFormat);
  
  if (!isCurrentUserAdmin() && _cadenciaVisibilityData.length > 0) {
    const perfil = currentUser.perfil || 'Atendente';
    const blockedUuids = _cadenciaVisibilityData
      .filter(v => v.perfil === perfil && v.visible === false)
      .map(v => v.cadencia_id);
    if (blockedUuids.length > 0) {
      visible = visible.filter(c => !blockedUuids.includes(c.id));
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
  
  // Sort by ordem
  visible.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  
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

let _dbCadenciasCache = [];

async function loadDbCadencias() {
  if (!_supabase) return [];
  try {
    const { data, error } = await _supabase
      .from('cadencias')
      .select('id, nome, cor, ordem, created_at')
      .order('ordem', { ascending: true });
    if (error) {
      console.error('[CRM] Erro ao buscar cadências do DB:', error.message);
      return [];
    }
    _dbCadenciasCache = data || [];
    console.log('[CRM] Cadências carregadas do DB:', _dbCadenciasCache.length);
    return _dbCadenciasCache;
  } catch (err) {
    console.error('[CRM] Erro ao carregar cadências:', err);
    return [];
  }
}

function getDbCadencias() {
  return _dbCadenciasCache;
}

function dbCadenciaToCrmFormat(dbCadencia) {
  return {
    id: dbCadencia.id,
    label: dbCadencia.nome,
    short: dbCadencia.nome.length > 12 ? dbCadencia.nome.substring(0, 12) + '…' : dbCadencia.nome,
    color: dbCadencia.cor || '#3B82F6',
    ordem: dbCadencia.ordem
  };
}

function getFirstCadenciaId() {
  const sorted = [..._dbCadenciasCache].sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  return sorted.length > 0 ? sorted[0].id : null;
}

// Helper to get cadence info by UUID from database cache
function getCadenciaById(uuid) {
  return _dbCadenciasCache.find(c => c.id === uuid);
}

function getCadenciaLabelById(uuid) {
  const c = getCadenciaById(uuid);
  return c ? c.nome : uuid;
}

function getCadenciaColorById(uuid) {
  const c = getCadenciaById(uuid);
  return c ? c.cor : '#3B82F6';
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
   - `getVisibleCadences()` → define as colunas dinâmicas (UUID + label + color)
   - `leads`                → fonte primária dos dados
   - `getVisibleLeads()`    → aplica os filtros ativos (cadência + busca)
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
    if (activeCadenceFilter && l.status !== activeCadenceFilter) {
      return false;
    }
    if (q && !l.empresa.toLowerCase().includes(q) && !l.telefone.includes(q) && !l.cnpj.includes(q)) return false;
    return true;
  });
}

function cadencesSummary() {
  const allLeads = getSearchFilteredLeads();
  return getVisibleCadences(currentCrmEmpresaFilter).map(c => {
    const list = allLeads.filter(l => l.status === c.id);
    const value = list.reduce((s, l) => s + (l.honorarios || 0), 0);
    return { id: c.id, label: c.label, count: list.length, value, color: c.color };
  });
}

function renderCadenceGrid() {
  const grid = $('#cadenceGrid');
  if (!grid) return;

  const data = cadencesSummary();
  grid.innerHTML = data.map(c => `
    <div class="cadence-card ${activeCadenceFilter === c.id ? 'active' : ''}" data-cadence="${c.id}" data-action="filter-cadence" style="--cadence-color: ${c.color || '#3B82F6'};">
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

function canManageContratos() {
  const perfil = currentUser?.perfil || '';
  return isCurrentUserAdmin() || perfil === 'Atendente';
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
    const oldMember = _membersCache?.find(m => m.id === lead._membroId);
    const oldMemberName = oldMember?.nome || 'Desconhecido';

    const { error } = await _supabase.from('leads')
      .update({ membro_id: newOwnerId })
      .eq('id', String(currentLeadId));

    if (error) throw error;

    await insertMovement({
      lead_id: lead.id,
      user_id: currentUser.id || null,
      movement_type: 'transferencia',
      from_value: oldMemberName,
      to_value: newMemberName
    });

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
    addNotification({
      type: 'lead',
      title: `Lead atribuído: ${lead.empresa || lead.nome || ''}`,
      subtitle: `De ${currentUser.nome}`,
      data: { leadId: lead.id }
    });

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
    const totalFat = list.reduce((a, l) => a + (Number(l.honorarios) || 0), 0);
    const isHighlighted = activeCadenceFilter === c.id;
    const expanded = kanbanExpanded[c.id] || VISIBLE_CARDS_PER_COLUMN;
    const showCount = Math.min(total, expanded);
    const visibleList = list.slice(0, showCount);
    const hasMore = total > showCount;
    const remaining = total - showCount;
    const cards = visibleList.map(l => leadCardHTML(l)).join('');
    const colColor = c.color || '#3B82F6';
    return `
      <div class="kanban-col${isHighlighted ? ' kanban-col-highlight' : ''}" data-cadence="${c.id}" style="--cadence-color: ${colColor};">
        <div class="kanban-col-head">
          <span class="kanban-col-title">${c.label}</span>
          <span class="kanban-col-count" aria-label="${total} leads">${total}</span>
          ${totalFat > 0 ? `<span class="kanban-col-fat" title="Faturamento total">${formatBRL(totalFat)}</span>` : ''}
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
  _initBoardAutoScroll();
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
  const respName = l.responsavel || 'Sem atendente';
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
        <div class="row"><span class="lbl">Faturamento</span><span class="val">${formatBRL(l.honorarios)}</span></div>
        <div class="lead-card-member-badge"><i data-lucide="user"></i> ${respName}</div>
      </div>
    </article>
  `;
}

function formatCnpj(c) {
  return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function bindLeadCards() {
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  $$('.lead-card').forEach(card => {
    card.addEventListener('dragstart', onDragStart);
    card.addEventListener('dragend', onDragEnd);
  });

  if (isTouchDevice) {
    $$('.lead-card').forEach(card => {
      card.setAttribute('draggable', 'false');
    });
  }

  $$('.lead-card [data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id, 10);
      const action = btn.dataset.action;
      handleLeadAction(action, id);
    });
  });

  let touchMoved = false;

  $$('.lead-card').forEach(card => {
    card.addEventListener('touchstart', () => {
      touchMoved = false;
    }, { passive: true });

    card.addEventListener('touchmove', () => {
      touchMoved = true;
    }, { passive: true });

    card.addEventListener('click', (e) => {
      if (touchMoved) return;
      if (e.detail === 0) return;
      openLeadModal(card.dataset.leadId);
    });
  });
}

function bindDropZones() {
  $$('.kanban-col-list').forEach(zone => {
    zone.addEventListener('dragover', onDragOver);
    zone.addEventListener('dragenter', onDragEnter);
    zone.addEventListener('dragleave', onDragLeave);
    zone.addEventListener('drop', onDrop);
  });
}

function handleLeadAction(action, id) {
  const lead = leads.find(l => String(l.id) === String(id));
  if (!lead) return;
  switch (action) {
    case 'open-lead': openLeadModal(id); break;
    case 'call-lead': recordInteraction(id, 'Ligação', 'phone'); break;
    case 'schedule-lead': recordInteraction(id, 'Reunião agendada', 'calendar'); break;
    case 'note-lead': {
      const note = prompt('Adicionar nota rápida:');
      if (note) recordInteraction(id, 'Nota', 'sticky-note', note);
      break;
    }
    case 'transfer-lead': {
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
const _dragCounters = new Map();

const _autoScroll = { active: false, raf: null, zone: 120, maxSpeed: 14 };
let _dragOverEvent = null;

function _initBoardAutoScroll() {
  const board = $('#kanbanBoard');
  if (!board || board._autoScrollBound) return;
  board._autoScrollBound = true;

  board.addEventListener('dragover', (e) => {
    e.preventDefault();
    _dragOverEvent = e;
  });
}

function _startAutoScroll() {
  if (_autoScroll.active) return;
  _autoScroll.active = true;
  const board = $('#kanbanBoard');
  if (!board) return;

  function tick() {
    if (!_autoScroll.active) return;
    const evt = _dragOverEvent;
    if (evt) {
      const rect = board.getBoundingClientRect();
      const x = evt.clientX;
      const zone = _autoScroll.zone;
      const max = _autoScroll.maxSpeed;
      let delta = 0;

      if (x < rect.left + zone) {
        delta = -max * Math.pow(1 - (x - rect.left) / zone, 2);
      } else if (x > rect.right - zone) {
        delta = max * Math.pow(1 - (rect.right - x) / zone, 2);
      }

      if (delta !== 0) {
        board.scrollLeft += delta;
      }
    }
    _autoScroll.raf = requestAnimationFrame(tick);
  }
  _autoScroll.raf = requestAnimationFrame(tick);
}

function _stopAutoScroll() {
  _autoScroll.active = false;
  if (_autoScroll.raf) {
    cancelAnimationFrame(_autoScroll.raf);
    _autoScroll.raf = null;
  }
}

function onDragStart(e) {
  draggedId = this.dataset.leadId;
  this.classList.add('dragging');
  const board = $('#kanbanBoard');
  if (board) board.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedId);
  const col = this.closest('.kanban-col');
  if (col) _dragCounters.set(col, 0);
}

function onDragEnd() {
  _stopAutoScroll();
  _dragOverEvent = null;
  this.classList.remove('dragging');
  const board = $('#kanbanBoard');
  if (board) board.classList.remove('is-dragging');
  $$('.kanban-col').forEach(c => {
    c.classList.remove('drag-over');
    _dragCounters.delete(c);
  });
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  _dragOverEvent = e;
  _startAutoScroll();
  const col = this.parentElement;
  col.classList.add('drag-over');
}

function onDragEnter(e) {
  e.preventDefault();
  const col = this.parentElement;
  const count = (_dragCounters.get(col) || 0) + 1;
  _dragCounters.set(col, count);
  col.classList.add('drag-over');
}

function onDragLeave() {
  const col = this.parentElement;
  const count = (_dragCounters.get(col) || 1) - 1;
  _dragCounters.set(col, count);
  if (count <= 0) {
    _dragCounters.delete(col);
    col.classList.remove('drag-over');
  }
}

async function onDrop(e) {
  e.preventDefault();
  _stopAutoScroll();
  _dragOverEvent = null;
  const board = $('#kanbanBoard');
  if (board) board.classList.remove('is-dragging');
  const col = this.parentElement;
  col.classList.remove('drag-over');
  _dragCounters.delete(col);
  const id = e.dataTransfer.getData('text/plain') || draggedId;
  const newStatus = this.dataset.dropZone; // This is now the UUID from database
  const lead = leads.find(l => String(l.id) === String(id));
  if (!lead || !newStatus || lead.status === newStatus) return;

  const oldStatus = lead.status;
  lead.status = newStatus;
  lead.lastTouch = new Date().toLocaleDateString('pt-BR');
  invalidateDashCache();

  // newStatus is now the UUID from the database cadencias
  // We can use it directly as cadencia_id
  const newCadenciaUuid = newStatus;

  if (newCadenciaUuid) {
    lead._cadenciaId = newCadenciaUuid;
    updateLeadSupabase(lead.id, { cadencia_id: newCadenciaUuid })
      .then(() => console.log('[Supabase] cadencia_id salvo:', newCadenciaUuid))
      .catch(err => console.error('[Supabase] Erro ao salvar cadencia_id:', err));
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
  const c = getCadenciaById(id);
  return c ? c.nome : id;
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
  $('#leadModalMetaCreate').textContent = '—';
  $('#leadModalMetaLast').textContent = '—';

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

  // Bind CNPJ mask
  bindCnpjMask();

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
  const dbCadencias = getDbCadencias().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  const visibleCadences = isCurrentUserAdmin() ? dbCadencias : dbCadencias.filter(c => c.nome !== 'DADOS IA');
  const activeIdx = visibleCadences.findIndex(c => c.id === activeId);
  visibleCadences.forEach((c, i) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'journey-step';

    const chevron = document.createElement('div');
    chevron.className = 'journey-chevron';
    const isActive = i === activeIdx;
    const isDone = activeIdx !== -1 && i < activeIdx;
    const baseColor = c.color || '#165BFF';
    chevron.style.clipPath = 'polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)';

    if (activeIdx === -1) {
      chevron.classList.add('pending');
      chevron.style.background = '#2a2d35';
    } else if (isDone) {
      chevron.style.background = baseColor;
      chevron.style.opacity = '0.35';
    } else if (isActive) {
      chevron.style.background = baseColor;
      chevron.style.boxShadow = `0 0 8px ${baseColor}66`;
    } else {
      chevron.classList.add('pending');
      chevron.style.background = '#2a2d35';
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'journey-tooltip';
    tooltip.textContent = c.nome;

    wrapper.addEventListener('mouseenter', () => {
      tooltip.classList.add('visible');
    });
    wrapper.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible');
    });

    chevron.addEventListener('click', () => handleChangeCadence(c.id));

    wrapper.appendChild(chevron);
    wrapper.appendChild(tooltip);
    bar.appendChild(wrapper);
  });
}

async function insertMovement(payload) {
  let { error: insErr } = await _supabase.from('lead_movements').insert([payload]);
  if (insErr && insErr.code === '42703') {
    delete payload.user_id;
    await _supabase.from('lead_movements').insert([payload]);
  }
}

async function handleChangeCadence(cadenceId) {
  if (!currentLeadId) return;
  const lead = leads.find(l => String(l.id) === String(currentLeadId));
  if (!lead) return;
  if (lead.status === cadenceId) return;

  const oldStatus = lead.status;
  lead.status = cadenceId;
  lead.lastTouch = new Date().toLocaleDateString('pt-BR');
  invalidateDashCache();

  // cadenceId já é o UUID da cadência (vem da journey bar ou kanban)
  lead._cadenciaId = cadenceId;
  lead.owner_id = currentUser.id || null;
  const updates = { cadencia_id: cadenceId };
  if (lead.owner_id) updates.owner_id = lead.owner_id;
  updateLeadSupabase(lead.id, updates)
    .then(() => console.log('[Journey] cadencia_id e owner_id salvo:', cadenceId, lead.owner_id))
    .catch(err => console.error('[Journey] Erro ao salvar cadencia_id/owner_id:', err));

  if (lead.id && oldStatus && cadenceId && oldStatus !== cadenceId) {
    try {
      await insertMovement({
        lead_id: lead.id,
        user_id: currentUser.id || null,
        movement_type: 'cadencia',
        from_value: oldStatus,
        to_value: cadenceId
      });
    } catch (e) {
      console.error('[Lead] Erro ao registrar movimentação:', e);
    }
  }

  const card = $(`.lead-card[data-lead-id="${lead.id}"]`);
  if (card) card.classList.add('just-moved');
  setTimeout(() => card && card.classList.remove('just-moved'), 1200);

  if (!lead.history) lead.history = [];
  lead.history.unshift({
    type: 'status',
    icon: 'arrow-right-circle',
    title: `Cadência: ${labelOf(oldStatus)} → ${labelOf(cadenceId)}`,
    meta: new Date().toLocaleString('pt-BR'),
    desc: ''
  });

  toast(`Lead movido para ${labelOf(cadenceId)}`);
  if (typeof registrarAuditoria === 'function') {
    registrarAuditoria({ acao: 'Atualizações', caminho_url: '/crm', modulo: 'CRM' });
  }
  renderJourneyBar(cadenceId);
  renderAll();
}

function openLeadModal(id) {
  const lead = leads.find(l => String(l.id) === String(id));
  if (!lead) return;
  currentLeadId = id;

  // Guardar valores anteriores para detectar movimentações
  lead._prevThermal = lead.thermal || 'frio';
  lead._prevStatus = lead.status || '';

  const modal = $('#leadModal');
  modal.classList.remove('is-new');
  modal.dataset.mode = 'edit';

  const initials = lead.empresa.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  $('#leadModalAvatar').textContent = initials;
  $('#leadModalTitle').textContent = lead.empresa;
  $('#leadModalMetaCreate').textContent = `Criado em ${lead.createdAt}`;
  $('#leadModalMetaLast').textContent = lead.lastTouch || '—';

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

  // Bind CNPJ mask
  bindCnpjMask();

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

  // Pré-carregar dados das abas de Movimentação e Atividades
  loadLeadMovements(id);
  loadLeadActivities(id);

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

function bindCnpjMask() {
  const cnpjEl = $('#leadModal [name="cnpj"]');
  if (!cnpjEl) return;

  const newCnpjEl = cnpjEl.cloneNode(true);
  cnpjEl.parentNode.replaceChild(newCnpjEl, cnpjEl);

  function formatCnpj(v) {
    v = v.replace(/\D/g, '').slice(0, 14);
    if (v.length > 12) return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{1,2})/, '$1.$2.$3/$4-$5');
    if (v.length > 8) return v.replace(/(\d{2})(\d{3})(\d{3})(\d{1,4})/, '$1.$2.$3/$4');
    if (v.length > 5) return v.replace(/(\d{2})(\d{3})(\d{1,3})/, '$1.$2.$3');
    if (v.length > 2) return v.replace(/(\d{2})(\d{1,3})/, '$1.$2');
    return v;
  }

  newCnpjEl.addEventListener('input', () => {
    const pos = newCnpjEl.selectionStart;
    const prevLen = newCnpjEl.value.length;
    newCnpjEl.value = formatCnpj(newCnpjEl.value);
    const diff = newCnpjEl.value.length - prevLen;
    newCnpjEl.setSelectionRange(pos + diff, pos + diff);
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
    { icon: 'user-plus', title: 'Lead criado', meta: lead.createdAt, desc: 'Importação automática · origem: ' + (lead.origem || '—') },
    { icon: 'phone', title: 'Ligação de qualificação', meta: '28/05/2026 14:20', desc: 'Conversa inicial · lead demonstrou interesse em contabilidade mensal.' },
    { icon: 'mail', title: 'E-mail de follow-up', meta: '30/05/2026 09:10', desc: 'Envio da proposta de faturamento.' },
    { icon: 'calendar', title: 'Reunião agendada', meta: '02/06/2026 11:00', desc: 'Reunião marcada para 10/06 às 14h.' }
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
   LEAD MODAL · MOVIMENTAÇÃO (lead_movements)
   ============================================ */
async function loadLeadMovements(leadId) {
  const container = $('#leadMovementsTimeline');
  if (!container || !leadId) return;

  container.innerHTML = `
    <div class="lead-timeline-loading">
      <div class="lead-timeline-spinner"></div>
      <span>Carregando movimentações...</span>
    </div>`;

  try {
    let data = null;
    let error = null;

    const result1 = await _supabase
      .from('lead_movements')
      .select('id, lead_id, movement_type, from_value, to_value, user_id, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false });

    if (result1.error && result1.error.code === '42703') {
      const result2 = await _supabase
        .from('lead_movements')
        .select('id, lead_id, movement_type, from_value, to_value, created_at')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });
      data = result2.data;
      error = result2.error;
    } else {
      data = result1.data;
      error = result1.error;
    }

    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML = `
        <div class="lead-timeline-empty">
          <div class="lead-timeline-empty-icon">
            <i data-lucide="inbox"></i>
          </div>
          <p>Nenhuma movimentação registrada.</p>
          <span>As alterações de cadência e temperatura aparecerão aqui.</span>
        </div>`;
      initIcons();
      return;
    }

    const userIds = [...new Set(data.map(m => m.user_id).filter(Boolean))];
    let usersMap = {};
    if (userIds.length > 0) {
      const { data: members } = await _supabase
        .from('membros')
        .select('id, nome, foto_url')
        .in('id', userIds);
      if (members) {
        members.forEach(u => { usersMap[u.id] = u; });
      }
    }

    const fromLabel = (id) => {
      if (!id) return '—';
      const c = getCadenciaById(id);
      return c ? c.nome : id;
    };

    const formatMovementType = (type) => {
      if (type === 'cadencia') return 'Cadência';
      if (type === 'temperatura') return 'Temperatura';
      if (type === 'transferencia') return 'Transferência';
      return type;
    };

    const dotClass = (type) => {
      if (type === 'cadencia') return 'dot-cadencia';
      if (type === 'temperatura') return 'dot-temperatura';
      if (type === 'transferencia') return 'dot-transferencia';
      return 'dot-cadencia';
    };

    const badgeClass = (type) => {
      if (type === 'cadencia') return 'badge-cadencia';
      if (type === 'temperatura') return 'badge-temperatura';
      if (type === 'transferencia') return 'badge-transferencia';
      return 'badge-cadencia';
    };

    container.innerHTML = data.map(m => {
      const date = new Date(m.created_at);
      const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

      const user = usersMap[m.user_id] || null;
      const userName = user?.nome || 'Sistema';
      const userAvatar = user?.foto_url
        ? `<img src="${escapeHtml(user.foto_url)}" alt="" class="lead-timeline-avatar-img">`
        : `<span class="lead-timeline-avatar-initials">${escapeHtml(userName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase())}</span>`;

      let description = '';
      if (m.movement_type === 'transferencia' && m.from_value && m.to_value) {
        description = `${escapeHtml(userName)} transferiu o lead de <strong>${escapeHtml(m.from_value)}</strong> para <strong>${escapeHtml(m.to_value)}</strong>`;
      } else if (m.from_value && m.to_value) {
        const fromName = m.movement_type === 'cadencia' ? fromLabel(m.from_value) : m.from_value;
        const toName = m.movement_type === 'cadencia' ? fromLabel(m.to_value) : m.to_value;
        description = `${escapeHtml(userName)} moveu o lead de <strong>${escapeHtml(fromName)}</strong> para <strong>${escapeHtml(toName)}</strong>`;
      }

      return `
        <div class="lead-timeline-item">
          <div class="lead-timeline-dot ${dotClass(m.movement_type)}"></div>
          <div class="lead-timeline-body">
            <div class="lead-timeline-header">
              <div class="lead-timeline-user">
                <div class="lead-timeline-avatar">${userAvatar}</div>
                <span class="lead-timeline-username">${escapeHtml(userName)}</span>
              </div>
              <span class="lead-timeline-badge ${badgeClass(m.movement_type)}">${formatMovementType(m.movement_type)}</span>
            </div>
            ${description ? `<div class="lead-timeline-desc">${description}</div>` : ''}
            <div class="lead-timeline-date">${dateStr} às ${timeStr}</div>
          </div>
        </div>`;
    }).join('');
    initIcons();
  } catch (err) {
    console.error('[Lead] Erro ao carregar movimentações:', err);
    container.innerHTML = `
      <div class="lead-timeline-empty">
        <div class="lead-timeline-empty-icon error">
          <i data-lucide="alert-circle"></i>
        </div>
        <p>Erro ao carregar movimentações.</p>
        <span>Tente novamente mais tarde.</span>
      </div>`;
    initIcons();
  }
}

/* ============================================
   LEAD MODAL · SALVAR ATIVIDADE (lead_activities)
   ============================================ */
async function saveLeadActivity() {
  const leadId = currentLeadId;
  if (!leadId) { toast('Salve o lead primeiro', 'error'); return; }

  const typeEl = $('#leadActivityType');
  const descEl = $('#leadActivityDesc');
  const type = typeEl?.value || '';
  const description = descEl?.value?.trim() || '';

  if (!description) { toast('Preencha a descrição', 'error'); return; }

  // Obter user_id válido do membro logado
  let userId = currentUser.id;
  if (!userId) {
    try {
      const { data: { user } } = await _supabase.auth.getUser();
      if (user) {
        const { data: member } = await _supabase
          .from('membros')
          .select('id')
          .eq('auth_user_id', user.id)
          .single();
        userId = member?.id || null;
      }
    } catch (_) {}
  }
  if (!userId) { toast('Erro: usuário não identificado', 'error'); return; }

  try {
    const { error } = await _supabase
      .from('lead_activities')
      .insert([{
        lead_id: leadId,
        user_id: userId,
        activity_type: type,
        description
      }]);

    if (error) throw error;

    toast('Atividade salva com sucesso!');
    descEl.value = '';
    loadLeadActivities(leadId);
  } catch (err) {
    console.error('[Lead] Erro ao salvar atividade:', err);
    toast('Erro ao salvar atividade: ' + err.message, 'error');
  }
}

/* ============================================
   LEAD MODAL · HISTÓRICO DE ATIVIDADES
   ============================================ */
async function loadLeadActivities(leadId) {
  const container = $('#leadActivitiesTimeline');
  if (!container || !leadId) return;

  try {
    const { data, error } = await _supabase
      .from('lead_activities')
      .select('id, lead_id, user_id, activity_type, description, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML = '<div class="lead-timeline-empty">Nenhuma atividade registrada.</div>';
      return;
    }

    // Buscar nomes dos membros em lote
    const userIds = [...new Set(data.map(a => a.user_id).filter(Boolean))];
    let memberMap = {};
    if (userIds.length > 0) {
      const { data: members } = await _supabase
        .from('membros')
        .select('id, nome')
        .in('id', userIds);
      if (members) {
        members.forEach(m => { memberMap[m.id] = m.nome; });
      }
    }

    const typeDotMap = {
      'Anotação': 'dot-anotacao',
      'Ligação': 'dot-ligacao',
      'Visita': 'dot-visita',
      'WhatsApp': 'dot-whatsapp',
      'Pré-vendas': 'dot-prevendas',
      'Gerencial': 'dot-gerencial'
    };

    container.innerHTML = data.map(a => {
      const date = new Date(a.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const userName = memberMap[a.user_id] || 'Usuário';
      const dotClass = typeDotMap[a.activity_type] || 'dot-anotacao';

      return `
        <div class="lead-timeline-item">
          <div class="lead-timeline-dot ${dotClass}"></div>
          <div class="lead-timeline-body">
            <div class="lead-timeline-header">
              <span class="lead-timeline-title">${escapeHtml(a.activity_type)}</span>
              <span class="lead-timeline-date">${date}</span>
            </div>
            <div class="lead-timeline-desc">Registrado por: <strong>${escapeHtml(userName)}</strong></div>
            <div class="lead-timeline-desc">${escapeHtml(a.description)}</div>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    console.error('[Lead] Erro ao carregar atividades:', err);
    container.innerHTML = '<div class="lead-timeline-empty">Erro ao carregar atividades.</div>';
  }
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

  // Limpar CPF/CNPJ: tratar máscara vazia ou só zeros como vazio
  if (fields.cpf) {
    const cpfDigits = fields.cpf.replace(/\D/g, '');
    if (cpfDigits.length === 0 || /^0+$/.test(cpfDigits)) fields.cpf = '';
  }
  if (fields.cnpj) {
    const cnpjDigits = fields.cnpj.replace(/\D/g, '');
    if (cnpjDigits.length === 0 || /^0+$/.test(cnpjDigits)) fields.cnpj = '';
  }

  // Validação (alinhada aos campos do formulário)
  const errors = {};
  if (!fields.empresa) errors.empresa = 'Obrigatório';
  if (!fields.telefone) errors.telefone = 'Obrigatório';
  else if (!validarTelefone(fields.telefone)) errors.telefone = 'Telefone inválido';

  if (!fields.empresaId) errors.empresaId = 'Selecione uma empresa';
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
      cnpj: fields.cnpj || '',
      telefone: fields.telefone,
      cpf: fields.cpf || '',
      email: fields.email || '',
      responsavel: currentUser.nome || 'Sem atendente',
      _ownerId: currentUser.id || null,
      _membroId: null,
      _centroCustoId: fields.empresaId || null,
      status: getFirstCadenciaId(),
      thermal: fields.thermal || 'frio',
      honorarios: fields.honorarios,
      servicos: [],
      dataEvento: fields.dataEvento,
      tiposServico: fields.tiposServico,
      _tipoServicoIds: fields.tiposServico.map(name => _servicosByName[name]?.id).filter(Boolean),
      _cadenciaId: getFirstCadenciaId(),
      enderecoEvento: fields.enderecoEvento || '',
      enderecoResidencial: fields.enderecoResidencial || '',
      bairro: fields.bairro || '',
      cidade: fields.cidade || '',
      estado: fields.estado || '',
      cep: fields.cep || '',
      quantidadeHoras: fields.quantidadeHoras,
      horaFinal: fields.horaFinal || '',
      horaInicio: fields.horaInicio || '',
      servicosSelecionados: (fields.tiposServico || []).join(', '),
      segmento: '',
      tipoEmpresa: '',
      regime: '',
      tipoCliente: '',
      tipoContrato: '',
      statusCliente: 'Prospect',
      statusServico: 'Pendente',
      statusHonorarios: 'Pendente',
      origem: fields.origem || 'Manual',
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
        hora_inicio: fields.horaInicio || null,
        hora_final: fields.horaFinal || null,
        endereco_evento: fields.enderecoEvento || '',
        endereco_residencial: fields.enderecoResidencial || '',
        bairro: fields.bairro || '',
        cidade: fields.cidade || '',
        estado: fields.estado || '',
        cep: fields.cep || '',
        quantidade_horas: fields.quantidadeHoras || 0,
        servicos_selecionados: (fields.tiposServico || []).join(', ') || null,
        temperatura: fields.thermal || 'frio',
        honorarios: fields.honorarios,
        observacoes: fields.observacoes || '',
        tipo_servico_id: newLead._tipoServicoIds.length > 0 ? newLead._tipoServicoIds : null,
        cadencia_id: newLead._cadenciaId || null,
        owner_id: currentUser.id,
        centro_custo_id: fields.empresaId || null,
        cpf: fields.cpf || '',
        cnpj: fields.cnpj || '',
        email: fields.email || '',
        origem: fields.origem || 'Manual'
      });
      if (result && result[0] && result[0].id) {
        newLead.id = result[0].id;
        currentLeadId = result[0].id;
      }
      toast('Lead criado: ' + newLead.empresa);
      if (typeof registrarAuditoria === 'function') {
        registrarAuditoria({ acao: 'Inclusões', caminho_url: '/crm', modulo: 'CRM' });
      }
    } catch (err) {
      console.error('[Insert] Erro completo:', err);
      const errMsg = err.message || String(err);
      toast('Erro ao salvar: ' + errMsg, 'error');
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

    // Registrar movimentações automáticas (temperatura e cadência)
    if (lead.id) {
      try {
        // Temperatura alterada
        if (fields.thermal && lead._prevThermal && fields.thermal !== lead._prevThermal) {
          await insertMovement({
            lead_id: lead.id,
            user_id: currentUser.id || null,
            movement_type: 'temperatura',
            from_value: lead._prevThermal,
            to_value: fields.thermal
          });
        }
        // Cadência (status) alterada
        if (fields.status && lead._prevStatus && fields.status !== lead._prevStatus) {
          await insertMovement({
            lead_id: lead.id,
            user_id: currentUser.id || null,
            movement_type: 'cadencia',
            from_value: lead._prevStatus,
            to_value: fields.status
          });
        }
      } catch (e) {
        console.error('[Lead] Erro ao registrar movimentação:', e);
      }
    }

    // Atualizar no Supabase
    try {
      const payload = {
        nome: fields.empresa,
        telefone: fields.telefone,
        data_evento: fields.dataEvento || null,
        hora_inicio: fields.horaInicio || null,
        hora_final: fields.horaFinal || null,
        endereco_evento: fields.enderecoEvento || '',
        endereco_residencial: fields.enderecoResidencial || '',
        bairro: fields.bairro || '',
        cidade: fields.cidade || '',
        estado: fields.estado || '',
        cep: fields.cep || '',
        quantidade_horas: fields.quantidadeHoras || 0,
        servicos_selecionados: (fields.tiposServico || []).join(', ') || null,
        temperatura: fields.thermal || 'frio',
        honorarios: fields.honorarios,
        observacoes: fields.observacoes || '',
        cpf: fields.cpf || '',
        cnpj: fields.cnpj || '',
        email: fields.email || '',
        origem: fields.origem || 'Manual'
      };

      if (fields.tiposServico) {
        const ids = fields.tiposServico.map(name => _servicosByName[name]?.id).filter(Boolean);
        if (ids.length > 0) payload.tipo_servico_id = ids;
      }

      const cadUuid = lead.status || lead._cadenciaId;
      if (cadUuid) payload.cadencia_id = cadUuid;

      console.log('[Edit] Payload para Supabase:', JSON.stringify(payload, null, 2));
      console.log('[Edit] tipo_servico_id type:', typeof payload.tipo_servico_id, Array.isArray(payload.tipo_servico_id), payload.tipo_servico_id);
      console.log('[Edit] cadencia_id type:', typeof payload.cadencia_id, payload.cadencia_id);

      await updateLeadSupabase(lead.id, payload);
      toast('Lead atualizado: ' + lead.empresa);
      if (typeof registrarAuditoria === 'function') {
        registrarAuditoria({ acao: 'Atualizações', caminho_url: '/crm', modulo: 'CRM' });
      }
    } catch (err) {
      console.error('[Edit] Erro completo:', err);
      const errMsg = err.message || String(err);
      toast('Erro ao salvar: ' + errMsg, 'error');
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
let toastExitTimer = null;

function toast(text, type = 'success') {
    const el = document.querySelector('#toast');
    const txt = document.querySelector('#toastText');

    if (!el || !txt) return;

    clearTimeout(toastTimer);
    clearTimeout(toastExitTimer);

    el.style.transition = 'none';
    el.style.opacity = '1';
    el.style.transform = 'scale(1) translateY(0)';
    el.style.filter = 'none';
    el.style.display = 'flex';
    el.hidden = false;

    txt.textContent = text;
    el.dataset.type = type;

    void el.offsetWidth;

    toastTimer = setTimeout(() => {
        el.style.transition = 'all 700ms ease-in-out';
        el.style.opacity = '0';
        el.style.transform = 'scale(0.9) translateY(16px)';
        el.style.filter = 'blur(4px)';

        toastExitTimer = setTimeout(() => {
            el.style.display = 'none';
            el.hidden = true;
        }, 700);
    }, 3000);
}

/* ============================================
   NOTIFICAÇÕES · Bell badge + dropdown + Realtime
   ============================================ */

/* ── Audio unlock (autoplay policy) ── */
let _audioCtx = null;
(function _unlockAudioOnFirstClick() {
  document.addEventListener('click', function unlock() {
    try {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (_audioCtx.state === 'suspended') _audioCtx.resume();
    } catch (e) { /* ignore */ }
    document.removeEventListener('click', unlock);
  }, { once: true });
})();

function _tocarSom() {
  if (!_audioCtx) return;
  try {
    const osc1 = _audioCtx.createOscillator();
    const gain1 = _audioCtx.createGain();
    osc1.connect(gain1);
    gain1.connect(_audioCtx.destination);
    osc1.frequency.value = 880;
    gain1.gain.value = 0.3;
    osc1.start();
    osc1.stop(_audioCtx.currentTime + 0.25);
    setTimeout(() => {
      const osc2 = _audioCtx.createOscillator();
      const gain2 = _audioCtx.createGain();
      osc2.connect(gain2);
      gain2.connect(_audioCtx.destination);
      osc2.frequency.value = 1100;
      gain2.gain.value = 0.3;
      osc2.start();
      osc2.stop(_audioCtx.currentTime + 0.25);
    }, 150);
  } catch (e) { /* ignore */ }
}

/* ── Anti-duplicação Realtime ── */
const _notifProcessedMessages = new Set();
function _notifWasProcessed(id) {
  if (_notifProcessedMessages.has(id)) return true;
  _notifProcessedMessages.add(id);
  setTimeout(() => _notifProcessedMessages.delete(id), 30000);
  return false;
}

/* ── Notificações storage ── */
function _getNotifications() {
  try { return JSON.parse(localStorage.getItem('blue_notifications') || '[]'); } catch { return []; }
}
function _saveNotifications(list) {
  localStorage.setItem('blue_notifications', JSON.stringify(list));
}
function _updateNotifDot() {
  const dot = $('#notifDot');
  const list = _getNotifications();
  const unread = list.filter(n => !n.read).length;
  if (dot) {
    dot.hidden = unread === 0;
    dot.textContent = unread > 99 ? '99+' : (unread > 0 ? String(unread) : '');
  }
}

/* ── Adicionar notificação ── */
function addNotification(opts) {
  const notif = {
    id: 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    type: opts.type || 'lead',
    title: opts.title || '',
    subtitle: opts.subtitle || '',
    time: Date.now(),
    read: false,
    data: opts.data || {}
  };
  const list = _getNotifications();
  list.unshift(notif);
  if (list.length > 50) list.length = 50;
  _saveNotifications(list);
  _updateNotifDot();
  _renderNotifList();
  _tocarSom();
}

/* ── Renderizar lista do dropdown ── */
function _renderNotifList() {
  const listEl = $('#notifList');
  const emptyEl = $('#notifEmpty');
  if (!listEl) return;
  const list = _getNotifications();
  const unread = list.filter(n => !n.read);
  if (unread.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  listEl.innerHTML = unread.slice(0, 30).map(n => {
    const iconCls = n.type === 'message' ? 'message' : 'lead';
    const iconName = n.type === 'message' ? 'message-circle' : 'user-plus';
    const elapsed = _notifTimeAgo(n.time);
    return `
      <div class="notif-item unread" data-notif-id="${n.id}" data-type="${n.type}">
        <div class="notif-item-icon ${iconCls}"><i data-lucide="${iconName}"></i></div>
        <div class="notif-item-body">
          <strong>${escapeHtml(n.title)}</strong>
          <span>${escapeHtml(n.subtitle)}</span>
          <small>${elapsed}</small>
        </div>
      </div>`;
  }).join('');
  initIcons();
}
function _notifTimeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`;
  return `há ${Math.floor(diff / 86400)}d`;
}

/* ── Click handlers do dropdown ── */
function _initNotifDropdown() {
  const bellBtn = $('#notifBellBtn');
  const dropdown = $('#notifDropdown');
  const clearBtn = $('#notifClearAll');

  if (bellBtn && dropdown) {
    bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
      if (dropdown.classList.contains('open')) {
        _renderNotifList();
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (dropdown && !dropdown.contains(e.target) && e.target !== bellBtn && !bellBtn?.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const list = _getNotifications().map(n => ({ ...n, read: true }));
      _saveNotifications(list);
      _updateNotifDot();
      _renderNotifList();
    });
  }

  const listEl = $('#notifList');
  if (listEl) {
    listEl.addEventListener('click', (e) => {
      const item = e.target.closest('.notif-item');
      if (!item) return;
      const notifId = item.dataset.notifId;
      const type = item.dataset.type;
      const list = _getNotifications();
      const notif = list.find(n => n.id === notifId);
      if (notif) {
        notif.read = true;
        _saveNotifications(list);
        _updateNotifDot();
      }
      dropdown?.classList.remove('open');
      if (type === 'lead' && notif?.data?.leadId) {
        setActivePage('crm');
        setTimeout(() => { if (typeof openLeadModal === 'function') openLeadModal(notif.data.leadId); }, 200);
      } else if (type === 'message' && notif?.data?.conversationId) {
        _pendingConvNavigation = {
          phone: notif.data.phone || '',
          leadId: notif.data.leadId || null,
          leadName: notif.data.leadName || '',
          centroCustoId: notif.data.centroCustoId || null,
          conversationId: notif.data.conversationId || null
        };
        setActivePage('conversas');
      }
    });
  }

  _updateNotifDot();
  _renderNotifList();
}

/* ── Toast popup de notificação ── */
function _showNotifToast(title, subtitle, type, data) {
  const existing = document.querySelector('.notif-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'notif-toast';
  const iconName = type === 'message' ? 'message-circle' : 'user-plus';
  toast.innerHTML = `<div class="notif-toast-icon"><i data-lucide="${iconName}"></i></div><div class="notif-toast-body"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span></div>`;
  document.body.appendChild(toast);
  initIcons();
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 5000);
  toast.addEventListener('click', () => {
    toast.remove();
    if (type === 'message' && data?.conversationId) {
      _pendingConvNavigation = {
        phone: data.phone || '',
        leadId: data.leadId || null,
        leadName: data.leadName || '',
        centroCustoId: data.centroCustoId || null,
        conversationId: data.conversationId || null
      };
      setActivePage('conversas');
    } else if (type === 'lead' && data?.leadId) {
      setActivePage('crm');
      setTimeout(() => { if (typeof openLeadModal === 'function') openLeadModal(data.leadId); }, 200);
    }
  });
}

/* ── Canal Realtime de notificações ── */
let _notifRealtimeChannel = null;
function _subscribeNotificacoesRealtime() {
  if (_notifRealtimeChannel) _supabase.removeChannel(_notifRealtimeChannel);

  // Filtrar notificações por empresa/usuário do usuário logado
  const userCCIds = (currentUser?.centro_custo_ids || []).filter(Boolean);
  const userMembroId = currentUser?.id || null;
  const isAdmin = isCurrentUserAdmin();
  
  // Log para debug
  console.log('[Notif] Subscribing with:', { userCCIds, userMembroId, isAdmin, perfil: currentUser?.perfil });
  
  // Helper para verificar se deve notificar (LEADS)
  // REGRA DE NEGÓCIO:
  // TODOS (admin e atendente): Isolamento rigoroso
  //   - Dono do lead (membro_id === user.id) -> NOTIFICA
  //   - Órfão (membro_id === null) -> NOTIFICA (triagem)
  //   - De outro atendente -> NÃO NOTIFICA
  const shouldNotifyLead = (lead) => {
    const leadCCId = lead.centro_custo_id;
    const leadMembroId = lead.membro_id;
    
    // Lead COM centro_custo_id: verifica se está nas empresas do usuário
    if (leadCCId && !userCCIds.includes(leadCCId)) {
      return false; // Empresa fora do escopo
    }
    
    // Dono do lead
    if (leadMembroId && leadMembroId === userMembroId) {
      return true;
    }
    
    // Órfão (sem dono) -> triagem
    if (leadMembroId === null) {
      return true;
    }
    
    // De outro atendente -> NÃO NOTIFICA
    return false;
  };
  
  // Helper para verificar se deve notificar (MENSAGENS)
  // REGRA DE NEGÓCIO:
  // TODOS (admin e atendente): Isolamento rigoroso
  //   - Dono da conversa (membro_id === user.id) -> NOTIFICA
  //   - Órfã (membro_id === null) -> NOTIFICA (triagem)
  //   - De outro atendente -> NÃO NOTIFICA
  const shouldNotifyMessage = async (msg) => {
    const { data: conv } = await _supabase
      .from('conversations')
      .select('centros_custo_id, membro_id')
      .eq('id', msg.conversation_id)
      .maybeSingle();
    
    if (!conv) return false;
    
    const convCCId = conv.centros_custo_id;
    const convMembroId = conv.membro_id;
    
    // 1. FILTRO DE EMPRESA: deve pertencer a uma das empresas do usuário
    if (convCCId && !userCCIds.includes(convCCId)) {
      return false; // Empresa fora do escopo
    }
    
    // 2. Isolamento rigoroso (admin e atendente seguem a mesma regra)
    // Dono da conversa
    if (convMembroId && convMembroId === userMembroId) {
      return true;
    }
    
    // Órfã (sem dono) -> triagem
    if (convMembroId === null) {
      return true;
    }
    
    // De outro atendente -> NÃO NOTIFICA
    return false;
  };

  console.log('[REALTIME] Inscrito no canal global-notifications (com filtro por usuário)...');
  _notifRealtimeChannel = _supabase
    .channel('global-notifications')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'leads'
    }, async payload => {
      const lead = payload.new;
      
      // FILTRO: só notificar se lead pertence à empresa do usuário ou é atribuído a ele
      if (!shouldNotifyLead(lead)) {
        console.log('[REALTIME] Lead ignorado (fora do escopo):', lead.id);
        return;
      }
      
      const leadName = lead.nome || lead.empresa || 'Novo lead';
      let ccName = 'CRM';
      if (lead.centro_custo_id) {
        const { data: cc } = await _supabase.from('centros_custo').select('nome').eq('id', lead.centro_custo_id).maybeSingle();
        if (cc?.nome) ccName = cc.nome;
      }
      const leadData = { leadId: lead.id, centroCustoId: lead.centro_custo_id || null };
      addNotification({
        type: 'lead',
        title: `Novo lead: ${leadName}`,
        subtitle: ccName,
        data: leadData
      });
      _showNotifToast(`Novo lead: ${leadName}`, ccName, 'lead', leadData);
    })
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages'
    }, async payload => {
      console.log('[REALTIME] Nova mensagem recebida:', payload);
      const msg = payload.new;
      if (msg.sender_type !== 'contact') {
        console.log('[REALTIME] Ignorado: sender_type =', msg.sender_type);
        return;
      }
      if (_notifWasProcessed(msg.id)) {
        console.log('[REALTIME] Ignorado: duplicado id =', msg.id);
        return;
      }

      // FILTRO: só notificar se mensagem pertence à empresa do usuário ou é atribuída a ele
      const notify = await shouldNotifyMessage(msg);
      if (!notify) {
        console.log('[REALTIME] Mensagem ignorada (fora do escopo):', msg.id);
        return;
      }

      let leadName = 'Contato';
      let phone = '';
      let centroCustoId = null;
      let conversationId = msg.conversation_id;

      const { data: conv, error: convErr } = await _supabase
        .from('conversations')
        .select('lead_id, contact_id, centros_custo_id')
        .eq('id', msg.conversation_id)
        .maybeSingle();

      if (convErr) console.error('[REALTIME] Erro ao buscar conversa:', convErr);

      if (conv) {
        centroCustoId = conv.centros_custo_id || null;
        if (conv.lead_id) {
          const { data: lead } = await _supabase
            .from('leads')
            .select('nome, telefone')
            .eq('id', conv.lead_id)
            .maybeSingle();
          if (lead) { leadName = lead.nome || leadName; phone = lead.telefone || ''; }
        } else if (conv.contact_id) {
          const { data: contact } = await _supabase
            .from('contacts')
            .select('name, phone')
            .eq('id', conv.contact_id)
            .maybeSingle();
          if (contact) { leadName = contact.name || contact.phone || leadName; phone = contact.phone || ''; }
        }
      }

      let ccName = '';
      if (centroCustoId) {
        const { data: cc } = await _supabase
          .from('centros_custo').select('nome').eq('id', centroCustoId).maybeSingle();
        if (cc?.nome) ccName = cc.nome;
      }

      const text = (msg.content_text || '').slice(0, 60);
      const subtitle = (ccName ? ccName + ' · ' : '') + (text || 'Mensagem recebida');
      const msgData = { conversationId, phone, leadName, centroCustoId, leadId: conv?.lead_id || null };

      console.log('[REALTIME] Disparando notificação:', { leadName, subtitle, msgData });
      addNotification({
        type: 'message',
        title: leadName,
        subtitle,
        data: msgData
      });
      _showNotifToast(leadName, subtitle, 'message', msgData);
      console.log('[REALTIME] Notificação disparada com sucesso');
    })
    .subscribe((status, err) => {
      console.log('[REALTIME STATUS] Global notifications:', status, err || '');
      if (status === 'SUBSCRIBED') {
        console.log('[REALTIME] ✅ Canal global-notifications conectado — escutando leads e messages (filtrado por usuário)');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[REALTIME] ❌ Falha no canal global-notifications:', status, err);
        setTimeout(() => _subscribeNotificacoesRealtime(), 5000);
      }
    });
}

/* ── Buscar não-lidas existentes no boot ── */
async function _loadUnreadCount() {
  try {
    if (!_supabase || !currentUser?.id) return;
    
    const isAdmin = isCurrentUserAdmin();
    const userCCIds = (currentUser?.centro_custo_ids || []).filter(Boolean);
    const userMembroId = currentUser?.id || null;
    
    console.log('[Notif] Loading unread count:', { userCCIds, userMembroId, isAdmin, perfil: currentUser?.perfil });
    
    // Buscar conversas do usuário — isolamento total
    let query = _supabase
      .from('conversations')
      .select('id, unread_count, lead_id, contact_id, centros_custo_id, membro_id')
      .eq('status', 'open')
      .gt('unread_count', 0)
      .eq('membro_id', userMembroId);
    
    const { data, error } = await query;
    if (error) { console.error('[Notif] Erro ao buscar não-lidas:', error.message); return; }
    
    // Client-side filter: isolamento total
    let filteredData = (data || []).filter(conv => {
      return conv.membro_id === userMembroId;
    });
    
    const totalUnread = filteredData.reduce((sum, c) => sum + (c.unread_count || 0), 0);
    if (totalUnread > 0) {
      const list = _getNotifications();
      const existingIds = new Set(list.map(n => n.data?.conversationId));
      for (const conv of filteredData) {
        if (existingIds.has(conv.id)) continue;
        let leadName = 'Contato';
        let ccName = '';
        if (conv.lead_id) {
          const { data: lead } = await _supabase
            .from('leads').select('nome').eq('id', conv.lead_id).maybeSingle();
          if (lead?.nome) leadName = lead.nome;
        } else if (conv.contact_id) {
          const { data: contact } = await _supabase
            .from('contacts').select('name').eq('id', conv.contact_id).maybeSingle();
          if (contact?.name) leadName = contact.name;
        }
        if (conv.centros_custo_id) {
          const { data: cc } = await _supabase
            .from('centros_custo').select('nome').eq('id', conv.centros_custo_id).maybeSingle();
          if (cc?.nome) ccName = cc.nome;
        }
        const unread = conv.unread_count || 0;
        list.unshift({
          id: 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          type: 'message',
          title: leadName,
          subtitle: (ccName ? ccName + ' · ' : '') + unread + ' mensagem' + (unread > 1 ? 's' : '') + ' não lida' + (unread > 1 ? 's' : ''),
          time: Date.now(),
          read: false,
          data: { conversationId: conv.id, leadId: conv.lead_id || null, centroCustoId: conv.centros_custo_id || null }
        });
      }
      if (list.length > 50) list.length = 50;
      _saveNotifications(list);
    }
    _updateNotifDot();
    _renderNotifList();
  } catch (e) {
    console.error('[Notif] Erro ao carregar não-lidas:', e);
  }
}

/* ── Init notificações (chamado no boot) ── */
let _notifPollInterval = null;
function initNotifications() {
  _initNotifDropdown();
  _subscribeNotificacoesRealtime();
  _loadUnreadCount();
  // Fallback: polling a cada 30s para detectar mensagens não-lidas (Realtime pode falhar)
  if (_notifPollInterval) clearInterval(_notifPollInterval);
  _notifPollInterval = setInterval(() => {
    if (currentUser?.id) _loadUnreadCount();
  }, 30000);
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
  if (search) {
    search.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => { leadSearchQuery = search.value; renderAll(); }, 180);
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(searchTimeout);
        leadSearchQuery = search.value;
        renderAll();
      }
    });
  }

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
    if (e.key === 'Escape' && drillDownOpen) closeDrillDown();
  });

  // Drill-down modal: fechar
  const ddOverlay = document.getElementById('drillDownOverlay');
  const ddCloseBtn = document.getElementById('drillDownClose');
  if (ddOverlay) ddOverlay.addEventListener('click', closeDrillDown);
  if (ddCloseBtn) ddCloseBtn.addEventListener('click', closeDrillDown);

  // Salvar
  $('#leadSaveBtn').addEventListener('click', saveLead);

  // Back to edit
  $$('#leadModal [data-action="back-to-edit"]').forEach(b =>
    b.addEventListener('click', () => switchLeadTab('edit')));
  $$('#leadModal [data-action="whatsapp"]').forEach(b =>
    b.addEventListener('click', () => {
      const lead = leads.find(l => String(l.id) === String(currentLeadId));
      if (!lead) return;

      const phone = (lead.telefone || '').replace(/\D/g, '');
      if (!phone) {
        toast('Este lead não possui um número de telefone cadastrado.', 'error');
        return;
      }

      // Salvar dados para deep-link na tela de Conversas
      _pendingConvNavigation = {
        phone,
        leadId: lead.id,
        leadName: lead.empresa || '',
        centroCustoId: lead._centroCustoId || null
      };

      closeLeadModal();
      setActivePage('conversas');
    }));

  // Transferência (admin)
  $$('#leadModal [data-action="transfer"]').forEach(b =>
    b.addEventListener('click', () => switchLeadTab('transfer')));
  const transferBtnEl = $('#leadTransferBtn');
  if (transferBtnEl) transferBtnEl.addEventListener('click', transferLead);

  // Novas abas: Movimentação, Anotação, Atividades
  $$('#leadModal [data-action="movimentacao"]').forEach(b =>
    b.addEventListener('click', () => {
      switchLeadTab('movimentacao');
      loadLeadMovements(currentLeadId);
    }));
  $$('#leadModal [data-action="nova-annotacao"]').forEach(b =>
    b.addEventListener('click', () => switchLeadTab('nova-annotacao')));
  $$('#leadModal [data-action="atividades"]').forEach(b =>
    b.addEventListener('click', () => {
      switchLeadTab('atividades');
      loadLeadActivities(currentLeadId);
    }));

  // Salvar atividade
  const activitySaveBtn = $('#leadActivitySaveBtn');
  if (activitySaveBtn) activitySaveBtn.addEventListener('click', saveLeadActivity);

  // Inicial: esconder journey arrows errados
  renderAll();
}

/* ============================================
   DASHBOARD · ANALYTICS v1.4
   ============================================ */

// ----- Constantes de status / cadência / temperatura
const STATUS_CATEGORY = {
  'novo-lead': 'pendente',
  'dados-ia': 'pendente',
  'coletados-frio': 'pendente',
  'geladeira': 'pendente',
  'stand-by': 'pendente',
  'qualificado': 'andamento',
  'em-atendimento': 'andamento',
  'diagnostico-gratis': 'andamento',
  'reuniao-agendada': 'andamento',
  'reuniao-realizada': 'andamento',
  'contrato-fechado': 'andamento',
  'cobranca-enviada': 'andamento',
  'pagamento-recebido': 'andamento',
  'servico-executado': 'andamento',
  'pos-vendas': 'finalizado'
};

// Normaliza a origem do lead para as 4 categorias fixas
const ORIGIN_MAP = {
  'Indicação': 'Indicação de Cliente',
  'Indicação de Cliente': 'Indicação de Cliente',
  'Google Ads': 'Anúncio Pago',
  'Facebook Ads': 'Anúncio Pago',
  'Instagram Ads': 'Anúncio Pago',
  'LinkedIn Ads': 'Anúncio Pago',
  'Anúncio Pago': 'Anúncio Pago',
  'Ação de Rua': 'Ação de Rua',
  'Acao de Rua': 'Ação de Rua',
  'Oferta Ativa': 'Oferta Ativa',
  'LinkedIn': 'Oferta Ativa',
  'Instagram': 'Oferta Ativa',
  'Site': 'Oferta Ativa',
  'Orgânico': 'Oferta Ativa',
  'Outro': 'Oferta Ativa'
};
const ORIGENS_FIXAS = ['Indicação de Cliente', 'Anúncio Pago', 'Ação de Rua', 'Oferta Ativa', 'Não informada'];
const ORIGEM_COLOR = {
  'Indicação de Cliente': '#165BFF',
  'Anúncio Pago': '#F59E0B',
  'Ação de Rua': '#10B981',
  'Oferta Ativa': '#A855F7',
  'Não informada': '#94A3B8'
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

// ----- Drill-down state
let drillDownOpen = false;
let drillDownFilter = null; // { tipo: 'status'|'origem'|'thermal', valor: string, leads: Lead[] }

function openDrillDown(tipo, valor, leads) {
  drillDownFilter = { tipo, valor, leads };
  drillDownOpen = true;
  renderDrillDown();
  const overlay = document.getElementById('drillDownOverlay');
  const modal = document.getElementById('drillDownModal');
  if (overlay) overlay.classList.add('open');
  if (modal) modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDrillDown() {
  drillDownOpen = false;
  drillDownFilter = null;
  const overlay = document.getElementById('drillDownOverlay');
  const modal = document.getElementById('drillDownModal');
  if (overlay) overlay.classList.remove('open');
  if (modal) modal.classList.remove('open');
  document.body.style.overflow = '';
}

function renderDrillDown() {
  if (!drillDownFilter) return;
  const { tipo, valor, leads } = drillDownFilter;
  const titleEl = document.getElementById('drillDownTitle');
  const countEl = document.getElementById('drillDownCount');
  const tbody = document.getElementById('drillDownTableBody');
  const emptyEl = document.getElementById('drillDownEmpty');

  const tipoLabel = tipo === 'status' ? 'Status' : tipo === 'origem' ? 'Origem' : 'Temperatura';
  if (titleEl) titleEl.textContent = `Leads — ${tipoLabel}: ${valor}`;
  if (countEl) countEl.textContent = `${leads.length} lead${leads.length !== 1 ? 's' : ''}`;

  if (!leads.length) {
    if (tbody) tbody.innerHTML = '';
    if (emptyEl) emptyEl.hidden = false;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;

  if (tbody) {
    tbody.innerHTML = leads.map(l => `
      <tr class="lead-row-clickable" data-lead-id="${l.id}">
        <td><strong>${escapeHtml(l.empresa || '')}</strong></td>
        <td>${escapeHtml(l.telefone || '')}</td>
        <td>${escapeHtml(normalizeOrigin(l.origem))}</td>
        <td><span class="drill-thermal-tag ${l.thermal || 'frio'}">${escapeHtml(l.thermal || 'frio')}</span></td>
        <td><span class="drill-cadencia-tag">${escapeHtml(getCadenciaLabelById(l.status))}</span></td>
      </tr>
    `).join('');
  }
}

function handleDrillDownClick(tipo, valor, leads) {
  if (drillDownOpen) closeDrillDown();
  else openDrillDown(tipo, valor, leads);
}

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
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function formatBRShort(d) {
  if (!d) return '—';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function formatBRL(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)}h`;
  return `há ${Math.floor(s / 86400)}d`;
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
  const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  if (start.getTime() === end.getTime()) return fmt(start);
  return `${fmt(start)} — ${fmt(end)}`;
}

function getPeriodLabel() {
  const { start, end } = getPeriodRange();
  switch (dashState.period) {
    case 'today': return 'Hoje';
    case 'yesterday': return 'Ontem';
    case 'week': {
      const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      return `Semana (${dayNames[start.getDay()]} ${String(start.getDate()).padStart(2, '0')}/${String(start.getMonth() + 1).padStart(2, '0')} — ${dayNames[end.getDay()]} ${String(end.getDate()).padStart(2, '0')}/${String(end.getMonth() + 1).padStart(2, '0')})`;
    }
    case 'month': {
      const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      return `${monthNames[start.getMonth()]} ${start.getFullYear()}`;
    }
    case 'custom':
      return formatPeriodBadge(start, end);
    default:
      return formatPeriodBadge(start, end);
  }
}

function updateDashboardSubtitle() {
  const subtitleEl = document.getElementById('pageSubtitle');
  if (subtitleEl) subtitleEl.textContent = `Visão gerencial · ${getPeriodLabel()}`;
}

// ----- Categorização de leads
function getStatusCategory(status) {
  return STATUS_CATEGORY[status] || 'andamento';
}
function normalizeOrigin(orig) {
  if (!orig || !orig.trim()) return 'Não informada';
  return ORIGIN_MAP[orig.trim()] || 'Não informada';
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
    if (f.cadencia && l.status !== f.cadencia) return false;
    if (f.origem && normalizeOrigin(l.origem) !== f.origem) return false;
    if (f.thermal && l.thermal !== f.thermal) return false;
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
      total: { count: cur.total, var: variation(cur.total, prevM.total) },
      finalizado: { count: cur.finalizado, var: variation(cur.finalizado, prevM.finalizado) },
      andamento: { count: cur.andamento, var: variation(cur.andamento, prevM.andamento) },
      pendente: { count: cur.pendente, var: variation(cur.pendente, prevM.pendente) }
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
    frio: { count: map.frio.length, leads: map.frio, value: map.frio.reduce((s, l) => s + (l.honorarios || 0), 0) },
    morno: { count: map.morno.length, leads: map.morno, value: map.morno.reduce((s, l) => s + (l.honorarios || 0), 0) },
    quente: { count: map.quente.length, leads: map.quente, value: map.quente.reduce((s, l) => s + (l.honorarios || 0), 0) }
  };
}

function computeCadenceFunnel(leads) {
  const map = {};
  getDbCadencias().forEach(c => { map[c.id] = { id: c.id, label: c.nome, count: 0, value: 0, leads: [] }; });
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
  const honLeads = leads.filter(l => (l.status || '') !== null);
  const total = honLeads.reduce((s, l) => s + (l.honorarios || 0), 0);
  const byCadence = getVisibleCadences(currentCrmEmpresaFilter)
    .map(c => {
      const ls = honLeads.filter(l => l.status === c.id);
      return { id: c.id, label: c.label, value: ls.reduce((s, l) => s + (l.honorarios || 0), 0), count: ls.length };
    })
    .filter(x => x.value > 0)
    .sort((a, b) => b.value - a.value);
  const byTemp = ['quente', 'morno', 'frio']
    .map(t => {
      const ls = honLeads.filter(l => l.thermal === t);
      return { id: t, label: t[0].toUpperCase() + t.slice(1), value: ls.reduce((s, l) => s + (l.honorarios || 0), 0), count: ls.length };
    });
  return { total, byCadence, byTemp, count: honLeads.length, avg: honLeads.length ? total / honLeads.length : 0 };
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
  const c = getCadenciaById(status);
  return `<span class="dash-status-tag t-${status}">${escapeHtml(c ? c.nome : status)}</span>`;
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
    { key: 'total', label: 'Total de Lead', ico: 'users-round', tip: 'Total de leads no período' },
    { key: 'finalizado', label: 'Leads Finalizados', ico: 'check-circle-2', tip: 'Leads que chegaram ao pós-vendas' },
    { key: 'andamento', label: 'Leads Em Andamento', ico: 'loader', tip: 'Leads ativos em cadências intermediárias' },
    { key: 'pendente', label: 'Leads Pendentes', ico: 'alert-circle', tip: 'Aguardando primeiro atendimento' }
  ];
  wrap.innerHTML = cfg.map(c => {
    const data = m[c.key];
    return `
      <div class="metric-card${c.key === 'total' ? ' highlight' : ''}" data-tooltip="${c.tip}" data-tab-link="${c.key === 'finalizado' ? 'finalizados' : c.key === 'andamento' ? 'andamento' : c.key === 'pendente' ? 'pendentes' : 'total'}">
        <div class="metric-head">
          <span class="metric-label">${c.label}</span>
          <i data-lucide="${c.ico}" class="metric-ico"></i>
        </div>
        <h2 class="metric-value">${data.count}</h2>
        ${trendPill(data.var)}
        <div class="metric-bar"><span data-width="${Math.min(100, data.count * (c.key === 'total' ? 4 : 8))}%"></span></div>
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
      <td>${formatBRL(l.honorarios || 0)}</td>
      <td>${escapeHtml((l.createdAt || '').split(' ')[0])}</td>
      <td>${escapeHtml(l.lastTouch || '—')}</td>
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
      <td>${formatBRL(l.honorarios || 0)}</td>
      <td>${escapeHtml((l.createdAt || '').split(' ')[0])}</td>
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
      <td>${formatBRL(l.honorarios || 0)}</td>
      <td>${escapeHtml(l.lastTouch || '—')}</td>
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
      <td>${formatBRL(l.honorarios || 0)}</td>
      <td>${escapeHtml(l.lastTouch || '—')}</td>
    </tr>`).join('');
}
function renderTableReunioes(tbody, meetings) {
  if (!meetings.length) { tbody.closest('.card').querySelector('.table-wrap').innerHTML = emptyStateHtml('Nenhuma reunião no período'); return; }
  tbody.innerHTML = meetings.map(m => {
    const d = parseISODate(m.iso);
    const tagCls = m.type === 'reuniao' ? 'tag-blue' : m.type === 'fiscal' ? 'tag-amber' : m.type === 'financeiro' ? 'tag-green' : 'tag-purple';
    return `
      <tr data-meeting-id="${m.id}"${m.leadId ? ` data-lead-id="${m.leadId}"` : ''}>
        <td>${formatBRShort(d)}</td>
        <td>${escapeHtml(m.time || '—')}${m.duration ? ` <span style="color:var(--muted-text);font-size:11px">(${m.duration}min)</span>` : ''}</td>
        <td>${escapeHtml(m.cliente || '—')}</td>
        <td>${escapeHtml(m.empresa)}</td>
        <td>${escapeHtml(m.responsavel || '—')}</td>
        <td><span class="tag ${tagCls}">${meetingTypeLabel(m.type)}</span></td>
        <td>${m.lead ? `<button class="icon-btn small" data-action="open-lead" data-lead-id="${m.leadId}" title="Abrir lead"><i data-lucide="external-link"></i></button>` : ''}</td>
      </tr>`;
  }).join('');
}

// ----- Render: Top responsáveis / Motivos
function renderTopResponsaveis(leads) {
  const wrap = document.getElementById('dashTopResponsaveis');
  if (!wrap) return;
  const counts = {};
  leads.forEach(l => { counts[l.responsavel] = (counts[l.responsavel] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!top.length) { wrap.innerHTML = '<p class="empty-state" style="margin:0">Sem dados</p>'; return; }
  const max = top[0][1];
  wrap.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      ${top.map(([name, count], i) => `
        <div style="display:grid;grid-template-columns:24px 1fr 50px;align-items:center;gap:10px">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${['#165BFF', '#A855F7', '#10B981'][i]};color:#fff;font-size:11px;font-weight:600">${i + 1}</span>
          <div>
            <div style="font:500 13px 'Inter';color:var(--text-primary)">${escapeHtml(name)}</div>
            <div style="height:6px;background:var(--gray-200);border-radius:999px;overflow:hidden;margin-top:4px"><span style="display:block;height:100%;width:${(count / max) * 100}%;background:${['#165BFF', '#A855F7', '#10B981'][i]};border-radius:999px"></span></div>
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
  const list = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
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
  const sorted = [...funnel].sort((a, b) => sortBy === 'value' ? b.value - a.value : b.count - a.count);
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
              <td>${escapeHtml((l.createdAt || '').split(' ')[0])}</td>
              <td>${statusTag(l.status)}</td>
              <td>${formatBRL(l.honorarios || 0)}</td>
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
  const data = labels.map(l => origins[l]?.count || 0);
  const colors = labels.map(l => ORIGEM_COLOR[l]);
  const total = data.reduce((a, b) => a + b, 0);
  document.getElementById('dashOrigensTotal').innerHTML = `<strong>${total}</strong><span>leads</span>`;

  if (_origensChart) { _origensChart.destroy(); }
  _origensChart = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 3, borderColor: '#fff' }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0F172A', padding: 10, cornerRadius: 8, titleColor: '#fff', bodyColor: '#E2E8F0',
          callbacks: { label: c => `${c.label}: ${c.parsed} (${total ? Math.round(c.parsed / total * 100) : 0}%)` }
        }
      }
    }
  });
}
function renderOrigensLegend(origins) {
  const wrap = document.getElementById('dashOrigensLegend');
  if (!wrap) return;
  const total = Object.values(origins).reduce((s, o) => s + o.count, 0);
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
                <td>${formatBRL(l.honorarios || 0)}</td>
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
  ['frio', 'morno', 'quente'].forEach(t => {
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
                <td>${escapeHtml(l.lastTouch || '—')}</td>
                <td>${formatBRL(l.honorarios || 0)}</td>
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
  wrap.innerHTML = ['frio', 'morno', 'quente'].map(t => `
    <div class="temp-bar temp-bar-${t}" data-temp="${t}">
      <span class="temp-bar-name">${t[0].toUpperCase() + t.slice(1)}</span>
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
  document.getElementById('dashHonCadList').innerHTML = (hon.byCadence.length ? hon.byCadence : [{ id: '_', label: 'Sem dados', value: 0, count: 0 }])
    .map(x => `
      <li>
        <span class="hl-name">${escapeHtml(x.label)} <span style="color:var(--muted-text);font-weight:400">· ${x.count}</span></span>
        <span class="hl-value">${formatBRL(x.value)}</span>
        <span class="hl-bar"><span style="width:${(x.value / maxCad) * 100}%"></span></span>
      </li>`).join('');
  document.getElementById('dashHonTempList').innerHTML = hon.byTemp
    .map(x => `
      <li>
        <span class="hl-name"><span class="thermal-tag ${x.id}">${escapeHtml(x.label)}</span> <span style="color:var(--muted-text);font-weight:400;margin-left:6px">· ${x.count}</span></span>
        <span class="hl-value">${formatBRL(x.value)}</span>
        <span class="hl-bar"><span style="width:${(x.value / maxTemp) * 100}%;background:${TEMP_COLOR[x.id]}"></span></span>
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
  const today = new Date(); today.setHours(0, 0, 0, 0);
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
    .sort((a, b) => (a.iso + a.time).localeCompare(b.iso + b.time))
    .slice(0, 8);
  if (!items.length) { wrap.innerHTML = '<li class="empty-state"><i data-lucide="inbox"></i><p>Sem eventos próximos</p></li>'; if (window.initIcons) window.initIcons(); return; }
  wrap.innerHTML = items.map(m => {
    const d = parseISODate(m.iso);
    const tagCls = m.type === 'reuniao' ? 'tag-blue' : m.type === 'fiscal' ? 'tag-amber' : m.type === 'financeiro' ? 'tag-green' : 'tag-purple';
    const leadName = m.lead ? m.lead.nome : (m.cliente || '');
    const leadPhone = m.lead ? m.lead.telefone : (m.phone || '');
    return `
      <li class="event-item" data-meeting-id="${m.id}">
        <div class="event-date"><strong>${String(d.getDate()).padStart(2, '0')}</strong><span>${['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][d.getMonth()]}</span></div>
        <div class="event-bar" style="background:${meetingColor(m.type)}"></div>
        <div class="event-info">
          <p class="event-title">${escapeHtml(m.title)}</p>
          <p class="event-meta">${escapeHtml(m.time || '')}${leadName ? ' · ' + escapeHtml(leadName) : ''}${leadPhone ? ' · ' + escapeHtml(leadPhone) : ''}</p>
        </div>
        <span class="tag ${tagCls}">${meetingTypeLabel(m.type)}</span>
      </li>`;
  }).join('');
}

// ----- Render: Dashboard "Lembretes" widget (small, top 2)
function renderDashRemindersWidget() {
  const wrap = document.getElementById('dashRemindersWidget');
  if (!wrap) return;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const items = meetings
    .filter(m => m.type === 'reuniao' && parseISODate(m.iso) >= today)
    .sort((a, b) => (a.iso + a.time).localeCompare(b.iso + b.time))
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
  set('dashTotalSub', `${payload.current.length} leads no período · ${fmt}`);
  set('dashFinSub', `${payload.metrics.finalizado.count} finalizados · ${fmt}`);
  set('dashAndSub', `${payload.metrics.andamento.count} em andamento · ${fmt}`);
  set('dashPenSub', `${payload.metrics.pendente.count} pendentes · ${fmt}`);
  set('dashReunSub', `Reuniões no período · ${fmt} <span style="opacity:0.7">· sync com Calendário</span>`);
  set('dashFunilSub', `Soma de leads e faturamento por cadência · ${fmt}`);
  set('dashOrigSub', `Distribuição por origem (4 fixas) · ${fmt}`);
  set('dashTempSub', `Frio · Morno · Quente · ${fmt}`);
  set('dashHonSub', `Soma de faturamento no período · ${fmt}`);
  set('dashTotalTrend', trendPill(payload.metrics.total.var));
  set('dashFinTrend', trendPill(payload.metrics.finalizado.var));
  set('dashAndTrend', trendPill(payload.metrics.andamento.var));
  set('dashPenTrend', trendPill(payload.metrics.pendente.var));
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
  const leadsAndamento = leads.filter(l => getStatusCategory(l.status) === 'andamento');
  const leadsPendentes = leads.filter(l => getStatusCategory(l.status) === 'pendente');

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
      origins: computeOrigins(metrics.current),
      temperatures: computeTemperatures(metrics.current),
      funnel: computeCadenceFunnel(metrics.current),
      reminders: computeReminders(filteredLeads),
      honorarios: computeHonorarios(metrics.current)
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
  updateDashboardSubtitle();
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
    rows = p.current.map(l => ({ Empresa: l.empresa, Cadência: getCadenciaLabelById(l.status), Temperatura: l.thermal, Origem: normalizeOrigin(l.origem), Responsável: l.responsavel, 'Valor de Faturamento': l.honorarios || 0, Entrada: (l.createdAt || '').split(' ')[0], 'Último contato': l.lastTouch || '' }));
  } else if (tabId === 'finalizados') {
    rows = p.current.filter(l => getStatusCategory(l.status) === 'finalizado').map(l => ({ Empresa: l.empresa, 'Cadência final': getCadenciaLabelById(l.status), Origem: normalizeOrigin(l.origem), Responsável: l.responsavel, 'Valor de Faturamento': l.honorarios || 0, 'Concluído em': (l.createdAt || '').split(' ')[0] }));
  } else if (tabId === 'andamento') {
    rows = p.current.filter(l => getStatusCategory(l.status) === 'andamento').map(l => ({ Empresa: l.empresa, 'Cadência atual': getCadenciaLabelById(l.status), Origem: normalizeOrigin(l.origem), Responsável: l.responsavel, 'Valor de Faturamento': l.honorarios || 0, 'Último contato': l.lastTouch || '' }));
  } else if (tabId === 'pendentes') {
    rows = p.current.filter(l => getStatusCategory(l.status) === 'pendente').map(l => ({ Empresa: l.empresa, Cadência: getCadenciaLabelById(l.status), Origem: normalizeOrigin(l.origem), Responsável: l.responsavel, 'Valor de Faturamento': l.honorarios || 0, 'Último contato': l.lastTouch || '' }));
  } else if (tabId === 'reunioes') {
    rows = p.reminders.map(m => ({ Dia: m.iso, Horário: m.time || '', Cliente: m.cliente || '', Empresa: m.empresa, Responsável: m.responsavel || '', Tipo: meetingTypeLabel(m.type) }));
  } else if (tabId === 'funil') {
    rows = p.funnel.flatMap(f => f.leads.map(l => ({ Cadência: f.label, Nome: l.responsavel || '', Empresa: l.empresa, 'Data de entrada': (l.createdAt || '').split(' ')[0], 'Status atual': getCadenciaLabelById(l.status), 'Valor de Faturamento': l.honorarios || 0 })));
  } else if (tabId === 'origens') {
    rows = [];
    ORIGENS_FIXAS.forEach(o => (p.origins[o]?.leads || []).forEach(l => rows.push({ Origem: o, Empresa: l.empresa, Cadência: getCadenciaLabelById(l.status), Responsável: l.responsavel, 'Valor de Faturamento': l.honorarios || 0 })));
  } else if (tabId === 'temperatura') {
    rows = [];
    ['frio', 'morno', 'quente'].forEach(t => (p.temperatures[t]?.leads || []).forEach(l => rows.push({ Temperatura: t, Empresa: l.empresa, Responsável: l.responsavel, 'Último contato': l.lastTouch || '', 'Valor de Faturamento': l.honorarios || 0 })));
  } else if (tabId === 'honorarios') {
    rows = p.current.filter(l => (l.honorarios || 0) > 0).map(l => ({ Empresa: l.empresa, Cadência: getCadenciaLabelById(l.status), Temperatura: l.thermal, Responsável: l.responsavel, 'Valor de Faturamento': l.honorarios }));
  }

  if (!rows.length) { alert('Nenhum dado para exportar neste painel.'); return; }
  filename = `blue-${tabId}-${formatBR(new Date()).replace(/\//g, '-')}`;

  if (format === 'csv') downloadCSV(filename + '.csv', rows);
  else if (format === 'xlsx') downloadXLSX(filename + '.xls', rows);
  else if (format === 'pdf') downloadPrintable(filename, rows, tabId);
}
function downloadCSV(name, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
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
    <tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${escapeHtml(String(r[c] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody>
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
        document.getElementById('dashStartDate').value = ago.toISOString().slice(0, 10);
        document.getElementById('dashEndDate').value = today.toISOString().slice(0, 10);
        dashState.startDate = ago.toISOString().slice(0, 10);
        dashState.endDate = today.toISOString().slice(0, 10);
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
  ['dashStartDate', 'dashEndDate'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      dashState.startDate = document.getElementById('dashStartDate').value;
      dashState.endDate = document.getElementById('dashEndDate').value;
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
  ['dashFilterResponsavel', 'dashFilterCadencia', 'dashFilterOrigem', 'dashFilterTemp'].forEach(id => {
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
    dashState.filters = { responsavel: '', cadencia: '', origem: '', thermal: '' };
    ['dashFilterResponsavel', 'dashFilterCadencia', 'dashFilterOrigem', 'dashFilterTemp'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
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
      if (meeting) toast(`Reunião: ${meeting.title} · ${meeting.iso} ${meeting.time || ''}`);
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
  const data = prompt('Data (AAAA-MM-DD):', new Date().toISOString().slice(0, 10));
  if (!data) return;
  const hora = prompt('Horário (HH:MM):', '10:00') || '10:00';
  const id = Math.max(...meetings.map(m => m.id), 0) + 1;
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
  const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
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
    timeEnd.value = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
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
  const dayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
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
      toast('Lead atualizado');
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
            toast('Evento atualizado');
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
        toast('Evento salvo');
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
      toast('Erro ao salvar: ' + (err.message || err), 'error');
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
      toast('Evento excluído');
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

  // "+X mais" counter → switch to day view
  const moreEl = e.target.closest('.cal-day-more');
  if (moreEl) {
    e.preventDefault();
    e.stopPropagation();
    const iso = moreEl.dataset.iso;
    if (iso) {
      calCurrentDate = new Date(iso + 'T12:00:00');
      setCalView('day');
    }
    return;
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
    } catch (e) { /* ignore */ }
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
      segBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
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
  updateDashboardSubtitle();

  // --- Drill-down: armazenar leads filtrados e bind click handlers ---
  const currentLeads = metrics.current;

  // KPI cards click
  const kpiTotal = document.querySelector('[data-kpi="total"]');
  const kpiFin = document.querySelector('[data-kpi="finalizados"]');
  const kpiAnd = document.querySelector('[data-kpi="andamento"]');
  const kpiPen = document.querySelector('[data-kpi="pendentes"]');
  if (kpiTotal) kpiTotal.onclick = () => openDrillDown('status', 'Total', currentLeads);
  if (kpiFin) kpiFin.onclick = () => openDrillDown('status', 'Finalizados', currentLeads.filter(l => getStatusCategory(l.status) === 'finalizado'));
  if (kpiAnd) kpiAnd.onclick = () => openDrillDown('status', 'Em Andamento', currentLeads.filter(l => getStatusCategory(l.status) === 'andamento'));
  if (kpiPen) kpiPen.onclick = () => openDrillDown('status', 'Pendentes', currentLeads.filter(l => getStatusCategory(l.status) === 'pendente'));

  // Origins legend click
  const originsData = computeOrigins(currentLeads);
  const origLegend = document.getElementById('originsLegend');
  if (origLegend) {
    origLegend.querySelectorAll('li').forEach(li => {
      li.style.cursor = 'pointer';
      li.onclick = () => {
        const origem = li.dataset.origem;
        if (origem && originsData[origem]) {
          openDrillDown('origem', origem, originsData[origem].leads);
        }
      };
    });
  }

  // Temperature rows click
  const tempData = computeTemperatures(currentLeads);
  const tempContainer = document.getElementById('tempContainer');
  if (tempContainer) {
    tempContainer.querySelectorAll('.temp-row').forEach((row, i) => {
      row.style.cursor = 'pointer';
      const tempKeys = ['quente', 'morno', 'frio'];
      const tempLabels = ['Quente', 'Morno', 'Frio'];
      row.onclick = () => {
        const key = tempKeys[i];
        if (key && tempData[key]) {
          openDrillDown('thermal', tempLabels[i], tempData[key].leads);
        }
      };
    });
  }
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
  const entries = Object.entries(originsMap).filter(([, v]) => v.count > 0).sort((a, b) => b[1].count - a[1].count);
  if (!entries.length) { canvas.style.display = 'none'; legend.innerHTML = '<li class="empty-state">Nenhum dado.</li>'; return; }
  canvas.style.display = '';
  const ctx = canvas.getContext('2d');
  const total = entries.reduce((s, [, v]) => s + v.count, 0);
  const fallbackColors = ['#165BFF', '#10b981', '#F0A500', '#a855f7', '#94A3B8'];
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentElement.offsetWidth - 40;
  canvas.width = w * dpr; canvas.height = 180 * dpr;
  canvas.style.width = w + 'px'; canvas.style.height = '180px';
  ctx.scale(dpr, dpr);
  const cx = w / 2, cy = 90, r = 70;
  let startAngle = -Math.PI / 2;
  entries.forEach(([k, v], i) => {
    const slice = (v.count / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, startAngle + slice);
    ctx.closePath(); ctx.fillStyle = ORIGEM_COLOR[k] || fallbackColors[i % fallbackColors.length]; ctx.fill();
    startAngle += slice;
  });
  ctx.beginPath(); ctx.arc(cx, cy, 38, 0, Math.PI * 2);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--card-bg').trim() || '#fff';
  ctx.fill();
  ctx.font = 'bold 18px Inter, sans-serif';
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#1F2D3D';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(total.toLocaleString('pt-BR'), cx, cy);
  legend.innerHTML = entries.map(([k, v], i) =>
    `<li><span class="dot" style="background:${ORIGEM_COLOR[k] || fallbackColors[i % fallbackColors.length]}"></span>${k}: ${v.count}</li>`
  ).join('');
}

function renderTemperatura(tempData) {
  const el = document.getElementById('tempContainer');
  if (!el) return;
  const total = tempData.quente.count + tempData.morno.count + tempData.frio.count;
  if (!total) { el.innerHTML = '<p class="empty-state">Nenhum dado no período.</p>'; return; }
  el.innerHTML = [
    { label: 'Quente', count: tempData.quente.count, cls: 'hot' },
    { label: 'Morno', count: tempData.morno.count, cls: 'warm' },
    { label: 'Frio', count: tempData.frio.count, cls: 'cold' }
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
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const leadName = m.lead ? m.lead.nome : (m.cliente || '');
    const leadPhone = m.lead ? m.lead.telefone : (m.phone || '');
    return `<div class="evento-item" data-meeting-id="${m.id}">
      <div class="evento-date">
        <strong>${String(d.getDate()).padStart(2, '0')}</strong>
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
  { nome: 'Home', chave: 'home' },
  { nome: 'Dashboard', chave: 'dashboard' },
  { nome: 'CRM', chave: 'crm' },
  { nome: 'Kanban', chave: 'kanban' },
  { nome: 'Cliente da Base', chave: 'clientes' },
  { nome: 'Calendário', chave: 'calendario' },
  { nome: 'Rotina Blue', chave: 'rotina' },
  { nome: 'Pomodoro', chave: 'pomodoro' },
  { nome: 'Conversas', chave: 'conversas' },
  { nome: 'Auditoria', chave: 'auditoria' },
  { nome: 'Configurações', chave: 'configuracoes' },
  { nome: 'Administrador', chave: 'administrador' },
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
      id: row.id,
      type: row.tipo || 'tarefa',
      column: row.status || 'cadencia',
      title: row.titulo || '',
      time: row.hora_tarefa || null,
      date: row.data_tarefa || null,
      assignees: [],
      pastel: row.cor || 'blue',
      done: (row.status === 'concluido'),
      desc: row.observacoes || '',
      fixado: row.fixado || false,
      _supabaseId: row.id,
      _membroId: row.membro_id || null,
      _membroNome: membroNome
    });
  });
  console.log('[Rotina] Rotinas carregadas:', rotinaItems.length);
}

let rotinaFilters = { tarefa: true, reuniao: true, prazo: true, concluido: true };
const rotinaTeam = {
  CS: { name: 'Camila Souza', initials: 'CS', color: 'avatar-blue' },
  RF: { name: 'Rafaela Ferreira', initials: 'RF', color: 'avatar-green' },
  JP: { name: 'João Pedro', initials: 'JP', color: 'avatar-amber' },
  MA: { name: 'Marina Alves', initials: 'MA', color: 'avatar-purple' }
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
          titulo: item.title,
          observacoes: item.desc,
          cor: item.pastel
        }).then(() => {
          toast('Alterações salvas');
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
        picker.min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
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
      titulo: t || 'Nota sem título',
      observacoes: d || '',
      status: 'cadencia',
      cor: rotinaSelectedColor,
      data_tarefa: rotinaScheduledDate || null,
      hora_tarefa: rotinaScheduledTime || null,
      tipo: newType,
      fixado: false,
      membro_id: currentUser.id || null
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
toast('Erro ao salvar: ' + (err.message || err), 'error');
        return;
      }

      if (insertSuccess) {
        const newItem = {
          id: payload.id,
          type: payload.tipo,
          column: payload.status,
          title: payload.titulo,
          time: payload.hora_tarefa,
          date: payload.data_tarefa,
          assignees: [],
          pastel: payload.cor,
          done: false,
          desc: payload.observacoes,
          fixado: payload.fixado,
          _supabaseId: payload._supabaseId || payload.id,
          _membroId: currentUser.id || null
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

function toggleTheme(event) {
  const isDark = document.documentElement.classList.contains('theme-dark');

  if (!document.startViewTransition) {
    document.documentElement.classList.toggle('theme-dark');
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
    updateThemeIcon(!isDark);
    return;
  }

  const x = event?.clientX ?? window.innerWidth / 2;
  const y = event?.clientY ?? window.innerHeight / 2;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );

  const transition = document.startViewTransition(() => {
    document.documentElement.classList.toggle('theme-dark');
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
    updateThemeIcon(!isDark);
  });

  transition.ready.then(() => {
    const clipPath = [
      `circle(0px at ${x}px ${y}px)`,
      `circle(${endRadius}px at ${x}px ${y}px)`
    ];

    document.documentElement.animate(
      { clipPath },
      {
        duration: 500,
        easing: 'ease-in-out',
        pseudoElement: '::view-transition-new(root)',
      }
    );
  });
}

/* ============================================
   POMODORO · GESTÃO DE TEMPO E FOCO
   ============================================ */

const POMO_MODES = {
  pomodoro: { label: 'Pomodoro', defaultMin: 25 },
  shortBreak: { label: 'Short Break', defaultMin: 5 },
  longBreak: { label: 'Long Break', defaultMin: 15 }
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
  } catch (e) { }
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
        id: row.id,
        user: row.usuario_nome,
        hash: row.usuario_id,
        action: row.acao,
        actionUrl: row.caminho_url,
        module: row.modulo,
        device: row.dispositivo,
        deviceIcon: (row.dispositivo || '').toLowerCase() === 'mobile' ? 'smartphone' : 'monitor',
        datetime: formatAuditDate(row.created_at)
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
  { name: 'Camila Souza', hash: 'CS-8a2f' },
  { name: 'Rafaela Ferreira', hash: 'RF-3b1c' },
  { name: 'João Pedro', hash: 'JP-7d4e' },
  { name: 'Marina Alves', hash: 'MA-9f6a' }
];
const auditMockActions = [
  { name: 'LOGIN', url: '/auth/login' },
  { name: 'VIEW_LEAD', url: '/crm' },
  { name: 'EDIT_LEAD', url: '/crm/edit' },
  { name: 'CREATE_LEAD', url: '/crm/new' },
  { name: 'VIEW_EVENT', url: '/calendario' },
  { name: 'VIEW_ROTINA', url: '/rotina' },
  { name: 'EDIT_ROTINA', url: '/rotina/edit' },
  { name: 'VIEW_DASH', url: '/dashboard' }
];
const auditMockModules = ['CRM', 'Clientes', 'Calendário', 'Rotina', 'Dashboard', 'Configurações'];
const auditMockDevices = [
  { type: 'desktop', icon: 'monitor', label: 'Desktop' },
  { type: 'mobile', icon: 'smartphone', label: 'Mobile' }
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
  { page: '/crm', tempoMedio: '4m 32s', visitas: 342, usuarios: 6, retorno: '68%' },
  { page: '/clientes', tempoMedio: '3m 15s', visitas: 287, usuarios: 5, retorno: '54%' },
  { page: '/calendario', tempoMedio: '2m 48s', visitas: 215, usuarios: 7, retorno: '42%' },
  { page: '/dashboard', tempoMedio: '5m 10s', visitas: 198, usuarios: 4, retorno: '71%' },
  { page: '/rotina', tempoMedio: '3m 55s', visitas: 176, usuarios: 8, retorno: '63%' },
  { page: '/configuracoes', tempoMedio: '1m 22s', visitas: 89, usuarios: 3, retorno: '22%' },
  { page: '/home', tempoMedio: '0m 45s', visitas: 421, usuarios: 8, retorno: '35%' },
  { page: '/auditoria', tempoMedio: '2m 10s', visitas: 54, usuarios: 2, retorno: '48%' }
];

function getFilteredAuditData() {
  const search = ($('#auditSearchInput')?.value || '').toLowerCase().trim();
  const modulo = $('#auditFilterModulo')?.value || 'all';
  const acao = $('#auditFilterAcao')?.value || 'all';
  const func = $('#auditFilterFunc')?.value || 'all';
  const device = $('#auditFilterDevice')?.value || 'all';

  return auditData.filter(row => {
    if (search && !row.user.toLowerCase().includes(search) && !row.action.toLowerCase().includes(search) && !row.actionUrl.toLowerCase().includes(search) && !(row.module || '').toLowerCase().includes(search)) return false;
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
  ['auditFilterRows', 'auditFilterPeriodo', 'auditFilterAcao', 'auditFilterModulo', 'auditFilterFunc', 'auditFilterDevice'].forEach(id => {
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
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(debounce);
        auditPage = 1;
        renderAuditTable();
        renderAuditPagination();
      }
    });
  }
  const refresh = $('#auditRefreshBtn');
  if (refresh) refresh.addEventListener('click', async () => {
    try {
      const dados = await buscarAuditoria({ limit: 500 });
      if (dados.length > 0) {
        auditData = dados.map(row => ({
          id: row.id,
          user: row.usuario_nome,
          hash: row.usuario_id,
          action: row.acao,
          actionUrl: row.caminho_url,
          module: row.modulo,
          device: row.dispositivo,
          deviceIcon: (row.dispositivo || '').toLowerCase() === 'mobile' ? 'smartphone' : 'monitor',
          datetime: formatAuditDate(row.created_at)
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
    a.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
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
  ['calibLeadsTotal', 'calibLeadsQuentes', 'calibTempoResposta', 'calibSemAtendimento', 'calibVisitas', 'calibConversao'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = id === 'calibConversao' ? '0%' : '0';
  });
  ['calibQtdQuente', 'calibQtdMorno', 'calibQtdFrio'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '0';
  });
  ['calibPctQuente', 'calibPctMorno', 'calibPctFrio'].forEach(id => {
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
   CONVERSAS - CENTRAL DE ATENDIMENTO WHATSAPP
   ============================================ */
function _isValidUUID(v) {
  return typeof v === 'string' && v.length === 36 && v.includes('-');
}
const conversasState = {
  chats: [],
  allChats: [],
  selectedChatId: null,
  messages: [],
  members: [],
  leads: [],
  filter: 'all',
  searchTerm: '',
  realtimeChannel: null,
  selectedCentroCustoId: null,
  centrosCustoList: [],
  waStatus: 'disconnected',
  instanceName: null,
  _loadAbortController: null
};

/* Navegação pendente: CRM → Conversas (deep-link) */
let _pendingConvNavigation = null;
// { phone, leadId, leadName, centroCustoId }

const _CONV_STATUS_LABELS = { open: 'Aberto', pending: 'Pendente', closed: 'Fechado' };
const _CONV_THERMO_LABELS = { frio: 'Frio', morno: 'Morno', quente: 'Quente' };

/* ---------- helpers ---------- */
function _convHtmlEscape(s) { return escapeHtml(s || ''); }
function _convTimeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'agora';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'min';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function _convInitials(name, phone) {
  const src = name || phone || '?';
  return src.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}

/* ---------- load chats ---------- */
async function loadConversasChats() {
  const list = $('#convChatList');
  if (!list) return;

  // Abortar requisição anterior se houver
  if (conversasState._loadAbortController) {
    conversasState._loadAbortController.abort();
  }
  const abortController = new AbortController();
  conversasState._loadAbortController = abortController;
  const signal = abortController.signal;

  try {
    const membroId = currentUser.id;
    const ccId = conversasState.selectedCentroCustoId;

    // Guard: sem empresa selecionada, não buscar conversas
    if (!ccId) {
      conversasState.allChats = [];
      conversasState.chats = [];
      conversasState.instanceName = null;
      _renderConvChatList();
      list.innerHTML = '<div class="conv-empty-state"><p>Selecione uma empresa para ver as conversas.</p></div>';
      return;
    }

    // Buscar WhatsApp status + instanceName
    const waConfig = await waFetchConfig(membroId, ccId);
    _convUpdateConnectionStatus(waConfig);

    // Extrair instanceName da config
    if (waConfig?.provider_config?.instanceName) {
      conversasState.instanceName = waConfig.provider_config.instanceName;
    } else {
      conversasState.instanceName = null;
    }

    if (signal.aborted) return;

    // Buscar conversas: VISIBILIDADE ESTRTA — apenas conversas do próprio membro
    let convData, convError;
    console.log('[Conversas] Query:', { ccId, membroId });
    const result = await _supabase
      .from('conversations')
      .select('id, membro_id, contact_id, centros_custo_id, lead_id, status, unread_count, last_message_text, last_message_at, created_at, updated_at')
      .eq('centros_custo_id', ccId)
      .eq('membro_id', membroId)
      .order('last_message_at', { ascending: false, nullsFirst: false });
    convData = result.data;
    convError = result.error;

    if (signal.aborted) return;

    if (convError) {
      console.error('[Conversas] Erro ao buscar conversas:', convError);
      list.innerHTML = '<div class="conv-empty-state"><p>Erro ao carregar conversas: ' + convError.message + '</p></div>';
      return;
    }

    // Buscar contatos separadamente
    const contactIds = [...new Set((convData || []).map(c => c.contact_id).filter(id => id && typeof id === 'string' && id.length === 36))];
    let contactsMap = {};

    if (contactIds.length > 0) {
      const { data: contactsData, error: contactsErr } = await _supabase
        .from('contacts')
        .select('id, phone, name, profile_pic_url')
        .in('id', contactIds);
      if (contactsErr) console.error('[Conversas] Erro ao buscar contatos:', contactsErr.message, contactsErr.code);
      (contactsData || []).forEach(c => { contactsMap[c.id] = c; });
    }

    if (signal.aborted) return;

    // Buscar leads vinculados às conversas
    const rawLeadIds = (convData || []).map(c => c.lead_id);
    const leadIds = [...new Set(rawLeadIds.filter(_isValidUUID))];
    console.log('[Conversas] lead_ids brutos:', rawLeadIds.length, '| válidos:', leadIds.length);
    let leadsMap = {};

    if (leadIds.length > 0) {
      // Buscar sem filtro .in() para evitar 400 do Postgrest
      const { data: allLeads, error: leadsErr } = await _supabase
        .from('leads')
        .select('id, nome, telefone, email, temperatura, membro_id, owner_id, observacoes, centro_custo_id');
      if (leadsErr) {
        console.error('[Conversas] Erro ao buscar leads:', leadsErr.message, leadsErr.code);
      } else {
        const leadIdSet = new Set(leadIds);
        (allLeads || []).forEach(l => { if (leadIdSet.has(l.id)) leadsMap[l.id] = l; });
      }
    }

    if (signal.aborted) return;

    // Mapear para formato compativel com a UI
    conversasState.allChats = (convData || []).map(c => {
      const contact = contactsMap[c.contact_id] || {};
      const lead = leadsMap[c.lead_id] || null;
      let parsedNotes = [];
      if (lead?.observacoes) {
        try { parsedNotes = JSON.parse(lead.observacoes); } catch { parsedNotes = []; }
      }
      return {
        id: c.id,
        contact_name: lead?.nome || contact.name || '',
        contact_phone: lead?.telefone || contact.phone || '',
        contact_email: lead?.email || '',
        contact_location: '',
        status: c.status,
        assigned_to: c.membro_id,
        lead_id: c.lead_id || null,
        last_message: c.last_message_text,
        last_message_at: c.last_message_at,
        created_at: c.created_at,
        temperature: lead?.temperatura || 'frio',
        priority: false,
        tags: [],
        notes: parsedNotes,
        unread_count: c.unread_count || 0,
        _conversationId: c.id,
        _contactId: c.contact_id,
        _centroCustoId: c.centros_custo_id || null,
        _profilePicUrl: contact.profile_pic_url || null,
        _leadData: lead
      };
    });

    console.log('[Conversas] Conversas carregadas:', conversasState.allChats.length);
    _convApplyFilter();
    _convUpdateStats();
    _convUpdateSyncTime();

  } catch (err) {
    console.error('[Conversas] Erro ao carregar chats:', err);
    list.innerHTML = '<div class="conv-empty-state"><p>Erro ao carregar conversas</p></div>';
  }
}

/* ---------- filter & render list ---------- */
function _convApplyFilter() {
  let list = [...conversasState.allChats];
  const term = conversasState.searchTerm.toLowerCase();

  if (term) {
    list = list.filter(c =>
      (c.contact_name || '').toLowerCase().includes(term) ||
      (c.contact_phone || '').toLowerCase().includes(term)
    );
  }

  const f = conversasState.filter;
  if (f === 'unread') list = list.filter(c => (c.unread_count || 0) > 0);
  else if (f === 'open') list = list.filter(c => c.status === 'open');
  else if (f === 'pending') list = list.filter(c => c.status === 'pending');
  else if (f === 'closed') list = list.filter(c => c.status === 'closed');
  else if (f === 'mine') {
    const uid = getCurrentUserId();
    list = list.filter(c => c.assigned_to === uid);
  } else if (f === 'hot') list = list.filter(c => c.temperature === 'quente');
  else if (f === 'unidentified') list = list.filter(c => !c.contact_name || c.contact_name === c.contact_phone);

  conversasState.chats = list;
  _renderConvChatList();
}

function _renderConvChatList() {
  const list = $('#convChatList');
  if (!list) return;

  const chats = conversasState.chats;
  if (!chats.length) {
    list.innerHTML = '<div class="conv-empty-state"><p>Nenhuma conversa encontrada</p></div>';
    return;
  }

  list.innerHTML = chats.map(chat => {
    const active = chat.id === conversasState.selectedChatId ? ' active' : '';
    const unread = (chat.unread_count || 0) > 0 ? ' unread' : '';
    const initials = _convInitials(chat.contact_name, chat.contact_phone);
    const time = _convTimeAgo(chat.last_message_at);
    const thermo = chat.temperature || 'frio';
    const thermoTag = thermo === 'quente' ? '<span class="conv-tag conv-tag--quente">Quente</span>' :
                      thermo === 'morno' ? '<span class="conv-tag conv-tag--morno">Morno</span>' : '';
    const prioTag = chat.priority ? '<span class="conv-tag conv-tag--priority">!</span>' : '';
    const unreadBadge = (chat.unread_count || 0) > 0
      ? `<span class="conv-card-unread-badge">${chat.unread_count}</span>` : '';
    const dotHtml = `<span class="conv-card-unread-dot"></span>`;

    return `
      <div class="conv-chat-card${active}${unread}" data-chat-id="${chat.id}">
        <div class="conv-card-avatar">${initials}${(chat.unread_count || 0) > 0 ? dotHtml : ''}</div>
        <div class="conv-card-body">
          <div class="conv-card-top">
            <span class="conv-card-name">${_convHtmlEscape(chat.contact_name || chat.contact_phone || 'Desconhecido')}</span>
            <span class="conv-card-time">${time}</span>
          </div>
          <div class="conv-card-bottom">
            <span class="conv-card-preview">${_convHtmlEscape(chat.last_message || 'Sem mensagens')}</span>
            <div class="conv-card-tags">${thermoTag}${prioTag}${unreadBadge}</div>
          </div>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.conv-chat-card').forEach(el => {
    el.addEventListener('click', () => _convSelectChat(el.dataset.chatId));
  });
}

function _convUpdateStats() {
  const all = conversasState.allChats;
  const $ = id => document.getElementById(id);
  const unread = el => el && (el.textContent = all.filter(c => (c.unread_count || 0) > 0).length);
  const hot = el => el && (el.textContent = all.filter(c => c.temperature === 'quente').length);
  const online = el => el && (el.textContent = all.filter(c => c.status === 'open').length);
  unread($('#convStatUnread'));
  hot($('#convStatHot'));
  online($('#convStatOnline'));
  const uid = getCurrentUserId();
  const unassigned = all.filter(c => !c.assigned_to).length;
  const el = $('#convUnidentifiedCount');
  if (el) el.textContent = unassigned;
}
function _convUpdateSyncTime() {
  const el = $('#convSyncTime');
  if (el) el.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function _convUpdateConnectionStatus(waConfig) {
  const statusEl = document.getElementById('convConnectionStatus');
  if (!statusEl) return;

  const status = waConfig?.status || 'disconnected';
  const instanceName = waConfig?.provider_config?.instanceName || '--';

  conversasState.waStatus = status;

  console.log('[Conversas] WhatsApp status:', status, '| Instance:', instanceName);

  const dotClass = status === 'connected' ? 'conv-connection-dot--connected' :
                   status === 'connecting' ? 'conv-connection-dot--connecting' : '';
  const label = status === 'connected' ? 'Conectado' :
                status === 'connecting' ? 'Conectando...' : 'Desconectado';

  statusEl.innerHTML = `
    <span class="conv-connection-dot ${dotClass}"></span>
    <span>${label}</span>
  `;

  _convUpdateComposerState();
}

function _convUpdateComposerState() {
  const input = $('#convMessageInput');
  const sendBtn = $('#convSendBtn');
  const attachBtn = $('#btnConvAttach');
  const emojiBtn = $('#btnConvEmoji');
  const micBtn = $('#btnConvMic');
  const composer = $('#convComposer');
  const isDisconnected = conversasState.waStatus !== 'connected';

  if (input) {
    input.disabled = isDisconnected;
    input.placeholder = isDisconnected ? 'WhatsApp desconectado...' : 'Digite sua mensagem...';
  }
  if (sendBtn) sendBtn.disabled = isDisconnected;
  if (attachBtn) attachBtn.disabled = isDisconnected;
  if (emojiBtn) emojiBtn.disabled = isDisconnected;
  if (micBtn) micBtn.disabled = isDisconnected;
  if (composer) composer.classList.toggle('conv-composer--disabled', isDisconnected);
}

/* ---------- filter chips ---------- */
function _renderConvFilterChips() {
  const container = $('#convFilterChips');
  if (!container) return;
  const chips = [
    { key: 'all', label: 'Todas' },
    { key: 'unread', label: 'Não lidas' },
    { key: 'open', label: 'Abertas' },
    { key: 'pending', label: 'Pendentes' },
    { key: 'closed', label: 'Fechadas' },
    { key: 'mine', label: 'Minhas' },
    { key: 'hot', label: 'Quentes' }
  ];
  container.innerHTML = chips.map(c =>
    `<button class="conv-chip${conversasState.filter === c.key ? ' active' : ''}" data-filter="${c.key}">${c.label}</button>`
  ).join('');
  container.querySelectorAll('.conv-chip').forEach(el => {
    el.addEventListener('click', () => {
      conversasState.filter = el.dataset.filter;
      _convApplyFilter();
      _renderConvFilterChips();
    });
  });
}

/* ---------- select chat ---------- */
async function _convSelectChat(chatId) {
  conversasState.selectedChatId = chatId;
  _renderConvChatList();

  const chat = conversasState.allChats.find(c => c.id === chatId);
  if (!chat) return;

  $('#convChatEmpty').style.display = 'none';
  $('#convChatContent').style.display = 'flex';

  // Buscar dados do lead se não foram carregados ainda
  if (_isValidUUID(chat.lead_id) && !chat._leadData) {
    try {
      const { data: leadData, error: leadErr } = await _supabase
        .from('leads')
        .select('id, nome, telefone, email, temperatura, membro_id, owner_id, observacoes, centro_custo_id')
        .eq('id', chat.lead_id)
        .maybeSingle();
      if (leadErr) console.error('[Conversas] Erro ao buscar lead:', leadErr.message, leadErr.code, 'lead_id:', chat.lead_id);
      if (leadData) {
        chat._leadData = leadData;
        chat.temperature = leadData.temperatura || 'frio';
        chat.contact_name = leadData.nome || chat.contact_name;
        chat.contact_phone = leadData.telefone || chat.contact_phone;
        chat.contact_email = leadData.email || '';
        if (leadData.observacoes) {
          try { chat.notes = JSON.parse(leadData.observacoes); } catch { /* keep current */ }
        }
      }
    } catch (e) {
      console.error('[Conversas] Erro ao buscar lead:', e);
    }
  }

  _renderConvChatHeader(chat);
  _convRenderSuggestion(chat);
  await _convLoadMessages(chat._conversationId || chatId);
  _renderConvCrmPanel(chat);

  // Mark as read
  if ((chat.unread_count || 0) > 0) {
    await waMarkAsRead(chat._conversationId || chatId);
    chat.unread_count = 0;
    _convUpdateStats();
    _renderConvChatList();
  }

  _convUpdateComposerState();
}

function _renderConvChatHeader(chat) {
  const header = $('#convChatHeader');
  if (!header) return;
  const statusLabel = _CONV_STATUS_LABELS[chat.status] || chat.status;
  const statusClass = chat.status === 'open' ? 'conv-connection-dot--connected' : '';
  header.innerHTML = `
    <div class="conv-chat-header-avatar">${_convInitials(chat.contact_name, chat.contact_phone)}</div>
    <div class="conv-chat-header-info">
      <div class="conv-chat-header-name">${_convHtmlEscape(chat.contact_name || chat.contact_phone || 'Desconhecido')}</div>
      <div class="conv-chat-header-meta">
        <span class="conv-connection-dot ${statusClass}" style="width:6px;height:6px;display:inline-block;border-radius:50%;"></span>
        <span>${statusLabel}</span>
        <span>&middot;</span>
        <span>${chat.contact_phone ? '+' + chat.contact_phone : 'Sem telefone'}</span>
      </div>
    </div>
    <div class="conv-chat-header-actions">
      <button title="Telefone" onclick="window.open('https://wa.me/${chat.contact_phone || ''}','_blank')"><i data-lucide="phone"></i></button>
      <button title="Arquivar" onclick="convArchiveChat('${chat.id}')"><i data-lucide="archive"></i></button>
      <button title="Mais opções"><i data-lucide="more-vertical"></i></button>
    </div>`;
  initIcons();
}

/* ---------- suggestion ---------- */
function _convRenderSuggestion(chat) {
  const el = $('#convSuggestion');
  if (!el) return;
  const thermo = chat.temperature || 'frio';
  if (thermo !== 'quente') { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = `
    <div class="conv-suggestion-label">Sugestao Inteligente</div>
    <div class="conv-suggestion-text">Este contato esta com temperatura <strong>Quente</strong>. Recomenda-se responder em ate 5 minutos para maximizar a conversao.</div>
    <div class="conv-suggestion-actions">
      <button onclick="convSendMessageSuggestion('Ola! Obrigado pelo contato. Como posso ajudar?')">Saudacao</button>
      <button onclick="convSendMessageSuggestion('Tenho uma proposta especial para voce!')">Proposta</button>
      <button class="primary" onclick="convSendMessageSuggestion('Vou te enviar as informacoes agora mesmo.')">Enviar</button>
    </div>`;
}

/* ---------- messages ---------- */
async function _convLoadMessages(chatId) {
  const container = $('#convMessages');
  if (!container) return;
  try {
    const { data, error } = await _supabase
      .from('messages')
      .select('id, conversation_id, membro_id, sender_type, content_type, content_text, media_url, mime_type, message_id, status, created_at')
      .eq('conversation_id', chatId)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('[Conversas] Erro na query messages:', error);
      throw error;
    }
    conversasState.messages = data || [];
    console.log('[Conversas] Mensagens carregadas:', data?.length || 0);
    _renderConvMessages();
  } catch (err) {
    console.error('[Conversas] Erro ao carregar mensagens:', err);
    container.innerHTML = `<div class="conv-empty-state"><p>Erro ao carregar mensagens</p><p style="font-size:12px;color:#999;margin-top:8px;">${escapeHtml(String(err.message || err))}</p></div>`;
  }
}

/* ---------- media: resolver URL de mídia ---------- */
function _convResolveMediaUrl(url, contentType, messageId, mimeType) {
  const supabaseUrl = (_supabase && _supabase.supabaseUrl) || '';
  if (!supabaseUrl) return url || '';
  const proxyBase = `${supabaseUrl}/functions/v1/evolution-media-proxy`;
  const anonKey = window.__SUPABASE_ANON_KEY || '';
  const instName = conversasState.instanceName || '';

  // Se não há URL, mas há messageId — usar fallback via proxy
  if ((!url || url === '') && messageId) {
    if (!instName) {
      console.warn('[media] instanceName não disponível para fallback');
      return '';
    }
    let fallbackUrl = `${proxyBase}?messageId=${encodeURIComponent(String(messageId))}&instanceName=${encodeURIComponent(instName)}`;
    if (anonKey) fallbackUrl += `&key=${encodeURIComponent(anonKey)}`;
    if (contentType || mimeType) fallbackUrl += `&contentType=${encodeURIComponent(mimeType || contentType || '')}`;
    return fallbackUrl;
  }

  if (!url || typeof url !== 'string') return '';
  // Já é data URI — retornar direto
  if (url.startsWith('data:')) return url;
  // Base64 puro (sem prefixo) — adicionar MIME type
  if (/^[A-Za-z0-9+/=\s]{100,}$/.test(url.trim())) {
    const mime = mimeType ||
      (contentType === 'image' ? 'image/jpeg' :
      contentType === 'audio' ? 'audio/ogg' :
      contentType === 'video' ? 'video/mp4' :
      'application/octet-stream');
    return `data:${mime};base64,${url.trim()}`;
  }
  // URL externa (Evolution API) — proxy via Edge Function com auth
  if (url.startsWith('http')) {
    if (!anonKey) console.warn('[media] window.__SUPABASE_ANON_KEY is empty');
    let proxyUrl = `${proxyBase}?url=${encodeURIComponent(url)}&key=${encodeURIComponent(anonKey)}`;
    if (messageId) proxyUrl += `&messageId=${encodeURIComponent(String(messageId))}`;
    if (instName) proxyUrl += `&instanceName=${encodeURIComponent(instName)}`;
    if (contentType || mimeType) proxyUrl += `&contentType=${encodeURIComponent(mimeType || contentType || '')}`;
    return proxyUrl;
  }
  return url;
}

/* ---------- media: buscar mídia via proxy (com fallback) ---------- */
async function _convFetchMediaAsDataUrl(proxyUrl, contentType) {
  try {
    const resp = await fetch(proxyUrl);
    if (!resp.ok) {
      console.warn('[media] proxy retornou erro:', resp.status);
      return '';
    }
    const ct = resp.headers.get('content-type') || '';

    // Se retornou binário direto (image/*, audio/*, video/*)
    if (ct.startsWith('image/') || ct.startsWith('audio/') || ct.startsWith('video/') || ct === 'application/octet-stream') {
      const blob = await resp.blob();
      return URL.createObjectURL(blob);
    }

    // Se retornou JSON (fallback getBase64FromMediaMessage)
    if (ct.includes('application/json')) {
      const data = await resp.json();
      if (data.dataUri) return data.dataUri;
      if (data.error) {
        console.warn('[media] proxy error:', data.error);
        return '';
      }
    }

    // Fallback: tentar ler como blob
    const blob = await resp.blob();
    if (blob.size > 0) return URL.createObjectURL(blob);
    return '';
  } catch (e) {
    console.error('[media] fetch exception:', e.message);
    return '';
  }
}

function _renderConvMessages() {
  const container = $('#convMessages');
  if (!container) return;

  if (conversasState.waStatus !== 'connected') {
    conversasState.messages = [];
    container.innerHTML = '<div class="conv-empty-state" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;opacity:0.7;"><i data-lucide="wifi-off" style="width:48px;height:48px;margin-bottom:12px;"></i><p style="font-size:15px;font-weight:500;">WhatsApp Desconectado</p><p style="font-size:13px;margin-top:4px;">Conecte o aparelho para visualizar as conversas.</p></div>';
    initIcons();
    return;
  }

  const msgs = conversasState.messages;

  if (!msgs.length) {
    container.innerHTML = '<div class="conv-empty-state"><p>Nenhuma mensagem ainda</p></div>';
    return;
  }

  let html = '';
  let lastDate = '';
  msgs.forEach(msg => {
    try {
    const d = new Date(msg.created_at).toLocaleDateString('pt-BR');
    if (d !== lastDate) {
      html += `<div class="conv-date-separator"><span>${d}</span></div>`;
      lastDate = d;
    }
    const type = msg.sender_type === 'member' ? 'agent' : 'lead';
    const time = new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const statusIcon = msg.status === 'read' ? '<span class="conv-msg-status read">&#10003;&#10003;</span>' :
                       msg.status === 'delivered' ? '<span class="conv-msg-status">&#10003;&#10003;</span>' :
                       '<span class="conv-msg-status">&#10003;</span>';

    let contentHtml = '';
    try {
      if (msg.content_type === 'image' && (msg.media_url || msg.message_id)) {
        const proxyUrl = _convResolveMediaUrl(msg.media_url, 'image', msg.message_id, msg.mime_type);
        contentHtml = `<img data-src="${_convHtmlEscape(proxyUrl)}" data-media-type="image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='100'%3E%3Crect fill='%23222' width='200' height='100'/%3E%3Ctext x='50%25' y='50%25' fill='%23666' text-anchor='middle' dy='.3em' font-size='12'%3ECarregando...%3C/text%3E%3C/svg%3E" class="conv-media-img" loading="lazy" onclick="window.open(this.src,'_blank')" />`;
        if (msg.content_text) contentHtml += `<div class="conv-media-caption">${_convHtmlEscape(msg.content_text)}</div>`;
      } else if (msg.content_type === 'audio' && (msg.media_url || msg.message_id)) {
        const proxyUrl = _convResolveMediaUrl(msg.media_url, 'audio', msg.message_id, msg.mime_type);
        contentHtml = `<audio data-src="${_convHtmlEscape(proxyUrl)}" data-media-type="audio" controls preload="metadata" class="conv-media-audio"></audio>`;
      } else if (msg.content_type === 'video' && (msg.media_url || msg.message_id)) {
        const proxyUrl = _convResolveMediaUrl(msg.media_url, 'video', msg.message_id, msg.mime_type);
        contentHtml = `<video data-src="${_convHtmlEscape(proxyUrl)}" data-media-type="video" controls preload="metadata" class="conv-media-video"></video>`;
        if (msg.content_text) contentHtml += `<div class="conv-media-caption">${_convHtmlEscape(msg.content_text)}</div>`;
      } else if (msg.content_type === 'document' && (msg.media_url || msg.message_id)) {
        const proxyUrl = _convResolveMediaUrl(msg.media_url, 'document', msg.message_id, msg.mime_type);
        const docName = msg.content_text || 'Documento';
        contentHtml = `<a data-href="${_convHtmlEscape(proxyUrl)}" data-media-type="document" target="_blank" class="conv-media-doc"><i data-lucide="file-text"></i> ${_convHtmlEscape(docName)}</a>`;
      } else if (msg.content_type === 'sticker' && (msg.media_url || msg.message_id)) {
        const proxyUrl = _convResolveMediaUrl(msg.media_url, 'image', msg.message_id, msg.mime_type);
        contentHtml = `<img data-src="${_convHtmlEscape(proxyUrl)}" data-media-type="image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect fill='%23222' width='80' height='80'/%3E%3C/svg%3E" class="conv-media-sticker" />`;
      } else if (msg.content_text) {
        contentHtml = _convHtmlEscape(msg.content_text);
      } else {
        contentHtml = '<em>[Mensagem vazia]</em>';
      }
    } catch (mediaErr) {
      console.error('[Conversas] Erro ao renderizar mídia:', mediaErr, msg);
      contentHtml = msg.content_text ? _convHtmlEscape(msg.content_text) : `<em>[Mensagem vazia]</em>`;
    }

    html += `
      <div class="conv-msg ${type}">
        <div class="conv-msg-content">${contentHtml}</div>
        <div class="conv-msg-meta">
          <span class="conv-msg-time">${time}</span>
          ${type === 'agent' ? statusIcon : ''}
        </div>
      </div>`;
    } catch (msgErr) {
      console.error('[Conversas] Erro ao renderizar mensagem:', msgErr, msg);
    }
  });
  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
  initIcons();

  // Resolver mídias assincronamente (NÃO bloquear renderização)
  try { _resolveAllMedia(container); } catch (_) { /* fire-and-forget */ }
}

/* ---------- resolver todas as mídias pendentes no container ---------- */
async function _resolveAllMedia(container) {
  const elements = container.querySelectorAll('[data-src], [data-href]');
  if (!elements.length) return;

  console.log('[media] resolvendo', elements.length, 'elementos de mídia');
  for (const el of elements) {
    const proxyUrl = el.getAttribute('data-src') || el.getAttribute('data-href');
    const mediaType = el.getAttribute('data-media-type') || 'image';
    if (!proxyUrl) continue;

    console.log('[media] buscando:', { tag: el.tagName, mediaType, url: proxyUrl.substring(0, 120) });
    try {
      const resolvedUrl = await _convFetchMediaAsDataUrl(proxyUrl, mediaType);
      if (!resolvedUrl) {
        console.warn('[media] falhou para:', proxyUrl.substring(0, 80));
        if (el.tagName === 'IMG') {
          el.alt = 'Mídia indisponível';
          el.style.opacity = '0.3';
        }
        continue;
      }
      console.log('[media] OK:', { tag: el.tagName, resolvedType: resolvedUrl.substring(0, 30) });
      if (el.hasAttribute('data-src')) {
        el.src = resolvedUrl;
        if (el.tagName === 'AUDIO') el.load();
      } else if (el.hasAttribute('data-href')) {
        el.href = resolvedUrl;
      }
      el.removeAttribute('data-src');
      el.removeAttribute('data-href');
      el.removeAttribute('data-media-type');
    } catch (e) {
      console.error('[media] resolve error:', e.message);
    }
  }
}

/* ---------- send message ---------- */
async function _convSendMessage() {
  if (conversasState.waStatus !== 'connected') {
    toast('WhatsApp desconectado. Conecte o aparelho para enviar mensagens.', 'error');
    return;
  }

  // Se há mídia pendente no preview, enviar em vez de texto
  if (conversasState.pendingMedia) {
    await _convSendPendingMedia();
    return;
  }

  const input = $('#convMessageInput');
  if (!input) return;
  const content = input.value.trim();
  if (!content || !conversasState.selectedChatId) return;
  input.value = '';
  input.style.height = 'auto';

  const chat = conversasState.allChats.find(c => c.id === conversasState.selectedChatId);
  if (!chat) return;

  try {
    let ccId = chat._centroCustoId || conversasState.selectedCentroCustoId;
    if (!ccId) {
      try {
        const { data: convCC } = await _supabase
          .from('conversations')
          .select('centros_custo_id')
          .eq('id', chat._conversationId || conversasState.selectedChatId)
          .maybeSingle();
        ccId = convCC?.centros_custo_id || null;
      } catch (e) { /* ignore */ }
    }
    let instanceName = null;
    if (ccId) {
      try {
        const { data: waCfg } = await _supabase
          .from('whatsapp_config')
          .select('provider_config')
          .eq('provider', 'evolution_api')
          .eq('status', 'connected')
          .eq('centros_custo_id', ccId)
          .maybeSingle();
        instanceName = waCfg?.provider_config?.instanceName || null;
      } catch (e) { /* fallback: Edge Function busca */ }
    }
    const cleanPhone = (chat.contact_phone || '').replace(/\D/g, '');
    const number = cleanPhone ? (cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`) : null;
    console.log('[WA] _convSendMessage:', { number, instanceName, ccId });

    if (!ccId || !instanceName) {
      toast('Selecione uma empresa no filtro superior para enviar mensagens nesta conversa.', 'error');
      input.value = content;
      return;
    }

    const result = await waSendText(currentUser.id, chat._conversationId || conversasState.selectedChatId, content, ccId, number, instanceName);

    await _supabase.from('conversations').update({
      last_message_text: content,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', chat._conversationId || conversasState.selectedChatId);

    chat.last_message = content;
    chat.last_message_at = new Date().toISOString();

    await _convLoadMessages(chat._conversationId || conversasState.selectedChatId);

  } catch (err) {
    console.error('[Conversas] Erro ao enviar mensagem:', err);
    toast('Erro ao enviar mensagem: ' + (err.message || 'Tente novamente'));
  }
}

/* ---------- media: state + helpers ---------- */
conversasState.pendingMedia = null; // { file, dataUrl, type, previewUrl }
conversasState.mediaRecorder = null;
conversasState.audioChunks = [];
conversasState.isRecording = false;

function _convFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function _convFileTypeToContentType(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'document';
}

function _convFormatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

/* ---------- media: preview ---------- */
function _convShowMediaPreview(file, dataUrl) {
  const contentType = _convFileTypeToContentType(file);
  const previewEl = $('#convMediaPreview');
  if (!previewEl) return;

  let thumbHtml = '';
  if (contentType === 'image') {
    thumbHtml = `<img src="${dataUrl}" class="conv-media-preview-thumb" />`;
  } else if (contentType === 'audio') {
    thumbHtml = '<div style="width:48px;height:48px;border-radius:6px;background:var(--gray-100);display:grid;place-items:center"><i data-lucide="mic" style="width:20px;height:20px;color:var(--gray-500)"></i></div>';
  } else if (contentType === 'video') {
    thumbHtml = '<div style="width:48px;height:48px;border-radius:6px;background:var(--gray-100);display:grid;place-items:center"><i data-lucide="video" style="width:20px;height:20px;color:var(--gray-500)"></i></div>';
  } else {
    thumbHtml = '<div style="width:48px;height:48px;border-radius:6px;background:var(--gray-100);display:grid;place-items:center"><i data-lucide="file-text" style="width:20px;height:20px;color:var(--gray-500)"></i></div>';
  }

  previewEl.innerHTML = `
    ${thumbHtml}
    <div class="conv-media-preview-info">
      <div class="conv-media-preview-name">${_convHtmlEscape(file.name || 'Áudio gravado')}</div>
      <div class="conv-media-preview-size">${_convFormatFileSize(file.size || 0)}</div>
    </div>
    <button class="conv-media-preview-cancel" id="btnConvPreviewCancel" title="Cancelar"><i data-lucide="x"></i></button>
  `;
  previewEl.style.display = 'flex';
  initIcons();

  conversasState.pendingMedia = { file, dataUrl, type: contentType };

  $('#btnConvPreviewCancel')?.addEventListener('click', _convClearMediaPreview);
}

function _convClearMediaPreview() {
  conversasState.pendingMedia = null;
  const previewEl = $('#convMediaPreview');
  if (previewEl) { previewEl.innerHTML = ''; previewEl.style.display = 'none'; }
}

/* ---------- media: send pending media ---------- */
async function _convSendPendingMedia() {
  const media = conversasState.pendingMedia;
  if (!media) return;

  const chat = conversasState.allChats.find(c => c.id === conversasState.selectedChatId);
  if (!chat) return;

  _convClearMediaPreview();

  try {
    let ccId = chat._centroCustoId || conversasState.selectedCentroCustoId;
    if (!ccId) {
      try {
        const { data: convCC } = await _supabase
          .from('conversations')
          .select('centros_custo_id')
          .eq('id', chat._conversationId || conversasState.selectedChatId)
          .maybeSingle();
        ccId = convCC?.centros_custo_id || null;
      } catch (e) { /* ignore */ }
    }
    let instanceName = null;
    if (ccId) {
      try {
        const { data: waCfg } = await _supabase
          .from('whatsapp_config')
          .select('provider_config')
          .eq('provider', 'evolution_api')
          .eq('status', 'connected')
          .eq('centros_custo_id', ccId)
          .maybeSingle();
        instanceName = waCfg?.provider_config?.instanceName || null;
      } catch (e) { /* fallback */ }
    }
    const cleanPhone = (chat.contact_phone || '').replace(/\D/g, '');
    const number = cleanPhone ? (cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`) : null;

    if (!ccId || !instanceName) {
      toast('Selecione uma empresa no filtro superior para enviar mídia.', 'error');
      return;
    }

    const convId = chat._conversationId || conversasState.selectedChatId;
    const input = $('#convMessageInput');
    const caption = input ? input.value.trim() : '';
    if (input) { input.value = ''; input.style.height = 'auto'; }

    // Enviar conforme tipo
    if (media.type === 'audio' && media._isVoiceNote) {
      await waSendVoiceNote(currentUser.id, convId, media.dataUrl, ccId, number, instanceName);
    } else {
      await waSendMedia(currentUser.id, convId, media.dataUrl, media.type, caption, ccId, number, instanceName);
    }

    const lastText = caption || `[${media.type}]`;
    await _supabase.from('conversations').update({
      last_message_text: lastText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', convId);

    chat.last_message = lastText;
    chat.last_message_at = new Date().toISOString();

    await _convLoadMessages(convId);

  } catch (err) {
    console.error('[Conversas] Erro ao enviar mídia:', err);
    toast('Erro ao enviar mídia: ' + (err.message || 'Tente novamente'));
  }
}

/* ---------- media: file input handler ---------- */
function _convHandleFileSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  // Reset input para poder selecionar o mesmo arquivo novamente
  e.target.value = '';

  if (file.size > 16 * 1024 * 1024) {
    toast('Arquivo muito grande. Máximo 16MB.', 'error');
    return;
  }

  _convFileToBase64(file).then(dataUrl => {
    _convShowMediaPreview(file, dataUrl);
  }).catch(err => {
    console.error('[Conversas] Erro ao ler arquivo:', err);
    toast('Erro ao ler arquivo', 'error');
  });
}

/* ---------- media: audio recording ---------- */
async function _convStartRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    conversasState.mediaRecorder = new MediaRecorder(stream, { mimeType });
    conversasState.audioChunks = [];
    conversasState.isRecording = true;

    conversasState.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) conversasState.audioChunks.push(e.data);
    };

    conversasState.mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      conversasState.isRecording = false;
      _convUpdateMicButton();

      if (conversasState.audioChunks.length === 0) return;

      const blob = new Blob(conversasState.audioChunks, { type: mimeType });
      conversasState.audioChunks = [];

      // Converter para base64
      const dataUrl = await _convFileToBase64(blob);

      // Criar arquivo sintético para o preview (File já herda size do Blob)
      const file = new File([blob], `audio-${Date.now()}.webm`, { type: mimeType });

      conversasState.pendingMedia = { file, dataUrl, type: 'audio', _isVoiceNote: true };
      _convShowMediaPreview(file, dataUrl);
      // Marcar como voice note no preview
      if (conversasState.pendingMedia) conversasState.pendingMedia._isVoiceNote = true;
    };

    conversasState.mediaRecorder.start();
    _convUpdateMicButton();
  } catch (err) {
    console.error('[Conversas] Erro ao acessar microfone:', err);
    toast('Não foi possível acessar o microfone. Verifique as permissões do navegador.', 'error');
  }
}

function _convStopRecording() {
  if (conversasState.mediaRecorder && conversasState.mediaRecorder.state !== 'inactive') {
    conversasState.mediaRecorder.stop();
  }
}

function _convToggleRecording() {
  if (conversasState.isRecording) {
    _convStopRecording();
  } else {
    _convStartRecording();
  }
}

function _convUpdateMicButton() {
  const micBtn = $('#btnConvMic');
  if (!micBtn) return;
  if (conversasState.isRecording) {
    micBtn.classList.add('recording');
    micBtn.title = 'Parar gravação';
  } else {
    micBtn.classList.remove('recording');
    micBtn.title = 'Gravar áudio';
  }
}

function convSendMessageSuggestion(text) {
  const input = $('#convMessageInput');
  if (input) { input.value = text; input.focus(); }
}

/* ---------- CRM panel ---------- */
function _renderConvCrmPanel(chat) {
  const panel = $('#convCrmContent');
  if (!panel) return;
  const leadData = chat._leadData || null;
  const assignee = conversasState.members.find(m => m.id === chat.assigned_to);
  const thermo = chat.temperature || 'frio';
  const notes = chat.notes || [];
  const leadId = chat.lead_id || null;
  const contactId = chat._contactId || null;
  const centrosCustoId = chat._centroCustoId || conversasState.selectedCentroCustoId || null;
  const membroId = currentUser?.id || null;

  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="conv-crm-section">
      <div class="conv-crm-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
        <h4><i data-lucide="user"></i> Perfil do Contato</h4>
        <i data-lucide="chevron-down" class="chevron"></i>
      </div>
      <div class="conv-crm-section-body">
        <div class="conv-profile-avatar">${_convInitials(chat.contact_name, chat.contact_phone)}</div>
        <div class="conv-profile-name">${_convHtmlEscape(chat.contact_name || 'Sem nome')}</div>
        <div class="conv-profile-phone">${chat.contact_phone ? '+' + chat.contact_phone : ''}</div>
        ${chat.contact_email ? `<div class="conv-profile-field"><span class="label">Email</span><span class="value">${_convHtmlEscape(chat.contact_email)}</span></div>` : ''}
        <div class="conv-profile-field"><span class="label">Conversa</span><span class="value">${_CONV_STATUS_LABELS[chat.status] || chat.status}</span></div>
        ${leadId
          ? `<a class="conv-btn-link" href="#" onclick="event.preventDefault();window._convVerLeadNoCRM('${leadId}');">Ver lead no CRM</a>`
          : `<div class="conv-sync-lead" style="margin-top:10px;">
              <div class="conv-crm-field">
                <label>Empresa</label>
                <select id="convSyncLeadCC" onchange="document.getElementById('convSyncLeadBtn').disabled = !this.value">
                  <option value="">Selecione a empresa...</option>
                  ${(conversasState.centrosCustoList || []).map(cc => `<option value="${cc.id}"${cc.id === centrosCustoId ? ' selected' : ''}>${_convHtmlEscape(cc.nome)}</option>`).join('')}
                </select>
              </div>
              <button class="btn btn-primary btn-sm" id="convSyncLeadBtn" style="width:100%;margin-top:6px;"
                ${contactId && centrosCustoId ? '' : 'disabled'}
                onclick="convSyncContactToLead('${contactId}', document.getElementById('convSyncLeadCC').value, '${membroId}')">
                <i data-lucide="user-plus"></i> Sincronizar como Lead
              </button>
              ${!contactId ? `<span class="conv-hint-text" style="display:block;margin-top:6px;font-size:11px;">Aguarde o contato ser criado para sincronizar</span>` : ''}
            </div>`
        }
      </div>
    </div>

    <div class="conv-crm-section">
      <div class="conv-crm-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
        <h4><i data-lucide="thermometer"></i> Termometro</h4>
        <i data-lucide="chevron-down" class="chevron"></i>
      </div>
      <div class="conv-crm-section-body">
        <div class="conv-thermo">
          <button class="conv-thermo-btn frio${thermo === 'frio' ? ' active' : ''}" onclick="convSetTemperature('${chat.id}','frio',${leadId ? `'${leadId}'` : 'null'})">Frio</button>
          <button class="conv-thermo-btn morno${thermo === 'morno' ? ' active' : ''}" onclick="convSetTemperature('${chat.id}','morno',${leadId ? `'${leadId}'` : 'null'})">Morno</button>
          <button class="conv-thermo-btn quente${thermo === 'quente' ? ' active' : ''}" onclick="convSetTemperature('${chat.id}','quente',${leadId ? `'${leadId}'` : 'null'})">Quente</button>
        </div>
      </div>
    </div>

    <div class="conv-crm-section">
      <div class="conv-crm-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
        <h4><i data-lucide="settings"></i> Gestao</h4>
        <i data-lucide="chevron-down" class="chevron"></i>
      </div>
      <div class="conv-crm-section-body">
        <div class="conv-crm-field">
          <label>Status Conversa</label>
          <select onchange="convSetStatus('${chat.id}', this.value)">
            <option value="open"${chat.status === 'open' ? ' selected' : ''}>Aberto</option>
            <option value="pending"${chat.status === 'pending' ? ' selected' : ''}>Pendente</option>
            <option value="closed"${chat.status === 'closed' ? ' selected' : ''}>Fechado</option>
          </select>
        </div>
        <div class="conv-crm-field">
          <label>Responsavel</label>
          <select onchange="convSetAssignee('${chat.id}', this.value,${leadId ? `'${leadId}'` : 'null'})">
            <option value="">Nao atribuido</option>
            ${conversasState.members.map(m => {
              const isSelected = chat.assigned_to
                ? chat.assigned_to === m.id
                : m.id === membroId;
              return `<option value="${m.id}"${isSelected ? ' selected' : ''}>${_convHtmlEscape(m.nome)}</option>`;
            }).join('')}
          </select>
        </div>
        <div class="conv-priority-toggle">
          <input type="checkbox" id="convPriority" ${chat.priority ? 'checked' : ''} onchange="convSetPriority('${chat.id}', this.checked)">
          <label for="convPriority">Prioridade alta</label>
        </div>
      </div>
    </div>

    <div class="conv-crm-section">
      <div class="conv-crm-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
        <h4><i data-lucide="file-text"></i> Observacoes</h4>
        <i data-lucide="chevron-down" class="chevron"></i>
      </div>
      <div class="conv-crm-section-body">
        <textarea class="form-control" rows="3" placeholder="Adicionar observacao..." id="convNotesInput" style="font-size:12px;"></textarea>
        <button class="btn btn-primary btn-sm" style="margin-top:8px;width:100%;" onclick="convAddNote('${chat.id}',${leadId ? `'${leadId}'` : 'null'})">Salvar observacao</button>
        <div id="convNotesList" style="margin-top:10px;">
          ${(Array.isArray(notes) ? notes : []).slice(-5).reverse().map(n => `
            <div class="conv-note-item">
              <div class="conv-note-header"><span class="conv-note-author">${_convHtmlEscape(n.author || 'Sistema')}</span><span class="conv-note-time">${_convTimeAgo(n.time)}</span></div>
              <div class="conv-note-text">${_convHtmlEscape(n.text)}</div>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
  initIcons();
}

/* ---------- CRM actions ---------- */
async function convSetTemperature(chatId, temp, leadId) {
  const chat = conversasState.allChats.find(c => c.id === chatId);
  if (chat) chat.temperature = temp;
  // Atualizar leads table se lead_id existir
  if (leadId && _isValidUUID(leadId)) {
    try {
      const { error } = await _supabase.from('leads').update({ temperatura: temp }).eq('id', leadId);
      if (error) console.error('[Conversas] Erro ao salvar temperatura:', error.message, error.code);
      if (chat?._leadData) chat._leadData.temperatura = temp;
    } catch (e) { console.error('[Conversas] Erro ao atualizar temperatura no lead:', e); }
  }
  if (conversasState.selectedChatId === chatId) _renderConvCrmPanel(chat);
  _convUpdateStats();
}
async function convSetStatus(chatId, status) {
  const membroId = currentUser.id;
  if (membroId) {
    await _supabase.from('conversations').update({ status, updated_at: new Date().toISOString() }).eq('id', chatId).eq('membro_id', membroId);
  }
  const chat = conversasState.allChats.find(c => c.id === chatId);
  if (chat) chat.status = status;
  if (conversasState.selectedChatId === chatId) { _renderConvChatHeader(chat); _renderConvCrmPanel(chat); }
  _convUpdateStats();
  _convApplyFilter();
}
async function convSetAssignee(chatId, userId, leadId) {
  const chat = conversasState.allChats.find(c => c.id === chatId);
  const previousAssignee = chat?.assigned_to || null;
  
  if (chat) chat.assigned_to = userId || null;
  
  try {
    // Atualizar tabela conversations (chat) no Supabase
    const { error: convError } = await _supabase
      .from('conversations')
      .update({ membro_id: userId || null, updated_at: new Date().toISOString() })
      .eq('id', chatId);
    
    if (convError) throw convError;

    // Se houver lead vinculado, atualizar também a tabela leads
    if (leadId && _isValidUUID(leadId)) {
      const { error: leadError } = await _supabase
        .from('leads')
        .update({ membro_id: userId || null })
        .eq('id', leadId);
      if (leadError) console.error('[Conversas] Erro ao salvar responsavel no lead:', leadError.message, leadError.code);
      if (chat?._leadData) chat._leadData.membro_id = userId || null;
    }

    if (conversasState.selectedChatId === chatId) _renderConvCrmPanel(chat);
    toast('Responsavel atualizado com sucesso!', 'success');
  } catch (err) {
    console.error('[Conversas] Erro ao atualizar responsavel:', err);
    // Reverter estado local em caso de erro
    if (chat) chat.assigned_to = previousAssignee;
    if (conversasState.selectedChatId === chatId) _renderConvCrmPanel(chat);
    toast(`Erro ao atualizar responsavel: ${err.message}`, 'error');
  }
}
async function convSetPriority(chatId, on) {
  const chat = conversasState.allChats.find(c => c.id === chatId);
  if (chat) chat.priority = on;
  _convApplyFilter();
}
async function convAddNote(chatId, leadId) {
  const input = $('#convNotesInput');
  if (!input || !input.value.trim()) return;
  const chat = conversasState.allChats.find(c => c.id === chatId);
  const notes = Array.isArray(chat?.notes) ? [...chat.notes] : [];
  const newNote = { text: input.value.trim(), author: currentUser?.nome || 'Atendente', time: new Date().toISOString() };
  notes.push(newNote);
  if (chat) chat.notes = notes;
  input.value = '';
  if (leadId && _isValidUUID(leadId)) {
    try {
      const { error } = await _supabase.from('leads').update({ observacoes: JSON.stringify(notes) }).eq('id', leadId);
      if (error) console.error('[Conversas] Erro ao salvar observacao:', error.message, error.code);
      if (chat?._leadData) chat._leadData.observacoes = JSON.stringify(notes);
    } catch (e) { console.error('[Conversas] Erro ao salvar observacao no lead:', e); }
  }
  _renderConvCrmPanel(chat);
  toast('Observacao salva');
}

/* ---------- Sync Contact to Lead ---------- */
async function convSyncContactToLead(contactId, centrosCustoId, membroId) {
  const btn = event?.target?.closest('button');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="auth-spinner"></span>';
  }
  
  try {
    const { data, error } = await _supabase.functions.invoke('sync-contact-to-lead', {
      body: { contactId, centrosCustoId, membroId }
    });
    
    if (error) throw new Error(error.message);
    
    if (data?.ok) {
      toast(data.message || 'Contato sincronizado como Lead com sucesso!');
      // Recarregar conversas para atualizar o painel
      await loadConversasChats();
    } else {
      throw new Error(data?.error || 'Erro ao sincronizar');
    }
  } catch (err) {
    console.error('[Conversas] Erro ao sincronizar contato:', err);
    toast(err.message || 'Erro ao sincronizar como Lead', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="user-plus"></i> Sincronizar como Lead';
      initIcons();
    }
  }
}
async function convArchiveChat(chatId) {
  if (!confirm('Arquivar esta conversa?')) return;
  const membroId = currentUser.id;
  if (membroId) {
    await _supabase.from('conversations').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', chatId).eq('membro_id', membroId);
  }
  const chat = conversasState.allChats.find(c => c.id === chatId);
  if (chat) chat.status = 'closed';
  _convUpdateStats();
  _convApplyFilter();
  toast('Conversa arquivada');
}

/* ---------- new conversation modal ---------- */
function _convOpenNewModal() {
  const overlay = $('#convNewOverlay');
  const modal = $('#convNewModal');
  if (overlay) overlay.classList.add('open');
  if (modal) { modal.classList.add('open'); modal.scrollTop = 0; }
  initIcons();
}
function _convCloseNewModal() {
  const overlay = $('#convNewOverlay');
  const modal = $('#convNewModal');
  if (overlay) overlay.classList.remove('open');
  if (modal) modal.classList.remove('open');
  ['convNewPhone', 'convNewName', 'convNewLeadSearch', 'convNewMessage'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const leadIdEl = document.getElementById('convNewLeadId');
  if (leadIdEl) leadIdEl.value = '';
  const results = $('#convNewLeadResults');
  if (results) results.innerHTML = '';
}
async function _convCreateChat() {
  const phone = ($('#convNewPhone')?.value || '').replace(/\D/g, '');
  const name = ($('#convNewName')?.value || '');
  const message = ($('#convNewMessage')?.value || '');
  const leadId = ($('#convNewLeadId')?.value || '') || null;

  if (!phone) { toast('Informe o telefone'); return; }

  const membroId = currentUser.id;
  const ccId = conversasState.selectedCentroCustoId;
  if (!membroId) { toast('Usuario nao identificado'); return; }

  try {
    // 1. Buscar contato existente (telefone + centro de custo)
    let contactId = null;
    let existingLeadId = null;

    let contactQuery = _supabase
      .from('contacts')
      .select('id, lead_id')
      .eq('phone', phone);

    if (ccId) {
      contactQuery = contactQuery.eq('centros_custo_id', ccId);
    } else {
      contactQuery = contactQuery.eq('membro_id', membroId);
    }

    const { data: existingContact, error: selErr } = await contactQuery.maybeSingle();

    if (selErr) {
      console.error('[Conversas] Erro ao buscar contato:', selErr);
    }

    if (existingContact) {
      contactId = existingContact.id;
      existingLeadId = existingContact.lead_id;
    }

    // 2. Criar contato apenas se não existe
    if (!contactId) {
      const { data: newContact, error: insErr } = await _supabase
        .from('contacts')
        .insert([{
          membro_id: membroId,
          centros_custo_id: ccId,
          phone,
          name: name || phone,
          lead_id: leadId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select('id')
        .single();

      if (insErr) {
        console.error('[Conversas] Erro ao criar contato:', insErr);
        // Se erro de conflito (409), buscar o contato novamente
        if (insErr.code === '23505') {
          const { data: retryContact } = await contactQuery.maybeSingle();
          if (retryContact) contactId = retryContact.id;
        }
      } else if (newContact) {
        contactId = newContact.id;
      }
    }

    // 3. Atualizar dados do contato se já existia
    if (contactId && existingContact) {
      const updates = { updated_at: new Date().toISOString() };
      if (name) updates.name = name;
      if (leadId && !existingLeadId) updates.lead_id = leadId;
      if (Object.keys(updates).length > 1) {
        await _supabase.from('contacts').update(updates).eq('id', contactId);
      }
    }

    if (!contactId) {
      toast('Erro ao criar contato');
      return;
    }

    // 4. Criar conversa
    const { data: newConv, error: convError } = await _supabase
      .from('conversations')
      .insert([{
        membro_id: membroId,
        contact_id: contactId,
        centros_custo_id: ccId,
        lead_id: leadId,
        status: 'open',
        unread_count: 0,
        last_message_text: message || null,
        last_message_at: message ? new Date().toISOString() : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select('id')
      .single();

    if (convError) throw convError;

    // 5. Enviar primeira mensagem via WhatsApp se existir
    if (message) {
      // Buscar instanceName
      let instName = null;
      try {
        const { data: waCfg } = await _supabase
          .from('whatsapp_config')
          .select('provider_config')
          .eq('provider', 'evolution_api')
          .eq('status', 'connected')
          .eq('centros_custo_id', ccId)
          .maybeSingle();
        instName = waCfg?.provider_config?.instanceName || null;
      } catch (e) { /* fallback: Edge Function busca */ }
      const num = phone ? `55${phone}` : null;
      await waSendText(membroId, newConv.id, message, ccId, num, instName);
    }

    toast('Conversa criada');
    _convCloseNewModal();
    await loadConversasChats();
    _convSelectChat(newConv.id);

  } catch (err) {
    console.error('[Conversas] Erro ao criar conversa:', err);
    toast('Erro ao criar conversa');
  }
}
function _convLeadSearch() {
  const term = ($('#convNewLeadSearch')?.value || '').toLowerCase();
  const results = $('#convNewLeadResults');
  if (!results) return;
  if (!term) { results.innerHTML = ''; return; }

  const matches = conversasState.leads.filter(l =>
    (l.nome || '').toLowerCase().includes(term) ||
    (l.telefone || '').toLowerCase().includes(term)
  ).slice(0, 5);

  results.innerHTML = matches.map(l => `
    <div class="conv-new-lead-item" data-lead-id="${l.id}" data-lead-name="${_convHtmlEscape(l.nome)}" data-lead-phone="${l.telefone || ''}">
      <i data-lucide="user" style="width:14px;height:14px;"></i>
      ${_convHtmlEscape(l.nome)}${l.telefone ? ' &middot; ' + l.telefone : ''}
    </div>`).join('');

  results.querySelectorAll('.conv-new-lead-item').forEach(el => {
    el.addEventListener('click', () => {
      document.getElementById('convNewLeadId').value = el.dataset.leadId;
      document.getElementById('convNewName').value = el.dataset.leadName;
      if (el.dataset.leadPhone) document.getElementById('convNewPhone').value = el.dataset.leadPhone;
      results.innerHTML = '';
    });
  });
  initIcons();
}

/* ---------- realtime ---------- */
let _convRefreshInterval = null;

function _convSubscribeRealtime() {
  if (conversasState.realtimeChannel) _supabase.removeChannel(conversasState.realtimeChannel);

  const membroId = currentUser.id;
  const ccId = conversasState.selectedCentroCustoId;
  if (!ccId) return;

  conversasState.realtimeChannel = _supabase
    .channel('conversas-realtime')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages'
    }, payload => {
      const newMsg = payload.new;
      const chat = conversasState.allChats.find(c => c._conversationId === newMsg.conversation_id);
      if (!chat) {
        // Conversa não está na lista (pode ser nova) — recarregar
        console.log('[Conversas] Mensagem para conversa desconhecida, recarregando:', newMsg.conversation_id);
        loadConversasChats();
        return;
      }

      const selectedConvId = conversasState.allChats.find(c => c.id === conversasState.selectedChatId)?._conversationId;
      if (newMsg.conversation_id === selectedConvId) {
        conversasState.messages.push(newMsg);
        _renderConvMessages();
      }

      chat.last_message = newMsg.content_text || (newMsg.content_type && newMsg.content_type !== 'text' ? `[${newMsg.content_type}]` : '');
      chat.last_message_at = newMsg.created_at;
      if (newMsg.conversation_id !== selectedConvId && newMsg.sender_type === 'contact') {
        chat.unread_count = (chat.unread_count || 0) + 1;
      }
      _convApplyFilter();
      _convUpdateStats();
    })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'conversations'
    }, payload => {
      const updated = payload.new;
      // Ignorar updates que não são desta empresa
      if (updated.centros_custo_id !== ccId) return;
      // REGRA: isolamento total — apenas minhas conversas
      if (updated.membro_id !== membroId) return;

      const idx = conversasState.allChats.findIndex(c => c._conversationId === updated.id || c.id === updated.id);
      if (idx >= 0) {
        conversasState.allChats[idx].unread_count = updated.unread_count || 0;
        conversasState.allChats[idx].last_message = updated.last_message_text || '';
        conversasState.allChats[idx].last_message_at = updated.last_message_at;
        conversasState.allChats[idx].status = updated.status;
        _convApplyFilter();
        if (updated.id === conversasState.selectedChatId || updated.id === conversasState.allChats[idx]._conversationId) {
          _renderConvChatHeader(conversasState.allChats[idx]);
          _renderConvCrmPanel(conversasState.allChats[idx]);
        }
      }
    })
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'conversations'
    }, payload => {
      const conv = payload.new;
      // Ignorar conversas de outra empresa
      if (conv.centros_custo_id !== ccId) return;
      // REGRA: isolamento total — apenas minhas conversas
      if (conv.membro_id !== membroId) return;
      // Já está na lista? Ignorar
      if (conversasState.allChats.some(c => c._conversationId === conv.id)) return;

      console.log('[Conversas] Nova conversa via realtime:', conv.id);
      // Recarregar lista para obter dados completos (contato, lead)
      loadConversasChats();
    })
    .subscribe();

  // Fallback: refresh a cada 15 segundos (Realtime pode falhar)
  if (_convRefreshInterval) clearInterval(_convRefreshInterval);
  _convRefreshInterval = setInterval(() => {
    if (activePage === 'conversas') {
      loadConversasChats();
    }
  }, 15000);
}

/* ---------- auto-resize textarea ---------- */
function _convAutoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
}

/* ---------- centro de custo dropdown ---------- */
async function _initConvCentroCustoDropdown() {
  const btn = $('#convCompanyDropdownBtn');
  const menu = $('#convCompanyDropdownMenu');
  const label = $('#convSelectedCompanyLabel');
  if (!btn || !menu || !label) return;

  // Limpar listeners antigos
  btn.onclick = null;
  menu.onclick = null;

  // Buscar centros de custo do membro
  const { data: mccData } = await _supabase
    .from('membro_centros_custo')
    .select('centro_custo_id, centros_custo(id, nome)')
    .eq('membro_id', currentUser.id);

  const list = (mccData || [])
    .map(r => r.centros_custo)
    .filter(Boolean)
    .sort((a, b) => a.nome.localeCompare(b.nome));

  conversasState.centrosCustoList = list;

  if (list.length === 0) {
    label.textContent = 'Sem centros de custo';
    btn.disabled = true;
    return;
  }

  // Função unificada de troca de empresa
  const handleCompanyChange = async (companyId) => {
    // 'all' = todas as empresas (resetar filtro)
    const effectiveId = companyId === 'all' ? null : companyId;

    // 1. Atualizar estado global imediatamente
    conversasState.selectedCentroCustoId = effectiveId;
    conversasState.selectedCompanyId = effectiveId;

    // 2. Persistir no localStorage
    if (effectiveId) {
      localStorage.setItem('crm_selected_company_id', effectiveId);
    } else {
      localStorage.removeItem('crm_selected_company_id');
    }

    // 3. Atualizar label do botão
    if (!effectiveId) {
      label.textContent = 'Todas as Empresas';
    } else {
      const found = list.find(cc => cc.id === effectiveId);
      label.textContent = found ? found.nome : 'Selecione a empresa...';
    }

    // Marcar item ativo no menu
    menu.querySelectorAll('.filter-dropdown-item').forEach(item => {
      item.classList.toggle('active', item.dataset.cc === companyId);
    });

    // 4. Feedback visual de carregamento imediato
    const chatList = document.getElementById('convChatList') || $('#convChatList');
    if (chatList) {
      chatList.innerHTML = '<div class="conv-loading-state"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>';
    }

    // 5. Resetar chat ativo se pertencer a outra empresa
    conversasState.allChats = [];
    conversasState.chats = [];
    conversasState.selectedChatId = null;
    conversasState.messages = [];
    conversasState.instanceName = null;
    const chatEmpty = document.getElementById('convChatEmpty');
    const chatContent = document.getElementById('convChatContent');
    if (chatEmpty) chatEmpty.style.display = '';
    if (chatContent) chatContent.style.display = 'none';

    // 6. Buscar instanceName e carregar conversas
    _convSubscribeRealtime();
    await loadConversasChats();
  };

  // Renderizar opções do menu
  const canShowAll = list.length > 1;
  menu.innerHTML = '';
  if (canShowAll) {
    const allBtn = document.createElement('button');
    allBtn.className = 'filter-dropdown-item';
    allBtn.dataset.cc = 'all';
    allBtn.textContent = 'Todas as Empresas';
    menu.appendChild(allBtn);
  }
  list.forEach(cc => {
    const item = document.createElement('button');
    item.className = 'filter-dropdown-item';
    item.dataset.cc = cc.id;
    item.textContent = cc.nome;
    menu.appendChild(item);
  });

  // Abrir/fechar menu no clique do botão (1 clique)
  btn.onclick = (e) => {
    e.stopPropagation();
    // Fechar outros dropdowns abertos
    $$('.filter-dropdown').forEach(d => { if (d !== menu) d.classList.remove('open'); });
    menu.classList.toggle('open');
  };

  // Selecionar opção no clique
  menu.onclick = (e) => {
    const item = e.target.closest('.filter-dropdown-item');
    if (!item) return;
    e.stopPropagation();
    const val = item.dataset.cc || 'all';
    menu.classList.remove('open');
    handleCompanyChange(val);
  };

  // Fechar ao clicar fora
  const closeConvDropdown = (e) => {
    if (!btn.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.remove('open');
    }
  };
  document.removeEventListener('click', closeConvDropdown);
  document.addEventListener('click', closeConvDropdown);

  // Determinar empresa-alvo para auto-seleção na inicialização
  let initialTargetId = null;

  if (_pendingConvNavigation?.centroCustoId && list.some(cc => cc.id === _pendingConvNavigation.centroCustoId)) {
    initialTargetId = _pendingConvNavigation.centroCustoId;
  } else {
    const savedCompanyId = localStorage.getItem('crm_selected_company_id');
    if (savedCompanyId && list.some(cc => cc.id === savedCompanyId)) {
      initialTargetId = savedCompanyId;
    } else if (list.length === 1) {
      initialTargetId = list[0].id;
    }
  }

  if (initialTargetId) {
    conversasState.selectedCentroCustoId = initialTargetId;
    conversasState.selectedCompanyId = initialTargetId;
    localStorage.setItem('crm_selected_company_id', initialTargetId);
    await handleCompanyChange(initialTargetId);
  } else {
    // Nenhuma empresa selecionada: mostrar "Todas as Empresas" ou placeholder
    label.textContent = canShowAll ? 'Todas as Empresas' : list[0].nome;
    menu.querySelector('.filter-dropdown-item')?.classList.add('active');
  }

  if (typeof initIcons === 'function') initIcons();
}

/* ---------- load members for assignee dropdown ---------- */
async function _loadConvMembers() {
  try {
    const { data, error } = await _supabase
      .from('membros')
      .select('id, nome')
      .eq('status', 'Ativo')
      .order('nome');
    if (!error && data) conversasState.members = data;
  } catch (e) {
    console.error('[Conversas] Erro ao carregar membros:', e);
  }
}

/* ---------- init ---------- */
function initConversas() {
  const searchInput = $('#convSearchInput');
  const sendBtn = $('#convSendBtn');
  const msgInput = $('#convMessageInput');
  const newBtn = $('#btnConvNew');
  const newCloseBtn = $('#btnConvNewClose');
  const newOverlay = $('#convNewOverlay');
  const newSubmitBtn = document.querySelector('#btnConvNewConfirm');
  const leadSearch = $('#convNewLeadSearch');
  const refreshBtn = $('#btnConvRefresh');
  const unidentifiedBtn = $('#convUnidentifiedBtn');

  if (searchInput) {
    let debounce;
    searchInput.addEventListener('input', e => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { conversasState.searchTerm = e.target.value; _convApplyFilter(); }, 150);
    });
  }

  if (sendBtn) sendBtn.addEventListener('click', _convSendMessage);
  if (msgInput) {
    msgInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _convSendMessage(); }
    });
    msgInput.addEventListener('input', () => _convAutoResize(msgInput));
  }

  // Media: file input e microfone
  const fileInput = $('#convFileInput');
  const attachBtn = $('#btnConvAttach');
  const micBtn = $('#btnConvMic');
  if (fileInput) fileInput.addEventListener('change', _convHandleFileSelect);
  if (attachBtn) attachBtn.addEventListener('click', () => fileInput?.click());
  if (micBtn) micBtn.addEventListener('click', _convToggleRecording);

  if (newBtn) newBtn.addEventListener('click', _convOpenNewModal);
  if (newCloseBtn) newCloseBtn.addEventListener('click', _convCloseNewModal);
  if (newOverlay) newOverlay.addEventListener('click', _convCloseNewModal);
  if (newSubmitBtn) newSubmitBtn.addEventListener('click', _convCreateChat);
  const newCancelBtn = document.getElementById('btnConvNewCancel');
  if (newCancelBtn) newCancelBtn.addEventListener('click', _convCloseNewModal);
  if (leadSearch) leadSearch.addEventListener('input', _convLeadSearch);
  if (refreshBtn) refreshBtn.addEventListener('click', loadConversasChats);
  if (unidentifiedBtn) {
    unidentifiedBtn.addEventListener('click', () => {
      conversasState.filter = 'unidentified';
      _convApplyFilter();
      _renderConvFilterChips();
    });
  }

  _renderConvFilterChips();
  _loadConvMembers();
  _initConvCentroCustoDropdown().then(() => _processConvDeepLink());
  _convSubscribeRealtime();
}

/* ---------- deep-link CRM → Conversas ---------- */
function _processConvDeepLink() {
  if (!_pendingConvNavigation) return;

  const nav = _pendingConvNavigation;
  _pendingConvNavigation = null;

  const rawLeadPhone = nav.phone;
  const leadId = nav.leadId;
  const leadName = nav.leadName;
  const directConvId = nav.conversationId;

  // Normalizar telefone: remover não-dígitos, pegar últimos 10 dígitos (DDD + número)
  function normPhone(p) {
    const digits = (p || '').replace(/\D/g, '');
    return digits.slice(-10);
  }

  // Se temos conversationId direto, selecionar imediatamente
  if (directConvId) {
    const directMatch = conversasState.allChats.find(c => c._conversationId === directConvId || c.id === directConvId);
    if (directMatch) {
      conversasState.filter = 'all';
      conversasState.searchTerm = '';
      const searchInput = $('#convSearchInput');
      if (searchInput) searchInput.value = '';
      _convApplyFilter();
      _renderConvFilterChips();
      requestAnimationFrame(() => { _convSelectChat(directMatch.id); });
      return;
    }
  }

  const leadPhoneNorm = normPhone(rawLeadPhone);
  console.log('[DeepLink] Lead phone (raw):', rawLeadPhone, '| normalized:', leadPhoneNorm);
  console.log('[DeepLink] allChats count:', conversasState.allChats.length);

  // Buscar conversa existente pelo telefone (comparação por últimos 10 dígitos)
  const match = conversasState.allChats.find(c => {
    const cPhoneNorm = normPhone(c.contact_phone);
    console.log('[DeepLink] Comparing:', cPhoneNorm, '===', leadPhoneNorm, '→', cPhoneNorm === leadPhoneNorm);
    return cPhoneNorm && cPhoneNorm === leadPhoneNorm;
  });

  console.log('[DeepLink] Match found:', !!match, match?.id);

  if (match) {
    // Forçar filtro 'all' para garantir que o chat apareça na lista renderizada
    conversasState.filter = 'all';
    conversasState.searchTerm = '';
    const searchInput = $('#convSearchInput');
    if (searchInput) searchInput.value = '';
    _convApplyFilter();
    _renderConvFilterChips();

    // Aguardar um tick para o DOM renderizar a lista antes de selecionar
    requestAnimationFrame(() => {
      _convSelectChat(match.id);
    });
  } else {
    // Abrir modal de nova conversa com dados pré-preenchidos
    _convOpenNewModal();
    const phoneEl = document.getElementById('convNewPhone');
    const nameEl = document.getElementById('convNewName');
    const leadIdEl = document.getElementById('convNewLeadId');
    if (phoneEl) phoneEl.value = rawLeadPhone;
    if (nameEl) nameEl.value = leadName;
    if (leadIdEl) leadIdEl.value = leadId;
  }
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

    // Carregar cadências do banco de dados (para CRM dinâmico)
    try {
      await loadDbCadencias();
      console.log('[Boot] Cadências do DB carregadas:', _dbCadenciasCache.length);
    } catch (err) {
      console.error('[Boot] Erro ao carregar cadências do DB:', err);
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

/* ====================================================
   CONTRATOS — MÓDULO COMPLETO
   ==================================================== */

// State
let _contratosData = [];
let _contratosLeadsList = [];
let _contratosInited = false;
let _currentContratoData = null; // contrato em edição
let _contratoSaving = false; // debounce:防止 duplo clique

// Modal close / dirty state
let _contratoFormSnapshot = null;
let _contratoPreviousFocus = null;

/* ---- Helpers ----- */
function _friendlyContratoError(err) {
  if (!err) return 'desconhecido';
  if (err.code === '23505') return 'número de contrato duplicado. Aguarde um instante e tente novamente.';
  if (err.code === '23503') return 'referência inválida (lead ou empresa).';
  if (err.code === '23514') return 'dados fora do formato esperado.';
  if (err.message) return err.message;
  return 'erro inesperado. Tente novamente.';
}
function fmtDateBR(dateStr) {
  if (!dateStr) return '';
  try {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  } catch { return dateStr; }
}

function dataExtenso(dateStr) {
  if (!dateStr) return '';
  try {
    const [y, m, d] = dateStr.split('-');
    const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    return `${d} de ${meses[parseInt(m, 10) - 1]} de ${y}`;
  } catch { return dateStr; }
}

function fmtTimeBR(timeStr) {
  if (!timeStr) return '';
  return timeStr.substring(0, 5);
}

function fmtCurrency(val) {
  if (val === null || val === undefined || val === '') return 'R$ 0,00';
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function numeroExtenso(valor) {
  if (!valor || isNaN(valor)) return 'zero reais';
  const n = parseFloat(valor);
  const inteiro = Math.floor(n);
  const centavos = Math.round((n - inteiro) * 100);

  const unidades = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
    'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const dezenas = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const centenas = ['', 'cem', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

  function converteGrupo(n) {
    if (n === 0) return '';
    if (n < 20) return unidades[n];
    if (n < 100) {
      const d = Math.floor(n / 10);
      const u = n % 10;
      return dezenas[d] + (u ? ' e ' + unidades[u] : '');
    }
    const c = Math.floor(n / 100);
    const resto = n % 100;
    if (n === 100) return 'cem';
    return centenas[c] + (resto ? ' e ' + converteGrupo(resto) : '');
  }

  let resultado = '';
  if (inteiro === 0) {
    resultado = 'zero';
  } else if (inteiro < 1000) {
    resultado = converteGrupo(inteiro);
  } else if (inteiro < 1000000) {
    const milhar = Math.floor(inteiro / 1000);
    const resto = inteiro % 1000;
    resultado = (milhar === 1 ? 'mil' : converteGrupo(milhar) + ' mil') + (resto ? ' e ' + converteGrupo(resto) : '');
  } else {
    resultado = inteiro.toString();
  }

  let reais = resultado + (inteiro === 1 ? ' real' : ' reais');
  if (centavos > 0) {
    reais += ' e ' + converteGrupo(centavos) + (centavos === 1 ? ' centavo' : ' centavos');
  }
  return reais;
}

function gerarNumeroContrato(seq) {
  return 'CT-' + String(seq).padStart(6, '0');
}

function contratoStatusBadge(status) {
  const map = {
    rascunho: { cls: 'status-rascunho', label: 'Rascunho' },
    gerado: { cls: 'status-gerado', label: 'Gerado' },
    enviado: { cls: 'status-enviado', label: 'Enviado' },
    assinado: { cls: 'status-assinado', label: 'Assinado' },
    cancelado: { cls: 'status-cancelado', label: 'Cancelado' },
    vencido: { cls: 'status-vencido', label: 'Vencido' }
  };
  const s = map[status] || { cls: '', label: status };
  return `<span class="badge ${s.cls}">${s.label}</span>`;
}

/* ---- Parse PostgreSQL array text for tipo_servico_id ----- */
function parseTipoServicoIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try { return JSON.parse(trimmed).filter(Boolean); } catch {}
    }
    return trimmed.replace(/^\{|\}$/g, '').split(',').map(id => id.trim()).filter(Boolean);
  }
  return [];
}

/* ---- Resolve service IDs to names using the same _servicosById map as CRM ----- */
function resolveServicoNamesFromLead(lead) {
  const ids = parseTipoServicoIds(lead.tipo_servico_id);
  if (!ids.length) return [];
  return ids.map(id => {
    if (window._servicosById && window._servicosById[id]) return window._servicosById[id].nome;
    if (typeof _servicosById !== 'undefined' && _servicosById[id]) return _servicosById[id].nome;
    return null;
  }).filter(Boolean);
}

/* ---- Load leads for the select (same table, same RLS, same filters as CRM) ----- */
async function loadContratoLeads() {
  if (!_supabase) return [];

  const canViewAll = typeof canViewAllData === 'function' ? canViewAllData() : false;
  const filterId = canViewAll ? null : (typeof getCurrentUserId === 'function' ? getCurrentUserId() : null);

  let data = null;
  let error = null;

  if (filterId && typeof filterId === 'string' && filterId.length === 36 && filterId.includes('-')) {
    const [r1, r2, r3] = await Promise.all([
      _supabase.from('leads').select('*').eq('membro_id', filterId).order('nome', { ascending: true }),
      _supabase.from('leads').select('*').eq('qualificador_id', filterId).order('nome', { ascending: true }),
      _supabase.from('leads').select('*').eq('owner_id', filterId).order('nome', { ascending: true })
    ]);
    const seen = new Set();
    data = [];
    for (const r of [r1, r2, r3]) {
      if (r.error && !error) error = r.error;
      for (const lead of (r.data || [])) {
        if (!seen.has(lead.id)) { seen.add(lead.id); data.push(lead); }
      }
    }
  } else {
    const result = await _supabase.from('leads').select('*').order('nome', { ascending: true });
    data = result.data;
    error = result.error;
  }

  if (error) { console.error('[Contratos] Erro ao carregar leads:', error.message, error.code); return []; }
  return data || [];
}

/* ---- Load contratos from Supabase ----- */
async function loadContratos(filters = {}) {
  if (!_supabase) return [];
  let q = _supabase.from('contratos').select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (filters.status) q = q.eq('status', filters.status);
  if (filters.centroCustoId) q = q.eq('centro_custo_id', filters.centroCustoId);
  if (filters.mesEvento) {
    const [y, m] = filters.mesEvento.split('-');
    const inicio = `${y}-${m}-01`;
    const fim = `${y}-${m}-31`;
    q = q.gte('data_evento', inicio).lte('data_evento', fim);
  }
  if (filters.busca) {
    const b = filters.busca.toLowerCase();
    // We do client-side filtering after fetch for simplicity
  }

  const { data, error } = await q;
  if (error) { console.error('[Contratos] Erro ao carregar contratos:', error); return []; }
  let list = data || [];

  if (filters.busca) {
    const b = filters.busca.toLowerCase();
    list = list.filter(c =>
      (c.contratante_nome || '').toLowerCase().includes(b) ||
      (c.contratante_cpf_cnpj || '').includes(b) ||
      (c.numero_contrato || '').toLowerCase().includes(b) ||
      (c.contratante_telefone || '').includes(b)
    );
  }

  return list;
}

/* ---- Create contrato atomically via RPC (number + insert in one transaction) ----- */
async function createContratoViaRPC(payload) {
  if (!_supabase) throw new Error('Supabase não disponível');
  const { data, error } = await _supabase.rpc('create_contrato_with_number', { p_data: payload });
  if (error) throw error;
  return data;
}

/* ---- Render table ----- */
function renderContratosTable(list) {
  const tbody = document.querySelector('#tableContratos tbody');
  if (!tbody) return;

  if (!list || list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;opacity:0.5;padding:24px;">Nenhum contrato encontrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(c => {
    const servicoDesc = c.descricao_servicos || (Array.isArray(c.servicos) ? c.servicos.join(', ') : '') || '—';
    const dataEvento = fmtDateBR(c.data_evento);
    const geradoEm = c.gerado_em ? new Date(c.gerado_em).toLocaleDateString('pt-BR') : '—';
    const valor = fmtCurrency(c.valor_total);
    const pdfBtn = c.pdf_storage_path
      ? `<button class="btn-ghost btn-sm" onclick="contratoDownloadPDF('${c.id}')" title="Baixar PDF" aria-label="Baixar PDF"><i data-lucide="download"></i></button>`
      : `<button class="btn-ghost btn-sm" onclick="contratoGeneratePDF('${c.id}')" title="Gerar PDF" aria-label="Gerar PDF"><i data-lucide="file-text"></i></button>`;

    const canDelete = canManageContratos();
    const deleteAllowed = ['rascunho', 'cancelado'].includes(c.status);
    const deleteDisabled = canDelete && !deleteAllowed;
    const deleteTitle = deleteDisabled
      ? 'Não é possível excluir contratos com este status'
      : 'Excluir contrato';
    const deleteBtn = canDelete
      ? `<button class="btn-ghost btn-sm${deleteDisabled ? ' btn-disabled' : ''}" onclick="contratoExcluir('${c.id}', '${c.numero_contrato || ''}', '${c.contratante_nome || ''}', '${c.status}')" title="${deleteTitle}" aria-label="${deleteTitle}"${deleteDisabled ? ' disabled' : ''}><i data-lucide="trash-2"></i></button>`
      : '';

    return `<tr>
      <td class="contract-number">${c.numero_contrato || '—'}</td>
      <td class="contract-client" title="${c.contratante_nome || ''}">${c.contratante_nome || '—'}</td>
      <td class="contract-service" title="${servicoDesc}">${servicoDesc}</td>
      <td class="contract-date">${dataEvento || '—'}</td>
      <td class="contract-value text-right">${valor}</td>
      <td>${contratoStatusBadge(c.status)}</td>
      <td class="contract-created-at">${geradoEm}</td>
      <td class="contract-actions">
        <button class="btn-ghost btn-sm" onclick="contratoEdit('${c.id}')" title="Editar" aria-label="Editar contrato"><i data-lucide="edit"></i></button>
        ${pdfBtn}
        ${deleteBtn}
        <button class="btn-ghost btn-sm contract-more-actions-button" data-contrato-actions="${c.id}" onclick="contratoAcoes('${c.id}', '${c.status}')" title="Mais ações" aria-label="Mais ações do contrato ${c.numero_contrato || ''}" aria-haspopup="menu" aria-expanded="false"><i data-lucide="more-vertical"></i></button>
      </td>
    </tr>`;
  }).join('');

  if (typeof initIcons === 'function') initIcons();
}

/* ---- Fill lead data into the modal form ----- */
function fillContratoFromLead(lead) {
  if (!lead) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };

  set('contratoNome', lead.nome || '');
  set('contratoCpfCnpj', lead.cpf_cnpj || lead.cpf || lead.cnpj || '');
  set('contratoEmail', lead.email || '');
  set('contratoTelefone', lead.telefone || '');
  set('contratoEndereco', lead.endereco || lead.endereco_residencial || '');
  set('contratoBairro', lead.bairro || '');
  set('contratoCidade', lead.cidade || '');
  set('contratoEstado', lead.estado || '');
  set('contratoCep', lead.cep || '');
  set('contratoEnderecoEvento', lead.endereco_evento || '');
  set('contratoQtdHoras', lead.quantidade_horas || '');
  if (lead.data_evento) set('contratoDataEvento', lead.data_evento);
  if (lead.hora_inicio) set('contratoHoraInicio', lead.hora_inicio.substring(0, 5));
  if (lead.hora_final) set('contratoHoraFim', lead.hora_final.substring(0, 5));
  if (lead.honorarios) set('contratoValorTotal', parseFloat(lead.honorarios) || '');

  const servicos = lead.servicos_selecionados || '';
  if (servicos) {
    set('contratoServicosDesc', servicos);
  } else {
    const nomesServicos = resolveServicoNamesFromLead(lead);
    set('contratoServicosDesc', nomesServicos.length ? nomesServicos.join(', ') : '');
  }
}

/* ---- Build the PDF HTML content (4-page A4 layout) ----- */
function _contratoHeader() {
  return `
  <header class="contrato-cabecalho">
    <div class="contrato-cabecalho__esquerda">
      <img src="data:image/png;base64,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" alt="Agência Blue PRO" class="contrato-cabecalho__logo">
    </div>
    <div class="contrato-cabecalho__direita">
      <strong>Agência Blue PRO</strong>
      <span>www.agenciabluepro.com.br</span>
      <span>Instagram: @agenciabluepro</span>
      <span>WhatsApp: (85) 99149-9320</span>
    </div>
  </header>`;
}

function _contratoFooter(pageNum, totalPages = 4) {
  return `
  <div class="contrato-rodape">
    <span>${pageNum} / ${totalPages}</span>
  </div>`;
}

function buildPDFContent(data) {
  const qtdParcelas = parseInt(data.quantidade_parcelas) || 1;
  const valorTotal = fmtCurrency(data.valor_total);
  const valorTotalExt = numeroExtenso(data.valor_total);

  let clausulaPag = '';
  if (qtdParcelas === 1) {
    const venc = fmtDateBR(data.parcelas?.[0]?.vencimento || '');
    const val = fmtCurrency(data.parcelas?.[0]?.valor || data.valor_total);
    const valExt = numeroExtenso(data.parcelas?.[0]?.valor || data.valor_total);
    clausulaPag = `O aluguel possui custo total de ${valorTotal} (${valorTotalExt}), a ser pago pela CONTRATANTE à CONTRATADA em parcela única no valor de ${val} (${valExt}), com vencimento em ${venc}.`;
  } else if (qtdParcelas === 2) {
    const p1 = data.parcelas?.[0];
    const p2 = data.parcelas?.[1];
    const venc1 = fmtDateBR(p1?.vencimento || '');
    const val1 = fmtCurrency(p1?.valor || '');
    const valExt1 = numeroExtenso(p1?.valor || 0);
    const venc2 = fmtDateBR(p2?.vencimento || '');
    const val2 = fmtCurrency(p2?.valor || '');
    const valExt2 = numeroExtenso(p2?.valor || 0);
    clausulaPag = `O aluguel possui custo total de ${valorTotal} (${valorTotalExt}), a ser pago pela CONTRATANTE à CONTRATADA em 2 parcelas: a primeira, no valor de ${val1} (${valExt1}), com vencimento em ${venc1}; e a segunda, no valor de ${val2} (${valExt2}), com vencimento em ${venc2}, um dia antes do evento.`;
  } else {
    const parcelasDesc = (data.parcelas || []).map((p, i) =>
      `${i + 1}ª parcela no valor de ${fmtCurrency(p.valor)} (${numeroExtenso(p.valor)}) com vencimento em ${fmtDateBR(p.vencimento)}`
    ).join('; ');
    clausulaPag = `O aluguel possui custo total de ${valorTotal} (${valorTotalExt}), a ser pago pela CONTRATANTE à CONTRATADA em ${qtdParcelas} parcelas: ${parcelasDesc}.`;
  }

  const rawDataEmissao = data.data_emissao || new Date().toISOString().split('T')[0];
  const dataEmissaoFormatada = fmtDateBR(rawDataEmissao);
  const dataEmissaoExtenso = dataExtenso(rawDataEmissao);

  const servico = data.descricao_servicos || '—';
  const nome = data.contratante_nome || '—';
  const cpfCnpj = data.contratante_cpf_cnpj || '—';
  const endereco = data.contratante_endereco || '—';
  const bairro = data.contratante_bairro || '—';
  const cidade = data.contratante_cidade || '—';
  const estado = data.contratante_estado || '—';
  const cep = data.contratante_cep || '—';
  const tel = data.contratante_telefone || '—';
  const dataEvento = fmtDateBR(data.data_evento);
  const horaInicio = fmtTimeBR(data.hora_inicio);
  const horaFim = fmtTimeBR(data.hora_fim);
  const qtdHoras = data.quantidade_horas || '—';
  const endEvento = data.endereco_evento || '—';

  const header = _contratoHeader();

  /* ==================== PÁGINA 1 ==================== */
  const page1 = `
  <div class="contrato-pagina">
    <div class="contrato-marca-dagua" aria-hidden="true"></div>
    <div class="contrato-pagina__conteudo">
      ${header}

      <h1 class="contrato-titulo">Contrato de Prestação de Serviços</h1>

      <p class="contrato-clausula">
        <strong>CONTRATANTE:</strong> ${nome}, inscrito(a) no CPF/CNPJ sob o nº ${cpfCnpj}, residente e domiciliado(a) no(a) ${endereco}, Bairro ${bairro}, Cidade ${cidade} – ${estado}, CEP ${cep}, telefone para contato: ${tel}, e-mail: ${data.contratante_email || 'Não informado'}.
      </p>

      <p class="contrato-clausula">
        <strong>CONTRATADA:</strong> Agência Blue Organização de Eventos e Inteligência Empresarial Ltda., inscrita no CNPJ sob o nº 59.417.603/0001-36, com sede na Av. Eng. Humberto Monte, 2929, Pici, Fortaleza/CE, CEP: 60.440-593.
      </p>

      <p class="contrato-clausula contrato-justificado">
        As partes acima identificadas têm, entre si, justo e acertado o presente Contrato de Prestação de Serviços, o qual se regerá pelas cláusulas seguintes e pelas condições descritas no presente instrumento.
      </p>

      <h2 class="contrato-secao-titulo">DO OBJETO DO CONTRATO</h2>

      <p class="contrato-clausula contrato-justificado">
        1.1. O presente contrato tem por objeto a prestação de serviços de <strong>${servico}</strong> por parte da CONTRATADA em favor da CONTRATANTE, conforme especificações abaixo:
      </p>

      <p class="contrato-servico-titulo">DESCRIÇÃO DO(S) SERVIÇO(S)</p>

      <div class="contrato-clausula contrato-justificado contrato-lista-container">
        <p>a) Serviço: <strong>${servico}</strong>;</p>
        <p>b) Data do evento: <strong>${dataEvento}</strong>;</p>
        <p>c) Horário: das <strong>${horaInicio}</strong> às <strong>${horaFim}</strong>;</p>
        <p>d) Duração total: <strong>${qtdHoras}</strong> hora(s);</p>
        <p>e) Local do evento: <strong>${endEvento}</strong>.</p>
      </div>

      <p class="contrato-clausula contrato-justificado">
        1.2. A CONTRATADA se compromete a realizar os serviços com zelo, responsabilidade e profissionalismo, fornecendo todo o material e equipamentos necessários para a execução dos trabalhos, bem como os profissionais qualificados para tal.
      </p>

      <h2 class="contrato-secao-titulo">DAS OBRIGAÇÕES DA CONTRATADA</h2>

      <p class="contrato-clausula contrato-justificado">
        2.1. A CONTRATADA compromete-se a executar os serviços descritos na Cláusula 1ª nas condições pactuadas no presente instrumento.
      </p>
      <p class="contrato-clausula contrato-justificado">
        2.2. A CONTRATADA deverá dispor de todos os equipamentos e profissionais necessários para a realização dos serviços contratados.
      </p>

    </div>
    ${_contratoFooter(1)}
  </div>`;

  /* ==================== PÁGINA 2 ==================== */
  const page2 = `
  <div class="contrato-pagina contrato-page-break">
    <div class="contrato-marca-dagua" aria-hidden="true"></div>
    <div class="contrato-pagina__conteudo">
      ${header}

      <p class="contrato-clausula contrato-justificado">
        2.3. A CONTRATADA deverá manter sigilo sobre todas as informações obtidas durante a execução do contrato.
      </p>
      <p class="contrato-clausula contrato-justificado">
        2.4. A CONTRATADA deverá entregar todos os materiais e resultados dos serviços contratados no prazo e condições pactuados.
      </p>

      <h2 class="contrato-secao-titulo">DAS OBRIGAÇÕES DA CONTRATANTE</h2>

      <p class="contrato-clausula contrato-justificado">
        3.1. A CONTRATANTE compromete-se a fornecer as informações e condições adequadas no local do evento para que a CONTRATADA possa realizar seus serviços com qualidade e dentro do prazo estipulado.
      </p>
      <p class="contrato-clausula contrato-justificado">
        3.2. A CONTRATANTE deverá efetuar os pagamentos conforme estabelecido neste contrato, nas datas e valores previstos.
      </p>
      <p class="contrato-clausula contrato-justificado">
        3.3. A CONTRATANTE é responsável por eventuais danos causados aos equipamentos da CONTRATADA por convidados do evento, sujeitando-se ao ressarcimento do valor de conserto ou reposição.
      </p>
      <p class="contrato-clausula contrato-justificado">
        3.4. A CONTRATANTE autoriza, desde já, o uso das imagens captadas no evento para composição do portfólio da CONTRATADA, podendo ser veiculadas em redes sociais, site e materiais promocionais, salvo acordo em contrário estabelecido por escrito.
      </p>
      <p class="contrato-clausula contrato-justificado">
        3.5. A CONTRATANTE deverá garantir acesso seguro e adequado ao local do evento para a equipe da CONTRATADA.
      </p>

    </div>
    ${_contratoFooter(2)}
  </div>`;

  /* ==================== PÁGINA 3 ==================== */
  const page3 = `
  <div class="contrato-pagina contrato-page-break">
    <div class="contrato-marca-dagua" aria-hidden="true"></div>
    <div class="contrato-pagina__conteudo">
      ${header}

      <h2 class="contrato-secao-titulo">DO CUSTO E DA FORMA DE PAGAMENTO</h2>

      <p class="contrato-clausula contrato-justificado">
        4.1. ${clausulaPag}
      </p>
      <p class="contrato-clausula contrato-justificado">
        4.2. Os pagamentos deverão ser realizados por meio de PIX, conforme os dados abaixo:
      </p>

      <div class="contrato-clausula contrato-lista-container">
        <p>Chave PIX: 59.417.603/0001-36</p>
        <p>Titular: Agência Blue Pro</p>
        <p>CNPJ: 59.417.603/0001-36</p>
        <p>Banco: Cora</p>
      </div>

      <p class="contrato-clausula contrato-justificado">
        4.3. O atraso no pagamento acarretará a incidência de multa de 2% sobre o valor devido, acrescido de juros de mora de 1% ao mês, calculados pro rata die.
      </p>

      <h2 class="contrato-secao-titulo">DO PRAZO E CRONOGRAMA</h2>

      <p class="contrato-clausula contrato-justificado">
        5.1. O prazo do presente contrato vigora a partir do dia <strong>${dataEmissaoFormatada}</strong>, extinguindo-se após a conclusão integral dos serviços e o cumprimento de todas as obrigações assumidas pelas partes.
      </p>
      <p class="contrato-clausula contrato-justificado">
        5.2. O presente contrato poderá ser prorrogado mediante acordo escrito entre as partes.
      </p>
      <p class="contrato-clausula contrato-justificado">
        5.3. Em caso de cancelamento por parte da CONTRATANTE com mais de 30 (trinta) dias de antecedência do evento, será devolvido o valor total pago. Caso o cancelamento ocorra com menos de 30 (trinta) dias, o valor total do contrato será devido integralmente.
      </p>

    </div>
    ${_contratoFooter(3)}
  </div>`;

  /* ==================== PÁGINA 4 ==================== */
  const page4 = `
  <div class="contrato-pagina contrato-page-break">
    <div class="contrato-marca-dagua" aria-hidden="true"></div>
    <div class="contrato-pagina__conteudo">
      ${header}

      <h2 class="contrato-secao-titulo">DA RESCISÃO E ALTERAÇÃO DE CLÁUSULAS</h2>

      <p class="contrato-clausula contrato-justificado">
        6.1. Em caso de cancelamento por parte da CONTRATANTE, esta perderá o valor já pago a título de reserva de data e arcará com multa rescisória proporcional ao tempo faltante para o evento.
      </p>
      <p class="contrato-clausula contrato-justificado">
        6.2. Se o cancelamento ocorrer a menos de 30 (trinta) dias do evento, o valor total do contrato será devido integralmente.
      </p>
      <p class="contrato-clausula contrato-justificado">
        6.3. Em caso de cancelamento por parte da CONTRATADA, esta deverá devolver integralmente os valores recebidos e indenizar a CONTRATANTE pelos prejuízos comprovados.
      </p>
      <p class="contrato-clausula contrato-justificado">
        6.4. O cancelamento deverá ser comunicado por escrito, com antecedência mínima de 15 (quinze) dias do evento.
      </p>
      <p class="contrato-clausula contrato-justificado">
        6.5. Qualquer alteração neste contrato somente terá validade se feita por escrito e assinada por ambas as partes.
      </p>

      <h2 class="contrato-secao-titulo">DO FORO</h2>

      <p class="contrato-clausula contrato-justificado">
        7.1. Para dirimir quaisquer controvérsias oriundas do presente contrato, as partes elegem o foro da comarca de Fortaleza – CE, renunciando a qualquer outro, por mais privilegiado que seja.
      </p>

      <p class="contrato-clausula contrato-justificado" style="margin-top: 10mm;">
        Por estarem assim justos e contratados, assinam o presente instrumento em 2 (duas) vias de igual teor e forma.
      </p>

      <p class="contrato-clausula" style="text-align: right; margin-top: 6mm;">
        Fortaleza – CE, ${dataEmissaoExtenso}.
      </p>

      <div class="contrato-assinaturas">
        <div class="contrato-assinatura-col">
          <div class="contrato-assinatura-linha"></div>
          <p><strong>${nome}</strong></p>
          <p>CONTRATANTE</p>
        </div>
        <div class="contrato-assinatura-col">
          <div class="contrato-assinatura-linha"></div>
          <p><strong>Agência Blue Organização de Eventos</strong></p>
          <p>e Inteligência Empresarial Ltda.</p>
          <p>CONTRATADA</p>
        </div>
      </div>

    </div>
    ${_contratoFooter(4)}
  </div>`;

  return `<div class="contrato-documento">${page1}${page2}${page3}${page4}</div>`;
}

/* ---- Validate required fields (returns structured result) ----- */
const _contratoRequiredFields = [
  { id: 'contratoLeadId', label: 'Lead vinculado' },
  { id: 'contratoNome', label: 'Nome/Razão Social' },
  { id: 'contratoCpfCnpj', label: 'CPF/CNPJ' },
  { id: 'contratoTelefone', label: 'Telefone' },
  { id: 'contratoEndereco', label: 'Endereço completo' },
  { id: 'contratoBairro', label: 'Bairro' },
  { id: 'contratoCidade', label: 'Cidade' },
  { id: 'contratoEstado', label: 'Estado' },
  { id: 'contratoCep', label: 'CEP' },
  { id: 'contratoServicosDesc', label: 'Serviço contratado' },
  { id: 'contratoDataEvento', label: 'Data do evento' },
  { id: 'contratoHoraInicio', label: 'Horário de início' },
  { id: 'contratoHoraFim', label: 'Horário de encerramento' },
  { id: 'contratoQtdHoras', label: 'Quantidade de horas' },
  { id: 'contratoEnderecoEvento', label: 'Endereço do evento' },
  { id: 'contratoValorTotal', label: 'Valor total' },
  { id: 'contratoCondicaoPagamento', label: 'Condição de pagamento' },
];

function clearFieldErrors() {
  document.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));
  const leadCtrl = document.querySelector('.lead-searchable__control');
  if (leadCtrl) leadCtrl.classList.remove('field-error');
}

function highlightFieldErrors(fieldIds) {
  fieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('field-error');
      // For hidden lead input, also highlight the visual control
      if (id === 'contratoLeadId') {
        const ctrl = document.querySelector('.lead-searchable__control');
        if (ctrl) ctrl.classList.add('field-error');
      }
      const clearErr = () => {
        el.classList.remove('field-error');
        if (id === 'contratoLeadId') {
          const ctrl = document.querySelector('.lead-searchable__control');
          if (ctrl) ctrl.classList.remove('field-error');
        }
      };
      el.addEventListener('input', clearErr, { once: true });
      el.addEventListener('change', clearErr, { once: true });
      // For lead, also listen on the control click
      if (id === 'contratoLeadId') {
        const ctrl = document.querySelector('.lead-searchable__control');
        if (ctrl) ctrl.addEventListener('click', clearErr, { once: true });
      }
    }
  });
}

function validateContratoForm() {
  clearFieldErrors();
  const missing = [];
  _contratoRequiredFields.forEach(f => {
    const el = document.getElementById(f.id);
    const val = el ? (el.value || '').trim() : '';
    if (!val) missing.push(f);
  });
  if (missing.length) {
    highlightFieldErrors(missing.map(f => f.id));
  }
  return missing;
}

/* ---- Collect form data ----- */
function collectContratoFormData() {
  const condicao = parseInt(document.getElementById('contratoCondicaoPagamento')?.value || '1');
  const valorTotal = parseFloat(document.getElementById('contratoValorTotal')?.value || 0);
  const servicoDesc = document.getElementById('contratoServicosDesc')?.value || '';

  let parcelas = [];
  if (condicao === 1) {
    parcelas = [{ parcela: 1, valor: valorTotal, vencimento: document.getElementById('contratoVencimentoP1')?.value || '' }];
  } else if (condicao === 2) {
    parcelas = [
      { parcela: 1, valor: parseFloat(document.getElementById('contratoValorP1')?.value || 0), vencimento: document.getElementById('contratoVencimentoP1')?.value || '' },
      { parcela: 2, valor: parseFloat(document.getElementById('contratoValorP2')?.value || 0), vencimento: document.getElementById('contratoVencimentoP2')?.value || '' }
    ];
  }

  return {
    lead_id: document.getElementById('contratoLeadId')?.value || null,
    contratante_nome: document.getElementById('contratoNome')?.value || '',
    contratante_cpf_cnpj: document.getElementById('contratoCpfCnpj')?.value || '',
    contratante_email: document.getElementById('contratoEmail')?.value || '',
    contratante_telefone: document.getElementById('contratoTelefone')?.value || '',
    contratante_endereco: document.getElementById('contratoEndereco')?.value || '',
    contratante_bairro: document.getElementById('contratoBairro')?.value || '',
    contratante_cidade: document.getElementById('contratoCidade')?.value || '',
    contratante_estado: document.getElementById('contratoEstado')?.value || '',
    contratante_cep: document.getElementById('contratoCep')?.value || '',
    servico_principal: servicoDesc,
    descricao_servicos: servicoDesc,
    servicos: servicoDesc ? servicoDesc.split(',').map(s => s.trim()).filter(Boolean) : [],
    data_evento: document.getElementById('contratoDataEvento')?.value || null,
    hora_inicio: document.getElementById('contratoHoraInicio')?.value || null,
    hora_fim: document.getElementById('contratoHoraFim')?.value || null,
    quantidade_horas: parseFloat(document.getElementById('contratoQtdHoras')?.value || 0) || null,
    endereco_evento: document.getElementById('contratoEnderecoEvento')?.value || '',
    valor_total: valorTotal,
    quantidade_parcelas: condicao,
    parcelas,
    data_emissao: new Date().toISOString().split('T')[0],
    membro_id: currentUser?.id || null,
    owner_id: currentUser?.id || null,
    centro_custo_id: currentUser?.centro_custo_ids?.[0] || null
  };
}

/* ---- Searchable Lead Selector ----- */
function _resetLeadSearchable() {
  const hidden = document.getElementById('contratoLeadId');
  if (hidden) hidden.value = '';
  const placeholder = document.getElementById('leadSearchPlaceholder');
  const value = document.getElementById('leadSearchValue');
  if (placeholder) { placeholder.style.display = ''; placeholder.textContent = 'Pesquisar por nome, CPF/CNPJ ou telefone...'; }
  if (value) value.style.display = 'none';
  const dropdown = document.getElementById('leadSearchDropdown');
  if (dropdown) dropdown.style.display = 'none';
  const input = document.getElementById('leadSearchInput');
  if (input) input.value = '';
  const control = document.getElementById('leadSearchControl');
  if (control) control.setAttribute('aria-expanded', 'false');
}

function _selectLeadById(leadId) {
  const lead = _contratosLeadsList.find(l => l.id === leadId);
  if (!lead) return;
  const hidden = document.getElementById('contratoLeadId');
  if (hidden) hidden.value = lead.id;
  const placeholder = document.getElementById('leadSearchPlaceholder');
  const value = document.getElementById('leadSearchValue');
  if (placeholder) placeholder.style.display = 'none';
  if (value) {
    value.style.display = '';
    value.innerHTML = `<strong>${lead.nome || '—'}</strong>${lead.telefone ? ' <span style="opacity:0.6;margin-left:6px;">' + lead.telefone + '</span>' : ''}`;
  }
}

function _renderLeadSearchOptions(filter) {
  const container = document.getElementById('leadSearchOptions');
  if (!container) return;
  const b = (filter || '').toLowerCase();
  const list = b ? _contratosLeadsList.filter(l =>
    (l.nome || '').toLowerCase().includes(b) ||
    (l.cpf_cnpj || l.cpf || l.cnpj || '').includes(b) ||
    (l.telefone || '').includes(b)
  ) : _contratosLeadsList;

  if (!list.length) {
    container.innerHTML = '<div class="lead-searchable__empty">Nenhum lead encontrado.</div>';
    return;
  }

  container.innerHTML = list.map(l => {
    const cpf = l.cpf_cnpj || l.cpf || l.cnpj || '';
    const tel = l.telefone || '';
    const meta = [cpf, tel].filter(Boolean).join(' · ');
    return `<div class="lead-searchable__option" role="option" data-lead-id="${l.id}">
      <div class="lead-searchable__option-name">${l.nome || '—'}</div>
      ${meta ? `<div class="lead-searchable__option-meta">${meta}</div>` : ''}
    </div>`;
  }).join('');
}

function _initLeadSearchable() {
  const control = document.getElementById('leadSearchControl');
  const dropdown = document.getElementById('leadSearchDropdown');
  const input = document.getElementById('leadSearchInput');
  const options = document.getElementById('leadSearchOptions');
  if (!control || !dropdown || !input || !options) return;

  control.addEventListener('click', () => {
    const isOpen = dropdown.style.display !== 'none';
    if (isOpen) {
      dropdown.style.display = 'none';
      control.setAttribute('aria-expanded', 'false');
    } else {
      dropdown.style.display = '';
      control.setAttribute('aria-expanded', 'true');
      input.value = '';
      _renderLeadSearchOptions();
      setTimeout(() => input.focus(), 10);
    }
  });

  control.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      control.click();
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
      control.setAttribute('aria-expanded', 'false');
    }
  });

  input.addEventListener('input', () => {
    _renderLeadSearchOptions(input.value);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dropdown.style.display = 'none';
      control.setAttribute('aria-expanded', 'false');
      control.focus();
    }
  });

  options.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-lead-id]');
    if (!opt) return;
    const leadId = opt.dataset.leadId;
    const lead = _contratosLeadsList.find(l => l.id === leadId);
    if (!lead) return;

    _selectLeadById(leadId);
    fillContratoFromLead(lead);

    dropdown.style.display = 'none';
    control.setAttribute('aria-expanded', 'false');
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!control.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
      control.setAttribute('aria-expanded', 'false');
    }
  });
}

/* ---- Open modal to create new contrato ----- */
async function openNovoContratoModal() {
  _currentContratoData = null;
  const idEl = document.getElementById('contratoId');
  if (idEl) idEl.value = '';
  const form = document.getElementById('formContrato');
  if (form) form.reset();
  const title = document.getElementById('modalContratoTitle');
  if (title) title.textContent = 'Gerar Contrato';
  // Reset parcela 2 rows
  ['rowParcelaVal2', 'rowParcelaVenc2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Reset lead searchable
  _resetLeadSearchable();

  // Reset upload UI
  _resetContratoUploadUI();

  // Populate lead list
  _contratosLeadsList = await loadContratoLeads();
  _renderLeadSearchOptions();

  _openContratoModal();
}

/* ---- Open modal to edit an existing contrato ----- */
async function contratoEdit(id) {
  if (!_supabase) return;
  const { data, error } = await _supabase.from('contratos').select('*').eq('id', id).single();
  if (error || !data) { toast('Erro ao carregar contrato.', 'error'); return; }

  _currentContratoData = data;
  const idEl = document.getElementById('contratoId');
  if (idEl) idEl.value = data.id;
  const title = document.getElementById('modalContratoTitle');
  if (title) title.textContent = 'Editar Contrato – ' + (data.numero_contrato || '');

  // Populate lead list and select current
  if (!_contratosLeadsList.length) _contratosLeadsList = await loadContratoLeads();
  _renderLeadSearchOptions();
  if (data.lead_id) {
    _selectLeadById(data.lead_id);
  }

  // Fill form
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('contratoNome', data.contratante_nome);
  set('contratoCpfCnpj', data.contratante_cpf_cnpj);
  set('contratoEmail', data.contratante_email);
  set('contratoTelefone', data.contratante_telefone);
  set('contratoEndereco', data.contratante_endereco);
  set('contratoBairro', data.contratante_bairro);
  set('contratoCidade', data.contratante_cidade);
  set('contratoEstado', data.contratante_estado);
  set('contratoCep', data.contratante_cep);
  set('contratoServicosDesc', data.descricao_servicos);
  set('contratoDataEvento', data.data_evento);
  set('contratoHoraInicio', data.hora_inicio ? data.hora_inicio.substring(0, 5) : '');
  set('contratoHoraFim', data.hora_fim ? data.hora_fim.substring(0, 5) : '');
  set('contratoQtdHoras', data.quantidade_horas);
  set('contratoEnderecoEvento', data.endereco_evento);
  set('contratoValorTotal', data.valor_total);

  const qtdParcelas = data.quantidade_parcelas || 1;
  const condicaoSel = document.getElementById('contratoCondicaoPagamento');
  if (condicaoSel) condicaoSel.value = String(Math.min(qtdParcelas, 2));
  const showP2 = qtdParcelas >= 2 ? '' : 'none';
  ['rowParcelaVal2', 'rowParcelaVenc2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = showP2;
  });

  const parcelas = data.parcelas || [];
  if (parcelas[0]) { set('contratoValorP1', parcelas[0].valor); set('contratoVencimentoP1', parcelas[0].vencimento); }
  if (parcelas[1]) { set('contratoValorP2', parcelas[1].valor); set('contratoVencimentoP2', parcelas[1].vencimento); }

  _openContratoModal();

  // Show signed PDF state if already uploaded
  _resetContratoUploadUI();
  if (data.assinado_storage_path) {
    _showContratoUploadDone(data.assinado_storage_path);
  }
}

/* ---- Internal helpers to open/close modals ----- */
const _contratoFormFields = [
  'contratoLeadId', 'contratoNome', 'contratoCpfCnpj', 'contratoTelefone',
  'contratoEmail', 'contratoEndereco', 'contratoBairro', 'contratoCidade',
  'contratoEstado', 'contratoCep', 'contratoServicosDesc', 'contratoDataEvento',
  'contratoHoraInicio', 'contratoHoraFim', 'contratoQtdHoras',
  'contratoEnderecoEvento', 'contratoValorTotal', 'contratoCondicaoPagamento',
  'contratoValorP1', 'contratoVencimentoP1', 'contratoValorP2', 'contratoVencimentoP2'
];

function _snapshotContratoForm() {
  return _contratoFormFields.map(id => {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }).join('|');
}

function _isContratoFormDirty() {
  if (!_contratoFormSnapshot) return false;
  return _snapshotContratoForm() !== _contratoFormSnapshot;
}

function _onContratoFormInput() {
  const form = document.getElementById('formContrato');
  if (form) form.dataset.dirty = 'true';
}

function _contratoModalFocusableEls() {
  const modal = document.getElementById('modalContrato');
  if (!modal) return [];
  return Array.from(modal.querySelectorAll(
    'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ));
}

function _contratoTrapFocus(e) {
  if (e.key !== 'Tab') return;
  const els = _contratoModalFocusableEls();
  if (!els.length) return;
  const first = els[0];
  const last = els[els.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
  } else {
    if (document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

function _contratoKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    _requestCloseContratoModal();
  }
  _contratoTrapFocus(e);
}

function _openContratoModal() {
  _contratoPreviousFocus = document.activeElement;
  _contratoFormSnapshot = _snapshotContratoForm();
  const form = document.getElementById('formContrato');
  if (form) form.dataset.dirty = 'false';

  const overlay = document.getElementById('contratoOverlay');
  const modal = document.getElementById('modalContrato');
  if (overlay) overlay.classList.add('open');
  if (modal) { modal.classList.add('open'); modal.scrollTop = 0; }
  if (typeof initIcons === 'function') initIcons();

  // Focus first field
  setTimeout(() => {
    const firstInput = modal?.querySelector('select:not([disabled]), input:not([disabled]):not([type="hidden"])');
    if (firstInput) firstInput.focus();
  }, 50);

  // Attach listeners
  if (form) form.addEventListener('input', _onContratoFormInput);
  if (form) form.addEventListener('change', _onContratoFormInput);
  document.addEventListener('keydown', _contratoKeydown);
}

function _closeContratoModal() {
  const overlay = document.getElementById('contratoOverlay');
  const modal = document.getElementById('modalContrato');
  if (overlay) overlay.classList.remove('open');
  if (modal) modal.classList.remove('open');

  // Remove listeners
  const form = document.getElementById('formContrato');
  if (form) { form.removeEventListener('input', _onContratoFormInput); form.removeEventListener('change', _onContratoFormInput); form.dataset.dirty = 'false'; }
  document.removeEventListener('keydown', _contratoKeydown);

  // Restore focus
  if (_contratoPreviousFocus && typeof _contratoPreviousFocus.focus === 'function') {
    _contratoPreviousFocus.focus();
  }
  _contratoFormSnapshot = null;
  _contratoPreviousFocus = null;
}

function _requestCloseContratoModal() {
  // Don't trigger if discard modal is already open
  const discardModal = document.getElementById('contratoDiscardModal');
  if (discardModal && discardModal.classList.contains('open')) return;

  if (_isContratoFormDirty()) {
    // Remove contrato modal keydown handler while discard modal is open
    document.removeEventListener('keydown', _contratoKeydown);
    _openContratoDiscardModal();
  } else {
    _closeContratoModal();
  }
}

/* ---- Discard confirmation modal ----- */
function _openContratoDiscardModal() {
  const overlay = document.getElementById('contratoDiscardOverlay');
  const modal = document.getElementById('contratoDiscardModal');
  if (overlay) overlay.classList.add('open');
  if (modal) { modal.classList.add('open'); }
  if (typeof initIcons === 'function') initIcons();
  setTimeout(() => {
    const cancelBtn = document.getElementById('contratoDiscardCancel');
    if (cancelBtn) cancelBtn.focus();
  }, 50);
  // Esc on discard modal closes it (back to form)
  document.addEventListener('keydown', _discardKeydownHandler);
}

function _discardKeydownHandler(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    _closeContratoDiscardModal();
  }
}

function _closeContratoDiscardModal() {
  const overlay = document.getElementById('contratoDiscardOverlay');
  const modal = document.getElementById('contratoDiscardModal');
  if (overlay) overlay.classList.remove('open');
  if (modal) modal.classList.remove('open');
  document.removeEventListener('keydown', _discardKeydownHandler);
  // Re-attach contrato modal keydown handler
  document.addEventListener('keydown', _contratoKeydown);
}

function _confirmContratoDiscard() {
  _closeContratoDiscardModal();
  _closeContratoModal();
}

/* ---- Save (insert/update) contrato ----- */
async function saveContrato(status = 'rascunho') {
  if (!_supabase) return null;
  if (_contratoSaving) return null;
  _contratoSaving = true;

  try {
    const formData = collectContratoFormData();
    const existingId = document.getElementById('contratoId')?.value || '';
    const dataHoje = new Date().toISOString().split('T')[0];

    const htmlContent = buildPDFContent({ ...formData, data_emissao: dataHoje });

    const payload = {
      ...formData,
      status,
      conteudo_contrato: htmlContent,
      updated_at: new Date().toISOString()
    };

    if (existingId) {
      const { data, error } = await _supabase.from('contratos').update(payload).eq('id', existingId).select().single();
      if (error) {
        console.error('[Contratos] Erro ao salvar:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          payload
        });
        toast('Erro ao salvar contrato: ' + _friendlyContratoError(error), 'error');
        return null;
      }
      return data;
    } else {
      const result = await createContratoViaRPC(payload);
      if (!result) {
        toast('Erro ao criar contrato.', 'error');
        return null;
      }
      return result;
    }
  } catch (err) {
    console.error('[Contratos] Erro ao salvar:', err);
    if (err.code === '23505') {
      toast('Já existe um contrato com este número. Atualizando número automaticamente…', 'error');
    } else {
      toast('Erro ao salvar contrato: ' + _friendlyContratoError(err), 'error');
    }
    return null;
  } finally {
    _contratoSaving = false;
  }
}

/* ---- Validate that a canvas has visible (non-white) content ----- */
function canvasHasVisibleContent(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let sampledPixels = 0;
  let visiblePixels = 0;

  // Sample every 20th pixel — lightweight and sufficient for text detection
  const totalPixelSlots = canvas.width * canvas.height;
  const step = 20;

  for (let pixel = 0; pixel < totalPixelSlots; pixel += step) {
    const idx = pixel * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];

    sampledPixels++;

    const isWhiteOrNearlyWhite = r > 245 && g > 245 && b > 245;
    if (a > 20 && !isWhiteOrNearlyWhite) {
      visiblePixels++;
    }
  }

  const visibleRatio = sampledPixels > 0 ? visiblePixels / sampledPixels : 0;

  console.log('[PDF] Diagnóstico visual do canvas:', {
    width: canvas.width,
    height: canvas.height,
    sampledPixels,
    visiblePixels,
    visibleRatio: visibleRatio.toFixed(6)
  });

  // At least 50 visible pixels AND a non-negligible ratio
  return visiblePixels >= 50 && visibleRatio > 0.0001;
}

/* ---- Generate PDF from a saved contrato ----- */
async function contratoGeneratePDF(id) {
  if (!_supabase) return;

  const { data: contrato, error } = await _supabase.from('contratos').select('*').eq('id', id).single();
  if (error || !contrato) { toast('Contrato não encontrado.', 'error'); return; }

  toast('Gerando PDF…', 'info');

  // ---- 1. Validate libraries ----
  const h2c = window.html2canvas;
  const { jsPDF } = window.jspdf || {};

  console.log('[PDF] html2canvas disponível:', typeof h2c);
  console.log('[PDF] jsPDF disponível:', typeof jsPDF);

  if (typeof h2c !== 'function') {
    toast('Biblioteca html2canvas não foi carregada.', 'error');
    return;
  }
  if (typeof jsPDF !== 'function') {
    toast('Biblioteca jsPDF não foi carregada.', 'error');
    return;
  }

  // ---- 2. Preload watermark image ----
  const watermarkUrl = 'data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/60lbSlACEQAAAAEAAElRanVtYgAAAB5qdW1kYzJwYQARABCAAACqADibcQNjMnBhAAAASStqdW1iAAAAR2p1bWRjMm1hABEAEIAAAKoAOJtxA3VybjpjMnBhOmY1OTA3MTEyLWJjZDYtNDk1OS1hMDJjLTljMzA3NGRiMmRmNAAAAA1BanVtYgAAAClqdW1kYzJhcwARABCAAACqADibcQNjMnBhLmFzc2VydGlvbnMAAAAJu2p1bWIAAABGanVtZEDLDDK7ikidpwsq1vR/Q2kTYzJwYS50aHVtYm5haWwuY2xhaW0AAAAAGGMyc2hDPp5BsS9B++bP0Qr96RA0AAAAFGJmZGIAaW1hZ2UvanBlZwAAAAlZYmlkYv/Y/+AAEEpGSUYAAQEAAAEAAQAA/9sAQwAUDg8SDw0UEhASFxUUGB4yIR4cHB49LC4kMklATEtHQEZFUFpzYlBVbVZFRmSIZW13e4GCgU5gjZeMfZZzfoF8/9sAQwEVFxceGh47ISE7fFNGU3x8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8/8AAEQgA2wEAAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A7KiiigAopaSgAopaKAEopaSgApaSigAopaKAEoopaAEopaKAEopaKAEopaKAEopaKAEoopaAEopaKAEopaKAEopaKAEopaKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACkpaa33T9KADev8AeH50b1/vD86o0U7CuXgwPQg06qlt/rPwq1SY0LRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAU1vut9KdTW+6fpQBRoooqyCW2/wBZ+FWqq23+s/CrVSykLRRRSGFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFJQAUU1nVPvGomuP7q/nTsOxPRVUzue4H4UedJ/e/SjlDlZaoqsJ3HXBp63AP3hiizCzJ6KarBhlTmlpCFooooAKa33W+lOprfdP0oAo0UUVZBLbf6z8KtVUhYI+W6YqRrn+6v51LKRPRVQzyHuB+FHnSf3v0osFy3RVUXDjrg/hUi3AP3hj6UWC5PRTVYMMqc0tIYtFFFABRRRQAUUUUAFFFJQAE461XknJ4TgetJNJuOB90frUVUkUkFFFFUUFFPETnov50pgf0H50XC5HRmlaN1+8pptK5m5dhQxU5BwasRThuG4PrVaikTcv0tVYpsfK/T19Ks1JQtNb7p+lLSN91vpQBRoooqyAooooAKKeIXP8P5077O/t+dIZFRTmjdeqmm0xChipyDg1YinDcNwfWq1FIZfpagglz8rdexqapKFooooAKKKKAEqKd9qYHU1LVWdsyH24poaI6KKKssciFzgfnVpI1ToOfWiNNigd+9OqGyGwopaKQhKikhVuRwampKAKLKVOCMGkq66Bxg/nVR0KHB/OqTJaG1LFKU4P3f5VFRQIvg5GR0oqpFKUODytWwQRkcipKK80OPmTp3FQVfqCWHPzIPqKaYNEKIXbAq0kaoOBz60RJsTHfvT6GwSCilopDEqKSFX5HBqakoAospU4I5pKtXCbl3DqKq1SJYA4OR1q7G29AapVPbNyV/GhgizRSUtSUFFFFACVSfl2+tXapOMO31qolREp0QzIv1ptOjOJFPvVFFylpKWszMKKKKACiiigBKRlDDB6UtFAFOSMxn1HY0yrzKGGCMiqksZjPqOxqkyWhlSRSlDg8rUdFAi8CCMjkUtVIpTGfUelWlYMMg5FKxVxaWkpaQwooooAKKKKAEIyCKoVeY4Un0FUaaEwqW3/ANaPpUVS24/e/hTYkWqWkpakoKKKKAEqtOuJM+tWaZMm9OOo6U0NFSiiirLLUMm9fcdakqirFTkHBqyk6tw3BqGjJMmopKKQxaSgkAZJxUElx2T86AC4k/hU896WKYN8rcH19arUVVibl+kIDDBGRUNvIT8p5x3qepKKksRjPqvrUdXyARgjIqpLEUORytUmS0R0+OQxnjp3FMopiLqOHGVNOqirFTlTg1ZSdW+98pqbFXJqKQc9KKQxaSgkAZJxUElwBwnJ9aAC4fA2DqetV6CcnJoqiQqxbLwW/CoFBYgDqauqoVQB2oYIWlooqSgooooAKSlooArzRfxL+IqCr1QyQZ5Tg+lUmUmVqKUgqcEYNJTMhQxHQkUvmP8A3j+dNooACSepzRRRQAUAEnA5NKqM5wozVqKIRj1b1pXHYWKPy1x3PWn0UtSUJQeRg0tFAFWWHb8y8j09Khq/UMkAbleDTTE0VqKVlKnDDFJVEigkdCRS+Y/94/nTaKAAknqc0UUUAFA56U5I2foPxqzHEI+ep9aVx2Ehi2DJ+8f0qWilqSgooooAKKKKACiiigApKWigBpUMMMAaia3U9CRU9JQBWNs3ZhR9nf1FWaKdxWK4tvVvyqRYEHbP1qSii4WAADgDFFLRSGFFFFABRRRQAUlLRQA0gEYIzUbQIemRU1JQBXNsezD8qT7M394VZop3FYgFt6t+Qp6wovbP1qSilcLBRS0UDCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigBKWkooAWiiigAoopKAFoopKAFpKKWgAooooAKKKKACikpaACiiigAooooAKKKKACiiigAoopKAFopKKAClopKAFoopKAP/2QAAALZqdW1iAAAALGp1bWRjYm9yABEAEIAAAKoAOJtxA2MycGEuaW5ncmVkaWVudC52MwAAAACCY2JvcqRscmVsYXRpb25zaGlwaHBhcmVudE9maGRjOnRpdGxla2lucHV0X2ltYWdlaWRjOmZvcm1hdGppbWFnZS9qcGVnamluc3RhbmNlSUR4LHhtcDppaWQ6OWRiZWVmOGMtNWY3Zi00ZDEwLTk4OTMtMDg4OWMzOTVhMTFhAAABa2p1bWIAAAApanVtZGNib3IAEQAQgAAAqgA4m3EDYzJwYS5hY3Rpb25zLnYyAAAAATpjYm9yoWdhY3Rpb25zgqJmYWN0aW9ua2MycGEub3BlbmVkanBhcmFtZXRlcnO/a2luZ3JlZGllbnRzgaJjdXJseC1zZWxmI2p1bWJmPWMycGEuYXNzZXJ0aW9ucy9jMnBhLmluZ3JlZGllbnQudjNkaGFzaFggm738EcNCyf5vgs9tezTwmp2E/u3Vy+kYMU6n0RmwXTr/o2ZhY3Rpb25rYzJwYS5lZGl0ZWRtc29mdHdhcmVBZ2VudL9kbmFtZW5GTFVYLjEgS29udGV4dP9xZGlnaXRhbFNvdXJjZVR5cGV4U2h0dHA6Ly9jdi5pcHRjLm9yZy9uZXdzY29kZXMvZGlnaXRhbHNvdXJjZXR5cGUvY29tcG9zaXRlV2l0aFRyYWluZWRBbGdvcml0aG1pY01lZGlhAAAAiWp1bWIAAABEanVtZGNib3IAEQAQgAAAqgA4m3ETYzJwYS5haS1kaXNjbG9zdXJlAAAAABhjMnNolz/VjqQVZXYA/JY8bG+iIwAAAD1jYm9yomltb2RlbE5hbWVuRkxVWC4xIEtvbnRleHRpbW9kZWxUeXBlcGMycGEudHlwZXMubW9kZWwAAACranVtYgAAAChqdW1kY2JvcgARABCAAACqADibcQNjMnBhLmhhc2guZGF0YQAAAAB7Y2JvcqVqZXhjbHVzaW9uc4GiZXN0YXJ0FGZsZW5ndGgZSV1kbmFtZW5qdW1iZiBtYW5pZmVzdGNhbGdmc2hhMjU2ZGhhc2hYIDR3TObZ1NI/yi3p8J2lLTjRV54qSj/HmzbwrldkTiCKY3BhZEkAAAAAAAAAAAAAAAMmanVtYgAAACdqdW1kYzJjbAARABCAAACqADibcQNjMnBhLmNsYWltLnYyAAAAAvdjYm9yp2ppbnN0YW5jZUlEeCx4bXA6aWlkOjczZjljNzk4LWRmNGQtNDYzZC04Yjg2LWViZTMxM2MxYzBlNHRjbGFpbV9nZW5lcmF0b3JfaW5mb79kbmFtZXVCbGFjayBGb3Jlc3QgTGFicyBBUEl3b3JnLmNvbnRlbnRhdXRoLmMycGFfcnNmMC42Ny4w/2lzaWduYXR1cmV4TXNlbGYjanVtYmY9L2MycGEvdXJuOmMycGE6ZjU5MDcxMTItYmNkNi00OTU5LWEwMmMtOWMzMDc0ZGIyZGY0L2MycGEuc2lnbmF0dXJlcmNyZWF0ZWRfYXNzZXJ0aW9uc4SiY3VybHgvc2VsZiNqdW1iZj1jMnBhLmFzc2VydGlvbnMvYzJwYS50aHVtYm5haWwuY2xhaW1kaGFzaFggQ5Fyw1LdPtdf196arvKpuwVY8rC10ZR+jD02QBRqgP6iY3VybHgtc2VsZiNqdW1iZj1jMnBhLmFzc2VydGlvbnMvYzJwYS5pbmdyZWRpZW50LnYzZGhhc2hYIJu9/BHDQsn+b4LPbXs08JqdhP7t1cvpGDFOp9EZsF06omN1cmx4KnNlbGYjanVtYmY9YzJwYS5hc3NlcnRpb25zL2MycGEuYWN0aW9ucy52MmRoYXNoWCAfKTnlWAygxCBDX79I2diTtG5gJIJefC76FPGL3f/CpKJjdXJseClzZWxmI2p1bWJmPWMycGEuYXNzZXJ0aW9ucy9jMnBhLmhhc2guZGF0YWRoYXNoWCAQlX+5n65kNFUmVlxbexp4TDj7WCRYnYFrBGkh9yEkdnNnYXRoZXJlZF9hc3NlcnRpb25zgaJjdXJseC1zZWxmI2p1bWJmPWMycGEuYXNzZXJ0aW9ucy9jMnBhLmFpLWRpc2Nsb3N1cmVkaGFzaFggZOHZX/zKtj/xlc3caSWfvBmsdiGQd8gmaGAzCVZ671VoZGM6dGl0bGVrc2FtcGxlLmpwZWdjYWxnZnNoYTI1NgAAOHVqdW1iAAAAKGp1bWRjMmNzABEAEIAAAKoAOJtxA2MycGEuc2lnbmF0dXJlAAAAOEVjYm9y0oRZDTqiATgkGCGCWQaBMIIGfTCCBGWgAwIBAgIMWJygruvVD879eVlKMA0GCSqGSIb3DQEBCwUAMFIxCzAJBgNVBAYTAkJFMRkwFwYDVQQKExBHbG9iYWxTaWduIG52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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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FABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAEA9RQAhQdqABVxQAtABSYEY96YDkwTQA7A9KACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKQEdMEOTvQA6gAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACkBHTYkOQ84oGOoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgApAR0wHJQA6gAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACkwI6YD1GBQAtABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFJgR96YEg6UAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFJgR9aYEg5FABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAIWA6mgBC/oKAAue1ACFieoFABuPrQABiOhoAQknqaAF3H1oAMnGM0AKHx1oAC+aAEDY6UAODg9aAFBzQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABSYEdMByHtQA6gAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgBhcnpQAlABQAUAFABQAUAFABQAUAFABQAUAFAChiKAHBx3oAWgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgApMCPnvTAcnWgB1ABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAMZiT1oAAueTQAlABQAUAFABQAUABJHQUAAJPUUAB4oAAc0AGfagAoAKACgAoAcrdjQA6gAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACkwIz1pgKvWgB9ABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAMAGeTQAFiaAEoAM0AIGz2oANwoAC4FACbx6UAKXHpQAgfnpQAufUUAGfY0ADNigBA/tQAu4UALQAUAFADkbjBoAdQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFJgR0xIVBk9aBj6ACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAYxzQAhoAQk+tADSc0AJn1oAKACgAwfSgA/GgAoAXPb+lACUALnPU0AJ+NABQAAkdKAHK1ADhQACgCQcigAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKTAjpgOQc5oAdQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAITQAygBpPoKQCE5NACUX0B6bhRdLcLoMj1ovEegBh60NRsDS7AGX1H50rIlp9g3Lnr+tN2CwocDnP60Ow9uggZfUUNob02QuRjg0XQr67Bux1b86d4j0fQXdkYNKVkDT6DcZ5oukIMd6YBQA5W7GgBwPtQBICCOKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgApMCOmA5M5oAdQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAM3c8etADWPOBQA3JxzSAQgngVW6KieYfGP4i+J9F8SL4e0C/NrHFbI8skajc7Nk9TnAAA6etduEpQnDU4cTW5NDjh8SfiFwW8W3hPswx/Kul0KaexzfWZW0HD4k/EH/obrz8Sv+FP2VLsJ4mp3E/4WT8Qj18W3f5r/hS9lT/lD61VXUD8SfiD1Hi+7H/Al/wo9jT/AJR/W6vcE+JfxD7eMLr8dv8AhT9jS/lKWJqdx4+JXxDPzHxdc/TK/wCFL2NL+Uh4mt3E/wCFkePm+94tu/8Avof4UKjTt8I/rVZDv+FkePMDHiu6/wC+h/hTVGH8o/rdUafiT8QCePF92B9V/wAKXsoP7IPFVRD8SfiAeD4uvD+K/wCFP2NNL4RfWqncgufiV8QViZx4wveB2cD+lHsadtENYmTep75osks2i2k08hZ3tY2dmPJJQZNeTO3Oz0YSlJalmpLCgB6HK0APSgB1ABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABSAjpgOQ84oAdQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAhOBmgBlADScnNABjBAzSYC8E+9CdthO54j8bgf+FiTMD/AMucOf8Avk16eE/hnmYtXmcpjb1rsbRyp2VhMA96Vx3YmB60czAMD0FHMw1DFHMw1uKMdCeKabDUOKfPILsDjHBpc8g1Ep87C4AAnApOTYaWGXqK1s4wPu0k9B01eR9JaCudCs/+vSLH/fArw5Xc2z2oX5SzSKCgBydKAJEoAdQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUgIz1pgOQd6AHUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAIwyKAGUAMHLcUMB5HelYBvIPNLToGljxL43sB8Q5Rj/l0h6/Q16mE+A8zEv3zkyc11HMJmgAoAKBPQKCAoLTuFF2MKBBQJ3FU4ORQC1GXXzW7cfw0dC6atI+kvD5xoVl/16Rf+gCvEn8bPYhsWKRYUAOSgB6HmgB9ABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQBGetAIelAC0AFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAI54oAZQAwZzQA4kCl1AaSM0K6Ek0jxL44HHxFnyOPscP8jXp4b4Ty8TrM5MgDpXUc6YUDCgAoJYUCVgoGgoGwoBBQOwqjjdQK+o25B+zscdjS7lQ+I+j9CB/sKyGP8Al0i/9AFeLP8AiM9ensWqRoFADkoAevWgB9ABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQBGetAD0OeKAFoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoARuhoAZQA3OSM0ABGSTmhAGMc5pX5thc1zxH44Hd8RJV/6c4T+hr08NfkPOxCvI5MnPauo5OoUDCgAoE0FArIKB6BQAUDCgBR93FC3Jauxt1k2zhv7pxS3uXTfvH0joOf7FswOn2SP/ANBFeNPWbZ7EErXLFSWFADkoAkTrQA6gAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAjPWgByDnNADqACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKAA9OlAEdADAfm696AHbs9BSExOp+Y0lsTG9jw/45jb8R5OetlD/I16uEX7s4q7945U8HFdJxLcKBhQIKBhQAUCCgNAoGFACjjtTQDLs/uH/wB00tosKa94+ktC/wCQFZY72kX/AKAK8ST95nswb5SwetIsKAHJQA9OtAD6ACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACkwI6YDk60AOoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAD0oAjoAZjJ4oACDQtwFwduDSdr6IUkjw/464PxHc/9OMJ/9Cr1MI7QPOrrU5Wuk41uFBQUAFABQAUAFABQIKBjlGRz60Evcbcj90wHdTTdrM1ha6PpDQCDoVl2/wBEi/8AQBXhz+NnrRWhYPXmkWFADk64oAkQd6AHUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFJgR0wQ5KAHUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUABoAjPWgBuCGzQA7HGKQmNBI6mha7smN7aniHxwG74iyf8AXnD/ACNephvgOLENXOVb7x+tdJxiUAFABQAUAFABQAUCsFAxyEAYoJaGznEDewNJ7GkNZI+j9BJ/sOyx/wA+kX/oArxZfGz1oJos0jQKAHJQBKnSgBaACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACkwI+e4xTAcmPSgB1ABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAwjB5oAaetACnPal1AaCw6+tGl7obt0PEPjccfESUelpF/wCgmvTwt+Q8zEr3jlWILEiuo5EJQMKBahQDCgAoGFABQAUAKvUUCew28P8Aorn/AGTQXSXvH0hoQJ0OzKnj7JH/AOgCvFlbnZ7ELcpZqSgoAclAEiHtQA6gAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgApMCM9aYDkPagB1ABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAxjluKAG96AFPFITE68GhNpEq9jw7448fEiY/8ATlCf0NephX7hwYj4jla6TjW4UDYUAgoGFABQKwUDCgAoEA69aBjLw/6K/wDuGk9iqXxH0noWf7AsgB/y6Rf+givFfxM9eGxYpFhQA5KAHqeaAH0AFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFJgRgnuKYDkHOaAHUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFADG6n60AMJ+bFADutLqAgz3HajR7B0PEPjiD/wsSRj/wA+cQ/Q16eGfunnV1dnKEYrqONCUAwoJCgsKACgAoAKACgm6bAdelBQ265tnH+zQ9i6Xxn0loHOh2R6f6HF/wCgivEl8b9T1oljrSLCgByUAOBwc0ASA5GaACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACkwI6YDk70AOoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKGBGTk5oAaQd2aAFJxzUvVgAPbFO1mS1ZHiHxvJ/4WHIO/2OI/oa9LDfAcFfSVjlXrrONbjaBsKDMKCwoAKAtcKBhQJhQJbir1H1oG9ht1xC3slD2LpP3j6Q0Ef8SOyGf+XSLH/fArxJX536nrwTLNIsKAHJQA6gByHtQA6gAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACkwI/wpgOSgB1ABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUABOOaAE3DrmgADA80AG4etAC9aADI6UAIWAoAN2eMUALmgAoAM0AFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAHpSewEdMBDnNAC9/wpPcBOAOOfwoWpN7s8P8Ajf8A8lFl/wCvOH+Rr1MKv3ZwYm3OcqxB6V0nGtxKBhQQ9woHcKAvbYKBhQMKACgVhV6j60A9hl2f9Hb6GjoaUl7yPpHQgTodl/16R/8AoArxJP3n6nrx2LNIoKAHJQA6gAoAUMR3oAUOe9AChgaAAuB2oAQP6igA3+1AC7xQAZFAAHFAAGU96AAEHpQAtABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABSYEdMB69OlAC0AFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAhYYzQABxjNABvFABvWgBA470ALvHagBpYnrQAlABQAEk9TQAu5vWgBM0AFABmgAyT1NAC7iO9ACZNADg/Y0ALvFABvX1oANynvQAtABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFACP900AMoAaSSaAFJHWkwEDdj/ADoskHLY8R+Nwx8RJR/06Rf+gmvUwv8ADPNxK945RhwOldJxxEoKCgmwUBYKAt2CgEtQoKCgAoAUdR9aEJ7DLzi1fJ7Gjoy6XxH0loR/4kdkuTn7JH/6AK8SV+d+p68FoWDwcUiwoAcnWgB1ABQAUAFABk0AFABQAUAFABQAUAFABQA4OR1oAXepoANw9aAFyPWgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgApMCOmA9SMYoAWgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgBGYDgUANJJ60AJQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQA5X7UAKHBOKAFBB6UAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAI/3aAGUAIfvUABAHSl1ATaB3pXbFds8R+OGf8AhYkn/XnF/I16uF/hnnYjc5RiDjHpXScaEoKCgAoAKBWCgYUAFABQAqnoMd6BWG3+DaPnspoiVS+I+kNDIbQ7M/8ATpH/AOgCvEm7TfqezF2iWT1pFBQAqdaAH0AFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABk+tABk9M0AKGI70AODjHJoAXIPSgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKTAjpghyUAOoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAQkDrQAbxQAhfPSgBtABQAUAFABQAUAGfagBCwFAAGyehoAWgAPNABQAUAFABQAfjQAUAIQ2eDQADdnk0ABYDsaADetACgg9DQAUAFABQAUALuI70AG5vWgBwbPWgBaACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKAGv0oAbQA0n58ZoAXIYYpAJxu6dBS6aCWx4j8bz/AMXElGf+XKH+Rr1cL/DODEWucpjHJrpOK+olAwoAKACgAoAKACgAoAVeooExt3zbsMcFaFoVS+I+kNBIOhWXb/RIv/QBXizV5M9iCbiWmABxUliUAAOKAHbz6CgADZ4oAdQAUAIc+tACbWJoAAAOc0ALn+dACbscc9aAAMQOTQAm49ifzoAMn1NAArkdaAF8z2oAA47igBwIIzQAUAFABQAUAFAChiKAFDg9aAHA56UAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUmBHTAcn9KAHUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFAASAMmgBhYmgBKACgAoAKACgBNw6CgBaAA9KAGkn1oATPqKADPoKAAE5oAA2OgoAN5oAUP2P50AOB4oAM460ANLHOcdKAE3H1oAC2e1ACZoAXJ6UAJmgAoAKAFGe2aAHigAoAKACgAoAASOlADt9AChgaAFoAKACgAoAKACgAoAKACgAoAKACgAoAKAEfpQAygBjdaAFGQM57dKEAmT0Pak12HZdDxL43kf8LDlx/wA+cOfyNenhP4Z5lf4zlW+6K6jjW42goKACgAoAKACgAoAKAAdRQD2Euv8Aj3Y56Zo6McNz6P0H/kB2X/XpF/6AK8Wb95ns03aBbzweah76A730AgdqENXEwfSmMKAFBI6UAODcZNACF/agBC5oATNAC5NABk+tACUAFABQAUAFABQAUAKCRQAqg9qAFyR2oAAwPegBaACgAoAKAFDEdKAHBwetAC0AFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFJgR0wHqBjNAC0AFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAdKAGl/SgBtABQAUAFABQAhYCgBGIxkGgAVgP/10AKSAM0AIWzwKAE3diKAEyPSgBevQUABBHagBKACgAwfSgA59KACgLMUgjrQOzEoEFABQAUAFABQAUAGcdKAFDkcUAODDuaAE3kdDQAoYHrQAoIPIoAKACgABI6UAPVgeKAFoAKACgAoAKACgAoAKACgAoAKACgAoARulADOp4oAa33qAAEYxS1YmroBg9aE20TFux4j8b/8Akokp/wCnSH+Rr08L8BwV/jOVfqK6jjXUbQUFABQAUAFABQAUAFABQLqJdn/R2H+yaOg6fxH0f4fOdDsf+vSL/wBAFeJP4mezD4EW2GKS3LjowHHNEkmErBk9OnrU6oSVhD1ppodwxzzTAX3z+lABj6/lQF0JQF0BGOtLmQuZBTTXYfMg570cyFzx7BT0tcvS1wxU37EvyCnddgugougvEKAuu4UWHYKL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AKACgAoAKQEdMB6AYyBQAtABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQA1l7gUANoAKACgBCgNADShHQUAJgjqKACgAoAKACgAoAKADNKyAMkdKLIXKgJJ70JWHZBTAASOhosAUrIFoGT60WQrICfaiyDlQZNFkFkFMYUAB6cUAFD1GwoEFABQAUAFABQA5UzyaAHUAFABQAoU5oAeBgUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAhUGgBpBHWgBKAAgHg0ANKDsaAG4I6igAoAKACgAoAKACgAoAKACgAoAKVkFkFMAzQFkFKyFyoM96LILIMmnZD3FB7ilYVkhOtMYUAFABQAUAFABQAUAKFJ7UAOCgc0ALQAUAABPQUAKo55FADwAO1ABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUmBHTAev0oAWgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKAE2j0oARkOeBQA3pQAUAFAAQD1FADWXHSgBtABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAKFJ7UAKEHc0AOAAGBQAUAABPQUAOCetADsY6UAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAYzQA1kxyKAG0AFABQAEZoAYVIPAoASgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAXax7UAKE9aAFCgdqAFoAKAHBPWgBQgoAXFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABSYEZ4NMB69OlAC0AFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFACEA9aADYKAGlD2FACEEUAFACFQaADYPU0ANKkdjQAmCOooAKACgAoAKACgAoAKACgAoAKACgAoAME9BQAu1j2oAUJ60ALsWgA2r6UALQAUAFADgnrQA4UAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFADSnPAoAaQR1oAKACgAoAQqD1oAQoR0oAbg+lABQAUAFABQAUAFABQAUAFABQAUAFABgnoKAHBCetAC7FoAAoHQUALQAUAFABQA5PWgB1ABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFJgRnrTBD0xigBaACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAIzxQA0oe1ACEEHGKAEoAKAAgHqKAE2LQAbBQAmw0AJsb0oACpHagBKAD6UALtb0oAXYfagACetAAUHY0AKFA7UALQAUAFABQAoBJwKAFCetAC7BQABQO1AC0AFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUABANACbBQAmygBChHQ0AJQAUAFACFQetABsFACeWfWgA2GgA2cUAGygBQoAxQAFc0AJsHrQAuwepoAAoHagBcAdBQAUAFABQAYPpQA4J60ALsFAAQKADb6UALQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUgIz1pgOTFADqACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKADFACbB60AJsPY0AJtPYUAGxvSgAKkUAJgjqKACgAoATaPSgBQAOgoAKACgAoAMH0oAKADBPQUAGDQAoB9KAHKMCgBaACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoACAaAGFCKAAqw7UAARj2oANjUAGxvSgA2n0oAQjHBoAKACgAoAKADB9KAF2n0oANhoAAvPIoAcFA7UAL+FABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABSYEdMB6dKAFoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKAEKg0AIUHagAKelABsPrQAuwUAG0dMUALgDnFABgUAIRnvQAAY4FAC0AFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABgelACbV9KAAqp7UAG0A5xQAtABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFICOmA5O9ADqACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKTAjpghyetADqACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKQEdMByHn8KAHUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUmBHTAcnWgB1ABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFJgRnrTAclADqACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKTAjPXpTAclADqACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKTAjpgOQc5oAdQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABSYEZ60wQ5O9ADqACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKTAjpgOTr1oAdQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABSYEdMB6jHNAC0AFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUmBHTAevSgBaACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKTAjpgPXpigBaACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKTAjpgPTpmgBaACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKTAjpgOTuKAHUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUmBHTAVRzmgBxPOKAFoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKAELAdTQAtABQAUmBGDntTAcn1oAGbJoAA+O1ADgQeRQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFABQAUAFADS/pQA0nPJoAepzQAtABSYEdMBVODQAMMUAJQAoJB4oAeCD3oACcUAJu4+tAAWA60AKCD0NABQAUAFABQAZHrQAm4etAC5HrQAAg9KADNABQAUAFAATigAzQAZFACbh60ALketABketACbl9aADcvrQAuR60AJkdM0ALmgBNwPANACkgdaADIoAKAE3L60ALketABkHvQAm5fWgBQQelABQAm5fWgADA9DQAtABQAZHrQAUAFABQAUABIHU0AJvX1oAQvg8GgAD+tABvGaAF3r60AG5fWgBcj1oAMg80AGR60AGR60AJvX1oACyjvQABlPegBaACgAoAM9qAEyOlAC0AFABnFABQAUAGaADIoATcPWgA3D1oACQKADevrQAb19aAAMD0NABuA6mgA3r60AG4ZoANw9aADevrQABgehoAXIzigAoAKACgAoAKACgAJA70AFABketACFgO9ABuFAAWAoAAwNABuHrQABgTQAbl9aADeuaADIFAC0AGQOpoAKADpQAZHrQAZoATcPWgBcj1oATcPWgBc96AGl8HGKADeMUAG89qAAP7UAG8UALvFABuFABuHrQAoIPQ0AGR60ABIHU0AGaAE3r60ANZielACUAFADk69KAHUAFJgRAkkg0wFoAKACgAoAVTjigALE9aAEyaAAknrQAAkdKADJFAChyKAAsT3oANx9aAEJJ6mgAoAM0AGTQAuT3oAA2KAF35oATd60AJk9jQAZPrQAZNABnnNAATmgAzQAUAFAByaAF980AJk+tABk+tABk+tABkigAoAKACgAoAKADJoAXJ9aAEoAKACgAoAMn1oAMn1oAXcfWgALE9aAEyR3oACc8mgAoAKACgAoAKACgAyaADJoACSetABkmgAoAKACgAzQAoYigALE0AG44xQAmT60AKCR0NABuPrQAmaAFDEUAKX9KAE3N60AJk0AFABQAUAFABQAUAFABQAZoAKACgAyfWgAoAASOhoAXc3rQAbm9aADe3rQAb29aAAknvQAlABk+tABk0AGaADNABQAUAFABQAUAFABQAoJHSgBCc0AAJFAASTyaADJoAMn1oAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgAoAKACgBUODigB9ABS6gQjhiBTEOoGGKADFAChSeaAFCe9ABs96ADZ70AGz3oANgx1oAChzQAmw0ALsPrQAeX70AHl+9ABsHrQAhTHegBQnqaAAJ70ABQetAChAO9ACeWfWgBNjelAChPU0AGwetAB5fvQAeX70ALsFABsFAAUU9KAAKBQAFQaADYO9ACeWOxoAPL96AE2GgBdh9aADYc9aAEKEUAJQAUALjtQAbTjNAAFJoAXYfWgA8v3oAPL96ADYaADYaAE2NQAbTQApQ0AJsNABsNABsIoATFABjFABQAYoAULnrQAuz/AGqAAp6GgBMe9ACYoAKACgAAzQAoX3/SgBdgxQAbBnrQAFB60AHl+9ABsPrQAmw0ALs96ADZnqaAFCDvQAjKAetADce9AC4ycCgA2+9AAVI60AJQAoGaADaaAF8s+tAAEPegA2e9AB5fvQAhQigA2n0oATBoAMUAFABQAYNACgE0ALsPrQAhQigA2mgA2mgAC5oAXy/egA8v1NAB5fvQAeX70AIUIoASgAoAUDPegAwaAFCdyaAApjoaAECk0ABXFAAFzQAbTmgA2GgA2mgBKACgAoAMGgAoAKAFAycUALsOOtAB5Z9aADy/egBCpFAAEJ70ALs96AEKEdKADafSgBKAFQZNAD6AEyT3pMCJTlqYh1AwBxQAAkUAOD80ALvHrQA0txigBykdaAAtjpQAm/npQAbxQAu4HvQAtACEgdaAE35PA/WgA3daAELc5AoAXdnmgBQcjNAAWA5oATePSgBQw9aAAsBzQAbh1zQAFgKAE3jFAC7x3oAN47UAJvFABvFAC7xmgAZsdBQAm/2oAA/rQApYAUABcdqADeKAAuKAGlyenFACcmgAoAXJoACxxigBQ2OKAFByM0ALQAhcCgBA470ALuX1oAAR1oAXrQA1z/8AroATJoAA5oAXdkcigAJOeKAAkUAJ9aAEoAVSRQA4HNACMT3FACcdxQAoBxxQAhBFAAQBQADrQAu7H+NAAXOeKAAtj1oAQuTQAofnBoAXcKADdxxQACgBScUANLZ6GgBCT3oASgBQT0oAAT2oAUnj/wCvQAmc0AOHAzigBCecUALvAoAAwPSgBc0AJuHrQAhfB/8Ar0AIW5zigA3elAAG7etACng8igBCR6frQAqkYzQAuc9KAFoARjjtQAm/mgAL0AIGoAdu9aAEDgmgBdwPegBcjpmgA/CgBmcigAIzzigBcDFACcigBckD/wCvQAhY5oAUOPSgALk9BQAgbFABuz1oAXNABvz2oAQncKAEoAKAF69KADHGTQAmaAFzg0ALuxxQAu7vQAm72oAQnJzQABiKAFLY6UAKCW7UAKRmgBpI7CgADgdqAEZyeKABTgik9gGKCG60xDqBhQAUAFABQAUAGTQAUAFABzQAvI6UAGW6ZoAD9aAEoAKACgAoAKADNAABmgBQD1oAT8aAAY70AB60AFABigBSuO9ACUAFACigBD1oAKACgAoAKACgAoAKACgAwfSgAoAKACgBQT0FAC4J5JoAaRjvQAUALtNABzQAYNACGgAoAKACgAoAKADPNABQAd6AFz60AGfegA7daAEBxQAEk9aACgAoAKACgAoAKACgAxQA4Htn9KAE3E9aAEyaACgAoAKACgAoAKACgABI6UAFAC7eM0AJ9KAFye9ACHFABQAUAFABQAvJ5oASgAwfSgBRn1oAcCSOtADTjqKAEoAKACgAoAMEUAKAM80ALxjigBGbNACUAGTjFAACQMUAGT69qADPqKACgAoAKACgAoAM0AFABQAUAFAADigAzQAUAFABmgBd1AB2oASgAoADQAUALknvQAlABQAUAA5OKTACBnI5HY0PQLBg4zii4C4PofyougDafSi6ANp/yKLoAKkdqLoBMH0ouAu0+lF0AbT/AJFFwFC+tFwAoPU/lRcAKCgA2jPf8qLgBX/OKLgJtP8AkU7oA2/5xSuAbT/kUXANp9f0ouAbff8ASi4Bt/zii4Bs9T+lFwFKc9f0ouAm0/5FFwDaf8ii4BtPr+lFwDaf8ii6ANv+cUXAXZ6mi4AUHbNFwE2n/IouABfX+VFwDb7/AKUXANp/yKLgG0/5FFwDaf8AIouAbT/kUXQBtP8AkUXANp/yKLoA2n/IougAL6/youApX/OKLgJtP+RRcA2n0ougDaf8ii6AAvqf0ouAoUd8/lRcBNv+cUXANv8AnFFwFC+/6UXANo96LsAKjt/Ki4AV/wA4ouAm0/5FF0Abf84ouAbfX+VFwDbRcA2n/IouAbKLgG33/Si4C7KLgJt/zii4BsNFwDaf8ii4BtP+RRdAG31P6UXAXaPU/lRcBNtFwDb/AJxRcA2+v8qLgLs9/wBKLgJtPr+lF0AbPei4BtP+RRcA2H1ouAbT6/pRcA2n/IougDaf8ii4BsPr+lFwDYfWi4BsPr+lFwDaf8ii4Bt9/wBKLgG33/Si6ANp/wAii6ANp/yKLgAT3/Si4Bs96LgLsOKLgGw96LgBT3ouAmw+tFwDafX9KLgG33/Si4C7B70XANo96LgG0e9FwDb/AJxRcBdo9/ypXAQqB607gJtouAuwd80XANlFwE2/5xRcA2n/ACKLgG0/5FFwDb7/AKUXANvvRcA2n/IougDaf8ii4C7Rjkn8qLgJtPf+VF0AbTRcA2n/ACKLoA2n1/Si6ANp7/youAbT/kUXANvv+lFwDaf8ii4BtP8AkUXANp/yKLgG33/Si4BtP+RRdAG33/Si4Bt/zii4BtP+RRdAG0/5FF0AbT/kUXQBtP8AkUXANvr/ACougDb/AJxRcA2/5xRcBdnvRcA2Ci4AV9P5UXATaRRdAG0/5FF0AbT/AJFF0AYxyT+dG4H/2Q==';
  const watermarkPreload = new Image();
  watermarkPreload.src = watermarkUrl;

  let watermarkOk = true;
  await new Promise((resolve) => {
    watermarkPreload.onload = resolve;
    watermarkPreload.onerror = () => {
      console.warn('[PDF] Marca-d\'água não pôde ser carregada. Gerando PDF sem marca-d\'água.');
      watermarkOk = false;
      resolve();
    };
  });

  // ---- 3. Create dedicated off-screen export container ----
  const htmlContent = contrato.conteudo_contrato || buildPDFContent(contrato);
  const A4_W_PX = 794;

  const exportRoot = document.createElement('div');
  exportRoot.id = 'contratoPdfExport';
  exportRoot.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    left: -100000px !important;
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
    width: ${A4_W_PX}px !important;
    height: auto !important;
    overflow: visible !important;
    background: #ffffff !important;
    z-index: -1 !important;
  `;
  exportRoot.innerHTML = htmlContent;
  document.body.appendChild(exportRoot);

  // Force explicit styles on each page
  exportRoot.querySelectorAll('.contrato-pagina').forEach(p => {
    p.style.cssText = `
      display: block !important;
      position: relative !important;
      box-sizing: border-box !important;
      width: ${A4_W_PX}px !important;
      min-height: 1123px !important;
      margin: 0 !important;
      padding: 60px 68px 60px 68px !important;
      overflow: hidden !important;
      isolation: isolate !important;
      background: #ffffff !important;
      color: #111111 !important;
      visibility: visible !important;
      opacity: 1 !important;
    `;

    // Watermark layer
    const wm = p.querySelector('.contrato-marca-dagua');
    if (wm) {
      if (watermarkOk) {
        wm.style.cssText = `
          position: absolute !important;
          inset: 0 !important;
          z-index: 0 !important;
          pointer-events: none !important;
          background-image: url('${watermarkUrl}') !important;
          background-repeat: no-repeat !important;
          background-position: center center !important;
          background-size: 100% auto !important;
          opacity: 0.15 !important;
        `;
      } else {
        wm.style.display = 'none !important';
      }
    }

    // Content layer above watermark
    const conteudo = p.querySelector('.contrato-pagina__conteudo');
    if (conteudo) {
      conteudo.style.cssText = `
        position: relative !important;
        z-index: 1 !important;
      `;
    }

    // Footer positioned at bottom-right of page
    const rodape = p.querySelector('.contrato-rodape');
    if (rodape) {
      // Migrate footer if it's inside .contrato-pagina__conteudo (old HTML format)
      if (rodape.parentElement && rodape.parentElement.classList.contains('contrato-pagina__conteudo')) {
        p.appendChild(rodape);
      }
      rodape.style.cssText = `
        position: absolute !important;
        right: 68px !important;
        bottom: 38px !important;
        z-index: 2 !important;
        font-size: 9.5pt !important;
        color: #111111 !important;
      `;
    }
  });

  // ---- 3. Wait for layout + paint + fonts + images ----
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => setTimeout(r, 300));
  if (document.fonts?.ready) {
    try { await document.fonts.ready; } catch (_) { /* ignore */ }
  }

  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));

  // ---- 4. Collect pages ----
  const pages = Array.from(exportRoot.querySelectorAll('.contrato-pagina'));

  console.log('[PDF] Páginas no exportRoot:', pages.length);

  if (pages.length === 0) {
    document.body.removeChild(exportRoot);
    toast('Nenhuma página A4 encontrada.', 'error');
    return;
  }

  // Validate first page
  const firstRect = pages[0].getBoundingClientRect();
  const firstW = firstRect.width || pages[0].offsetWidth;
  const firstH = firstRect.height || pages[0].offsetHeight;
  const firstText = (pages[0].innerText || '').trim();

  console.log('[PDF] Texto primeira página:', firstText.length, 'caracteres');
  console.log('[PDF] Dimensões primeira página:', { width: Math.round(firstW), height: Math.round(firstH) });

  if (firstText.length < 50 || firstW < 100 || firstH < 100) {
    document.body.removeChild(exportRoot);
    toast('O conteúdo do contrato não foi renderizado corretamente.', 'error');
    return;
  }

  // ---- 5. Generate PDF page by page with html2canvas ----
  const nomeSlug = (contrato.contratante_nome || 'Lead').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-]/g, '');
  const dataEvento = (contrato.data_evento || '').split('-').reverse().join('-');
  const filename = `Contrato_${nomeSlug}_${dataEvento}_${contrato.numero_contrato || 'CT'}.pdf`;

  try {
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    pdf.setProperties({
      title: filename,
      author: 'Agência Blue PRO',
      creator: 'jsPDF + html2canvas'
    });
    const A4_W_MM = 210;
    const A4_H_MM = 297;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      console.log('[PDF] Capturando página', i + 1, 'de', pages.length);

      // Ensure page is rendered
      page.style.display = 'block';
      page.style.visibility = 'visible';
      page.style.opacity = '1';

      const A4_SCALE = 2;
      const canvas = await h2c(page, {
        scale: A4_SCALE,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        scrollX: 0,
        scrollY: 0,
        width: A4_W_PX,
        height: 1123,
        windowWidth: A4_W_PX,
        windowHeight: 1123
      });

      if (!canvas || !canvas.width || !canvas.height) {
        document.body.removeChild(exportRoot);
        toast(`Página ${i + 1} não foi renderizada no canvas.`, 'error');
        return;
      }

      console.log('[PDF] Canvas página', i + 1, ':', canvas.width, 'x', canvas.height);

      // Validate canvas is not blank
      if (!canvasHasVisibleContent(canvas)) {
        document.body.removeChild(exportRoot);
        toast(`Página ${i + 1} foi capturada em branco. PDF não será salvo.`, 'error');
        return;
      }

      console.log('[PDF] Página', i + 1, '— conteúdo visual confirmado');

      const imgData = canvas.toDataURL('image/png');

      if (i > 0) pdf.addPage('a4', 'portrait');

      pdf.addImage(imgData, 'PNG', 0, 0, A4_W_MM, A4_H_MM);
    }

    // ---- 6. Validate blob ----
    const pdfBlob = pdf.output('blob');

    const headerSlice = await pdfBlob.slice(0, 5).text();
    if (!pdfBlob || pdfBlob.size < 30000 || !headerSlice.startsWith('%PDF')) {
      document.body.removeChild(exportRoot);
      toast(`PDF gerado é inválido. Tamanho: ${pdfBlob?.size ?? 0} bytes.`, 'error');
      return;
    }

    console.log('[PDF] Tamanho do blob:', pdfBlob.size, 'bytes');
    console.log('[PDF] Páginas exportadas:', pages.length);

    // ---- 7. Upload to private bucket ----
    const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });
    const storagePath = `${contrato.centro_custo_id || 'geral'}/${filename}`;
    const { error: uploadErr } = await _supabase.storage
      .from('contratos')
      .upload(storagePath, pdfFile, { contentType: 'application/pdf', upsert: true });

    if (uploadErr) {
      console.error('[Contratos] Erro ao subir PDF:', uploadErr);
      document.body.removeChild(exportRoot);
      toast('Erro ao salvar PDF: ' + uploadErr.message, 'error');
      return;
    }

    console.log('[PDF] Upload concluído:', storagePath);

    // ---- 8. Create signed URL ----
    const { data: signedData, error: signedErr } = await _supabase.storage
      .from('contratos')
      .createSignedUrl(storagePath, 600);

    if (signedErr || !signedData?.signedUrl) {
      console.error('[Contratos] Erro ao criar URL assinada:', signedErr);
      document.body.removeChild(exportRoot);
      toast('Erro ao gerar link de download: ' + (signedErr?.message || 'desconhecido'), 'error');
      return;
    }

    // ---- 9. Update contrato status ----
    await _supabase.from('contratos').update({
      status: 'gerado',
      gerado_em: new Date().toISOString(),
      pdf_storage_path: storagePath,
      updated_at: new Date().toISOString()
    }).eq('id', id);

    // ---- 10. Open PDF in new tab ----
    window.open(signedData.signedUrl, '_blank');

    toast('PDF gerado com sucesso!', 'success');
    await refreshContratosTable();
  } catch (e) {
    console.error('[Contratos] Erro ao gerar PDF:', e);
    toast('Erro ao gerar PDF: ' + e.message, 'error');
  } finally {
    const el = document.getElementById('contratoPdfExport');
    if (el && document.body.contains(el)) document.body.removeChild(el);
  }
}

/* ---- Download PDF via signed URL from private bucket ----- */
async function contratoDownloadPDF(id) {
  if (!_supabase) return;

  const { data: contrato, error } = await _supabase.from('contratos').select('pdf_storage_path, contratante_nome').eq('id', id).single();
  if (error || !contrato) { toast('Contrato não encontrado.', 'error'); return; }

  if (!contrato.pdf_storage_path) {
    toast('Este contrato ainda não tem PDF gerado.', 'error');
    return;
  }

  const { data: signedData, error: signedErr } = await _supabase.storage
    .from('contratos')
    .createSignedUrl(contrato.pdf_storage_path, 600);

  if (signedErr || !signedData?.signedUrl) {
    console.error('[Contratos] Erro ao criar URL assinada:', signedErr);
    toast('Erro ao baixar PDF: ' + (signedErr?.message || 'desconhecido'), 'error');
    return;
  }

  window.open(signedData.signedUrl, '_blank');
}

/* ---- Generate PDF from current modal form ----- */
async function contratoGenerateFromModal() {
  const missing = validateContratoForm();
  if (missing.length) {
    const nomes = missing.map(f => f.label).join(', ');
    toast('Campos obrigatórios ausentes: ' + nomes, 'error');
    return;
  }
  toast('Salvando e gerando PDF…', 'info');
  const saved = await saveContrato('gerado');
  if (!saved) return;
  _closeContratoModal();
  // Keep preview open during PDF generation so html2canvas can capture visible pages
  await contratoGeneratePDF(saved.id);
  // Close preview after generation
  const previewModal = document.getElementById('contratoPreviewModal');
  if (previewModal) previewModal.classList.remove('is-open');
}

/* ---- Preview modal ----- */
async function openContratoPreview() {
  const missing = validateContratoForm();
  if (missing.length) {
    const nomes = missing.map(f => '• ' + f.label).join('\n');
    toast('Complete as informações obrigatórias antes de visualizar o contrato:\n' + missing.map(f => f.label).join(', '), 'error');
    console.warn('[Contratos] Campos obrigatórios ausentes:', missing.map(f => f.id));
    return;
  }
  const formData = collectContratoFormData();
  formData.data_emissao = new Date().toISOString().split('T')[0];
  const html = buildPDFContent(formData);
  const a4 = document.getElementById('contratoA4Document');
  if (a4) a4.innerHTML = html;
  const previewModal = document.getElementById('contratoPreviewModal');
  if (previewModal) previewModal.classList.add('is-open');
  if (typeof initIcons === 'function') initIcons();
}

/* ---- Actions dropdown ----- */
/* ---- Actions menu (replaces window.prompt) ----- */
let _contratoActiveMenu = null;
let _contratoMenuCloseHandler = null;

function _closeContratoActionsMenu() {
  if (_contratoActiveMenu) {
    _contratoActiveMenu.remove();
    _contratoActiveMenu = null;
  }
  if (_contratoMenuCloseHandler) {
    document.removeEventListener('click', _contratoMenuCloseHandler, true);
    document.removeEventListener('keydown', _contratoMenuCloseHandler, true);
    _contratoMenuCloseHandler = null;
  }
}

function _openContratoActionsMenu(btnEl, id, status, numeroContrato) {
  _closeContratoActionsMenu();

  const actions = [
    { label: 'Marcar como enviado', value: 'enviado', icon: 'send', visible: ['gerado', 'rascunho'] },
    { label: 'Marcar como assinado', value: 'assinado', icon: 'check-circle', visible: ['enviado', 'gerado'] },
    { label: 'Gerar / baixar PDF', value: 'gerar', icon: 'file-down', visible: ['rascunho', 'gerado', 'enviado', 'assinado'] },
    { label: 'Cancelar contrato', value: 'cancelado', icon: 'x-circle', visible: ['rascunho', 'gerado', 'enviado'], danger: true },
  ].filter(a => a.visible.includes(status));

  if (!actions.length) { toast('Nenhuma ação disponível para este status.'); return; }

  const menu = document.createElement('div');
  menu.className = 'contract-actions-menu';
  menu.setAttribute('role', 'menu');

  menu.innerHTML = actions.map((a, i) => {
    const parts = [];
    if (i > 0 && actions[i - 1].danger !== a.danger) {
      parts.push('<div class="contract-actions-menu__divider"></div>');
    }
    const cls = a.danger ? ' contract-actions-menu__item--danger' : '';
    parts.push(`<button type="button" role="menuitem" class="${cls}" data-action="${a.value}">
      <span class="action-menu-icon"><i data-lucide="${a.icon}"></i></span>
      <span>${a.label}</span>
    </button>`);
    return parts.join('');
  }).join('');

  document.body.appendChild(menu);
  _contratoActiveMenu = menu;

  // Position menu
  const rect = btnEl.getBoundingClientRect();
  const menuW = 220;
  const menuH = actions.length * 44 + 16;
  let top = rect.bottom + 6;
  let left = rect.left;

  if (top + menuH > window.innerHeight) top = rect.top - menuH - 6;
  if (left + menuW > window.innerWidth) left = rect.right - menuW;
  if (left < 8) left = 8;

  menu.style.top = top + 'px';
  menu.style.left = left + 'px';

  if (typeof initIcons === 'function') initIcons();

  btnEl.setAttribute('aria-expanded', 'true');

  // Click handler for menu items
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-action]');
    if (!item) return;
    const action = item.dataset.action;
    _closeContratoActionsMenu();
    btnEl.setAttribute('aria-expanded', 'false');

    if (action === 'cancelado') {
      _openContratoCancelModal(id, numeroContrato);
    } else if (action === 'gerar') {
      contratoGeneratePDF(id);
    } else {
      _executeContratoStatusAction(id, action);
    }
  });

  // Close on outside click or Esc
  setTimeout(() => {
    _contratoMenuCloseHandler = (e) => {
      if (_contratoActiveMenu && !_contratoActiveMenu.contains(e.target) && e.target !== btnEl && !btnEl.contains(e.target)) {
        if (e.type === 'keydown' && e.key !== 'Escape') return;
        _closeContratoActionsMenu();
        btnEl.setAttribute('aria-expanded', 'false');
      }
    };
    document.addEventListener('click', _contratoMenuCloseHandler, true);
    document.addEventListener('keydown', _contratoMenuCloseHandler, true);
  }, 0);
}

async function _executeContratoStatusAction(id, actionValue) {
  if (!_supabase) return;
  const upd = { status: actionValue, updated_at: new Date().toISOString() };
  if (actionValue === 'enviado') upd.enviado_em = new Date().toISOString();
  if (actionValue === 'assinado') upd.assinado_em = new Date().toISOString();
  await _supabase.from('contratos').update(upd).eq('id', id);
  const labels = { enviado: 'Contrato marcado como enviado.', assinado: 'Contrato marcado como assinado.' };
  toast(labels[actionValue] || 'Status atualizado.', 'success');
  await refreshContratosTable();
}

/* ---- Cancel confirmation modal ----- */
let _contratoCancelTargetId = null;

function _openContratoCancelModal(id, numeroContrato) {
  _contratoCancelTargetId = id;
  const numEl = document.getElementById('contratoCancelNumber');
  if (numEl) numEl.textContent = numeroContrato || '—';
  const overlay = document.getElementById('contratoCancelOverlay');
  const modal = document.getElementById('contratoCancelModal');
  if (overlay) overlay.classList.add('open');
  if (modal) modal.classList.add('open');
  if (typeof initIcons === 'function') initIcons();
  setTimeout(() => {
    const backBtn = document.getElementById('contratoCancelBack');
    if (backBtn) backBtn.focus();
  }, 50);
}

function _closeContratoCancelModal() {
  const overlay = document.getElementById('contratoCancelOverlay');
  const modal = document.getElementById('contratoCancelModal');
  if (overlay) overlay.classList.remove('open');
  if (modal) modal.classList.remove('open');
  _contratoCancelTargetId = null;
}

async function _confirmContratoCancel() {
  if (!_contratoCancelTargetId || !_supabase) return;
  const id = _contratoCancelTargetId;
  _closeContratoCancelModal();
  await _supabase.from('contratos').update({
    status: 'cancelado',
    cancelado_em: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).eq('id', id);
  toast('Contrato cancelado com sucesso.', 'success');
  await refreshContratosTable();
}

/* ---- Delete confirmation modal ----- */
let _contratoDeleteTargetId = null;
let _contratoDeleteTargetStatus = null;

function contratoExcluir(id, numero, contratante, status) {
  if (!canManageContratos()) return;
  if (!['rascunho', 'cancelado'].includes(status)) {
    toast('Não é possível excluir contratos com este status.', 'error');
    return;
  }
  _openContratoDeleteModal(id, numero, contratante);
}

function _openContratoDeleteModal(id, numero, contratante) {
  _contratoDeleteTargetId = id;
  _contratoDeleteTargetStatus = 'delete';
  const textEl = document.getElementById('contratoDeleteText');
  if (textEl) {
    textEl.innerHTML = `Tem certeza que deseja excluir o contrato <strong>${numero || '—'}</strong> de <strong>${contratante || '—'}</strong>? Esta ação não poderá ser desfeita.`;
  }
  const overlay = document.getElementById('contratoDeleteOverlay');
  const modal = document.getElementById('contratoDeleteModal');
  if (overlay) overlay.classList.add('open');
  if (modal) modal.classList.add('open');
  if (typeof initIcons === 'function') initIcons();
  setTimeout(() => {
    const backBtn = document.getElementById('contratoDeleteBack');
    if (backBtn) backBtn.focus();
  }, 50);
}

function _closeContratoDeleteModal() {
  const overlay = document.getElementById('contratoDeleteOverlay');
  const modal = document.getElementById('contratoDeleteModal');
  if (overlay) overlay.classList.remove('open');
  if (modal) modal.classList.remove('open');
  _contratoDeleteTargetId = null;
  _contratoDeleteTargetStatus = null;
}

async function _confirmContratoDelete() {
  if (!_contratoDeleteTargetId) return;
  if (!_supabase) {
    toast('Erro de conexão. Recarregue a página.', 'error');
    return;
  }
  const id = _contratoDeleteTargetId;
  const contrato = _contratosData.find(c => c.id === id);
  const numero = contrato?.numero_contrato || '';
  const storagePath = contrato?.assinado_storage_path;
  _closeContratoDeleteModal();
  try {
    // 1. Remover PDF assinado do Storage (se existir)
    if (storagePath) {
      const { error: storageErr } = await _supabase.storage.from('contratos').remove([storagePath]);
      if (storageErr) {
        console.warn('[Contratos] Aviso ao remover PDF do Storage:', storageErr.message);
        // Não bloqueia a exclusão do contrato se falhar no storage
      }
    }

    // 2. Hard delete no banco (requer política DELETE na tabela contratos)
    const { error, count } = await _supabase
      .from('contratos')
      .delete({ count: 'exact' })
      .eq('id', id);

    if (error) {
      // Se falhar por falta de política DELETE, tentar soft delete como fallback
      if (error.code === '42501' || error.message?.includes('policy')) {
        console.warn('[Contratos] DELETE bloqueado por RLS, tentando soft delete...');
        const { error: softErr } = await _supabase
          .from('contratos')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', id);
        if (softErr) throw softErr;
      } else {
        throw error;
      }
    }

    // 3. Recarregar do banco para refletir o estado real
    await refreshContratosTable();
    toast(`Contrato ${numero} excluído com sucesso!`, 'success');
  } catch (err) {
    console.error('[Contratos] Erro ao excluir:', err);
    toast(`Erro ao excluir o contrato ${numero}: ${err.message}. Tente novamente.`, 'error');
  }
}

/* ---- Original contratoAcoes (replaced by menu) ----- */
async function contratoAcoes(id, status) {
  const contrato = _contratosData.find(c => c.id === id);
  const numero = contrato?.numero_contrato || '';
  const btn = document.querySelector(`[data-contrato-actions="${id}"]`);
  if (btn) {
    _openContratoActionsMenu(btn, id, status, numero);
  }
}

/* ---- Refresh table ----- */
async function refreshContratosTable() {
  const busca = document.getElementById('filterContratoBusca')?.value || '';
  const status = document.getElementById('filterContratoStatus')?.value || '';
  const mesEvento = document.getElementById('filterContratoMesEvento')?.value || '';
  const centroCustoId = document.getElementById('filterContratoEmpresa')?.value || '';
  _contratosData = await loadContratos({ busca, status, mesEvento, centroCustoId });
  renderContratosTable(_contratosData);
}

/* ---- Save as draft shortcut ----- */
async function salvarContratoComoRascunho() {
  if (!_supabase) return null;
  if (_contratoSaving) return null;
  _contratoSaving = true;

  try {
    const formData = collectContratoFormData();
    const existingId = document.getElementById('contratoId')?.value || '';

    const payload = {
      ...formData,
      status: 'rascunho',
      membro_id: currentUser?.id || null,
      owner_id: currentUser?.id || null,
      centro_custo_id: currentUser?.centro_custo_ids?.[0] || null,
      updated_at: new Date().toISOString()
    };

    let data;

    if (existingId) {
      const { data: updated, error } = await _supabase
        .from('contratos')
        .update(payload)
        .eq('id', existingId)
        .select()
        .single();
      if (error) throw error;
      data = updated;
    } else {
      data = await createContratoViaRPC(payload);
      if (!data) {
        toast('Erro ao criar rascunho.', 'error');
        return null;
      }
    }

    if (!existingId && data) {
      const idEl = document.getElementById('contratoId');
      if (idEl) idEl.value = data.id;
    }

    toast('Rascunho salvo com sucesso.', 'success');
    await refreshContratosTable();
    return data;
  } catch (err) {
    console.error('[Contratos] Erro ao salvar rascunho:', err.message || err);
    if (err.code === '23505') {
      toast('Erro: número de contrato duplicado. Tente novamente.', 'error');
    } else {
      toast('Não foi possível salvar o rascunho: ' + _friendlyContratoError(err), 'error');
    }
    return null;
  } finally {
    _contratoSaving = false;
  }
}

/* ---- Generic closeModal helper (used by Contratos module) ----- */
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove('open');
  let sibling = modal.previousElementSibling;
  while (sibling) {
    if (sibling.classList && sibling.classList.contains('modal-overlay')) {
      if (sibling.classList.contains('open')) sibling.classList.remove('open');
      break;
    }
    sibling = sibling.previousElementSibling;
  }
}

/* ---- Main init ----- */
function _updateContratosClearBtn() {
  const busca = document.getElementById('filterContratoBusca')?.value || '';
  const status = document.getElementById('filterContratoStatus')?.value || '';
  const mes = document.getElementById('filterContratoMesEvento')?.value || '';
  const empresa = document.getElementById('filterContratoEmpresa')?.value || '';
  const hasFilter = !!(busca || status || mes || empresa);
  const btn = document.getElementById('btnClearContratos');
  if (btn) btn.style.display = hasFilter ? '' : 'none';
}

/* ---- Populate empresa filter for contratos ----- */
function populateContratoEmpresaFilter() {
  const select = document.getElementById('filterContratoEmpresa');
  if (!select) return;
  const isAdmin = isCurrentUserAdmin();
  const empresas = isAdmin
    ? centrosCustoData
    : centrosCustoData.filter(cc => currentUser.centro_custo_ids?.includes(cc.id));
  select.innerHTML = '<option value="">Todas as Empresas</option>';
  empresas.forEach(cc => {
    const opt = document.createElement('option');
    opt.value = cc.id;
    opt.textContent = cc.nome;
    select.appendChild(opt);
  });
  if (!isAdmin && empresas.length === 1) {
    select.value = empresas[0].id;
  }
}

/* ---- Contrato Assinado Upload ---- */
let _contratoAssinadoFile = null;

function _resetContratoUploadUI() {
  _contratoAssinadoFile = null;
  const input = document.getElementById('contratoAssinadoInput');
  if (input) input.value = '';
  const filename = document.getElementById('contratoUploadFilename');
  if (filename) filename.textContent = '';
  const actions = document.getElementById('contratoUploadActions');
  if (actions) actions.style.display = 'none';
  const progress = document.getElementById('contratoUploadProgress');
  if (progress) progress.style.display = 'none';
  const done = document.getElementById('contratoUploadDone');
  if (done) done.style.display = 'none';
  const info = document.getElementById('contratoUploadInfo');
  if (info) info.style.display = '';
  const fileRow = document.getElementById('contratoUploadFile');
  if (fileRow) fileRow.style.display = '';
}

function _showContratoUploadDone(storagePath) {
  const info = document.getElementById('contratoUploadInfo');
  const fileRow = document.getElementById('contratoUploadFile');
  const actions = document.getElementById('contratoUploadActions');
  const progress = document.getElementById('contratoUploadProgress');
  const done = document.getElementById('contratoUploadDone');
  if (info) info.style.display = 'none';
  if (fileRow) fileRow.style.display = 'none';
  if (actions) actions.style.display = 'none';
  if (progress) progress.style.display = 'none';
  if (done) done.style.display = 'flex';
  const viewLink = document.getElementById('contratoUploadViewLink');
  if (viewLink) {
    viewLink.onclick = async (e) => {
      e.preventDefault();
      if (!storagePath || !_supabase) return;
      const { data, error } = await _supabase.storage.from('contratos').createSignedUrl(storagePath, 600);
      if (error || !data?.signedUrl) { toast('Erro ao gerar link do PDF.', 'error'); return; }
      window.open(data.signedUrl, '_blank');
    };
  }
}

async function _contratoUploadAssinado() {
  if (!_contratoAssinadoFile || !_supabase) return;
  const contratoId = document.getElementById('contratoId')?.value;
  if (!contratoId) { toast('Salve o contrato antes de anexar o PDF assinado.', 'error'); return; }

  const progress = document.getElementById('contratoUploadProgress');
  const progressFill = document.getElementById('contratoUploadProgressFill');
  const progressText = document.getElementById('contratoUploadProgressText');
  const actions = document.getElementById('contratoUploadActions');
  if (progress) progress.style.display = 'flex';
  if (actions) actions.style.display = 'none';
  if (progressFill) progressFill.style.width = '30%';
  if (progressText) progressText.textContent = 'Enviando...';

  const ext = _contratoAssinadoFile.name.split('.').pop() || 'pdf';
  const storagePath = `assinados/${contratoId}_${Date.now()}.${ext}`;

  const { error: uploadErr } = await _supabase.storage
    .from('contratos')
    .upload(storagePath, _contratoAssinadoFile, { contentType: 'application/pdf', upsert: true });

  if (uploadErr) {
    console.error('[Contratos] Erro ao enviar PDF assinado:', uploadErr);
    toast('Erro ao enviar PDF: ' + uploadErr.message, 'error');
    if (progress) progress.style.display = 'none';
    if (actions) actions.style.display = 'flex';
    return;
  }

  if (progressFill) progressFill.style.width = '70%';
  if (progressText) progressText.textContent = 'Registrando...';

  const { error: dbErr } = await _supabase.from('contratos').update({
    assinado_storage_path: storagePath,
    status: 'assinado',
    assinado_em: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).eq('id', contratoId);

  if (dbErr) {
    console.error('[Contratos] Erro ao atualizar contrato:', dbErr);
    toast('Erro ao registrar PDF: ' + dbErr.message, 'error');
    if (progress) progress.style.display = 'none';
    if (actions) actions.style.display = 'flex';
    return;
  }

  if (progressFill) progressFill.style.width = '100%';
  if (progressText) progressText.textContent = 'Concluído!';

  setTimeout(() => {
    _showContratoUploadDone(storagePath);
    toast('Contrato assinado anexado e status atualizado para Assinado!', 'success');
    refreshContratosTable();
  }, 400);
}

async function initContratos() {
  if (_contratosInited) { await refreshContratosTable(); return; }
  _contratosInited = true;

  _contratosData = await loadContratos();
  renderContratosTable(_contratosData);

  populateContratoEmpresaFilter();

  document.getElementById('btnNovoContrato')?.addEventListener('click', openNovoContratoModal);
  document.getElementById('btnFilterContratos')?.addEventListener('click', async () => { await refreshContratosTable(); _updateContratosClearBtn(); });
  document.getElementById('filterContratoBusca')?.addEventListener('keypress', e => { if (e.key === 'Enter') { refreshContratosTable().then(() => _updateContratosClearBtn()); } });

  document.getElementById('btnClearContratos')?.addEventListener('click', async () => {
    const busca = document.getElementById('filterContratoBusca');
    const status = document.getElementById('filterContratoStatus');
    const mes = document.getElementById('filterContratoMesEvento');
    const empresa = document.getElementById('filterContratoEmpresa');
    if (busca) busca.value = '';
    if (status) status.value = '';
    if (mes) mes.value = '';
    if (empresa) empresa.value = '';
    await refreshContratosTable();
    _updateContratosClearBtn();
  });

  document.getElementById('contratoCondicaoPagamento')?.addEventListener('change', function () {
    const v = parseInt(this.value);
    const show = v >= 2 ? '' : 'none';
    ['rowParcelaVal2', 'rowParcelaVenc2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = show;
    });
  });

  const btnPreview = document.getElementById('btnContratoPreview');
  if (btnPreview) btnPreview.addEventListener('click', openContratoPreview);

  const btnSaveDraft = document.getElementById('btnContratoSaveDraft');
  if (btnSaveDraft) btnSaveDraft.addEventListener('click', async () => { await salvarContratoComoRascunho(); });

  const btnGen = document.getElementById('btnContratoGenerate');
  if (btnGen) btnGen.addEventListener('click', openContratoPreview);

  const btnBackToEdit = document.getElementById('btnContratoBackToEdit');
  if (btnBackToEdit) btnBackToEdit.addEventListener('click', () => {
    const previewModal = document.getElementById('contratoPreviewModal');
    if (previewModal) previewModal.classList.remove('is-open');
    _openContratoModal();
  });

  const btnSaveDraftPreview = document.getElementById('btnContratoSaveDraftPreview');
  if (btnSaveDraftPreview) btnSaveDraftPreview.addEventListener('click', async () => {
    await salvarContratoComoRascunho();
  });

  const btnGeneratePdf = document.getElementById('btnContratoGeneratePdf');
  if (btnGeneratePdf) btnGeneratePdf.addEventListener('click', async () => {
    const previewModal = document.getElementById('contratoPreviewModal');
    if (previewModal) previewModal.classList.remove('is-open');
    await contratoGenerateFromModal();
  });

  document.querySelectorAll('#modalContrato .close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      closeModal('modalContrato');
    });
  });

  // X button close
  document.getElementById('btnCloseContratoModal')?.addEventListener('click', _requestCloseContratoModal);

  // Cancel button
  document.getElementById('btnContratoCancel')?.addEventListener('click', _requestCloseContratoModal);

  // Overlay backdrop click
  document.getElementById('contratoOverlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) _requestCloseContratoModal();
  });

  // Discard confirmation modal
  document.getElementById('contratoDiscardCancel')?.addEventListener('click', _closeContratoDiscardModal);
  document.getElementById('contratoDiscardConfirm')?.addEventListener('click', _confirmContratoDiscard);
  document.querySelector('.contrato-discard-close-x')?.addEventListener('click', _closeContratoDiscardModal);
  document.getElementById('contratoDiscardOverlay')?.addEventListener('click', _closeContratoDiscardModal);

  // Cancel contract confirmation modal
  document.getElementById('contratoCancelBack')?.addEventListener('click', _closeContratoCancelModal);
  document.getElementById('contratoCancelConfirm')?.addEventListener('click', _confirmContratoCancel);
  document.querySelector('.contrato-cancel-close-x')?.addEventListener('click', _closeContratoCancelModal);
  document.getElementById('contratoCancelOverlay')?.addEventListener('click', _closeContratoCancelModal);

  // Delete contract confirmation modal
  document.getElementById('contratoDeleteBack')?.addEventListener('click', _closeContratoDeleteModal);
  document.getElementById('contratoDeleteConfirm')?.addEventListener('click', _confirmContratoDelete);
  document.querySelector('.contrato-delete-close-x')?.addEventListener('click', _closeContratoDeleteModal);
  document.getElementById('contratoDeleteOverlay')?.addEventListener('click', _closeContratoDeleteModal);

  // Searchable lead selector
  _initLeadSearchable();

  // Contrato assinado upload
  document.getElementById('contratoSelectFileBtn')?.addEventListener('click', () => {
    document.getElementById('contratoAssinadoInput')?.click();
  });
  document.getElementById('contratoAssinadoInput')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') { toast('Selecione um arquivo PDF.', 'error'); return; }
    _contratoAssinadoFile = file;
    const filename = document.getElementById('contratoUploadFilename');
    if (filename) filename.textContent = file.name;
    const actions = document.getElementById('contratoUploadActions');
    if (actions) actions.style.display = 'flex';
    const done = document.getElementById('contratoUploadDone');
    if (done) done.style.display = 'none';
  });
  document.getElementById('contratoUploadBtn')?.addEventListener('click', _contratoUploadAssinado);
}

// Expose global functions (called from onclick attributes in table rows)
window.contratoEdit = contratoEdit;
window.contratoGeneratePDF = contratoGeneratePDF;
window.contratoDownloadPDF = contratoDownloadPDF;
window.contratoAcoes = contratoAcoes;
window.contratoExcluir = contratoExcluir;
window._contratoUploadAssinado = _contratoUploadAssinado;

// Expose Conversas CRM panel functions (called from onclick in generated HTML)
window.convSetTemperature = convSetTemperature;
window.convSetStatus = convSetStatus;
window.convSetAssignee = convSetAssignee;
window.convSetPriority = convSetPriority;
window.convAddNote = convAddNote;
window.convSyncContactToLead = convSyncContactToLead;
window._convVerLeadNoCRM = function(leadId) {
  if (!leadId) return;
  setActivePage('crm');
  setTimeout(() => { if (typeof openLeadModal === 'function') openLeadModal(leadId); }, 200);
};

// Expose Permission functions (called from onclick in generated HTML)
window.applyPerfilDefaults = applyPerfilDefaults;
window.can = can;
