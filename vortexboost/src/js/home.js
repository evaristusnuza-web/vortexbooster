

const API_BASE = "https://vortexbooster-3.onrender.com";

/* ===========================
   AUTH GUARD
   =========================== */
(async function requireLogin() {
  const token = localStorage.getItem("token");
  if (!token) {
    window.location.href = "index.html";
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) throw new Error("unauthorized");
    // const data = await res.json(); // if you want user data
  } catch {
    localStorage.removeItem("token");
    window.location.href = "index.html";
  }
})();

/* ===========================
   DOM
   =========================== */
const tabsArea = document.querySelector(".tabsArea");
const tabs = Array.from(document.querySelectorAll(".tab"));
const svg = document.getElementById("notchSvg");

// form elements
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

// Rich dropdown elements (optional — code won’t break if missing)
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

/* ===========================
   Notch SVG (kept)
   =========================== */
const ACCENT = getComputedStyle(document.documentElement)
  .getPropertyValue("--accent")
  .trim();

function cssVarPx(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return parseFloat(v.replace("px", "")) || 0;
}

function formatNum(n) {
  return new Intl.NumberFormat().format(n);
}

function setSvgSize() {
  if (!tabsArea || !svg) return;
  const r = tabsArea.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
  svg.setAttribute("width", r.width);
  svg.setAttribute("height", r.height);
}

/** Builds stepped notch path */
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
  if (!tabsArea || !svg) return;

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
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}

function renderNotes(items) {
  noteList.innerHTML = (items || []).map(x => `<li>${escapeHtml(x)}</li>`).join("");
}

function withFollowerExplanation(serviceLabel, notes) {
  const baseNotes = Array.isArray(notes) ? notes : [];
  const isFollowers = String(serviceLabel || "").toLowerCase().includes("follow");
  if (!isFollowers) return baseNotes;

  const extra = [
    "2 options for followers: Bots and Real accounts.",
    "Bots don't last for long and are very cheap.",
    "Real accounts stay forever and are expensive."
  ];

  return [...baseNotes, ...extra];
}

function setOptionsFromArray(select, labels) {
  select.innerHTML = "";
  labels.forEach(label => {
    const o = document.createElement("option");
    o.value = label;
    o.textContent = label;
    select.appendChild(o);
  });
}

/* ===========================
   DATA (more services/types)
   Each type has its own price/time/qty/notes
   =========================== */
