/* Account page: details, country, password change */
const COUNTRIES = [
  "Cameroon", "Nigeria", "Ghana", "Ivory Coast", "Senegal", "Togo", "Benin",
  "Tunisia", "Morocco", "Algeria", "Mali", "Burkina Faso", "Niger", "Chad",
  "Central African Republic", "Gabon", "Congo", "DRC", "South Sudan", "Sudan",
  "Kenya", "Tanzania", "Uganda", "Rwanda", "Ethiopia", "South Africa",
  "United Kingdom", "France", "Germany", "Spain", "Italy", "Portugal",
  "Netherlands", "Belgium", "Switzerland", "Canada", "United States",
  "Brazil", "Mexico", "Australia", "New Zealand", "Japan", "China",
  "United Arab Emirates", "Qatar", "Saudi Arabia", "Oman", "Kuwait",
  "Singapore", "India", "Pakistan", "Turkey", "Russia",
];

function bindToggles() {
  document.querySelectorAll(".toggle-pass").forEach((btn) => {
    const inp = document.getElementById(btn.dataset.toggles);
    if (!inp) return;
    btn.addEventListener("click", () => {
      inp.type = inp.type === "password" ? "text" : "password";
      btn.textContent = inp.type === "password" ? "👁" : "🙈";
    });
  });
}

function secMsg(text, kind) {
  const el = document.getElementById("secMsg");
  el.textContent = text;
  el.className = "msg show msg--" + (kind || "error");
}

async function loadAccount() {
  const data = await VB.api("/api/account");

  document.getElementById("acctUsername").textContent = data.username;
  document.getElementById("acctEmail").textContent = data.email;
  document.getElementById("emailBadge").style.display = data.emailVerified ? "" : "none";

  const sel = document.getElementById("countrySelect");
  sel.innerHTML = COUNTRIES.map((c) => `<option ${c === data.country ? "selected" : ""}>${c}</option>`).join("");
  if (!COUNTRIES.includes(data.country)) {
    sel.insertAdjacentHTML("afterbegin", `<option selected>${VB.esc(data.country)}</option>`);
  }
}

VB.requireLogin().then((ok) => {
  if (!ok) return;
  VB.initShell();
  bindToggles();

  document.getElementById("signoutBtn").addEventListener("click", VB.signOut);

  // Username edit
  const input = document.getElementById("newUsernameInput");
  const saveBtn = document.getElementById("saveUsernameBtn");
  document.getElementById("editUsernameBtn").addEventListener("click", () => {
    const showing = input.style.display !== "none";
    input.style.display = showing ? "none" : "";
    saveBtn.style.display = showing ? "none" : "";
    if (!showing) input.focus();
  });
  saveBtn.addEventListener("click", async () => {
    const uname = input.value.trim();
    if (uname.length < 3) { secMsg("Username must be at least 3 characters.", "error"); return; }
    try {
      const d = await VB.api("/api/account", { method: "PATCH", body: JSON.stringify({ username: uname }) });
      document.getElementById("acctUsername").textContent = d.username;
      input.style.display = "none";
      saveBtn.style.display = "none";
      input.value = "";
      VB.refreshBalance();
    } catch (e) { secMsg(e.message, "error"); }
  });

  // Country
  document.getElementById("countrySelect").addEventListener("change", async (e) => {
    try {
      await VB.api("/api/account", { method: "PATCH", body: JSON.stringify({ country: e.target.value }) });
    } catch (err) { /* silent */ }
  });

  // Password change
  document.getElementById("savePassBtn").addEventListener("click", async () => {
    const current = document.getElementById("curPass").value;
    const password = document.getElementById("newPass").value;
    const confirm = document.getElementById("confirmPass").value;

    if (!current || !password || !confirm) { secMsg("Fill in all three password fields.", "error"); return; }
    if (password.length < 6) { secMsg("New password must be at least 6 characters.", "error"); return; }
    if (password !== confirm) { secMsg("New passwords do not match.", "error"); return; }

    const btn = document.getElementById("savePassBtn");
    btn.disabled = true;
    try {
      await VB.api("/api/account/password", {
        method: "POST",
        body: JSON.stringify({ current, password }),
      });
      secMsg("Password updated successfully.", "success");
      document.getElementById("curPass").value = "";
      document.getElementById("newPass").value = "";
      document.getElementById("confirmPass").value = "";
    } catch (e) {
      secMsg(e.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  loadAccount().catch(() => {});
});
