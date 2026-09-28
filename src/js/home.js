const API_BASE = window.API_BASE || "";

/* ===========================
   AUTH GUARD + BOOT
   (app-shell.js provides VB.requireLogin / VB.initShell)
   =========================== */
VB.requireLogin().then((ok) => {
  if (!ok) return;
  VB.initShell();
  bootHome();
});

async function bootHome() {
  try {
    CATALOG = await VB.api("/api/catalog");
  } catch (e) {
    const panel = document.querySelector(".panel");
    if (panel) panel.innerHTML = "<p style='text-align:center;color:#c0392b;font-weight:700'>Could not load the services catalog.<br>Please check your connection and reload.</p>";
    return;
  }
  syncNativeSelects();
  applyToForm();
  wirePurchase();
  loadHomeWallet();
}

/* ===========================
   Tabs + Notch (UNCHANGED)
   =========================== */
const tabsArea = document.querySelector(".tabsArea");
const tabs = Array.from(document.querySelectorAll(".tab"));
const svg = document.getElementById("notchSvg");

const serviceSelect = document.getElementById("serviceSelect");
const typeSelect = document.getElementById("typeSelect");
const linkLabel = document.getElementById("linkLabel");
const linkInput = document.getElementById("linkInput");
const qtyInput = document.getElementById("qtyInput");
const qtyHint = document.getElementById("qtyHint");
const pricePill = document.getElementById("pricePill");
const priceMini = document.getElementById("priceMini");
const timeControl = document.getElementById("timeControl");
const noteList = document.getElementById("noteList");

const servicePick = document.getElementById("servicePick");
const typePick = document.getElementById("typePick");
const servicePickTitle = document.getElementById("servicePickTitle");
const typePickTitle = document.getElementById("typePickTitle");
const typePreview = document.getElementById("typePreview");

const sheetOverlay = document.getElementById("sheetOverlay");
const sheet = document.getElementById("sheet");
const sheetTitle = document.getElementById("sheetTitle");
const sheetHint = document.getElementById("sheetHint");
const sheetList = document.getElementById("sheetList");
const sheetClose = document.getElementById("sheetClose");

const ACCENT = getComputedStyle(document.documentElement)
  .getPropertyValue("--accent")
  .trim();

function cssVarPx(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return parseFloat(v.replace("px", "")) || 0;
}

function setSvgSize() {
  const r = tabsArea.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
  svg.setAttribute("width", r.width);
  svg.setAttribute("height", r.height);
}

function buildNotchPath(width, activeBtnRect) {
  const lineY = cssVarPx("--lineY");
  const notchHeight = cssVarPx("--notchHeight");
  const notchPad = cssVarPx("--notchPad");
  const rCorner = 10;

  const shell = tabsArea.getBoundingClientRect();
  const leftEdge = (activeBtnRect.left - shell.left) - notchPad;
  const rightEdge = (activeBtnRect.right - shell.left) + notchPad;

  const left = Math.max(0, leftEdge);
  const right = Math.min(width, rightEdge);

  const topY = lineY - notchHeight;

  return [
    `M 0 ${lineY}`,
    `L ${Math.max(0, left - rCorner)} ${lineY}`,
    `Q ${left} ${lineY} ${left} ${lineY - rCorner}`,
    `L ${left} ${topY + rCorner}`,
    `Q ${left} ${topY} ${left + rCorner} ${topY}`,
    `L ${right - rCorner} ${topY}`,
    `Q ${right} ${topY} ${right} ${topY + rCorner}`,
    `L ${right} ${lineY - rCorner}`,
    `Q ${right} ${lineY} ${Math.min(width, right + rCorner)} ${lineY}`,
    `L ${width} ${lineY}`
  ].join(" ");
}

function drawNotch() {
  setSvgSize();
  const rect = tabsArea.getBoundingClientRect();
  const width = rect.width;

  const active = document.querySelector(".tab.is-active");
  if (!active) return;

  const activeRect = active.getBoundingClientRect();
  const d = buildNotchPath(width, activeRect);

  svg.innerHTML = `
    <path d="${d}"
      fill="none"
      stroke="${ACCENT}"
      stroke-width="${cssVarPx("--stroke") || 3}"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  `;
}

/* ===========================
   Helpers
   =========================== */
function formatNum(n) {
  return new Intl.NumberFormat().format(n);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}

function flash(el) {
  if (!el) return;
  el.classList.remove("is-flash");
  void el.offsetWidth;
  el.classList.add("is-flash");
  setTimeout(() => el.classList.remove("is-flash"), 260);
}

function setNativeOptions(select, items) {
  select.innerHTML = "";
  items.forEach(it => {
    const o = document.createElement("option");
    o.value = it.value;
    o.textContent = it.label;
    select.appendChild(o);
  });
}

function renderNotes(items) {
  noteList.innerHTML = (items || []).map(x => `<li>${escapeHtml(x)}</li>`).join("");
}

