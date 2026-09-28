/* Wallet page: balance, affiliate balance, activity feed, owner margin */
const TX_META = {
  deposit:   { icon: "💳", title: "Payment" },
  order:     { icon: "🛒", title: "Order" },
  refund:    { icon: "↩️", title: "Refund" },
  affiliate: { icon: "🎁", title: "Affiliate" },
};

let txOffset = 0;
const TX_PAGE = 15;

function txRowHtml(tx) {
  const meta = TX_META[tx.type] || { icon: "•", title: tx.type };
  const positive = tx.amount >= 0;
  const amountTxt = (positive ? "+" : "−") + " " + VB.fmtXAF(Math.abs(tx.amount));
  const details = `
    <div class="txDetails">
      ${tx.note ? "Note: " + VB.esc(tx.note) + "<br>" : ""}
      ${tx.ref ? "Reference: " + VB.esc(tx.ref) + "<br>" : ""}
      Date: ${VB.fmtDateTime(tx.created_at)}
    </div>`;
  return `
    <div class="txRow" data-id="${tx.id}">
      <div class="txIcon">${meta.icon}</div>
      <div class="txMain">
        <div class="txMain__title">${meta.title}</div>
        <div class="txMain__sub">${VB.esc(tx.note || "")}</div>
        ${details}
      </div>
      <div class="txSide">
        <div class="txAmt ${positive ? "pos" : "neg"}">${amountTxt}</div>
        <div class="txDate">${VB.fmtDate(tx.created_at)}</div>
      </div>
      <span class="txChevron">▾</span>
    </div>`;
}

function renderTxList(tx, append) {
  const list = document.getElementById("txList");
  if (!tx.length && !append) {
    list.innerHTML = `<div class="emptyState">No activity yet.<br><a href="payment.html" class="linkBtn">Add your first funds</a></div>`;
    return;
  }
  const html = tx.map(txRowHtml).join("");
  if (append) list.insertAdjacentHTML("beforeend", html);
  else list.innerHTML = html;
}

function bindTxChevrons() {
  document.querySelectorAll(".txRow").forEach((row) => {
    if (row.dataset.bound) return;
    row.dataset.bound = "1";
    row.addEventListener("click", () => row.classList.toggle("is-open"));
  });
}

async function loadWallet() {
  const data = await VB.api("/api/wallet");

  document.getElementById("heroBalance").textContent = VB.fmtXAF(data.balance);
  document.getElementById("affBalance").textContent = VB.fmtXAF(data.affiliateBalance);

  renderTxList(data.transactions, false);
  bindTxChevrons();

  const wrap = document.getElementById("loadMoreWrap");
  const noMore = document.getElementById("noMore");
  if (data.txCount > data.transactions.length) {
    wrap.hidden = false;
  } else {
    wrap.hidden = true;
    noMore.hidden = data.txCount > 0;
  }

  if (data.isOwner) {
    try {
      const o = await VB.api("/api/owner/summary");
      document.getElementById("ownerCard").hidden = false;
      document.getElementById("ownDeposits").textContent = VB.fmtXAF(o.totalDeposits);
      document.getElementById("ownCost").textContent = VB.fmtXAF(o.providerCost);
      document.getElementById("ownMargin").textContent = VB.fmtXAF(o.netMargin);
    } catch (e) { /* not critical */ }
  }
}

async function loadMore() {
  txOffset += TX_PAGE;
  const btn = document.getElementById("loadMoreBtn");
  btn.disabled = true;
  try {
    const data = await VB.api(`/api/wallet/transactions?limit=${TX_PAGE}&offset=${txOffset}`);
    renderTxList(data.transactions, true);
    bindTxChevrons();
    if (!data.hasMore) {
      document.getElementById("loadMoreWrap").hidden = true;
      document.getElementById("noMore").hidden = false;
    }
  } finally {
    btn.disabled = false;
  }
}

VB.requireLogin().then((ok) => {
  if (!ok) return;
  VB.initShell();
  loadWallet().catch(() => { /* guard already redirects on 401 */ });
  document.getElementById("loadMoreBtn").addEventListener("click", loadMore);
});
