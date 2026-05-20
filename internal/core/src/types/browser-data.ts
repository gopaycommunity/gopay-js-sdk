import type { components } from './generated.js';

/** Browser context data collected for 3DS / fraud detection. */
export type BrowserData = components['schemas']['Browser-Data'] & {
    /** Client IP address. Not collected client-side; populated by the backend from the HTTP request. */
    ip?: string;
};
