(function () {
  "use strict";

  const rowsBody = document.getElementById("rows-body");
  const emptyState = document.getElementById("empty-state");
  const pasteArea = document.getElementById("paste-area");
  const processBtn = document.getElementById("process-paste");
  const addRowBtn = document.getElementById("add-row");
  const clearAllBtn = document.getElementById("clear-all");

  const fechaEl = document.getElementById("fecha");
  const totalPesoEl = document.getElementById("total-peso");
  const rateEl = document.getElementById("rate");
  const subtotalEl = document.getElementById("subtotal");
  const pickupToggle = document.getElementById("pickup-toggle");
  const pickupDetail = document.getElementById("pickup-detail");
  const pickupLabelEl = document.getElementById("pickup-label");
  const pickupAmountEl = document.getElementById("pickup-amount");
  const totalFinalEl = document.getElementById("total-final");

  const repackToggle = document.getElementById("repack-toggle");
  const repackDetail = document.getElementById("repack-detail");
  const repackQtyEl = document.getElementById("repack-qty");
  const repackPriceEl = document.getElementById("repack-price");
  const repackAmountEl = document.getElementById("repack-amount");

  const confirmModal = document.getElementById("confirm-modal");
  const confirmCancelBtn = document.getElementById("confirm-cancel");
  const confirmAcceptBtn = document.getElementById("confirm-accept");

  const historyModal = document.getElementById("history-modal");
  const historyListEl = document.getElementById("history-list");
  const openHistoryBtn = document.getElementById("open-history");
  const historyCloseBtn = document.getElementById("history-close");
  const historyClearBtn = document.getElementById("history-clear");

  const captureFab = document.getElementById("capture-fab");
  const captureToggleBtn = document.getElementById("capture-toggle");
  const downloadPdfBtn = document.getElementById("download-pdf");
  const downloadPngBtn = document.getElementById("download-png");
  const card = document.getElementById("liquidacion-card");

  const STORAGE_KEY = "astra-liquidacion-v1";
  const HISTORY_KEY = "astra-liquidacion-historial-v1";
  const HISTORY_MAX = 200;

  // ---------- Fecha por defecto (hoy) ----------
  function setDefaultDate() {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    fechaEl.textContent = `${dd}/${mm}/${yyyy}`;
  }

  // ---------- Parseo de datos pegados ----------
  function parseLine(line) {
    let parts = line.split("\t").map((p) => p.trim());
    if (parts.length === 1) {
      parts = line.split(/\s{2,}/).map((p) => p.trim());
    }
    parts = parts.filter((p) => p.length > 0);
    if (parts.length === 0) return null;

    // Encontrar el peso: último elemento que parsea como número decimal
    let pesoIdx = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      const n = parseFloat(parts[i].replace(",", "."));
      if (!isNaN(n) && isFinite(n)) {
        pesoIdx = i;
        break;
      }
    }
    if (pesoIdx === -1) return null;

    const peso = parseFloat(parts[pesoIdx].replace(",", "."));
    let remaining = parts.slice(0, pesoIdx);

    let cantidad = 1;
    if (remaining.length && /^\d+$/.test(remaining[remaining.length - 1]) && Number(remaining[remaining.length - 1]) < 1000) {
      cantidad = Number(remaining.pop());
    }

    const nombre = remaining.length ? remaining.pop() : "";
    const codigo = remaining.length ? remaining.pop() : "";

    return { codigo, nombre, cantidad, peso };
  }

  function parsePaste(text) {
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map(parseLine)
      .filter((r) => r !== null);
  }

  // ---------- Construcción de filas ----------
  function createRow(data) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="idx"></td>
      <td class="codigo" contenteditable="true">${escapeHtml(data.codigo || "")}</td>
      <td class="nombre" contenteditable="true">${escapeHtml(data.nombre || "")}</td>
      <td class="num cant-cell" contenteditable="true">${data.cantidad ?? 1}</td>
      <td class="num peso-cell" contenteditable="true">${formatNum(data.peso ?? 0)}</td>
      <td class="no-capture del-cell"><button class="del-row" title="Eliminar fila">×</button></td>
    `;
    return tr;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function formatNum(n) {
    return Number.isFinite(n) ? String(n) : "0";
  }

  function addRows(dataList) {
    dataList.forEach((data) => rowsBody.appendChild(createRow(data)));
    renumber();
    recalc();
    persist();
  }

  function renumber() {
    Array.from(rowsBody.children).forEach((tr, i) => {
      tr.querySelector(".idx").textContent = i + 1;
    });
    emptyState.style.display = rowsBody.children.length ? "none" : "block";
  }

  // ---------- Cálculos ----------
  function parseCellNumber(text) {
    const n = parseFloat(String(text).replace(",", ".").trim());
    return isNaN(n) ? 0 : n;
  }

  // Redondeo exacto ("mitad hacia arriba"), corrigiendo el error de coma flotante
  // de JS que a veces hace que 27.05 * 9.5 (=256.975) se muestre como 256.97 en
  // vez de 256.98. Sin esta corrección, .toFixed(2) puede redondear mal justo
  // en el límite del centavo.
  function roundMoney(n) {
    return Math.round((n + 1e-9) * 100) / 100;
  }

  // Redondea el peso a 3 decimales (la precisión real que usas al pesar),
  // sin perder nada de la suma. Se usa TANTO para mostrar el peso como para
  // el cálculo, así nunca hay un decimal "escondido" que no se ve en pantalla.
  function roundWeight(n) {
    return Math.round((n + 1e-9) * 1000) / 1000;
  }

  // Muestra el peso con hasta 3 decimales, sin ceros innecesarios al final
  // (27.055 -> "27.055", 27.050 -> "27.05", 27.000 -> "27.00").
  function formatWeight(n) {
    let s = roundWeight(n).toFixed(3);
    if (s.endsWith("0")) s = s.slice(0, -1);
    return s;
  }

  // Al confirmar (blur/Enter), deja el número siempre con 2 decimales (7.5 -> 7.50, 10 -> 10.00)
  function formatDecimalField(el) {
    el.textContent = roundMoney(parseCellNumber(el.textContent)).toFixed(2);
  }

  function recalc() {
    let totalPeso = 0;
    rowsBody.querySelectorAll("tr").forEach((tr) => {
      const pesoCell = tr.querySelector(".peso-cell");
      totalPeso += parseCellNumber(pesoCell.textContent);
    });
    // Redondear solo a 3 decimales (la precisión real de un peso), sin recortar
    // a 2, para no perder el ".005" que sí forma parte del cálculo.
    totalPeso = roundWeight(totalPeso);

    const rate = parseCellNumber(rateEl.textContent);
    const subtotal = roundMoney(totalPeso * rate);

    const repackOn = repackToggle.checked;
    const repackQty = repackOn ? parseCellNumber(repackQtyEl.textContent) : 0;
    const repackPrice = repackOn ? parseCellNumber(repackPriceEl.textContent) : 0;
    const repackAmount = roundMoney(repackQty * repackPrice);

    const pickupOn = pickupToggle.checked;
    const pickupAmount = pickupOn ? parseCellNumber(pickupAmountEl.textContent) : 0;

    const total = roundMoney(subtotal + repackAmount + pickupAmount);

    totalPesoEl.textContent = formatWeight(totalPeso);
    subtotalEl.textContent = subtotal.toFixed(2);
    repackAmountEl.textContent = repackAmount.toFixed(2);
    totalFinalEl.textContent = total.toFixed(2);

    persist();
  }

  // ---------- Persistencia local ----------
  function buildState() {
    const rows = Array.from(rowsBody.querySelectorAll("tr")).map((tr) => ({
      codigo: tr.querySelector(".codigo").textContent,
      nombre: tr.querySelector(".nombre").textContent,
      cantidad: tr.querySelector(".cant-cell").textContent,
      peso: tr.querySelector(".peso-cell").textContent,
    }));
    return {
      fecha: fechaEl.textContent,
      cliente: document.getElementById("cliente").textContent,
      rate: rateEl.textContent,
      pickupOn: pickupToggle.checked,
      pickupLabel: pickupLabelEl.textContent,
      pickupAmount: pickupAmountEl.textContent,
      repackOn: repackToggle.checked,
      repackQty: repackQtyEl.textContent,
      repackPrice: repackPriceEl.textContent,
      rows,
    };
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildState()));
    } catch (e) {
      /* localStorage no disponible: continuar sin persistencia */
    }
  }

  function loadState(state) {
    rowsBody.innerHTML = "";
    setDefaultDate();
    document.getElementById("cliente").textContent = state.cliente || "";
    rateEl.textContent = state.rate || "10.00";
    pickupToggle.checked = !!state.pickupOn;
    pickupDetail.hidden = !pickupToggle.checked;
    pickupLabelEl.textContent = state.pickupLabel || "Pick up";
    pickupAmountEl.textContent = state.pickupAmount || "5.00";
    repackToggle.checked = !!state.repackOn;
    repackDetail.hidden = !repackToggle.checked;
    repackQtyEl.textContent = state.repackQty || "20";
    repackPriceEl.textContent = state.repackPrice || "0.50";
    (state.rows || []).forEach((r) => {
      rowsBody.appendChild(
        createRow({
          codigo: r.codigo,
          nombre: r.nombre,
          cantidad: r.cantidad,
          peso: parseCellNumber(r.peso),
        })
      );
    });
    renumber();
    recalc();
  }

  function restore() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      raw = null;
    }
    if (!raw) {
      setDefaultDate();
      renumber();
      recalc();
      return;
    }
    try {
      loadState(JSON.parse(raw));
    } catch (e) {
      setDefaultDate();
      renumber();
      recalc();
    }
  }

  // ---------- Historial de liquidaciones ----------
  function getHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(list) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    } catch (e) {
      /* localStorage no disponible: continuar sin historial */
    }
  }

  function saveToHistory() {
    const state = buildState();
    if (!state.rows.length) return;
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      savedAt: new Date().toISOString(),
      cliente: state.cliente || "Sin nombre",
      fecha: state.fecha,
      cantidad: state.rows.length,
      total: totalFinalEl.textContent,
      state,
    };
    const list = getHistory();
    list.unshift(entry);
    saveHistory(list.slice(0, HISTORY_MAX));
  }

  function formatSavedAt(iso) {
    try {
      const d = new Date(iso);
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      return `${dd}/${mm}/${d.getFullYear()} ${hh}:${min}`;
    } catch (e) {
      return "";
    }
  }

  function renderHistory() {
    const list = getHistory();
    historyListEl.innerHTML = "";
    if (!list.length) {
      historyListEl.innerHTML = '<div class="history-empty">Aún no hay liquidaciones guardadas. Se guardan automáticamente cada vez que descargas un PDF o PNG.</div>';
      return;
    }
    list.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "history-item";
      row.innerHTML = `
        <div class="history-item-info">
          <div class="history-item-client">${escapeHtml(entry.cliente)}</div>
          <div class="history-item-meta">${escapeHtml(entry.fecha || "")} · ${entry.cantidad} guía(s) · guardado ${formatSavedAt(entry.savedAt)}</div>
        </div>
        <div class="history-item-total">$${entry.total}</div>
        <div class="history-item-actions">
          <button class="btn btn-ghost btn-sm" data-action="load" data-id="${entry.id}">Cargar</button>
          <button class="btn btn-danger-ghost btn-sm" data-action="delete" data-id="${entry.id}">Eliminar</button>
        </div>
      `;
      historyListEl.appendChild(row);
    });
  }

  historyListEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const list = getHistory();
    const entry = list.find((h) => h.id === id);
    if (!entry) return;

    if (btn.dataset.action === "delete") {
      const ok = await showConfirm("¿Eliminar esta liquidación del historial?");
      if (!ok) return;
      saveHistory(list.filter((h) => h.id !== id));
      renderHistory();
    } else if (btn.dataset.action === "load") {
      if (rowsBody.children.length) {
        const ok = await showConfirm("Esto reemplazará la liquidación que tienes abierta ahora. ¿Continuar?");
        if (!ok) return;
      }
      loadState(entry.state);
      persist();
      historyModal.hidden = true;
    }
  });

  openHistoryBtn.addEventListener("click", () => {
    renderHistory();
    historyModal.hidden = false;
  });
  historyCloseBtn.addEventListener("click", () => {
    historyModal.hidden = true;
  });
  historyClearBtn.addEventListener("click", async () => {
    if (!getHistory().length) return;
    const ok = await showConfirm("¿Borrar todo el historial de liquidaciones? Esta acción no se puede deshacer.");
    if (!ok) return;
    saveHistory([]);
    renderHistory();
  });

  // ---------- Eventos ----------

  // Enter en cualquier campo editable confirma el valor en vez de bajar de línea.
  const decimalFields = [rateEl, pickupAmountEl, repackPriceEl];
  document.body.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.isContentEditable) {
      e.preventDefault();
      if (decimalFields.includes(e.target)) {
        formatDecimalField(e.target);
        recalc();
      }
      e.target.blur();
    }
  });

  processBtn.addEventListener("click", () => {
    const text = pasteArea.value;
    if (!text.trim()) return;
    const parsed = parsePaste(text);
    if (parsed.length === 0) {
      alert("No se pudo reconocer ninguna fila. Verifica que cada línea tenga al menos nombre y peso.");
      return;
    }
    addRows(parsed);
    pasteArea.value = "";
  });

  addRowBtn.addEventListener("click", () => {
    addRows([{ codigo: "", nombre: "", cantidad: 1, peso: 0 }]);
    const lastRow = rowsBody.lastElementChild;
    if (lastRow) lastRow.querySelector(".nombre").focus();
  });

  rowsBody.addEventListener("click", (e) => {
    if (e.target.classList.contains("del-row")) {
      e.target.closest("tr").remove();
      renumber();
      recalc();
    }
  });

  rowsBody.addEventListener("input", (e) => {
    if (e.target.classList.contains("peso-cell") || e.target.classList.contains("cant-cell")) {
      recalc();
    } else {
      persist();
    }
  });

  rateEl.addEventListener("input", recalc);
  pickupAmountEl.addEventListener("input", recalc);
  pickupLabelEl.addEventListener("input", persist);
  repackQtyEl.addEventListener("input", recalc);
  repackPriceEl.addEventListener("input", recalc);
  fechaEl.addEventListener("input", persist);
  document.getElementById("cliente").addEventListener("input", persist);

  // Al salir del campo (clic afuera o Enter), formatear a 2 decimales
  [rateEl, pickupAmountEl, repackPriceEl].forEach((el) => {
    el.addEventListener("blur", () => {
      formatDecimalField(el);
      recalc();
    });
  });

  pickupToggle.addEventListener("change", () => {
    pickupDetail.hidden = !pickupToggle.checked;
    recalc();
  });

  repackToggle.addEventListener("change", () => {
    repackDetail.hidden = !repackToggle.checked;
    recalc();
  });

  // Modal de confirmación propio (no depende del confirm() nativo del navegador)
  function showConfirm(message) {
    return new Promise((resolve) => {
      document.getElementById("confirm-message").textContent = message;
      confirmModal.hidden = false;
      function onCancel() {
        cleanup(false);
      }
      function onAccept() {
        cleanup(true);
      }
      function cleanup(result) {
        confirmModal.hidden = true;
        confirmCancelBtn.removeEventListener("click", onCancel);
        confirmAcceptBtn.removeEventListener("click", onAccept);
        resolve(result);
      }
      confirmCancelBtn.addEventListener("click", onCancel);
      confirmAcceptBtn.addEventListener("click", onAccept);
    });
  }

  clearAllBtn.addEventListener("click", async () => {
    if (rowsBody.children.length) {
      const ok = await showConfirm("¿Iniciar una nueva liquidación? Se borrarán los datos actuales.");
      if (!ok) return;
    }
    rowsBody.innerHTML = "";
    document.getElementById("cliente").textContent = "";
    rateEl.textContent = "10.00";
    pickupToggle.checked = false;
    pickupDetail.hidden = true;
    pickupLabelEl.textContent = "Pick up";
    pickupAmountEl.textContent = "5.00";
    repackToggle.checked = false;
    repackDetail.hidden = true;
    repackQtyEl.textContent = "20";
    repackPriceEl.textContent = "0.50";
    setDefaultDate();
    renumber();
    recalc();
    pasteArea.value = "";
  });

  captureToggleBtn.addEventListener("click", () => {
    const active = document.body.classList.toggle("capture-mode");
    captureFab.classList.toggle("active", active);
    captureToggleBtn.textContent = active ? "Salir de captura" : "Modo captura";
  });

  // ---------- Exportación ----------
  function buildFileName() {
    const cliente = document.getElementById("cliente").textContent.trim();
    const cantidad = rowsBody.children.length;
    let name = `LIQUIDACION ${cliente ? cliente.toUpperCase() : "SIN NOMBRE"} - ${cantidad} CAJAS`;
    name = name.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
    return name;
  }

  async function captureCard() {
    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch (e) {
        /* continuar aunque las fuentes no confirmen carga */
      }
    }
    // La exportación siempre se ve "modo captura" (sin checkboxes ni botones de borrar),
    // sin importar si el usuario activó el toggle visual.
    const wasCaptureMode = document.body.classList.contains("capture-mode");
    if (!wasCaptureMode) document.body.classList.add("capture-mode");
    try {
      return await html2canvas(card, {
        backgroundColor: "#14100b",
        scale: 1.5,
        useCORS: true,
      });
    } finally {
      if (!wasCaptureMode) document.body.classList.remove("capture-mode");
    }
  }

  downloadPngBtn.addEventListener("click", async () => {
    downloadPngBtn.disabled = true;
    try {
      const canvas = await captureCard();
      const link = document.createElement("a");
      link.download = `${buildFileName()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      saveToHistory();
    } catch (e) {
      alert("No se pudo generar la imagen. Intenta de nuevo.");
    } finally {
      downloadPngBtn.disabled = false;
    }
  });

  downloadPdfBtn.addEventListener("click", async () => {
    downloadPdfBtn.disabled = true;
    try {
      const canvas = await captureCard();
      const imgData = canvas.toDataURL("image/png");
      const { jsPDF } = window.jspdf;
      const widthPx = canvas.width;
      const heightPx = canvas.height;
      const pdfWidth = 190;
      const pdfHeight = (pdfWidth * heightPx) / widthPx;
      const pdf = new jsPDF({
        orientation: pdfHeight > pdfWidth ? "portrait" : "landscape",
        unit: "mm",
        format: [pdfWidth, pdfHeight],
      });
      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      pdf.save(`${buildFileName()}.pdf`);
      saveToHistory();
    } catch (e) {
      alert("No se pudo generar el PDF. Intenta de nuevo.");
    } finally {
      downloadPdfBtn.disabled = false;
    }
  });

  // ---------- Init ----------
  restore();
})();
