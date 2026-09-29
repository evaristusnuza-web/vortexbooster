// config.js (loaded before this file) sets window.API_BASE.
const API_BASE = window.API_BASE || "";

// If we already hold a *valid* session, skip straight to the app.
// Checking the token rather than trusting its mere presence avoids a
// redirect loop when a stale token (e.g. one signed with an old
// JWT_SECRET) is still sitting in localStorage.
(function () {
  const t = localStorage.getItem("token");
  if (!t) return;

  fetch((window.API_BASE || "") + "/api/me", {
    headers: { Authorization: "Bearer " + t },
  })
    .then((res) => {
      if (res.ok) {
        window.location.href = "home.html";
      } else {
        localStorage.removeItem("token"); // stale — stay here and log in
      }
    })
    .catch(() => {
      /* offline or backend down — stay on the login page */
    });
})();

const form = document.getElementById("loginForm");
const msg = document.getElementById("loginMsg");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "";

  const identifier = document.getElementById("loginIdentifier").value.trim();
  const password = document.getElementById("pw").value;

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