const DATA = {
  tiktok: {
    service: ["Followers"],
    types: { Followers: ["Average Quality Followers"] },
    linkLabel: "Tiktok account link:",
    services: {
      Followers: {
        types: {
          "Average Quality Followers": {
            pricePer1k: 3200,
            time: "2 Hours",
            qty: { min: 100, max: 100000 },
            notes: [
              "Make sure the Tiktok account is not private, and dont change the accounts username while followers are been added !",
              "Almost no drop in followers!",
              "Average quality means a shorter guarantee length, semi-real looking accounts/engagements, and average drops"
            ]
          },
          "High Quality Followers": {
            pricePer1k: 4800,
            time: "1 Hour",
            qty: { min: 100, max: 50000 },
            notes: [
              "Account must not be private.",
              "Higher quality profiles, lower drop rate."
            ]
          }
        }
      },

      "Video Likes": {
        types: {
          "Fast Likes": { pricePer1k: 900, time: "30 Min", qty: { min: 50, max: 200000 }, notes: ["Video must be public."] },
          "HQ Likes": { pricePer1k: 1400, time: "1 Hour", qty: { min: 50, max: 100000 }, notes: ["Higher retention than fast likes."] }
        }
      },

      "Video Views": {
        types: {
          "Normal Views": { pricePer1k: 180, time: "Instant", qty: { min: 1000, max: 20000000 }, notes: ["Starts quickly."] },
          "Targeted Views": { pricePer1k: 420, time: "1-3 Hours", qty: { min: 1000, max: 5000000 }, notes: ["Better engagement ratio."] }
        }
      }
    }
  },

  instagram: {
    linkLabel: "Instagram account / post link:",
    services: {
      Followers: {
        types: {
          "Average Quality Followers": { pricePer1k: 960, time: "1 Hour", qty: { min: 50, max: 1000000 }, notes: ["Profile must not be private."] },
          "High Quality Followers": { pricePer1k: 1600, time: "2 Hours", qty: { min: 50, max: 500000 }, notes: ["Lower drop than average."] }
        }
      },
      "Post Likes": {
        types: {
          "Fast Likes": { pricePer1k: 700, time: "30 Min", qty: { min: 50, max: 500000 }, notes: ["Post must be public."] },
          "HQ Likes": { pricePer1k: 1200, time: "1 Hour", qty: { min: 50, max: 200000 }, notes: ["Higher retention."] }
        }
      },
      "Video/Reel Views": {
        types: {
          "Reel Views": { pricePer1k: 160, time: "Instant", qty: { min: 1000, max: 20000000 }, notes: ["Reel must be public."] }
        }
      }
    }
  },

  facebook: {
    service: ["Page Followers"],
    types: { "Page Followers": ["Average Quality Followers"] },
    linkLabel: "Page Link:",
    services: {
      "Page Followers": {
        types: {
          "Average Quality Followers": { pricePer1k: 800, time: "2 Hours", qty: { min: 100, max: 500000 }, notes: ["If there is a Facebook update then your order might take longer than usual."] },
          "High Quality Followers": { pricePer1k: 1300, time: "3-6 Hours", qty: { min: 100, max: 200000 }, notes: ["Higher retention."] }
        }
      }
    }
  },

  telegram: {
    service: ["Group/Channel Members"],
    types: { "Group/Channel Members": ["Average Quality Members"] },
    linkLabel: "Group/Channel Link:",
    services: {
      "Group/Channel Members": {
        types: {
          "Average Quality Members": { pricePer1k: 1120, time: "2 Hours", qty: { min: 500, max: 100000 }, notes: ["Don't change username while order runs."] },
          "HQ Members": { pricePer1k: 1900, time: "3-6 Hours", qty: { min: 500, max: 50000 }, notes: ["Higher quality members."] }
        }
      }
    }
  },

  youtube: {
    service: ["Subscribers"],
    types: { Subscribers: ["Average Quality Subscribers"] },
    linkLabel: "Youtube channel link:",
    services: {
      Subscribers: {
        types: {
          "Average Quality Subscribers": { pricePer1k: 25600, time: "24 Hours", qty: { min: 50, max: 50000 }, notes: ["Expect 1-5% drop."] },
          "High Quality Subscribers": { pricePer1k: 34000, time: "24-48 Hours", qty: { min: 50, max: 25000 }, notes: ["Better retention."] }
        }
      }
    }
  },

  whatsapp: {
    service: ["Channel Followers"],
    types: { "Channel Followers": ["Global Followers"] },
    linkLabel: "Whatsapp Channel Link:",
    services: {
      "Channel Followers": {
        types: {
          "Global Followers": { pricePer1k: 2240, time: "3 Hours", qty: { min: 20, max: 10000 }, notes: ["Followers will be from random countries !"] }
        }
      },
      "Channel Emoji Reactions": {
        types: {
          "Emoji Reactions": { pricePer1k: 1800, time: "1-2 Hours", qty: { min: 50, max: 100000 }, notes: ["Depends on availability."] }
        }
      }
    }
  },

  more: {
    service: ["Service"],
    types: { Service: ["Type"] },
    linkLabel: "Link:",
    services: {
      Service: {
        types: {
          Type: { pricePer1k: 0, time: "—", qty: { min: 1, max: 1000000 }, notes: ["Add your custom services here."] }
        }
      }
    }
  }
};

let activePlatform = "tiktok";

/* ===========================
   Core apply logic
   =========================== */
function getSelectedServiceLabel() {
  // Prefer rich picker label if present
  const pickLabel = servicePickTitle?.textContent?.trim();
  if (pickLabel) return pickLabel;

  // else native select
  const opt = serviceSelect.options[serviceSelect.selectedIndex];
  return opt ? opt.textContent : serviceSelect.value;
}

