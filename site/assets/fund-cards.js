/* ============================================================================
   fund-cards.js — DIE EINE Karten-Render-Funktion für futuresthinking.eu.
   Wird von ZWEI Oberflächen genutzt:
     1) funde.html         (fetch data/funds.json → renderFundCard)
     2) index.html (mobil)  (SEED_FUNDE inline → renderFundCard, offline-fähig)
   Kein zweites Template, kein Fork. Tokens: --ft-* (in den HTML-Dateien definiert).

   Achsen-Sprache (PROB/WUNSCH/axesOf), STIMMEN-Sätze und die Hash-Logik sind
   1:1 aus index.html gespiegelt — gleiche Labels, gleiche Glyphen, gleicher Satz
   pro Fund (deterministisch aus objekt_id). So driftet nichts zwischen Graph,
   Inspector und Karten.
   ============================================================================ */
(function (global) {
  'use strict';

  /* ---- Achsen-Sprache (identisch zu index.html: WUNSCH/PROB/axesOf) ---- */
  var WUNSCH = {
    wuenschenswert: { label: 'wünschenswert',   chip: 'chip--wuenschenswert' },
    neutral:        { label: 'neutral',         chip: 'chip--neutral' },
    nicht:          { label: 'nicht erwünscht', chip: 'chip--nicht' }
  };
  var PROB = {
    moeglich:       { label: 'möglich',       chip: 'chip--moeglich' },
    plausibel:      { label: 'plausibel',     chip: 'chip--plausibel' },
    wahrscheinlich: { label: 'wahrscheinlich', chip: 'chip--wahrscheinlich' }
  };
  /* Legacy cone_position → zwei Achsen (für Funde, die nur cone_position tragen) */
  var CONE_TO_AXES = {
    moeglich:       { wahrscheinlichkeit: 'moeglich',       wuenschbarkeit: 'neutral' },
    plausibel:      { wahrscheinlichkeit: 'plausibel',      wuenschbarkeit: 'neutral' },
    wahrscheinlich: { wahrscheinlichkeit: 'wahrscheinlich', wuenschbarkeit: 'neutral' },
    wuenschenswert: { wahrscheinlichkeit: 'plausibel',      wuenschbarkeit: 'wuenschenswert' },
    nicht:          { wahrscheinlichkeit: 'plausibel',      wuenschbarkeit: 'nicht' }
  };
  /* Ein Pfad: funds.json liefert beide Achsen direkt; SEED_FUNDE-Altfälle füllen
     fehlende Achsen aus cone_position auf. */
  function axesOf(f) {
    var w = f.wuenschbarkeit, p = f.wahrscheinlichkeit;
    if (!w || !p) {
      var d = CONE_TO_AXES[f.cone_position] || CONE_TO_AXES.plausibel;
      w = w || d.wuenschbarkeit; p = p || d.wahrscheinlichkeit;
    }
    return {
      wunsch: WUNSCH[w] || WUNSCH.neutral,
      prob:   PROB[p]   || PROB.plausibel,
      wKey: w, pKey: p
    };
  }

  /* ---- Schulen: feste Reihenfolge, Slug-Liste, Token-Alias, Label, Zukünftin ---- */
  var SCHULE_ORDER = [
    'systemisch', 'kritisch-normativ', 'kulturell-narrativ',
    'partizipativ', 'design-futures', 'oekologisch'
  ];
  /* STIMMEN — schoolLabel, Zukünftin-Name + 8er Aufnahme-Satz-Pool je Schule.
     1:1 aus index.html (STIMMEN-Objekt) übernommen. Accent-FARBE kommt NICHT
     von hier, sondern aus var(--ft-schule-<slug>) — so kann Iris den Token ändern,
     ohne dass der Bau bricht (E5). */
  var STIMMEN = {
    'systemisch': {
      name: 'Noor', schoolLabel: 'Systemisch',
      saetze: [
        "Aufgenommen. An diesem Stück hängt mehr, als es zeigt.",
        "Ich lege das zu den anderen. Ein Faden, der woanders weiterläuft.",
        "Notiert. Wer das anfasste, veränderte ohne es zu merken auch das Nächste.",
        "Hier ist sichtbar, wie eine kleine Stelle das Ganze verschiebt — selten, dass jemand sie findet.",
        "Angenommen. Ich sehe schon, wo es zurückwirkt.",
        "Das gehört hierher. Ursache und Folge liegen weiter auseinander, als man denkt.",
        "Verwahrt. Ein Muster, das sich erst über die Zeit liest, nicht im Moment.",
        "Ich nehme es. Zwei Dinge, die niemand zusammen sah, berühren sich hier."
      ]
    },
    'kritisch-normativ': {
      name: 'Amani', schoolLabel: 'Kritisch-Normativ',
      saetze: [
        "Aufgenommen. Ich vermerke, wer in diesem Fund vorkommt — und an wem er vorbeigeht.",
        "Dieser Fund ist im Archiv. Bevor er gewinnt, frage ich, wer dafür verloren hat.",
        "Angenommen. Jede Zukunft hat eine Rechnung; ich notiere, wer sie hier begleicht.",
        "Eingeordnet. Ich halte fest, wessen Stimme dieses Artefakt trägt und wessen es übergeht.",
        "Aufgenommen. Eine Vision ist hier formuliert — ich prüfe, für wen sie eingelöst wird.",
        "Dieser Fund liegt nun bei mir. Ich frage nach der Annahme darunter: Wer durfte sie setzen?",
        "Angenommen. Ich vermerke die Asymmetrie, die dieses Artefakt mitbringt, auch wenn es sie nicht nennt.",
        "Eingeordnet. Was hier als selbstverständlich gilt, war für jemanden eine Entscheidung — ich halte fest, für wen."
      ]
    },
    'kulturell-narrativ': {
      name: 'Tomek', schoolLabel: 'Kulturell-Narrativ',
      saetze: [
        "Aufgenommen. Dieser Fund trägt eine Erzählung, und Erzählungen überdauern länger als die Dinge, von denen sie handeln.",
        "Verzeichnet. Ich höre die Stimmen einer Gemeinschaft darin, die sich ihre Zukunft erzählt hat — sie bleiben hier hörbar.",
        "Angenommen. In diesem Fund steckt ein Bild von morgen, das jemand für wichtig genug hielt, es weiterzugeben.",
        "Aufgenommen. Er klingt nach einem alten Mythos in neuer Form. Ich lege ihn zu den anderen wiederkehrenden Geschichten.",
        "Eingeordnet. Was hier festgehalten wurde, ist die Art, wie Menschen einer Zeit sich gegenseitig vom Kommenden berichtet haben.",
        "Verzeichnet. Dieser Fund spricht von einer Hoffnung — oder einer Warnung —, die eine Gruppe miteinander geteilt hat. Beides hat hier Platz.",
        "Angenommen. Ich lese darin, woran eine Gemeinschaft glaubte, als sie an morgen dachte. Das bewahre ich, ohne es glattzubügeln.",
        "Aufgenommen. Geschichten reisen weiter als ihre Erzähler. Diese hier reist nun mit dem Archiv."
      ]
    },
    'partizipativ': {
      name: 'Gabriel', schoolLabel: 'Transformativ-Partizipativ',
      saetze: [
        "Aufgenommen. An diesem Fund haben mehrere Hände gearbeitet — das sieht man ihm an, und das ist sein Wert.",
        "Dieser Fund kommt aus einer Gemeinschaft, die nicht gewartet hat. Er bleibt hier, mit den Spuren derer, die ihn gemacht haben.",
        "Notiert und eingeordnet. Hier steht ein Beleg dafür, dass Betroffene zu denen wurden, die das Problem lösten.",
        "Ich nehme diesen Fund ins Archiv. Er gehört nicht einer Person, sondern allen, die daran beteiligt waren.",
        "Angenommen. Was hier gefunden wurde, ist gemeinsam entstanden — und genau so wird es verwahrt.",
        "Dieser Fund zeigt eine Zukunft, die Menschen selbst gemacht haben, statt sie sich machen zu lassen. Er hat seinen Platz.",
        "Eingetragen. Ich lege ihn zu den anderen, die aus geteilter Arbeit kamen — Werkstatt, nicht Auftrag.",
        "Aufgenommen und festgehalten. An diesem Stück hängen viele; das Archiv bewahrt sie mit."
      ]
    },
    'design-futures': {
      name: 'Yuki', schoolLabel: 'Design Futures',
      saetze: [
        "Aufgenommen. Die Kanten sind weich, da hat eine Hand jahrelang an derselben Stelle gegriffen — wer auch immer das war, hatte es eilig.",
        "In den Bestand. Auf der Rückseite klebt noch ein halb abgezogenes Etikett; die Pfandziffer darunter kenne ich nicht.",
        "Ich lege es zu den anderen. Das Material ist warm, ohne dass es warm sein dürfte — ich notiere es und frage nicht weiter.",
        "Angenommen. Eine Reparaturnaht läuft quer über die Naht von vorher; hier wurde geflickt, was schon einmal geflickt war.",
        "Verzeichnet. Der Aufdruck ist in einer Sprache, die fast Deutsch ist, und die Maßeinheit kenne ich nicht — ich übernehme sie unkommentiert.",
        "Es bleibt hier. Innen sitzt Staub, der nicht von hier ist, feiner als unserer, und ein Fingerabdruck, der nicht meiner ist.",
        "Aufgenommen. Es klappert leise, wenn man es kippt — etwas Loses, das hineingehört, aber sich nicht zeigt.",
        "In die Sammlung. Jemand hat mit Stift eine Uhrzeit auf den Boden geschrieben und wieder durchgestrichen; der Rest des Tages fehlt."
      ]
    },
    'oekologisch': {
      name: 'Solveig', schoolLabel: 'Ökologisch-Planetar',
      saetze: [
        "Dieser Fund ist aufgenommen. Er bleibt innerhalb der Grenzen — das ist selten genug, um verwahrt zu werden.",
        "Ich nehme ihn an. Was er fordert, gibt die Erde noch her; das habe ich geprüft.",
        "Aufgenommen. Er rechnet die Ungeborenen mit, nicht nur die Lebenden. So gehört es sich.",
        "Dieser Fund findet seinen Platz bei mir. Er verbraucht nicht, was anderen nach ihm zusteht.",
        "Ich verwahre ihn. Er hat keine Eile — er rechnet in Jahrzehnten, nicht in Quartalen.",
        "Angenommen. Er nimmt von der Erde nur, was sie nachgibt, und nicht ihren Vorrat.",
        "Dieser Fund bleibt. Er trägt seine Kosten selbst und schiebt sie nicht den Späteren zu.",
        "Ich nehme ihn auf. Er ist von der Grenze her gedacht, nicht gegen sie — daran erkenne ich ihn."
      ]
    }
  };

  /* gültige Methoden-Anker auf methoden.html (JSON-Wert == id, 1:1). */
  var METHODEN_IDS = {
    'futures-literacy': 1, 'futures-cone': 1, 'szenariotechnik': 1, 'cla': 1,
    'three-horizons': 1, 'backcasting': 1, 'steep': 1, 'delphi': 1,
    'cross-impact': 1, 'wildcards': 1, 'visioning': 1, 'zukunftswerkstatt': 1,
    'four-futures': 1, 'design-fiction': 1, 'futures-triangle': 1,
    'megatrends': 1, 'horizon-scanning': 1
  };
  var METHODEN_LABEL = {
    'futures-literacy': 'Futures Literacy', 'futures-cone': 'Futures Cone',
    'szenariotechnik': 'Szenariotechnik', 'cla': 'Causal Layered Analysis',
    'three-horizons': 'Three Horizons', 'backcasting': 'Backcasting',
    'steep': 'STEEP', 'delphi': 'Delphi-Methode', 'cross-impact': 'Cross-Impact-Analyse',
    'wildcards': 'Wild Cards', 'visioning': 'Visioning', 'zukunftswerkstatt': 'Zukunftswerkstatt',
    'four-futures': 'Four Futures', 'design-fiction': 'Design Fiction',
    'futures-triangle': 'Futures Triangle', 'megatrends': 'Megatrends / Trendanalyse',
    'horizon-scanning': 'Horizon Scanning'
  };

  /* ---- Helfer ---- */
  function schuleColorVar(slug) {
    return SCHULE_ORDER.indexOf(slug) >= 0
      ? 'var(--ft-schule-' + slug + ')'
      : 'var(--ft-muted)';
  }
  function schuleLabel(slug) {
    return (STIMMEN[slug] && STIMMEN[slug].schoolLabel) || slug;
  }
  function zukuenftin(slug) {
    return (STIMMEN[slug] && STIMMEN[slug].name) || null;
  }
  /* deterministisch: Summe der Zeichencodes der objekt_id modulo 8 — identisch
     zur index.html-Logik. Derselbe Fund bekommt immer denselben Satz. */
  function hashIndex(id) {
    var sum = 0, s = String(id || '');
    for (var i = 0; i < s.length; i++) sum += s.charCodeAt(i);
    return sum % 8;
  }
  function aufnahmeSatz(f) {
    var s = f.schule && STIMMEN[f.schule];
    if (!s) return null;
    return s.saetze[hashIndex(f.objekt_id)];
  }
  function methodLabel(slug) {
    return METHODEN_LABEL[slug] || slug;
  }
  function esc(str) {
    var d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  /* ============================================================================
     renderFundCard(fund) → DOM-Knoten. Die EINE Markup-Quelle.
     ========================================================================== */
  function renderFundCard(f) {
    var ax = axesOf(f);
    var slug = f.schule || null;
    var cVar = schuleColorVar(slug);
    var hasSchule = !!(slug && STIMMEN[slug]);
    var voiceName = hasSchule ? zukuenftin(slug) : null;

    var art = document.createElement('article');
    art.className = 'fund-card';
    art.id = 'fund-' + f.objekt_id;
    art.style.setProperty('--c', cVar);

    var detailId = 'detail-' + f.objekt_id;

    /* ---------- BILD (optional, Banner oben) ---------- */
    if (f.bild && f.bild.src) {
      var media = document.createElement('figure');
      media.className = 'fund-card__media';
      var img = document.createElement('img');
      img.className = 'fund-card__img';
      img.src = f.bild.src;                 // root-relativ: bilder/<slug>.<webp|png|svg>
      img.alt = f.bild.alt || (f.objektname || '');
      img.loading = 'lazy';
      img.decoding = 'async';
      if (f.bild.width)  img.width = f.bild.width;
      if (f.bild.height) img.height = f.bild.height;
      media.appendChild(img);
      art.appendChild(media);
    }

    /* ---------- KOPF ---------- */
    var head = document.createElement('div');
    head.className = 'fund-card__head';
    var tb = document.createElement('div');
    tb.className = 'fund-card__titleblock';
    var h3 = document.createElement('h3');
    h3.className = 'fund-card__title';
    h3.textContent = f.objektname || '(ohne Titel)';
    var prov = document.createElement('p');
    prov.className = 'fund-card__provenance';
    prov.textContent = f.fundjahr + ' · ' + (f.fundort || '');
    tb.appendChild(h3); tb.appendChild(prov);
    var year = document.createElement('span');
    year.className = 'fund-card__year';
    year.textContent = f.fundjahr;
    head.appendChild(tb); head.appendChild(year);
    art.appendChild(head);

    /* ---------- ACHSEN-CHIPS (Wahrscheinlichkeit zuerst, dann Wünschbarkeit) ---------- */
    var axes = document.createElement('div');
    axes.className = 'fund-card__axes';
    var cP = document.createElement('span');
    cP.className = 'chip ' + ax.prob.chip;
    cP.textContent = ax.prob.label;
    cP.setAttribute('title', 'Wahrscheinlichkeit: ' + ax.prob.label);
    var cW = document.createElement('span');
    cW.className = 'chip ' + ax.wunsch.chip;
    cW.textContent = ax.wunsch.label;
    cW.setAttribute('title', 'Wünschbarkeit: ' + ax.wunsch.label);
    axes.appendChild(cP); axes.appendChild(cW);
    art.appendChild(axes);

    /* ---------- SCHULE + PUNKT + ZUKÜNFTIN (+ Tonalität inline) ---------- */
    if (hasSchule) {
      var sch = document.createElement('div');
      sch.className = 'fund-card__schule';
      var dot = document.createElement('span');
      dot.className = 'fund-card__dot';
      dot.setAttribute('aria-hidden', 'true');
      var lbl = document.createElement('span');
      lbl.className = 'fund-card__schule-lbl';
      lbl.textContent = schuleLabel(slug) + ' · ' + voiceName;
      sch.appendChild(dot); sch.appendChild(lbl);
      if (f.tonalitaet) {
        var tone = document.createElement('span');
        tone.className = 'fund-card__tone';
        tone.textContent = 'tonalität: ' + f.tonalitaet;
        sch.appendChild(tone);
      }
      art.appendChild(sch);
    } else if (f.tonalitaet) {
      /* kein schule → Tonalität trotzdem als ruhiger Mono-Tag */
      var schT = document.createElement('div');
      schT.className = 'fund-card__schule fund-card__schule--noschool';
      var toneOnly = document.createElement('span');
      toneOnly.className = 'fund-card__tone';
      toneOnly.textContent = 'tonalität: ' + f.tonalitaet;
      schT.appendChild(toneOnly);
      art.appendChild(schT);
    }

    /* ---------- METHODEN-LINK (Degrade zu Plaintext, falls Anker fehlt) ---------- */
    if (f.entstehungsmethode) {
      var m = f.entstehungsmethode;
      if (METHODEN_IDS[m]) {
        var a = document.createElement('a');
        a.className = 'fund-card__method';
        a.href = 'methoden.html#' + m;
        a.innerHTML = 'geborgen mit ' + esc(methodLabel(m)) + ' <span aria-hidden="true">↗</span>';
        art.appendChild(a);
      } else {
        var sp = document.createElement('span');
        sp.className = 'fund-card__method fund-card__method--plain';
        sp.textContent = 'geborgen mit ' + methodLabel(m);
        art.appendChild(sp);
      }
    }

    /* ---------- TOGGLE ---------- */
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fund-card__more';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', detailId);
    btn.innerHTML = 'beipackzettel lesen <span class="fund-card__caret" aria-hidden="true">▾</span>';
    art.appendChild(btn);

    /* ---------- DETAIL (Accordion-Inhalt) ---------- */
    var detail = document.createElement('div');
    detail.className = 'fund-card__detail';
    detail.id = detailId;
    detail.hidden = true;

    var inner = document.createElement('div');
    inner.className = 'fund-card__detail-inner';

    /* 1 · BEIPACKZETTEL (Herzstück, Mono) */
    var zettel = document.createElement('div');
    zettel.className = 'fund-card__zettel';
    var zEye = document.createElement('span');
    zEye.className = 'eyebrow';
    zEye.textContent = 'beipackzettel';
    var zP = document.createElement('p');
    zP.className = 'beipackzettel';
    zP.textContent = (f.beipackzettel || '').trim();
    zettel.appendChild(zEye); zettel.appendChild(zP);
    inner.appendChild(zettel);

    /* 2 · STIMME (nur falls schule, Body-Italic, NICHT Mono) */
    if (hasSchule) {
      var voice = document.createElement('div');
      voice.className = 'fund-card__voice';
      var vEye = document.createElement('span');
      vEye.className = 'eyebrow fund-card__voice-eyebrow';
      vEye.innerHTML = '<span class="fund-card__voice-dot" aria-hidden="true"></span>' +
        esc(voiceName) + ' nimmt auf:';
      var vLine = document.createElement('p');
      vLine.className = 'fund-card__voice-line';
      vLine.textContent = aufnahmeSatz(f);
      voice.appendChild(vEye); voice.appendChild(vLine);
      inner.appendChild(voice);
    }

    /* 3 · FACTS (Definition-Liste, nur vorhandene Felder) */
    var factsList = [];
    if (f.urheber)  factsList.push(['urheber', f.urheber, null]);
    if (f.material) factsList.push(['material', f.material, null]);
    if (f.lizenz) {
      var lizUrl = /^https?:\/\//.test(f.lizenz)
        ? f.lizenz
        : (/CC-BY-NC/i.test(f.lizenz) ? 'https://creativecommons.org/licenses/by-nc/4.0/deed.de' : null);
      factsList.push(['lizenz', f.lizenz, lizUrl]);
    }
    if (factsList.length) {
      var facts = document.createElement('dl');
      facts.className = 'fund-card__facts';
      factsList.forEach(function (row) {
        var dt = document.createElement('dt');
        dt.textContent = row[0];
        var dd = document.createElement('dd');
        if (row[2]) {
          var la = document.createElement('a');
          la.href = row[2]; la.target = '_blank'; la.rel = 'license noopener';
          la.textContent = row[1];
          dd.appendChild(la);
        } else {
          dd.textContent = row[1];
        }
        facts.appendChild(dt); facts.appendChild(dd);
      });
      inner.appendChild(facts);
    }

    detail.appendChild(inner);
    art.appendChild(detail);

    /* ---------- Accordion-Verhalten ---------- */
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      setOpen(!open);
    });
    function setOpen(open) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.innerHTML = (open ? 'beipackzettel schließen ' : 'beipackzettel lesen ') +
        '<span class="fund-card__caret" aria-hidden="true">' + (open ? '▴' : '▾') + '</span>';
      if (open) {
        detail.hidden = false;
        // max-height-Transition: erst auf scrollHeight, dann auf none nach Ende
        detail.style.maxHeight = detail.scrollHeight + 'px';
        var done = function () {
          detail.style.maxHeight = 'none';
          detail.removeEventListener('transitionend', done);
        };
        if (prefersReducedMotion()) { detail.style.maxHeight = 'none'; }
        else { detail.addEventListener('transitionend', done); }
      } else {
        // von auto/none zurück auf gemessene Höhe, dann auf 0
        detail.style.maxHeight = detail.scrollHeight + 'px';
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { detail.style.maxHeight = '0px'; });
        });
        var hide = function () {
          detail.hidden = true;
          detail.removeEventListener('transitionend', hide);
        };
        if (prefersReducedMotion()) { detail.hidden = true; }
        else { detail.addEventListener('transitionend', hide); }
      }
    }
    /* zur Wiederverwendung von außen (z.B. Deep-Link-Auto-Expand, Phase 2) */
    art._fundSetOpen = setOpen;

    return art;
  }

  function prefersReducedMotion() {
    return global.matchMedia &&
      global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ---- Gruppieren / Sortieren (für Toggle sternbild ↔ zeit) ---- */
  function sortByYear(funde) {
    return funde.slice().sort(function (a, b) {
      if (a.fundjahr !== b.fundjahr) return a.fundjahr - b.fundjahr;
      return String(a.objekt_id).localeCompare(String(b.objekt_id));
    });
  }
  function groupBySchule(funde) {
    var bySlug = {};
    SCHULE_ORDER.forEach(function (s) { bySlug[s] = []; });
    var ohne = [];
    funde.forEach(function (f) {
      if (f.schule && bySlug[f.schule]) bySlug[f.schule].push(f);
      else ohne.push(f);
    });
    var out = [];
    SCHULE_ORDER.forEach(function (s) {
      if (bySlug[s].length) out.push({ slug: s, funde: sortByYear(bySlug[s]) });
    });
    if (ohne.length) out.push({ slug: null, funde: sortByYear(ohne) });
    return out;
  }

  /* ---- Public API ---- */
  global.FundCards = {
    renderFundCard: renderFundCard,
    axesOf: axesOf,
    aufnahmeSatz: aufnahmeSatz,
    hashIndex: hashIndex,
    schuleColorVar: schuleColorVar,
    schuleLabel: schuleLabel,
    zukuenftin: zukuenftin,
    methodLabel: methodLabel,
    SCHULE_ORDER: SCHULE_ORDER,
    STIMMEN: STIMMEN,
    sortByYear: sortByYear,
    groupBySchule: groupBySchule
  };
})(window);
