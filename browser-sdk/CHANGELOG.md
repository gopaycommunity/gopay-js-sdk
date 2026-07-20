## [1.4.1](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/compare/browser-sdk-1.4.0...browser-sdk-1.4.1) (2026-07-20)


### Bug Fixes

* add repository/homepage metadata so npm links to GitHub mirror GPOMA-2423 ([630aa16](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/630aa1644c5153212e54e0a0380d4be939cb62d5))
* correct codegen doc location in CLAUDE.md GPOMA-2423 ([8d2dd22](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/8d2dd22616617b36d499f190ba1547c8c64cbda4))
* fetch beta API spec for codegen, keep only public spec in docs GPOMA-2423 ([ff2cd30](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/ff2cd30ca5295cd7f192dbd4bfe71f62783dc8a3))
* pin semantic-release repositoryUrl to git origin GPOMA-2423 ([dbfbab6](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/dbfbab617b8f10ecd27dee6f0a88db33b3bdb085))

# [1.4.0](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/compare/browser-sdk-1.3.2...browser-sdk-1.4.0) (2026-07-09)


### Features

* sync CardFormTheme boxed input fields from gw-ui-cc-v4 GPOMA-2400 ([6f28e0b](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/6f28e0bbb312e1dfb9d7b19da25d52247b3cc294))

## [1.3.2](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/compare/browser-sdk-1.3.1...browser-sdk-1.3.2) (2026-07-09)


### Bug Fixes

* address CodeRabbit / reviewer comments GPOMA-2398 ([459ebae](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/459ebae9247c9f4a81048660d92721c3f8d97a38))
* suppress js-yaml CVE-1121860 pending age-gate (audit) GPOMA-2398 ([2cc80b6](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/2cc80b69082d3b851b17cc52da8a7a76a8e7eb41))
* update internal readme and add more badges GPOMA-2398 ([bb452a3](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/bb452a3aa672302e6b0443d05fcbb4c943e02bbd))


### Features

* **ci:** introduce internal README and stop mirroring it to GitHub GPOMA-2398 ([11c0ff9](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/11c0ff99c1e56f867c37fd2c67b9e9328ac6ec08))

## [1.3.1](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/compare/browser-sdk-1.3.0...browser-sdk-1.3.1) (2026-06-29)


### Bug Fixes

* add fancy npm badges GPOMA-2375 ([9a8f3a7](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/9a8f3a76661d069a5b23791759062e3b39a8b21a))

# [1.3.0](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/compare/browser-sdk-1.2.4...browser-sdk-1.3.0) (2026-06-29)


### Bug Fixes

*  use api from production link GPOMA-2375 ([51e1574](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/51e157458f0f54a18a1460f4754df3c5103a560f))
* **audit:** suppress git-raw-commits deprecation GPOMA-2375 ([35f2379](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/35f237916d8581427bb9b358ffa20e0c07e9fc82))
* **browser-sdk:** guard attachPayment() against re-call while card form mounted D1 GPOMA-2375 ([41fa86d](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/41fa86d19957c6e1b0c94c491f2dfb8db438330e))
* **cards,polling,wallets,http:** code bugs B1 B2 B3 B6 D3 GPOMA-2375 ([55228e3](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/55228e3c5e0de30fa0934fddb31ff53ef6f2b5a7))
* **cards:** use cardFormSessionActive flag to close race in isCardFormMounted (D1) GPOMA-2375 ([b1d85c5](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b1d85c5531b512c2d7160c693fe22c92e40d1cf9))
* **polling:** forward abort signal to per-poll client.get() GPOMA-2375 ([5d36270](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/5d36270589fe92e6b690276e47dd474bf99d58e8))
* update push instructions GPOMA-2375 ([160ce7e](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/160ce7e98c1143abe34e081153cc5bec7c418027))


### Features

* **api:** wire AbortSignal through public payment methods (D4) GPOMA-2375 ([a23bd08](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/a23bd08e6b99fa89901a7813f581adfdfae91a2d))
* **errors,polling:** attach chargeState to CHARGE_FAILED error for catch callers D2 GPOMA-2375 ([26f1f38](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/26f1f38470c47b008684de17eb742f0c820ba1a3))
* **http:** add AbortSignal to RequestOptions and thread into all fetch calls D4 GPOMA-2375 ([81c2721](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/81c27211fabefc5de47b7211aad9b73403bc5755))
* **payments:** add awaitPaymentStatus() polling helper for QR and bank-transfer flows M1 GPOMA-2375 ([10b447a](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/10b447a8202607afc9b737aa44f4ae7ed8a1fce3))
* **scopes:** export GoPayScopes constants and combineScopes helper M2 GPOMA-2375 ([74b94f8](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/74b94f84e2c815789c4842d088e7ddc43eba8e64))

## [1.2.4](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/compare/browser-sdk-1.2.3...browser-sdk-1.2.4) (2026-06-24)


### Bug Fixes

* clarify theming link GPOMA-2364 ([dca521f](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/dca521f92fce78714d5ae5ee0ae2052f75f160f4))
* rename env filename GPOMA-2364 ([5eed047](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/5eed047b701a3350370c6da2467bdcb2bbacf356))
* rename remaining GP_GW_JS_SDK_* refs and make BASE_URL optional in e2e config GPOMA-2364 ([4e4774b](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/4e4774b1a8e4f5948f8674e3805568ba9aa4b445))
* run tests on local node GPOMA-2364 ([a54e7fa](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/a54e7facda750dcc423fdca0ae7142b93cc9344d))
* update env example GPOMA-2364 ([fe2a3ea](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/fe2a3eaa86ab5ef2c77ed3e2016f3069b5d5ff2e))
* update README env var names to GOPAY_PAYMENTS_V4_ prefix GPOMA-2364 ([cb3a07a](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/cb3a07a056a10fd3d90f0d20fa147e7ddfb4a34f))

## [1.2.3](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/compare/browser-sdk-1.2.2...browser-sdk-1.2.3) (2026-06-17)


