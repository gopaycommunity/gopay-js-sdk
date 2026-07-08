# Internal notes

This file stays on Bitbucket only — the `github-sync` pipeline step strips it (and its history) before mirroring `master` to the public GitHub repo. Keep internal-only details here (internal hostnames, internal deployment notes) instead of `README.md`.

## Example page — internal k8s deployment

The example page is also deployed on the internal k8s cluster, e.g.:
<https://api-int.alpha8.dev.gopay.com/gp-gw-js-sdk/>

## Docker — pointing at a different API environment

To point the Dockerized example at a different API environment (e.g. the internal alpha8 environment), pass `GOPAY_PAYMENTS_V4_BASE_URL` at build time:

```bash
docker build --build-arg GOPAY_PAYMENTS_V4_BASE_URL=https://gw.alpha8.dev.gopay.com/api/merchant/payments/4.0 -t gopay-js-sdk-example:latest .
yarn docker:start
```
