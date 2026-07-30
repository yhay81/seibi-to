const databaseName = "seibi-to";
const databaseVersion = 1;
const sessionKey = "seibi-to-session";
const firstDayKey = "seibi-to-first-day";
const activeVehicleKey = "seibi-to-active-vehicle";
const maximumVehicles = 3;
const maximumRecords = 300;
const maximumReminders = 50;
const maximumPhotoBytes = 220_000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const qa = new URLSearchParams(location.search).get("qa") === "1" || navigator.webdriver === true;
const kindLabels = {
  care: "洗車・ケア",
  engine: "エンジン・油脂",
  inspection: "点検・車検",
  other: "その他",
  part: "部品・用品",
  repair: "修理",
  tire: "タイヤ・足まわり",
};

let database;
let vehicles = [];
let records = [];
let reminders = [];
let activeVehicleId = "";
let historyKind = "all";
let historySearch = "";
const photoUrls = new Map();

const dayInJst = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const todayLocal = () => new Date().toLocaleDateString("sv-SE");
const cleanText = (value, maximum) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .slice(0, maximum);
const cleanNumber = (value, maximum) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(Math.round(number), maximum) : 0;
};
const currency = (value) =>
  new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(value);
const dateLabel = (value) =>
  new Intl.DateTimeFormat("ja-JP", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(`${value}T00:00:00`),
  );

const getSession = () => {
  let session = localStorage.getItem(sessionKey);
  if (!session) {
    session = crypto.randomUUID();
    localStorage.setItem(sessionKey, session);
  }
  return session;
};

const sendEvent = async (name) => {
  try {
    await fetch("/api/events", {
      body: JSON.stringify({ name }),
      headers: {
        "content-type": "application/json",
        "x-seibi-qa": qa ? "1" : "0",
        "x-seibi-session": getSession(),
      },
      method: "POST",
    });
  } catch {
    // Local vehicle work continues when anonymous metrics are unavailable.
  }
};

const sendEventOnce = (name) => {
  const marker = `seibi-to-event-${name}-${dayInJst()}`;
  if (sessionStorage.getItem(marker)) return;
  sessionStorage.setItem(marker, "1");
  void sendEvent(name);
};

const openDatabase = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.addEventListener("upgradeneeded", () => {
      const current = request.result;
      if (!current.objectStoreNames.contains("vehicles")) {
        current.createObjectStore("vehicles", { keyPath: "id" });
      }
      if (!current.objectStoreNames.contains("records")) {
        const store = current.createObjectStore("records", { keyPath: "id" });
        store.createIndex("vehicleId", "vehicleId");
      }
      if (!current.objectStoreNames.contains("reminders")) {
        const store = current.createObjectStore("reminders", { keyPath: "id" });
        store.createIndex("vehicleId", "vehicleId");
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("車庫を開けません")));
  });

const storeRequest = (storeName, mode, operation) =>
  new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let request;
    try {
      request = operation(store);
    } catch (error) {
      reject(error);
      return;
    }
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("保存できません")));
  });

const allFrom = (storeName) => storeRequest(storeName, "readonly", (store) => store.getAll());
const putInto = (storeName, value) =>
  storeRequest(storeName, "readwrite", (store) => store.put(value));
const deleteFrom = (storeName, key) =>
  storeRequest(storeName, "readwrite", (store) => store.delete(key));

const clearDatabase = () =>
  new Promise((resolve, reject) => {
    const transaction = database.transaction(["vehicles", "records", "reminders"], "readwrite");
    transaction.objectStore("vehicles").clear();
    transaction.objectStore("records").clear();
    transaction.objectStore("reminders").clear();
    transaction.addEventListener("complete", resolve);
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("車庫を空にできません")),
    );
  });

const refreshState = async () => {
  [vehicles, records, reminders] = await Promise.all([
    allFrom("vehicles"),
    allFrom("records"),
    allFrom("reminders"),
  ]);
  if (!vehicles.some((vehicle) => vehicle.id === activeVehicleId)) {
    activeVehicleId = localStorage.getItem(activeVehicleKey) ?? vehicles[0]?.id ?? "";
  }
  if (!vehicles.some((vehicle) => vehicle.id === activeVehicleId)) {
    activeVehicleId = vehicles[0]?.id ?? "";
  }
  if (activeVehicleId) localStorage.setItem(activeVehicleKey, activeVehicleId);
  render();
};

