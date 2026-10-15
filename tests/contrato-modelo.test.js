import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CONTRATO_MODELO,
  CONTRATO_TITULO_PADRAO,
  CONTRATO_FILTRO_SEM_EMPRESA,
  mergeModelo,
  resolveModelo,
  resolveEmpresaDefault,
  parseEmpresaFilterValue,
  EMPRESAS_LIBERADAS_PADRAO,
  MSG_SELECIONAR_EMPRESA_CRIAVEL,
  msgModeloNaoConfigurado,
  idsEmpresaCriavel,
  empresaCriavel,
  motivoBloqueioCriacao,
  podeSalvarContrato
} from '../src/lib/contrato/modelo.js';

const CC_BLUE = 'f6b86575-6f66-4786-a220-451fcf10db36';
const CC_OUTRA = '11111111-1111-4111-8111-111111111111';
const CC_DIGITAL = '22222222-2222-4222-8222-222222222222';
const CC_PRO = '33333333-3333-4333-8333-333333333333';

const EMPRESAS = [
  { id: CC_BLUE, nome: 'Blue Eventos' },
  { id: CC_DIGITAL, nome: 'Blue Digital' },
  { id: CC_PRO, nome: 'Blue PRO' }
];
const MODELOS = [{ id: 'mod-blue-eventos', centro_custo_id: CC_BLUE, ativo: true }];
const SEM_TABELA = { modelosDisponiveis: false, modelos: [], empresas: EMPRESAS };
const COM_TABELA = { modelosDisponiveis: true, modelos: MODELOS, empresas: EMPRESAS };

describe('DEFAULT_CONTRATO_MODELO (modelo vinculado à Blue Eventos)', () => {
  it('mantém os dados legais já cadastrados', () => {
    assert.equal(DEFAULT_CONTRATO_MODELO.contratada_razao_social,
      'Agência Blue Organização de Eventos e Inteligência Empresarial Ltda.');
    assert.equal(DEFAULT_CONTRATO_MODELO.contratada_cnpj, '59.417.603/0001-36');
    assert.equal(DEFAULT_CONTRATO_MODELO.contratada_endereco,
      'Av. Eng. Humberto Monte, 2929, Pici, Fortaleza/CE');
    assert.equal(DEFAULT_CONTRATO_MODELO.contratada_cep, '60.440-593');
  });

  it('mantém o cabeçalho e a marca d\'água atuais', () => {
    assert.equal(DEFAULT_CONTRATO_MODELO.titulo, CONTRATO_TITULO_PADRAO);
    assert.equal(DEFAULT_CONTRATO_MODELO.cabecalho.nome, 'Agência Blue PRO');
    assert.equal(DEFAULT_CONTRATO_MODELO.cabecalho.site, 'www.agenciabluepro.com.br');
    assert.equal(DEFAULT_CONTRATO_MODELO.cabecalho.instagram, '@agenciabluepro');
    assert.equal(DEFAULT_CONTRATO_MODELO.cabecalho.whatsapp, '(85) 99149-9320');
    assert.equal(DEFAULT_CONTRATO_MODELO.cabecalho.logo, null);
    assert.equal(DEFAULT_CONTRATO_MODELO.marca_dagua_url, null);
  });
});

