// Armazenamento local (IndexedDB): um único registo com o estado da app.
const NOME = 'treina';
const LOJA = 'estado';
const CHAVE = 'principal';

let ligacao = null;

function abrir() {
  if (ligacao) return ligacao;
  ligacao = new Promise((resolve, reject) => {
    const pedido = indexedDB.open(NOME, 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore(LOJA);
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
  return ligacao;
}

function transacao(modo, fn) {
  return abrir().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(LOJA, modo);
    const r = fn(tx.objectStore(LOJA));
    tx.oncomplete = () => resolve(r?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export function lerEstado() {
  return transacao('readonly', (loja) => loja.get(CHAVE));
}

export function gravarEstado(estado) {
  return transacao('readwrite', (loja) => loja.put(estado, CHAVE));
}

export function apagarTudo() {
  return transacao('readwrite', (loja) => loja.clear());
}

/** Pede ao browser para não apagar os dados quando faltar espaço. */
export async function pedirPersistencia() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* opcional */ }
}
