// Cloudflare Worker: прокси с CORS для плагина Lampa.
// Использование: https://ВАШ-ВОРКЕР.workers.dev/?url=<закодированный URL>

const ALLOWED = /(^|\.)(pornhub\.org|pornhub\.com|phncdn\.com)$/;

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*'
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const target = new URL(request.url).searchParams.get('url');
    if (!target) return new Response('no url', { status: 400, headers: cors });

    let host;
    try { host = new URL(target).hostname; } catch (e) {
      return new Response('bad url', { status: 400, headers: cors });
    }
    if (!ALLOWED.test(host)) return new Response('forbidden', { status: 403, headers: cors });

    const r = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'accessAgeDisclaimerPH=1; accessAgeDisclaimerUK=1; platform=pc'
      }
    });

    const headers = new Headers(r.headers);
    Object.keys(cors).forEach(function (k) { headers.set(k, cors[k]); });
    return new Response(r.body, { status: r.status, headers: headers });
  }
};
