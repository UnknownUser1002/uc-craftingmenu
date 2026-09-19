// ==UserScript==
// @name         Undercards Card Browser
// @namespace    undercards-card-browser
// @version      1.1.0
// @description  Floating, draggable, resizable, minimizable window showing the full Undercards card browser, with all assets cached locally (GM storage) after the first load for fast startup.
// @author       you
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @connect      raw.githubusercontent.com
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.3/umd/index.js
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ---- Configuration -----------------------------------------------------

    // Raw (not blob) URL to the zip. Update this if you move/rename the file.
    var ZIP_URL = 'https://raw.githubusercontent.com/UnknownUser1002/uc-craftingmenu/main/undertale-cards.zip';

    // Bump this to force everyone's cache to refresh on next load (e.g. after
    // you update the zip on GitHub). Old cache entries are simply ignored.
    var CACHE_VERSION = 1;
    var STORAGE_KEY = 'undercards_bundle_v' + CACHE_VERSION;

    // Paths inside the zip, relative to the zip root.
    var ROOT = 'undertale-cards/';
    var HTML_FILE = ROOT + 'Cards.html';

    var CSS_FILES = [
        ROOT + 'css/bootstrap.min.css',
        ROOT + 'css/bootstrap-dialog.min.css',
        ROOT + 'css/style.css',
        ROOT + 'css/cards.css',
        ROOT + 'css/frames.css',
        ROOT + 'css/crafting.css'
    ];

    var JS_FILES = [
        ROOT + 'js/jquery.min.js',
        ROOT + 'js/mobile.js',
        ROOT + 'js/popper.min.js',
        ROOT + 'js/tippy-bundle.iife.min.js',
        ROOT + 'js/jquery-i18n.min.js',
        ROOT + 'js/translation.js',
        ROOT + 'js/jquery-ui.min.js',
        ROOT + 'js/jquery.ui.touch-punch.min.js',
        ROOT + 'js/bootstrap.min.js',
        ROOT + 'js/bootstrap-dialog.min.js',
        ROOT + 'js/audio.js',
        ROOT + 'js/helper.js',
        ROOT + 'js/card.js',
        ROOT + 'js/filter.js',
        ROOT + 'js/dialog.js'
    ];

    var DATA_FILES = {
        allCards: ROOT + 'AllCards',
        version: ROOT + 'Version',
        translationEn: ROOT + 'translation/en.json'
    };

    // Fonts referenced via relative url('../fonts/X') in style.css/bootstrap.min.css.
    // A srcdoc iframe resolves relative paths against whatever host page it's embedded
    // in (not our assets), so these must be inlined as base64 data URIs instead.
    // Only fonts actually present in the zip and actually used are listed here.
    var FONT_FILES = {};
    FONT_FILES[ROOT + 'fonts/DTM-Mono.otf'] = 'font/opentype';
    FONT_FILES[ROOT + 'fonts/glyphicons-halflings-regular.woff2'] = 'font/woff2';
    FONT_FILES[ROOT + 'fonts/glyphicons-halflings-regular.ttf'] = 'font/ttf';

    var NEEDED_PATHS = CSS_FILES.concat(JS_FILES, [
        HTML_FILE, DATA_FILES.allCards, DATA_FILES.version, DATA_FILES.translationEn
    ], Object.keys(FONT_FILES));

    // ---- State ---------------------------------------------------------------

    var assembledHtml = null; // cached in-memory after first successful assembly this page load
    var WINDOW_PREFS_KEY = 'undercards_window_prefs'; // separate from the asset cache on purpose
    var MIN_WIDTH = 360;
    var MIN_HEIGHT = 280;

    // ---- UI: floating toggle button + overlay shell ---------------------------

    function injectShell() {
        var style = document.createElement('style');
        style.textContent =
            '#ucb-toggle-btn{position:fixed;bottom:20px;right:20px;z-index:2147483647;' +
            'width:48px;height:48px;border-radius:50%;background:#111;color:#fff;' +
            'border:2px solid #555;font-family:sans-serif;font-size:22px;cursor:pointer;' +
            'display:flex;align-items:center;justify-content:center;' +
            'box-shadow:0 2px 10px rgba(0,0,0,0.6);}' +
            '#ucb-toggle-btn:hover{background:#222;}' +
            '#ucb-overlay{position:fixed;z-index:2147483646;display:none;box-sizing:border-box;' +
            'flex-direction:column;background:#000;border:2px solid #444;border-radius:8px;' +
            'box-shadow:0 4px 30px rgba(0,0,0,0.8);overflow:hidden;}' +
            '#ucb-overlay.ucb-open{display:flex;}' +
            '#ucb-overlay.ucb-minimized{height:auto!important;}' +
            '#ucb-overlay.ucb-minimized #ucb-iframe-container,' +
            '#ucb-overlay.ucb-minimized #ucb-resize-handle{display:none;}' +
            '#ucb-overlay-header{display:flex;align-items:center;justify-content:space-between;' +
            'padding:6px 10px;background:#111;border-bottom:1px solid #444;' +
            'font-family:sans-serif;color:#ccc;font-size:13px;cursor:move;user-select:none;' +
            'flex-shrink:0;}' +
            '#ucb-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
            '#ucb-header-buttons{display:flex;gap:10px;flex-shrink:0;margin-left:10px;}' +
            '#ucb-header-buttons button{background:transparent;color:#fff;border:none;' +
            'font-size:15px;cursor:pointer;font-family:sans-serif;line-height:1;padding:2px 4px;}' +
            '#ucb-minimize-btn:hover{color:#6cf;}' +
            '#ucb-close-btn:hover{color:#f66;}' +
            '#ucb-iframe-container{flex:1;position:relative;min-height:0;}' +
            '#ucb-iframe-container iframe{position:absolute;inset:0;width:100%;height:100%;border:none;}' +
            '#ucb-status{color:#ccc;font-family:sans-serif;padding:40px;text-align:center;}' +
            '#ucb-overlay.ucb-minimized .ucb-resize-edge,' +
            '#ucb-overlay.ucb-minimized .ucb-resize-corner{display:none;}' +
            '.ucb-resize-edge{position:absolute;}' +
            '.ucb-resize-corner{position:absolute;width:14px;height:14px;z-index:1;}' +
            '#ucb-edge-n{top:0;left:8px;right:8px;height:6px;cursor:ns-resize;}' +
            '#ucb-edge-s{bottom:0;left:8px;right:8px;height:6px;cursor:ns-resize;}' +
            '#ucb-edge-e{top:8px;right:0;bottom:8px;width:6px;cursor:ew-resize;}' +
            '#ucb-edge-w{top:8px;left:0;bottom:8px;width:6px;cursor:ew-resize;}' +
            '#ucb-corner-nw{top:0;left:0;cursor:nwse-resize;}' +
            '#ucb-corner-ne{top:0;right:0;cursor:nesw-resize;}' +
            '#ucb-corner-sw{bottom:0;left:0;cursor:nesw-resize;}' +
            '#ucb-corner-se{bottom:0;right:0;cursor:nwse-resize;background:' +
            'linear-gradient(135deg,transparent 0%,transparent 50%,#666 50%,#666 60%,' +
            'transparent 60%,transparent 70%,#666 70%,#666 80%,transparent 80%);}' +
            '#ucb-drag-shield{position:fixed;inset:0;z-index:2147483647;display:none;cursor:inherit;}';
        document.head.appendChild(style);

        var btn = document.createElement('button');
        btn.id = 'ucb-toggle-btn';
        btn.title = 'Undercards Card Browser';
        btn.textContent = '\uD83C\uDCA0'; // 🂠 playing card symbol
        btn.addEventListener('click', toggleOverlay);
        document.body.appendChild(btn);

        var overlay = document.createElement('div');
        overlay.id = 'ucb-overlay';
        overlay.innerHTML =
            '<div id="ucb-overlay-header">' +
            '<span id="ucb-title">Undercards Card Browser</span>' +
            '<div id="ucb-header-buttons">' +
            '<button id="ucb-minimize-btn" title="Minimize">\u2500</button>' +
            '<button id="ucb-close-btn" title="Close">\u2715</button>' +
            '</div>' +
            '</div>' +
            '<div id="ucb-iframe-container"><div id="ucb-status">Loading card browser\u2026</div></div>' +
            '<div class="ucb-resize-edge" id="ucb-edge-n" data-dir="n" title="Resize"></div>' +
            '<div class="ucb-resize-edge" id="ucb-edge-s" data-dir="s" title="Resize"></div>' +
            '<div class="ucb-resize-edge" id="ucb-edge-e" data-dir="e" title="Resize"></div>' +
            '<div class="ucb-resize-edge" id="ucb-edge-w" data-dir="w" title="Resize"></div>' +
            '<div class="ucb-resize-corner" id="ucb-corner-nw" data-dir="nw" title="Resize"></div>' +
            '<div class="ucb-resize-corner" id="ucb-corner-ne" data-dir="ne" title="Resize"></div>' +
            '<div class="ucb-resize-corner" id="ucb-corner-sw" data-dir="sw" title="Resize"></div>' +
            '<div class="ucb-resize-corner" id="ucb-corner-se" data-dir="se" title="Resize"></div>';
        document.body.appendChild(overlay);

        // A full-viewport transparent shield, shown only while dragging/resizing, so
        // mouse events are captured by the parent page instead of being swallowed by
        // the iframe (which has its own separate document and would otherwise eat them).
        var shield = document.createElement('div');
        shield.id = 'ucb-drag-shield';
        document.body.appendChild(shield);

        applyWindowPrefs(overlay, loadWindowPrefs());

        overlay.querySelector('#ucb-close-btn').addEventListener('click', function () {
            overlay.classList.remove('ucb-open');
            btn.style.display = 'flex';
        });
        overlay.querySelector('#ucb-minimize-btn').addEventListener('click', function () {
            overlay.classList.toggle('ucb-minimized');
            saveWindowPrefs(overlay);
        });

        makeDraggable(overlay, overlay.querySelector('#ucb-overlay-header'), shield);
        Array.prototype.forEach.call(overlay.querySelectorAll('.ucb-resize-edge, .ucb-resize-corner'), function (handle) {
            makeResizable(overlay, handle, shield, handle.getAttribute('data-dir'));
        });
    }

    function defaultWindowPrefs() {
        var width = Math.min(900, window.innerWidth - 40);
        var height = Math.min(650, window.innerHeight - 40);
        return {
            left: Math.round((window.innerWidth - width) / 2),
            top: Math.round((window.innerHeight - height) / 2),
            width: width,
            height: height,
            minimized: false
        };
    }

    function loadWindowPrefs() {
        var raw = GM_getValue(WINDOW_PREFS_KEY, null);
        if (!raw) {
            return defaultWindowPrefs();
        }
        try {
            var prefs = JSON.parse(raw);
            // Clamp back on screen in case the browser window has shrunk since last time.
            prefs.width = Math.max(MIN_WIDTH, Math.min(prefs.width, window.innerWidth));
            prefs.height = Math.max(MIN_HEIGHT, Math.min(prefs.height, window.innerHeight));
            prefs.left = Math.max(-prefs.width + 100, Math.min(window.innerWidth - 100, prefs.left));
            prefs.top = Math.max(0, Math.min(window.innerHeight - 40, prefs.top));
            return prefs;
        } catch (e) {
            return defaultWindowPrefs();
        }
    }

    function saveWindowPrefs(overlay) {
        GM_setValue(WINDOW_PREFS_KEY, JSON.stringify({
            left: parseInt(overlay.style.left, 10) || 0,
            top: parseInt(overlay.style.top, 10) || 0,
            width: overlay.offsetWidth,
            height: overlay.offsetHeight,
            minimized: overlay.classList.contains('ucb-minimized')
        }));
    }

    function applyWindowPrefs(overlay, prefs) {
        overlay.style.left = prefs.left + 'px';
        overlay.style.top = prefs.top + 'px';
        overlay.style.width = prefs.width + 'px';
        overlay.style.height = prefs.height + 'px';
        overlay.classList.toggle('ucb-minimized', !!prefs.minimized);
    }

    function makeDraggable(overlay, handle, shield) {
        var dragging = false;
        var startX, startY, startLeft, startTop;

        handle.addEventListener('mousedown', function (e) {
            if (e.target.closest('button')) {
                return;
            }
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = overlay.offsetLeft;
            startTop = overlay.offsetTop;
            shield.style.display = 'block';
            shield.style.cursor = 'move';
            e.preventDefault();
        });

        document.addEventListener('mousemove', function (e) {
            if (!dragging) {
                return;
            }
            var newLeft = startLeft + (e.clientX - startX);
            var newTop = startTop + (e.clientY - startY);
            // Keep at least a corner of the header reachable even if dragged off-edge.
            newLeft = Math.max(-overlay.offsetWidth + 100, Math.min(window.innerWidth - 100, newLeft));
            newTop = Math.max(0, Math.min(window.innerHeight - 32, newTop));
            overlay.style.left = newLeft + 'px';
            overlay.style.top = newTop + 'px';
        });

        document.addEventListener('mouseup', function () {
            if (!dragging) {
                return;
            }
            dragging = false;
            shield.style.display = 'none';
            saveWindowPrefs(overlay);
        });
    }

    function makeResizable(overlay, handle, shield, dir) {
        var resizing = false;
        var startX, startY, startWidth, startHeight, startLeft, startTop;
        var cursor = getComputedStyle(handle).cursor;

        handle.addEventListener('mousedown', function (e) {
            resizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = overlay.offsetWidth;
            startHeight = overlay.offsetHeight;
            startLeft = overlay.offsetLeft;
            startTop = overlay.offsetTop;
            shield.style.display = 'block';
            shield.style.cursor = cursor;
            e.preventDefault();
            e.stopPropagation(); // don't also trigger the header's drag handler
        });

        document.addEventListener('mousemove', function (e) {
            if (!resizing) {
                return;
            }
            var dx = e.clientX - startX;
            var dy = e.clientY - startY;

            var newWidth = startWidth;
            var newLeft = startLeft;
            if (dir.indexOf('e') !== -1) {
                newWidth = Math.max(MIN_WIDTH, startWidth + dx);
            } else if (dir.indexOf('w') !== -1) {
                newWidth = Math.max(MIN_WIDTH, startWidth - dx);
                newLeft = startLeft + (startWidth - newWidth); // only move as far as we actually shrank
            }

            var newHeight = startHeight;
            var newTop = startTop;
            if (dir.indexOf('s') !== -1) {
                newHeight = Math.max(MIN_HEIGHT, startHeight + dy);
            } else if (dir.indexOf('n') !== -1) {
                newHeight = Math.max(MIN_HEIGHT, startHeight - dy);
                newTop = startTop + (startHeight - newHeight);
            }

            overlay.style.width = newWidth + 'px';
            overlay.style.height = newHeight + 'px';
            overlay.style.left = newLeft + 'px';
            overlay.style.top = newTop + 'px';
        });

        document.addEventListener('mouseup', function () {
            if (!resizing) {
                return;
            }
            resizing = false;
            shield.style.display = 'none';
            saveWindowPrefs(overlay);
        });
    }

    function toggleOverlay() {
        var overlay = document.getElementById('ucb-overlay');
        var btn = document.getElementById('ucb-toggle-btn');
        var opening = !overlay.classList.contains('ucb-open');
        overlay.classList.toggle('ucb-open');
        btn.style.display = opening ? 'none' : 'flex';
        if (!opening) {
            return;
        }

        if (assembledHtml) {
            mountIframe(assembledHtml);
            return;
        }

        setStatus('Loading card browser\u2026');
        getBundle(function (err, files) {
            if (err) {
                setStatus('Failed to load: ' + err);
                return;
            }
            try {
                assembledHtml = assembleHtml(files);
            } catch (e) {
                setStatus('Failed to assemble page: ' + e.message);
                return;
            }
            mountIframe(assembledHtml);
        });
    }

    function setStatus(text) {
        var container = document.getElementById('ucb-iframe-container');
        container.innerHTML = '<div id="ucb-status">' + text + '</div>';
    }

    function mountIframe(html) {
        var container = document.getElementById('ucb-iframe-container');
        var iframe = document.createElement('iframe');
        iframe.srcdoc = html;
        container.innerHTML = '';
        container.appendChild(iframe);
    }

    function uint8ToBase64(bytes) {
        // btoa() needs a binary string; String.fromCharCode.apply blows the call
        // stack on large arrays, so build it up in chunks instead.
        var CHUNK = 8000;
        var binary = '';
        for (var i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        return btoa(binary);
    }

    // ---- Fetching + caching the asset bundle -----------------------------

    function getBundle(callback) {
        var cachedRaw = GM_getValue(STORAGE_KEY, null);
        if (cachedRaw) {
            try {
                callback(null, JSON.parse(cachedRaw));
                return;
            } catch (e) {
                // corrupt cache entry; fall through and refetch
            }
        }
        fetchAndUnzip(callback);
    }

    function fetchAndUnzip(callback) {
        setStatus('Downloading card browser assets (first run only)\u2026');
        GM_xmlhttpRequest({
            method: 'GET',
            url: ZIP_URL,
            responseType: 'arraybuffer',
            onload: function (res) {
                if (res.status < 200 || res.status >= 300) {
                    callback('HTTP ' + res.status + ' fetching zip', null);
                    return;
                }
                try {
                    var bytes = new Uint8Array(res.response);
                    var unzipped = fflate.unzipSync(bytes);
                    var files = {};
                    NEEDED_PATHS.forEach(function (path) {
                        if (!unzipped[path]) {
                            return;
                        }
                        if (FONT_FILES[path]) {
                            files[path] = uint8ToBase64(unzipped[path]);
                        } else {
                            files[path] = fflate.strFromU8(unzipped[path]);
                        }
                    });
                    if (!files[HTML_FILE]) {
                        callback('Cards.html not found in zip (check ROOT/paths)', null);
                        return;
                    }
                    GM_setValue(STORAGE_KEY, JSON.stringify(files));
                    callback(null, files);
                } catch (e) {
                    callback('Unzip failed: ' + e.message, null);
                }
            },
            onerror: function () {
                callback('Network error fetching zip', null);
            }
        });
    }

    function inlineFonts(css, files) {
        Object.keys(FONT_FILES).forEach(function (path) {
            var filename = path.split('/').pop();
            var mime = FONT_FILES[path];
            var base64 = files[path];
            if (!base64) {
                return;
            }
            var dataUri = 'data:' + mime + ';base64,' + base64;
            // Matches url(../fonts/FILE), url('../fonts/FILE'), url("../fonts/FILE"),
            // with or without a trailing #fragment or ?query (e.g. the eot ?#iefix hack).
            var re = new RegExp(
                'url\\((["\']?)\\.\\./fonts/' + filename.replace(/\./g, '\\.') + '[^)"\']*\\1\\)',
                'g'
            );
            css = css.replace(re, 'url(' + dataUri + ')');
        });
        return css;
    }

    // ---- Assembling a fully self-contained HTML document -------------------

    function assembleHtml(files) {
        var doc = new DOMParser().parseFromString(files[HTML_FILE], 'text/html');

        // Inline every <link href="css/X.css..."> as a <style> tag with the actual CSS.
        // Font url(../fonts/X) references get swapped for base64 data URIs first, since
        // a srcdoc iframe resolves relative paths against whatever host page it's on,
        // not our assets.
        Array.prototype.forEach.call(doc.querySelectorAll('link[href^="css/"]'), function (link) {
            var filename = link.getAttribute('href').split('?')[0].split('/').pop();
            var path = ROOT + 'css/' + filename;
            var css = files[path] || ('/* missing: ' + path + ' */');
            css = inlineFonts(css, files);
            var styleEl = doc.createElement('style');
            styleEl.textContent = css;
            link.parentNode.replaceChild(styleEl, link);
        });

        // Inline every <script src="js/X.js..."> as an inline <script> with the actual JS,
        // in the same document order (dependency order matters: jquery before jquery-ui, etc).
        var jqueryScriptEl = null;
        Array.prototype.forEach.call(doc.querySelectorAll('script[src^="js/"]'), function (scriptTag) {
            var filename = scriptTag.getAttribute('src').split('?')[0].split('/').pop();
            var path = ROOT + 'js/' + filename;
            var inlineEl = doc.createElement('script');
            inlineEl.textContent = files[path] || ('console.error("missing script: ' + path + '");');
            scriptTag.parentNode.replaceChild(inlineEl, scriptTag);
            if (filename === 'jquery.min.js') {
                jqueryScriptEl = inlineEl;
            }
        });

        // Insert the data shim immediately after jquery loads (and before jquery-i18n/
        // translation.js/card.js run), so $.ajax is patched before anything needs it.
        // This replaces the three same-origin relative fetches (AllCards, Version,
        // translation/{lang}.json) that don't exist in a srcdoc iframe with no real
        // server behind it, using the data already sitting in memory from the zip.
        var shim = doc.createElement('script');
        shim.textContent = buildAjaxShim(files);
        if (jqueryScriptEl) {
            jqueryScriptEl.parentNode.insertBefore(shim, jqueryScriptEl.nextSibling);
        } else {
            doc.head.appendChild(shim);
        }

        return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    }

    function buildAjaxShim(files) {
        var payload = {
            AllCards: files[DATA_FILES.allCards] || '',
            Version: files[DATA_FILES.version] || '',
            translations: {
                en: files[DATA_FILES.translationEn] || ''
            }
        };

        // Everything here runs INSIDE the iframe, not in the userscript's own scope,
        // so it's assembled as plain text with the payload embedded as a JSON literal.
        return (
            'window.__ucbData = ' + JSON.stringify(payload) + ';\n' +
            '(function () {\n' +
            '  var originalAjax = jQuery.ajax;\n' +
            '  jQuery.ajax = function (opts) {\n' +
            '    var url = typeof opts === "string" ? opts : opts.url;\n' +
            '    var data = null;\n' +
            '    if (url === "AllCards") {\n' +
            '      data = window.__ucbData.AllCards;\n' +
            '    } else if (url === "Version?type=cards") {\n' +
            '      data = window.__ucbData.Version;\n' +
            '    } else {\n' +
            '      var m = /^translation\\/(\\w+)\\.json/.exec(url);\n' +
            '      if (m && window.__ucbData.translations[m[1]]) {\n' +
            '        data = window.__ucbData.translations[m[1]];\n' +
            '      }\n' +
            '    }\n' +
            '    if (data !== null) {\n' +
            '      var parsed;\n' +
            '      try { parsed = JSON.parse(data); } catch (e) {\n' +
            '        if (opts.error) { setTimeout(function () { opts.error({}, "parsererror", e.message); }, 0); }\n' +
            '        return jQuery.Deferred().reject().promise();\n' +
            '      }\n' +
            '      setTimeout(function () {\n' +
            '        if (opts.success) { opts.success(parsed); }\n' +
            '      }, 0);\n' +
            '      var deferred = jQuery.Deferred();\n' +
            '      deferred.resolve(parsed);\n' +
            '      return deferred.promise();\n' +
            '    }\n' +
            '    return originalAjax.apply(this, arguments);\n' +
            '  };\n' +
            '})();\n'
        );
    }

    // ---- Cache management menu command --------------------------------------

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Undercards: Clear cached assets', function () {
            GM_deleteValue(STORAGE_KEY);
            assembledHtml = null;
            alert('Undercards cache cleared. It will re-download on next open.');
        });
    }

    // ---- Init ---------------------------------------------------------------

    injectShell();
})();
