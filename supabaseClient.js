/* ============================================
   SUPABASE CLIENT — Blue CRM
   Configuração e helpers para integração
   ============================================ */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://wozwysgubvqxczyjrmtn.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indvend5c2d1YnZxeGN6eWpybXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0OTY0NzcsImV4cCI6MjA5NjA3MjQ3N30.JjcYLaCBhtoVpbjmRs6vQN4V8lUZ00hgU92f0o0T-IM';

let _supabase = null;
if (window.supabase && window.supabase.createClient) {
  _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window._supabase = _supabase;
  console.log('[Supabase] Cliente inicializado com sucesso');
} else {
  console.error('[Supabase] CDN não carregou! Verifique sua conexão ou desative bloqueadores.');
}

/* ============================================
   MAPA: kanban column IDs (hardcoded no CRM)
   ============================================ */
const KANBAN_COLUMN_IDS = [
  'dados-ia', 'coletados-frio', 'qualificado', 'em-atendimento',
  'geladeira', 'stand-by', 'diagnostico-gratis', 'reuniao-agendada',
  'reuniao-realizada', 'contrato-enviado', 'contrato-fechado',
  'cobranca-enviada', 'pagamento-recebido', 'servico-executado', 'pos-vendas'
];

const DEFAULT_CADENCE_ID = KANBAN_COLUMN_IDS[0]; // 'dados-ia'

/* ============================================
   MAPAS GLOBAIS (preenchidos no boot)
   ============================================ */
let _cadenciaUuidToCol = {};   // UUID → column ID
let _cadenciaColToUuid = {};   // column ID → UUID
let _servicosByName = {};      // nome → { id, nome }
let _servicosById = {};        // id → { id, nome }

/* ============================================
   HELPER: buscar cadências do Supabase
   Retorna mapa: { UUID → kanban column ID }
   ============================================ */
