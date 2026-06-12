/* ============================================================================
   ft-shell.js — die geteilte Hülle für ALLE Seiten (Single Source of Truth).
   Rendert Header + mobiles Nav-Sheet + Footer identisch in jede Seite und
   stellt Render-Helfer für Funde/Stimmen bereit. Eine Seite braucht nur:
     <body data-page="archiv"> … <script src="assets/ft-shell.js" defer></script>
   Nav hier ändern = überall geändert.
   ============================================================================ */
(function () {
  "use strict";

  /* ---- Die 4 Welten (Menü-Modell, eine Quelle) ---- */
  var NAV = [
    { key: "archiv",        href: "index.html",          label: "archiv" },
    { key: "einreichen",    href: "einreichen.html",     label: "einreichen", action: true },
    { key: "zukuenftinnen", href: "zukuenftinnen.html",  label: "zukünft:innen" },
    { key: "methoden",      href: "methoden.html",       label: "methoden" }
  ];

  var SCHULE = {
    "systemisch":         { label: "Systemisch",         kuratorin: "Noor",    accent: "--ft-schule-systemisch" },
    "kritisch-normativ":  { label: "Kritisch-Normativ",  kuratorin: "Amani",   accent: "--ft-schule-kritisch-normativ" },
    "kulturell-narrativ": { label: "Kulturell-Narrativ", kuratorin: "Tomek",   accent: "--ft-schule-kulturell-narrativ" },
    "partizipativ":       { label: "Partizipativ",       kuratorin: "Gabriel", accent: "--ft-schule-partizipativ" },
    "design-futures":     { label: "Design Futures",     kuratorin: "Yuki",    accent: "--ft-schule-design-futures" },
    "oekologisch":        { label: "Ökologisch",         kuratorin: "Solveig", accent: "--ft-schule-oekologisch" }
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  /* Responsive Bilder: aus einem 1200px-Bild-src die kleineren Varianten ableiten
     (Namens-Konvention: <slug>-480.webp / <slug>-800.webp neben <slug>.webp,
     erzeugt von tools/optimize_images.py). Nur .webp; sonst "" (kein srcset). */
  function imgSrcset(src, widths) {
    if (!src || !/\.webp$/i.test(src)) return "";
    var base = src.replace(/\.webp$/i, "");
    var parts = (widths || [480, 800]).map(function (w) { return esc(base + "-" + w + ".webp") + " " + w + "w"; });
    parts.push(esc(src) + " 1200w");
    return parts.join(", ");
  }
  function accentFor(slug) { var s = SCHULE[slug]; return s ? "var(" + s.accent + ")" : "var(--ft-line)"; }
  function schuleLabel(slug) { var s = SCHULE[slug]; return s ? s.label : (slug || "—"); }
  function kuratorin(slug) { var s = SCHULE[slug]; return s ? s.kuratorin : "—"; }

  /* ---- THEME ---- */
  function getTheme() {
    try { var t = localStorage.getItem("ft-theme"); if (t) return t; } catch (e) {}
    return document.documentElement.getAttribute("data-theme") || "dark";
  }
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("ft-theme", t); } catch (e) {}
    document.querySelectorAll("[data-mode-label]").forEach(function (el) { el.textContent = t === "dark" ? "hell" : "dunkel"; });
  }

  /* ---- HEADER ---- */
  function navLinks(current, mobile) {
    return NAV.map(function (n) {
      var cur = n.key === current ? ' aria-current="page"' : "";
      var cls = [];
      if (n.action) cls.push(mobile ? "" : "nav-do");
      var arrow = mobile ? '<span class="arr">→</span>' : "";
      return '<a href="' + n.href + '"' + (cls.join(" ") ? ' class="' + cls.join(" ") + '"' : "") + cur + '>' +
        '<span>' + esc(n.label) + '</span>' + arrow + '</a>';
    }).join(mobile ? "" : '<span aria-hidden="true" style="color:var(--ft-line)">·</span>');
  }

  function buildHeader(current) {
    var h = document.createElement("header");
    h.className = "site-header";
    h.innerHTML =
      '<div class="wrap site-header__inner">' +
        '<a class="brand" href="index.html" aria-label="futures·thinking — Startseite">' +
          '<span class="brand__word">futures<span class="brand__dot">·</span>thinking</span>' +
          '<span class="brand__claim">ein offenes fundbüro der zukunft</span>' +
        '</a>' +
        '<nav class="topnav" aria-label="Hauptnavigation">' + navLinks(current, false) + '</nav>' +
        '<div class="header-actions">' +
          '<button type="button" class="mode-toggle" data-mode-toggle aria-label="Hell-/Dunkelmodus umschalten">' +
            '<span aria-hidden="true">◐</span><span data-mode-label>hell</span>' +
          '</button>' +
          '<button type="button" class="nav-burger" data-nav-open aria-label="Menü öffnen" aria-expanded="false" aria-controls="ft-nav-sheet">' +
            '<span class="nav-burger__bars" aria-hidden="true"></span>' +
          '</button>' +
        '</div>' +
      '</div>';
    return h;
  }

  function buildSheet(current) {
    var d = document.createElement("div");
    d.className = "nav-sheet";
    d.id = "ft-nav-sheet";
    d.innerHTML =
      '<div class="nav-sheet__scrim" data-nav-close></div>' +
      '<div class="nav-sheet__panel" role="dialog" aria-modal="true" aria-label="Navigation">' +
        '<div class="nav-sheet__bar">' +
          '<span class="brand__word">futures<span class="brand__dot">·</span>thinking</span>' +
          '<button type="button" class="nav-sheet__close" data-nav-close aria-label="Menü schließen">✕</button>' +
        '</div>' +
        '<nav class="nav-sheet__nav" aria-label="Hauptnavigation (mobil)">' + navLinks(current, true) + '</nav>' +
        '<a class="btn btn--primary btn--block nav-sheet__do" href="einreichen.html">＋ fund einreichen</a>' +
        '<div class="nav-sheet__foot">' +
          '<button type="button" class="mode-toggle" data-mode-toggle aria-label="Modus umschalten">' +
            '<span aria-hidden="true">◐</span> <span data-mode-label>hell</span>' +
          '</button>' +
          '<span class="mono" style="font-size:.72rem;color:var(--ft-muted)">kein dienst · ein archiv</span>' +
        '</div>' +
      '</div>';
    return d;
  }

  function buildFooter() {
    var f = document.createElement("footer");
    f.className = "site-footer";
    f.innerHTML =
      '<div class="wrap site-footer__inner">' +
        '<div class="site-footer__brand">' +
          '<span class="brand__word">futures<span class="brand__dot">·</span>thinking</span>' +
          '<p class="site-footer__tagline">Ein offenes Fundbüro der Zukunft. Eingereichte Funde aus den Jahren 2030–2070, kuratiert von sechs Zukünft:innen. Kein Dienst — ein Archiv.</p>' +
        '</div>' +
        '<div class="site-footer__col">' +
          '<h4>Die vier Welten</h4>' +
          '<a href="index.html">archiv — was es zu sehen gibt</a>' +
          '<a href="einreichen.html">einreichen — was du beiträgst</a>' +
          '<a href="zukuenftinnen.html">zukünft:innen — die sechs stimmen</a>' +
          '<a href="methoden.html">methoden — das wiki</a>' +
        '</div>' +
        '<div class="site-footer__col">' +
          '<h4>Rechtliches & mehr</h4>' +
          '<a href="impressum.html">impressum</a>' +
          '<a href="datenschutz.html">datenschutz</a>' +
          '<a class="bridge-08" href="https://08sechzehn.de" target="_blank" rel="noopener">echte runde? → 08sechzehn ↗</a>' +
        '</div>' +
      '</div>' +
      '<div class="wrap site-footer__bar">' +
        '<span>© 2026 Thomas Siegel · futuresthinking.eu</span>' +
        '<span>Inhalte CC-BY-NC-4.0 · Prototyp 2026-06-11</span>' +
      '</div>';
    return f;
  }

  /* ---- Nav-Sheet-Verhalten ---- */
  function wireSheet() {
    var sheet = document.getElementById("ft-nav-sheet");
    if (!sheet) return;
    function open() {
      sheet.classList.add("is-open");
      document.documentElement.classList.add("ft-nav-open");
      document.querySelectorAll("[data-nav-open]").forEach(function (b) { b.setAttribute("aria-expanded", "true"); });
      var first = sheet.querySelector(".nav-sheet__nav a"); if (first) first.focus();
    }
    function close() {
      sheet.classList.remove("is-open");
      document.documentElement.classList.remove("ft-nav-open");
      document.querySelectorAll("[data-nav-open]").forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
    }
    document.querySelectorAll("[data-nav-open]").forEach(function (b) { b.addEventListener("click", open); });
    sheet.querySelectorAll("[data-nav-close]").forEach(function (b) { b.addEventListener("click", close); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && sheet.classList.contains("is-open")) close(); });
  }

  function wireTheme() {
    document.querySelectorAll("[data-mode-toggle]").forEach(function (btn) {
      btn.addEventListener("click", function () { setTheme(getTheme() === "dark" ? "light" : "dark"); });
    });
  }

  /* ---- Render-Helfer (Single Source für Fund-Markup) ---- */
  function fundCardHTML(f) {
    var teaser = (f.beipackzettel || "").replace(/\s+/g, " ").trim();
    return '' +
      '<a class="fund" href="fund.html?id=' + encodeURIComponent(f.objekt_id) + '" style="--fund-accent:' + accentFor(f.schule) + '">' +
        (f.bild && f.bild.src
          ? '<img class="fund__img" src="' + esc(f.bild.src) + '"' +
              (imgSrcset(f.bild.src) ? ' srcset="' + imgSrcset(f.bild.src) + '" sizes="(max-width:560px) 92vw, (max-width:860px) 46vw, 320px"' : '') +
              ' alt="' + esc(f.bild.alt || f.objektname) + '"' +
              (f.bild.width && f.bild.height ? ' width="' + f.bild.width + '" height="' + f.bild.height + '"' : '') +
              ' loading="lazy" decoding="async">'
          : '') +
        '<div class="fund__top">' +
          '<span class="fund__year">' + esc(f.fundjahr) + '</span>' +
          '<span class="fund__schule">' + esc(schuleLabel(f.schule)) + '</span>' +
        '</div>' +
        '<span class="fund__name">' + esc(f.objektname) + '</span>' +
        '<p class="fund__teaser">' + esc(teaser) + '</p>' +
        '<div class="fund__foot">' +
          '<span class="chip chip--' + esc(f.wuenschbarkeit) + '">' + esc(f.wuenschbarkeit) + '</span>' +
          '<span class="chip chip--' + esc(f.wahrscheinlichkeit) + '">' + esc(f.wahrscheinlichkeit) + '</span>' +
          '<span class="fund__ort">↳ ' + esc(f.fundort) + '</span>' +
        '</div>' +
      '</a>';
  }

  /* ---- Funddaten LIVE laden ----
     Funde sind NICHT mehr eingebettet — sie kommen build-generiert aus
     data/funds.json (Form: { anzahl, funde:[...] }). FT.ready(cb) gibt ein
     Promise zurück, lädt die JSON einmalig (gecacht), setzt window.FT_FUNDE auf
     das .funde-Array und ruft cb(funde) auf. Jede Seite hängt ihre Render-Logik
     an FT.ready statt direkt an DOMContentLoaded.
     Lokale Vorschau: über einen HTTP-Server testen, nicht file:// (fetch). */
  var _fundePromise = null;
  function loadFunde() {
    if (_fundePromise) return _fundePromise;
    _fundePromise = (typeof fetch === "function"
      ? fetch("data/funds.json", { cache: "no-cache" })
          .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
          .then(function (data) {
            var funde = (data && Array.isArray(data.funde)) ? data.funde : [];
            window.FT_FUNDE = funde;
            return funde;
          })
      : Promise.reject(new Error("no fetch"))
    ).catch(function (err) {
      // Graceful: ohne Funde weiterlaufen (z. B. file://) — Seiten zeigen leere
      // Listen statt zu brechen. Konsolen-Hinweis für lokale Entwicklung.
      if (window.console && console.warn) console.warn("[ft-shell] funds.json nicht ladbar — lokal über HTTP-Server testen, nicht file://. (" + err.message + ")");
      window.FT_FUNDE = window.FT_FUNDE || [];
      return window.FT_FUNDE;
    });
    return _fundePromise;
  }

  /* ---- Öffentliches API ---- */
  window.FT = {
    NAV: NAV, SCHULE: SCHULE,
    funde: function () { return window.FT_FUNDE || []; },
    stimmen: function () { return window.FT_STIMMEN || []; },
    esc: esc, accentFor: accentFor, schuleLabel: schuleLabel, kuratorin: kuratorin,
    imgSrcset: imgSrcset,
    fundCardHTML: fundCardHTML,
    fundById: function (id) { return (window.FT_FUNDE || []).filter(function (f) { return f.objekt_id === id; })[0] || null; },
    renderFunds: function (el, list) {
      if (!el) return;
      el.innerHTML = (list || []).map(fundCardHTML).join("");
    },
    /* ready(cb): lädt data/funds.json, setzt FT_FUNDE, ruft cb(funde) auf.
       Gibt das Promise zurück (mehrfach aufrufbar, lädt nur einmal). */
    ready: function (cb) {
      var p = loadFunde();
      if (typeof cb === "function") p.then(function (funde) { cb(funde); });
      return p;
    },
    setTheme: setTheme, getTheme: getTheme,
    qs: function (k) { return new URLSearchParams(location.search).get(k); }
  };

  /* ---- Mount ---- */
  function mount() {
    setTheme(getTheme());
    var page = document.body.getAttribute("data-page") || "";
    // Header + Sheet vorne, Footer hinten — sofern nicht per data-no-shell abgewählt
    if (!document.body.hasAttribute("data-no-shell")) {
      document.body.insertBefore(buildSheet(page), document.body.firstChild);
      document.body.insertBefore(buildHeader(page), document.body.firstChild);
      var skip = document.createElement("a");
      skip.className = "skip-link"; skip.href = "#main"; skip.textContent = "Zum Inhalt springen";
      document.body.insertBefore(skip, document.body.firstChild);
      document.body.appendChild(buildFooter());
    }
    wireSheet();
    wireTheme();
    document.dispatchEvent(new CustomEvent("ft:shell-ready"));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
