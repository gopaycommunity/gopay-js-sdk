import { beforeAll, describe, expect, it } from 'vitest';
import {
    GoPayErrorCodes,
    GoPayHTTPError,
    type GoPaySDK,
} from '../../src/index.js';
import { createSandboxSdk } from './_helpers.js';

/**
 * Saved card tokens against the live gateway.
 *
 * A real token cannot be minted here: `tokenizeEncryptedCard` takes a JWE the
 * GoPay-hosted iframe produces from card data a customer typed, and this SDK
 * deliberately has no way to build one (see the `encryption` module note in
 * CLAUDE.md). So the happy path — tokenize, read, delete — is covered manually
 * alongside the charge flow on GPOMA-2517, and what runs here is every path
 * that does not need a card: the reads, the deletes, and the rejection of a
 * payload that is not a JWE.
 */
describe('cards — E2E', () => {
    let sdk: GoPaySDK;

    beforeAll(async () => {
        ({ sdk } = await createSandboxSdk(
            'attempt card tokenisation',
            'payment:write payment:read card:write card:read',
        ));
    });

    // These reject before any request is made, but beforeAll still
    // authenticates, so they are not runnable without the gateway.
    describe('argument validation', () => {
        it('rejects an empty cardId on getCardDetails', async () => {
            await expect(sdk.getCardDetails('')).rejects.toMatchObject({
                errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
            });
        });

        it('rejects an empty cardId on deleteCard', async () => {
            await expect(sdk.deleteCard('')).rejects.toMatchObject({
                errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
            });
        });

        it('rejects an empty payload on tokenizeEncryptedCard', async () => {
            await expect(sdk.tokenizeEncryptedCard('')).rejects.toMatchObject({
                errorCode: GoPayErrorCodes.INVALID_ARGUMENT,
            });
        });
    });

    describe('getCardDetails', () => {
        it('404s on an unknown card id', async () => {
            await expect(
                sdk.getCardDetails('9999999999'),
            ).rejects.toMatchObject({ name: 'GoPayHTTPError', status: 404 });
        });
    });

    describe('deleteCard', () => {
        it('404s on an unknown card id', async () => {
            // Not idempotent-on-missing: deleting a card that was never there is
            // an error, so a consumer retrying a delete has to tolerate the 404
            // rather than treat it as a failed delete.
            await expect(sdk.deleteCard('9999999999')).rejects.toMatchObject({
                name: 'GoPayHTTPError',
                status: 404,
            });
        });
    });

    describe('tokenizeEncryptedCard', () => {
        it('rejects a payload that is not a JWE', async () => {
            // Status asserted as a set: alpha9 answers 500 ("Cannot decrypt card
            // data") where a malformed payload should be a 400. Pinning 500
            // would make a gateway fix fail this suite.
            const err = await sdk
                .tokenizeEncryptedCard('not.a.jwe')
                .catch((e: unknown) => e);

            expect(err).toBeInstanceOf(GoPayHTTPError);
            expect([400, 500]).toContain((err as GoPayHTTPError).status);
        });
    });
});
