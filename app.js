const STORAGE_KEY = "itemsorter.raw.v1";
const EXPORT_VERSION = "ITEMSORTER v1";
const SHARE_HASH_KEY = "state";
const RECENT_WINDOW = 5;
const STATUSES = ["ready to use", "good", "unused", "clogged", "down"];
const ELIGIBLE_STATUSES = new Set(["ready to use", "good", "unused"]);
const DEFAULT_STATUS = "ready to use";

const state = {
  printers: [],
  active: [],
  unassigned: [],
  printed: [],
};

const dom = {
  addPrinterBtn: document.getElementById("addPrinterBtn"),
  addRequestBtn: document.getElementById("addRequestBtn"),
  shareBtn: document.getElementById("shareBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  printersContainer: document.getElementById("printersContainer"),
  unassignedContainer: document.getElementById("unassignedContainer"),
  printedContainer: document.getElementById("printedContainer"),
  printerCount: document.getElementById("printerCount"),
  unassignedCount: document.getElementById("unassignedCount"),
  printedCount: document.getElementById("printedCount"),
  statusBanner: document.getElementById("statusBanner"),
  modalOverlay: document.getElementById("modalOverlay"),
  modalPanel: document.getElementById("modalPanel"),
  modalTitle: document.getElementById("modalTitle"),
  modalBody: document.getElementById("modalBody"),
  modalFooter: document.getElementById("modalFooter"),
  modalCloseBtn: document.getElementById("modalCloseBtn"),
};

let internalId = 1;
let activeModal = null;

function uid(prefix) {
  internalId += 1;
  return `${prefix}_${Date.now().toString(36)}_${internalId.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function cleanText(value) {
  return String(value ?? "")
    .replaceAll("|", "/")
    .replaceAll(/\r?\n/g, " ")
    .trim();
}

function showBanner(message, kind = "info") {
  dom.statusBanner.textContent = message || "";
  dom.statusBanner.dataset.kind = kind;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const ItemSorterCore = globalThis.ItemSorterCore;

if (!ItemSorterCore) {
  throw new Error("ItemSorterCore must be loaded before app.js");
}

async function compressText(text) {
  return ItemSorterCore.compressText(text);
}

async function decompressText(value) {
  return ItemSorterCore.decompressText(value);
}

function buildShareState() {
  return ItemSorterCore.buildShareState(state, printerById, internalId);
}

function parseShareState(data) {
  return ItemSorterCore.parseShareState(data, {
    statuses: STATUSES,
    defaultStatus: DEFAULT_STATUS,
  });
}

async function loadSharedStateFromUrl() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const encoded = params.get(SHARE_HASH_KEY);
  if (!encoded) {
    return null;
  }

  try {
    const text = await decompressText(encoded);
    return parseShareState(JSON.parse(text));
  } catch (error) {
    return null;
  }
}

async function buildShareUrl() {
  const url = new URL(window.location.href);
  const payload = await compressText(JSON.stringify(buildShareState()));
  url.hash = `${SHARE_HASH_KEY}=${payload}`;
  return url.toString();
}

function applyParsedState(parsed) {
  state.printers = parsed.printers;
  state.active = parsed.active;
  state.unassigned = parsed.unassigned;
  state.printed = parsed.printed;
  internalId = parsed.internalId;
}

function openModal({ title, body, footerButtons = [], onClose = null, kind = "default" }) {
  activeModal = { onClose };
  dom.modalTitle.textContent = title;
  dom.modalBody.innerHTML = body;
  dom.modalFooter.innerHTML = "";
  dom.modalPanel.dataset.kind = kind;

  for (const button of footerButtons) {
    const el = document.createElement("button");
    el.textContent = button.label;
    if (button.primary) {
      el.classList.add("primary");
    }
    if (button.danger) {
      el.classList.add("danger");
    }
    el.addEventListener("click", button.onClick);
    dom.modalFooter.appendChild(el);
  }

  dom.modalOverlay.classList.remove("hidden");
  dom.modalOverlay.setAttribute("aria-hidden", "false");
}

function closeModal() {
  if (activeModal?.onClose) {
    activeModal.onClose();
  }
  activeModal = null;
  dom.modalOverlay.classList.add("hidden");
  dom.modalOverlay.setAttribute("aria-hidden", "true");
  delete dom.modalPanel.dataset.kind;
  dom.modalTitle.textContent = "";
  dom.modalBody.innerHTML = "";
  dom.modalFooter.innerHTML = "";
}

function confirmDialog(title, message, confirmLabel = "OK") {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `<p class="help-text">${escapeHtml(message)}</p>`,
      footerButtons: [
        {
          label: "Cancel",
          onClick: () => {
            closeModal();
            resolve(false);
          },
        },
        {
          label: confirmLabel,
          primary: true,
          onClick: () => {
            closeModal();
            resolve(true);
          },
        },
      ],
    });
  });
}

function actionDialog(title, message, actions) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `<p class="help-text">${escapeHtml(message)}</p>`,
      footerButtons: [
        {
          label: "Cancel",
          onClick: () => {
            closeModal();
            resolve(null);
          },
        },
        ...actions.map((action) => ({
          label: action.label,
          primary: Boolean(action.primary),
          danger: Boolean(action.danger),
          onClick: () => {
            closeModal();
            resolve(action.value);
          },
        })),
      ],
    });
  });
}

function promptDialog(title, label, value = "") {
  return new Promise((resolve) => {
    const inputId = uid("input");
    openModal({
      title,
      body: `
        <label for="${inputId}">
          <span>${escapeHtml(label)}</span>
          <input id="${inputId}" type="text" value="${escapeHtml(value)}" />
        </label>
      `,
      footerButtons: [
        {
          label: "Cancel",
          onClick: () => {
            closeModal();
            resolve(null);
          },
        },
        {
          label: "Save",
          primary: true,
          onClick: () => {
            const input = document.getElementById(inputId);
            const nextValue = cleanText(input.value);
            closeModal();
            resolve(nextValue);
          },
        },
      ],
    });
    queueMicrotask(() => document.getElementById(inputId)?.focus());
  });
}

function choiceDialog(title, label, choices, initialValue) {
  return new Promise((resolve) => {
    const selectId = uid("select");
    const options = choices
      .map((choice) => {
        const selected = choice.value === initialValue ? "selected" : "";
        return `<option value="${escapeHtml(choice.value)}" ${selected}>${escapeHtml(choice.label)}</option>`;
      })
      .join("");

    openModal({
      title,
      body: `
        <label for="${selectId}">
          <span>${escapeHtml(label)}</span>
          <select id="${selectId}">${options}</select>
        </label>
      `,
      footerButtons: [
        {
          label: "Cancel",
          onClick: () => {
            closeModal();
            resolve(null);
          },
        },
        {
          label: "Choose",
          primary: true,
          onClick: () => {
            const select = document.getElementById(selectId);
            closeModal();
            resolve(select.value);
          },
        },
      ],
    });

    queueMicrotask(() => document.getElementById(selectId)?.focus());
  });
}

function textAreaDialog(title, helpText, value = "", kind = "default") {
  return new Promise((resolve) => {
    const areaId = uid("textarea");
    const fileId = uid("file");
    openModal({
      title,
      kind,
      body: `
        <section class="backup-card backup-card--import">
          <div class="backup-card__hero">
            <div class="backup-card__icon" aria-hidden="true">TXT</div>
            <div class="backup-card__heading">
              <p class="backup-card__eyebrow">Import backup</p>
              <h4>Choose a text file or paste it below</h4>
              <p class="backup-card__summary">${escapeHtml(helpText)}</p>
            </div>
            <div class="backup-card__version">paste / file</div>
          </div>

          <label class="backup-card__field" for="${areaId}">
            <span>Text</span>
            <textarea id="${areaId}" spellcheck="false" placeholder="Paste backup text here">${escapeHtml(value)}</textarea>
          </label>

          <label class="backup-card__file" for="${fileId}">
            <span>Choose a .txt file</span>
            <input id="${fileId}" type="file" accept=".txt,text/plain" />
          </label>
        </section>
      `,
      footerButtons: [
        {
          label: "Cancel",
          onClick: () => {
            closeModal();
            resolve(null);
          },
        },
        {
          label: "Import",
          primary: true,
          onClick: async () => {
            const area = document.getElementById(areaId);
            const file = document.getElementById(fileId).files?.[0];
            if (file) {
              const text = await file.text();
              closeModal();
              resolve(text);
              return;
            }
            closeModal();
            resolve(area.value);
          },
        },
      ],
    });
    queueMicrotask(() => document.getElementById(areaId)?.focus());
  });
}

function printerById(id) {
  return state.printers.find((printer) => printer.id === id) || null;
}

function printerByName(name) {
  const target = cleanText(name).toLowerCase();
  return state.printers.find((printer) => printer.name.toLowerCase() === target) || null;
}

function requestById(id) {
  return (
    state.active.find((request) => request.id === id) ||
    state.unassigned.find((request) => request.id === id) ||
    state.printed.find((request) => request.id === id) ||
    null
  );
}

function activeRequestsForPrinter(printerId) {
  return state.active.filter((request) => request.printerId === printerId);
}

function recentPrintedCount(printerId) {
  return state.printed
    .slice(-RECENT_WINDOW)
    .filter((request) => request.printerId === printerId)
    .length;
}

function printerWeight(printer) {
  if (!ELIGIBLE_STATUSES.has(printer.status)) {
    return 0;
  }

  const activeCount = activeRequestsForPrinter(printer.id).length;
  const recentCount = recentPrintedCount(printer.id);
  return 1 / (1 + activeCount + recentCount);
}

function printerChanceMap() {
  const weighted = state.printers.map((printer) => ({
    printer,
    weight: printerWeight(printer),
  }));

  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const chanceById = new Map();
  for (const entry of weighted) {
    const chance = total > 0 ? (entry.weight / total) * 100 : 0;
    chanceById.set(entry.printer.id, chance);
  }
  return chanceById;
}

function weightedPrinterChoice(excludeIds = new Set()) {
  const candidates = state.printers
    .filter((printer) => !excludeIds.has(printer.id))
    .map((printer) => ({ printer, weight: printerWeight(printer) }))
    .filter((entry) => entry.weight > 0);

  if (!candidates.length) {
    return null;
  }

  const total = candidates.reduce((sum, entry) => sum + entry.weight, 0);
  let pick = Math.random() * total;
  for (const entry of candidates) {
    pick -= entry.weight;
    if (pick <= 0) {
      return entry.printer;
    }
  }
  return candidates[candidates.length - 1].printer;
}

function saveState() {
  const text = serializeState();
  localStorage.setItem(STORAGE_KEY, text);
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return;
  }

  const parsed = parseState(saved);
  applyParsedState(parsed);
}

function serializeState() {
  return ItemSorterCore.serializeTextState(state, printerById, EXPORT_VERSION);
}

function parseState(text) {
  return ItemSorterCore.parseTextState(text, {
    exportVersion: EXPORT_VERSION,
    statuses: STATUSES,
    defaultStatus: DEFAULT_STATUS,
  });
}

function ensureRequestInState(request) {
  state.active = state.active.filter((item) => item.id !== request.id);
  state.unassigned = state.unassigned.filter((item) => item.id !== request.id);
  state.printed = state.printed.filter((item) => item.id !== request.id);
}

function addPrinter(name) {
  const printerName = cleanText(name);
  if (!printerName) {
    return false;
  }
  if (printerByName(printerName)) {
    showBanner("That printer already exists.", "error");
    return false;
  }

  state.printers.push({
    id: uid("printer"),
    name: printerName,
    status: DEFAULT_STATUS,
  });

  showBanner(`Added printer: ${printerName}`);
  saveState();
  render();
  return true;
}

async function renamePrinter(printerId) {
  const printer = printerById(printerId);
  if (!printer) {
    return;
  }

  const nextName = await promptDialog("Rename Printer", "New printer name", printer.name);
  if (nextName === null || !nextName) {
    return;
  }

  const duplicate = state.printers.find((entry) => entry.id !== printerId && entry.name.toLowerCase() === nextName.toLowerCase());
  if (duplicate) {
    showBanner("That printer already exists.", "error");
    return;
  }

  printer.name = nextName;
  showBanner(`Renamed printer to ${nextName}.`);
  saveState();
  render();
}

async function renameRequest(requestId) {
  const request = requestById(requestId);
  if (!request) {
    return;
  }

  const nextTitle = await promptDialog("Rename Request", "New request title", request.title);
  if (nextTitle === null || !nextTitle) {
    return;
  }

  request.title = nextTitle;
  showBanner(`Renamed request to ${nextTitle}.`);
  saveState();
  render();
}

function autoAssignRequest(title) {
  const request = {
    id: uid("request"),
    title: cleanText(title),
    printerId: null,
    createdAt: Date.now(),
  };

  const printer = weightedPrinterChoice();
  if (printer) {
    request.printerId = printer.id;
    state.active.push(request);
    showBanner(`Assigned "${request.title}" to ${printer.name}.`);
  } else {
    state.unassigned.push(request);
    showBanner(`No eligible printer, so "${request.title}" is waiting in Unassigned.`);
  }

  saveState();
  render();
}

function moveRequestToPrinted(requestId) {
  const index = state.active.findIndex((request) => request.id === requestId);
  if (index === -1) {
    return;
  }
  const [request] = state.active.splice(index, 1);
  state.printed.push({
    ...request,
    printedAt: Date.now(),
  });
  showBanner(`Moved "${request.title}" to Printed Queue.`);
  saveState();
  render();
}

async function reassignRequest(requestId, currentPrinterId = null) {
  const request =
    state.active.find((entry) => entry.id === requestId) ||
    state.unassigned.find((entry) => entry.id === requestId) ||
    state.printed.find((entry) => entry.id === requestId);
  if (!request) {
    return;
  }

  const currentPrinter = currentPrinterId ? printerById(currentPrinterId) : null;
  const choices = [
    { value: "__auto__", label: "Auto assign" },
    { value: "__unassigned__", label: "Leave unassigned" },
  ];

  for (const printer of state.printers) {
    if (currentPrinter && printer.id === currentPrinter.id) {
      continue;
    }
    choices.push({ value: printer.id, label: printer.name });
  }

  const selected = await choiceDialog(
    "Reassign Work",
    `Choose where "${request.title}" should go next.`,
    choices,
    "__auto__"
  );

  if (!selected) {
    return;
  }

  if (selected === "__auto__") {
    await assignExistingRequest(requestId, null, currentPrinterId ? new Set([currentPrinterId]) : new Set());
    return;
  }

  if (selected === "__unassigned__") {
    await assignExistingRequest(requestId, null, new Set(), true);
    return;
  }

  await assignExistingRequest(requestId, selected);
}

async function assignExistingRequest(requestId, printerId = null, excludeIds = new Set(), forceUnassigned = false) {
  const requestIndex = state.active.findIndex((entry) => entry.id === requestId);
  const unassignedIndex = state.unassigned.findIndex((entry) => entry.id === requestId);
  const printedIndex = state.printed.findIndex((entry) => entry.id === requestId);

  let request = null;
  if (requestIndex !== -1) {
    request = state.active.splice(requestIndex, 1)[0];
  } else if (unassignedIndex !== -1) {
    request = state.unassigned.splice(unassignedIndex, 1)[0];
  } else if (printedIndex !== -1) {
    request = state.printed.splice(printedIndex, 1)[0];
    delete request.printedAt;
  }

  if (!request) {
    return;
  }

  if (forceUnassigned) {
    request.printerId = null;
    state.unassigned.push(request);
    showBanner(`Left "${request.title}" unassigned.`);
    saveState();
    render();
    return;
  }

  let targetPrinter = printerId ? printerById(printerId) : null;
  if (!targetPrinter) {
    targetPrinter = weightedPrinterChoice(excludeIds);
  }

  if (!targetPrinter) {
    request.printerId = null;
    state.unassigned.push(request);
    showBanner(`No eligible printer, so "${request.title}" moved to Unassigned.`);
    saveState();
    render();
    return;
  }

  request.printerId = targetPrinter.id;
  state.active.push(request);
  showBanner(`Assigned "${request.title}" to ${targetPrinter.name}.`);
  saveState();
  render();
}

async function movePrinterWorkToOtherPrinters(printerId) {
  const printer = printerById(printerId);
  if (!printer) {
    return;
  }

  const requests = activeRequestsForPrinter(printerId);
  if (!requests.length) {
    return;
  }

  const ok = await confirmDialog(
    "Reassign Work",
    `Move all ${requests.length} request(s) away from ${printer.name}?`,
    "Move"
  );
  if (!ok) {
    return;
  }

  for (const request of [...requests]) {
    await assignExistingRequest(request.id, null, new Set([printerId]));
  }
}

function removePrinter(printerId) {
  const printer = printerById(printerId);
  if (!printer) {
    return;
  }

  const requests = activeRequestsForPrinter(printerId);
  const shouldMove = requests.length > 0;

  confirmDialog(
    "Delete Printer",
    shouldMove
      ? `${printer.name} still has ${requests.length} active request(s). They will be moved to Unassigned.`
      : `Delete ${printer.name}?`,
    "Delete"
  ).then((ok) => {
    if (!ok) {
      return;
    }

    if (shouldMove) {
      const movedIds = new Set(requests.map((request) => request.id));
      for (const request of requests) {
        request.printerId = null;
        state.unassigned.push(request);
      }
      state.active = state.active.filter((request) => !movedIds.has(request.id));
    }

    state.printers = state.printers.filter((entry) => entry.id !== printerId);
    showBanner(`Deleted printer: ${printer.name}`);
    saveState();
    render();
  });
}

async function showPrinterActions(printerId) {
  const printer = printerById(printerId);
  if (!printer) {
    return;
  }

  const action = await actionDialog(
    "Printer Actions",
    `What do you want to do with ${printer.name}?`,
    [
      { label: "Rename", value: "rename" },
      { label: "Delete", value: "delete", danger: true },
    ]
  );

  if (action === "rename") {
    await renamePrinter(printerId);
    return;
  }

  if (action === "delete") {
    removePrinter(printerId);
  }
}

async function setPrinterStatus(printerId, nextStatus) {
  const printer = printerById(printerId);
  if (!printer) {
    return;
  }

  printer.status = nextStatus;
  showBanner(`${printer.name} set to ${nextStatus}.`);
  saveState();
  render();

  if (nextStatus === "down") {
    const requests = activeRequestsForPrinter(printerId);
    if (requests.length) {
      for (const request of [...requests]) {
        await assignExistingRequest(request.id, null, new Set([printerId]));
      }
    }
  }
}

function renderPrinterCard(printer, chanceById) {
  const activeRequests = activeRequestsForPrinter(printer.id);
  const chance = chanceById.get(printer.id) || 0;
  const badgeClass = printer.status.replaceAll(" ", "-");
  const cardClass = printer.status === "down" ? "printer-card down" : "printer-card";

  const requestList = activeRequests.length
    ? activeRequests
        .map(
          (request) => `
            <div class="queue-card" data-request-id="${request.id}">
              <div class="queue-main">
                <div class="queue-title">${escapeHtml(request.title)}</div>
                <div class="queue-subtitle">Assigned to ${escapeHtml(printer.name)}</div>
              </div>
              <div class="queue-actions">
                <button data-action="rename-request" data-id="${request.id}">Rename</button>
                <button data-action="printed" data-id="${request.id}">Printed</button>
                <button data-action="reassign" data-id="${request.id}">Reassign</button>
              </div>
            </div>
          `
        )
        .join("")
    : `<div class="empty-state">No active requests.</div>`;

  return `
    <article class="${cardClass}" data-printer-id="${printer.id}">
      <div class="printer-head">
        <div class="printer-meta">
          <h3 class="printer-title">${escapeHtml(printer.name)}</h3>
          <div class="meta-row">
            <span class="badge ${badgeClass}">${escapeHtml(printer.status)}</span>
            <span class="badge chance">${chance.toFixed(0)}% chance</span>
          </div>
        </div>
        <div class="printer-head-actions">
          <button class="icon-btn" data-action="rename-printer" data-id="${printer.id}" aria-label="Rename printer">✎</button>
          <button class="icon-btn" data-action="delete-printer" data-id="${printer.id}" aria-label="Delete printer">×</button>
        </div>
      </div>

      <div class="meta-row">
        <label class="printer-status-label">
          <span class="muted">Status</span>
          <select class="status-select" data-action="status" data-id="${printer.id}">
            ${STATUSES.map((status) => `<option value="${status}" ${status === printer.status ? "selected" : ""}>${status}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="printer-actions">
        <button data-action="reassign-all" data-id="${printer.id}">Reassign work</button>
      </div>

      <div class="queue-list">
        ${requestList}
      </div>
    </article>
  `;
}

function renderQueueCard(request, kind) {
  const printer = request.printerId ? printerById(request.printerId) : null;
  const subtitle =
    kind === "printed"
      ? `Printed by ${printer ? printer.name : "unknown"}`
      : kind === "active"
        ? printer
          ? `Assigned to ${printer.name}`
          : "Waiting for a printer"
        : "Waiting for assignment";
  const printerLabel = printer ? printer.name : "Unassigned";

  const buttons =
    kind === "printed"
      ? `
        <button data-action="rename-request" data-id="${request.id}">Rename</button>
        <button data-action="restore" data-id="${request.id}">Restore</button>
      `
      : kind === "active"
        ? `
          <button data-action="rename-request" data-id="${request.id}">Rename</button>
          <button data-action="printed" data-id="${request.id}">Printed</button>
          <button data-action="reassign" data-id="${request.id}">Move</button>
        `
        : `
          <button data-action="rename-request" data-id="${request.id}">Rename</button>
          <button data-action="reassign" data-id="${request.id}">Assign</button>
        `;

  return `
    <div class="queue-card" data-request-id="${request.id}">
      <div class="queue-main">
        <div class="queue-title">${escapeHtml(request.title)}</div>
        <div class="queue-subtitle">${escapeHtml(subtitle)}</div>
        <div class="pill-list">
          <span class="badge ${kind === "printed" ? "good" : "unused"}">${escapeHtml(printerLabel)}</span>
        </div>
      </div>
      <div class="queue-actions">
        ${buttons}
      </div>
    </div>
  `;
}

function render() {
  const chanceById = printerChanceMap();
  const printerHtml = state.printers.length
    ? state.printers.map((printer) => renderPrinterCard(printer, chanceById)).join("")
    : `<div class="empty-state">No printers yet. Add one to start assigning work.</div>`;

  dom.printersContainer.innerHTML = printerHtml;
  dom.unassignedContainer.innerHTML = state.unassigned.length
    ? state.unassigned.map((request) => renderQueueCard(request, "unassigned")).join("")
    : `<div class="empty-state">Nothing is waiting right now.</div>`;
  dom.printedContainer.innerHTML = state.printed.length
    ? state.printed.map((request) => renderQueueCard(request, "printed")).join("")
    : `<div class="empty-state">Printed jobs will show up here.</div>`;

  dom.printerCount.textContent = `${state.printers.length} printer${state.printers.length === 1 ? "" : "s"}`;
  dom.unassignedCount.textContent = `${state.unassigned.length} waiting`;
  dom.printedCount.textContent = `${state.printed.length} finished`;
}

async function handleAddPrinter() {
  const name = await promptDialog("Add Printer", "Printer name");
  if (name === null) {
    return;
  }
  addPrinter(name);
}

async function handleAddRequest() {
  const title = await promptDialog("Add Request", "What needs to be printed?");
  if (title === null || !title) {
    return;
  }
  autoAssignRequest(title);
}

async function handleExport() {
  const text = serializeState();
  openModal({
    title: "Backup Download",
    kind: "backup",
    body: `
      <section class="backup-card">
        <div class="backup-card__hero">
          <div class="backup-card__icon" aria-hidden="true">TXT</div>
          <div class="backup-card__heading">
            <p class="backup-card__eyebrow">Plain text backup</p>
            <h4>itemsorter-backup.txt</h4>
            <p class="backup-card__summary">Edit this by hand, copy it, or save it as a file and import it later.</p>
          </div>
          <div class="backup-card__version">v1</div>
        </div>

        <div class="backup-card__stats" aria-label="Backup summary">
          <div>
            <span>Printers</span>
            <strong>${state.printers.length}</strong>
          </div>
          <div>
            <span>Waiting</span>
            <strong>${state.unassigned.length}</strong>
          </div>
          <div>
            <span>Active</span>
            <strong>${state.active.length}</strong>
          </div>
          <div>
            <span>Printed</span>
            <strong>${state.printed.length}</strong>
          </div>
        </div>

        <label class="backup-card__field">
          <span>Backup text</span>
          <textarea id="exportTextArea" readonly rows="14">${escapeHtml(text)}</textarea>
        </label>

        <p class="backup-card__note">Keep the section headers. The file stays easy to read on purpose.</p>
      </section>
    `,
    footerButtons: [
      {
        label: "Copy Text",
        onClick: async () => {
          try {
            if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(text);
            } else {
              const temp = document.createElement("textarea");
              temp.value = text;
              temp.style.position = "fixed";
              temp.style.left = "-9999px";
              document.body.appendChild(temp);
              temp.select();
              document.execCommand("copy");
              temp.remove();
            }
            showBanner("Backup text copied to clipboard.");
          } catch (error) {
            showBanner("Could not copy text. Use Save .txt instead.", "error");
          }
        },
      },
      {
        label: "Save .txt",
        primary: true,
        onClick: async () => {
          await saveBackupText(text);
        },
      },
      {
        label: "Close",
        onClick: closeModal,
      },
    ],
  });
}

async function handleShare() {
  const shareUrl = await buildShareUrl();

  if (navigator.share) {
    try {
      await navigator.share({
        title: "Item Sorter",
        url: shareUrl,
      });
      showBanner("Share link ready.");
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        showBanner("Share canceled.");
        return;
      }
    }
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl);
      showBanner("Share link copied to clipboard.");
      return;
    }
  } catch (error) {
    // Fall through to the modal below.
  }

  openModal({
    title: "Share Link",
    body: `
      <label>
        <span>Copy this link and send it to someone</span>
        <textarea id="shareLinkArea" readonly rows="4">${escapeHtml(shareUrl)}</textarea>
      </label>
    `,
    footerButtons: [
      {
        label: "Close",
        onClick: closeModal,
      },
    ],
  });

  queueMicrotask(() => {
    const area = document.getElementById("shareLinkArea");
    if (area instanceof HTMLTextAreaElement) {
      area.focus();
      area.select();
    }
  });
}

