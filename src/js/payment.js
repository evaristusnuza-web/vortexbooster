/* Payment page: CAMPay (MTN MoMo / Orange Money) top-up */
let activeMethod = null;
let polling = null;

const METHODS = {
  momo: { form: "form-momo", amount: "momoAmount", extra: "momoPhone", msg: "momoMsg", btn: "momoPayBtn" },
  om:   { form: "form-om",   amount: "omAmount",   extra: "omPhone",   msg: "omMsg",   btn: "omPayBtn" },
};

function showMsg(id, text, kind) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = "msg show msg--" + (kind || "error");
}
function clearMsg(id) {
  const el = document.getElementById(id);
  el.textContent = "";
  el.className = "msg";
}

function selectMethod(method) {
  activeMethod = method;
  document.querySelectorAll(".methodCard").forEach((c) =>
    c.classList.toggle("is-active", c.dataset.method === method)
  );
  document.querySelectorAll(".payForm").forEach((f) => f.classList.remove("is-active"));
  document.getElementById(METHODS[method].form).classList.add("is-active");
  document.getElementById("payStatusCard").hidden = true;
}

function showStatus({ reference, status, text, icon, done }) {
  const card = document.getElementById("payStatusCard");
  card.hidden = false;
  document.getElementById("payStatusRef").textContent = reference;
  document.getElementById("payStatusIcon").textContent = icon;
  document.getElementById("payStatusTitle").textContent =
    status === "SUCCESS" ? "Payment received!" :
    status === "FAILED" ? "Payment failed" :
    "Waiting for confirmation…";
  document.getElementById("payStatusText").textContent = text;
  document.getElementById("payStatusVerify").style.display = done ? "none" : "";
  card.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function startDeposit(method) {
  const m = METHODS[method];
  clearMsg(m.msg);

  const amount = Math.round(Number(document.getElementById(m.amount).value || 0));
  const body = { method, amount };

  const phone = document.getElementById(m.extra).value.trim();
  if (!/^\d{8,13}$/.test(phone.replace(/[\s-]/g, ""))) {
    return showMsg(m.msg, "Enter a valid phone number.", "error");
  }
  body.phone = phone;

  if (!amount || amount < 100) {
    return showMsg(m.msg, "Minimum amount is 100 XAF.", "error");
  }

  const btn = document.getElementById(m.btn);
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "Starting…";

  try {
    const data = await VB.api("/api/wallet/deposit", { method: "POST", body: JSON.stringify(body) });

    if (data.status === "SUCCESS") {
      showStatus({
        reference: data.reference, status: "SUCCESS", icon: "✅", done: true,
        text: `+${VB.fmtXAF(amount)} credited to your wallet. You can now place orders!`,
      });
      VB.refreshBalance();
    } else {
      showStatus({
        reference: data.reference, status: "CREATED", icon: "📱", done: false,
        text: "A payment prompt has been sent to your phone. Approve it, then verify your payment below.",
      });
      startPolling(data.reference);
    }
  } catch (e) {
    showMsg(m.msg, e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

function startPolling(reference) {
  if (polling) clearInterval(polling);
  let tries = 0;
  polling = setInterval(async () => {
    tries++;
    try {
      const data = await VB.api("/api/wallet/deposit/" + reference);
      if (data.credited) {
        clearInterval(polling);
        polling = null;
        showStatus({
          reference, status: "SUCCESS", icon: "✅", done: true,
          text: "Payment confirmed. Your wallet has been credited!",
        });
        VB.refreshBalance();
      } else if (data.status === "FAILED") {
        clearInterval(polling);
        polling = null;
        showStatus({ reference, status: "FAILED", icon: "❌", done: true, text: "The payment was not completed. No money left your account." });
      } else if (tries > 60) {
        clearInterval(polling);
        polling = null;
      }
    } catch (e) { /* keep polling */ }
  }, 5000);
}

VB.requireLogin().then((ok) => {
  if (!ok) return;
  VB.initShell();

  document.querySelectorAll(".methodCard").forEach((card) => {
    card.addEventListener("click", () => selectMethod(card.dataset.method));
  });
  document.getElementById("momoPayBtn").addEventListener("click", () => startDeposit("momo"));
  document.getElementById("omPayBtn").addEventListener("click", () => startDeposit("om"));

  document.getElementById("payStatusVerify").addEventListener("click", async () => {
    const ref = document.getElementById("payStatusRef").textContent;
    if (!ref) return;
    try {
      const data = await VB.api("/api/wallet/deposit/" + ref);
      if (data.credited) {
        if (polling) clearInterval(polling);
        showStatus({
          reference: ref, status: "SUCCESS", icon: "✅", done: true,
          text: "Payment confirmed. Your wallet has been credited!",
        });
        VB.refreshBalance();
      } else if (data.status === "FAILED") {
        showStatus({ reference: ref, status: "FAILED", icon: "❌", done: true, text: "The payment was not completed." });
      } else {
        document.getElementById("payStatusText").textContent = "Still waiting (" + (data.status || "PENDING") + "). Approve the prompt on your phone, then try again.";
      }
    } catch (e) {
      document.getElementById("payStatusText").textContent = e.message;
    }
  });
});