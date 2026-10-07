import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ===========================================================
   Testes: validação do campo "Número (telefone)" do lead
   ===========================================================
   A função é extraída do próprio app.js para garantir que os
   testes cubram exatamente o código executado em produção.
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSource = readFileSync(join(root, 'app.js'), 'utf8');
const htmlSource = readFileSync(join(root, 'index.html'), 'utf8');

const fnMatch = appSource.match(/function validarTelefone\(v\) \{[^}]*\}/);
assert.ok(fnMatch, 'função validarTelefone não encontrada em app.js');
const validarTelefone = new Function(`${fnMatch[0]}; return validarTelefone;`)();

describe('validarTelefone() — formatos aceitos', () => {
  const aceitos = [
    ['8594358894', '10 dígitos (DDD + 8)'],
    ['85994358894', '11 dígitos (DDD + 9)'],
    ['558594358894', '12 dígitos (55 + DDD + 8)'],
    ['5585994358894', '13 dígitos (55 + DDD + 9)'],
    ['(85) 9435-8894', 'formatado sem DDI'],
    ['(85) 99435-8894', 'formatado sem DDI (celular)'],
    ['+55 85 9435-8894', 'colado com +55, espaços e hífen'],
    ['55 85 99435-8894', 'colado com 55 e espaços'],
    ['55-85-99435-8894', 'colado com 55 e hífens'],
    ['5599999999', 'DDD 55 sem DDI (10 dígitos)'],
    ['55999999999', 'DDD 55 sem DDI (11 dígitos)']
  ];

  for (const [valor, desc] of aceitos) {
    it(`deve aceitar ${valor} (${desc})`, () => {
      assert.equal(validarTelefone(valor), true);
    });
  }
});

describe('validarTelefone() — formatos rejeitados', () => {
  const rejeitados = [
    ['', 'vazio'],
    ['abcdefgh', 'sem dígitos'],
    ['55', 'apenas o DDI'],
    ['859435889', '9 dígitos (curto demais)'],
    ['85943588941234', '14 dígitos (longo demais)'],
    ['351199876543', '12 dígitos sem DDI 55'],
    ['3511998765432', '13 dígitos sem DDI 55'],
    ['55859435889455', '14 dígitos mesmo começando com 55']
  ];

  for (const [valor, desc] of rejeitados) {
    it(`deve rejeitar ${valor || '(vazio)'} (${desc})`, () => {
      assert.equal(validarTelefone(valor), false);
    });
  }
});

describe('normalização ao salvar (apenas dígitos)', () => {
  const normalizar = (v) => String(v || '').replace(/\D/g, '');

  it('saveLead deve manter apenas os dígitos do telefone', () => {
    assert.ok(
      appSource.includes("if (fields.telefone) fields.telefone = fields.telefone.replace(/\\D/g, '');"),
      'saveLead deve normalizar fields.telefone para apenas dígitos'
    );
  });

  const casos = [
    ['+55 85 99435-8894', '5585994358894'],
    ['(85) 9435-8894', '8594358894'],
    ['55 (85) 99435-8894', '5585994358894'],
    ['558594358894', '558594358894']
  ];

  for (const [digitado, esperado] of casos) {
    it(`deve salvar ${digitado} como ${esperado} e passar na validação`, () => {
      const salvo = normalizar(digitado);
      assert.equal(salvo, esperado);
      assert.equal(validarTelefone(salvo), true);
    });
  }
});

describe('campo de telefone do modal', () => {
  it('não deve ter maxlength que corte o número com DDI', () => {
    const input = (htmlSource.match(/<input[^>]*name="telefone"[^>]*>/) || [])[0];
    assert.ok(input, 'input name="telefone" não encontrado em index.html');
    assert.ok(!/maxlength/i.test(input), 'input de telefone não deve ter maxlength');
  });

  it('deve limpar caracteres não numéricos enquanto o usuário digita/cola', () => {
    assert.ok(
      appSource.includes("leadTelInput.addEventListener('input'"),
      'listener de limpeza do telefone deve estar registrado em initCRM'
    );
  });

  it('envio de WhatsApp não deve duplicar o DDI 55', () => {
    assert.ok(
      appSource.includes("(phone.length === 12 || phone.length === 13) && phone.startsWith('55') ? phone :"),
      '_convCreateChat deve evitar prefixar 55 em números que já têm DDI'
    );
  });
});
