const DB_NAME = "screenova";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ["kv", "meta", "progress"]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function idbGet(name, key) {
  const db = await openDb();
  return requestToPromise(db.transaction(name, "readonly").objectStore(name).get(key));
}

export async function idbSet(name, key, value) {
  const db = await openDb();
  return requestToPromise(db.transaction(name, "readwrite").objectStore(name).put(value, key));
}

export async function idbDel(name, key) {
  const db = await openDb();
  return requestToPromise(db.transaction(name, "readwrite").objectStore(name).delete(key));
}

export async function idbAll(name) {
  const db = await openDb();
  return requestToPromise(db.transaction(name, "readonly").objectStore(name).getAll());
}

export async function idbClear(name) {
  const db = await openDb();
  return requestToPromise(db.transaction(name, "readwrite").objectStore(name).clear());
}
