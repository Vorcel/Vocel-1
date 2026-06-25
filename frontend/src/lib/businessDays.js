// Cálculo de datas por "dias corridos" ou "dias úteis" (feriados nacionais BR).
// Datas tratadas como datas de calendário (sem horário) usando data LOCAL, para
// evitar erro de ±1 dia por causa de UTC (timezone America/Sao_Paulo).

const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s) => {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1); // meia-noite local
};
const shift = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); return d; };

// Domingo de Páscoa (algoritmo de Meeus/Gauss) — base dos feriados móveis.
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// Feriados nacionais (fixos + móveis) de um ano, como Set de ISO "YYYY-MM-DD".
const _cache = {};
export function holidaysOf(year) {
  if (_cache[year]) return _cache[year];
  const fixed = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];
  const set = new Set(fixed.map((md) => `${year}-${md}`));
  const e = easter(year);
  set.add(toISO(shift(e, -48))); // Segunda de Carnaval
  set.add(toISO(shift(e, -47))); // Terça de Carnaval
  set.add(toISO(shift(e, -2)));  // Sexta-feira Santa
  set.add(toISO(shift(e, 60)));  // Corpus Christi
  _cache[year] = set;
  return set;
}

// Feriados extras manuais (expansão futura: estaduais/municipais).
const extraHolidays = new Set();
export function addExtraHoliday(iso) { if (iso) extraHolidays.add(iso.slice(0, 10)); }

export function isHoliday(date) {
  const iso = toISO(date);
  return holidaysOf(date.getFullYear()).has(iso) || extraHolidays.has(iso);
}
export function isBusinessDay(date) {
  const wd = date.getDay();
  return wd !== 0 && wd !== 6 && !isHoliday(date); // ignora sábado, domingo e feriados
}

// Dias corridos: soma direta à data base.
export function addCalendarDays(baseISO, n) {
  const base = fromISO(baseISO);
  if (!base) return "";
  return toISO(shift(base, Number(n || 0)));
}

// Dias úteis: avança no calendário contando apenas dias úteis.
export function addBusinessDays(baseISO, n) {
  const base = fromISO(baseISO);
  if (!base) return "";
  const target = Math.max(0, Number(n || 0));
  let count = 0, cur = new Date(base);
  while (count < target) {
    cur = shift(cur, 1);
    if (isBusinessDay(cur)) count++;
  }
  return toISO(cur);
}

// Entrada única usada pelo modal de Prazo de Entrega.
export function addDaysByType(baseISO, n, tipo) {
  return tipo === "uteis" ? addBusinessDays(baseISO, n) : addCalendarDays(baseISO, n);
}
