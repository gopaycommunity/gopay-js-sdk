/**
 * Apple Pay JS polyfill for non-Safari browsers.
 *
 * Loaded automatically by the example page when window.ApplePaySession is absent.
 * Simulates the ApplePaySession lifecycle so the full flow can be exercised in
 * Chrome, Firefox, etc. during development and testing.
 *
 * DO NOT ship this in production — it is a development-only stub.
 */
// Always run — exposes MockApplePaySession on window for the dev mock button.
// Native window.ApplePaySession is left untouched; use MockApplePaySession explicitly for dev testing.
(() => {
    // -------------------------------------------------------------------------
    // Modal helpers
    // -------------------------------------------------------------------------

    function buildModal() {
        const overlay = document.createElement('div');
        overlay.id = 'ap-polyfill-overlay';
        Object.assign(overlay.style, {
            position: 'fixed',
            inset: '0',
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: '99999',
            fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        });

        const sheet = document.createElement('div');
        Object.assign(sheet.style, {
            background: '#fff',
            borderRadius: '16px',
            padding: '2rem',
            width: '320px',
            maxWidth: '90vw',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            textAlign: 'center',
        });

        const logo = document.createElement('div');
        logo.textContent = ' Pay';
        Object.assign(logo.style, {
            fontSize: '1.6rem',
            fontWeight: '700',
            marginBottom: '0.5rem',
            letterSpacing: '-0.5px',
        });

        const badge = document.createElement('div');
        badge.textContent = 'DEV POLYFILL';
        Object.assign(badge.style, {
            display: 'inline-block',
            background: '#fff3cd',
            color: '#856404',
            border: '1px solid #ffc107',
            borderRadius: '4px',
            fontSize: '0.7rem',
            fontWeight: '600',
            padding: '2px 8px',
            marginBottom: '1rem',
        });

        const info = document.createElement('p');
        info.textContent =
            'Click "Pay" to simulate a successful payment authorisation, or "Cancel" to abort.';
        Object.assign(info.style, {
            fontSize: '0.82rem',
            color: '#555',
            marginBottom: '1.25rem',
            lineHeight: '1.5',
        });

        const status = document.createElement('p');
        status.id = 'ap-polyfill-status';
        Object.assign(status.style, {
            fontSize: '0.78rem',
            color: '#333',
            minHeight: '1.2em',
            marginBottom: '1rem',
        });

        const btnRow = document.createElement('div');
        Object.assign(btnRow.style, {
            display: 'flex',
            gap: '0.75rem',
            justifyContent: 'center',
        });

        const payBtn = document.createElement('button');
        payBtn.id = 'ap-polyfill-pay';
        payBtn.textContent = 'Pay';
        Object.assign(payBtn.style, {
            flex: '1',
            padding: '0.65rem',
            borderRadius: '8px',
            border: 'none',
            background: '#000',
            color: '#fff',
            fontSize: '0.9rem',
            fontWeight: '600',
            cursor: 'pointer',
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.id = 'ap-polyfill-cancel';
        cancelBtn.textContent = 'Cancel';
        Object.assign(cancelBtn.style, {
            flex: '1',
            padding: '0.65rem',
            borderRadius: '8px',
            border: '1px solid #ccc',
            background: '#fff',
            color: '#333',
            fontSize: '0.9rem',
            cursor: 'pointer',
        });

        btnRow.appendChild(payBtn);
        btnRow.appendChild(cancelBtn);
        sheet.appendChild(logo);
        sheet.appendChild(badge);
        sheet.appendChild(info);
        sheet.appendChild(status);
        sheet.appendChild(btnRow);
        overlay.appendChild(sheet);
        return overlay;
    }

    function showStatus(text) {
        const el = document.getElementById('ap-polyfill-status');
        if (el) el.textContent = text;
    }

    function setButtonsEnabled(enabled) {
        ['ap-polyfill-pay', 'ap-polyfill-cancel'].forEach((id) => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = !enabled;
        });
    }

    // -------------------------------------------------------------------------
    // Mock ApplePaySession
    // -------------------------------------------------------------------------

    /**
     * Minimal mock payment token that mirrors the real Apple Pay paymentData
     * shape. All fields are plausible-looking stubs — not real cryptographic
     * material. The GoPay SDK (and your backend) will receive these and should
     * treat a sandbox call as a test flow.
     */
    const MOCK_PAYMENT_DATA = {
        data: 'MOCK_ENCRYPTED_DATA_V7OcjttPJnUJaQH7x7OjbIeZSINuc==',
        signature: 'MOCK_SIG_MIAGCSqGSIb3DQEHAqCAM==',
        version: 'EC_v1',
        header: {
            ephemeralPublicKey: 'MOCK_EPK_MFkwEwYHKoZIzj==',
            publicKeyHash: 'MOCK_PKH_L6vppo38t31Q=',
            transactionId: 'MOCK_TXN_4f4fac7a1a6a8ba2c0e8c5',
        },
    };

    class ApplePaySession {
        constructor(_version, _paymentRequest) {
            this.onvalidatemerchant = null;
            this.onpaymentauthorized = null;
            this.oncancel = null;
            this._merchantSession = null;
            this._modal = null;
            this._removeTimer = null;
        }

        static get STATUS_SUCCESS() {
            return 0;
        }
        static get STATUS_FAILURE() {
            return 1;
        }

        static canMakePayments() {
            return true;
        }
        static canMakePaymentsWithActiveCard(_merchantId) {
            return Promise.resolve(true);
        }

        begin() {
            const modal = buildModal();
            this._modal = modal;
            document.body.appendChild(modal);

            showStatus('Validating merchant…');
            const payBtn = document.getElementById('ap-polyfill-pay');
            if (payBtn) payBtn.disabled = true;

            // Fire onvalidatemerchant asynchronously (mirrors real behaviour)
            setTimeout(() => {
                if (typeof this.onvalidatemerchant === 'function') {
                    this.onvalidatemerchant({
                        validationURL:
                            'https://apple-pay-gateway.apple.com/paymentservices/startSession',
                    });
                }
            }, 0);

            // Wire cancel button
            document
                .getElementById('ap-polyfill-cancel')
                .addEventListener('click', () => {
                    this.abort();
                    if (typeof this.oncancel === 'function')
                        this.oncancel({ code: 'USER_CANCEL' });
                });
        }

        completeMerchantValidation(merchantSession) {
            this._merchantSession = merchantSession;
            showStatus('Merchant validated. Ready to pay.');
            setButtonsEnabled(true);

            document.getElementById('ap-polyfill-pay').addEventListener(
                'click',
                () => {
                    if (!this._modal) return; // aborted before click was processed
                    setButtonsEnabled(false);
                    showStatus('Authorising payment…');
                    if (typeof this.onpaymentauthorized === 'function') {
                        this.onpaymentauthorized({
                            payment: {
                                token: {
                                    paymentData: MOCK_PAYMENT_DATA,
                                    paymentMethod: {
                                        displayName: 'Visa 1234',
                                        network: 'Visa',
                                        type: 'debit',
                                    },
                                    transactionIdentifier:
                                        MOCK_PAYMENT_DATA.header.transactionId,
                                },
                                billingContact: {},
                                shippingContact: {},
                            },
                        });
                    }
                },
                { once: true },
            );
        }

        completePayment(status) {
            showStatus(
                status === ApplePaySession.STATUS_SUCCESS
                    ? 'Payment succeeded.'
                    : 'Payment failed.',
            );
            const modal = this._modal;
            this._removeTimer = setTimeout(() => {
                if (modal) modal.remove();
                this._modal = null;
                this._removeTimer = null;
            }, 800);
        }

        abort() {
            clearTimeout(this._removeTimer);
            this._removeTimer = null;
            if (this._modal) {
                this._modal.remove();
                this._modal = null;
            }
        }
    }

    ApplePaySession.__isPolyfill = true;

    // Always expose as MockApplePaySession so the dev mock button works in any browser.
    window.MockApplePaySession = ApplePaySession;
    console.info(
        '[apple-pay-polyfill] MockApplePaySession available (dev mock only).',
    );
})();
