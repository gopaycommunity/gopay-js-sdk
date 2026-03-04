import type { GoPayConfig } from '../config.js';
import { BASE_URLS } from '../config.js';
import type { HttpMethod, RequestOptions } from './types.js';

export class HttpClient {
    readonly baseUrl: string;

    constructor(config: GoPayConfig) {
        this.baseUrl =
            config.baseUrl ?? BASE_URLS[config.environment ?? 'sandbox'];
    }

    async get<T>(_path: string, _options?: RequestOptions): Promise<T> {
        throw new Error('Not implemented');
    }

    async post<T>(
        _path: string,
        _body?: unknown,
        _options?: RequestOptions,
    ): Promise<T> {
        throw new Error('Not implemented');
    }

    async postForm<T>(
        path: string,
        form: Record<string, string>,
        options?: RequestOptions,
    ): Promise<T> {
        const url = this.buildUrl(path);
        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            ...options?.headers,
        };
        const body = new URLSearchParams(form).toString();
        const response = await fetch(url, { method: 'POST', headers, body });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json() as Promise<T>;
    }

    protected buildUrl(path: string): string {
        const base = this.baseUrl.endsWith('/')
            ? this.baseUrl
            : `${this.baseUrl}/`;
        const relative = path.startsWith('/') ? path.slice(1) : path;
        return new URL(relative, base).toString();
    }

    protected buildHeaders(
        _method: HttpMethod,
        _options?: RequestOptions,
    ): Record<string, string> {
        throw new Error('Not implemented');
    }
}