const activeVehicle = () => vehicles.find((vehicle) => vehicle.id === activeVehicleId);
const activeRecords = () => records.filter((record) => record.vehicleId === activeVehicleId);
const activeReminders = () =>
  reminders.filter((reminder) => reminder.vehicleId === activeVehicleId);
const currentOdometer = () =>
  Math.max(
    activeVehicle()?.odometer ?? 0,
    ...activeRecords().map((record) => record.odometer ?? 0),
  );

const setFormState = (selector, message, tone = "") => {
  const node = document.querySelector(selector);
  if (!(node instanceof HTMLElement)) return;
  node.textContent = message;
  node.dataset.tone = tone;
};

const revokePhotoUrl = (recordId) => {
  const url = photoUrls.get(recordId);
  if (url) URL.revokeObjectURL(url);
  photoUrls.delete(recordId);
};

const reminderStatus = (reminder) => {
  const odometer = currentOdometer();
  const dayDifference = reminder.dueOn
    ? Math.ceil((new Date(`${reminder.dueOn}T00:00:00`).getTime() - Date.now()) / 86_400_000)
    : null;
  const kilometerDifference = reminder.dueOdometer ? reminder.dueOdometer - odometer : null;
  const overdue =
    (dayDifference !== null && dayDifference < 0) ||
    (kilometerDifference !== null && kilometerDifference <= 0);
  const soon =
    (dayDifference !== null && dayDifference <= 30) ||
    (kilometerDifference !== null && kilometerDifference <= 1000);
  const score = Math.min(
    dayDifference ?? Number.POSITIVE_INFINITY,
    kilometerDifference === null ? Number.POSITIVE_INFINITY : kilometerDifference / 35,
  );
  return { dayDifference, kilometerDifference, overdue, score, soon };
};

const reminderDueLabel = (reminder, status) => {
  const parts = [];
  if (reminder.dueOn) parts.push(dateLabel(reminder.dueOn));
  if (reminder.dueOdometer) {
    const difference = status.kilometerDifference;
    parts.push(
      `${reminder.dueOdometer.toLocaleString("ja-JP")} km${
        difference === null
          ? ""
          : difference <= 0
            ? "（到達）"
            : `（あと ${difference.toLocaleString("ja-JP")} km）`
      }`,
    );
  }
  return parts.join(" / ");
};

const renderVehicleTabs = () => {
  const container = document.querySelector("[data-vehicle-tabs]");
  const template = document.querySelector("#vehicle-tab-template");
  if (!(container instanceof HTMLElement) || !(template instanceof HTMLTemplateElement)) return;
  container.replaceChildren();
  for (const vehicle of vehicles) {
    const fragment = template.content.cloneNode(true);
    const button = fragment.querySelector(".vehicle-tab");
    const name = fragment.querySelector("[data-tab-name]");
    if (!(button instanceof HTMLButtonElement)) continue;
    if (name) name.textContent = vehicle.name;
    button.classList.toggle("active", vehicle.id === activeVehicleId);
    button.setAttribute("aria-pressed", String(vehicle.id === activeVehicleId));
    button.addEventListener("click", () => {
      activeVehicleId = vehicle.id;
      localStorage.setItem(activeVehicleKey, activeVehicleId);
      render();
    });
    container.append(fragment);
  }
  const addButton = document.querySelector('[data-action="add-vehicle"]');
  if (addButton instanceof HTMLButtonElement)
    addButton.disabled = vehicles.length >= maximumVehicles;
};