function withFollowerExplanation(serviceKey, notes) {
  const baseNotes = Array.isArray(notes) ? notes : [];
  if (serviceKey !== "followers") return baseNotes;

  const extra = [
    "2 options for followers: Bots and Real accounts.",
    "Bots don't last for long and are very cheap.",
    "Real accounts stay forever and are expensive."
  ];

  // Keep ALL original notes + add extra at the end
  return [...baseNotes, ...extra];
}

/* ===========================
   CATALOG (services + types)
   pricePer1k is per TYPE
   =========================== */
let CATALOG = null; // loaded from /api/catalog (single source of truth: catalog.json on the server)

let activeKey = "tiktok";
let activeServiceKey = null;
let activeTypeKey = null;

/* ===========================
   Rich bottom sheet
   =========================== */
function openSheet({ title, hint, items, activeValue, onPick }) {
  if (!sheet || !sheetOverlay) return;

  sheetTitle.textContent = title;
  sheetHint.textContent = hint;

  sheetList.innerHTML = items.map(it => {
    const active = it.value === activeValue;
    const metaLines = it.metaLines || [];
    return `
      <div class="sheetItem ${active ? "is-active" : ""}" data-value="${escapeHtml(it.value)}">
        <div class="sheetItem__main">
          <div class="sheetItem__title">${escapeHtml(it.label)}</div>
          ${metaLines.length ? `<div class="sheetItem__meta">${metaLines.map(escapeHtml).join("<br>")}</div>` : ""}
        </div>
        <div class="sheetItem__radio" aria-hidden="true"></div>
      </div>
    `;
  }).join("");

  sheetList.onclick = (e) => {
    const row = e.target.closest(".sheetItem");
    if (!row) return;
    const value = row.getAttribute("data-value");
    onPick(value);
    closeSheet();
  };

  sheet.hidden = false;
  sheetOverlay.hidden = false;
  sheet.setAttribute("aria-hidden", "false");
}

function closeSheet() {
  if (!sheet || !sheetOverlay) return;
  sheet.hidden = true;
  sheetOverlay.hidden = true;
  sheet.setAttribute("aria-hidden", "true");
}

if (sheetClose) sheetClose.addEventListener("click", closeSheet);
if (sheetOverlay) sheetOverlay.addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

/* ===========================
   Catalog -> UI
   =========================== */
function serviceEntries(platformKey) {
  const svcs = CATALOG[platformKey].services;
  return Object.entries(svcs).map(([key, svc]) => ({ value: key, label: svc.label }));
}

function typeEntries(platformKey, serviceKey) {
  const types = CATALOG[platformKey].services[serviceKey].types;
  return Object.entries(types).map(([key, t]) => ({
    value: key,
    label: t.label,
    metaLines: [
      `Price: ${formatNum(t.pricePer1k)} XAF / 1K`,
      `Average completion time: ${t.time}`
    ]
  }));
}

function getTypeData() {
  if (!activeServiceKey || !activeTypeKey) return null;
  return CATALOG[activeKey].services[activeServiceKey]?.types?.[activeTypeKey] || null;
}

function syncNativeSelects() {
  // Services
  const services = serviceEntries(activeKey);
  setNativeOptions(serviceSelect, services);
  activeServiceKey = serviceSelect.value;

  // Types
  const types = typeEntries(activeKey, activeServiceKey);
  setNativeOptions(typeSelect, types);
  activeTypeKey = typeSelect.value;
}

function applyToForm() {
  const platform = CATALOG[activeKey];
  const typeData = getTypeData();
  if (!typeData) return;

  // tab active
  tabs.forEach(btn => {
    const on = btn.dataset.tab === activeKey;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });

  linkLabel.textContent = platform.linkLabel;

  if (servicePickTitle) servicePickTitle.textContent = CATALOG[activeKey].services[activeServiceKey].label;
  if (typePickTitle) typePickTitle.textContent = typeData.label;

  qtyInput.min = typeData.qty.min;
  qtyInput.max = typeData.qty.max;
  qtyInput.value = "";
  qtyHint.textContent = `(Min: ${formatNum(typeData.qty.min)} - Max: ${formatNum(typeData.qty.max)})`;

  pricePill.textContent = "0 XAF";
  priceMini.textContent = `(${formatNum(typeData.pricePer1k)} XAF / 1K ${servicePickTitle ? servicePickTitle.textContent : ""})`;
  timeControl.textContent = typeData.time;

  renderNotes(withFollowerExplanation(activeServiceKey, typeData.notes));

  if (typePreview) {
    typePreview.hidden = false;
    typePreview.innerHTML = `
      ${escapeHtml(typeData.label)}
      <small>Price: ${formatNum(typeData.pricePer1k)} XAF / 1K</small>
      <small>Average completion time: ${escapeHtml(typeData.time)}</small>
    `;
  }

  drawNotch();
}

function updatePrice() {
  const d = getTypeData();
  if (!d) return;
  const q = Number(qtyInput.value || 0);
  const price = (q / 1000) * d.pricePer1k;
  pricePill.textContent = `${formatNum(Math.round(price))} XAF`;
}

