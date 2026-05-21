const API_BASE = "https://vortexbooster-3.onrender.com";

console.log("account.js loaded");

if (localStorage.getItem("token")) {
  window.location.href = "home.html";
}

const form = document.getElementById("registerForm");
const msg = document.getElementById("regMsg");

console.log("form found?", !!form);

if (!form) {
  console.error('Missing form id="registerForm" in account.html');
} else {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (msg) msg.textContent = "";

    const username = document.getElementById("regUsername")?.value.trim();
    const email = document.getElementById("regEmail")?.value.trim();
    const password = document.getElementById("regPassword")?.value;
    const confirm = document.getElementById("regConfirm")?.value;

    if (!username || !email || !password || !confirm) {
      if (msg) msg.textContent = "Please fill all fields.";
      return;
    }
    if (username.length < 3) {
      if (msg) msg.textContent = "Username must be at least 3 characters.";
      return;
    }
    if (password.length < 6) {
      if (msg) msg.textContent = "Password must be at least 6 characters.";
      return;
    }
    if (password !== confirm) {
      if (msg) msg.textContent = "Passwords do not match.";
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (msg) msg.textContent = data.error || "Could not create account";
        return;
      }

      localStorage.setItem("token", data.token);
      window.location.href = "home.html";
    } catch (err) {
      console.error(err);
      if (msg) msg.textContent = "Network error. Make sure the backend is running.";
    }
  });
}