export function renderQRImage(pre, result, format) {
    if (pre.nextElementSibling?.dataset.qrImg) pre.nextElementSibling.remove();
    const data = result?.qr_code;
    if (!data) return;
    const b64 = data.spayd ?? data.paybysquare ?? data.sepa ?? data.mnb_qr;
    if (!b64) return;
    const img = document.createElement('img');
    img.dataset.qrImg = '1';
    img.src =
        format === 'svg'
            ? `data:image/svg+xml;base64,${b64}`
            : `data:image/png;base64,${b64}`;
    Object.assign(img.style, {
        display: 'block',
        marginTop: '0.6rem',
        maxWidth: '200px',
    });
    pre.insertAdjacentElement('afterend', img);
}