describe('mergeModelo()', () => {
  it('sem modelo retorna o padrão', () => {
    assert.deepEqual(mergeModelo(null), { ...DEFAULT_CONTRATO_MODELO, cabecalho: { ...DEFAULT_CONTRATO_MODELO.cabecalho } });
    assert.deepEqual(mergeModelo(undefined), { ...DEFAULT_CONTRATO_MODELO, cabecalho: { ...DEFAULT_CONTRATO_MODELO.cabecalho } });
  });

  it('campos vazios caem no padrão (nunca quebra o PDF)', () => {
    const m = mergeModelo({ titulo: '  ', contratada_cnpj: null, cabecalho: {} });
    assert.equal(m.titulo, CONTRATO_TITULO_PADRAO);
    assert.equal(m.contratada_cnpj, '59.417.603/0001-36');
    assert.equal(m.cabecalho.nome, 'Agência Blue PRO');
    assert.equal(m.cabecalho.logo, null);
  });

  it('valores da empresa são preservados', () => {
    const m = mergeModelo({
      id: 'x',
      centro_custo_id: CC_BLUE,
      titulo: 'Contrato de Locação',
      contratada_razao_social: 'Outra Razão Ltda',
      cabecalho: { nome: 'Outra Marca', logo: 'data:image/png;base64,AAAA' },
      marca_dagua_url: '/assets/outro.png'
    });
    assert.equal(m.centro_custo_id, CC_BLUE);
    assert.equal(m.titulo, 'Contrato de Locação');
    assert.equal(m.contratada_razao_social, 'Outra Razão Ltda');
    assert.equal(m.contratada_cnpj, '59.417.603/0001-36');
    assert.equal(m.cabecalho.nome, 'Outra Marca');
    assert.equal(m.cabecalho.whatsapp, '(85) 99149-9320');
    assert.equal(m.cabecalho.logo, 'data:image/png;base64,AAAA');
    assert.equal(m.marca_dagua_url, '/assets/outro.png');
  });

  it('aceita cabecalho vindo como string inválida sem lançar erro', () => {
    const m = mergeModelo({ cabecalho: 'não é objeto' });
    assert.equal(m.cabecalho.nome, 'Agência Blue PRO');
  });
});

describe('resolveModelo()', () => {
  const modelos = [
    { centro_custo_id: CC_BLUE, ativo: true, titulo: 'Modelo Blue Eventos' },
    { centro_custo_id: CC_OUTRA, ativo: false, titulo: 'Inativo' }
  ];

  it('usa o modelo da empresa quando existe e está ativo', () => {
    assert.equal(resolveModelo(CC_BLUE, modelos).titulo, 'Modelo Blue Eventos');
  });

  it('cai no padrão quando a empresa não tem modelo', () => {
    assert.equal(resolveModelo(CC_OUTRA, modelos).titulo, CONTRATO_TITULO_PADRAO);
    assert.equal(resolveModelo('22222222-2222-4222-8222-222222222222', modelos).titulo, CONTRATO_TITULO_PADRAO);
  });

  it('cai no padrão quando não há empresa', () => {
    assert.equal(resolveModelo(null, modelos).titulo, CONTRATO_TITULO_PADRAO);
    assert.equal(resolveModelo(null).centro_custo_id, null);
  });
});

describe('resolveEmpresaDefault()', () => {
  it('prioriza a empresa do lead quando permitida', () => {
    const r = resolveEmpresaDefault({ leadCcId: CC_BLUE, userCcIds: [CC_OUTRA], opcoes: [CC_BLUE, CC_OUTRA], isAdmin: true });
    assert.equal(r, CC_BLUE);
  });

  it('ignora a empresa do lead quando o usuário não tem acesso a ela', () => {
    const r = resolveEmpresaDefault({ leadCcId: CC_BLUE, userCcIds: [CC_OUTRA], opcoes: [CC_OUTRA], isAdmin: false });
    assert.equal(r, CC_OUTRA);
  });

  it('usa a primeira empresa do próprio usuário', () => {
    const r = resolveEmpresaDefault({ userCcIds: [CC_OUTRA, CC_BLUE], opcoes: [CC_BLUE, CC_OUTRA], isAdmin: false });
    assert.equal(r, CC_OUTRA);
  });

  it('admin sem lead cai na primeira opção disponível', () => {
    const r = resolveEmpresaDefault({ opcoes: [CC_BLUE, CC_OUTRA], isAdmin: true });
    assert.equal(r, CC_BLUE);
  });

  it('retorna null quando não há nenhuma opção', () => {
    assert.equal(resolveEmpresaDefault({ opcoes: [], isAdmin: true }), null);
    assert.equal(resolveEmpresaDefault({}), null);
  });
});

