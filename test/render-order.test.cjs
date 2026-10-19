const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../src/index.js'), 'utf8');
const renderTemplate = source.slice(source.indexOf('async function renderTemplate('), source.indexOf('function cloneTemplate('));
const insertElement = source.slice(source.indexOf('function insertElement('), source.indexOf('async function renderValues('));
const regions = ['us-east-1', 'us-east-2', 'us-west-1', 'me-south-1'];

async function renderOrder({ templateReverse = null, sourceReverse, withSource = false } = {}) {
    const siblings = [];
    let nextId = 0;

    class Element {
        constructor(reverse = null) {
            this.nodeType = 1;
            this.attributes = new Map();
            if (reverse !== null) this.attributes.set('render-reverse', reverse);
        }
        getAttribute(name) { return this.attributes.get(name) ?? null; }
        setAttribute(name, value) { this.attributes.set(name, value); }
        insertAdjacentElement(position, element) {
            assert.ok(['beforebegin', 'afterend'].includes(position));
            const previous = siblings.indexOf(element);
            if (previous >= 0) siblings.splice(previous, 1);
            siblings.splice(siblings.indexOf(this) + (position === 'afterend' ? 1 : 0), 0, element);
        }
    }

    const template = new Element(templateReverse);
    template.setAttribute('render-as', 'region');
    siblings.push(template);
    const templateData = { element: template, clones: new Map(), parent: {} };
    if (withSource) templateData.source = { element: new Element(sourceReverse) };

    const context = vm.createContext({
        template,
        data: { regions: regions.map(region => ({ region })) },
        renderedNodes: new Map([[template, templateData]]),
        HTMLTemplateElement: class {},
        uuid: () => String(++nextId),
        getRenderValue: (element, data, key) => data[key],
        getRenderContext: () => undefined,
        setRenderContext: (node, context) => context,
        cloneTemplate: () => ({ element: new Element() }),
        // Value interpolation is independent of list insertion and reverse settings.
        renderValues: async (element, data) => { element.region = data.region.region; }
    });
    vm.runInContext(`${renderTemplate}\n${insertElement}\nglobalThis.done = renderTemplate(template, data, 'regions');`, context);
    await context.done;
    return siblings.filter(element => element !== template).map(element => element.region);
}

test('nested region arrays preserve input order without a source or reverse attribute', async () => {
    assert.deepEqual(await renderOrder(), regions);
});

test('a source with no reverse attribute preserves input order', async () => {
    assert.deepEqual(await renderOrder({ withSource: true }), regions);
});

test('false reverse settings preserve input order', async t => {
    for (const value of [false, 'false']) {
        await t.test(String(value) + ' (' + typeof value + ')', async () => {
            assert.deepEqual(await renderOrder({ templateReverse: value }), regions);
            assert.deepEqual(await renderOrder({ withSource: true, sourceReverse: value }), regions);
        });
    }
});

test('explicit reverse settings still reverse the list', async t => {
    for (const value of ['', true, 'true']) {
        await t.test(JSON.stringify(value), async () => {
            const expected = [...regions].reverse();
            assert.deepEqual(await renderOrder({ templateReverse: value }), expected);
            assert.deepEqual(await renderOrder({ withSource: true, sourceReverse: value }), expected);
        });
    }
});

test('template reverse settings apply when the source attribute is absent', async () => {
    assert.deepEqual(await renderOrder({ withSource: true, templateReverse: '' }), [...regions].reverse());
});

test('an explicit source setting takes precedence over the template', async () => {
    assert.deepEqual(await renderOrder({ withSource: true, sourceReverse: 'false', templateReverse: '' }), regions);
    assert.deepEqual(await renderOrder({ withSource: true, sourceReverse: '', templateReverse: 'false' }), [...regions].reverse());
});
