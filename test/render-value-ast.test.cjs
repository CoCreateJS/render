const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../src/index.js'), 'utf8');
const functions = source.slice(source.indexOf('async function renderValue('), source.indexOf('async function renderKey('));
let context;
let received;

test.before(async () => {
    const { astAsync } = await import('../../CoCreate-utils/src/modules/ast/index.js');
    const { getValueFromObject } = await import('../../CoCreate-utils/src/modules/getValueFromObject.js');
    const window = { markdown: { render(value) { received = value; return '<p>Rendered</p>\n'; } } };
    context = vm.createContext({ astAsync, getValueFromObject, renderedNodes: new Map(), window, console });
    vm.runInContext(functions, context);
});

function render(expression, content = 'Message') {
    return context.renderValue({ nodeType: 1 }, { window: context.window, object: { content } }, expression, 'object', {}, 0);
}

test('AST returns HTML directly instead of looking it up as a data key', async () => {
    const content = '**Hello**, with (parentheses), "$value" and `code`';
    assert.equal(await render('{{$(window.markdown.render(object.content))}}', content), '<p>Rendered</p>\n');
    assert.equal(received, content);
});

test('nested placeholders resolve before the surrounding expression', async () => {
    assert.equal(await render('{{$(window.markdown.render("{{object.content}}"))}}', '**Hello**'), '<p>Rendered</p>\n');
    assert.equal(received, '**Hello**');
});

test('ordinary record placeholders retain their existing lookup behavior', async () => {
    assert.equal(await render('Message: {{object.content}}', 'Original'), 'Message: Original');
});

test('AST preserves false, zero and empty-string results', async () => {
    assert.equal(await render('{{$(false)}}'), 'false');
    assert.equal(await render('{{$(0)}}'), '0');
    assert.equal(await render('{{$("")}}'), '');
});


test('template expressions await asynchronous transformations before returning HTML', async () => {
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    context.window.markdown.renderAsync = async value => {
        await ready;
        assert.equal(value, "Initial message");
        return "<p>Ready and highlighted</p>";
    };
    const output = render('{{$(window.markdown.renderAsync(object.content))}}', "Initial message");
    release();
    assert.equal(await output, "<p>Ready and highlighted</p>");
    delete context.window.markdown.renderAsync;
});