describe('parseEmpresaFilterValue()', () => {
  it('valor vazio significa todas as empresas', () => {
    assert.deepEqual(parseEmpresaFilterValue(''), { tipo: 'todas' });
    assert.deepEqual(parseEmpresaFilterValue(null), { tipo: 'todas' });
    assert.deepEqual(parseEmpresaFilterValue(undefined), { tipo: 'todas' });
  });

  it('reconhece a opção sem empresa', () => {
    assert.deepEqual(parseEmpresaFilterValue(CONTRATO_FILTRO_SEM_EMPRESA), { tipo: 'sem_empresa' });
  });

  it('reconhece um id de empresa', () => {
    assert.deepEqual(parseEmpresaFilterValue(CC_BLUE), { tipo: 'empresa', centroCustoId: CC_BLUE });
  });
});

/* ============================================
   CRIAÇÃO RESTRITA A EMPRESAS COM MODELO
   ============================================ */

describe('idsEmpresaCriavel()', () => {
  it('libera as empresas com modelo ativo ou template embutido', () => {
    assert.deepEqual(idsEmpresaCriavel(COM_TABELA), [CC_BLUE, CC_PRO]);
  });

  it('sem linhas na tabela, empresas com template embutido seguem liberadas', () => {
    assert.deepEqual(idsEmpresaCriavel({ ...COM_TABELA, modelos: [] }), [CC_BLUE, CC_PRO]);
  });

  it('linha inativa bloqueia a empresa; template embutido sem linha segue liberado', () => {
    assert.deepEqual(
      idsEmpresaCriavel({ ...COM_TABELA, modelos: [{ centro_custo_id: CC_BLUE, ativo: false }] }),
      [CC_PRO]
    );
  });

  it('fallback por nome enquanto a tabela não existe (pré-migration)', () => {
    assert.deepEqual(EMPRESAS_LIBERADAS_PADRAO, ['blue eventos', 'blue pro']);
    assert.deepEqual(idsEmpresaCriavel(SEM_TABELA), [CC_BLUE, CC_PRO]);
  });
});

describe('empresaCriavel()', () => {
  it('sem empresa considera como não criável', () => {
    assert.equal(empresaCriavel({ ...COM_TABELA }), false);
    assert.equal(empresaCriavel({ centroCustoId: '', ...COM_TABELA }), false);
  });

  it('empresa sem modelo embutido e sem linha própria fica bloqueada', () => {
    assert.equal(empresaCriavel({ centroCustoId: CC_BLUE, ...COM_TABELA }), true);
    assert.equal(empresaCriavel({ centroCustoId: CC_DIGITAL, ...COM_TABELA }), false);
    assert.equal(empresaCriavel({ centroCustoId: CC_PRO, ...COM_TABELA }), true);
  });
});

describe('Criação liberada para Blue Eventos e Blue PRO', () => {
  it('Blue Eventos: criação disponível', () => {
    assert.equal(motivoBloqueioCriacao({ filtro: CC_BLUE, ...COM_TABELA }), null);
    const res = podeSalvarContrato({ centroCustoId: CC_BLUE, ...COM_TABELA });
    assert.equal(res.ok, true);
    assert.equal(res.motivo, null);
  });

  it('Blue PRO: criação disponível (template embutido, sem aviso de modelo)', () => {
    assert.equal(motivoBloqueioCriacao({ filtro: CC_PRO, ...COM_TABELA }), null);
    const res = podeSalvarContrato({ centroCustoId: CC_PRO, ...COM_TABELA });
    assert.equal(res.ok, true);
    assert.equal(res.motivo, null);
  });

  it('Blue Digital: bloqueada com aviso de modelo não configurado', () => {
    const motivo = motivoBloqueioCriacao({ filtro: CC_DIGITAL, ...COM_TABELA });
    assert.equal(motivo, msgModeloNaoConfigurado('Blue Digital'));
    const res = podeSalvarContrato({ centroCustoId: CC_DIGITAL, ...COM_TABELA });
    assert.equal(res.ok, false);
    assert.equal(res.motivo, motivo);
  });

  it('Todas as Empresas: botão de criação desabilitado', () => {
    assert.equal(motivoBloqueioCriacao({ filtro: '', ...COM_TABELA }), MSG_SELECIONAR_EMPRESA_CRIAVEL);
    assert.equal(motivoBloqueioCriacao({ filtro: null, ...COM_TABELA }), MSG_SELECIONAR_EMPRESA_CRIAVEL);
  });

  it('Sem empresa: botão de criação desabilitado e salvamento bloqueado', () => {
    assert.equal(
      motivoBloqueioCriacao({ filtro: CONTRATO_FILTRO_SEM_EMPRESA, ...COM_TABELA }),
      MSG_SELECIONAR_EMPRESA_CRIAVEL
    );
    const res = podeSalvarContrato({ centroCustoId: null, ...COM_TABELA });
    assert.equal(res.ok, false);
    assert.equal(res.motivo, MSG_SELECIONAR_EMPRESA_CRIAVEL);
  });

  it('mesmo comportamento quando a tabela de modelos ainda não existe', () => {
    assert.equal(motivoBloqueioCriacao({ filtro: CC_BLUE, ...SEM_TABELA }), null);
    assert.equal(motivoBloqueioCriacao({ filtro: CC_PRO, ...SEM_TABELA }), null);
    assert.equal(motivoBloqueioCriacao({ filtro: CC_DIGITAL, ...SEM_TABELA }), msgModeloNaoConfigurado('Blue Digital'));
    assert.equal(motivoBloqueioCriacao({ filtro: '', ...SEM_TABELA }), MSG_SELECIONAR_EMPRESA_CRIAVEL);
  });

  it('mensagem de empresa desconhecida não expõe texto vazio', () => {
    assert.equal(
      motivoBloqueioCriacao({ filtro: CC_OUTRA, ...COM_TABELA }),
      msgModeloNaoConfigurado('empresa selecionada')
    );
  });
});

