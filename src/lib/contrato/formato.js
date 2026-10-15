/* ============================================
   FORMATADORES PUROS DO CONTRATO
   Fonte única usada por app.js e pelos
   builders de template (ex.: bluepro.js).
   Sem DOM, sem banco — testável em Node.
   ============================================ */

export function fmtDateBR(dateStr) {
  if (!dateStr) return '';
  try {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  } catch { return dateStr; }
}

export function fmtTimeBR(timeStr) {
  if (!timeStr) return '';
  return timeStr.substring(0, 5);
}

export function fmtCurrency(val) {
  if (val === null || val === undefined || val === '') return 'R$ 0,00';
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function numeroExtenso(valor) {
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
