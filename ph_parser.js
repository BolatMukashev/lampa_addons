(function () {
    'use strict';

    // Парсер fr.pornhub.org для Lampa: каталог, сортировка, поиск, воспроизведение.
    // Если в обычном браузере блокирует CORS, укажите свой прокси в PROXY,
    // например: 'https://ваш-прокси/?url='  (в Android-приложении Lampa обычно не нужен).

    var HOST = 'https://fr.pornhub.org';
    var PROXY = '';
    var network = new Lampa.Reguest();

    function wrap(url) {
        return PROXY ? PROXY + encodeURIComponent(url) : url;
    }

    function get(url, ok, fail) {
        network.native(wrap(url), ok, function (e) {
            var why = e && (e.status || e.statusText || e.message || e.responseText) || 'нет ответа (вероятно CORS)';
            Lampa.Noty.show('PH: ошибка запроса: ' + String(why).slice(0, 80));
            if (fail) fail(e);
        }, false, { dataType: 'text' });
    }

    function buildUrl(o, page) {
        var base = o.search
            ? HOST + '/video/search?search=' + encodeURIComponent(o.search)
            : HOST + '/video?o=' + (o.sort || 'ht');
        return base + '&page=' + page;
    }

    function parseList(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var out = [];
        var seen = {};

        doc.querySelectorAll('li.pcVideoListItem').forEach(function (li) {
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

        return out;
    }

    function abs(url) {
        return url.indexOf('/') === 0 ? HOST + url : url;
    }

    function getMediaDefinitions(html) {
        var m = html.match(/var flashvars_\d+\s*=\s*(\{[\s\S]*?\});\s*\n/);
        if (m) {
            try { return JSON.parse(m[1]).mediaDefinitions || []; } catch (e) {}
        }
        m = html.match(/"mediaDefinitions"\s*:\s*(\[[\s\S]*?\])\s*,\s*"/);
        if (m) {
            try { return JSON.parse(m[1]); } catch (e) {}
        }
        return [];
    }

    function startPlayer(title, qualities) {
        var keys = Object.keys(qualities).sort(function (a, b) {
            return parseInt(b) - parseInt(a);
        });
        if (!keys.length) return Lampa.Noty.show('Не удалось найти видеопоток');

        var map = {};
        keys.forEach(function (k) { map[k + 'p'] = qualities[k]; });

        Lampa.Player.play({
            url: qualities[keys[0]],
            title: title,
            quality: map
        });
    }

    function play(item) {
        Lampa.Noty.show('Загрузка видео...');

        get(item.video, function (html) {
            var defs = getMediaDefinitions(html);
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
                    } catch (e) { fallbackHls(); }
                }, fallbackHls);
            } else {
                fallbackHls();
            }
        }, function () {
            Lampa.Noty.show('Ошибка загрузки страницы видео');
        });
    }

    function Component(object) {
        var comp = new Lampa.InteractionCategory(object);

        comp.create = function () {
            var _this = this;
            get(buildUrl(object, 1), function (html) {
                var items = parseList(html);
                if (items.length) _this.build({ results: items, page: 1, total_pages: 50 });
                else {
                    var s = typeof html === 'string' ? html : JSON.stringify(html || '');
                    Lampa.Noty.show('PH: получено ' + s.length + ' симв., pcVideoListItem: ' + (s.indexOf('pcVideoListItem') > -1 ? 'есть' : 'нет') + ', начало: ' + s.slice(0, 60).replace(/\s+/g, ' '));
                    _this.empty();
                }
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
        Lampa.Activity.push($.extend({ url: '', title: 'PH', component: 'ph_plugin', page: 1 }, params));
    }

    function menu() {
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
