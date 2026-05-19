export function renderQRImage(pre, result) {
    if (pre.nextElementSibling?.dataset.qrImg) {
        pre.nextElementSibling.remove();
    }
    const data = result?.qr_code;
    if (!data) {
        return;
    }
    const b64 = data.spayd ?? data.paybysquare ?? data.sepa ?? data.mnb_qr;
    if (!b64) {
        return;
    }
    const img = document.createElement('img');
    img.dataset.qrImg = '1';
    // Detect actual format from data — server may return PNG even when SVG was requested.
    // PNG magic bytes (89 50 4E 47) encode as 'iVBORw0K' in base64.
    if (b64.startsWith('iVBORw0K')) {
        img.src = `data:image/png;base64,${b64}`;
    } else if (b64.trimStart().startsWith('<')) {
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(b64)}`;
    } else {
        img.src = `data:image/svg+xml;base64,${b64}`;
    }
    Object.assign(img.style, {
        display: 'block',
        marginTop: '0.6rem',
        maxWidth: '200px',
    });
    pre.insertAdjacentElement('afterend', img);
}