async function saveBackupText(text) {
  const fileName = "itemsorter-backup.txt";

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: "Text Files",
            accept: {
              "text/plain": [".txt"],
            },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      showBanner(`Saved ${handle.name} successfully.`);
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        showBanner("Save canceled.");
        return;
      }
    }
  }

  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 1500);
  showBanner("Download started. Look in your Downloads folder for itemsorter-backup.txt.");
}

async function handleImport() {
  const text = await textAreaDialog(
    "Import Backup",
    "Paste a backup here or choose a .txt file. This uses a plain text format, not JSON.",
    "",
    "backup"
  );

  if (text === null) {
    return;
  }

  const parsed = parseState(text);
  if (!parsed.printers.length && !parsed.active.length && !parsed.unassigned.length && !parsed.printed.length) {
    showBanner("Nothing to import. Check the text and try again.", "error");
    return;
  }

  const ok = await confirmDialog(
    "Replace Current Data",
    "Importing will replace everything in this browser with the pasted file.",
    "Import"
  );
  if (!ok) {
    return;
  }

  state.printers = parsed.printers;
  state.active = parsed.active;
  state.unassigned = parsed.unassigned;
  state.printed = parsed.printed;
  internalId = parsed.internalId;
  saveState();
  render();
  showBanner("Imported backup text.");
}

