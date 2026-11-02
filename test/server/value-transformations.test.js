import assert from 'node:assert/strict';
import test from 'node:test';
import { HTML } from '../../src/server/index.js';

const render = (src, options = {}) => HTML({
    file: { src, pathname: '/index.html' },
    urlObject: new URL('https://example.com/index.html'),
    ...options
});

test('API header replaces app placeholders during SSR and replaces its outer element', async () => {
    const include = String.raw`<header src="/components/offcanvas-app/header.html" value-replace="/\{\{app\.name\}\}/g" value-replacement="APIs" value-type="outerHtml"></header>`;
    const header = '<header><div aria-label="{{app.name}} views"><button aria-controls="{{app.name}}-details-view">Details</button></div></header>';
    const result = await render(include, { resolveFile: async () => ({ src: header }) });
    assert.doesNotMatch(result, /\{\{app\.name\}\}/);
    assert.match(result, /aria-label="APIs views"/);
    assert.match(result, /aria-controls="APIs-details-view"/);
    assert.equal((result.match(/<header\b/g) || []).length, 1);
    assert.doesNotMatch(result, /src="\/components\/offcanvas-app\/header.html"/);
});

test('replacement runs before resolving nested includes', async () => {
    const requests = [];
    const result = await render('<div src="/parent.html" value-replace="APP" value-replacement="apis"></div>', {
        resolveFile: async pathname => {
            requests.push(pathname);
            return { src: pathname === '/parent.html' ? '<div src="/APP/child.html"></div>' : '<p>Nested</p>' };
        }
    });
    assert.deepEqual(requests, ['/parent.html', '/apis/child.html']);
    assert.match(result, /<p>Nested<\/p>/);
});

test('setter overrides shared options and ignores getter options', async () => {
    const result = await render('<div src="/part.html" value-replace="NAME" value-replacement="shared" set-value-replacement="setter" get-value-replace="setter" get-value-replacement="getter"></div>', {
        resolveFile: async () => ({ src: '<p>NAME</p>' })
    });
    assert.match(result, /<p>setter<\/p>/);
});

test('explicit setter false disables a shared transformation', async () => {
    const result = await render('<div src="/part.html" value-uppercase set-value-uppercase="false"></div>', {
        resolveFile: async () => ({ src: '<p>Mixed</p>' })
    });
    assert.match(result, /<p>Mixed<\/p>/);
});

test('CRUD transformations are independent for elements sharing cached records', async () => {
    let requests = 0;
    const result = await render('<main><div array="parts" object="one" key="src" value-replace="NAME" value-replacement="First"></div><div array="parts" object="one" key="src" set-value-replace="NAME" set-value-replacement="Second"></div></main>', {
        crud: { send: async () => { requests++; return { object: [{ src: '<p>NAME</p>' }] }; } }
    });
    assert.equal(requests, 1);
    assert.match(result, /<p>First<\/p>/);
    assert.match(result, /<p>Second<\/p>/);
});

test('CRUD identity without a key preserves element content', async () => {
    let requests = 0;
    const result = await render(
        '<button array="ai-messages" object="message-id"><i>Delete</i></button>',
        {
            crud: {
                send: async () => {
                    requests++;
                    return { object: [{ content: 'must not render' }] };
                }
            }
        }
    );

    assert.equal(requests, 0);
    assert.match(result, /<button[^>]*><i>Delete<\/i><\/button>/);
    assert.doesNotMatch(result, /rendered(?:=|\s|>)/);
    assert.doesNotMatch(result, /must not render/);
});

test('decoding and type conversion work without browser globals', async () => {
    const result = await render('<div array="parts" key="src" set-value-decode="json" set-value-type="array.$keys"></div>', {
        crud: { send: async () => ({ object: [{ src: '{"name":"APIs"}' }] }) }
    });
    assert.match(result, /\[\s*"name"\s*\]/);
    const decoded = await render('<div src="/part.html" set-value-decode="html-entities"></div>', {
        resolveFile: async () => ({ src: '&lt;p&gt;&copy; APIs&lt;/p&gt;' })
    });
    assert.match(decoded, /<p>© APIs<\/p>/);
});
