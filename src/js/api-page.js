/* API page: personal API key management */
let currentKey = null;

function setKey(key) {
  currentKey = key;
  const el = document.getElementById("apiKeyText");
  el.textContent = key || "No API key yet";
  el.classList.toggle("placeholder", !key);
  document.getElementById("copyKeyBtn").hidden = !key;
  document.getElementById("revokeKeyBtn").hidden = !key;
}

VB.requireLogin().then(async (ok) => {
  if (!ok) return;
  VB.initShell();

  document.getElementById("apiBase").textContent = location.origin;

  try {
    const d = await VB.api("/api/public/key");
    setKey(d.apiKey);
  } catch (e) { /* no key yet */ }

  document.getElementById("genKeyBtn").addEventListener("click", async () => {
    if (currentKey && !confirm("Generate a NEW key? Your current key will stop working.")) return;
    const btn = document.getElementById("genKeyBtn");
    btn.disabled = true;
    try {
      // Revoke first if one exists, then generate a fresh one
      if (currentKey) {
        try { await VB.api("/api/public/key", { method: "DELETE" }); } catch (e) { /* ignore */ }
      }
      const d = await VB.api("/api/public/key", { method: "POST" });
      setKey(d.apiKey);
    } catch (e) {
      alert(e.message);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("copyKeyBtn").addEventListener("click", (e) => {
    if (!currentKey) return;
    const btn = e.currentTarget;
    const done = () => {
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy key"; }, 1500);
    };
    (navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(currentKey)
      : Promise.reject()
    ).then(done).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = currentKey;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (err) { /* ignore */ }
      document.body.removeChild(ta);
    });
  });

  document.getElementById("revokeKeyBtn").addEventListener("click", async () => {
    if (!confirm("Revoke your API key? It will stop working immediately.")) return;
    try {
      await VB.api("/api/public/key", { method: "DELETE" });
      setKey(null);
    } catch (e) {
      alert(e.message);
    }
  });
});
