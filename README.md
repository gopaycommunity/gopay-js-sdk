# GoPay JS SDK

JavaScript/TypeScript SDK for the [GoPay Payments API v4.0](https://gopay-api.stoplight.io/docs/merchant-v4).

## Installation

```bash
npm install gopay-js-sdk
# or
yarn add gopay-js-sdk
```

## Browser (via CDN)

```html
<script src="https://gopaycdn.com/js-sdk/gopay-sdk.min.js"></script>
<script>
  const sdk = new GoPaySDK.GoPaySDK({ environment: 'sandbox' });
</script>
```

## Quick start

```ts
import { GoPaySDK } from 'gopay-js-sdk';

const sdk = new GoPaySDK({ environment: 'sandbox' });

// 1. Authenticate
const tokens = await sdk.auth.authenticate({
  grant_type: 'client_credentials',
  scope: 'payment:create',
});

// 2. Create a payment session
const payment = await sdk.payments.create('YOUR_GOID', {
  amount: 1000,        // CZK 10.00
  currency: 'CZK',
  order_number: 'ORDER-001',
  customer: { email: 'customer@example.com' },
  callback: {
    notification_url: 'https://yourshop.com/notify',
    return_url: 'https://yourshop.com/return',
  },
});

// 3. Redirect customer to the payment gateway
window.location.href = payment.gw_url;
```

## API

### `new GoPaySDK(config?)`

| Option        | Type                       | Default       | Description           |
|---------------|----------------------------|---------------|-----------------------|
| `environment` | `'sandbox' \| 'production'` | `'sandbox'`   | Target environment    |

### Modules

| Module              | Methods                                                                                      |
|---------------------|----------------------------------------------------------------------------------------------|
| `sdk.auth`          | `authenticate(params)`                                                                       |
| `sdk.encryption`    | `fetchPublicKey()`                                                                           |
| `sdk.cards`         | `createToken(params)`                                                                        |
| `sdk.payments`      | `create(goid, params)`, `charge(paymentId, params)`, `getGooglePayInfo(paymentId)`, `getApplePayInfo(paymentId)`, `validateApplePayMerchant(paymentId, origin)` |

## Development

```bash
# Install (from repo root)
corepack enable
yarn install

# Build the SDK
cd sdk && yarn build

# Run tests
cd sdk && yarn test

# Type check
cd sdk && yarn typecheck

# Lint (from repo root)
yarn lint
```

## Releasing

Releases are fully automated via [semantic-release](https://semantic-release.gitbook.io/semantic-release/).

Write commits following the [Conventional Commits](https://www.conventionalcommits.org/) spec:

| Prefix              | Version bump | Example                          |
|---------------------|--------------|----------------------------------|
| `fix:`              | patch        | `fix: handle null card_id`       |
| `feat:`             | minor        | `feat: add refund support`       |
| `BREAKING CHANGE:`  | major        | `feat!: rename GoPaySDK to ...`  |

On merge to `master` the pipeline will:
1. Determine the next version from commit history
2. Update `package.json` and `CHANGELOG.md`
3. Create a git tag
4. Publish to npm
5. Upload the IIFE bundle to gopaycdn.com

## License

MIT
