/* ============================================================
   VortexBoost app shell (shared by all protected pages)
   - auth guard
   - slide-in side menu (Home, Orders, Wallet, Referral Program,
     Account, Terms, Support, API, SIGN OUT)
   - live wallet balance in the top bar
   - small helpers (API, formatting, toasts)
   ============================================================ */
(function () {
  var VB = {
    API: window.API_BASE || "",
    user: null,
    loggedOut: false,

    token: function () { return localStorage.getItem("token"); },

    esc: function (s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m];
      });
    },

    fmtXAF: function (n) {
      return new Intl.NumberFormat("en").format(Math.round(Number(n) || 0)) + " XAF";
    },

    fmtDate: function (ts) {
      var d = new Date(ts);
      var p = function (x) { return String(x).padStart(2, "0"); };
      return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
    },

    fmtDateTime: function (ts) {
      var d = new Date(ts);
      var p = function (x) { return String(x).padStart(2, "0"); };
      return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    },

    api: function (path, opts) {
      opts = opts || {};
      var headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
      var t = VB.token();
      if (t) headers.Authorization = "Bearer " + t;
      return fetch(VB.API + path, Object.assign({}, opts, { headers: headers })).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (res.status === 401 && t) {
            // Session expired or the token was signed with a different
            // JWT_SECRET. Clear it and send the user somewhere they can
            // actually log in again — not the marketing page.
            localStorage.removeItem("token");
            VB.loggedOut = true;
            window.location.href = "login.html";
            throw new Error("unauthorized");
          }
          if (!res.ok) {
            var e = new Error((data && data.error) || "Request failed");
            e.status = res.status;
            e.data = data;
            throw e;
          }
          return data;
        });
      });
    },

    requireLogin: function () {
      var t = VB.token();
      if (!t) {
        VB.loggedOut = true;
        window.location.href = "login.html";
        return Promise.resolve(false);
      }
      return VB.api("/api/me").then(function (data) {
        VB.user = data.user;
        return true;
      }).catch(function () {
        // VB.api has already cleared the bad token and redirected to
        // login.html; just report failure so the caller stops.
        VB.loggedOut = true;
        return false;
      });
    },

    refreshBalance: function () {
      if (!VB.token()) return;
      VB.api("/api/wallet").then(function (data) {
        var els = document.querySelectorAll(".balance__amt");
        for (var i = 0; i < els.length; i++) els[i].textContent = VB.fmtXAF(data.balance);
        if (typeof window.onBalanceUpdated === "function") window.onBalanceUpdated(data);
      }).catch(function () { /* silent */ });
    },

    signOut: function () {
      localStorage.removeItem("token");
      window.location.href = "index.html";
    },

    /* Inject the slide-in side menu + wire hamburger/sign-out/balance */
    initShell: function () {
      if (document.getElementById("sideMenu")) return;

      var links = [
        { label: "Home", href: "home.html" },
        { label: "Orders", href: "orders.html" },
        { label: "Wallet", href: "wallet.html" },
        { label: "Referral Program", href: "referral.html" },
        { label: "Account", href: "account.html" },
        { label: "Terms", href: "terms.html" },
        { label: "Support", href: "support.html" },
        { label: "API", href: "api.html" },
      ];

      var overlay = document.createElement("div");
      overlay.className = "menuOverlay";
      overlay.setAttribute("aria-hidden", "true");

      var nav = document.createElement("nav");
      nav.className = "sideMenu";
      nav.id = "sideMenu";
      nav.setAttribute("aria-label", "Sidebar");

      var current = (location.pathname.split("/").pop() || "home.html").toLowerCase();

      nav.innerHTML =
        "<ul class='sideMenu__list'>" +
        links.map(function (l) {
          var active = l.href.toLowerCase() === current ? " is-active" : "";
          return "<li class='sideMenu__item" + active + "'><a class='sideMenu__link' href='" + l.href + "'>" + l.label + "</a></li>";
        }).join("") +
        "</ul>" +
        "<div class='sideMenu__footer'><button class='sideMenu__signout' type='button'>SIGN OUT</button></div>";

      document.body.appendChild(overlay);
      document.body.appendChild(nav);

      var hamburger = document.querySelector(".hamburger");
      if (hamburger) {
        hamburger.setAttribute("aria-controls", "sideMenu");
        hamburger.setAttribute("aria-expanded", "false");
      }

      var open = function () {
        nav.classList.add("is-open");
        overlay.classList.add("is-open");
        document.body.classList.add("menu-open");
        if (hamburger) hamburger.setAttribute("aria-expanded", "true");
      };
      var close = function () {
        nav.classList.remove("is-open");
        overlay.classList.remove("is-open");
        document.body.classList.remove("menu-open");
        if (hamburger) hamburger.setAttribute("aria-expanded", "false");
      };

      if (hamburger) hamburger.addEventListener("click", function () {
        nav.classList.contains("is-open") ? close() : open();
      });
      overlay.addEventListener("click", close);
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
      nav.addEventListener("click", function (e) {
        var a = e.target.closest("a");
        if (a) close();
      });

      nav.querySelector(".sideMenu__signout").addEventListener("click", VB.signOut);

      VB.refreshBalance();
    }
  };

  window.VB = VB;
})();
