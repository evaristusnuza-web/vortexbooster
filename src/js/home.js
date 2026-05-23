const API_BASE = "https://vortexbooster-3.onrender.com";

/* ===========================
   AUTH GUARD (run immediately)
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
  } catch {
    localStorage.removeItem("token");
    window.location.href = "index.html";
  }
})();

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
const CATALOG = {
  tiktok: {
    linkLabel: "Tiktok account link:",
    services: {
      followers: {
        label: "Followers",
        types: {
          avg: {
            label: "Average Quality Followers",
            pricePer1k: 3200,
            time: "2 Hours",
            qty: { min: 100, max: 100000 },
            notes: [
              "Make sure the Tiktok account is not private, and dont change the accounts username while followers are been added !",
              "Almost no drop in followers!",
              "Average quality means a shorter guarantee length, semi-real looking accounts/engagements, and average drops"
            ]
          },
          high: {
            label: "High Quality Followers",
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
      video_likes: {
        label: "Video Likes",
        types: {
          fast: { label: "Fast Likes", pricePer1k: 900, time: "30 Min", qty: { min: 50, max: 200000 }, notes: ["Video must be public."] },
          hq: { label: "HQ Likes", pricePer1k: 1400, time: "1 Hour", qty: { min: 50, max: 100000 }, notes: ["Higher retention than fast likes."] }
        }
      },
      video_views: {
        label: "Video Views",
        types: {
          normal: { label: "Normal Views", pricePer1k: 180, time: "Instant", qty: { min: 1000, max: 20000000 }, notes: ["Starts quickly."] },
          targeted: { label: "Targeted Views", pricePer1k: 420, time: "1-3 Hours", qty: { min: 1000, max: 5000000 }, notes: ["Better engagement ratio."] }
        }
      },
      saves: {
        label: "Video Saves",
        types: {
          standard: { label: "Standard Saves", pricePer1k: 700, time: "1-2 Hours", qty: { min: 50, max: 100000 }, notes: ["Video must be public."] }
        }
      },
      shares: {
        label: "Video Shares",
        types: {
          standard: { label: "Standard Shares", pricePer1k: 800, time: "1-2 Hours", qty: { min: 50, max: 100000 }, notes: ["Video must be public."] }
        }
      }
    }
  },

  instagram: {
    linkLabel: "Instagram account / post link:",
    services: {
      followers: {
        label: "Followers",
        types: {
          avg: { label: "Average Quality Followers", pricePer1k: 960, time: "1 Hour", qty: { min: 50, max: 1000000 }, notes: ["Profile must not be private."] },
          high: { label: "High Quality Followers", pricePer1k: 1600, time: "2 Hours", qty: { min: 50, max: 500000 }, notes: ["Lower drop than average."] }
        }
      },
      post_likes: {
        label: "Post Likes",
        types: {
          fast: { label: "Fast Likes", pricePer1k: 700, time: "30 Min", qty: { min: 50, max: 500000 }, notes: ["Post must be public."] },
          hq: { label: "HQ Likes", pricePer1k: 1200, time: "1 Hour", qty: { min: 50, max: 200000 }, notes: ["Higher retention."] }
        }
      },
      reel_views: {
        label: "Video/Reel Views",
        types: {
          views: { label: "Reel Views", pricePer1k: 160, time: "Instant", qty: { min: 1000, max: 20000000 }, notes: ["Reel must be public."] }
        }
      },
      story_views: {
        label: "Story Views",
        types: {
          story: { label: "Story Views", pricePer1k: 520, time: "1 Hour", qty: { min: 100, max: 50000 }, notes: ["Story must be active."] }
        }
      }
    }
  },

  facebook: {
    linkLabel: "Page Link:",
    services: {
      page_followers: {
        label: "Page Followers",
        types: {
          avg: { label: "Average Quality Followers", pricePer1k: 800, time: "2 Hours", qty: { min: 100, max: 500000 }, notes: ["If there is a Facebook update then your order might take longer than usual."] },
          high: { label: "High Quality Followers", pricePer1k: 1300, time: "3-6 Hours", qty: { min: 100, max: 200000 }, notes: ["Higher retention."] }
        }
      },
      post_likes: {
        label: "Post Likes",
        types: {
          likes: { label: "Post Likes", pricePer1k: 900, time: "1-2 Hours", qty: { min: 50, max: 200000 }, notes: ["Post must be public."] }
        }
      }
    }
  },

  telegram: {
    linkLabel: "Group/Channel Link:",
    services: {
      members: {
        label: "Group/Channel Members",
        types: {
          avg: {
            label: "Average Quality Members",
            pricePer1k: 1120,
            time: "2 Hours",
            qty: { min: 500, max: 100000 },
            notes: [
              "If your telegram channel link does not start with https:// then kindly add it to the begining of the link before you purchase or your order will be cancelled !",
              "Don't change the channel/group username while members are been added !",
              "There's no drop in members !"
            ]
          },
          hq: { label: "HQ Members", pricePer1k: 1900, time: "3-6 Hours", qty: { min: 500, max: 50000 }, notes: ["Higher quality members."] }
        }
      },
      post_views_specific: {
        label: "Post Views (Specific Post)",
        types: {
          views: { label: "Post Views", pricePer1k: 240, time: "Instant", qty: { min: 1000, max: 2000000 }, notes: ["Use the post link."] }
        }
      }
    }
  },

  youtube: {
    linkLabel: "Youtube channel link:",
    services: {
      subscribers: {
        label: "Subscribers",
        types: {
          avg: { label: "Average Quality Subscribers", pricePer1k: 25600, time: "24 Hours", qty: { min: 50, max: 50000 }, notes: ["Expect 1-5% drop."] },
          high: { label: "High Quality Subscribers", pricePer1k: 34000, time: "24-48 Hours", qty: { min: 50, max: 25000 }, notes: ["Better retention."] }
        }
      },
      views: {
        label: "Views",
        types: {
          views: { label: "Video Views", pricePer1k: 900, time: "1-6 Hours", qty: { min: 1000, max: 5000000 }, notes: ["Video must be public."] }
        }
      }
    }
  },

  whatsapp: {
    linkLabel: "Whatsapp Channel Link:",
    services: {
      channel_followers: {
        label: "Channel Followers",
        types: {
          global: { label: "Global Followers", pricePer1k: 2240, time: "3 Hours", qty: { min: 20, max: 10000 }, notes: ["Followers will be from random countries !"] }
        }
      },
      channel_reactions: {
        label: "Channel Emoji Reactions",
        types: {
          react: { label: "Emoji Reactions", pricePer1k: 1800, time: "1-2 Hours", qty: { min: 50, max: 100000 }, notes: ["Depends on availability."] }
        }
      }
    }
  },

  more: {
    linkLabel: "Link:",
    services: {
      custom: {
        label: "Custom Service",
        types: {
          custom: { label: "Custom Type", pricePer1k: 0, time: "—", qty: { min: 1, max: 1000000 }, notes: ["Add your custom services here."] }
        }
      }
    }
  }
};

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
    activeKey = btn.dataset.tab;
    syncNativeSelects();
    applyToForm();
  });
});

if (servicePick) {
  servicePick.addEventListener("click", () => {
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
   Init
   =========================== */
syncNativeSelects();
applyToForm();

/* ===========================
   Slide-in menu + logout (UNCHANGED)
   =========================== */
(() => {
  const hamburger = document.querySelector(".hamburger");
  if (!hamburger) return;

  const links = [
    { label: "Home", href: "home.html" },
    { label: "Orders", href: "orders.html" },
    { label: "Wallet", href: "wallet.html" },
    { label: "Account", href: "account.html" },
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
      ${links.map(({label, href}) => `
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

  nav.querySelector(".sideMenu__signout")?.addEventListener("click", () => {
    localStorage.removeItem("token");
    close();
    window.location.href = "index.html";
  });
})();