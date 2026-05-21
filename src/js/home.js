

const API_BASE = "https://vortexbooster-3.onrender.com";

// ===== AUTH GUARD (run immediately) =====
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

// ===== Tabs + Notch =====
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

const DATA = {
  tiktok: {
    service: ["Followers"],
    types: { Followers: ["Average Quality Followers"] },
    linkLabel: "Tiktok account link:",
    qty: { min: 100, max: 100000 },
    pricePer1k: 3200,
    time: "2 Hours",
    notes: [
      "Make sure the Tiktok account is not private, and dont change the accounts username while followers are been added !",
      "Almost no drop in followers!",
      "Average quality means a shorter guarantee length, semi-reel looking accounts/engagements, and average drops"
    ]
  },
  instagram: {
    service: ["Followers"],
    types: { Followers: ["Average Quality Followers"] },
    linkLabel: "Instagram account link:",
    qty: { min: 50, max: 1000000 },
    pricePer1k: 960,
    time: "1 Hour",
    notes: [
      "Average quality means a shorter guarantee length, semi-real accounts/engagements, and average drops",
      "Kindly make sure your instagram account is not private before purchasing !"
    ]
  },
  facebook: {
    service: ["Page Followers"],
    types: { "Page Followers": ["Average Quality Followers"] },
    linkLabel: "Page Link:",
    qty: { min: 100, max: 500000 },
    pricePer1k: 800,
    time: "2 Hours",
    notes: [
      "if there is a facebook update then your order might take a little bit longer than usual !",
      "Average quality means a shorter guarantee length, semi-real looking accounts/engagementments, and average drops"
    ]
  },
  telegram: {
    service: ["Group/Channel Members"],
    types: { "Group/Channel Members": ["Average Quality Members"] },
    linkLabel: "Group/Channel Link:",
    qty: { min: 500, max: 100000 },
    pricePer1k: 1120,
    time: "2 Hours",
    notes: [
      "If your telegram channel link does not start with https:// then kindly add it to the begining of the link before you purchase or your order will be cancelled !",
      "Don't change the channel/group username while members are been added !",
      "There's no drop in members !",
      "10% chance that the members will have normal english names, otherwise they are asian members",
      "Average quality means a shorter guarantee, semi-reel looking accounts/engagementments, and average drops"
    ]
  },
  youtube: {
    service: ["Subscribers"],
    types: { Subscribers: ["Average Quality Subscribers"] },
    linkLabel: "Youtube channel link:",
    qty: { min: 50, max: 50000 },
    pricePer1k: 25600,
    time: "24 Hours",
    notes: [
      "If you have purchased subscribers before and want to purchase again for the same channel, make sure your previous order was completed already !",
      "1-5% Drop is to be expected !",
      "Average quality means a shorter guarantee length, semi-real looking accounts/engagementments, and average drops"
    ]
  },
  whatsapp: {
    service: ["Channel Followers"],
    types: { "Channel Followers": ["Global Followers"] },
    linkLabel: "Whatsapp Channel Link:",
    qty: { min: 20, max: 10000 },
    pricePer1k: 2240,
    time: "3 Hours",
    notes: ["Followers will be from random countries !"]
  },
  more: {
    service: ["Service"],
    types: { Service: ["Type"] },
    linkLabel: "Link:",
    qty: { min: 1, max: 1000000 },
    pricePer1k: 0,
    time: "—",
    notes: ["Add your custom services here."]
  }
};

let activeKey = "tiktok";

function setOptions(select, items) {
  select.innerHTML = "";
  items.forEach(v => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    select.appendChild(o);
  });
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

function renderNotes(items) {
  noteList.innerHTML = items.map(x => `<li>${escapeHtml(x)}</li>`).join("");
}

function updatePrice() {
  const d = DATA[activeKey];
  const q = Number(qtyInput.value || 0);
  const price = (q / 1000) * d.pricePer1k;
  pricePill.textContent = `${formatNum(Math.round(price))} XAF`;
}

function applyTab(key) {
  activeKey = key;
  const d = DATA[key];

  tabs.forEach(btn => {
    const on = btn.dataset.tab === key;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });

  setOptions(serviceSelect, d.service);
  setOptions(typeSelect, d.types[serviceSelect.value] || []);

  linkLabel.textContent = d.linkLabel;
  linkInput.value = "";
  qtyInput.value = "";
  qtyInput.min = d.qty.min;
  qtyInput.max = d.qty.max;

  qtyHint.textContent = `(Min: ${formatNum(d.qty.min)} - Max: ${formatNum(d.qty.max)})`;
  priceMini.textContent = `(${formatNum(d.pricePer1k)}XAF / 1K ${serviceSelect.value})`;
  timeControl.textContent = d.time;

  renderNotes(d.notes);
  pricePill.textContent = `0 XAF`;

  drawNotch();
}

tabs.forEach(btn => btn.addEventListener("click", () => applyTab(btn.dataset.tab)));

serviceSelect.addEventListener("change", () => {
  const d = DATA[activeKey];
  setOptions(typeSelect, d.types[serviceSelect.value] || []);
  priceMini.textContent = `(${formatNum(d.pricePer1k)}XAF / 1K ${serviceSelect.value})`;
});

qtyInput.addEventListener("input", updatePrice);
window.addEventListener("resize", drawNotch);

// init
applyTab("tiktok");

// ===== Slide-in left menu + active highlight + logout =====
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

  // SIGN OUT: clear token and go back to landing page (index.html)
  nav.querySelector(".sideMenu__signout")?.addEventListener("click", () => {
    localStorage.removeItem("token");
    close();
    window.location.href = "index.html";
  });
})();
