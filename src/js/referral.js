/* Referral program page */
function copyText(text, btn, label) {
  const done = () => {
    const old = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = old; }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); done(); } catch (e) { /* ignore */ }
  document.body.removeChild(ta);
}

function renderRecent(tx) {
  const wrap = document.getElementById("refRecentWrap");
  const list = document.getElementById("refRecent");
  if (!tx.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  list.innerHTML = tx.map((t) => `
    <div class="txRow" style="cursor:default">
      <div class="txIcon">🎁</div>
      <div class="txMain">
        <div class="txMain__title">Commission</div>
        <div class="txMain__sub">${VB.esc(t.note || "")}</div>
      </div>
      <div class="txSide">
        <div class="txAmt pos">+ ${VB.fmtXAF(t.amount)}</div>
        <div class="txDate">${VB.fmtDate(t.created_at)}</div>
      </div>
    </div>
  `).join("");
}

VB.requireLogin().then(async (ok) => {
  if (!ok) return;
  VB.initShell();

  try {
    const d = await VB.api("/api/referral");
    document.getElementById("refCode").textContent = d.code;
    document.getElementById("refLink").textContent = d.link;
    document.getElementById("refCount").textContent = d.referredCount;
    document.getElementById("refEarnings").textContent = VB.fmtXAF(d.earnings);
    document.getElementById("refRateText").textContent =
      `Earn ${d.rate}% on every deposit made by the people you refer.`;
    document.getElementById("howRate").textContent = d.rate + "%";
    renderRecent(d.recent);

    document.getElementById("copyCodeBtn").addEventListener("click", (e) => copyText(d.code, e.currentTarget));
    document.getElementById("copyLinkBtn").addEventListener("click", (e) => copyText(d.link, e.currentTarget));
  } catch (e) {
    document.getElementById("refCode").textContent = "—";
  }
});