async function fetchCadenciasMap() {
  if (!_supabase) return {};

  const { data, error } = await _supabase
    .from('cadencias')
    .select('*');

  if (error) {
    console.error('[Supabase] Erro ao buscar cadências:', error.message, error.code);
    return {};
  }

  if (!data || data.length === 0) {
    console.warn('[Supabase] Tabela cadencia vazia ou não encontrada');
    return {};
  }

  console.log('[Supabase] Cadências encontradas:', data.length, data);

  const map = {};
  data.forEach(row => {
    const uuid = row.id;
    const label = (row.nome || row.label || row.name || row.titulo || row.title || '').toLowerCase().trim();
    const slug = (row.slug || row.codigo || row.code || '').toLowerCase().trim();
    const colId = (row.coluna || row.column || row.kanban_col || '').trim();

    const normalized = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');

    console.log('[Supabase] Cadência row:', { uuid, label, slug, colId, normalized, keys: Object.keys(row) });

    let matched = false;

    if (colId && KANBAN_COLUMN_IDS.includes(colId)) {
      map[uuid] = colId;
      matched = true;
    }

    if (!matched) {
      for (const cid of KANBAN_COLUMN_IDS) {
        if (slug === cid || label === cid || normalized === cid) {
          map[uuid] = cid;
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      for (const cid of KANBAN_COLUMN_IDS) {
        if (normalized.startsWith(cid + '-') || normalized.startsWith(cid) && normalized.charAt(cid.length) === '-') {
          map[uuid] = cid;
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      for (const cid of KANBAN_COLUMN_IDS) {
        if (label.includes(cid) || cid.includes(label.replace(/\s+/g, '-'))) {
          map[uuid] = cid;
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      console.warn(`[Supabase] Cadência "${label || slug || uuid}" não mapeada para nenhuma coluna do Kanban`);
    }
  });

  console.log('[Supabase] Mapa cadência:', map);
  _cadenciaUuidToCol = map;
  _cadenciaColToUuid = {};
  Object.entries(map).forEach(([uuid, colId]) => { _cadenciaColToUuid[colId] = uuid; });
  console.log('[Supabase] Coluna→UUID:', _cadenciaColToUuid);
  return map;
}

/* ============================================
   HELPER: reconstruir mapas de cadência
   ============================================ */
async function rebuildCadenciaMaps() {
  _cadenciaUuidToCol = {};
  _cadenciaColToUuid = {};
  return await fetchCadenciasMap();
}

/* ============================================
   HELPER: validar se UUIDs existem nas tabelas
   ============================================ */
function parseBrazilianCurrency(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  let s = String(val).trim();
  s = s.replace(/R\$\s*/gi, '');
  s = s.replace(/\.(?=\d{3})/g, '');
  s = s.replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/* ============================================
   HELPER: validar se UUIDs existem nas tabelas
   ============================================ */
async function validateForeignKeys(payload) {
  const warnings = [];

  if (payload.tipo_servico_id && Array.isArray(payload.tipo_servico_id)) {
    for (const uuid of payload.tipo_servico_id) {
      if (!_servicosById[uuid]) {
        warnings.push(`tipo_servico_id "${uuid}" não encontrado na tabela servicos`);
      }
    }
  }

  if (payload.cadencia_id) {
    if (!_cadenciaUuidToCol[payload.cadencia_id]) {
      warnings.push(`cadencia_id "${payload.cadencia_id}" não encontrado na tabela cadencia`);
    }
  }

  if (warnings.length > 0) {
    console.warn('[FK Validation] Avisos:', warnings);
  }
  return warnings;
}

/* ============================================
   HELPER: buscar leads do Supabase
   Retorna array de leads no formato do CRM
   ============================================ */
async function fetchLeadsSupabase(filterMemberId) {
  if (!_supabase) return [];

  const cadenciaMap = await fetchCadenciasMap();

  // Tentar com join de centros_custo; se a tabela não existir, fazer fallback
  let q = _supabase
    .from('leads')
    .select('*, membros!membro_id(nome)')
    .order('created_at', { ascending: false });

  if (filterMemberId) {
    console.log('[Supabase] Filtrando leads por membro_id/qualificador_id/owner_id/created_by:', filterMemberId);
    q = q.or('membro_id.eq.' + filterMemberId + ',qualificador_id.eq.' + filterMemberId + ',owner_id.eq.' + filterMemberId + ',created_by.eq.' + filterMemberId);
  }

  let { data, error } = await q;

  if (error) {
    console.error('[Supabase] Erro ao buscar leads:', error.message, error.code);
    return [];
  }

  if (!data || data.length === 0) {
    console.log('[Supabase] Nenhum lead encontrado');
    return [];
  }

  console.log('[Supabase] Leads encontrados:', data.length);

  return data.map(row => {
    const status = (row.cadencia_id && cadenciaMap[row.cadencia_id]) || DEFAULT_CADENCE_ID;
    const created = row.created_at ? new Date(row.created_at) : new Date();
    const nowStr = created.toLocaleString('pt-BR');
    const today = created.toLocaleDateString('pt-BR');

    // Se houver membro_id, usar o nome do membro retornado no join
    const respName = row.membros ? row.membros.nome : 'Camila';

    return {
      id: row.id,
      empresa: row.nome || 'Sem nome',
      cnpj: '',
      telefone: row.telefone || '',
      email: '',
      responsavel: respName,
      status: status,
      thermal: row.temperatura || 'frio',
      honorarios: row.honorarios || 0,
      servicos: [],
      dataEvento: row.data_evento || '',
      _ownerId: row.owner_id || null,
      _createdBy: row.created_by || null,
      _membroId: row.membro_id || null,
      tiposServico: (function() {
        const raw = row.tipo_servico_id;
        if (!raw) return [];
        if (Array.isArray(raw)) return raw.map(id => _servicosById[id]?.nome).filter(Boolean);
        if (typeof raw === 'string' && raw.startsWith('[')) {
          try { return JSON.parse(raw).map(id => _servicosById[id]?.nome).filter(Boolean); } catch {}
        }
        return _servicosById[raw] ? [_servicosById[raw].nome] : [];
      })(),
      _tipoServicoIds: (function() {
        const raw = row.tipo_servico_id;
        if (!raw) return [];
        if (Array.isArray(raw)) return raw;
        if (typeof raw === 'string' && raw.startsWith('[')) {
          try { return JSON.parse(raw); } catch {}
        }
        return [raw];
      })(),
      _cadenciaId: row.cadencia_id || null,
      _centroCustoId: row.centro_custo_id || null,
      _centroCustoNome: '',
      enderecoEvento: row.endereco_evento || '',
      quantidadeHoras: row.quantidade_horas || 0,
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
      origem: 'Supabase',
      observacoes: row.observacoes || '',
      createdAt: nowStr,
      lastTouch: today,
      history: []
    };
  });
}

/* ============================================
   HELPER: inserir lead no Supabase
   ============================================ */
async function insertLeadSupabase(data) {
  if (!_supabase) throw new Error('Supabase client não inicializado. CDN pode ter falhado.');

  const { nome, telefone, data_evento, endereco_evento,
          quantidade_horas, temperatura, honorarios, observacoes,
          tipo_servico_id, cadencia_id, owner_id, centro_custo_id } = data;

  console.log('[Supabase] Inserindo lead:', { nome, telefone, data_evento });

  const payload = {
    nome,
    telefone,
    data_evento,
    endereco_evento,
    quantidade_horas,
    temperatura,
    honorarios: parseBrazilianCurrency(honorarios),
    observacoes,
    membro_id: null, // Começa sempre como null, conforme requisitos
    centro_custo_id: centro_custo_id || null
  };
  if (owner_id) payload.owner_id = owner_id;
  if (tipo_servico_id) payload.tipo_servico_id = Array.isArray(tipo_servico_id) ? tipo_servico_id : [tipo_servico_id];
  if (cadencia_id) payload.cadencia_id = cadencia_id;

  const { data: result, error } = await _supabase
    .from('leads')
    .insert([payload])
    .select();

  if (error) {
    console.error('[Supabase] Erro ao inserir lead:', error.message, error.code, error.details, error.hint);
    throw error;
  }

  console.log('[Supabase] Lead inserido com sucesso:', result);
  return result;
}

/* ============================================
   HELPER: inserir evento no Supabase
   ============================================ */
async function insertEventoSupabase(data) {
  if (!_supabase) throw new Error('Supabase client não inicializado.');

  const payload = {
    titulo: data.titulo || data.title || '',
    tipo: data.tipo || data.type || '',
    lead_id: data.lead_id || data.leadId || null,
    cliente_nome: data.cliente || data.cliente_nome || '',
    telefone: data.telefone || data.phone || '',
    local: data.local || data.location || '',
    data_evento: data.data_evento || data.iso || null,
    hora_inicio: data.hora_inicio || data.time || null,
    hora_termino: data.hora_termino || data.timeEnd || null,
    duracao: data.duracao || data.duration || '',
    servicos_ids: data.servicos_ids || [],
    temperatura: data.temperatura || data.temperature || '',
    honorarios: data.honorarios || 0,
    observacoes: data.observacoes || data.notes || '',
    cor: data.cor || data.color || '#2F80ED'
  };

  console.log('[Supabase] Inserindo evento:', payload);

  const { data: result, error } = await _supabase
    .from('eventos')
    .insert([payload])
    .select();

  if (error) {
    const msg = error.message || 'Erro desconhecido';
    const code = error.code || 'N/A';
    const details = error.details || '';
    console.error('[Supabase] Erro ao inserir evento:', { message: msg, code, details, payload });
    throw new Error(`${msg} [${code}] ${details}`.trim());
  }

  console.log('[Supabase] Evento inserido:', result);
  return result;
}

/* ============================================
   HELPER: atualizar evento no Supabase
   ============================================ */
async function updateEventoSupabase(id, data) {
  if (!_supabase) throw new Error('Supabase client não inicializado.');
  if (!id) throw new Error('ID do evento é obrigatório.');

  const payload = {};
  if (data.title !== undefined || data.titulo !== undefined) payload.titulo = data.titulo || data.title || '';
  if (data.type !== undefined || data.tipo !== undefined) payload.tipo = data.tipo || data.type || '';
  if (data.leadId !== undefined || data.lead_id !== undefined) payload.lead_id = data.lead_id || data.leadId || null;
  if (data.cliente !== undefined || data.cliente_nome !== undefined) payload.cliente_nome = data.cliente || data.cliente_nome || '';
  if (data.phone !== undefined || data.telefone !== undefined) payload.telefone = data.telefone || data.phone || '';
  if (data.location !== undefined || data.local !== undefined) payload.local = data.local || data.location || '';
  if (data.iso !== undefined || data.data_evento !== undefined) payload.data_evento = data.data_evento || data.iso || null;
  if (data.time !== undefined || data.hora_inicio !== undefined) payload.hora_inicio = data.hora_inicio || data.time || null;
  if (data.timeEnd !== undefined || data.hora_termino !== undefined) payload.hora_termino = data.hora_termino || data.timeEnd || null;
  if (data.duration !== undefined || data.duracao !== undefined) payload.duracao = data.duracao || data.duration || '';
  if (data.servicos_ids !== undefined) payload.servicos_ids = data.servicos_ids || [];
  if (data.temperature !== undefined || data.temperatura !== undefined) payload.temperatura = data.temperatura || data.temperature || '';
  if (data.honorarios !== undefined) payload.honorarios = data.honorarios || 0;
  if (data.notes !== undefined || data.observacoes !== undefined) payload.observacoes = data.observacoes || data.notes || '';
  if (data.cor !== undefined || data.color !== undefined) payload.cor = data.cor || data.color || '#2F80ED';

  if (Object.keys(payload).length === 0) throw new Error('Nenhum campo para atualizar.');

  console.log('[Supabase] Atualizando evento', id, payload);

  const { data: result, error } = await _supabase
    .from('eventos')
    .update(payload)
    .eq('id', id)
    .select();

  if (error) {
    const msg = error.message || 'Erro desconhecido';
    const code = error.code || 'N/A';
    console.error('[Supabase] Erro ao atualizar evento:', { message: msg, code, payload });
    throw new Error(`${msg} [${code}]`);
  }

  console.log('[Supabase] Evento atualizado:', result);
  return result;
}

/* ============================================
   HELPER: deletar evento no Supabase
   ============================================ */
async function deleteEventoSupabase(id) {
  if (!_supabase) throw new Error('Supabase client não inicializado.');
  if (!id) throw new Error('ID do evento é obrigatório.');

  console.log('[Supabase] Deletando evento:', id);

  const { error } = await _supabase
    .from('eventos')
    .delete()
    .eq('id', id);

  if (error) {
    const msg = error.message || 'Erro desconhecido';
    const code = error.code || 'N/A';
    console.error('[Supabase] Erro ao deletar evento:', { message: msg, code });
    throw new Error(`${msg} [${code}]`);
  }

  console.log('[Supabase] Evento deletado:', id);
}

/* ============================================
   HELPER: buscar eventos do Supabase
   ============================================ */
async function fetchEventosSupabase() {
  if (!_supabase) return [];

  const { data, error } = await _supabase
    .from('eventos')
    .select('*, leads(id, nome, telefone)')
    .order('data_evento', { ascending: true });

  if (error) {
    console.error('[Supabase] Erro ao buscar eventos:', error.message, error.code);
    return [];
  }

  console.log('[Supabase] Eventos encontrados:', (data || []).length);
  return (data || []).map(row => ({
    id: row.id,
    title: row.titulo || '',
    type: row.tipo || '',
    leadId: row.lead_id || null,
    lead: row.leads ? { id: row.leads.id, nome: row.leads.nome, telefone: row.leads.telefone } : null,
    cliente: row.cliente_nome || (row.leads ? row.leads.nome : ''),
    phone: row.telefone || '',
    location: row.local || '',
    iso: row.data_evento || '',
    time: row.hora_inicio || '',
    timeEnd: row.hora_termino || '',
    duration: row.duracao || '',
    services: row.servicos_ids || [],
    temperature: row.temperatura || '',
    honorarios: row.honorarios || 0,
    notes: row.observacoes || '',
    color: row.cor || meetingColor(row.tipo),
    status: 'agendada'
  }));
}

/* ============================================
   HELPER: buscar eventos dos próximos 7 dias
   ============================================ */
async function fetchProximosEventos() {
  if (!_supabase) return [];

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const weekLater = new Date(today);
  weekLater.setDate(weekLater.getDate() + 7);
  const weekLaterStr = weekLater.toISOString().slice(0, 10);

  const { data, error } = await _supabase
    .from('eventos')
    .select('*, leads(id, nome, telefone)')
    .gte('data_evento', todayStr)
    .lte('data_evento', weekLaterStr)
    .order('data_evento', { ascending: true });

  if (error) {
    console.error('[Supabase] Erro ao buscar próximos eventos:', error.message, error.code);
    return [];
  }

  console.log('[Supabase] Próximos eventos (7 dias):', (data || []).length);
  return (data || []).map(row => ({
    id: row.id,
    title: row.titulo || '',
    type: row.tipo || '',
    leadId: row.lead_id || null,
    lead: row.leads ? { id: row.leads.id, nome: row.leads.nome, telefone: row.leads.telefone } : null,
    phone: row.telefone || '',
    location: row.local || '',
    iso: row.data_evento || '',
    time: row.hora_inicio || '',
    timeEnd: row.hora_termino || '',
    duration: row.duracao || '',
    services: row.servicos_ids || [],
    temperature: row.temperatura || '',
    honorarios: row.honorarios || 0,
    notes: row.observacoes || '',
    color: row.cor || meetingColor(row.tipo),
    status: 'agendada'
  }));
}

/* ============================================
   HELPER: buscar clientes (leads + serviços)
   para a página "Cliente da Base"
   ============================================ */
async function fetchClientsSupabase(filterMemberId) {
  if (!_supabase) return [];

  console.log('[Supabase-Clientes] filterMemberId recebido:', filterMemberId, '| tipo:', typeof filterMemberId);

  let leadsQuery = _supabase.from('leads').select('*, membros!membro_id(nome)').order('created_at', { ascending: false });

  if (filterMemberId) {
    console.log('[Supabase-Clientes] Aplicando filtro membro_id/qualificador_id/owner_id/created_by:', filterMemberId);
    leadsQuery = leadsQuery.or('membro_id.eq.' + filterMemberId + ',qualificador_id.eq.' + filterMemberId + ',owner_id.eq.' + filterMemberId + ',created_by.eq.' + filterMemberId);
  } else {
    console.log('[Supabase-Clientes] SEM FILTRO — retornando TODOS os leads');
  }

  const [leadsRes, svcRes] = await Promise.all([
    leadsQuery,
    _supabase.from('servicos').select('*')
  ]);

  console.log('[Supabase-Clientes] Resultado:', leadsRes.data?.length, 'leads retornados');

  if (leadsRes.error) {
    console.error('[Supabase] Erro ao buscar leads (clientes):', leadsRes.error.message, leadsRes.error.code);
    throw leadsRes.error;
  }

  if (svcRes.error) {
    console.error('[Supabase] Erro ao buscar serviços:', svcRes.error.message, svcRes.error.code);
  }

  const svcMap = {};
  (svcRes.data || []).forEach(s => { svcMap[s.id] = s.nome; });

  const leads = leadsRes.data || [];
  console.log('[Supabase] Clientes carregados:', leads.length);

  return leads.map(row => {
    const rawSvc = row.tipo_servico_id;
    let services = [];
    if (Array.isArray(rawSvc)) {
      services = rawSvc.map(id => svcMap[id]).filter(Boolean);
    } else if (typeof rawSvc === 'string' && rawSvc.startsWith('[')) {
      try { services = JSON.parse(rawSvc).map(id => svcMap[id]).filter(Boolean); } catch {}
    } else if (rawSvc && svcMap[rawSvc]) {
      services = [svcMap[rawSvc]];
    }

    const nome = row.nome || 'Sem nome';
    const initials = nome.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const membroNome = row.membros ? row.membros.nome : '';

    const statusMap = {
      'frio': 'active', 'morno': 'active', 'quente': 'active',
      'geladeira': 'impl', 'stand-by': 'warn'
    };
    const status = statusMap[row.temperatura] || 'active';

    const created = row.created_at ? new Date(row.created_at) : new Date();
    const eventDate = row.data_evento || null;

    return {
      id: row.id,
      name: nome,
      cnpj: '',
      initials,
      avatar: 'avatar-blue',
      status,
      services,
      eventDate,
      thermal: row.temperatura || 'frio',
      honorarios: row.honorarios || 0,
      telefone: row.telefone || '',
      enderecoEvento: row.endereco_evento || '',
      quantidadeHoras: row.quantidade_horas || 0,
      observacoes: row.observacoes || '',
      _membroId: row.membro_id || null,
      _membroNome: membroNome,
      _qualificadorId: row.qualificador_id || null,
      _ownerId: row.owner_id || null,
      _createdBy: row.created_by || null,
      _cadenciaId: row.cadencia_id || null,
      _centroCustoId: row.centro_custo_id || null,
      _centroCustoNome: ''
    };
  });
}

/* ============================================
   HELPER: buscar serviços do Supabase
   ============================================ */
let _servicosCache = null;

const SERVICOS_SEED = [
  'Arco de lead',
  'Back Dropp',
  'Combo Blue',
  'Filmagem de Drone',
  'Filmagem Terrestre',
  'Plataforma 360°',
  'Setas de lead',
  'Som Profissional',
  'Totem de Fotos'
];

async function seedServicos() {
  if (!_supabase) return;

  const { data: existing, error: checkErr } = await _supabase
    .from('servicos')
    .select('id')
    .limit(1);

  if (checkErr) {
    console.error('[Supabase] Erro ao verificar servicos:', checkErr.message);
    return;
  }

  if (existing && existing.length > 0) {
    console.log('[Supabase] Tabela servicos já possui dados, seed ignorado');
    return;
  }

  const rows = SERVICOS_SEED.map(nome => ({ nome }));

  const { data, error } = await _supabase
    .from('servicos')
    .insert(rows)
    .select();

  if (error) {
    console.error('[Supabase] Erro ao inserir servicos seed:', error.message, error.code);
    return;
  }

  console.log('[Supabase] Servicos seed inseridos:', (data || []).length);
  _servicosCache = null;
}

async function fetchServicosSupabase() {
  if (_servicosCache) return _servicosCache;
  if (!_supabase) return [];

  const { data, error } = await _supabase
    .from('servicos')
    .select('*')
    .order('nome');

  if (error) {
    console.error('[Supabase] Erro ao buscar serviços:', error.message, error.code);
    return [];
  }

  _servicosCache = data || [];
  _servicosByName = {};
  _servicosById = {};
  _servicosCache.forEach(s => {
    _servicosByName[s.nome] = s;
    _servicosById[s.id] = s;
  });
  console.log('[Supabase] Serviços carregados:', _servicosCache.length);
  return _servicosCache;
}

/* ============================================
   HELPER: atualizar lead no Supabase
   ============================================ */
async function updateLeadSupabase(id, data) {
  if (!_supabase) throw new Error('Supabase client não inicializado.');

  const payload = { ...data };

  if ('honorarios' in payload) {
    payload.honorarios = parseBrazilianCurrency(payload.honorarios);
  }

  if ('quantidade_horas' in payload) {
    const n = parseInt(payload.quantidade_horas, 10);
    payload.quantidade_horas = isNaN(n) ? 0 : n;
  }

  if ('tipo_servico_id' in payload) {
    const val = payload.tipo_servico_id;
    if (val === undefined || val === null) {
      delete payload.tipo_servico_id;
    } else {
      const arr = Array.isArray(val) ? val : [val];
      payload.tipo_servico_id = arr.map(v => String(v).trim()).filter(v => v.length > 0);
    }
  }

  if ('cadencia_id' in payload) {
    const val = payload.cadencia_id;
    if (val === undefined || val === null) {
      delete payload.cadencia_id;
    } else {
      payload.cadencia_id = String(val).trim();
    }
  }

  Object.keys(payload).forEach(k => {
    if (payload[k] === undefined) delete payload[k];
  });

  console.log('[Supabase] Payload limpo:', JSON.stringify(payload, null, 2));

  await validateForeignKeys(payload);

  const { data: result, error } = await _supabase
    .from('leads')
    .update(payload)
    .eq('id', String(id))
    .select();

  if (error) {
    const msg = error.message || 'Erro desconhecido';
    const code = error.code || 'N/A';
    const details = error.details || '';
    const hint = error.hint || '';
    console.error('[Supabase] Erro ao atualizar lead:', { message: msg, code, details, hint, payload });
    throw new Error(`${msg} [${code}] ${details} ${hint}`.trim());
  }

  console.log('[Supabase] Lead atualizado com sucesso:', result);
  return result;
}

/* ============================================
   HELPER: buscar rotinas do Supabase
   ============================================ */
async function fetchRotinas(filterMemberId) {
  if (!_supabase) return [];

  let query = _supabase
    .from('rotinas')
    .select('*, membros!membro_id(nome)')
    .order('created_at', { ascending: false });

  if (filterMemberId) {
    console.log('[Supabase] Filtrando rotinas por membro_id:', filterMemberId);
    query = query.eq('membro_id', filterMemberId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[Supabase] Erro ao buscar rotinas:', error.message, error.code);
    return [];
  }

  console.log('[Supabase] Rotinas encontradas:', (data || []).length);
  return data || [];
}

/* ============================================
   HELPER: inserir rotina no Supabase
   ============================================ */
async function insertRotina(data) {
  if (!_supabase) throw new Error('Supabase client não inicializado.');

  const payload = {
    titulo:      data.titulo || '',
    observacoes: data.observacoes || '',
    status:      data.status || 'cadencia',
    cor:         data.cor || 'blue',
    data_tarefa: data.data_tarefa || null,
    hora_tarefa: data.hora_tarefa || null,
    tipo:        data.tipo || 'tarefa',
    fixado:      data.fixado || false
  };

  console.log('[Supabase] Inserindo rotina:', payload);

  const { data: result, error } = await _supabase
    .from('rotinas')
    .insert([payload])
    .select();

  if (error) {
    const msg = error.message || 'Erro desconhecido';
    const code = error.code || 'N/A';
    console.error('[Supabase] Erro ao inserir rotina:', { message: msg, code, payload });
    throw new Error(`${msg} [${code}]`);
  }

  console.log('[Supabase] Rotina inserida:', result);
  return result;
}

/* ============================================
   HELPER: atualizar rotina no Supabase
   ============================================ */
async function updateRotina(id, data) {
  if (!_supabase) throw new Error('Supabase client não inicializado.');
  if (!id) throw new Error('ID da rotina é obrigatório.');

  const payload = {};
  if (data.titulo !== undefined)      payload.titulo = data.titulo;
  if (data.observacoes !== undefined) payload.observacoes = data.observacoes;
  if (data.status !== undefined)      payload.status = data.status;
  if (data.cor !== undefined)         payload.cor = data.cor;
  if (data.data_tarefa !== undefined) payload.data_tarefa = data.data_tarefa || null;
  if (data.hora_tarefa !== undefined) payload.hora_tarefa = data.hora_tarefa || null;
  if (data.tipo !== undefined)        payload.tipo = data.tipo;
  if (data.fixado !== undefined)      payload.fixado = data.fixado;

  payload.data_edicao = new Date().toISOString();

  if (Object.keys(payload).length <= 1) throw new Error('Nenhum campo para atualizar.');

  console.log('[Supabase] Atualizando rotina', id, payload);

  const { data: result, error } = await _supabase
    .from('rotinas')
    .update(payload)
    .eq('id', id)
    .select();

  if (error) {
    const msg = error.message || 'Erro desconhecido';
    const code = error.code || 'N/A';
    console.error('[Supabase] Erro ao atualizar rotina:', { message: msg, code, payload });
    throw new Error(`${msg} [${code}]`);
  }

  console.log('[Supabase] Rotina atualizada:', result);
  return result;
}

/* ============================================
   HELPER: deletar rotina no Supabase
   ============================================ */
async function deleteRotina(id) {
  if (!_supabase) throw new Error('Supabase client não inicializado.');
  if (!id) throw new Error('ID da rotina é obrigatório.');

  console.log('[Supabase] Deletando rotina:', id);

  const { error } = await _supabase
    .from('rotinas')
    .delete()
    .eq('id', id);

  if (error) {
    const msg = error.message || 'Erro desconhecido';
    const code = error.code || 'N/A';
    console.error('[Supabase] Erro ao deletar rotina:', { message: msg, code });
    throw new Error(`${msg} [${code}]`);
  }

  console.log('[Supabase] Rotina deletada:', id);
}

/* ============================================
   HELPER: detectar dispositivo
   ============================================ */
function detectarDispositivo() {
  const ua = navigator.userAgent || '';
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return 'Mobile';
  return 'Desktop';
}

/* ============================================
   HELPER: registrar auditoria
   ============================================ */
async function registrarAuditoria(dados) {
  if (!_supabase) return;

  const payload = {
    usuario_nome: dados.usuario_nome || currentUser?.nome || 'Usuário',
    usuario_id:   dados.usuario_id   || currentUser?.id   || 'anon',
    acao:         dados.acao         || '',
    caminho_url:  dados.caminho_url  || '',
    modulo:       dados.modulo       || '',
    dispositivo:  dados.dispositivo  || detectarDispositivo()
  };

  const { error } = await _supabase
    .from('auditoria')
    .insert([payload]);

  if (error) {
    console.error('[Auditoria] Erro ao registrar:', error.message, error.code);
  }
}

/* ============================================
   HELPER: buscar auditoria com filtros
   ============================================ */
async function buscarAuditoria(filtros = {}) {
  if (!_supabase) return [];

  let query = _supabase
    .from('auditoria')
    .select('*');

  if (filtros.modulo && filtros.modulo !== 'all') {
    query = query.ilike('modulo', `%${filtros.modulo}%`);
  }
  if (filtros.acao && filtros.acao !== 'all') {
    query = query.eq('acao', filtros.acao);
  }
  if (filtros.usuario && filtros.usuario !== 'all') {
    query = query.ilike('usuario_nome', `%${filtros.usuario}%`);
  }
  if (filtros.dispositivo && filtros.dispositivo !== 'all') {
    query = query.ilike('dispositivo', `%${filtros.dispositivo}%`);
  }
  if (filtros.dataInicio) {
    query = query.gte('created_at', filtros.dataInicio);
  }
  if (filtros.dataFim) {
    query = query.lte('created_at', filtros.dataFim);
  }
  if (filtros.busca) {
    query = query.or(`usuario_nome.ilike.%${filtros.busca}%,acao.ilike.%${filtros.busca}%,caminho_url.ilike.%${filtros.busca}%`);
  }

  const limit = filtros.limit || 200;
  query = query.order('created_at', { ascending: false }).limit(limit);

  const { data, error } = await query;

  if (error) {
    console.error('[Auditoria] Erro ao buscar:', error.message, error.code);
    return [];
  }

  return data || [];
}

/* ============================================
   HELPER: contar registros de auditoria
   ============================================ */
async function contarAuditoria() {
  if (!_supabase) return 0;

  const { count, error } = await _supabase
    .from('auditoria')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('[Auditoria] Erro ao contar:', error.message);
    return 0;
  }

  return count || 0;
}

/* ============================================
   HELPER: contar ações de hoje
   ============================================ */
async function contarAcoesHoje() {
  if (!_supabase) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString();

  const { count, error } = await _supabase
    .from('auditoria')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', todayStr);

  if (error) {
    console.error('[Auditoria] Erro ao contar ações hoje:', error.message);
    return 0;
  }

  return count || 0;
}

/* ============================================
   HELPER: contar usuários ativos hoje
   ============================================ */
async function contarUsuariosAtivosHoje() {
  if (!_supabase) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString();

  const { data, error } = await _supabase
    .from('auditoria')
    .select('usuario_nome')
    .gte('created_at', todayStr);

  if (error) {
    console.error('[Auditoria] Erro ao contar usuários hoje:', error.message);
    return 0;
  }

  const unique = new Set((data || []).map(r => r.usuario_nome));
  return unique.size;
}

/* ============================================
   HELPER: centros de custo
   ============================================ */
let _centrosCustoCache = null;

async function fetchCentrosCusto() {
  if (_centrosCustoCache) return _centrosCustoCache;
  if (!_supabase) return [];

  const { data, error } = await _supabase
    .from('centros_custo')
    .select('*')
    .order('nome');

  if (error) {
    console.error('[Supabase] Erro ao buscar centros de custo:', error.message, error.code);
    return [];
  }

  _centrosCustoCache = data || [];
  console.log('[Supabase] Centros de custo carregados:', _centrosCustoCache.length);
  return _centrosCustoCache;
}

async function insertCentroCusto(nome) {
  if (!_supabase) throw new Error('Supabase client não inicializado.');

  const { data, error } = await _supabase
    .from('centros_custo')
    .insert([{ nome }])
    .select();

  if (error) {
    console.error('[Supabase] Erro ao inserir centro de custo:', error.message, error.code);
    throw error;
  }

  _centrosCustoCache = null;
  console.log('[Supabase] Centro de custo inserido:', data);
  return data;
}

async function deleteCentroCusto(id) {
  if (!_supabase) throw new Error('Supabase client não inicializado.');
  if (!id) throw new Error('ID do centro de custo é obrigatório.');

  const { error } = await _supabase
    .from('centros_custo')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[Supabase] Erro ao deletar centro de custo:', error.message, error.code);
    throw error;
  }

  _centrosCustoCache = null;
  console.log('[Supabase] Centro de custo deletado:', id);
}

function invalidateCentrosCustoCache() {
  _centrosCustoCache = null;
}

/* ============================================
   TESTE: verificar conexão e permissões
   Rode no Console: testarSupabase()
   ============================================ */
async function testarSupabase() {
  console.log('[Teste] Cliente:', _supabase ? 'OK' : 'FALHOU');
  console.log('[Teste] URL:', SUPABASE_URL);

  if (!_supabase) {
    console.error('[Teste] O client Supabase não foi inicializado. CDN pode ter falhado.');
    return;
  }

  const { data, error } = await _supabase
    .from('leads')
    .select('id')
    .limit(1);

  if (error) {
    console.error('[Teste] SELECT falhou:', error.message, error.code, error.hint);
  } else {
    console.log('[Teste] SELECT OK. Dados:', data);
  }
}

// Exposição global de funções utilitárias para compatibilidade com app.js
window.fetchCadenciasMap = fetchCadenciasMap;
window.rebuildCadenciaMaps = rebuildCadenciaMaps;
window.parseBrazilianCurrency = parseBrazilianCurrency;
window.validateForeignKeys = validateForeignKeys;
window.fetchLeadsSupabase = fetchLeadsSupabase;
window.insertLeadSupabase = insertLeadSupabase;
window.insertEventoSupabase = insertEventoSupabase;
window.updateEventoSupabase = updateEventoSupabase;
window.deleteEventoSupabase = deleteEventoSupabase;
window.fetchEventosSupabase = fetchEventosSupabase;
window.fetchProximosEventos = fetchProximosEventos;
window.fetchClientsSupabase = fetchClientsSupabase;
window.seedServicos = seedServicos;
window.fetchServicosSupabase = fetchServicosSupabase;
window.updateLeadSupabase = updateLeadSupabase;
window.fetchRotinas = fetchRotinas;
window.insertRotina = insertRotina;
window.updateRotina = updateRotina;
window.deleteRotina = deleteRotina;
window.detectarDispositivo = detectarDispositivo;
window.registrarAuditoria = registrarAuditoria;
window.buscarAuditoria = buscarAuditoria;
window.contarAuditoria = contarAuditoria;
window.contarAcoesHoje = contarAcoesHoje;
window.contarUsuariosAtivosHoje = contarUsuariosAtivosHoje;
window.fetchCentrosCusto = fetchCentrosCusto;
window.insertCentroCusto = insertCentroCusto;
window.deleteCentroCusto = deleteCentroCusto;
window.invalidateCentrosCustoCache = invalidateCentrosCustoCache;
window.testarSupabase = testarSupabase;