### Bug Fixes

* address CodeRabbit review comments GPOMA-2349 ([be17af5](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/be17af5dfb86743b9369028c9e493a406f0c0fc4))
* address David Kolář reviewer comments GPOMA-2349 ([698a1c6](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/698a1c624792013fe67f91c832665b9d7f9e9386))
* guard awaitOptions.onStateChange in cards awaitChargeState GPOMA-2349 ([fa2b8a8](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/fa2b8a802630d2786ec70a7783166d247ce27523))
* guard awaitOptions.onStateChange in runChargeFlow GPOMA-2349 ([8f94a75](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/8f94a753b497964aadc8bbee6f9a8783459ed7c8))
* improve loading spinner GPOMA-2349 ([6be74be](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/6be74be5c66a003e0190e3491be8a0e38b3829e2))
* suppress all dependency audit advisories (dev toolchain only) GPOMA-2349 ([b0c91ec](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b0c91ec2fc514965610462385f90d958b18b04c6))
* suppress fast-uri HIGH advisories GPOMA-2349 ([af9aa16](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/af9aa1663aeccab2ca940f1468c21bfebee8f164))
* update stress test to use new internal loading-spinner path GPOMA-2349 ([5ed3751](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/5ed3751bc5dbe823b46a610b87d20df3e069e288))

## [1.2.2](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/compare/browser-sdk-1.2.1...browser-sdk-1.2.2) (2026-06-16)


### Bug Fixes

* add k8s domain to readme  GPOMA-2322 ([beb0923](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/beb0923d7221c4c6492702d667d2570068ae8a63))
* add stress test GPOMA-2322 ([9fa803f](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/9fa803f32eff2857e4234a79b624a4be4ff63189))
* address CodeRabbit comments — stress test improvements and engines field GPOMA-2322 ([8e6e56b](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/8e6e56b410718f91bf7787b04f9b124472800305))
* correct duplicate id on failure status block in checkout example GPOMA-2322 ([d581d44](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/d581d44d7c8caf034ead8e3e6ae3eabd8a446234))
* default also server in checkout example GPOMA-2322 ([9468a1b](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/9468a1bef8c1830a1a99397efb9c8c2dd7dcbb13))
* disallow setting origin in applepay GPOMA-2322 ([cea3180](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/cea318090ce086453cfa466310f9d85eb2a72e09))
* don't await ctrl.result after cancel — CANCELED keeps result pending for retry GPOMA-2322 ([ccaadac](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/ccaadac22a49e378f7f0135efdb47659f84a2fb2))
* make success and failure appear the same to ensure demo success GPOMA-2322 ([c1f6a93](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/c1f6a93753d37887097a146fea6ce11096a88e23))
* remove checkout example entry from Vite build and serve.js GPOMA-2322 ([88ae654](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/88ae6548fa36300cee9fa2643611f3afe63088aa))
* remove return_url from charge GPOMA-2322 ([4715cb1](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/4715cb1f66066bb79cec26b66526377193f4d37c))
* replace example logo image GPOMA-2322 ([463a5ec](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/463a5ec8280c3e5bfb5683b8ba5dd46dfd37a70a))
* update tests to match new startApplePaySession signature (no origin param) GPOMA-2322 ([8d3717b](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/8d3717b4d12ad10ed84d45bd73b410f099103847))

## [1.2.1](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/compare/browser-sdk-1.2.0...browser-sdk-1.2.1) (2026-06-11)


### Bug Fixes

* hardcode dev credentials  GPOMA-2322 ([a4a703a](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/a4a703a771891e719bed8a2bb5cccbf829a83c17))
* improve browser readme GPOMA-2322 ([019c938](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/019c9382a1f2da05099ae66cac6358661971e679))

# [1.2.0](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/compare/browser-sdk-1.1.5...browser-sdk-1.2.0) (2026-06-11)


### Bug Fixes

* add red theme GPOMA-2322 ([699be57](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/699be57fbf2264d5c96c0988567822adb0e13b58))
* address CodeRabbit / reviewer comments GPOMA-2322 ([0fc7a11](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/0fc7a11a4a14148d365a1db596aa1b38e29cf259))
* address CodeRabbit / reviewer comments GPOMA-2322 ([bcbc1e5](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/bcbc1e50cd13d9759ec6b8e1ad857e612f655a9f))
* address CodeRabbit README comments GPOMA-2322 ([3b26d9c](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/3b26d9ceeb3cfcfa4971c0a1959d628ffbabaa53))
* deduplicate lockfile and move sonar into parallel block GPOMA-2322 ([c67cfcc](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/c67cfccbae0a0a4fee4f0aa80cf608227b680b8a))
* disable npm push, token requires 2fa GPOMA-2322 ([4a45ccf](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/4a45ccf3b515b9e0804bb33afed868144af88bcb))
* focus iframe GPOMA-2322 ([af8000e](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/af8000edfc790018aaba35a173450d777c9b96f6))
* gopay branding on payment card GPOMA-2322 ([34eccd4](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/34eccd413ef30abe6f1bcf8d371c8413e4839081))
* pipeline steps optimize GPOMA-2322 ([04d727b](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/04d727b926132662eaeccf787096d7f8fbbece8d))
* pretend always success GPOMA-2322 ([c3ff991](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/c3ff991d3a8f67d19802357fe30b79e18b0efab8))
* readme detail on npm push  GPOMA-2322 ([0310bcb](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/0310bcb02c8fa18a157412c549b84a330d35e083))
* reformat audit suppression entries to multi-line style GPOMA-2322 ([ad66e57](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/ad66e57c8e30b27e15d49efd8a2c0c6c2b2df09b))
* release GPOMA-2322 ([e4941d5](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/e4941d5c7713684b5671e4c1c455ee2a397e2412))
* release GPOMA-2322 ([adf6825](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/adf6825eeafa9dceb33bcf1e99c90d733d59ec52))
* revert sonar to run after tests (needs coverage artifacts) GPOMA-2322 ([8aa4c5d](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/8aa4c5dcacde5bdb57228bdd354cd00a5e7cfd62))
* suppress age-gated audit advisories GPOMA-2322 ([4738442](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/4738442ef914c9df8848a34b2d2beb41a21ef292))
* update Dockerfile workspace name to @gopaycz/gopay-js-sdk GPOMA-2322 ([f69640e](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/f69640e41c9ce8a908f9c71b30a0572ee9eec044))
* update stale comment in release configs to reflect disabled npm publishing GPOMA-2322 ([506d0b5](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/506d0b5924b74bbbd35c7ac9fe563ab47afbbda0))


