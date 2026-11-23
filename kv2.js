(function () {
    'use strict';

    var BASE = 'https://fr.pornhub.org';

    /* ---------- сеть ---------- */
    function request(url) {
        return new Promise(function (resolve, reject) {
            $.ajax({
                url: url,
                type: 'GET',
                dataType: 'text',
                timeout: 30000,
                success: resolve,
                error: function (xhr, status) { reject(status || 'network'); }
            });
        });
    }

    function htmlToText(s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.innerHTML = s;
        return (d.textContent || '').trim();
    }

    /* ---------- ссылки качества со страницы видео ---------- */
    function parseQuality(html) {
        var out = {};

        var m = html.match(/qualityItems_?\s*=\s*(\[[\s\S]*?\])\s*;/);
        if (m) {
            try {
                JSON.parse(m[1]).forEach(function (q) {
                    if (q && q.url) out[q.text || 'auto'] = q.url.replace(/\\\//g, '/');
                });
            } catch (e) {}
        }

        if (!Object.keys(out).length) {
            var md = html.match(/"mediaDefinitions"\s*:\s*(\[[\s\S]*?\])\s*,\s*"/);
            if (md) {
                try {
                    JSON.parse(md[1]).forEach(function (d) {
                        if (d && d.videoUrl) out[(d.quality || 'auto') + 'p'] = d.videoUrl.replace(/\\\//g, '/');
                    });
                } catch (e) {}
            }
        }
        return out;
    }

    /* ---------- список роликов ---------- */
    function parseList(html) {
        var results = [];
        var items = html.match(/<li[^>]*class="[^"]*pcVideoListItem[^"]*"[\s\S]*?<\/li>/g) || [];
        items.forEach(function (b) {
            var key = (b.match(/data-video-vkey="([^"]+)"/) || [])[1];
            var title = htmlToText((b.match(/<span class="title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1])
                     || htmlToText((b.match(/alt="([^"]+)"/) || [])[1]);
            var img = (b.match(/data-src="([^"]+)"/) || b.match(/src="([^"]+)"/) || [])[1];
            var dur = htmlToText((b.match(/<var class="duration">([^<]*)<\/var>/) || [])[1]);
            if (key && title) results.push({ key: key, title: title, img: img || '', dur: dur || '' });
        });
        return results;
    }

    /* ---------- экран плагина ---------- */
    function component(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
        var files = $('<div class="pornhub category-full"></div>');
        var items = [];
        var _this = this;

        function addRow(title, cb) {
            var el = $('<div class="selector" style="padding:1.3em;font-size:1.2em;">' + title + '</div>');
            el.on('hover:enter', cb);
            files.append(el);
            items.push(el);
        }

        function addCard(it) {
            var card = Lampa.Template.js('card', {
                title: it.title,
                release_year: it.dur,
                vote_average: 0
            });
            card.find('.card__img').attr('src', it.img).on('error', function () { $(this).hide(); });
            card.on('hover:enter', function () { _this.open(it); });
            files.append(card);
            items.push(card);
        }

        this.create = function () {
            this.activity.loader(true);

            // главный экран — меню разделов
            if (!object.url && !object.search) {
                this.activity.loader(false);
                scroll.minus();
                scroll.append(files);
                addRow('🔍 Поиск', function () {
                    Lampa.Input.edit({
                        title: 'Поиск', value: '', free: true, nosave: true, layout: 'search'
                    }, function (value) {
                        if (value) Lampa.Activity.push({
                            url: '', title: 'Поиск: ' + value,
                            component: 'pornhub', search: value, page: 1
                        });
                    });
                });
                addRow('🔥 Популярное', function () {
                    Lampa.Activity.push({ url: '/video?o=ht', title: 'Популярное', component: 'pornhub', page: 1 });
                });
                addRow('🕐 Новое', function () {
                    Lampa.Activity.push({ url: '/video', title: 'Новое', component: 'pornhub', page: 1 });
                });
                return;
            }

            var url = object.search
                ? BASE + '/video/search?search=' + encodeURIComponent(object.search)
                : BASE + object.url + (object.page > 1 ? '&page=' + object.page : '');

            request(url).then(function (data) {
                _this.activity.loader(false);
                scroll.minus();
                scroll.append(files);

                var list = parseList(data);
                if (!list.length) Lampa.Noty.show('Ничего не найдено');
                list.forEach(addCard);

                // «Загрузить ещё»
                if (list.length) {
                    addRow('Загрузить ещё…', function () {
                        Lampa.Activity.push({
                            url: object.url || '', title: object.title,
                            component: 'pornhub', search: object.search || '',
                            page: (object.page || 1) + 1
                        });
                    });
                }
            }).catch(function () {
                _this.activity.loader(false);
                Lampa.Noty.show('Ошибка загрузки страницы');
            });
        };

        this.open = function (it) {
            Lampa.Loading.start(function () {
                Lampa.Loading.stop();
                Lampa.Controller.toggle('content');
            }, 'Получение ссылок…');

            request(BASE + '/view_video.php?viewkey=' + it.key).then(function (html) {
                Lampa.Loading.stop();
                var quals = parseQuality(html);
                var qs = Object.keys(quals);
                if (!qs.length) { Lampa.Noty.show('Ссылки не найдены'); return; }
                Lampa.Player.play({
                    title: it.title,
                    url: quals[qs[qs.length - 1]],
                    quality: quals,
                    subtitles: []
                });
            }).catch(function () {
                Lampa.Loading.stop();
                Lampa.Noty.show('Ошибка получения ссылок');
            });
        };

        this.back = function () { Lampa.Activity.backward(); };
        this.start = function () { if (items[0]) items[0].trigger('hover:focus'); };
        this.pause = function () {};
        this.stop = function () {};
        this.render = function () { return scroll.render(); };
        this.destroy = function () { scroll.destroy(); items = []; };
    }

    /* ---------- запуск ---------- */
    function startPlugin() {
        Lampa.Component.add('pornhub', component);

        var icon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
        var timer = setInterval(function () {
            if (!$('.menu__list').length) return;
            clearInterval(timer);
            if ($('.menu__item[data-action="pornhub"]').length) return;
            var btn = $('<li class="menu__item selector" data-action="pornhub">' +
                '<div class="menu__ico">' + icon + '</div>' +
                '<div class="menu__text">PornHub</div></li>');
            btn.on('hover:enter', function () {
                Lampa.Activity.push({ url: '', title: 'PornHub', component: 'pornhub', page: 1 });
            });
            $('.menu .menu__list').eq(0).append(btn);
        }, 500);
    }

    if (window.Lampa && Lampa.Manifest) startPlugin();
    else window.addEventListener('lampa', startPlugin);
})();