const REPORT_DB_NAME = "TabScreenshotReport";
const REPORT_DB_VERSION = 1;
const REPORT_STORE = "reports";
const REPORT_IDB_KEY = "latest";
const LEGACY_STORAGE_KEY = "tabReport";

function openReportDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(REPORT_DB_NAME, REPORT_DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(REPORT_STORE)) {
        db.createObjectStore(REPORT_STORE);
      }
    };
  });
}

function idbPut(db, report) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REPORT_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(REPORT_STORE).put(report, REPORT_IDB_KEY);
  });
}

function idbGet(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REPORT_STORE, "readonly");
    const request = tx.objectStore(REPORT_STORE).get(REPORT_IDB_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function clearLegacyChromeReport() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  try {
    await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function loadLegacyChromeReport() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return null;
  try {
    const stored = await chrome.storage.local.get(LEGACY_STORAGE_KEY);
    return stored[LEGACY_STORAGE_KEY] ?? null;
  } catch {
    return null;
  }
}

/** @param {object} report */
async function saveTabReport(report) {
  const db = await openReportDb();
  try {
    await idbPut(db, report);
  } finally {
    db.close();
  }
  await clearLegacyChromeReport();
}

async function loadTabReport() {
  const db = await openReportDb();
  let report = null;
  try {
    report = await idbGet(db);
  } finally {
    db.close();
  }

  if (report) {
    await clearLegacyChromeReport();
    return report;
  }

  const legacy = await loadLegacyChromeReport();
  if (!legacy) return null;

  try {
    await saveTabReport(legacy);
  } catch {
    return legacy;
  }
  return legacy;
}
