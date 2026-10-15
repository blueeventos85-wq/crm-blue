import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ===========================================================
   Coluna "TIPO" da listagem de contratos (badges) +
   persistência de tipo_contrato ('100%' | '50%' | '2x' | 'proposta').
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appJs = readFileSync(join(root, 'app.js'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const migration = readFileSync(join(root, 'Colunas:Tabelas/migration_contrato_tipo.sql'), 'utf8');

function extractFn(source, header) {
  const start = source.indexOf(header);
  if (start === -1) return null;
  const paramsEnd = source.indexOf(') {', Math.max(start, start + header.length - 1));
  if (paramsEnd === -1) return null;
  let depth = 0;
  for (let i = paramsEnd + 1; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

describe('Tabela de contratos — coluna TIPO', () => {
  it('cabeçalho tem "Tipo" entre Empresa e Serviço(s)', () => {
    const iEmpresa = indexHtml.indexOf('<th>Empresa</th>');
    const iTipo = indexHtml.indexOf('<th>Tipo</th>');
    const iServico = indexHtml.indexOf('<th>Serviço(s)</th>');
    assert.ok(iEmpresa > -1 && iTipo > -1 && iServico > -1, 'colunas do cabeçalho ausentes');
    assert.ok(iEmpresa < iTipo && iTipo < iServico, 'TIPO fora de posição (Empresa → Tipo → Serviço(s))');
  });

  it('renderiza a badge do tipo em cada linha', () => {
    const render = extractFn(appJs, 'function renderContratosTable(');
    assert.ok(render, 'renderContratosTable ausente');
    assert.ok(render.includes('contratoTipoBadge(c)'), 'não renderiza a badge do tipo');
    assert.ok(render.indexOf('contratoTipoBadge(c)') < render.indexOf('contract-service'),
      'badge do tipo fora de posição na linha');
    assert.ok(render.includes('colspan="10"'), 'lista vazia não contempla a nova coluna');
  });

  it('badges cobrem os tipos no padrão visual do sistema', () => {
    const corpo = extractFn(appJs, 'function contratoTipoBadge(');
    assert.ok(corpo, 'contratoTipoBadge ausente');
    for (const tipo of ['100%', '50%', '2x', '3x', '4x', '5x', 'proposta']) {
      assert.ok(corpo.includes(`'${tipo}'`), `sem o tipo ${tipo}`);
    }
    for (const cls of ['contrato-tipo-100', 'contrato-tipo-50', 'contrato-tipo-2x',
      'contrato-tipo-3x', 'contrato-tipo-4x', 'contrato-tipo-5x', 'contrato-tipo-proposta']) {
      assert.ok(corpo.includes(cls), `sem a classe ${cls}`);
    }
    assert.ok(corpo.includes('badge'), 'não usa o padrão de badge do sistema');
    assert.ok(corpo.includes("quantidade_parcelas"), 'contrato legado sem tipo não vira Nx/100%');
  });
});

describe('Persistência do tipo_contrato', () => {
  it('collectContratoFormData grava o tipo junto do contrato', () => {
    const corpo = extractFn(appJs, 'function collectContratoFormData()');
    assert.ok(corpo, 'collectContratoFormData ausente');
    assert.ok(corpo.includes('tipo_contrato: _resolveTipoContrato()'), 'não grava tipo_contrato');
  });

  it('_resolveTipoContrato mapeia os fluxos (100% | 50% | Nx)', () => {
    const corpo = extractFn(appJs, 'function _resolveTipoContrato()');
    assert.ok(corpo, '_resolveTipoContrato ausente');
    assert.ok(corpo.includes("return '100%'"), 'parcela única não vira 100%');
    assert.ok(corpo.includes("condicao === '50'"), 'condição 50/50 não vira 50%');
    assert.ok(corpo.includes('`${Math.min(n, 5)}x`'), 'parcelado não vira Nx (até 5x)');
  });

  it('edição reabre no fluxo salvo do contrato', () => {
    const corpo = extractFn(appJs, 'async function contratoEdit(');
    assert.ok(corpo, 'contratoEdit ausente');
    assert.ok(corpo.includes("data.tipo_contrato === '50%' ? '50'"),
      'não restaura o fluxo 50% pelo tipo salvo');
    assert.ok(corpo.includes('Math.min(qtdParcelas, 5)'), 'não restaura o parcelamento Nx');
    assert.ok(corpo.includes("for (let i = 1; i <= 5; i++)"), 'não preenche as parcelas em loop');
  });

  it('edição não trava se a migration da coluna ainda não rodou', () => {
    assert.ok(appJs.includes('function _contratoUpdateSemTipo('), 'sem fallback de update sem tipo_contrato');
    for (const header of ['async function saveContrato(', 'async function salvarContratoComoRascunho(']) {
      const corpo = extractFn(appJs, header);
      assert.ok(corpo, `${header} ausente`);
      assert.ok(corpo.includes('_contratoUpdateSemTipo('), `${header} sem retry sem tipo_contrato`);
    }
  });
});

describe('Migration tipo_contrato', () => {
  it('cria a coluna e define o padrão para contratos antigos', () => {
    assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS tipo_contrato'), 'sem ALTER TABLE');
    assert.ok(/UPDATE public\.contratos[\s\S]*tipo_contrato = '100%'[\s\S]*WHERE tipo_contrato IS NULL/.test(migration),
      'sem o default 100% para contratos já existentes');
  });

  it('atualiza a RPC de criação para gravar o tipo', () => {
    assert.ok(migration.includes('CREATE OR REPLACE FUNCTION public.create_contrato_with_number'),
      'sem recriação da RPC');
    assert.ok(migration.includes('tipo_contrato,'), 'coluna fora do INSERT da RPC');
    assert.ok(migration.includes("p_data->>'tipo_contrato'"), 'RPC não lê tipo_contrato do payload');
    assert.ok(migration.includes("COALESCE(NULLIF(p_data->>'tipo_contrato', ''), '100%')"),
      'RPC sem default 100%');
  });
});
