import assert from 'node:assert/strict';
import test from 'node:test';
import { HTML } from '../../src/server/index.js';

for (const [saved, system, expected] of [
    ['dark', 'light', 'dark'],
    ['light', 'dark', 'light'],
    ['', 'dark', 'dark'],
    ['dark', undefined, 'dark']
]) {
    test(`saved theme ${saved || 'auto'} with system ${system}: ${expected}`, async () => {
        const result = await HTML({
            file: { src: '<html state-id="theme" color-scheme=""><head><meta name="color-scheme" content="light"></head><body></body></html>', pathname: '/index.html' },
            urlObject: new URL('https://example.test/index.html'),
            state: JSON.stringify({ theme: { 'color-scheme': saved } }),
            theme: system
        });
        assert.match(result, new RegExp(`color-scheme="${expected}"`));
        assert.match(result, new RegExp(`<meta name="color-scheme" content="${expected}">`));
    });
}
