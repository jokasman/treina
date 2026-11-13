// Login Google e sincronização com a pasta privada da app no Google Drive (appDataFolder).
import { GOOGLE_CLIENT_ID, DRIVE_SCOPE, DRIVE_FICHEIRO } from './config.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const PREF = 'treina.drive';

let token = null; // { valor, expira }
let clienteToken = null;
let gisPromessa = null;

function carregarGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromessa) return gisPromessa;
  gisPromessa = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisPromessa = null; reject(new Error('Não foi possível carregar o login Google. Verifica a ligação à internet.')); };
    document.head.appendChild(s);
  });
  return gisPromessa;
}

/** Carrega antecipadamente o script de login, para o pedido de acesso abrir logo ao toque. */
export function preparar() {
  carregarGis().catch(() => {});
}

function prefs() {
  try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch { return {}; }
}

function gravarPrefs(p) {
  try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* opcional */ }
}

/** true se o utilizador já ligou o Drive neste dispositivo. */
export function ligado() {
  return !!prefs().ligado;
}

export function ultimaSincronizacao() {
  return prefs().ultima || null;
}

export function temToken() {
  return !!token && token.expira > Date.now() + 60000;
}

/** Pede um token de acesso. Tem de ser chamado a partir de um toque do utilizador na primeira vez. */
export async function entrar({ silencioso = false } = {}) {
  await carregarGis();
  return new Promise((resolve, reject) => {
    clienteToken = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (r) => {
        if (r.error) { reject(new Error(r.error_description || r.error)); return; }
        token = { valor: r.access_token, expira: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
        gravarPrefs({ ...prefs(), ligado: true });
        resolve();
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Login cancelado.' : 'Não foi possível entrar com a conta Google.')),
    });
    clienteToken.requestAccessToken({ prompt: silencioso ? '' : (ligado() ? '' : 'consent') });
  });
}

export function sair() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token.valor, () => {});
  token = null;
  gravarPrefs({});
}

async function pedido(url, opcoes = {}) {
  if (!temToken()) throw new Error('A sessão Google expirou. Toca em "Sincronizar" para entrar outra vez.');
  const r = await fetch(url, { ...opcoes, headers: { Authorization: `Bearer ${token.valor}`, ...(opcoes.headers || {}) } });
  if (r.status === 401) { token = null; throw new Error('A sessão Google expirou. Toca em "Sincronizar" para entrar outra vez.'); }
  if (!r.ok) throw new Error(`Erro do Google Drive (${r.status}).`);
  return r;
}

async function encontrarFicheiro() {
  const q = encodeURIComponent(`name='${DRIVE_FICHEIRO}' and trashed=false`);
  const r = await pedido(`${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
  const { files } = await r.json();
  return files?.[0] || null;
}

/** Lê o estado guardado no Drive (ou null se ainda não existir). */
export async function descarregar() {
  const f = await encontrarFicheiro();
  if (!f) return { id: null, dados: null };
  const r = await pedido(`${API}/files/${f.id}?alt=media`);
  return { id: f.id, dados: await r.json() };
}

/** Grava o estado no Drive (cria o ficheiro na primeira vez). */
export async function carregar(dados, id = null) {
  const corpo = JSON.stringify(dados);
  if (id) {
    await pedido(`${UPLOAD}/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: corpo });
  } else {
    const fronteira = 'treina' + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: DRIVE_FICHEIRO, parents: ['appDataFolder'], mimeType: 'application/json' });
    const multipart = `--${fronteira}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${fronteira}\r\nContent-Type: application/json\r\n\r\n${corpo}\r\n--${fronteira}--`;
    await pedido(`${UPLOAD}/files?uploadType=multipart`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${fronteira}` }, body: multipart });
  }
  gravarPrefs({ ...prefs(), ultima: Date.now() });
}
