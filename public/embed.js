(function () {
  "use strict";

  if (window.LanguagePlugin) return;

  var COOKIE_NAME = "lp_lang";
  var STORAGE_KEY = "language-plugin-pref";
  var CACHE_PREFIX = "lp-cache-v2-";
  var HOST_TAG = "language-plugin-widget";
  var PENDING_CLASS = "lp-pending";
  var MAX_HIDE_MS = 3000;
  var BATCH_SIZE = 35;
  var PARALLEL_REQUESTS = 4;
  var REFETCH_INTERVAL_MS = 3000;
  var DEFAULT_API_URL = "https://language-plugin-b251c.web.app/api/translate";
  var SKIP_SELECTOR =
    "script,style,noscript,template,textarea,code,svg,iframe,[translate='no'],.notranslate," + HOST_TAG;
  var ATTR_TARGETS = [
    ["[title]", "title"],
    ["[alt]", "alt"],
    ["[placeholder]", "placeholder"],
    ["[aria-label]", "aria-label"],
    ["input[type='submit'][value],input[type='button'][value],input[type='reset'][value]", "value"],
  ];

  var LANGUAGES = [
    { code: "en", label: "English", native: "English" },
    { code: "ta", label: "Tamil", native: "தமிழ்" },
    { code: "hi", label: "Hindi", native: "हिन्दी" },
    { code: "ml", label: "Malayalam", native: "മലയാളം" },
    { code: "te", label: "Telugu", native: "తెలుగు" },
    { code: "kn", label: "Kannada", native: "ಕನ್ನಡ" },
  ];

  var script = document.currentScript;
  var config = window.LanguagePluginConfig || {};
  var apiUrl =
    config.apiUrl || (script && script.getAttribute("data-api-url")) || apiUrlFromScript() || DEFAULT_API_URL;

  function apiUrlFromScript() {
    if (!script || !script.src) return null;
    try {
      return new URL(script.src, location.href).origin + "/api/translate";
    } catch (e) {
      return null;
    }
  }

  var state = {
    open: false,
    busy: false,
    current: "en",
    shown: "en",
  };

  var ui = {};
  var runId = 0;
  var applying = false;
  var observer = null;
  var refetchTimer = null;
  var lastRefetch = 0;
  var memCache = {};

  var textOriginals = new WeakMap();
  var textApplied = new WeakMap();
  var attrState = new WeakMap();
  var titleState = null;
  var originalLang = document.documentElement.getAttribute("lang");

  function isSupported(code) {
    return LANGUAGES.some(function (l) {
      return l.code === code;
    });
  }

  function lookup(map, key) {
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
  }

  function readCookie() {
    try {
      var match = document.cookie.match(new RegExp("(?:^|;\\s*)" + COOKIE_NAME + "=([^;]*)"));
      return match ? decodeURIComponent(match[1]) : null;
    } catch (e) {
      return null;
    }
  }

  function readPref() {
    var code = readCookie();
    if (!code) {
      try {
        code = localStorage.getItem(STORAGE_KEY);
      } catch (e) {}
    }
    return code && isSupported(code) ? code : "en";
  }

  function savePref(code) {
    var secure = location.protocol === "https:" ? "; Secure" : "";
    try {
      document.cookie =
        COOKIE_NAME + "=" + encodeURIComponent(code) + "; Max-Age=31536000; Path=/; SameSite=Lax" + secure;
    } catch (e) {}
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch (e) {}
  }

  function cacheFor(language) {
    if (!memCache[language]) {
      try {
        memCache[language] = JSON.parse(localStorage.getItem(CACHE_PREFIX + language) || "{}");
      } catch (e) {
        memCache[language] = {};
      }
    }
    return memCache[language];
  }

  function clearStoredCaches() {
    try {
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var key = localStorage.key(i);
        if (key && key.indexOf("lp-cache") === 0) localStorage.removeItem(key);
      }
    } catch (e) {}
  }

  function saveCache(language, fresh) {
    var map = cacheFor(language);
    Object.keys(fresh).forEach(function (key) {
      map[key] = fresh[key];
    });
    try {
      localStorage.setItem(CACHE_PREFIX + language, JSON.stringify(map));
    } catch (e) {
      clearStoredCaches();
      try {
        localStorage.setItem(CACHE_PREFIX + language, JSON.stringify(fresh));
      } catch (e2) {}
    }
  }

  function hidePage() {
    var style = document.createElement("style");
    style.textContent = "html." + PENDING_CLASS + " body{visibility:hidden!important}";
    (document.head || document.documentElement).appendChild(style);
    document.documentElement.classList.add(PENDING_CLASS);
    setTimeout(revealPage, MAX_HIDE_MS);
  }

  function revealPage() {
    document.documentElement.classList.remove(PENDING_CLASS);
  }

  var initialLang = readPref();
  if (initialLang !== "en") hidePage();

  function keyOf(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function isTranslatable(key) {
    return key.length >= 2 && key.length <= 2000 && /[A-Za-z]/.test(key);
  }

  function skip(el) {
    return !el || !!el.closest(SKIP_SELECTOR) || el.isContentEditable === true;
  }

  function originalText(node) {
    if (textOriginals.has(node)) {
      var current = node.nodeValue;
      if (current === textApplied.get(node) || current === textOriginals.get(node)) {
        return textOriginals.get(node);
      }
      textOriginals.delete(node);
      textApplied.delete(node);
    }
    return node.nodeValue;
  }

  function writeText(node, value) {
    if (node.nodeValue !== value) node.nodeValue = value;
    textApplied.set(node, value);
  }

  function originalAttr(el, name) {
    var current = el.getAttribute(name);
    var bag = attrState.get(el);
    var entry = bag && bag[name];
    if (entry) {
      if (current === entry.applied || current === entry.orig) return entry.orig;
      delete bag[name];
    }
    return current;
  }

  function originalTitle() {
    var current = document.title;
    if (titleState && (current === titleState.applied || current === titleState.orig)) return titleState.orig;
    titleState = null;
    return current;
  }

  function addTextSlot(slots, node) {
    if (!node.nodeValue || !node.nodeValue.trim() || skip(node.parentElement)) return;
    var original = originalText(node);
    var key = keyOf(original);
    if (!isTranslatable(key)) return;
    var leading = original.match(/^\s*/)[0];
    var trailing = original.match(/\s*$/)[0];
    slots.push({
      key: key,
      apply: function (tr) {
        if (tr === null) {
          if (textOriginals.has(node)) writeText(node, original);
          return;
        }
        textOriginals.set(node, original);
        writeText(node, leading + tr + trailing);
      },
    });
  }

  function addAttrSlot(slots, el, name) {
    if (skip(el)) return;
    var original = originalAttr(el, name);
    if (!original) return;
    var key = keyOf(original);
    if (!isTranslatable(key)) return;
    slots.push({
      key: key,
      apply: function (tr) {
        var bag = attrState.get(el);
        if (tr === null) {
          if (bag && bag[name]) {
            bag[name].applied = original;
            el.setAttribute(name, original);
          }
          return;
        }
        if (!bag) {
          bag = {};
          attrState.set(el, bag);
        }
        bag[name] = { orig: original, applied: tr };
        if (el.getAttribute(name) !== tr) el.setAttribute(name, tr);
      },
    });
  }

  function addTitleSlot(slots) {
    var original = originalTitle();
    var key = keyOf(original || "");
    if (!isTranslatable(key)) return;
    slots.push({
      key: key,
      apply: function (tr) {
        var value = tr === null ? original : tr;
        titleState = { orig: original, applied: value };
        if (document.title !== value) document.title = value;
      },
    });
  }

  function collectSlots(roots) {
    var slots = [];
    (roots || [document.body]).forEach(function (root) {
      if (!root || !root.isConnected) return;
      if (root.nodeType === 3) {
        addTextSlot(slots, root);
        return;
      }
      if (root.nodeType !== 1) return;

      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) addTextSlot(slots, node);

      ATTR_TARGETS.forEach(function (target) {
        if (root.matches(target[0])) addAttrSlot(slots, root, target[1]);
        root.querySelectorAll(target[0]).forEach(function (el) {
          addAttrSlot(slots, el, target[1]);
        });
      });
    });
    if (!roots) addTitleSlot(slots);
    return slots;
  }

  function uniqueKeys(slots) {
    var seen = Object.create(null);
    var keys = [];
    slots.forEach(function (slot) {
      if (seen[slot.key]) return;
      seen[slot.key] = true;
      keys.push(slot.key);
    });
    return keys;
  }

  function applySlots(slots, map) {
    applying = true;
    try {
      slots.forEach(function (slot) {
        var tr = map ? lookup(map, slot.key) : undefined;
        slot.apply(tr === undefined || tr === slot.key ? null : tr);
      });
    } finally {
      if (observer) observer.takeRecords();
      applying = false;
    }
  }

  function setShown(language) {
    state.shown = language;
    var html = document.documentElement;
    if (language !== "en") html.setAttribute("lang", language);
    else if (originalLang === null) html.removeAttribute("lang");
    else html.setAttribute("lang", originalLang);
  }

  function chunk(arr, size) {
    var out = [];
    for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function runPool(items, limit, worker) {
    var index = 0;
    function next() {
      if (index >= items.length) return Promise.resolve();
      var item = items[index++];
      return worker(item).then(next);
    }
    var runners = [];
    for (var i = 0; i < Math.min(limit, items.length); i++) runners.push(next());
    return Promise.all(runners);
  }

  function postTranslate(language, texts) {
    return fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: language, texts: texts }),
    }).then(function (res) {
      if (!res.ok) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (err) {
            throw new Error(err.message || err.error || "HTTP " + res.status);
          });
      }
      return res.json();
    });
  }

  function translatePage(language) {
    var id = ++runId;
    var slots = collectSlots();
    var map = cacheFor(language);
    var keys = uniqueKeys(slots);
    var missing = keys.filter(function (key) {
      return lookup(map, key) === undefined;
    });

    if (missing.length === 0 || state.shown === "en" || state.shown === language) applySlots(slots, map);

    if (missing.length === 0) {
      setShown(language);
      state.busy = false;
      setStatus("Page translated.");
      revealPage();
      return Promise.resolve();
    }
    if (missing.length <= keys.length * 0.2) revealPage();

    state.busy = true;
    setStatus("Translating…", true);

    var batches = chunk(missing, BATCH_SIZE);
    var done = 0;

    return runPool(batches, PARALLEL_REQUESTS, function (batch) {
      return postTranslate(language, batch).then(function (data) {
        saveCache(language, data.translations || {});
        done++;
        if (id === runId && batches.length > 1) {
          setStatus("Translating… " + Math.round((done / batches.length) * 100) + "%", true);
        }
      });
    })
      .then(function () {
        if (id !== runId) return;
        applySlots(collectSlots(), cacheFor(language));
        setShown(language);
        setStatus("Page translated.");
      })
      .catch(function (err) {
        if (id !== runId) return;
        console.error("[Language Plugin] Translation failed:", err);
        setStatus("Couldn't translate right now. Please try again.");
      })
      .finally(function () {
        if (id !== runId) return;
        state.busy = false;
        revealPage();
      });
  }

  function restoreEnglish() {
    runId++;
    state.busy = false;
    applySlots(collectSlots(), null);
    setShown("en");
    setStatus("Showing original English.");
    revealPage();
  }

  function selectLanguage(code) {
    if (!isSupported(code) || !document.body) return;
    state.current = code;
    savePref(code);
    updateActiveButtons();
    if (code === "en") restoreEnglish();
    else translatePage(code);
  }

  function scheduleRefetch() {
    if (refetchTimer) return;
    var wait = Math.max(300, lastRefetch + REFETCH_INTERVAL_MS - Date.now());
    refetchTimer = setTimeout(function () {
      refetchTimer = null;
      if (state.current === "en") return;
      if (state.busy) {
        scheduleRefetch();
        return;
      }
      lastRefetch = Date.now();
      translatePage(state.current);
    }, wait);
  }

  function onMutations(records) {
    if (applying || state.current === "en") return;
    var roots = [];
    records.forEach(function (record) {
      if (record.type === "childList") {
        for (var i = 0; i < record.addedNodes.length; i++) roots.push(record.addedNodes[i]);
      } else {
        roots.push(record.target);
      }
    });
    var slots = collectSlots(roots);
    if (!slots.length) return;

    applySlots(slots, cacheFor(state.shown !== "en" ? state.shown : state.current));

    var currentMap = cacheFor(state.current);
    var hasMissing = slots.some(function (slot) {
      return lookup(currentMap, slot.key) === undefined;
    });
    if (hasMissing) scheduleRefetch();
  }

  function startObserver() {
    if (observer || typeof MutationObserver === "undefined") return;
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTR_TARGETS.map(function (target) {
        return target[1];
      }),
    });
  }

  var WIDGET_CSS =
    ":host{all:initial}" +
    "*{box-sizing:border-box}" +
    ".wrap{position:relative;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:400;font-style:normal;line-height:1.4;color:#0f172a;letter-spacing:normal;word-spacing:normal;text-transform:none;text-align:left;text-indent:0;white-space:normal;direction:ltr;visibility:visible}" +
    "button{font:inherit;letter-spacing:inherit;text-transform:inherit;margin:0}" +
    ".fab{width:56px;height:56px;padding:0;border-radius:50%;border:3px solid #fff;cursor:pointer;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;box-shadow:0 8px 28px rgba(37,99,235,.55),0 0 0 4px rgba(37,99,235,.2);display:flex;align-items:center;justify-content:center;transition:transform .15s ease;animation:pulse 2.5s ease-in-out infinite}" +
    ".fab:hover{transform:scale(1.06)}" +
    ".fab:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}" +
    "@keyframes pulse{0%,100%{box-shadow:0 8px 28px rgba(37,99,235,.55),0 0 0 4px rgba(37,99,235,.2)}50%{box-shadow:0 8px 28px rgba(37,99,235,.65),0 0 0 8px rgba(37,99,235,.12)}}" +
    ".panel{position:absolute;right:64px;top:50%;transform:translateY(-50%);min-width:210px;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(15,23,42,.18);padding:8px;display:none;border:1px solid #e2e8f0}" +
    ".panel.open{display:block;animation:slideIn .18s ease}" +
    "@keyframes slideIn{from{opacity:0;transform:translateY(-50%) translateX(8px)}to{opacity:1;transform:translateY(-50%) translateX(0)}}" +
    ".title{padding:8px 12px 4px;font-weight:600;font-size:13px}" +
    ".sub{padding:0 12px 8px;color:#64748b;font-size:12px}" +
    ".option{display:block;width:100%;text-align:left;padding:10px 12px;border:none;background:transparent;border-radius:8px;cursor:pointer;color:#0f172a;font-size:14px}" +
    ".option:hover{background:#f1f5f9}" +
    ".option.active{background:#eff6ff;color:#1d4ed8;font-weight:600}" +
    ".status{padding:6px 12px 10px;font-size:12px;color:#64748b;min-height:28px}" +
    ".spinner{display:inline-block;width:14px;height:14px;border:2px solid #cbd5e1;border-top-color:#2563eb;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px}" +
    "@keyframes spin{to{transform:rotate(360deg)}}";

  var GLOBE_SVG =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

  function setOpen(open) {
    state.open = open;
    if (!ui.panel) return;
    ui.panel.classList.toggle("open", open);
    ui.fab.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function setStatus(msg, loading) {
    if (!ui.status) return;
    ui.status.textContent = msg;
    if (loading) {
      var spinner = document.createElement("span");
      spinner.className = "spinner";
      ui.status.insertBefore(spinner, ui.status.firstChild);
    }
  }

  function updateActiveButtons() {
    (ui.options || []).forEach(function (btn) {
      var active = btn.getAttribute("data-code") === state.current;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function createUI() {
    var host = document.createElement(HOST_TAG);
    host.setAttribute("translate", "no");
    host.style.cssText =
      "all:initial!important;" +
      "position:fixed!important;right:16px!important;top:50%!important;left:auto!important;bottom:auto!important;" +
      "transform:translateY(-50%)!important;z-index:2147483646!important;display:block!important;" +
      "margin:0!important;padding:0!important;width:auto!important;height:auto!important;";
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

    root.innerHTML =
      "<style>" +
      WIDGET_CSS +
      "</style>" +
      '<div class="wrap">' +
      '<div class="panel" role="dialog" aria-label="Choose language">' +
      '<div class="title">Choose language</div>' +
      '<div class="sub">Page starts in English</div>' +
      '<div class="options"></div>' +
      '<div class="status" aria-live="polite"></div>' +
      "</div>" +
      '<button class="fab" type="button" title="Change language" aria-haspopup="true" aria-expanded="false" ' +
      'aria-label="Change language: Tamil, Hindi, Malayalam, Telugu, Kannada">' +
      GLOBE_SVG +
      "</button>" +
      "</div>";

    ui.host = host;
    ui.panel = root.querySelector(".panel");
    ui.fab = root.querySelector(".fab");
    ui.status = root.querySelector(".status");
    ui.options = [];

    var list = root.querySelector(".options");
    LANGUAGES.forEach(function (lang) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option";
      btn.setAttribute("data-code", lang.code);
      btn.textContent = lang.label + " (" + lang.native + ")";
      btn.addEventListener("click", function () {
        selectLanguage(lang.code);
      });
      list.appendChild(btn);
      ui.options.push(btn);
    });

    ui.fab.addEventListener("click", function () {
      setOpen(!state.open);
    });

    document.addEventListener("click", function (e) {
      if (state.open && !host.contains(e.target)) setOpen(false);
    });

    document.addEventListener("keydown", function (e) {
      if (state.open && e.key === "Escape") setOpen(false);
    });

    document.body.appendChild(host);
  }

  function init() {
    if (!document.body) return;
    createUI();
    state.current = initialLang;
    updateActiveButtons();
    startObserver();
    if (initialLang !== "en") translatePage(initialLang);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.LanguagePlugin = {
    setLanguage: selectLanguage,
    getLanguage: function () {
      return state.current;
    },
    refresh: function () {
      return state.current === "en" ? Promise.resolve() : translatePage(state.current);
    },
  };
})();
