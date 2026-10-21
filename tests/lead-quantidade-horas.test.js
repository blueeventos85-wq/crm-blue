import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  formatarQuantidadeHoras,
  validarQuantidadeHoras,
  mascararQuantidadeHoras,
  quantidadeHorasParaDecimal
} from '../src/lib/lead/horas.js';

/* ===========================================================
   Testes: "Quantidade de Horas" do lead em formato HH:mm
   - formatação/compat com registros legados numéricos (2 → "02:00")
   - validação antes da submissão (horas 00-99, minutos 00-59)
   - máscara de digitação com auto ":"
   - leitura/escrita no supabaseClient e payloads do saveLead
   - migração da coluna leads.quantidade_horas para TEXT
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const appJs = readFileSync(join(root, 'app.js'), 'utf8');
const clientJs = readFileSync(join(root, 'supabaseClient.js'), 'utf8');
const migrationPath = join(root, 'supabase/migrations/20261020090000_leads_quantidade_horas_text.sql');

/** Extrai o corpo de uma função top-level (contagem de chaves). */
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

/* ===========================================================
   Suite: formatação e compatibilidade com dados antigos
   =========================================================== */
describe('formatarQuantidadeHoras · HH:mm com fallback legado', () => {
  it('registros antigos numéricos viram HH:mm (2 → "02:00", 2.5 → "02:30")', () => {
    assert.equal(formatarQuantidadeHoras(2), '02:00');
    assert.equal(formatarQuantidadeHoras(2.0), '02:00');
    assert.equal(formatarQuantidadeHoras(4), '04:00');
    assert.equal(formatarQuantidadeHoras(2.5), '02:30');
    assert.equal(formatarQuantidadeHoras('2,5'), '02:30');
    assert.equal(formatarQuantidadeHoras('2.5'), '02:30');
    assert.equal(formatarQuantidadeHoras('4'), '04:00');
  });

  it('valores já no formato HH:mm são preservados e completados', () => {
    assert.equal(formatarQuantidadeHoras('02:25'), '02:25');
    assert.equal(formatarQuantidadeHoras('04:30'), '04:30');
    assert.equal(formatarQuantidadeHoras('2:5'), '02:05');
    assert.equal(formatarQuantidadeHoras('99:59'), '99:59');
  });

  it('colado sem ":" no padrão HHmm vira HH:mm', () => {
    assert.equal(formatarQuantidadeHoras('0225'), '02:25');
    assert.equal(formatarQuantidadeHoras('0430'), '04:30');
  });

  it('vazio/zero/inválido → "" (nada quebrante na interface)', () => {
    assert.equal(formatarQuantidadeHoras(null), '');
    assert.equal(formatarQuantidadeHoras(undefined), '');
    assert.equal(formatarQuantidadeHoras(''), '');
    assert.equal(formatarQuantidadeHoras('   '), '');
    assert.equal(formatarQuantidadeHoras(0), '');
    assert.equal(formatarQuantidadeHoras('0'), '');
    assert.equal(formatarQuantidadeHoras('abc'), '');
    assert.equal(formatarQuantidadeHoras('12:75'), '');
    assert.equal(formatarQuantidadeHoras('100:00'), '');
    assert.equal(formatarQuantidadeHoras('12:'), '');
  });
});

/* ===========================================================
   Suite: validação do formulário
   =========================================================== */
describe('validarQuantidadeHoras · submissão', () => {
  it('campo opcional: vazio é aceito', () => {
    assert.equal(validarQuantidadeHoras(''), true);
    assert.equal(validarQuantidadeHoras('   '), true);
    assert.equal(validarQuantidadeHoras(null), true);
    assert.equal(validarQuantidadeHoras(undefined), true);
    assert.equal(validarQuantidadeHoras('0'), true);
    assert.equal(validarQuantidadeHoras('00'), true);
  });

  it('aceita formatos válidos (horas 00-99, minutos 00-59)', () => {
    assert.equal(validarQuantidadeHoras('02:25'), true);
    assert.equal(validarQuantidadeHoras('04:30'), true);
    assert.equal(validarQuantidadeHoras('99:59'), true);
    assert.equal(validarQuantidadeHoras('00:00'), true);
    assert.equal(validarQuantidadeHoras('2'), true);
    assert.equal(validarQuantidadeHoras('2:5'), true);
  });

  it('recusa formatos incompletos ou caracteres inválidos', () => {
    assert.equal(validarQuantidadeHoras('12:75'), false);
    assert.equal(validarQuantidadeHoras('12:'), false);
    assert.equal(validarQuantidadeHoras(':30'), false);
    assert.equal(validarQuantidadeHoras('abc'), false);
    assert.equal(validarQuantidadeHoras('1h30'), false);
    assert.equal(validarQuantidadeHoras('100:00'), false);
    assert.equal(validarQuantidadeHoras('02:2a'), false);
    assert.equal(validarQuantidadeHoras('7599'), false);
  });
});