function getSelectedTypeLabel() {
  const pickLabel = typePickTitle?.textContent?.trim();
  if (pickLabel) return pickLabel;

  const opt = typeSelect.options[typeSelect.selectedIndex];
  return opt ? opt.textContent : typeSelect.value;
}

function getTypeData() {
  const p = DATA[activePlatform];
  const svc = getSelectedServiceLabel();
  const type = getSelectedTypeLabel();
  return p?.services?.[svc]?.types?.[type] || null;
}

function rebuildServiceAndType(platformKey) {
  const p = DATA[platformKey];
  const serviceLabels = Object.keys(p.services);
  setOptionsFromArray(serviceSelect, serviceLabels);

  const firstService = serviceSelect.value;
  const typeLabels = Object.keys(p.services[firstService].types);
  setOptionsFromArray(typeSelect, typeLabels);
}

function applyUI() {
  const p = DATA[activePlatform];
  const svcLabel = getSelectedServiceLabel();
  const typeLabel = getSelectedTypeLabel();
  const d = getTypeData();
  if (!d) return;

  linkLabel.textContent = p.linkLabel;

  // If rich pickers exist, show selected labels
  if (servicePickTitle) servicePickTitle.textContent = svcLabel;
  if (typePickTitle) typePickTitle.textContent = typeLabel;

  qtyInput.min = d.qty.min;
  qtyInput.max = d.qty.max;
  qtyInput.value = "";
  qtyHint.textContent = `(Min: ${formatNum(d.qty.min)} - Max: ${formatNum(d.qty.max)})`;

  pricePill.textContent = "0 XAF";
  priceMini.textContent = `(${formatNum(d.pricePer1k)} XAF / 1K ${svcLabel})`;
  timeControl.textContent = d.time;

  renderNotes(withFollowerExplanation(svcLabel, d.notes));

  if (typePreview) {
    typePreview.hidden = false;
    typePreview.innerHTML = `
      ${escapeHtml(typeLabel)}
      <small>Price: ${formatNum(d.pricePer1k)} XAF / 1K</small>
      <small>Average completion time: ${escapeHtml(d.time)}</small>
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
   Tabs events
   =========================== */
tabs.forEach(btn => {
  btn.addEventListener("click", () => {
    activePlatform = btn.dataset.tab;

    tabs.forEach(t => {
      const on = t.dataset.tab === activePlatform;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });

    rebuildServiceAndType(activePlatform);
    applyUI();
  });
});

/* ===========================
   Native select events (works always)
   =========================== */
serviceSelect.addEventListener("change", () => {
  const p = DATA[activePlatform];
  const svc = getSelectedServiceLabel();
  const typeLabels = Object.keys(p.services[svc].types);
  setOptionsFromArray(typeSelect, typeLabels);
  applyUI();
});

typeSelect.addEventListener("change", applyUI);
qtyInput.addEventListener("input", updatePrice);
window.addEventListener("resize", drawNotch);

/* ===========================
   Optional rich bottom sheet
   (Only activates if markup exists)
   =========================== */
function closeSheet() {
  if (!sheet || !sheetOverlay) return;
  sheet.hidden = true;
  sheetOverlay.hidden = true;
  sheet.setAttribute("aria-hidden", "true");
}

function openSheet({ title, hint, items, activeLabel, onPick }) {
  if (!sheet || !sheetOverlay || !sheetList) return;

  sheetTitle.textContent = title;
  sheetHint.textContent = hint;

  sheetList.innerHTML = items.map(it => {
    const active = it.label === activeLabel;
    const metaLines = it.metaLines || [];
    return `
      <div class="sheetItem ${active ? "is-active" : ""}" data-label="${escapeHtml(it.label)}">
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
    const label = row.getAttribute("data-label");
    onPick(label);
    closeSheet();
  };

  sheet.hidden = false;
  sheetOverlay.hidden = false;
  sheet.setAttribute("aria-hidden", "false");
}

