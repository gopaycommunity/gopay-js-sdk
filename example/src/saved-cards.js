import { prefillCardToken, run } from './helpers.js';
import { sdk } from './sdk.js';

// Exchange the card form's JWE payload for a permanent card token.
// The returned token is prefilled into the tokenized-charge panel, so it can be
// charged straight away.
// Requires card:write scope.
// Example:
//   const { token } = await sdk.tokenizeEncryptedCard(payload);
export function runTokenizeEncryptedCard() {
    const payload = document.getElementById('tokenize-payload').value.trim();
    run(
        'tokenize-output',
        () => sdk.tokenizeEncryptedCard(payload),
        (result) => prefillCardToken(result),
    );
}

// Retrieve details of a stored permanent card token.
// Requires card:read scope.
// Example:
//   const card = await sdk.getCardDetails(cardId);
//   console.log(card.masked_pan, card.scheme);
export function runGetCardDetails() {
    const cardId = document.getElementById('card-details-id').value.trim();
    run('card-details-output', () => sdk.getCardDetails(cardId));
}

// Delete a stored permanent card token.
// Returns void (204 No Content) on success.
// Example:
//   await sdk.deleteCard(cardId);
export function runDeleteCard() {
    const cardId = document.getElementById('delete-card-id').value.trim();
    run('delete-card-output', async () => {
        await sdk.deleteCard(cardId);
        return { deleted: true, card_id: cardId };
    });
}