/* ===========================================================
   Suite: máscara de digitação
   =========================================================== */
describe('mascararQuantidadeHoras · digitação com auto ":"', () => {
  it('insere o ":" automático ao passar de 2 dígitos', () => {
    assert.equal(mascararQuantidadeHoras(''), '');
    assert.equal(mascararQuantidadeHoras('2'), '2');
    assert.equal(mascararQuantidadeHoras('25'), '25');
    assert.equal(mascararQuantidadeHoras('250'), '25:0');
    assert.equal(mascararQuantidadeHoras('2502'), '25:02');
  });

  it('mantém o ":" digitado manualmente e aceita colagem', () => {
    assert.equal(mascararQuantidadeHoras('2:'), '2:');
    assert.equal(mascararQuantidadeHoras('2:3'), '2:3');
    assert.equal(mascararQuantidadeHoras('02:25'), '02:25');
    assert.equal(mascararQuantidadeHoras('0225'), '02:25');
    assert.equal(mascararQuantidadeHoras('02:25:00'), '02:25');
  });

  it('descarta não dígitos e limita a 2h + 2min', () => {
    assert.equal(mascararQuantidadeHoras('ab'), '');
    assert.equal(mascararQuantidadeHoras('1234567'), '12:34');
    assert.equal(mascararQuantidadeHoras('2x5'), '25');
  });
});

/* ===========================================================
   Suite: ponte para o campo numérico do contrato
   =========================================================== */
describe('quantidadeHorasParaDecimal · prefill do contrato', () => {
  it('converte HH:mm para horas decimais', () => {
    assert.equal(quantidadeHorasParaDecimal('02:25'), 2.42);
    assert.equal(quantidadeHorasParaDecimal('04:30'), 4.5);
    assert.equal(quantidadeHorasParaDecimal(4), 4);
    assert.equal(quantidadeHorasParaDecimal('4'), 4);
  });

  it('vazio/inválido → "" (contrato continua obrigatório via validação própria)', () => {
    assert.equal(quantidadeHorasParaDecimal(''), '');
    assert.equal(quantidadeHorasParaDecimal(null), '');
    assert.equal(quantidadeHorasParaDecimal(0), '');
    assert.equal(quantidadeHorasParaDecimal('12:75'), '');
  });
});

/* ===========================================================
   Suite: formulário (index.html)
   =========================================================== */
describe('index.html · input do lead', () => {
  it('campo é text com placeholder 00:00 e máscara de 5 caracteres', () => {
    const campo = indexHtml.match(/<input[^>]*name="quantidadeHoras"[^>]*>/);
    assert.ok(campo, 'input quantidadeHoras ausente');
    assert.ok(campo[0].includes('type="text"'), 'input não é type="text"');
    assert.ok(campo[0].includes('placeholder="00:00"'), 'placeholder HH:mm ausente');
    assert.ok(campo[0].includes('maxlength="5"'), 'maxlength 5 ausente');
    assert.ok(!campo[0].includes('type="number"'), 'type="number" ainda presente');
  });

  it('mantém o slot de erro data-error="quantidadeHoras"', () => {
    assert.ok(indexHtml.includes('data-error="quantidadeHoras"'), 'span de erro ausente');
  });
});

/* ===========================================================
   Suite: saveLead (app.js)
   =========================================================== */
