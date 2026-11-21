(function () {
    'use strict';

    // Парсер fr.pornhub.org для Lampa (версия с отладочным журналом на экране)

    var HOST = 'https://fr.pornhub.org';
    var PROXY = '';       // например 'https://название.workers.dev/?url='
    var DEBUG = true;     // false — отключить зелёный журнал на экране

    // ---------- журнал на экране ----------
    function log(msg) {
        try { console.log('[PH]', msg); } catch (e) {}
        if (!DEBUG) return;
        var box = document.getElementById('ph-debug');
        if (!box) {
            box = document.createElement('div');
            box.id = 'ph-debug';
            box.style.cssText = 'position:fixed;left:0;right:0;top:0;max-height:45%;overflow:auto;' +
                'background:rgba(0,0,0,.88);color:#0f0;font:12px monospace;padding:6px;' +
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

    log('PH плагин загружен');
    log('API: Reguest=' + !!Lampa.Reguest + ' InteractionCategory=' + !!Lampa.InteractionCategory +
        ' Select=' + !!Lampa.Select + ' Input=' + !!Lampa.Input + ' Player=' + !!Lampa.Player);

    var network = new Lampa.Reguest();

    function wrap(url) {
        return PROXY ? PROXY + encodeURIComponent(url) : url;
    }

    // ---------- запросы: сначала native, потом fetch ----------
    function get(url, ok, fail) {
        var full = wrap(url);
        var finished = false;

        function good(d) {
            if (finished) return;
            finished = true;
            try { ok(d); } catch (e) { log('ОШИБКА в обработке ответа: ' + e.message); }
        }
        function bad(e) {
            if (finished) return;
            finished = true;
            if (fail) fail(e);
        }
        function viaFetch() {
            log('fetch → ' + full.slice(0, 90));
            fetch(full).then(function (r) {
                log('fetch статус: ' + r.status);
                return r.text();
            }).then(function (t) {
                log('fetch получено символов: ' + t.length);
                good(t);
            }).catch(function (e) {
                log('fetch ОШИБКА: ' + e + '  (скорее всего CORS)');
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

        log('native → ' + full.slice(0, 90));
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
    function buildUrl(o, page) {
        var base = o.search
            ? HOST + '/video/search?search=' + encodeURIComponent(o.search)
            : HOST + '/video?o=' + (o.sort || 'ht');
        return base + '&page=' + page;
    }

    function parseList(html) {
        var s = typeof html === 'string' ? html : String(html);
        var doc = new DOMParser().parseFromString(s, 'text/html');
        var nodes = doc.querySelectorAll('li.pcVideoListItem');
        log('найдено li.pcVideoListItem: ' + nodes.length);

        var out = [];
        var seen = {};

        nodes.forEach(function (li) {
            var a = li.querySelector('span.title a') || li.querySelector('a[href*="viewkey"]');
            if (!a) return;

            var m = (a.getAttribute('href') || '').match(/viewkey=(\w+)/);
            if (!m || seen[m[1]]) return;
            seen[m[1]] = true;

            var img = li.querySelector('img');
            var pic = img ? (img.getAttribute('data-mediumthumb') || img.getAttribute('data-src') || img.getAttribute('src') || '') : '';
            var dur = li.querySelector('var.duration');

            out.push({
                id: m[1],
                name: (a.getAttribute('title') || a.textContent || '').trim(),
                picture: pic,
                img: pic,
                time: dur ? dur.textContent.trim() : '',
                quality: '',
                video: HOST + '/view_video.php?viewkey=' + m[1]
            });
        });

        if (!out.length) {
            log('карточек 0. Начало ответа: ' + s.slice(0, 200).replace(/\s+/g, ' '));
            log('viewkey в тексте: ' + (s.indexOf('viewkey') > -1) + ', длина: ' + s.length);
        } else {
            log('карточек: ' + out.length);
        }
        return out;
    }

    function abs(url) {
        return url.indexOf('/') === 0 ? HOST + url : url;
    }

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

    function startPlayer(title, qualities) {
        var keys = Object.keys(qualities).sort(function (a, b) {
            return parseInt(b) - parseInt(a);
        });
        if (!keys.length) {
            log('видеопотоки не найдены');
            return Lampa.Noty.show('Не удалось найти видеопоток');
        }

        var map = {};
        keys.forEach(function (k) { map[k + 'p'] = qualities[k]; });
        log('запуск плеера, качества: ' + keys.join(','));

        Lampa.Player.play({
            url: qualities[keys[0]],
            title: title,
            quality: map
        });
    }

    function play(item) {
        log('открываю видео: ' + item.video);

        get(item.video, function (html) {
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
                        list.forEach(function (v) {
                            if (v.videoUrl) q[v.quality] = abs(v.videoUrl);
                        });
                        if (Object.keys(q).length) startPlayer(item.name, q);
                        else fallbackHls();
                    } catch (e) { log('mp4 список: ' + e.message); fallbackHls(); }
                }, fallbackHls);
            } else {
                fallbackHls();
            }
        });
    }

    // ---------- компонент ----------
    function Component(object) {
        log('компонент создан: ' + JSON.stringify({ sort: object.sort, search: object.search }));
        var comp = new Lampa.InteractionCategory(object);

        comp.create = function () {
            var _this = this;
            log('create()');
            get(buildUrl(object, 1), function (html) {
                var items = parseList(html);
                if (items.length) _this.build({ results: items, page: 1, total_pages: 50 });
                else _this.empty();
            }, function () {
                _this.empty();
            });
        };

        // имя метода именно такое (с опечаткой) — так оно называется в самой Lampa
        comp.nextPageReuest = function (obj, resolve, reject) {
            get(buildUrl(obj, obj.page), function (html) {
                resolve({ results: parseList(html), page: obj.page, total_pages: 50 });
            }, reject);
        };

        comp.cardRender = function (obj, element, card) {
            card.onMenu = false;
            card.onEnter = function () { play(element); };
        };

        return comp;
    }

    function open(params) {
        log('открываю раздел: ' + (params.title || ''));
        Lampa.Activity.push($.extend({ url: '', title: 'PH', component: 'ph_plugin', page: 1 }, params));
    }

    function menu() {
        log('нажато меню PH');
        Lampa.Select.show({
            title: 'PH',
            items: [
                { title: 'Самые горячие', sort: 'ht' },
                { title: 'Новые', sort: 'cm' },
                { title: 'Самые просматриваемые', sort: 'mv' },
                { title: 'Лучшие по рейтингу', sort: 'tr' },
                { title: 'Поиск', search: true }
            ],
            onSelect: function (a) {
                if (a.search) {
                    Lampa.Input.edit({ value: '', free: true, title: 'Поиск' }, function (val) {
                        if (val) open({ title: 'Поиск: ' + val, search: val });
                        else Lampa.Controller.toggle('menu');
                    });
                } else {
                    open({ title: a.title, sort: a.sort });
                }
            },
            onBack: function () {
                Lampa.Controller.toggle('menu');
            }
        });
    }

    function init() {
        log('init: добавляю пункт меню');
        Lampa.Component.add('ph_plugin', Component);

        var btn = $(
            '<li class="menu__item selector">' +
                '<div class="menu__ico"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>' +
                '<div class="menu__text">PH</div>' +
            '</li>'
        );
        btn.on('hover:enter', menu);
        $('.menu .menu__list').eq(0).append(btn);
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) {
        if (e.type == 'ready') init();
    });
})();
