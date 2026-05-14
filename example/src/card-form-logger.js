function logPostMessage(direction, data) {
    const pre = document.getElementById('cardpay-output');
    if (!pre) return;
    pre.textContent += `\n${direction} ${JSON.stringify(data)}`;
    pre.scrollTop = pre.scrollHeight;
}

const isGoPay = (data) =>
    typeof data?.type === 'string' && data.type.startsWith('GOPAY_');

// iframe → parent
window.addEventListener('message', (e) => {
    if (isGoPay(e.data)) logPostMessage('←', e.data);
});

// parent → iframe: patch contentWindow.postMessage once the iframe is mounted.
// Must use MutationObserver — patching Window.prototype in the parent realm has no effect
// on iframe.contentWindow.postMessage (different realm prototype).
//
// Patch immediately in the MutationObserver callback, NOT on the load event.
// MutationObserver fires as a microtask after appendChild() but BEFORE the SDK's next
// synchronous statement sets iframe.onload. By patching the initial about:blank
// contentWindow now (same-origin, reused across navigation), the patch is in place
// before GOPAY_CARD_FORM_INIT is sent.
const iframeContainer = document.getElementById('cardpay-iframe-container');
if (iframeContainer) {
    new MutationObserver((mutations) => {
        for (const { addedNodes } of mutations) {
            for (const node of addedNodes) {
                if (!(node instanceof HTMLIFrameElement)) continue;
                try {
                    const cw = node.contentWindow;
                    const orig = cw.postMessage.bind(cw);
                    cw.postMessage = (data, ...args) => {
                        if (isGoPay(data)) logPostMessage('→', data);
                        return orig(data, ...args);
                    };
                } catch (_) {}
            }
        }
    }).observe(iframeContainer, { childList: true });
}
