import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/* ===========================================================
   Testes unitários: Geração de números de contrato
   ===========================================================
   Estes testes validam a lógica de geração de números
   sem dependência do banco de dados.
   =========================================================== */

/* ---- Replicar a função gerarNumeroContrato do frontend ----- */
function gerarNumeroContrato(seq) {
  return 'CT-' + String(seq).padStart(6, '0');
}

/* ---- Replicar a lógica de cálculo do próximo número ----- */
function calcularProximoNumero(contratosExistentes) {
  const maxNum = contratosExistentes.reduce((max, c) => {
    const match = c.numero_contrato?.match(/^CT-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      return num > max ? num : max;
    }
    return max;
  }, 0);
  return gerarNumeroContrato(maxNum + 1);
}

/* ===========================================================
   Suite: gerarNumeroContrato()
   =========================================================== */
describe('gerarNumeroContrato()', () => {
  it('deve gerar CT-000001 para sequence 1', () => {
    assert.equal(gerarNumeroContrato(1), 'CT-000001');
  });

  it('deve gerar CT-000005 para sequence 5', () => {
    assert.equal(gerarNumeroContrato(5), 'CT-000005');
  });

  it('deve manter 6 dígitos com zeros à esquerda', () => {
    assert.equal(gerarNumeroContrato(1), 'CT-000001');
    assert.equal(gerarNumeroContrato(42), 'CT-000042');
    assert.equal(gerarNumeroContrato(999), 'CT-000999');
    assert.equal(gerarNumeroContrato(100000), 'CT-100000');
  });

  it('deve sempre usar o prefixo CT-', () => {
    for (let i = 1; i <= 10; i++) {
      assert.ok(gerarNumeroContrato(i).startsWith('CT-'));
    }
  });

  it('deve gerar exatamente 9 caracteres (CT- + 6 dígitos)', () => {
    assert.equal(gerarNumeroContrato(1).length, 9);
    assert.equal(gerarNumeroContrato(123456).length, 9);
  });
});

/* ===========================================================
   Suite: calcularProximoNumero() — lógica de MAX + 1
   =========================================================== */
describe('calcularProximoNumero()', () => {
  it('deve gerar CT-000001 quando não há contratos', () => {
    assert.equal(calcularProximoNumero([]), 'CT-000001');
  });

  it('deve gerar CT-000001 quando banco está vazio', () => {
    const result = calcularProximoNumero([]);
    assert.equal(result, 'CT-000001');
  });

  it('deve gerar CT-000002 quando existe apenas CT-000001', () => {
    const existentes = [{ numero_contrato: 'CT-000001' }];
    assert.equal(calcularProximoNumero(existentes), 'CT-000002');
  });

  it('deve gerar CT-000005 quando existem CT-000002, CT-000003 e CT-000004', () => {
    const existentes = [
      { numero_contrato: 'CT-000002' },
      { numero_contrato: 'CT-000003' },
      { numero_contrato: 'CT-000004' },
    ];
    assert.equal(calcularProximoNumero(existentes), 'CT-000005');
  });

  it('NÃO deve usar COUNT(*) — deve ignorar gaps na numeração', () => {
    // Cenário: CT-000001 foi deletado, sobram CT-000002 e CT-000004
    // COUNT daria 2 → próximo seria 3 (CT-000003) — ERRADO
    // MAX daria 4 → próximo deve ser 5 (CT-000005) — CORRETO
    const existentes = [
      { numero_contrato: 'CT-000002' },
      { numero_contrato: 'CT-000004' },
    ];
    assert.equal(calcularProximoNumero(existentes), 'CT-000005');
  });

  it('deve funcionar com números grandes', () => {
    const existentes = [
      { numero_contrato: 'CT-000999' },
      { numero_contrato: 'CT-001000' },
    ];
    assert.equal(calcularProximoNumero(existentes), 'CT-001001');
  });

  it('deve ignorar registros com numero_contrato NULL ou formato inválido', () => {
    const existentes = [
      { numero_contrato: null },
      { numero_contrato: '' },
      { numero_contrato: 'INVALID' },
      { numero_contrato: 'CT-000003' },
    ];
    assert.equal(calcularProximoNumero(existentes), 'CT-000004');
  });
});

/* ===========================================================
   Suite: Cenário real — dados do banco atual
   =========================================================== */
