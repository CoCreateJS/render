import assert from 'node:assert/strict';
import test from 'node:test';
import { HTML } from '../../src/server/index.js';

const link = '<link rel="stylesheet" href="/component.css">';
const render = (src, options = {}) => HTML({
    file: { src, pathname: '/index.html' },
    urlObject: new URL('https://example.com/index.html'),
    ...options
});

for (const src of [link, `<section>${link}<p>Content</p></section>`, `<html><body>${link}</body></html>`]) {
    test(`preserves links without a head: ${src}`, async () => {
        assert.equal(await render(src), src);
    });
}

test('preserves links from recursively fetched fragments without creating a head', async () => {
    const result = await render('<main><div src="/component.html"></div></main>', {
        resolveFile: async () => ({ src: `<section>${link}<p>Content</p></section>` })
    });
    assert.doesNotMatch(result, /<head\b/i);
    assert.ok(result.includes(`<section>${link}<p>Content</p></section>`));
});

test('preserves links from data fragments without creating a head', async () => {
    const result = await render('<main><div array="components" key="src"></div></main>', {
        crud: { send: async () => ({ object: [{ src: `<section>${link}</section>` }] }) }
    });
    assert.doesNotMatch(result, /<head\b/i);
    assert.ok(result.includes(`<section>${link}</section>`));
});

test('moves and deduplicates nested fragment stylesheets into an existing head', async () => {
    const result = await render(`<html><head>${link}</head><body><div src="/component.html"></div></body></html>`, {
        resolveFile: async (pathname) => ({ src: pathname === '/component.html'
            ? `<section>${link}<div src="/nested.html"></div></section>`
            : '<link rel="stylesheet" href="/nested.css"><p>Nested</p>' })
    });
    const head = result.match(/<head>([\s\S]*?)<\/head>/)[1];
    assert.ok(head.includes(link));
    assert.ok(head.includes('href="/nested.css"'));
    assert.equal(result.split('href="/component.css"').length - 1, 1);
    assert.doesNotMatch(result.match(/<body>([\s\S]*?)<\/body>/)[1], /<link\b/);
});

for (const hasHead of [true, false]) {
    for (const useFileResolver of [true, false]) {
        test(`processes src → CRUD → src → CRUD with head=${hasHead}, resolver=${useFileResolver}`, async () => {
            const calls = [];
            const files = {
                '/component.html': `<section>${link}<div array="components" object="first" key="src"></div></section>`,
                '/nested.html': '<article><link rel="stylesheet" href="/nested.css"><div array="components" object="second" key="src"></div></article>'
            };
            const records = {
                first: '<aside><link rel="stylesheet" href="/data.css"><div src="/nested.html"></div></aside>',
                second: `<footer>${link}<strong>Deep content</strong></footer>`
            };
            const resolveFile = async (pathname) => {
                calls.push(pathname);
                assert.ok(files[pathname], `Unexpected file: ${pathname}`);
                return { src: files[pathname], headers: { "Cache-Control": "public" } };
            };
            const options = {
                ...(useFileResolver ? { resolveFile } : {}),
                crud: {
                    send: async (request) => {
                        if (request.array === 'files') {
                            return { object: [await resolveFile(request.filter.query.pathname)] };
                        }
                        const id = request.object._id;
                        calls.push(id);
                        assert.ok(records[id], `Unexpected record: ${id}`);
                        return { object: [{ src: records[id] }] };
                    }
                }
            };
            const content = '<main><div src="/component.html"></div></main>';
            const root = hasHead
                ? `<html><head><title>Root</title></head><body>${content}</body></html>`
                : content;
            const result = await render(root, options);
            assert.deepEqual(calls, ['/component.html', 'first', '/nested.html', 'second']);
            assert.ok(result.includes('<strong>Deep content</strong>'));
            assert.doesNotMatch(result, /error="/);
            if (hasHead) {
                const head = result.match(/<head>([\s\S]*?)<\/head>/)[1];
                for (const href of ['/component.css', '/data.css', '/nested.css']) {
                    assert.ok(head.includes(`href="${href}"`));
                    assert.equal(result.split(`href="${href}"`).length - 1, 1);
                }
                assert.equal(result.match(/<head>/g).length, 1);
                assert.doesNotMatch(result.match(/<body>([\s\S]*?)<\/body>/)[1], /<link\b/);
            } else {
                assert.doesNotMatch(result, /<(head|html|body)\b/i);
                assert.ok(result.includes(`<section>${link}`));
                assert.ok(result.includes(`<footer>${link}`));
                assert.ok(result.includes('<aside><link rel="stylesheet" href="/data.css">'));
                assert.ok(result.includes('<article><link rel="stylesheet" href="/nested.css">'));
            }
        });
    }
}