const renderInstruments = () => {
  const vehicle = activeVehicle();
  if (!vehicle) return;
  const setText = (selector, value) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = value;
  };
  setText("[data-vehicle-name]", vehicle.name);
  setText(
    "[data-vehicle-spec]",
    [vehicle.make, vehicle.model, vehicle.year ? `${vehicle.year}年式` : ""]
      .filter(Boolean)
      .join(" / ") || "車種情報なし",
  );
  setText("[data-current-odometer]", currentOdometer().toLocaleString("ja-JP"));
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const yearCost = activeRecords()
    .filter((record) => new Date(`${record.performedOn}T00:00:00`) >= yearAgo)
    .reduce((total, record) => total + record.cost, 0);
  setText("[data-year-cost]", currency(yearCost));
  const categoryTotals = Object.keys(kindLabels).map((kind) =>
    activeRecords()
      .filter((record) => record.kind === kind)
      .reduce((total, record) => total + record.cost, 0),
  );
  const total = categoryTotals.reduce((sum, value) => sum + value, 0);
  const dial = document.querySelector("[data-cost-dial]");
  if (dial instanceof HTMLElement) {
    if (total === 0) {
      dial.style.background = "conic-gradient(#39463f 0 100%)";
    } else {
      const colors = ["#e6a93d", "#68a184", "#d96f45", "#7599aa", "#d1c16d", "#977d9c", "#838a80"];
      let offset = 0;
      const stops = categoryTotals
        .map((value, index) => {
          const start = offset;
          offset += (value / total) * 100;
          return `${colors[index]} ${start}% ${offset}%`;
        })
        .join(",");
      dial.style.background = `conic-gradient(${stops})`;
    }
  }
  const next = activeReminders()
    .map((reminder) => ({ reminder, status: reminderStatus(reminder) }))
    .sort((left, right) => left.status.score - right.status.score)[0];
  const warning = document.querySelector("[data-next-warning]");
  if (warning instanceof HTMLElement) {
    warning.dataset.status = next?.status.overdue
      ? "overdue"
      : next?.status.soon
        ? "soon"
        : "quiet";
  }
  setText("[data-next-title]", next?.reminder.title ?? "予定なし");
  setText(
    "[data-next-distance]",
    next ? reminderDueLabel(next.reminder, next.status) : "次回期限を登録できます",
  );
};

const renderReminders = () => {
  const container = document.querySelector("[data-reminder-list]");
  const template = document.querySelector("#reminder-template");
  const empty = document.querySelector("[data-reminder-empty]");
  if (!(container instanceof HTMLElement) || !(template instanceof HTMLTemplateElement)) return;
  container.replaceChildren();
  const items = activeReminders()
    .map((reminder) => ({ reminder, status: reminderStatus(reminder) }))
    .sort((left, right) => left.status.score - right.status.score);
  const count = document.querySelector("[data-reminder-count]");
  if (count) count.textContent = `${items.length}件`;
  if (empty instanceof HTMLElement) empty.hidden = items.length !== 0;
  for (const { reminder, status } of items) {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".reminder-card");
    if (!(card instanceof HTMLElement)) continue;
    card.dataset.status = status.overdue ? "overdue" : status.soon ? "soon" : "quiet";
    const statusNode = card.querySelector("[data-reminder-status]");
    const title = card.querySelector("[data-reminder-title]");
    const due = card.querySelector("[data-reminder-due]");
    if (statusNode)
      statusNode.textContent = status.overdue ? "期限を確認" : status.soon ? "そろそろ" : "予定";
    if (title) title.textContent = reminder.title;
    if (due) due.textContent = reminderDueLabel(reminder, status);
    card.querySelector('[data-reminder-action="record"]')?.addEventListener("click", () => {
      const dialog = document.querySelector("[data-record-dialog]");
      const form = document.querySelector("[data-record-form]");
      if (!(dialog instanceof HTMLDialogElement) || !(form instanceof HTMLFormElement)) return;
      form.reset();
      prepareRecordForm(form);
      const titleInput = form.elements.namedItem("title");
      const reminderInput = form.elements.namedItem("fromReminder");
      if (titleInput instanceof HTMLInputElement) titleInput.value = reminder.title;
      if (reminderInput instanceof HTMLInputElement) reminderInput.value = reminder.id;
      dialog.showModal();
    });
    card.querySelector('[data-reminder-action="delete"]')?.addEventListener("click", async () => {
      await deleteFrom("reminders", reminder.id);
      await refreshState();
    });
    container.append(fragment);
  }
};

const recordMatches = (record) => {
  if (historyKind !== "all" && record.kind !== historyKind) return false;
  if (!historySearch) return true;
  return [record.title, record.provider, record.note, kindLabels[record.kind]]
    .join("\n")
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .includes(historySearch);
};