describe('Cenário real: banco com CT-000002, CT-000003, CT-000004', () => {
  const dadosReais = [
    { numero_contrato: 'CT-000002' },
    { numero_contrato: 'CT-000003' },
    { numero_contrato: 'CT-000004' },
  ];

  it('próximo contrato deve ser CT-000005', () => {
    assert.equal(calcularProximoNumero(dadosReais), 'CT-000005');
  });

  it('NÃO deve gerar CT-000004 (duplicata)', () => {
    assert.notEqual(calcularProximoNumero(dadosReais), 'CT-000004');
  });

  it('NÃO deve gerar CT-000003 (duplicata)', () => {
    assert.notEqual(calcularProximoNumero(dadosReais), 'CT-000003');
  });

  it('NÃO deve gerar CT-000002 (duplicata)', () => {
    assert.notEqual(calcularProximoNumero(dadosReais), 'CT-000002');
  });

  it('número gerado deve ter 6 dígitos com zeros à esquerda', () => {
    const proximo = calcularProximoNumero(dadosReais);
    assert.equal(proximo.length, 9);
    assert.ok(proximo.startsWith('CT-'));
    assert.equal(proximo, 'CT-000005');
  });
});

/* ===========================================================
   Suite: Validação de formato
   =========================================================== */
describe('Validação de formato do número de contrato', () => {
  it('formato CT-XXXXXX deve ser válido para qualquer número de 6 dígitos', () => {
    for (const num of [1, 42, 100, 999, 9999, 99999, 999999]) {
      const contrato = gerarNumeroContrato(num);
      assert.ok(/^CT-\d{6}$/.test(contrato), `Formato inválido: ${contrato}`);
    }
  });

  it('número não deve ser nulo ou vazio', () => {
    const contrato = gerarNumeroContrato(1);
    assert.ok(contrato);
    assert.ok(contrato.length > 0);
  });

  it('não deve conter espaços', () => {
    const contrato = gerarNumeroContrato(1);
    assert.ok(!contrato.includes(' '));
  });
});

/* ===========================================================
   Suite: Proteção contra concorrência (simulação)
   =========================================================== */
describe('Proteção contra concorrência', () => {
  it('dois cálculos sequenciais com mesmos dados iniciais devem produzir resultados diferentes', () => {
    const existentes = [
      { numero_contrato: 'CT-000002' },
      { numero_contrato: 'CT-000003' },
      { numero_contrato: 'CT-000004' },
    ];

    const primeiro = calcularProximoNumero(existentes);

    // Simula que o primeiro foi inserido
    existentes.push({ numero_contrato: primeiro });

    const segundo = calcularProximoNumero(existentes);

    assert.notEqual(primeiro, segundo);
    assert.equal(primeiro, 'CT-000005');
    assert.equal(segundo, 'CT-000006');
  });

  it('três criações simultâneas simuladas devem gerar números únicos', () => {
    const existentes = [
      { numero_contrato: 'CT-000002' },
      { numero_contrato: 'CT-000003' },
      { numero_contrato: 'CT-000004' },
    ];

    const numeros = [];
    for (let i = 0; i < 3; i++) {
      const proximo = calcularProximoNumero(existentes);
      numeros.push(proximo);
      existentes.push({ numero_contrato: proximo });
    }

    // Todos devem ser únicos
    const unicos = new Set(numeros);
    assert.equal(unicos.size, 3);

    // Devem ser CT-000005, CT-000006, CT-000007
    assert.deepEqual(numeros, ['CT-000005', 'CT-000006', 'CT-000007']);
  });
});

/* ===========================================================
   Suite: Integridade — UNIQUE constraint
   =========================================================== */
describe('Restrição UNIQUE (simulação)', () => {
  it('não deve permitir dois contratos com o mesmo número', () => {
    const contratos = [
      { numero_contrato: 'CT-000002' },
      { numero_contrato: 'CT-000003' },
      { numero_contrato: 'CT-000004' },
    ];

    const tentativa = 'CT-000004'; // número já existente
    const duplicado = contratos.some(c => c.numero_contrato === tentativa);

    assert.ok(duplicado, 'Deveria detectar o duplicado');
  });

  it('deve permitir inserir um número que não existe', () => {
    const contratos = [
      { numero_contrato: 'CT-000002' },
      { numero_contrato: 'CT-000003' },
      { numero_contrato: 'CT-000004' },
    ];

    const tentativa = 'CT-000005';
    const duplicado = contratos.some(c => c.numero_contrato === tentativa);

    assert.ok(!duplicado, 'Não deveria detectar duplicado para CT-000005');
  });
});
