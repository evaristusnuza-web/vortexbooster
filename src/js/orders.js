/* Orders page: history with live status, filters, search */
const ORDER_PAGE = 15;
let offset = 0;
let hasMore = false;
let autoRefresh = null;
let searching = false;

function statusBadge(status) {
  return `<span class="statusBadge statusBadge--${status}">${status.charAt(0).toUpperCase() + status.slice(1)}</span>`;
}

function orderRowHtml(o) {
  return `
    <tr class="orderRow" data-id="${o.id}">
      <td class="idCell">${o.id}</td>
      <td>${VB.esc(o.service_label)}</td>
      <td>${VB.esc(new Intl.NumberFormat("en").format(o.qty))}</td>
      <td>${statusBadge(o.status)}</td>
      <td><span class="chev">▾</span></td>
    </tr>
    <tr class="orderDetails" data-for="${o.id}" hidden>
      <td colspan="5">
        <div class="orderDetailsGrid">
          <div><div class="k">Link</div><div class="v">${VB.esc(o.link)}</div></div>
          <div><div class="k">Price paid</div><div class="v">${VB.fmtXAF(o.price)}</div></div>
          <div><div class="k">Placed on</div><div class="v">${VB.fmtDateTime(o.created_at)}</div></div>
          <div><div class="k">${o.status === "pending" ? "Remaining" : "Status"}</div>
            <div class="v">${o.status === "pending" && o.remains != null ? new Intl.NumberFormat("en").format(o.remains) : o.status}</div></div>
        </div>
      </td>
    </tr>`;
}

function bindRows() {
  document.querySelectorAll("tr.orderRow").forEach((row) => {
    if (row.dataset.bound) return;
    row.dataset.bound = "1";
    row.addEventListener("click", () => {
      const details = document.querySelector(`tr.orderDetails[data-for="${row.dataset.id}"]`);
      if (!details) return;
      const open = details.hidden;
      details.hidden = !open;
      row.classList.toggle("is-open", open);
    });
  });
}

function anyPending(orders) {
  return orders.some((o) => o.status === "pending");
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefresh = setInterval(async () => {
    if (document.hidden) return;
    try {
      const data = await fetchOrders(true);
      if (anyPending(data.orders)) {
        render(data);
      }
    } catch (e) { /* keep going */ }
  }, 15000);
}

function stopAutoRefresh() {
  if (autoRefresh) { clearInterval(autoRefresh); autoRefresh = null; }
}

function queryParams() {
  const p = new URLSearchParams();
  const status = document.getElementById("statusFilter").value;
  if (status) p.set("status", status);
  const q = document.getElementById("searchInput").value.trim();
  if (q) p.set("q", q);
  p.set("limit", ORDER_PAGE);
  p.set("offset", offset);
  return p.toString();
}

async function fetchOrders(silent) {
  const res = await fetch(VB.API + "/api/orders?" + queryParams(), {
    headers: { Authorization: "Bearer " + VB.token() },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (!silent) throw new Error(data.error || "Failed to load orders");
    return { orders: [], hasMore: false };
  }
  return data;
}

function render(data) {
  const body = document.getElementById("ordersBody");
  const empty = document.getElementById("ordersEmpty");
  const wrap = document.getElementById("loadMoreWrap");
  const noMore = document.getElementById("noMore");

  body.innerHTML = data.orders.map(orderRowHtml).join("");
  bindRows();
  empty.hidden = data.orders.length > 0;
  hasMore = data.hasMore;
  wrap.hidden = !hasMore;
  noMore.hidden = hasMore || data.orders.length === 0;

  if (anyPending(data.orders)) startAutoRefresh();
  else stopAutoRefresh();
}

async function refresh(fromStart) {
  if (fromStart) offset = 0;
  try {
    render(await fetchOrders(false));
  } catch (e) {
    if (!searching) document.getElementById("ordersBody").innerHTML =
      `<tr><td colspan="5" class="emptyState">${VB.esc(e.message)}</td></tr>`;
  }
}

let searchTimer = null;
VB.requireLogin().then((ok) => {
  if (!ok) return;
  VB.initShell();

  document.getElementById("statusFilter").addEventListener("change", () => refresh(true));

  document.getElementById("searchInput").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searching = true;
    searchTimer = setTimeout(() => { searching = false; refresh(true); }, 450);
  });

  document.getElementById("loadMoreBtn").addEventListener("click", async () => {
    offset += ORDER_PAGE;
    const btn = document.getElementById("loadMoreBtn");
    btn.disabled = true;
    try {
      const data = await fetchOrders(true);
      const body = document.getElementById("ordersBody");
      body.insertAdjacentHTML("beforeend", data.orders.map(orderRowHtml).join(""));
      bindRows();
      hasMore = data.hasMore;
      document.getElementById("loadMoreWrap").hidden = !hasMore;
      document.getElementById("noMore").hidden = hasMore;
    } finally {
      btn.disabled = false;
    }
  });

  window.addEventListener("beforeunload", stopAutoRefresh);
  refresh(true);
});
