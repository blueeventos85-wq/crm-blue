/* ============================================
   LEAD · QUANTIDADE DE HORAS (HH:mm)
   Fonte única usada por app.js e supabaseClient.js.
   Sem DOM, sem banco — testável em Node.

   - formato aceito: "HH:mm" (horas 00-99, minutos 00-59)
   - compatibilidade: valores legados numéricos (2 → "02:00",
     2.5 → "02:30") e strings coladas sem ":" ("0225" → "02:25")
   - máscara de digitação com auto-insersão do ":"
   ============================================ */

const pad2 = n => String(n).padStart(2, '0');

/* Horas decimais (2.5) → "HH:mm" ("02:30"). 0/vazio/negativo → ''. */
function deHorasDecimais(horas) {
  const totalMin = Math.round(Number(horas) * 60);
  if (!Number.isFinite(totalMin) || totalMin <= 0) return '';
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  if (hh > 99) return '';
  return `${pad2(hh)}:${pad2(mm)}`;
}

/* Normaliza qualquer valor para exibição/gravação: "HH:mm" ou ''.
   Retorna '' para vazio e para formatos irreconhecíveis/inválidos. */
export function formatarQuantidadeHoras(valor) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number') return deHorasDecimais(valor);

  const bruto = String(valor).trim();
  if (!bruto) return '';

  // Legado numérico com decimal: "2.5" / "2,5" → horas
  if (/^\d+[.,]\d+$/.test(bruto)) return deHorasDecimais(parseFloat(bruto.replace(',', '.')));

  // Só dígitos: até 2 = horas legadas ("2" → "02:00");
  // 3-4 = colado sem ":" no padrão HHmm ("0225" → "02:25")
  if (/^\d+$/.test(bruto)) {
    if (bruto.length <= 2) return deHorasDecimais(parseInt(bruto, 10));
    const hh = parseInt(bruto.slice(0, 2), 10);
    const mm = parseInt(bruto.slice(2, 4), 10);
    if (mm > 59) return '';
    return `${pad2(hh)}:${pad2(mm)}`;
  }

  const m = bruto.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (!m) return '';
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (hh > 99 || mm > 59) return '';
  return `${pad2(hh)}:${pad2(mm)}`;
}

/* Validação do formulário: vazio é permitido (campo opcional);
   preenchido precisa resultar em "HH:mm" válido. */
export function validarQuantidadeHoras(valor) {
  if (valor === null || valor === undefined) return true;
  const bruto = String(valor).trim();
  if (!bruto) return true;

  // Só dígitos: até 2 = horas livres ("2", "00" → gravado vazio);
  // 3-4 = HHmm colado, precisa ter minutos válidos
  if (/^\d+$/.test(bruto)) {
    if (bruto.length <= 2) return true;
    return parseInt(bruto.slice(2, 4), 10) <= 59;
  }

  return formatarQuantidadeHoras(bruto) !== '';
}

/* Máscara de digitação: mantém só dígitos (máx. 4) e insere o ":".
   "2" → "2", "250" → "25:0", "02:25" → "02:25", "0225" → "02:25". */
export function mascararQuantidadeHoras(valor) {
  const s = String(valor === null || valor === undefined ? '' : valor);
  const sep = s.indexOf(':');

  if (sep === -1) {
    const digitos = s.replace(/\D/g, '').slice(0, 4);
    if (digitos.length <= 2) return digitos;
    return `${digitos.slice(0, 2)}:${digitos.slice(2)}`;
  }

  const esq = s.slice(0, sep).replace(/\D/g, '').slice(0, 2);
  const dir = s.slice(sep + 1).replace(/\D/g, '').slice(0, 2);
  if (!esq) return dir;
  return dir ? `${esq}:${dir}` : `${esq}:`;
}

/* "HH:mm" → horas decimais p/ o campo numérico do contrato ("02:25" → 2.42).
   Vazio/inválido → ''. */
export function quantidadeHorasParaDecimal(valor) {
  const fmt = formatarQuantidadeHoras(valor);
  if (!fmt) return '';
  const [hh, mm] = fmt.split(':').map(Number);
  return Math.round((hh + mm / 60) * 100) / 100;
}
