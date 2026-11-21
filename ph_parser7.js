(function () {
    'use strict';

    // Парсер fr.pornhub.org для Lampa 3.x. Собственный экран-оверлей (без InteractionCategory).

    var HOST = 'https://fr.pornhub.org';
    var PROXY = '';       // например 'https://название.workers.dev/?url='
    var DEBUG = true;     // false — убрать журнал внизу экрана

    var network = new Lampa.Reguest();
    var state = { sort: 'ht', search: '', page: 0, loading: false, ended: false };
    var root, grid, body, status;

    // ---------- журнал ----------
    function log(msg) {
        try { console.log('[PH] ' + msg); } catch (e) {}
        if (!DEBUG) return;
        var box = document.getElementById('ph-debug');
        if (!box) {
            box = document.createElement('div');
            box.id = 'ph-debug';
            box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:55%;overflow:auto;' +
                'background:rgba(0,0,0,.88);color:#0f0;font:11px monospace;padding:4px;' +
                'z-index:2147483647;white-space:pre-wrap;word-break:break-all';
            box.onclick = function () { box.parentNode && box.parentNode.removeChild(box); };
            document.body.appendChild(box);
        }
        box.textContent += msg + '\n';
        box.scrollTop = box.scrollHeight;
    }

    window.addEventListener('error', function (e) {
        log('JS ОШИБКА: ' + e.message + ' (' + (e.filename || '').split('/').pop() + ':' + e.lineno + ')');
    });

    // ---------- запросы: native, затем fetch ----------
    function wrap(url) { return PROXY ? PROXY + encodeURIComponent(url) : url; }

    function get(url, ok, fail) {
        var full = wrap(url);
        var finished = false;

        function good(d) {
            if (finished) return;
            finished = true;
            try { ok(d); } catch (e) { log('ОШИБКА обработки: ' + e.message); }
        }
        function bad(e) {
            if (finished) return;
            finished = true;
            if (fail) fail(e);
        }
        function viaFetch() {
            log('fetch → ' + full.slice(0, 80));
            fetch(full).then(function (r) {
                log('fetch статус: ' + r.status);
                return r.text();
            }).then(function (t) {
                log('fetch символов: ' + t.length);
                good(t);
            }).catch(function (e) {
                log('fetch ОШИБКА: ' + e + ' (вероятно CORS)');
                bad(e);
            });
        }

        var nativeDone = false;
        var timer = setTimeout(function () {
            if (nativeDone) return;
            nativeDone = true;
            log('native: нет ответа 10 сек');
            viaFetch();
        }, 10000);

        log('native → ' + full.slice(0, 80));
        try {
            network.native(full, function (d) {
                if (nativeDone) return;
                nativeDone = true;
                clearTimeout(timer);
                log('native ок, символов: ' + (d && d.length));
                good(d);
            }, function (e) {
                if (nativeDone) return;
                nativeDone = true;
                clearTimeout(timer);
                log('native ОШИБКА: ' + (e ? (e.status || e.statusText || e.message || JSON.stringify(e)) : 'пусто'));
                viaFetch();
            }, false, { dataType: 'text' });
        } catch (e) {
            nativeDone = true;
            clearTimeout(timer);
            log('native исключение: ' + e.message);
            viaFetch();
        }
    }

    // ---------- разбор ----------
    function buildUrl(page) {
        var base = state.search
            ? HOST + '/video/search?search=' + encodeURIComponent(state.search)
            : HOST + '/video?o=' + state.sort;
        return base + '&page=' + page;
    }

    function picOf(el) {
        if (!el) return '';
        var img = el.tagName === 'IMG' ? el : el.querySelector('img');
        if (!img) return '';
        var attrs = ['data-mediumthumb', 'data-thumb_url', 'data-src', 'data-path', 'src'];
        for (var i = 0; i < attrs.length; i++) {
            var v = img.getAttribute(attrs[i]);
            if (v && v.indexOf('data:') !== 0) return v;
        }
        return '';
    }

    function parseList(html) {
        var s = typeof html === 'string' ? html : String(html);
        var doc = new DOMParser().parseFromString(s, 'text/html');
        var links = doc.querySelectorAll('a[href*="viewkey="]');
        log('ссылок с viewkey: ' + links.length);

        var map = {}, order = [], firstBox = null;

        links.forEach(function (a) {
            var href = a.getAttribute('href') || '';
            if (/pkey=/.test(href)) return; // ссылки плейлистов пропускаем
            var m = href.match(/viewkey=(\w+)/);
            if (!m) return;
            var key = m[1];

            var it = map[key];
            if (!it) {
                it = map[key] = { name: '', pic: '', time: '', video: HOST + '/view_video.php?viewkey=' + key };
                order.push(key);
            }

            var box = a.closest('li') || a.parentElement;
            if (!firstBox) firstBox = box;

            var title = a.getAttribute('title');
            if (!it.name && title) it.name = title.trim();

            if (!it.pic) it.pic = picOf(a) || picOf(box);

            if (!it.time) {
                var d = box && box.querySelector('var.duration, .duration');
                var tm = ((d ? d.textContent : '') || a.textContent || (box ? box.textContent : '')).match(/\d{1,2}:\d{2}(?::\d{2})?/);
                if (tm) it.time = tm[0];
            }

            if (!it.name) {
                var txt = (a.textContent || '').replace(/\s+/g, ' ').replace(/\d{1,2}:\d{2}(?::\d{2})?/, '').trim();
                if (txt) it.name = txt;
            }
        });

        var out = order.map(function (k) { return map[k]; }).filter(function (x) { return x.name; });
        var withPic = out.filter(function (x) { return x.pic; }).length;
        log('карточек: ' + out.length + ', с картинкой: ' + withPic);

        if (!out.length) {
            log('Начало ответа: ' + s.slice(0, 150).replace(/\s+/g, ' '));
        } else if (!withPic && firstBox) {
            log('нет картинок. HTML первой карточки: ' + firstBox.outerHTML.slice(0, 400).replace(/\s+/g, ' '));
        }
        return out;
    }

    // ---------- воспроизведение ----------
    function abs(url) { return url.indexOf('/') === 0 ? HOST + url : url; }

    function getMediaDefinitions(html) {
        var m = html.match(/var flashvars_\d+\s*=\s*(\{[\s\S]*?\});\s*\n/);
        if (m) {
            try { return JSON.parse(m[1]).mediaDefinitions || []; } catch (e) { log('flashvars JSON: ' + e.message); }
        }
        m = html.match(/"mediaDefinitions"\s*:\s*(\[[\s\S]*?\])\s*,\s*"/);
        if (m) {
            try { return JSON.parse(m[1]); } catch (e) { log('mediaDefinitions JSON: ' + e.message); }
        }
        return [];
    }

    function sortedKeys(qualities) {
        return Object.keys(qualities).sort(function (a, b) { return parseInt(b) - parseInt(a); });
    }

    function copyText(text) {
        try {
            if (Lampa.Utils && Lampa.Utils.copyTextToClipboard) {
                Lampa.Utils.copyTextToClipboard(text, function () {
                    Lampa.Noty.show('Ссылка скопирована');
                }, function () { log('копирование не удалось'); });
                return;
            }
        } catch (e) {}
        try {
            navigator.clipboard.writeText(text).then(function () { Lampa.Noty.show('Ссылка скопирована'); });
        } catch (e) { log('копирование: ' + e.message); }
    }

    function resolveUrl(base, rel) {
        try { return new URL(rel, base).href; } catch (e) { return rel; }
    }

    function nativeText(url, ok, fail) {
        try {
            network.native(url, ok, function (e) {
                fail('ОШИБКА ' + (e ? (e.status || e.statusText || e.message || JSON.stringify(e)) : '?'));
            }, false, { dataType: 'text' });
        } catch (e) { fail('исключение ' + e.message); }
    }

    // Проба цепочки так, как это делает встроенный плеер (fetch из браузерного движка, без лишних заголовков)
    function probe(url) {
        function f(label, u, cb) {
            var ctl = window.AbortController ? new AbortController() : null;
            fetch(u, ctl ? { signal: ctl.signal } : {}).then(function (r) {
                log(label + ' fetch: статус ' + r.status +
                    ', CORS-заголовок: ' + (r.headers.get('access-control-allow-origin') || 'нет') +
                    ', тип: ' + (r.headers.get('content-type') || '?'));
                if (cb) return r.text().then(cb);
                if (ctl) ctl.abort();
            }).catch(function (e) {
                log(label + ' fetch ОШИБКА: ' + e + ' (CORS или сеть)');
            });
        }

        function firstLink(txt) {
            var lines = String(txt).split(/\r?\n/).filter(function (l) { return l && l.charAt(0) !== '#'; });
            return lines.length ? lines[0].trim() : '';
        }

        f('MASTER', url, function (t) {
            var v = resolveUrl(url, firstLink(t));
            f('ВАРИАНТ', v, function (vt) {
                var seg = resolveUrl(v, firstLink(vt));
                f('СЕГМЕНТ', seg, null);
            });
        });
    }

    function playInLampa(title, url, map) {
        log('плеер Lampa, URL: ' + url.slice(0, 160));
        probe(url);
        root.style.display = 'none';
        try {
            Lampa.Player.play({ url: url, title: title, quality: map });
        } catch (e) {
            log('Player.play ОШИБКА: ' + e.message);
            root.style.display = 'flex';
        }
    }

    function startPlayer(title, qualities) {
        setStatus('');
        var keys = sortedKeys(qualities);
        if (!keys.length) {
            log('видеопотоки не найдены');
            return Lampa.Noty.show('Не удалось найти видеопоток');
        }
        log('качества: ' + keys.join(','));

        var map = {};
        keys.forEach(function (k) { map[k + 'p'] = qualities[k]; });

        var old = document.getElementById('ph-dialog');
        if (old) old.parentNode.removeChild(old);

        var dlg = document.createElement('div');
        dlg.id = 'ph-dialog';
        dlg.style.cssText = 'position:absolute;left:0;right:0;top:0;bottom:0;background:rgba(0,0,0,.8);' +
            'display:flex;align-items:center;justify-content:center;z-index:5';

        var card = document.createElement('div');
        card.style.cssText = 'background:#222;border-radius:12px;padding:14px;width:85%;max-width:420px;' +
            'display:flex;flex-direction:column;gap:8px';

        var h = document.createElement('div');
        h.textContent = title;
        h.style.cssText = 'font-size:13px;color:#ccc;max-height:3.8em;overflow:hidden';
        card.appendChild(h);

        function btn(text, fn) {
            var b = document.createElement('button');
            b.className = 'ph-btn';
            b.textContent = text;
            b.onclick = fn;
            card.appendChild(b);
        }
        function closeDlg() { if (dlg.parentNode) dlg.parentNode.removeChild(dlg); }

        keys.forEach(function (k) {
            btn('▶ ' + k + 'p (плеер Lampa)', function () {
                closeDlg();
                playInLampa(title, qualities[k], map);
            });
        });

        btn('Внешний плеер (Android)', function () {
            var url = qualities[keys[Math.min(1, keys.length - 1)]];
            closeDlg();
            try {
                if (Lampa.Android && Lampa.Android.openPlayer) {
                    log('внешний плеер: ' + url.slice(0, 120));
                    Lampa.Android.openPlayer(url, { title: title, url: url });
                } else {
                    log('Lampa.Android.openPlayer недоступен');
                    Lampa.Noty.show('Внешний плеер недоступен');
                }
            } catch (e) { log('внешний плеер ОШИБКА: ' + e.message); }
        });

        btn('Копировать ссылку (' + keys[Math.min(1, keys.length - 1)] + 'p)', function () {
            copyText(qualities[keys[Math.min(1, keys.length - 1)]]);
        });

        btn('Отмена', closeDlg);

        dlg.appendChild(card);
        root.appendChild(dlg);
    }

    function play(item) {
        log('видео: ' + item.video);
        status.textContent = 'Загрузка видео…';

        get(item.video, function (html) {
            status.textContent = '';
            var defs = getMediaDefinitions(html);
            log('mediaDefinitions: ' + defs.length);

            var mp4 = defs.filter(function (d) { return d.format === 'mp4' && d.videoUrl; })[0];
            var hls = defs.filter(function (d) { return d.format === 'hls' && d.videoUrl; });

            function fallbackHls() {
                var q = {};
                hls.forEach(function (d) {
                    var quality = Array.isArray(d.quality) ? d.quality[0] : d.quality;
                    q[quality || '0'] = abs(d.videoUrl);
                });
                startPlayer(item.name, q);
            }

            if (mp4) {
                get(abs(mp4.videoUrl), function (txt) {
                    try {
                        var list = typeof txt === 'string' ? JSON.parse(txt) : txt;
                        var q = {};
                        list.forEach(function (v) { if (v.videoUrl) q[v.quality] = abs(v.videoUrl); });
                        if (Object.keys(q).length) startPlayer(item.name, q);
                        else fallbackHls();
                    } catch (e) { log('mp4 список: ' + e.message); fallbackHls(); }
                }, fallbackHls);
            } else {
                fallbackHls();
            }
        }, function () {
            status.textContent = 'Ошибка загрузки видео';
        });
    }

    // ---------- интерфейс ----------
    function addStyle() {
        var st = document.createElement('style');
        st.textContent =
            '#ph-root{position:fixed;inset:0;z-index:2147483000;background:#141414;color:#fff;display:none;flex-direction:column;font-family:sans-serif}' +
            '#ph-root .ph-head{padding:10px;background:#1e1e1e;display:flex;flex-wrap:wrap;gap:6px;align-items:center}' +
            '#ph-root .ph-btn{background:#333;color:#fff;border:0;border-radius:8px;padding:8px 12px;font-size:14px}' +
            '#ph-root .ph-btn.on{background:#e8761a}' +
            '#ph-root .ph-close{margin-left:auto;background:#a33}' +
            '#ph-root input{flex:1;min-width:120px;padding:8px;border-radius:8px;border:0;background:#333;color:#fff;font-size:14px}' +
            '#ph-root .ph-status{padding:4px 10px;font-size:12px;color:#aaa;min-height:18px}' +
            '#ph-root .ph-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:8px}' +
            '#ph-root .ph-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}' +
            '@media(min-width:700px){#ph-root .ph-grid{grid-template-columns:repeat(4,1fr)}}' +
            '#ph-root .ph-card{position:relative;background:#222;border-radius:8px;overflow:hidden}' +
            '#ph-root .ph-card img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#000}' +
            '#ph-root .ph-time{position:absolute;right:4px;top:4px;background:rgba(0,0,0,.75);font-size:11px;padding:1px 5px;border-radius:4px}' +
            '#ph-root .ph-name{padding:6px;font-size:12px;line-height:1.25;max-height:3.9em;overflow:hidden}';
        document.head.appendChild(st);
    }

    function setStatus(t) { status.textContent = t || ''; }

    function addCards(items) {
        items.forEach(function (it) {
            var c = document.createElement('div');
            c.className = 'ph-card';

            var img = document.createElement('img');
            img.src = it.pic;
            img.loading = 'lazy';
            c.appendChild(img);

            if (it.time) {
                var t = document.createElement('div');
                t.className = 'ph-time';
                t.textContent = it.time;
                c.appendChild(t);
            }

            var n = document.createElement('div');
            n.className = 'ph-name';
            n.textContent = it.name;
            c.appendChild(n);

            c.onclick = function () { play(it); };
            grid.appendChild(c);
        });
    }

    function load(reset) {
        if (state.loading) return;
        if (reset) {
            grid.innerHTML = '';
            state.page = 0;
            state.ended = false;
            body.scrollTop = 0;
        }
        if (state.ended) return;

        state.loading = true;
        state.page++;
        setStatus('Загрузка…');

        get(buildUrl(state.page), function (html) {
            var items = parseList(html);
            state.loading = false;
            if (!items.length) {
                state.ended = true;
                setStatus(state.page === 1 ? 'Ничего не найдено (смотрите журнал внизу)' : 'Это всё');
                return;
            }
            addCards(items);
            setStatus('');
        }, function () {
            state.loading = false;
            state.page--;
            setStatus('Ошибка загрузки (смотрите журнал внизу)');
        });
    }

    function buildUI() {
        addStyle();

        root = document.createElement('div');
        root.id = 'ph-root';

        var head = document.createElement('div');
        head.className = 'ph-head';

        var sorts = [['ht', 'Горячие'], ['cm', 'Новые'], ['mv', 'Просмотры'], ['tr', 'Рейтинг']];
        var btns = [];
        sorts.forEach(function (s) {
            var b = document.createElement('button');
            b.className = 'ph-btn' + (s[0] === state.sort ? ' on' : '');
            b.textContent = s[1];
            b.onclick = function () {
                state.sort = s[0];
                state.search = '';
                input.value = '';
                btns.forEach(function (x) { x.classList.remove('on'); });
                b.classList.add('on');
                load(true);
            };
            btns.push(b);
            head.appendChild(b);
        });

        var input = document.createElement('input');
        input.type = 'search';
        input.placeholder = 'Поиск';
        head.appendChild(input);

        var go = document.createElement('button');
        go.className = 'ph-btn';
        go.textContent = 'Найти';
        go.onclick = function () {
            var v = input.value.trim();
            if (!v) return;
            state.search = v;
            btns.forEach(function (x) { x.classList.remove('on'); });
            load(true);
        };
        head.appendChild(go);

        var close = document.createElement('button');
        close.className = 'ph-btn ph-close';
        close.textContent = '✕';
        close.onclick = function () { root.style.display = 'none'; };
        head.appendChild(close);

        status = document.createElement('div');
        status.className = 'ph-status';

        body = document.createElement('div');
        body.className = 'ph-body';
        grid = document.createElement('div');
        grid.className = 'ph-grid';
        body.appendChild(grid);
        body.addEventListener('scroll', function () {
            if (body.scrollTop + body.clientHeight >= body.scrollHeight - 300) load(false);
        });

        root.appendChild(head);
        root.appendChild(status);
        root.appendChild(body);
        document.body.appendChild(root);

        try {
            ['start', 'ready', 'error', 'destroy'].forEach(function (name) {
                Lampa.Player.listener.follow(name, function (ev) {
                    var info = '';
                    try { info = JSON.stringify(ev || '').slice(0, 120); } catch (x) {}
                    log('player ' + name + ' ' + info);
                    if (name === 'destroy') root.style.display = 'flex';
                });
            });
        } catch (e) { log('Player.listener недоступен: ' + e.message); }
    }

    function show() {
        log('открыт экран PH');
        root.style.display = 'flex';
        if (!grid.children.length) load(true);
    }

    function init() {
        log('PH плагин загружен, Lampa ' + (Lampa.Manifest && Lampa.Manifest.app_digital));
        buildUI();

        var btn = $(
            '<li class="menu__item selector">' +
                '<div class="menu__ico"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>' +
                '<div class="menu__text">PH</div>' +
            '</li>'
        );
        btn.on('hover:enter', show);
        $('.menu .menu__list').eq(0).append(btn);
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) {
        if (e.type == 'ready') init();
    });
})();
