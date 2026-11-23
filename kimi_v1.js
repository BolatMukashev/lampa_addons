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
                success: function (html) { resolve(html); },
                error: function (xhr, status) { reject(status || 'network error'); }
            });
        });
    }

    function htmlToText(str) {
        if (!str) return '';
        var d = document.createElement('div');
        d.innerHTML = str;
        return (d.textContent || '').trim();
    }

    /* ---------- парсинг прямых ссылок со страницы видео ---------- */
    function parseQuality(html) {
        var out = [];

        // вариант 1: var qualityItems = [{"text":"1080p","url":"..."}, ...]
        var m = html.match(/qualityItems_?\s*=\s*(\[[\s\S]*?\])\s*;/);
        if (m) {
            try {
                JSON.parse(m[1]).forEach(function (q) {
                    if (q && q.url) {
                        out.push({
                            quality: q.text || 'auto',
                            url: q.url.replace(/\\\//g, '/')
                        });
                    }
                });
            } catch (e) {}
        }

        // вариант 2: "mediaDefinitions":[{...,"videoUrl":"...", "quality":720}, ...]
        if (!out.length) {
            var md = html.match(/"mediaDefinitions"\s*:\s*(\[[\s\S]*?\])\s*,\s*"/);
            if (md) {
                try {
                    JSON.parse(md[1]).forEach(function (d) {
                        if (d && d.videoUrl) {
                            out.push({
                                quality: (d.quality || 'auto') + 'p',
                                url: d.videoUrl.replace(/\\\//g, '/')
                            });
                        }
                    });
                } catch (e) {}
            }
        }
        return out;
    }

    /* ---------- парсинг списка видео (поиск/каталог) ---------- */
    function parseSearch(html) {
        var results = [];
        var items = html.match(/<li[^>]*class="[^"]*pcVideoListItem[^"]*"[\s\S]*?<\/li>/g) || [];

        items.forEach(function (block) {
            var key   = (block.match(/data-video-vkey="([^"]+)"/) || [])[1];
            var title = htmlToText((block.match(/<span class="title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1]);
            if (!title) title = htmlToText((block.match(/alt="([^"]+)"/) || [])[1]);
            var img = (block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+)"/) || [])[1];
            var dur = htmlToText((block.match(/<var class="duration">([^<]*)<\/var>/) || [])[1]);

            if (key && title) {
                results.push({
                    id: key,
                    title: title,
                    original_title: title,
                    overview: dur ? 'Длительность: ' + dur : '',
                    vote_average: 0,
                    img: img || '',
                    background: img || '',
                    release_date: '',
                    genre_ids: [],
                    media_type: 'movie'
                });
            }
        });
        return results;
    }

    /* ---------- регистрация источника в Lampa ---------- */
    function startPlugin() {
        Lampa.Api.add({
            title: 'PornHub',
            type: 'movie',
            method: 'category',
            url: BASE,

            categories: function (resolve) {
                resolve([
                    { title: 'Поиск',       url: 'search'      },
                    { title: 'Популярное',  url: '/video?o=ht' },
                    { title: 'Новое',       url: '/video'      }
                ]);
            },

            category: function (params, resolve, reject) {
                if (params.url === 'search') {
                    // каталог-заглушка: поиск вызывается строкой поиска Lampa
                    resolve({ results: [], total_pages: 1, page: 1 });
                    return;
                }
                var page = params.page || 1;
                var url  = BASE + params.url + (page > 1 ? '&page=' + page : '');
                request(url).then(function (html) {
                    resolve({ results: parseSearch(html), total_pages: 100, page: page });
                }).catch(reject);
            },

            search: function (params, resolve, reject) {
                var q = typeof params === 'string' ? params : (params.query || '');
                if (!q) { resolve({ results: [], total_pages: 1, page: 1 }); return; }
                request(BASE + '/video/search?search=' + encodeURIComponent(q))
                    .then(function (html) {
                        resolve({ results: parseSearch(html), total_pages: 1, page: 1 });
                    }).catch(reject);
            },

            full: function (params, resolve, reject) {
                var key = params.id || params.viewkey ||
                          (params.movie && (params.movie.id || params.movie.viewkey));
                if (!key) { reject('no viewkey'); return; }

                request(BASE + '/view_video.php?viewkey=' + key).then(function (html) {
                    var title   = htmlToText((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]) || 'Видео';
                    var sources = parseQuality(html);

                    if (!sources.length) { reject('links not found'); return; }

                    resolve({
                        results: [{
                            name: title,
                            url: sources[0].url,
                            quality: sources[sources.length - 1].quality,
                            stream: false,
                            timeline: false,
                            subtitles: [],
                            sources: sources.map(function (s) {
                                return { url: s.url, quality: s.quality, format: 'mp4' };
                            })
                        }]
                    });
                }).catch(reject);
            }
        });
    }

    if (window.Lampa) startPlugin();
    else window.addEventListener('lampa', startPlugin);
})();