### Features

* add demo checkout page GPOMA-2322 ([2bfd9de](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/2bfd9de62c4cfc888abac2e3e1aa9dd10a93800b))
* set up npm publish GPOMA-2322 ([ce5d8f0](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/ce5d8f0765fb32efb244b24e945eb38561e02813))

## [1.1.5](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/compare/browser-sdk-1.1.4...browser-sdk-1.1.5) (2026-06-09)


### Bug Fixes

* make return_url optional for charge calls GPOMA-2322 ([1496a8e](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/1496a8ecc4c7c6298dc1e73d8a970f2de715fb6f))

## [1.1.4](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/compare/browser-sdk-1.1.3...browser-sdk-1.1.4) (2026-06-09)


### Bug Fixes

* bump the sdk version on every change GPOMA-2322 ([499d79c](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/499d79c93eb396d8b13ef784ce9b5b18b8cda7e4))

## [1.1.3](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/compare/browser-sdk-1.1.2...browser-sdk-1.1.3) (2026-06-09)


### Bug Fixes

* remove iframe 3DS mode from browser SDK example GPOMA-2322 ([1d73c15](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/1d73c15fd4dc8479406216398843b5eb72e6f139))
* suppress age-gated dependency advisories (audit) GPOMA-2322 ([0ddbb1e](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/0ddbb1e0d2d06afec6e89d0ea3a66474bdab796f))
* update browser-sdk-version to current GPOMA-2322 ([a32c3ed](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/a32c3ed569de7ca3001a604775c676b23e7e790d))
* use full url for return url GPOMA-2322 ([fc3b425](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/fc3b425bf4abf83b9b3525fab3121f51537bf7a4))
* use the same options for all charges redirect/iframe GPOMA-2322 ([3e468ec](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/3e468ecedc30a168d1a9753eb65a8d6dfe2328b2))
* use the same options for all charges redirect/iframe GPOMA-2322 ([7f11303](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/7f11303eca237980539eb8f809aba54e917274c7))

## [1.1.2](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/compare/browser-sdk-1.1.1...browser-sdk-1.1.2) (2026-06-09)


### Bug Fixes

* close unused example sections GPOMA-2322 ([70a9fe1](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/70a9fe101ad254dc1ddac731b4a22af6ba9f2a1e))
* docker image will have the current version GPOMA-2322 ([d15d8f9](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/d15d8f9450be66406f346199f4aa35f8b93a5f8e))
* make return_url consistent GPOMA-2322 ([44ca53e](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/44ca53e3e2d7ecfb6ec13aeb4afa12343e7c8874))
* remove applepay mock GPOMA-2322 ([b4deb57](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b4deb573f715fe2ecddb20ebb004d7fb05c1f3bd))
* return_url is required by backend by mistake GPOMA-2322 ([3543b6a](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/3543b6a2258ca39a56df397abefe819b2d2903b3))

## [1.1.1](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/compare/browser-sdk-1.1.0...browser-sdk-1.1.1) (2026-06-05)


### Bug Fixes

* add example card encrypt GPOMA-2322 ([d910f37](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/d910f375a2cb8788c412cfcb1cf67023e0a5d26f))
* add iframe charge flow GPOMA-2322 ([e4409c0](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/e4409c01efc0ce64bb235e1a28316471b9a13f64))
* align placeholder text with page convention GPOMA-2322 ([3cf0ce2](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/3cf0ce2de5c33f39da95ff6af4a169cd2cdbafb6))
* always use shareable key auth GPOMA-2322 ([b218c27](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b218c27e8fb4b731b5ade3cea0359fcc083e4b02))
* **ci:** rewrite lcov SF paths so Sonar resolves coverage correctly GPOMA-2322 ([8a1ceb0](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/8a1ceb0a974477467237c1fb135f4ac9da814977))
* clean up button remounting GPOMA-2322 ([4befd24](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/4befd24b3ca4258f3eea20ec78c2613c5d00d920))
* clean up card-form iframe remount GPOMA-2322 ([ce5c996](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/ce5c996525e863c7063ef39f1bc0260703c067e7))
* don't mount iframe twice GPOMA-2322 ([1e4e7c2](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/1e4e7c29cba6b73170e1ef31f76b853f94b43ff6))
* enable example button when pay now enabled GPOMA-2322 ([edbbd67](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/edbbd670e4b0e317aae85604ac1391b067419461))
* example charge encrypted payload GPOMA-2322 ([23d0f2e](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/23d0f2e6ffc4fc74ffe172021badc651244e136c))
* fail-fast on onClick capture, guard stale card controller GPOMA-2322 ([d0fd54d](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/d0fd54de323c83b2d39ee222bfe7b2bc23c65136))
* fail-fast test assertions, prefillField helper, card-form remount guard GPOMA-2322 ([a44d22c](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/a44d22c6e1873b069c06f62e2cd6528247d464f9))
* fix stale type name in README and clear 3DS prompt on remount GPOMA-2322 ([d2fd6ab](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/d2fd6abb8c676f992b807183a6916d24136d7a00))
* readable pre-commit error GPOMA-2322 ([1d1cec3](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/1d1cec37165c2f35636f59952cd852190f3c1fce))
* rename publishableKey to shareableKey across SDK and example GPOMA-2322 ([5d19e9b](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/5d19e9bbeaa536954cd724e681d1f7f299ab1e33))
* rename shareable key GPOMA-2322 ([1966261](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/19662617287cb542f3ff6ccf493555972240aff2))
* **test:** improve browser-sdk test coverage GPOMA-2322 ([93f9d7f](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/93f9d7fae7ed44831f7ba06c2479f9c0e058ae44))
* **test:** improve test coverage GPOMA-2322 ([2cfb4eb](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/2cfb4eba0359f0b1d8266aa9daf3cdfbb51ad983))
* **test:** suppress noNonNullAssertion in wallets tests GPOMA-2322 ([e64088a](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/e64088ac167c95f50a4f0899e8b2ca7473f2b90c))