const renderRecords = () => {
  const container = document.querySelector("[data-timeline]");
  const template = document.querySelector("#record-template");
  const empty = document.querySelector("[data-history-empty]");
  if (!(container instanceof HTMLElement) || !(template instanceof HTMLTemplateElement)) return;
  container.replaceChildren();
  const allRecords = activeRecords().sort(
    (left, right) =>
      right.performedOn.localeCompare(left.performedOn) || right.createdAt - left.createdAt,
  );
  const shown = allRecords.filter(recordMatches);
  const count = document.querySelector("[data-record-count]");
  if (count) count.textContent = `${allRecords.length}件`;
  if (empty instanceof HTMLElement) empty.hidden = allRecords.length !== 0;
  for (const record of shown) {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".history-card");
    if (!(card instanceof HTMLElement)) continue;
    card.dataset.kind = record.kind;
    const setText = (selector, value) => {
      const node = card.querySelector(selector);
      if (node) node.textContent = value;
    };
    setText("[data-record-kind]", kindLabels[record.kind] ?? "その他");
    setText("[data-record-date]", dateLabel(record.performedOn));
    setText("[data-record-title]", record.title);
    setText("[data-record-odometer]", `${record.odometer.toLocaleString("ja-JP")} km`);
    setText("[data-record-cost]", record.cost ? currency(record.cost) : "費用記録なし");
    setText("[data-record-provider]", record.provider ? `作業：${record.provider}` : "");
    setText("[data-record-note]", record.note);
    const photoWrap = card.querySelector("[data-record-photo-wrap]");
    const image = card.querySelector("[data-record-photo]");
    if (
      record.photo instanceof Blob &&
      photoWrap instanceof HTMLElement &&
      image instanceof HTMLImageElement
    ) {
      revokePhotoUrl(record.id);
      const url = URL.createObjectURL(record.photo);
      photoUrls.set(record.id, url);
      image.src = url;
      image.alt = `${record.title}の記録写真`;
      photoWrap.hidden = false;
    }
    card.querySelector('[data-record-action="delete"]')?.addEventListener("click", async () => {
      if (!confirm("この整備カードを削除しますか？")) return;
      revokePhotoUrl(record.id);
      await deleteFrom("records", record.id);
      await refreshState();
    });
    container.append(fragment);
  }
};

const render = () => {
  const empty = document.querySelector("[data-empty-garage]");
  const workspace = document.querySelector("[data-garage-workspace]");
  if (empty instanceof HTMLElement) empty.hidden = vehicles.length !== 0;
  if (workspace instanceof HTMLElement) workspace.hidden = vehicles.length === 0;
  if (vehicles.length === 0) return;
  renderVehicleTabs();
  renderInstruments();
  renderReminders();
  renderRecords();
};

const createVehicle = async (form) => {
  if (vehicles.length >= maximumVehicles) throw new Error("登録できる車は3台までです");
  const values = new FormData(form);
  const name = cleanText(values.get("name"), 32);
  if (!name) throw new Error("車の呼び名を入力してください");
  const vehicle = {
    createdAt: Date.now(),
    id: crypto.randomUUID(),
    make: cleanText(values.get("make"), 32),
    model: cleanText(values.get("model"), 48),
    name,
    odometer: cleanNumber(values.get("odometer"), 9_999_999),
    year: cleanNumber(values.get("year"), 2100) || null,
  };
  await putInto("vehicles", vehicle);
  activeVehicleId = vehicle.id;
  localStorage.setItem(activeVehicleKey, activeVehicleId);
  form.reset();
  void sendEvent("vehicle_created");
  await refreshState();
};

const prepareRecordForm = (form) => {
  const date = form.elements.namedItem("performedOn");
  const odometer = form.elements.namedItem("odometer");
  if (date instanceof HTMLInputElement && !date.value) date.value = todayLocal();
  if (odometer instanceof HTMLInputElement && !odometer.value) {
    odometer.value = String(currentOdometer());
  }
};

const blobFromCanvas = (canvas, quality) =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("写真を縮小できません"))),
      "image/jpeg",
      quality,
    );
  });

