/* ============================================================
   API base selector.

   - When the site is served BY the API itself (local dev, this
     preview, or any single-host deployment) use relative URLs.
   - Otherwise fall back to the deployed Render backend.
   ============================================================ */
(function () {
  var h = location.hostname;
  var sameOrigin =
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h.endsWith(".e2b.app") ||
    h.endsWith(".local") ||
    location.port === "3000";
  window.API_BASE = sameOrigin ? "" : "https://vortexbooster-3.onrender.com";
})();