# [1.1.0](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/compare/browser-sdk-1.0.0...browser-sdk-1.1.0) (2026-06-02)


### Bug Fixes

* add typeof guard before .trim() in ID validators GPOMA-2311 ([42a00ae](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/42a00ae93c062baf177a7dd2fa97bbaaba0b76cb))
* add version and show on example page GPOMA-2311 ([4469207](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/4469207940f827516ec074aa10ca7885e55a219a))
* address CodeRabbit review comments GPOMA-2311 ([10ac0f6](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/10ac0f6e2099594cffaf3bf0c63d72d1268ee358))
* improve error logging GPOMA-2311 ([9800092](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/98000926ee4c6f5c6333f728b165e96903eb5ff6))
* remove refresh tokens GPOMA-2311 ([7267094](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/726709485f6fe495bc81d585cdd3c1c22146affa))
* sanitize id's GPOMA-2311 ([6da9f7c](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/6da9f7ca7dd6d443f05bee86629ba310259e1073))
* **sonar:** extract async payment-authorised handler to fix S2004 GPOMA-2311 ([671ba31](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/671ba3124c4a4258879367983f5ae9d9499a33f3))
* **sonar:** move wallet helpers to module scope, fix async event handler GPOMA-2311 ([4380c54](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/4380c549aefdbc70cd9fe4373257a8ea5da6d4e2))
* split example page to collapsible sections GPOMA-2311 ([e6ba695](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/e6ba695e6f099c53548c8eeb3ee7cca7849b51f1))
* **test:** add xpay tests GPOMA-2311 ([610331c](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/610331c7051bed27dd440433934c08c4a51f7d97))
* **test:** restore applePayLoadInfo deleted by refunds commit GPOMA-2311 ([0e4c4c0](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/0e4c4c05470eee79740a28f0d1e7e30ed679ca07))
* **tests:** add vi.unstubAllGlobals() to payments-module teardown GPOMA-2311 ([bd9eeab](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/bd9eeab0ef24400a092cf14b8925979ac44d8f12))
* **tests:** expand collapsible sections before browser smoke tests GPOMA-2311 ([0796d72](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/0796d726fe89e0d07df83d34f6f644d69b43fcea))
* **tests:** fix apple-pay-mock browser smoke test GPOMA-2311 ([ceed284](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/ceed284c60d14d982228a9133623775b74e45ce5)), closes [#bapplepay-mock-btn](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/issue/bapplepay-mock-btn) [#bapplepay-button-container](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/issue/bapplepay-button-container)
* **tests:** remove refresh token GPOMA-2311 ([c3c14ab](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/c3c14ab7d67473105a5003a79ab102eb26db8c34))
* type-safe 3DS narrowing, validate attachPayment args, typed JSON.parse GPOMA-2311 ([ed51c23](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/ed51c23aa6f43455f678d6cc8b22d2e6321f079c))
* unify ID validation via requireNonEmptyString in internal/core GPOMA-2311 ([78489ec](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/78489ec2e06c5d1c9a1c80e512053e0ad43c0e36))
* update apple pay validate merchant response schema GPOMA-2311 ([ef24150](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/ef24150038c82754893f2f44b4c07a3a36ecc25a))
* update examples GPOMA-2311 ([7a893cc](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/7a893cccb5c97f8c4ef07354746cedf7c2aeb87d))
* update packages GPOMA-2311 ([e9502dc](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/e9502dc9abaaeead3d5a233dc08072daa6503635))
* update readme GPOMA-2311 ([21b9913](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/21b9913a670612d5388c8a95e9c7b18aaf21bb6a))
* update tests GPOMA-2311 ([06e329d](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/06e329d06fd239519a96a4c57d55c50b1a3493ff))
* validate redirectUrl in manual 3DS mode and auto-unstub globals in tests GPOMA-2311 ([b643bdb](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b643bdbd6e9181f16a3da9b0b99f424e98fd044e))
* **wallets:** settled flag, getInfo try/catch, wrap JSON.parse token GPOMA-2311 ([d48a025](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/d48a0255e6443a86f96476724104271702e12604))


### Features

* add 3ds iframe redirect GPOMA-2311 ([4f026ef](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/4f026eff43b0e18aa36f17cb57a0666988f3f107))
* implement refunds GPOMA-2311 ([139599c](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/139599c6a7425ce18e683aa3bac989009dba9000))
* implement xpay buttons GPOMA-2311 ([2d21cec](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/2d21cec10dd75bba5dc7ef5f7d1a94d26e395709))
* update scopes by new schema GPOMA-2311 ([919953f](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/919953f3afc1091404b97e779590e33303ad055a))

# 1.0.0 (2026-05-25)


### Bug Fixes

* add /version endpoint GPOMA-2270 ([d62e900](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/d62e900d7c62436701b02a80b99a7af8ca13b993))
* add ApplePay real calls (in supported browsers) GPOMA-2195 ([eac1af2](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/eac1af2d60f8478055c74a0f7ae1a520dfebabc1))
* add circular imports check and dead export check GPOMA-2169 ([90201eb](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/90201ebf346d8cc221b47d36c95f9ff75c9045cb))
* add commitlint GPOMA-2169 ([50d8f7c](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/50d8f7c56ce123932a61517813da405ec30d18b9))
* add example page docker image GPOMA-2252 ([a590793](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/a590793fe473cd096a6b919288c7adf1a14f5e57))
* add github mirror pipeline step GPOMA-2233 ([cd5fdf2](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/cd5fdf2bf263867b18e87323039ff7d217eafeb7))
* address PR review issues GPOMA-2278 ([61fe87e](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/61fe87e2c7fecd6006664be20e3fdf2e306a0fd9))
* allow iframe origin GPOMA-2252 ([4681791](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/4681791d7bb256111999cbcddbade4a85a8625f2))
* apple Pay button rendering logic can hide native flow GPOMA-2278 ([b19240f](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b19240f9fd098d4bc09f7ab525cefb4ba6aec63e))
* biome rule useBlockStatements GPOMA-2278 ([72b3f69](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/72b3f69c850069544c6f96ee1b769301fc20b32f))
* button color GPOMA-2252 ([537ee46](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/537ee466bd27f2da5e5a53a5265fa41ed6987494))
* check for login info before attempting login GPOMA-2252 ([ce2c66b](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/ce2c66b8776920d85097963e0a1df35f3333f458))
* check for login info before attempting login GPOMA-2252 ([8e4a3e3](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/8e4a3e354cb71c8f024ca1d68a02b3efcb118e72))
* check for paymentid before firing network request GPOMA-2220 ([e110dd1](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/e110dd196378aa0f30b6fbdac8aff712fdbdd38b))
* check linkId GPOMA-2252 ([c61e14b](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/c61e14b8b8af07437febc40d2f8f65fee631ef3e))
* clamp maximum iframe height GPOMA-2220 ([34e6ee0](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/34e6ee02c44fcd1237d7914940bbf935a1ca0785))
* clean up package.json GPOMA-2220 ([57e2693](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/57e26939dcc5ab5ebe5cba200c1dbebb0ea6df24))
* clear client secret when setting clientId GPOMA-2252 ([b55bd7f](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b55bd7f7f106a04af72c5d8ceb3d8419eef3f987))
* clear issued-token cache on logout GPOMA-2278 ([14183ba](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/14183ba29f7b07a606a3256780f3b41601cd2856))
* clear tokens on clientId change GPOMA-2278 ([7147bbb](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/7147bbb225bc78ec28c3fa08dbde26f43d20f823))
* clear tokens when setting client secret GPOMA-2252 ([64f59fb](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/64f59fbc5d2a4bbd367c31b1006353d17222809c))
* coderabbit GPOMA-2194 ([f84c878](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/f84c8785f86d25d4db7686fcfa0101459ee22ddf))
* defer tearing down the previous session GPOMA-2278 ([31069fc](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/31069fc4547d79f42efaa17ffc9ce54fbe25678e))
* disable sourcemaps for improved security GPOMA-2220 ([8b06e8d](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/8b06e8d48eafe317e504c6fd7b910ba700ec3e52))
* do not call create payment after set token GPOMA-2220 ([c2a02fd](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/c2a02fd7a95f7fd2e503d12459524742c085d325))
* do not log complete response GPOMA-2220 ([f819dfe](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/f819dfe13ef607f2d5882d9c5f0d0ec4cb9078f4))
* docker handle sigint as well as sigterm GPOMA-2270 ([f05fb97](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/f05fb97ae727f5dc8420255b12dda6593219f93e))
* docker image path GPOMA-2270 ([77d7b86](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/77d7b8693fb888590562fdd1b3b6b8392436d178))
* docs GPOMA-2220 ([b1ae14f](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b1ae14fa40ea013889b67cb12690b0cab0b30956))
* **docs:** improve readme GPOMA-2220 ([64c2574](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/64c25740a2e5eef6bf1a696db6a592b9a9c4f9c3))
* **docs:** update scopes info GPOMA-2220 ([d8b8650](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/d8b865024a10a2f9347c1c94a573f683eaaf0115))
* don't put example in the docker name since i't only one docker GPOMA-2270 ([58c6afe](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/58c6afe3e06758627e5b5ced67eb31d273436c1f))
* e2e tests GPOMA-2278 ([b3dcb4d](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b3dcb4d8ab58c4f5428e542c08ef4d95666fa9a6))
* example check google pay loaded GPOMA-2196 ([d4955ef](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/d4955ef6b16f8b232980fd6af6a96f7cc642dd38))
* example logged-in badge lifecycle GPOMA-2252 ([a77e630](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/a77e630895389ce25365883263a5c228edd32786))
* exponential back-off on retry GPOMA-2278 ([af2aca6](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/af2aca66b0066d755b9f14cd690cf5a11dbe2000))
* force vite to rewrite env.js reference to base path GPOMA-2270 ([898227e](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/898227e0a2c229b50ebb7f23b642bd5f422baaa4))
* format html manually GPOMA-2169 ([a854bea](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/a854bea77bdd4c46445e75b6b6a7a06f5c4ec413))
* format package.json GPOMA-2169 ([3831b65](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/3831b65b80e94c2595ab9e539707f74aa58fea36))
* git login before push GPOMA-2278 ([6cf7eca](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/6cf7eca6085d7156899d5a5726bd93b21aa1c540))
* if action_url were to change, do not redirect again GPOMA-2278 ([3d24afc](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/3d24afc32e8f57f3e5d39d463cf7aa0632cf4d97))
* ignore claude tmp GPOMA-2278 ([9731553](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/9731553e12c0e38476912f7e9a537584f6db5978))
* improve 3ds iframe security GPOMA-2278 ([b33c3dd](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b33c3dd2b727da9ff4b26aec7b4a8390ac71a667))
* improve applepay cancel lifecycle GPOMA-2270 ([8964a7e](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/8964a7e22e8489cf1f5cf472787d1322440cc1ec))
* improve ApplePay polyfill lifecycle GPOMA-2195 ([763d8fd](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/763d8fd18ebb7b43616324116dbf0621686c4387))
* improve browserdata typing GPOMA-2278 ([5e88839](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/5e88839681e8dca930f0761e76f514c582129f1d))
* improve cancel and error handling GPOMA-2220 ([891aabd](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/891aabd2d67918d01e679b94fd8ea50cb8e5e65c))
* improve client auth flow GPOMA-2169 ([b87f86b](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b87f86b8147a6f40656b7333f0ecd123400da2f6))
* improve docs GPOMA-2195 ([8f69d08](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/8f69d081df88105e681e935fa85ef4334a24f523))
* improve error reporting, parse only json body GPOMA-2195 ([b40eb22](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b40eb22474c1b8f26f6e3c66183a03b2c74ca0a2))
* improve lifecycle GPOMA-2278 ([23ad90f](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/23ad90f7992319a739dc618ee0cffc62e70244c4))
* improve lint GPOMA-2169 ([8552e93](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/8552e9389c156f231788d7b513ac59f991dda65b))
* improve screen readers GPOMA-2278 ([54b1275](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/54b1275f8eaecc402e6514f34959f121568251fb))
* improve server url matching and shutdown GPOMA-2270 ([7c81cff](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/7c81cfff661684bc60de25242d04084e410db1f4))
* improve styling GPOMA-2278 ([0c8e885](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/0c8e8851cf084f53b5a620a6df3576f83170af5a))
* input validation in example GPOMA-2252 ([3a7a63d](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/3a7a63da82db500378154e535731956a209b65a5))
* internal api rename  GPOMA-2233 ([ac1eec4](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/ac1eec4de4b72563624ec1972fdfc4883d16aded))
* lint also shared files GPOMA-2278 ([52b9e25](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/52b9e25d82c6d8c49ffcd32de8f3c9cc932e4939))
* lint GPOMA-2270 ([5dbc252](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/5dbc2528b6050f0c0f0d9ae25991579f8a9b0239))
* lint ignore generated files GPOMA-2278 ([a161ec2](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/a161ec259cd4e01ae9f8d1f0e4d9434f4e3bf39a))
* make onMessage more readable GPOMA-2220 ([4c92a54](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/4c92a545fd02a27c5b9060e6911bf988afa5048d))
* make version artifact GPOMA-2252 ([f292d15](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/f292d15639b859dec14c171c5da9bfca247bf8ae))
* mask payment_secret input field GPOMA-2278 ([698fbd7](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/698fbd73ce48aa78db6a3269a3e8d3b4d4594da8))
* move function to upper scope GPOMA-2252 ([0e42144](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/0e42144b6fe1176eda417dc8d1ff52ea4eeb29ae))
* move test files and improve folder structure GPOMA-2194 ([9d1c28d](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/9d1c28db631d74fecc7f5d97959493e9a6413f9a))
* note why * origin is the only possible option GPOMA-2220 ([c25f637](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/c25f637e5ea45ba3e4c7b61f810e130eb5f1f939))
* note why * origin is the only possible option GPOMA-2220 ([d67b80b](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/d67b80b296fb8064965fa41421f9a654ff232db6))
* null paymentsApi before the async so any failure path leaves the SDK "not attached"  GPOMA-2278 ([fef6a76](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/fef6a76f7f038d49228342ad1d3940aed643e245))
* pin yarn version GPOMA-2169 ([a9698cd](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/a9698cd4da1f9df6d2fd6d0be2e1c3f2c0f0c800))
* pipeline paths GPOMA-2169 ([62fa76a](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/62fa76a0aa8120539c816206d5fc351726e2a5af))
* playwright server port GPOMA-2252 ([1f77ffa](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/1f77ffa8c39cadf7a28d29f8a129cb6f4bda735e))
* prevent example button inactive state GPOMA-2252 ([8642e75](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/8642e75b543b64dc5839ff4448f0036ce3efce32))
* prevent release fail  GPOMA-2220 ([f54ee55](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/f54ee559fbf886da707607f95026d6c6a1376256))
* prevent semver rollback in package metadata. GPOMA-2278 ([e55e3bb](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/e55e3bbb82a6f2b4f03fd2842e0526ab7da303c0))
* publish whole source on npm and allow source map GPOMA-2233 ([6ee79ea](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/6ee79ea687b5d6c7fb9ceb343c9a16e8ad7004e2))
* redact known sensitive information log leak GPOMA-2278 ([963f4f3](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/963f4f352bb7a7f9ea5db011b6ad4141a37e1118))
* redact payment_secret in error output, clear stale attach field GPOMA-2278 ([0cd0e4c](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/0cd0e4cbd0a68655178cfd03779fbbb74bd205ba))
* reduce cognitive complexity in onMessage handler GPOMA-2278 ([b2ab98d](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b2ab98d10701cd7a2c03bcd1da8c5df8fc7ef349))
* release bumper absolute path GPOMA-2278 ([ac7827b](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/ac7827b5171676f43602e6f72b62ac2688b91b28))
* release bumper GPOMA-2278 ([0aa1de0](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/0aa1de035c6bafd8e7de1126898272f48392d25c))
* release config GPOMA-2196 ([03c31af](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/03c31af01b555eb632982e708c3b85e340f4d042))
* release error GPOMA-2233 ([8eeac2d](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/8eeac2db639fd498097f6e3c13f3774059235b95))
* release GPOMA-2278 ([9976b5c](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/9976b5c7e193f0027f154a0bd6fca5c178adf3c3))
* release pipeline GPOMA-2233 ([109c0af](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/109c0af2eed4ffb5bf338b0d1af788da4f331c2e))
* remove duplicate pipeline steps GPOMA-2220 ([23f5c89](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/23f5c891a216fb91812510b00c9d380fe701706f))
* remove unused and add font theming GPOMA-2220 ([9c4d97a](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/9c4d97a87a11958bf63c1821b23c3b0499a7007c))
* remove unused dependency GPOMA-2194 ([5cc7c6b](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/5cc7c6b6d46ee18c956d181554213f070849f7ae))
* replace class with function expression GPOMA-2252 ([32c0246](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/32c0246abe0921035ee0e8ad0f413fc33844c124))
* restore createTokenStore and buildUrl exports from core GPOMA-2278 ([7f5de05](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/7f5de05489533ebc297f7ce02b66f8110a25965e))
* retry only idempotent http operations GPOMA-2278 ([68a78f5](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/68a78f5de5f006e86bf88f2ea853bb29b778489e))
* separate attach payment browser sdk step GPOMA-2278 ([b338e4a](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b338e4abdd662ed8fac6128914f10e4773b9ec55))
* serve extensionless files also GPOMA-2252 ([4df1c9e](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/4df1c9e06e440c95a7b551fd183095bfe420c2a7))
* server example without payment buttons GPOMA-2278 ([7eaad0c](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/7eaad0c49db14541227cd2743e0838bb6e2e1773))
* share types GPOMA-2220 ([7f8ad7e](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/7f8ad7e02e79b4aecb02ca44233a47b97223d8f0))
* shared version bumper GPOMA-2278 ([1fda495](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/1fda495f575e1cb33f7bd21ca5a267a6a29844c8))
* show qr code preview GPOMA-2194 ([04c33f4](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/04c33f409834577acdb22257cd9e7d97342c47f7))
* simplify styles GPOMA-2220 ([086758d](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/086758d1ef9d44b0c58a9f27234277435abf7730))
* simplify styles GPOMA-2220 ([bda62c0](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/bda62c025da2dadc6e4974c3309fe1cdd7c9fc41))
* svg rendering of qr code GPOMA-2278 ([d329512](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/d329512b6187fff4047dab57a6e9ad9130685800))
* **test:** improve test coverage GPOMA-2194 ([7abfb73](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/7abfb73313ed0305bc5bdb6a48f4acb6a8e06faf))
* **test:** improve test coverage GPOMA-2278 ([8273f0e](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/8273f0ef8804aaac6af189a1d7e993cc551e65be))
* **test:** remove race condition in playwright GPOMA-2194 ([12d6b26](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/12d6b26debc9ab509183633e612760709300e711))
* **test:** restore applePayLoadInfo to fix apple-pay-mock e2e test GPOMA-2278 ([ebd76e4](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/ebd76e4ca6587fc69fc477b3df7c23e1399c6996)), closes [#applepay-mock-btn](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/issue/applepay-mock-btn)
* tests GPOMA-2196 ([bd430b3](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/bd430b3ee350b0a064f16399ad5e592e173e4162))
* **test:** update  GPOMA-2278 ([7508f28](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/7508f28fd2631f9da450ce7a14701b3fd2b0f8f3))
* **test:** update tests GPOMA-2220 ([0bd1973](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/0bd19735051bef5b436fce8fd93b5b1aefaee15a))
* **test:** update tests to handle example log messages GPOMA-2220 ([3191916](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/3191916d5929065eeb406fe737440eecedbaa080))
* throw typed errors GPOMA-2278 ([228d9f7](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/228d9f74f7767fcaf32e46b4461f2b0b744c69aa))
* type all sdk errors GPOMA-2278 ([f32c08c](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/f32c08c9dbd96efd57d404a9a785bc9831bf2665))
* update apple polyfill comment GPOMA-2270 ([1ab1a40](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/1ab1a400ae3d17e18ec8fef356c0721b7867874f))
* update iframe security GPOMA-2220 ([e310ba4](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/e310ba49f5f45493085c95e470a01c86bc3ba1f2))
* update packages GPOMA-2194 ([490c39b](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/490c39b2b84b809b98e1dcf002602b51dfb5f676))
* update packages GPOMA-2220 ([46f2009](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/46f2009b78dc8b5e7b7d005cfe5bdceff210c703))
* update packages GPOMA-2220 ([6095b65](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/6095b653c9b5fd553647b9fb04e3f6e8b2ffe36e))
* update packages GPOMA-2233 ([287db0f](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/287db0f4bcf5bab473b66cf7ce0a56318103d489))
* update packages GPOMA-2252 ([99886ba](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/99886baf03b3c67bb7faf4c2d12e6ccc23b749e9))
* update packages GPOMA-2252 ([9f85ac7](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/9f85ac7728d964cf40291d78f0be144f170ca581))
* update schema GPOMA-2169 ([b7a904a](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b7a904a7e544c89f32fa9b5841249fb02d698137))
* update schema GPOMA-2220 ([6791517](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/6791517bd2218792e5bc96a6caf2de02220a029b))
* update schema GPOMA-2233 ([b3d916d](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b3d916d0c73184d848248c0e2f896cb388f7f0c3))
* update schema GPOMA-2278 ([3ce1aaf](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/3ce1aafbabc172e019862639c73e1db38c3c9250))
* update sonar exclusions to include generated types GPOMA-2169 ([4699af2](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/4699af25a168518d47f961f119a79da3e309dbbc))
* update tests GPOMA-2220 ([e5a7106](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/e5a71066e06b5abf9780a0bfc8dfe5fd51499a08))
* update yarn GPOMA-2169 ([b3811c7](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b3811c79aee2ebd65c272a4db6447b749ddef32d))
* update yarn GPOMA-2278 ([0cb0b96](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/0cb0b96bc374e07dd39082fd52e1f16df277adad))
* use base path when docker is deployed behind a reverse proxy GPOMA-2270 ([99a25ac](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/99a25acb7e99037c5ae3931df0a8dfe4cf7a2fc1))
* use base path when docker is deployed behind a reverse proxy GPOMA-2270 ([cfb4b23](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/cfb4b23205489986571b212dfa2f196ac46801f0))
* use expire from JWT GPOMA-2278 ([a5d75c0](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/a5d75c01a51bfcc719b1746635865ce098623a09))
* use just claude agents file GPOMA-2194 ([fa0638e](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/fa0638ed9353d7d5201168552ab1ebbcdfcd69ff))
* use less memory for docker GPOMA-2252 ([25e0561](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/25e0561a8ffecc68f92e43a2eac466efdd5799e0))
* use sdk error messages GPOMA-2278 ([c8555f9](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/c8555f90cb068ffc68a36170a0f03561d7896e70))
* use translation-neutral iframe titles GPOMA-2278 ([d507d47](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/d507d47a41ebb286c6369e5a0862a4239a4d3db3))
* validate auth token before setting GPOMA-2278 ([54e8503](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/54e850328347f2e61dcbbefdf08b1aec97041543))
* verify origins where possible GPOMA-2220 ([e3e042d](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/e3e042d036d2a8304b7da12456fb89fc5f810c4a))
* version tags without v GPOMA-2270 ([78023d7](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/78023d79088e94c1ffd9780b86796ddf9c9cc744))


### Features

* add ApplePay example and tests GPOMA-2195 ([aa7ccb1](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/aa7ccb1da2694ee5d6b036c6fa9a0359361485dd))
* add auth playwright test GPOMA-2169 ([edb89ae](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/edb89aee227744df0836837a8ebf99e2fbf340f3))
* add auth token lifecycle GPOMA-2169 ([1f30632](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/1f30632c346e67702a8ab3f26996b33fcf9ff6e3))
* add create payment call GPOMA-2169 ([8db7a55](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/8db7a556464ac08e4b0ebf66752032f2c1cc7f6d))
* add external payment button GPOMA-2220 ([09f2ee1](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/09f2ee1a3b779feb508e5d89c8177d27f50af26f))
* add Google Pay example GPOMA-2196 ([713faa9](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/713faa9ae9f4e6c9f5155157f1558f44d8588187))
* add iframe communitaction and add logging to example GPOMA-2220 ([36b2288](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/36b228833dbdc1cbd55f7493ba0d761532a7ea38))
* add info calls GPOMA-2169 ([6cc2468](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/6cc246875c3981a994423d833deebc4aeec0c722))
* add initial card payment flow GPOMA-2194 ([810e572](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/810e572292604528b9b7a23fd190324cb23155bf))
* add logout and structured error messages GPOMA-2195 ([828cadc](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/828cadc74f9b0b989b95552c07ae2f0ba0ee5b45))
* add payment create GPOMA-2169 ([a9674ca](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/a9674ca52c0fda4296900b016fb7526ea2f0312e))
* add playwright tests GPOMA-2169 ([87c2785](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/87c27854ae9573f15d6b9b5c9fcb059b7d525cc7))
* add recurrences GPOMA-2252 ([c17b959](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/c17b95923debc72deaa73973df9ac6382cea2c9b))
* add status calls GPOMA-2220 ([2a64bea](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/2a64bea7261f1de84572cc02225115a5d0ba3724))
* add tests GPOMA-2169 ([ca4fd21](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/ca4fd2112d44f6ff00a112b1e2e1d4bd9ac61890))
* add theming GPOMA-2220 ([2c40a24](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/2c40a24159fd89e0b9f503e3a163738731fdbcc7))
* add token browser flow GPOMA-2169 ([9a2abe2](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/9a2abe2c84e3178f65245d99c2214a4071f1adf1))
* add tools for ssl cert generation GPOMA-2194 ([9579b70](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/9579b70b129ad039bcb7d99d50da226f3be8f6d0))
* add typed custom theming GPOMA-2220 ([e1303f9](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/e1303f994f11567a096f22242686478423d78478))
* authenticate is now void and split scripts GPOMA-2194 ([5fa7cc5](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/5fa7cc5ada68dd36194d4ebee9b7e50a98cc99bb))
* enhance Apple Pay integration with new button styles and layout adjustments GPOMA-2194 ([22332bc](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/22332bc162b453a322bfed0678fcc498a059d585))
* example in vite + tailwind GPOMA-2194 ([b33f122](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b33f122a51d3764a286ddbabebb909f3b65da295))
* fetch iframe from api GPOMA-2220 ([025d04b](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/025d04ba89c957ff7c68b1844e33e73988a7a109))
* frame message controller GPOMA-2220 ([23387b9](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/23387b901828f45dd2817cd3d939a9a0fd4b7579))
* improve docs and error reporting GPOMA-2196 ([064295b](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/064295bfa65e81d2e44e78e1a62fe3b23e293207))
* improve error reporting and documentantion GPOMA-2169 ([da503b6](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/da503b6720ebc90a319e852f683986d75dcfb4ce))
* project structure ([8f73434](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/8f73434a4a5428c1d9c3f627ea527952a3fa28b0))
* remove ky dependency GPOMA-2220 ([41f41fe](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/41f41fe790b1e7ad6ccc2eb4f24dbc47a4216e52))
* send browser_data GPOMA-2220 ([a210154](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/a2101540347d8923fa9336096e0c1d64df634d9e))
* send locale to iframe instead of translations GPOMA-2220 ([466c763](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/466c763af74a2c71b74939fdb5cbb93bc84e049b))
* separate npm package deploy GPOMA-2278 ([44642b7](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/44642b7c4ca13e9e48a868b1c663aa228fffd291))
* separate npm package deploy GPOMA-2278 ([b9baffb](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/b9baffb0edad789ab2fc7c6bd600da1f38ec191d))
* simplify ApplePay flow and be more clear on charge example GPOMA-2194 ([921cd6d](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/921cd6db241a7494daf3cde9c5e887e9eb0e80a8))
* simplify card payment flow GPOMA-2194 ([a6d9b32](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/a6d9b328b361238c653b88f906d33c102e30e785))
* simplify card payment flow GPOMA-2194 ([12ded33](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/12ded3399caa7e8549ebf708cf8d4423d874cfd8))
* split sdk to server and client GPOMA-2270 ([f8e20e0](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/f8e20e01acd178e4ca009c63a35c133630affc53))
* split sdk to server and client GPOMA-2278 ([9c52790](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/9c52790e3c08b6835fd921dcd1c49e01c4d05678))
* support iframe height GPOMA-2220 ([a76936a](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/a76936a25d17b1c542d4e45fc49d4543d46f3dd6))
* update error handling GPOMA-2220 ([648aae2](https://bitbucket.org/gp-gopay/gp-gw-js-sdk/commits/648aae2503c1f573c4b28c5ada23aeed2cf0a45f))
