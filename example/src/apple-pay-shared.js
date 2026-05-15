export function buildApplePayPaymentMethod(info) {
    const pr = info.applePayPaymentRequest;
    return {
        supportedMethods: 'https://apple.com/apple-pay',
        data: {
            version: info.applepayVersion,
            merchantIdentifier: info.merchantIdentifier,
            merchantCapabilities: pr.merchantCapabilities,
            supportedNetworks: pr.supportedNetworks,
            countryCode: pr.countryCode,
        },
    };
}

export function buildPaymentDetails(info) {
    const pr = info.applePayPaymentRequest;
    return {
        total: {
            label: pr.total.label,
            amount: {
                currency: pr.currencyCode,
                value: String(pr.total.amount),
            },
        },
    };
}

export async function supportsPaymentRequestApplePay(info) {
    if (!window.PaymentRequest) return false;
    try {
        const req = new PaymentRequest(
            [buildApplePayPaymentMethod(info)],
            buildPaymentDetails(info),
        );
        return await req.canMakePayment();
    } catch {
        return false;
    }
}

export function extractApplePayInstrument(paymentData) {
    const { data, signature, version, header } = paymentData;
    return {
        payment_instrument: 'PAYMENT_CARD',
        input: { input_type: 'APPLE_PAY', data, signature, version, header },
    };
}

export async function renderApplePayButtons({
    container,
    info,
    mockButtonId,
    onBeginSession,
    onPaymentRequestFlow,
}) {
    if (window.MockApplePaySession) {
        const btn = document.createElement('button');
        btn.type = 'button';
        if (mockButtonId) btn.id = mockButtonId;
        btn.textContent = ' Pay (Mock — dev only)';
        btn.style.background = '#856404';
        btn.onclick = () => onBeginSession(window.MockApplePaySession);
        container.appendChild(btn);
    }

    if (window.ApplePaySession) {
        const appleBtn = document.createElement('apple-pay-button');
        appleBtn.setAttribute('buttonstyle', 'black');
        appleBtn.setAttribute('type', 'buy');
        appleBtn.setAttribute('locale', 'en-US');
        appleBtn.onclick = () => onBeginSession(window.ApplePaySession);
        container.appendChild(appleBtn);
    }

    if (
        !window.ApplePaySession &&
        (await supportsPaymentRequestApplePay(info))
    ) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = ' Pay (QR code)';
        Object.assign(btn.style, {
            background: '#1a1a2e',
            color: '#fff',
            borderRadius: '6px',
            padding: '0.5rem 1.5rem',
            fontSize: '1rem',
            fontWeight: '600',
            letterSpacing: '-0.3px',
            border: 'none',
            cursor: 'pointer',
        });
        btn.onclick = onPaymentRequestFlow;
        container.appendChild(btn);
    }
}