const compressPhoto = async (file) => {
  if (!(file instanceof File) || !file.type.startsWith("image/") || file.size > 15_000_000) {
    throw new Error("15MB以下のJPEG・PNG・WebPを選んでください");
  }
  const bitmap = await createImageBitmap(file);
  try {
    let side = 1120;
    let quality = 0.8;
    let result = null;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const ratio = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("写真を縮小できません");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      result = await blobFromCanvas(canvas, quality);
      if (result.size <= maximumPhotoBytes) break;
      side = Math.round(side * 0.8);
      quality = Math.max(0.54, quality - 0.06);
    }
    if (!result || result.size > maximumPhotoBytes) throw new Error("写真を220KB以下にできません");
    return result;
  } finally {
    bitmap.close();
  }
};

const createRecord = async (form) => {
  const vehicle = activeVehicle();
  if (!vehicle) throw new Error("車を選んでください");
  if (activeRecords().length >= maximumRecords) throw new Error("1台につき300件まで記録できます");
  const values = new FormData(form);
  const performedOn = cleanText(values.get("performedOn"), 10);
  const title = cleanText(values.get("title"), 60);
  const kind = cleanText(values.get("kind"), 20);
  if (!datePattern.test(performedOn) || !title || !(kind in kindLabels))
    throw new Error("日付・種類・項目を確認してください");
  const photoInput = form.elements.namedItem("photo");
  const file = photoInput instanceof HTMLInputElement ? photoInput.files?.[0] : null;
  let photo = null;
  if (file) {
    setFormState("[data-record-state]", "写真を端末内で縮小しています…", "working");
    photo = await compressPhoto(file);
  }
  const record = {
    cost: cleanNumber(values.get("cost"), 99_999_999),
    createdAt: Date.now(),
    id: crypto.randomUUID(),
    kind,
    note: cleanText(values.get("note"), 500),
    odometer: cleanNumber(values.get("odometer"), 9_999_999),
    performedOn,
    photo,
    provider: cleanText(values.get("provider"), 48),
    title,
    vehicleId: vehicle.id,
  };
  await putInto("records", record);
  const fromReminder = cleanText(values.get("fromReminder"), 36);
  if (fromReminder) await deleteFrom("reminders", fromReminder);
  if (record.odometer > vehicle.odometer) {
    await putInto("vehicles", { ...vehicle, odometer: record.odometer });
  }
  form.reset();
  void sendEvent("record_added");
  await refreshState();
};

const createReminder = async (form) => {
  const vehicle = activeVehicle();
  if (!vehicle) throw new Error("車を選んでください");
  if (activeReminders().length >= maximumReminders)
    throw new Error("1台につき50件まで登録できます");
  const values = new FormData(form);
  const title = cleanText(values.get("title"), 60);
  const dueOn = cleanText(values.get("dueOn"), 10);
  const dueOdometer = cleanNumber(values.get("dueOdometer"), 9_999_999) || null;
  if (!title || (dueOn && !datePattern.test(dueOn)) || (!dueOn && !dueOdometer))
    throw new Error("項目と、日付または距離を入力してください");
  await putInto("reminders", {
    createdAt: Date.now(),
    dueOdometer,
    dueOn: dueOn || null,
    id: crypto.randomUUID(),
    title,
    vehicleId: vehicle.id,
  });
  form.reset();
  void sendEvent("reminder_added");
  await refreshState();
};

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("写真を読めません")));
    reader.readAsDataURL(blob);
  });

const dataUrlToBlob = async (value) => {
  if (typeof value !== "string" || !value.startsWith("data:image/jpeg;base64,")) return null;
  const encoded = value.slice(value.indexOf(",") + 1);
  const decoded = atob(encoded);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  const blob = new Blob([bytes], { type: "image/jpeg" });
  return blob.size <= maximumPhotoBytes ? blob : null;
};

const downloadBlob = (blob, name) => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
};

const exportProject = async () => {
  const recordCopies = [];
  for (const record of records) {
    recordCopies.push({
      ...record,
      photo: record.photo instanceof Blob ? await blobToDataUrl(record.photo) : null,
    });
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    product: "seibi-to",
    records: recordCopies,
    reminders,
    vehicles,
    version: 1,
  };
  downloadBlob(
    new Blob([JSON.stringify(payload)], { type: "application/json" }),
    `seibi-to-${todayLocal()}.seibito`,
  );
  void sendEvent("project_exported");
};

