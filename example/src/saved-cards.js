import { run } from './helpers.js';
import { sdk } from './sdk.js';

// Retrieve details of a stored permanent card token.
// Requires card:read scope.
// Example:
//   const card = await sdk.cards.getDetails(cardId);
//   console.log(card.masked_pan, card.scheme);
export function runGetCardDetails() {
    const cardId = document.getElementById('card-details-id').value.trim();
    run('card-details-output', () => sdk.cards.getDetails(cardId));
}

// Delete a stored permanent card token.
// Returns void (204 No Content) on success.
// Example:
//   await sdk.cards.deleteCard(cardId);
export function runDeleteCard() {
    const cardId = document.getElementById('delete-card-id').value.trim();
    run('delete-card-output', async () => {
        await sdk.cards.deleteCard(cardId);
        return { deleted: true, card_id: cardId };
    });
}
