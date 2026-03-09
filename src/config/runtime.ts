import fetch from 'cross-fetch';
import { FetchLike, ResolveApiRootOptions } from '../types';

export function getDefaultFetch(): FetchLike {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis) as FetchLike;
  }
  return fetch as unknown as FetchLike;
}

export function getBrowserLocation(): ResolveApiRootOptions['location'] | undefined {
  if (typeof window === 'undefined' || !window.location) {
    return undefined;
  }

  return {
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    port: window.location.port,
    origin: window.location.origin
  };
}