const safeCsvCell = (value) => {
  let text = String(value ?? "")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
  if (/^[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

const exportCsv = async () => {
  const rows = [
    [
      "車",
      "メーカー",
      "車種",
      "年式",
      "整備日",
      "走行距離km",
      "種類",
      "項目",
      "費用円",
      "作業先",
      "メモ",
    ],
  ];
  for (const record of [...records].sort((left, right) =>
    left.performedOn.localeCompare(right.performedOn),
  )) {
    const vehicle = vehicles.find((item) => item.id === record.vehicleId);
    rows.push([
      vehicle?.name ?? "",
      vehicle?.make ?? "",
      vehicle?.model ?? "",
      vehicle?.year ?? "",
      record.performedOn,
      record.odometer,
      kindLabels[record.kind] ?? "その他",
      record.title,
      record.cost,
      record.provider,
      record.note,
    ]);
  }
  const csv = `\uFEFF${rows.map((row) => row.map(safeCsvCell).join(",")).join("\r\n")}`;
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `seibi-to-${todayLocal()}.csv`);
  void sendEvent("project_exported");
};

const importProject = async (file) => {
  if (!(file instanceof File) || file.size > 30_000_000)
    throw new Error("30MB以下の.seibitoを選んでください");
  const payload = JSON.parse(await file.text());
  if (
    !payload ||
    payload.product !== "seibi-to" ||
    payload.version !== 1 ||
    !Array.isArray(payload.vehicles) ||
    !Array.isArray(payload.records) ||
    !Array.isArray(payload.reminders) ||
    payload.vehicles.length > maximumVehicles ||
    payload.records.length > maximumVehicles * maximumRecords ||
    payload.reminders.length > maximumVehicles * maximumReminders
  ) {
    throw new Error("整備灯の編集ファイルではありません");
  }
  const vehicleIds = new Set(payload.vehicles.map((vehicle) => vehicle.id));
  if (vehicleIds.size !== payload.vehicles.length) throw new Error("車両データが重複しています");
  const importedVehicles = payload.vehicles.map((vehicle) => ({
    createdAt: cleanNumber(vehicle.createdAt, Number.MAX_SAFE_INTEGER),
    id: cleanText(vehicle.id, 36),
    make: cleanText(vehicle.make, 32),
    model: cleanText(vehicle.model, 48),
    name: cleanText(vehicle.name, 32),
    odometer: cleanNumber(vehicle.odometer, 9_999_999),
    year: cleanNumber(vehicle.year, 2100) || null,
  }));
  if (importedVehicles.some((vehicle) => !uuidPattern.test(vehicle.id) || !vehicle.name)) {
    throw new Error("車両データを確認してください");
  }
  const importedRecords = [];
  const importedRecordIds = new Set();
  const recordCounts = new Map();
  for (const record of payload.records) {
    if (!vehicleIds.has(record.vehicleId) || !(record.kind in kindLabels)) {
      throw new Error("整備カードの車両または種類が不正です");
    }
    const importedRecord = {
      cost: cleanNumber(record.cost, 99_999_999),
      createdAt: cleanNumber(record.createdAt, Number.MAX_SAFE_INTEGER),
      id: cleanText(record.id, 36),
      kind: record.kind,
      note: cleanText(record.note, 500),
      odometer: cleanNumber(record.odometer, 9_999_999),
      performedOn: cleanText(record.performedOn, 10),
      photo: await dataUrlToBlob(record.photo),
      provider: cleanText(record.provider, 48),
      title: cleanText(record.title, 60),
      vehicleId: record.vehicleId,
    };
    if (
      !uuidPattern.test(importedRecord.id) ||
      !datePattern.test(importedRecord.performedOn) ||
      !importedRecord.title ||
      importedRecordIds.has(importedRecord.id)
    ) {
      throw new Error("整備カードの内容が不正です");
    }
    importedRecordIds.add(importedRecord.id);
    recordCounts.set(record.vehicleId, (recordCounts.get(record.vehicleId) ?? 0) + 1);
    if (recordCounts.get(record.vehicleId) > maximumRecords) {
      throw new Error("1台につき整備カードは300件までです");
    }
    importedRecords.push(importedRecord);
  }
  const importedReminderIds = new Set();
  const reminderCounts = new Map();
  const importedReminders = payload.reminders.map((reminder) => {
    if (!vehicleIds.has(reminder.vehicleId)) throw new Error("次回期限の車両が不正です");
    const importedReminder = {
      createdAt: cleanNumber(reminder.createdAt, Number.MAX_SAFE_INTEGER),
      dueOdometer: cleanNumber(reminder.dueOdometer, 9_999_999) || null,
      dueOn: cleanText(reminder.dueOn, 10) || null,
      id: cleanText(reminder.id, 36),
      title: cleanText(reminder.title, 60),
      vehicleId: reminder.vehicleId,
    };
    if (
      !uuidPattern.test(importedReminder.id) ||
      !importedReminder.title ||
      (importedReminder.dueOn && !datePattern.test(importedReminder.dueOn)) ||
      (!importedReminder.dueOn && !importedReminder.dueOdometer) ||
      importedReminderIds.has(importedReminder.id)
    ) {
      throw new Error("次回期限の内容が不正です");
    }
    importedReminderIds.add(importedReminder.id);
    reminderCounts.set(reminder.vehicleId, (reminderCounts.get(reminder.vehicleId) ?? 0) + 1);
    if (reminderCounts.get(reminder.vehicleId) > maximumReminders) {
      throw new Error("1台につき次回期限は50件までです");
    }
    return importedReminder;
  });
  await clearDatabase();
  for (const vehicle of importedVehicles) await putInto("vehicles", vehicle);
  for (const record of importedRecords) await putInto("records", record);
  for (const reminder of importedReminders) await putInto("reminders", reminder);
  activeVehicleId = importedVehicles[0]?.id ?? "";
  if (activeVehicleId) localStorage.setItem(activeVehicleKey, activeVehicleId);
  void sendEvent("project_imported");
  await refreshState();
};

document.querySelectorAll("[data-vehicle-form]").forEach((node) => {
  if (!(node instanceof HTMLFormElement)) return;
  node.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = node.querySelector('button[type="submit"]');
    if (button instanceof HTMLButtonElement) button.disabled = true;
    try {
      await createVehicle(node);
      const state = node.querySelector("[data-vehicle-state]");
      if (state instanceof HTMLElement) {
        state.textContent = "車庫へ入りました";
        state.dataset.tone = "ready";
      }
      document.querySelector("[data-vehicle-dialog]")?.close();
    } catch (error) {
      const state = node.querySelector("[data-vehicle-state]");
      if (state instanceof HTMLElement) {
        state.textContent = error instanceof Error ? error.message : "車を登録できません";
        state.dataset.tone = "error";
      }
    } finally {
      if (button instanceof HTMLButtonElement) button.disabled = false;
    }
  });
});

