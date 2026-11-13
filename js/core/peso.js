// Peso corporal: média móvel, ritmo semanal e progresso em relação à meta.
import { diasEntre, somarDias, hojeIso } from './util.js';

/** Pesos ordenados por data, com a média dos registos dos últimos 7 dias (inclusive). */
export function tendencia(pesos) {
  const ord = [...(pesos || [])].sort((a, b) => a.data.localeCompare(b.data));
  return ord.map((p) => {
    const ini = somarDias(p.data, -6);
    const janela = ord.filter((q) => q.data >= ini && q.data <= p.data);
    const media = janela.reduce((s, q) => s + q.kg, 0) / janela.length;
    return { data: p.data, kg: p.kg, media: Math.round(media * 100) / 100 };
  });
}

/** Ritmo em kg por semana (regressão linear dos registos dos últimos `dias`). null se houver poucos dados. */
export function ritmoSemanal(pesos, dias = 28, hoje = hojeIso()) {
  const ini = somarDias(hoje, -dias);
  const pts = [...(pesos || [])].filter((p) => p.data >= ini && p.data <= hoje).sort((a, b) => a.data.localeCompare(b.data));
  if (pts.length < 3) return null;
  const x0 = pts[0].data;
  const xs = pts.map((p) => diasEntre(x0, p.data));
  if (xs[xs.length - 1] - xs[0] < 7) return null;
  const ys = pts.map((p) => p.kg);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (!den) return null;
  return Math.round((num / den) * 7 * 100) / 100;
}

/**
 * Situação em relação ao peso alvo.
 * estado: 'sem-dados' | 'sem-meta' | 'atingido' | 'no-ritmo' | 'atrasado' | 'sentido-errado' | 'a-calcular'
 */
export function estadoPeso({ pesos, pesoAlvo, pesoInicial, dataAlvo, hoje = hojeIso() }) {
  const t = tendencia(pesos);
  if (!t.length) return { estado: 'sem-dados' };
  const atual = t[t.length - 1].media;
  const ritmo = ritmoSemanal(pesos, 28, hoje);
  const base = { atual, ritmo };
  if (pesoAlvo == null) return { ...base, estado: 'sem-meta' };

  const inicial = pesoInicial ?? t[0].media;
  const descer = pesoAlvo < inicial;
  const falta = Math.round((pesoAlvo - atual) * 100) / 100;
  if ((descer && atual <= pesoAlvo) || (!descer && atual >= pesoAlvo)) return { ...base, falta: 0, estado: 'atingido' };

  let ritmoNecessario = null;
  if (dataAlvo && dataAlvo > hoje) {
    const semanas = diasEntre(hoje, dataAlvo) / 7;
    ritmoNecessario = Math.round((falta / semanas) * 100) / 100;
  }
  if (ritmo == null) return { ...base, falta, ritmoNecessario, estado: 'a-calcular' };

  const certo = descer ? ritmo < 0 : ritmo > 0;
  if (!certo || Math.abs(ritmo) < 0.01) return { ...base, falta, ritmoNecessario, previsao: null, estado: 'sentido-errado' };

  const previsao = somarDias(hoje, Math.ceil((falta / ritmo) * 7));
  const atrasado = dataAlvo ? previsao > dataAlvo : false;
  return { ...base, falta, ritmoNecessario, previsao, estado: atrasado ? 'atrasado' : 'no-ritmo' };
}