if (sheetClose) sheetClose.addEventListener("click", closeSheet);
if (sheetOverlay) sheetOverlay.addEventListener("click", closeSheet);

if (servicePick) {
  servicePick.addEventListener("click", () => {
    const p = DATA[activePlatform];
    const svcLabels = Object.keys(p.services).map(label => ({ label }));
    openSheet({
      title: "Select a service.",
      hint: "Choose a service",
      items: svcLabels,
      activeLabel: getSelectedServiceLabel(),
      onPick: (label) => {
        // set native select to match label
        serviceSelect.value = label;

        // rebuild types for that service
        const typeLabels = Object.keys(p.services[label].types);
        setOptionsFromArray(typeSelect, typeLabels);

        applyUI();
        flash(servicePick);
        flash(typePick);
      }
    });
  });
}

if (typePick) {
  typePick.addEventListener("click", () => {
    const p = DATA[activePlatform];
    const svc = getSelectedServiceLabel();
    const typesObj = p.services[svc].types;
    const items = Object.entries(typesObj).map(([label, d]) => ({
      label,
      metaLines: [
        `Price: ${formatNum(d.pricePer1k)} XAF / 1K`,
        `Average completion time: ${d.time}`
      ]
    }));

    openSheet({
      title: "Select a type.",
      hint: "Choose a type (price/time depends on type)",
      items,
      activeLabel: getSelectedTypeLabel(),
      onPick: (label) => {
        typeSelect.value = label;
        applyUI();
        flash(typePick);
      }
    });
  });
}

/* ===========================
   Init
   =========================== */
rebuildServiceAndType(activePlatform);
applyUI();

/* ===========================
   Slide-in menu + logout
   =========================== */
(() => {
  const hamburger = document.querySelector(".hamburger");
  if (!hamburger) return;

  // IMPORTANT: Your dashboard page is home.html (not index.html)
  const links = [
    { label: "Home", href: "home.html" },
    { label: "Orders", href: "orders.html" },
    { label: "Wallet", href: "wallet.html" },
    { label: "Account", href: "account.html" }, // (your create account page)
    { label: "Terms", href: "terms.html" },
    { label: "Support", href: "support.html" }
  ];

  const overlay = document.createElement("div");
  overlay.className = "menuOverlay";
  overlay.setAttribute("aria-hidden", "true");

  const nav = document.createElement("nav");
  nav.className = "sideMenu";
  nav.id = "sideMenu";
  nav.setAttribute("aria-label", "Sidebar");

  const current = (location.pathname.split("/").pop() || "home.html").toLowerCase();

  nav.innerHTML = `
    <ul class="sideMenu__list">
      ${links.map(({ label, href }) => `
        <li class="sideMenu__item ${href.toLowerCase() === current ? "is-active" : ""}">
          <a class="sideMenu__link" href="${href}">${label}</a>
        </li>
      `).join("")}
    </ul>

    <div class="sideMenu__footer">
      <button class="sideMenu__signout" type="button">SIGN OUT</button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(nav);

  hamburger.setAttribute("aria-controls", "sideMenu");
  hamburger.setAttribute("aria-expanded", "false");

  const open = () => {
    nav.classList.add("is-open");
    overlay.classList.add("is-open");
    document.body.classList.add("menu-open");
    hamburger.setAttribute("aria-expanded", "true");
  };

  const close = () => {
    nav.classList.remove("is-open");
    overlay.classList.remove("is-open");
    document.body.classList.remove("menu-open");
    hamburger.setAttribute("aria-expanded", "false");
  };

  hamburger.addEventListener("click", () => {
    nav.classList.contains("is-open") ? close() : open();
  });

  overlay.addEventListener("click", close);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  nav.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (a) close();
  });

  // SIGN OUT: clear token and go back to landing page (index.html)
  nav.querySelector(".sideMenu__signout")?.addEventListener("click", () => {
    localStorage.removeItem("token");
    close();
    window.location.href = "index.html";
  });
})();