function wireEvents() {
  dom.addPrinterBtn.addEventListener("click", handleAddPrinter);
  dom.addRequestBtn.addEventListener("click", handleAddRequest);
  dom.shareBtn.addEventListener("click", handleShare);
  dom.exportBtn.addEventListener("click", handleExport);
  dom.importBtn.addEventListener("click", handleImport);
  dom.modalCloseBtn.addEventListener("click", closeModal);
  dom.modalOverlay.addEventListener("click", (event) => {
    if (event.target === dom.modalOverlay) {
      closeModal();
    }
  });

  document.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }

    const action = button.dataset.action;
    const id = button.dataset.id;

    if (action === "printed") {
      moveRequestToPrinted(id);
      return;
    }

    if (action === "rename-request") {
      await renameRequest(id);
      return;
    }

    if (action === "reassign") {
      const currentRequest = requestById(id);
      await reassignRequest(id, currentRequest?.printerId || null);
      return;
    }

    if (action === "reassign-all") {
      await movePrinterWorkToOtherPrinters(id);
      return;
    }

    if (action === "rename-printer") {
      await renamePrinter(id);
      return;
    }

    if (action === "delete-printer") {
      removePrinter(id);
      return;
    }

    if (action === "restore") {
      const currentRequest = requestById(id);
      await assignExistingRequest(id, currentRequest?.printerId || null);
    }
  });

  document.addEventListener("contextmenu", async (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const card = event.target.closest(".printer-card[data-printer-id]");
    if (!card || event.target.closest("button, select, input, textarea, label")) {
      return;
    }

    event.preventDefault();
    await showPrinterActions(card.dataset.printerId);
  });

  document.addEventListener("dblclick", async (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const card = event.target.closest(".printer-card[data-printer-id]");
    if (!card || event.target.closest("button, select, input, textarea, label")) {
      const requestCard = event.target.closest(".queue-card[data-request-id]");
      if (!requestCard || event.target.closest("button, select, input, textarea, label")) {
        return;
      }

      event.preventDefault();
      await renameRequest(requestCard.dataset.requestId);
      return;
    }

    event.preventDefault();
    await showPrinterActions(card.dataset.printerId);
  });

  document.addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    if (target.dataset.action === "status") {
      await setPrinterStatus(target.dataset.id, target.value);
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) {
      return;
    }
    const parsed = parseState(event.newValue);
    state.printers = parsed.printers;
    state.active = parsed.active;
    state.unassigned = parsed.unassigned;
    state.printed = parsed.printed;
    internalId = parsed.internalId;
    render();
    showBanner("Updated from another tab.");
  });
}

async function bootstrap() {
  const sharedState = await loadSharedStateFromUrl();
  if (sharedState) {
    applyParsedState(sharedState);
    saveState();
    showBanner("Loaded shared link.");
  } else {
    loadState();
  }
  if (!state.printers.length && !state.active.length && !state.unassigned.length && !state.printed.length) {
    saveState();
  }
  wireEvents();
  render();
  if (!sharedState) {
    showBanner("Saved in this browser. Use Export Text for backups.");
  }
}

bootstrap();
