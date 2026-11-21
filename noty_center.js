(function () {
    'use strict';

    // Плагин: уведомления/ошибки Lampa показываются по центру экрана, а не снизу

    function addStyle() {
        if (document.getElementById('noty-center-style')) return;

        var css = '' +
            '.noty {' +
            '  position: fixed !important;' +
            '  top: 50% !important;' +
            '  bottom: auto !important;' +
            '  left: 50% !important;' +
            '  right: auto !important;' +
            '  width: auto !important;' +
            '  max-width: 90% !important;' +
            '  transform: translate(-50%, -50%) !important;' +
            '  margin: 0 !important;' +
            '  z-index: 99999 !important;' +
            '  pointer-events: none;' +
            '}' +
            '.noty__body {' +
            '  margin: 0 auto !important;' +
            '  text-align: center;' +
            '  box-shadow: 0 0 2em rgba(0,0,0,0.6);' +
            '}';

        var style = document.createElement('style');
        style.id = 'noty-center-style';
        style.textContent = css;
        document.head.appendChild(style);
    }

    if (window.appready) addStyle();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') addStyle();
        });
        // на случай, если событие уже прошло
        setTimeout(addStyle, 1500);
    }
})();
