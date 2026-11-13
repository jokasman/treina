// Utilitários puros (sem DOM), partilhados pela app e pelos testes.

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const pad = (n) => String(n).padStart(2, '0');

/** Data local em formato AAAA-MM-DD. */
export function hojeIso(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isoParaData(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function somarDias(iso, n) {
  const d = isoParaData(iso);
  d.setDate(d.getDate() + n);
  return hojeIso(d);
}

/** Número de dias entre duas datas ISO (b - a). */
export function diasEntre(a, b) {
  return Math.round((isoParaData(b) - isoParaData(a)) / 86400000);
}

/** Normaliza texto para comparar nomes: minúsculas, sem acentos, espaços simples. */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Lê um número de um valor (aceita "62,5", "60 kg"). Devolve null se não houver número. */
export function lerNumero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** Lê uma duração em segundos: 90, "90 s", "2 min", "1:30", "1 min 30 s", "1 h". */
export function lerTempo(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  if (typeof v !== 'string') return null;
  const s = norm(v).replace(',', '.');
  const mmss = s.match(/^(\d+):(\d{1,2})$/);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  let total = 0;
  let achou = false;
  const re = /(\d+(?:\.\d+)?)\s*(h|hora|horas|min|mins|minuto|minutos|m|s|seg|segundo|segundos)?\b/g;
  let m;
  while ((m = re.exec(s))) {
    achou = true;
    const n = Number(m[1]);
    const u = m[2] || 's';
    if (u.startsWith('h')) total += n * 3600;
    else if (u.startsWith('m')) total += n * 60;
    else total += n;
  }
  return achou ? Math.round(total) : null;
}

export function fmtNum(n, casas = 2) {
  if (n == null || !Number.isFinite(n)) return '';
  return Number(n.toFixed(casas)).toString().replace('.', ',');
}

export function fmtCarga(kg) {
  return kg == null ? 'peso corporal' : `${fmtNum(kg)} kg`;
}

export function fmtTempo(seg) {
  if (seg == null) return '';
  if (seg < 60) return `${seg} s`;
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm ? `${h} h ${mm} min` : `${h} h`;
  }
  return s ? `${m} min ${s} s` : `${m} min`;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function fmtData(iso, { ano = false, semana = false } = {}) {
  if (!iso) return '';
  const d = isoParaData(iso);
  let t = `${d.getDate()} ${MESES[d.getMonth()]}`;
  if (ano) t += ` ${d.getFullYear()}`;
  if (semana) t = `${DIAS_SEMANA[d.getDay()]}, ${t}`;
  return t;
}

export function letra(i) {
  return String.fromCharCode(65 + (i % 26));
}

/** Clona dados JSON. */
export function clonar(x) {
  return x == null ? x : JSON.parse(JSON.stringify(x));
}
