/* ============================================================
   API base selector.  Loaded FIRST on every page.

   The Express server serves BOTH the API and this frontend, so the
   default is same-origin (""), which is correct for local dev,
   the Arena preview, and any single-host deployment (Render, etc.).

   To point the frontend at an API on a DIFFERENT host, either:
     - set <script>window.VORTEX_API_BASE = "https://api.example.com";</script>
       before this file loads, or
     - set the constant below.
   ============================================================ */
(function () {
  var OVERRIDE = ""; // e.g. "https://vortexbooster-api.onrender.com"

  // Allow an inline override or one injected at runtime (e.g. tests, previews).
  window.API_BASE = window.VORTEX_API_BASE || OVERRIDE || "";
})();