document.querySelector('[data-action="add-vehicle"]')?.addEventListener("click", () => {
  const dialog = document.querySelector("[data-vehicle-dialog]");
  if (dialog instanceof HTMLDialogElement) dialog.showModal();
});

document.querySelector('[data-action="add-record"]')?.addEventListener("click", () => {
  const dialog = document.querySelector("[data-record-dialog]");
  const form = document.querySelector("[data-record-form]");
  if (!(dialog instanceof HTMLDialogElement) || !(form instanceof HTMLFormElement)) return;
  form.reset();
  prepareRecordForm(form);
  dialog.showModal();
});

document.querySelector('[data-action="close-record"]')?.addEventListener("click", () => {
  document.querySelector("[data-record-dialog]")?.close();
});

document.querySelector("[data-record-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  const button = form.querySelector('button[type="submit"]');
  if (button instanceof HTMLButtonElement) button.disabled = true;
  try {
    await createRecord(form);
    setFormState("[data-record-state]", "整備カードを置きました", "ready");
    document.querySelector("[data-record-dialog]")?.close();
  } catch (error) {
    setFormState(
      "[data-record-state]",
      error instanceof Error ? error.message : "整備を記録できません",
      "error",
    );
  } finally {
    if (button instanceof HTMLButtonElement) button.disabled = false;
  }
});