/* ===========================
   Events
   =========================== */
tabs.forEach(btn => {
  btn.addEventListener("click", () => {
    if (!CATALOG) return; // catalog still loading
    activeKey = btn.dataset.tab;
    syncNativeSelects();
    applyToForm();
  });
});

if (servicePick) {
  servicePick.addEventListener("click", () => {
    if (!CATALOG) return;
    openSheet({
      title: "Select a service.",
      hint: "Choose a service",
      items: serviceEntries(activeKey),
      activeValue: activeServiceKey,
      onPick: (value) => {
        activeServiceKey = value;
        serviceSelect.value = value;

        // rebuild types for selected service
        const types = typeEntries(activeKey, activeServiceKey);
        setNativeOptions(typeSelect, types);
        activeTypeKey = typeSelect.value;

        applyToForm();
        flash(servicePick);
        flash(typePick);
      }
    });
  });
}

if (typePick) {
  typePick.addEventListener("click", () => {
    if (!CATALOG || !activeServiceKey) return;
    openSheet({
      title: "Select a type.",
      hint: "Choose a type (price/time depends on type)",
      items: typeEntries(activeKey, activeServiceKey),
      activeValue: activeTypeKey,
      onPick: (value) => {
        activeTypeKey = value;
        typeSelect.value = value;
        applyToForm();
        flash(typePick);
      }
    });
  });
}

// Accessibility fallback
serviceSelect.addEventListener("change", () => {
  activeServiceKey = serviceSelect.value;

  const types = typeEntries(activeKey, activeServiceKey);
  setNativeOptions(typeSelect, types);
  activeTypeKey = typeSelect.value;

  applyToForm();
});

typeSelect.addEventListener("change", () => {
  activeTypeKey = typeSelect.value;
  applyToForm();
});

qtyInput.addEventListener("input", updatePrice);
window.addEventListener("resize", drawNotch);

/* ===========================
   PURCHASE (real orders via the API)
   =========================== */
function wirePurchase() {
  const purchaseBtn = document.querySelector(".purchaseBtn");
  if (!purchaseBtn) return;
  const orderMsg = document.getElementById("orderMsg");

  purchaseBtn.addEventListener("click", async () => {
    orderMsg.classList.remove("show", "msg--error", "msg--success");

    if (!activeServiceKey || !activeTypeKey) {
      orderMsg.textContent = "Please select a service and a type first.";
      orderMsg.classList.add("show", "msg--error");
      return;
    }
    const d = getTypeData();
    const link = linkInput.value.trim();
    const qty = Number(qtyInput.value || 0);

    if (!/^https?:\/\/.+\..+/i.test(link)) {
      orderMsg.textContent = "Enter a valid link (must start with http:// or https://).";
      orderMsg.classList.add("show", "msg--error");
      return;
    }
    if (!d.pricePer1k || d.pricePer1k <= 0) {
      orderMsg.textContent = "This service is not available yet.";
      orderMsg.classList.add("show", "msg--error");
      return;
    }
    if (!Number.isFinite(qty) || qty < d.qty.min || qty > d.qty.max) {
      orderMsg.textContent = `Quantity must be between ${formatNum(d.qty.min)} and ${formatNum(d.qty.max)}.`;
      orderMsg.classList.add("show", "msg--error");
      return;
    }

    purchaseBtn.disabled = true;
    const oldText = purchaseBtn.textContent;
    purchaseBtn.textContent = "PROCESSING...";

    try {
      const data = await VB.api("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          platform: activeKey,
          service: activeServiceKey,
          type: activeTypeKey,
          link,
          qty
        })
      });
      orderMsg.innerHTML = `Order #${data.order.id} placed successfully! Track its progress in <a href="orders.html" class="linkBtn">Orders</a>.`;
      orderMsg.classList.add("show", "msg--success");
      qtyInput.value = "";
      updatePrice();
      VB.refreshBalance();
    } catch (e) {
      if (e.status === 402) {
        orderMsg.innerHTML = `${VB.esc(e.message)} &nbsp;<a href="payment.html" class="linkBtn">Add funds</a>`;
      } else {
        orderMsg.textContent = e.message || "Something went wrong. Please try again.";
      }
      orderMsg.classList.add("show", "msg--error");
    } finally {
      purchaseBtn.disabled = false;
      purchaseBtn.textContent = oldText;
    }
  });
}

/* ===========================
   Live wallet stats (spent + balance)
   =========================== */
function loadHomeWallet() {
  VB.api("/api/wallet").then((data) => {
    const spent = document.getElementById("statSpent");
    const bal = document.getElementById("statBalance");
    if (spent) spent.textContent = VB.fmtXAF(data.totalSpent);
    if (bal) bal.textContent = VB.fmtXAF(data.balance);
  }).catch(() => { /* offline: keep defaults */ });
}

/* ===========================
   Slide-in menu + logout
   (now handled by app-shell.js -> VB.initShell())
   =========================== */