describe('podeSalvarContrato() — edição preserva dados existentes', () => {
  it('mantém a empresa já salva mesmo sem modelo cadastrado', () => {
    const res = podeSalvarContrato({
      centroCustoId: CC_DIGITAL,
      centroCustoIdSalvo: CC_DIGITAL,
      isEdicao: true,
      ...COM_TABELA
    });
    assert.equal(res.ok, true);
  });

  it('bloqueia trocar a empresa durante a edição para uma sem template', () => {
    const res = podeSalvarContrato({
      centroCustoId: CC_DIGITAL,
      centroCustoIdSalvo: CC_BLUE,
      isEdicao: true,
      ...COM_TABELA
    });
    assert.equal(res.ok, false);
    assert.equal(res.motivo, msgModeloNaoConfigurado('Blue Digital'));
  });

  it('permite trocar a empresa durante a edição para a Blue PRO', () => {
    const res = podeSalvarContrato({
      centroCustoId: CC_PRO,
      centroCustoIdSalvo: CC_BLUE,
      isEdicao: true,
      ...COM_TABELA
    });
    assert.equal(res.ok, true);
    assert.equal(res.motivo, null);
  });

  it('permite editar contrato antigo que não tinha empresa', () => {
    const res = podeSalvarContrato({ centroCustoId: null, isEdicao: true, ...COM_TABELA });
    assert.equal(res.ok, true);
  });

  it('mantém Blue Eventos e Blue PRO criando antes do push da migration', () => {
    assert.equal(podeSalvarContrato({ centroCustoId: CC_BLUE, ...SEM_TABELA }).ok, true);
    assert.equal(podeSalvarContrato({ centroCustoId: CC_PRO, ...SEM_TABELA }).ok, true);
    assert.equal(podeSalvarContrato({ centroCustoId: CC_DIGITAL, ...SEM_TABELA }).ok, false);
  });
});

describe('resolveEmpresaDefault() com opções já filtradas', () => {
  it('nunca seleciona empresa sem modelo (nem a do lead)', () => {
    assert.equal(
      resolveEmpresaDefault({ leadCcId: CC_DIGITAL, userCcIds: [CC_DIGITAL, CC_BLUE], opcoes: [CC_BLUE], isAdmin: true }),
      CC_BLUE
    );
  });

  it('usa a Blue Eventos como padrão quando é a única liberada', () => {
    assert.equal(
      resolveEmpresaDefault({ userCcIds: [CC_PRO, CC_BLUE], opcoes: [CC_BLUE], isAdmin: false }),
      CC_BLUE
    );
  });
});
