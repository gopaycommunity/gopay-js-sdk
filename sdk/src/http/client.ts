import type { GoPayConfig } from '../config.js';
import { BASE_URLS } from '../config.js';
import type { HttpMethod, RequestOptions } from './types.js';

export class HttpClient {
  readonly baseUrl: string;

  constructor(config: GoPayConfig) {
    this.baseUrl = BASE_URLS[config.environment ?? 'sandbox'];
  }

  async get<T>(_path: string, _options?: RequestOptions): Promise<T> {
    throw new Error('Not implemented');
  }

  async post<T>(_path: string, _body?: unknown, _options?: RequestOptions): Promise<T> {
    throw new Error('Not implemented');
  }

  async postForm<T>(
    _path: string,
    _form: Record<string, string>,
    _options?: RequestOptions,
  ): Promise<T> {
    throw new Error('Not implemented');
  }

  protected buildUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  protected buildHeaders(_method: HttpMethod, _options?: RequestOptions): Record<string, string> {
    throw new Error('Not implemented');
  }
}
