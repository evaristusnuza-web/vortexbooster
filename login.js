const API_BASE = "https://vortexbooster-3.onrender.com";

// If already logged in, go to home
if (localStorage.getItem("token")) {
  window.location.href = "home.html";
}

const form = document.getElementById("loginForm");
const msg = document.getElementById("loginMsg");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "";

  const identifier = document.getElementById("loginIdentifier").value.trim();
  const password = document.getElementById("loginPassword").value;

  try {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      msg.textContent = data.error || "Login failed";
      return;
    }

    localStorage.setItem("token", data.token);
    window.location.href = "home.html";
  } catch (err) {
    msg.textContent = "Network error. Make sure the backend is running.";
  }
});