describe('saveLead · validação e payload HH:mm', () => {
  const corpo = extractFn(appJs, 'async function saveLead()');
  assert.ok(corpo, 'saveLead ausente em app.js');

  it('valida o campo antes de enviar e normaliza para HH:mm', () => {
    assert.ok(corpo.includes('validarQuantidadeHoras(fields.quantidadeHoras)'),
      'saveLead sem validação do formato');
    assert.ok(corpo.includes('formatarQuantidadeHoras(fields.quantidadeHoras)'),
      'saveLead sem normalização para HH:mm');
    assert.ok(!corpo.includes('parseInt(fields.quantidadeHoras'),
      'coercão legada para inteiro ainda presente');
  });

  it('insert e update enviam string HH:mm (ou null quando vazio)', () => {
    const usos = corpo.match(/quantidade_horas: fields\.quantidadeHoras \|\| null/g) || [];
    assert.equal(usos.length, 2, `esperados 2 payloads com "|| null", encontrados ${usos.length}`);
  });

  it('a máscara é registrada no boot do modal', () => {
    assert.ok(appJs.includes('function bindQtdHorasMask('), 'bindQtdHorasMask ausente');
    assert.ok(appJs.includes('bindQtdHorasMask();'), 'bindQtdHorasMask não é chamado no boot');
  });

  it('abrir o modal normaliza valor legado do lead/cliente', () => {
    assert.ok(appJs.includes('formatarQuantidadeHoras(lead.quantidadeHoras)'),
      'openLeadModal sem normalização de dado legado');
    assert.ok(appJs.includes('formatarQuantidadeHoras(fullLead ? fullLead.quantidadeHoras : client.quantidadeHoras)'),
      'openClientInLeadModal sem normalização de dado legado');
  });

  it('prefill do contrato converte HH:mm em horas decimais', () => {
    assert.ok(appJs.includes('quantidadeHorasParaDecimal(lead.quantidade_horas)'),
      'fillContratoFromLead enviaria "02:25" para o input numérico do contrato');
  });
});

/* ===========================================================
   Suite: supabaseClient (leitura/escrita)
   =========================================================== */
describe('supabaseClient · mapeamento e coerção', () => {
  it('imports o helper compartilhado', () => {
    assert.ok(clientJs.includes(`from './src/lib/lead/horas.js'`),
      'supabaseClient.js sem import do helper de horas');
  });

  it('listagem de leads e clientes formata na leitura', () => {
    const usos = clientJs.match(/quantidadeHoras: formatarQuantidadeHoras\(row\.quantidade_horas\)/g) || [];
    assert.equal(usos.length, 2, `esperados 2 mapeamentos, encontrados ${usos.length}`);
  });

  it('insert envia HH:mm normalizado', () => {
    assert.ok(clientJs.includes('quantidade_horas: formatarQuantidadeHoras(quantidade_horas) || null'));
  });

  it('update não faz mais parseInt (quebraria "02:25")', () => {
    const corpo = extractFn(clientJs, 'async function updateLeadSupabase(');
    assert.ok(corpo, 'updateLeadSupabase ausente');
    assert.ok(corpo.includes('formatarQuantidadeHoras(payload.quantidade_horas) || null'),
      'update sem normalização HH:mm');
    assert.ok(!corpo.includes('parseInt(payload.quantidade_horas'),
      'parseInt legado ainda presente no update');
  });
});

/* ===========================================================
   Suite: migração do schema
   =========================================================== */
describe('migração leads.quantidade_horas → TEXT', () => {
  it('arquivo de migração existe', () => {
    assert.ok(existsSync(migrationPath), 'migration 20261020090000_leads_quantidade_horas_text.sql ausente');
  });

  it('converte a coluna para TEXT preservando dados legados', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    assert.ok(sql.includes('quantidade_horas TYPE TEXT'), 'ALTER TYPE TEXT ausente');
    assert.ok(sql.includes('WHEN quantidade_horas::numeric = 0 THEN NULL'),
      '0 legado (campo nunca preenchido) não vira NULL');
    assert.ok(sql.includes(`lpad(floor(round(quantidade_horas::numeric * 60) / 60)::text, 2, '0')`),
      'conversão de horas decimais para HH:mm ausente');
    assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS quantidade_horas TEXT'),
      'coluna ausente não é criada');
  });
});