document.querySelector("[data-photo-input]")?.addEventListener("change", (event) => {
  const input = event.currentTarget;
  const label = document.querySelector("[data-photo-label]");
  if (input instanceof HTMLInputElement && label) {
    label.textContent = input.files?.[0]?.name ?? "写真を1枚添える";
  }
});

document.querySelector('[data-action="add-reminder"]')?.addEventListener("click", () => {
  const dialog = document.querySelector("[data-reminder-dialog]");
  if (dialog instanceof HTMLDialogElement) dialog.showModal();
});

document.querySelector('[data-action="close-reminder"]')?.addEventListener("click", () => {
  document.querySelector("[data-reminder-dialog]")?.close();
});

document.querySelector("[data-reminder-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  const button = form.querySelector('button[type="submit"]');
  if (button instanceof HTMLButtonElement) button.disabled = true;
  try {
    await createReminder(form);
    setFormState("[data-reminder-state]", "次回の灯りを置きました", "ready");
    document.querySelector("[data-reminder-dialog]")?.close();
  } catch (error) {
    setFormState(
      "[data-reminder-state]",
      error instanceof Error ? error.message : "期限を登録できません",
      "error",
    );
  } finally {
    if (button instanceof HTMLButtonElement) button.disabled = false;
  }
});

document.querySelector("[data-history-kind]")?.addEventListener("change", (event) => {
  const select = event.currentTarget;
  if (!(select instanceof HTMLSelectElement)) return;
  historyKind = select.value;
  renderRecords();
});

document.querySelector("[data-history-search]")?.addEventListener("input", (event) => {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  historySearch = input.value.normalize("NFKC").trim().toLocaleLowerCase("ja");
  renderRecords();
});

document.querySelector('[data-action="print"]')?.addEventListener("click", () => {
  void sendEvent("printed");
  window.print();
});

document.querySelector('[data-action="export-project"]')?.addEventListener("click", () => {
  void exportProject().catch((error) =>
    alert(error instanceof Error ? error.message : "書き出せませんでした"),
  );
});

document.querySelector('[data-action="export-csv"]')?.addEventListener("click", () => {
  void exportCsv().catch((error) =>
    alert(error instanceof Error ? error.message : "書き出せませんでした"),
  );
});

document.querySelector("[data-import-file]")?.addEventListener("change", (event) => {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
  void importProject(input.files[0])
    .then(() => alert("車庫を編集ファイルから戻しました"))
    .catch((error) => alert(error instanceof Error ? error.message : "読み込めませんでした"))
    .finally(() => {
      input.value = "";
    });
});

document.querySelector('[data-action="clear-garage"]')?.addEventListener("click", async () => {
  if (
    !confirm(
      "この端末の車・整備履歴・次回期限・写真をすべて削除します。元に戻せません。続けますか？",
    )
  ) {
    return;
  }
  for (const id of photoUrls.keys()) revokePhotoUrl(id);
  await clearDatabase();
  localStorage.removeItem(activeVehicleKey);
  activeVehicleId = "";
  await refreshState();
});

document.querySelector('[data-action="delete-vehicle"]')?.addEventListener("click", async () => {
  const vehicle = activeVehicle();
  if (!vehicle || !confirm(`「${vehicle.name}」と、その整備履歴・期限・写真を削除しますか？`)) {
    return;
  }
  for (const record of activeRecords()) {
    revokePhotoUrl(record.id);
    await deleteFrom("records", record.id);
  }
  for (const reminder of activeReminders()) {
    await deleteFrom("reminders", reminder.id);
  }
  await deleteFrom("vehicles", vehicle.id);
  activeVehicleId = "";
  await refreshState();
});

const firstDay = localStorage.getItem(firstDayKey);
const today = dayInJst();
if (!firstDay) {
  localStorage.setItem(firstDayKey, today);
} else if (firstDay !== today) {
  sendEventOnce("returned");
}
sendEventOnce("visited");

try {
  database = await openDatabase();
  await refreshState();
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.register("/sw.js");
  }
} catch {
  const state = document.querySelector("[data-vehicle-state]");
  if (state) state.textContent = "このブラウザでは端末内の車庫を開けませんでした。";
}

window.addEventListener("pagehide", () => {
  for (const url of photoUrls.values()) URL.revokeObjectURL(url);
});
