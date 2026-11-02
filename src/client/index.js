/********************************************************************************
 * Copyright (C) 2023 CoCreate and Contributors.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 ********************************************************************************/

// Commercial Licensing Information:
// For commercial use of this software without the copyleft provisions of the AGPLv3,
// you must obtain a commercial license from CoCreate LLC.
// For details, visit <https://CoCreateJS.com/licenses/> or contact us at sales@CoCreateJS.com.

/*globals CustomEvent*/
import Actions from "@cocreate/actions";
import Observer from "@cocreate/observer";
import {
    queryElements,
    getValueFromObject,
    dotNotationToObject,
    ObjectId,
    renderValue as renderValueUtility,
    uuid
} from "@cocreate/utils";
import "@cocreate/element-prototype";
import "./index.css";

/**
 *
 * @public
 * @environment client
 */
const sources = new Map();
/**
 *
 * @public
 * @environment client
 */
const renderedNodes = new Map();
const elementSelector = "[render-query]";

function getRenderContext(renderedNode, key) {
    const keys = renderedNode?.keys;
    if (!keys || Array.isArray(keys) || typeof keys !== "object") return;

    const contextKey = key || Object.keys(keys).at(-1);
    if (!contextKey || !keys[contextKey]) return;

    return {
        key: contextKey,
        keyPath: keys[contextKey].path,
        renderData: keys[contextKey].data,
        renderAs: keys[contextKey].renderAs
    };
}

function setRenderContext(renderedNode, context = {}) {
    if (!renderedNode.keys || Array.isArray(renderedNode.keys))
        renderedNode.keys = {};

    const contextKey =
        context.key || Object.keys(renderedNode.keys).at(-1) || "$default";
    const renderContext = renderedNode.keys[contextKey] || {};
    if (context.keyPath !== undefined)
        renderContext.path = context.keyPath;
    if (context.renderData !== undefined)
        renderContext.data = context.renderData;
    if (context.renderAs !== undefined)
        renderContext.renderAs = context.renderAs;

    // Reinsert the context so the last key always represents the active
    // render scope without requiring top-level key metadata.
    delete renderedNode.keys[contextKey];
    renderedNode.keys[contextKey] = renderContext;

    return {
        key: contextKey,
        keyPath: renderContext.path,
        renderData: renderContext.data,
        renderAs: renderContext.renderAs
    };
}

/**
 * Initializes elements based on specified rendering attributes. If a specific element is provided, it initializes that element.
 * If no element is provided, it queries and initializes all elements matching the defined selector criteria for rendering attributes.
 *
 * Supported rendering attributes:
 * - render-query: [Describe what this attribute does]
 *
 * @param {(Element|Element[]|HTMLCollection|null)} [element] - Optional. A single element, an array of elements, an HTMLCollection, or null.
 * - If an HTMLCollection or an array of elements is provided, each element in the collection/array is initialized.
 * - If a single element is provided, only that element is initialized.
 * - If null or omitted, the function queries and initializes all elements matching the 'elementSelector'.
 * @private
 * @environment client
 */
function init(element) {
    if (
        element &&
        !(element instanceof HTMLCollection) &&
        !Array.isArray(element)
    )
        element = [element];
    else if (!element) element = document.querySelectorAll(elementSelector);

    for (let i = 0; i < element.length; i++) {
        let source = sources.get(element[i]);
        if (!source) {
            sources.set(element[i], { element: element[i] });
            element[i].renderValue = async (data) =>
                await render({ source: element[i], data });
            element[i].getData = () => sources.get(element[i]).data;
        }

        let dataAttr = element[i].getAttribute("render-data");

        if (dataAttr) {
            try {
                // Parse the string into a usable object
                const parsedData = JSON.parse(dataAttr);

                // Ensure the method exists before calling it
                if (typeof element[i].renderValue === "function") {
                    element[i].renderValue(parsedData);
                }
            } catch (error) {
                console.error("Failed to parse render-data:", error);
            }
        }
    }
}

/**
 * Asynchronously renders content based on the provided parameters. This function handles the rendering logic for elements
 * based on data sources, selectors, and other options.
 *
 * @param {Object} options - An object containing the parameters for rendering.
 * @param {Object} options.source - The data source used for rendering.
 * @param {Element} options.element - The DOM element where content will be rendered.
 * @param {string} options.selector - CSS selector to specify target elements for rendering.
 * @param {Object} options.data - Data to be used in rendering.
 * @param {string} [options.key] - Optional key to reference specific parts of the data.
 * @param {number} [options.index] - Optional index, typically used when rendering lists or arrays.
 * @param {number} [options.currentIndex] - The current index in a list or array rendering process.
 * @param {boolean} [options.update] - Flag to indicate if the rendering should update existing content.
 * @param {boolean} [options.remove] - Flag to indicate if the rendering should remove elements instead of updating or appending.
 * @public
 * @environment client
 */
async function render({
    source,
    element,
    selector,
    data,
    key,
    index,
    currentIndex,
    update,
    remove
}) {
    if (!data || (!source && !data)) {
        return;
    }

    if (!element) {
        if (source instanceof HTMLElement) {
            if (selector || (selector = source.getAttribute("render-query"))) {
                element = queryElements({
                    element: source,
                    selector
                });
            } else if (source.children.length > 0) {
                element = Array.from(source.children).find((child) =>
                    child.matches("template, [template], .template, [render]")
                );
                if (!element) {
                    element = source.querySelector(
                        "template, [template], .template, [render]"
                    );
                }
            }
        } else if (selector) {
            element = queryElements({
                selector
            });
        }

        if (!element || (Array.isArray(element) && !element.length)) {
            return;
        }
    }

    if (!key) {
        if (source instanceof HTMLElement) {
            key =
                source.getAttribute("render") ||
                source.getAttribute("key") ||
                data.type;
        } else {
            key = data.type;
        }
        if (!key || key === "key") {
            key = "object";
        } else if (key === "{}" || (!key && data.method)) {
            key = data.method ? data.method.split(".")[0] : undefined;
        }
        if (!key) {
            return;
        }
    }

    if (data.filter) {
        update ??= data.filter.update;
        remove ??= data.filter.remove;

        const isMutation = remove || update || data.filter.create;
        if (index == null) {
            index = isMutation
                ? data.filter.index
                : data.filter.startingIndex ?? data.filter.index;
        }
    }

    let isMutation = remove || update || (data.filter && data.filter.create);

    let sourceData = sources.get(source);
    if (!sourceData) {
        sourceData = { element: source, data: { ...data } };
        sources.set(source, sourceData);
    } else if (!isMutation) {
        // Only overwrite the master list if this is a full read, not a patch/mutation!
        if (data !== sourceData.data) {
            sourceData.data = { ...data };
        }
    }

    if (
        !Array.isArray(element) &&
        !(element instanceof HTMLCollection) &&
        !(element instanceof NodeList)
    ) {
        element = [element];
    }

    const renderedNodesToClear = new Set();

    for (let i = 0; i < element.length; i++) {
        let renderedNode = renderedNodes.get(element[i]);
        if (renderedNode) {
            if (
                renderedNode.clones &&
                renderedNode.source &&
                renderedNode.source.element
            ) {
                let limit =
                    renderedNode.source.element.getAttribute("render-limit");
                if (limit && renderedNode.clones.size >= parseInt(limit))
                    continue;
            }
        } else {
            renderedNode = {
                element: element[i],
                source: sourceData,
                clones: new Map()
            };
            renderedNodes.set(element[i], renderedNode);
        }
        renderedNodesToClear.add(renderedNode);

        let clones = renderedNode.clones; // || renderedNode.template.clones..
        if (!clones && renderedNode.template) {
            clones = renderedNode.template.clones;
            console.log("renderedNode.template.clones", clones);
        }

        key = element[i].getAttribute("render") || key;
        let renderedSource = renderedNode.source;
        if (!renderedSource) {
            if (renderedNode.parent && renderedNode.parent.template) {
                renderedSource = renderedNode.parent.template.source;
            }
        }
        let renderType;
        if (renderedSource && renderedSource.element) {
            renderType = renderedSource.element.getAttribute("render-type");
        }

        let clone;
        if (remove) {
            const removedItems = data[key];
            if (!Array.isArray(removedItems) || !clones) continue;

            for (let j = 0; j < removedItems.length; j++) {
                let cloneKey;
                if (key === "object") {
                    cloneKey = removedItems[j]._id;
                } else {
                    cloneKey = removedItems[j].name;
                }

                clone = clones.get(cloneKey);
                if (!clone) continue;

                clones.delete(cloneKey);
                renderedNodes.delete(clone);
                clone.remove();
            }
        } else if (
            (key && (Array.isArray(data[key]) || renderType)) ||
            Array.isArray(data)
        ) {
            if (update && renderType !== "object") {
                for (let j = 0; j < data[key].length; j++) {
                    if (key === "object") {
                        clone = clones.get(data[key][j]._id);
                    } else {
                        clone = clones.get(data[key][j].name);
                    }

                    if (currentIndex == null)
                        currentIndex = data.filter.currentIndex;

                    if (!clone) continue;

                    await renderValues(clone, { object: data[key][j] });
                    if (currentIndex >= 0)
                        insertElement(renderedNode, clone, index, currentIndex);
                }
            } else {
                // TODO: if $auto here every subsequent clone will have same value, not replacing here will apply unique value to each clone
                if (key === "$auto")
                    key = key.replace(/\$auto/g, uuid(6));

                if (key) element[i].setAttribute("render", key);

                await renderTemplate(element[i], data, key, index);
            }
        } else {
            let renderAs = element[i].getAttribute("render-as") || key;
            await renderValues(element[i], data, key, renderAs);
        }
    }
    for (const renderedNode of renderedNodesToClear) {
        clearRendering(renderedNode);
    }

    // Dispatch input and change events after rendering is complete
    if (source instanceof HTMLElement) {
        source.dispatchEvent(new Event("input"));
        source.dispatchEvent(new Event("change"));
    }
}

async function renderTemplate(template, data, key, index, keyPath) {
    if (template && template.nodeType !== 1) {
        template = template.ownerElement || template.parentElement;
    }
    if (!template) return;
    if (template instanceof HTMLTemplateElement && !template.content.firstElementChild) return;
    let templateData = renderedNodes.get(template);
    if (!templateData) {
        templateData = {
            element: template,
            clones: new Map(),
            isTemplate: true
        };
        renderedNodes.set(template, templateData);
    }

    templateData.element = template;
    if (!templateData.clones) templateData.clones = new Map();
    templateData.isTemplate = true;

    if (!templateData.parent && !templateData.source) {
        let parentRender = template.parentElement.closest("[render]")
        if (parentRender || template.source)
            templateData.parent = renderedNodes.get(parentRender) || template.source
        else
            console.log("template parent missing is there no parent or is this an error? and source is", templateData.source)
    }

    if (!templateData.source && templateData.parent && templateData.parent.source) {
        templateData.source = templateData.parent.source
    }

    let renderData;
    if (key) {
        renderData = getRenderValue(templateData.element, data, key);
    }

    if (renderData === undefined || renderData === null) {
        renderData = key ? [] : data;
    }

    let el = templateData.element;
    if (el.nodeType !== 1) {
        el = templateData.parent.element;
    }

    let renderAs =
        el.getAttribute("render-as") ||
        el.getAttribute("render") ||
        getRenderContext(templateData, key)?.renderAs ||
        key;
    const parentContext = getRenderContext(templateData.parent);
    const resolvedKeyPath =
        keyPath || key || parentContext?.keyPath;
    const templateContext = setRenderContext(templateData, {
        key,
        keyPath: resolvedKeyPath,
        renderData,
        renderAs
    });

    let renderType;
    if (templateData.source && templateData.source.element)
        renderType = templateData.source.element.getAttribute("render-type");

    const renderReverse =
        templateData.source?.element?.getAttribute("render-reverse") ??
        el.getAttribute("render-reverse");

    let exclude = el.getAttribute("render-exclude") || "";
    if (exclude) {
        exclude = exclude.replace(/ /g, "").split(",");
    }
    const include = el.getAttribute("render-include");
    const includePattern = include ? new RegExp(include) : null;
    let reference = el.getAttribute("render-reference");

    const isLoadMore = data.filter?.loadMore && !data.filter?.overwrite;
    const appendIndex = templateData.clones.size;
    let isInsert = data.filter && (data.filter.create || data.filter.update);
    if (renderType !== "object") {
        if ((!isInsert && !isLoadMore && !index) || data.filter?.overwrite) {
            if (!templateData.clones) {
                return
                if (templateData.template) {
                    templateData.clones = templateData.template.clones
                } else if (templateData.parent && templateData.parent.template) {
                    templateData.clones = templateData.parent.template.clones
                }
            }

            for (const [key, element] of templateData.clones) {
                renderedNodes.delete(element);
                element.remove();
                templateData.clones.delete(key);
            }
        }
    }

    if ((key && !Array.isArray(renderData)) || renderType === "object") {
        if (renderType && Array.isArray(renderData) && renderData.length === 1)
            renderData = renderData[0];

        const keys = Object.keys(renderData);
        if (renderType === "object" && data.method?.endsWith(".read")) {
            const present = new Set(keys);
            for (const [id, element] of templateData.clones) {
                if (present.has(element.getAttribute("renderedKey"))) continue;
                renderedNodes.delete(element);
                element.remove();
                templateData.clones.delete(id);
            }
        }
        const fieldClones = new Map(
            Array.from(templateData.clones.values(), (element) => [
                element.getAttribute("renderedKey"),
                element
            ])
        );
        for (let i = 0; i < keys.length; i++) {
            let clone = fieldClones.get(keys[i]);
            clone = renderedNodes.get(clone);

            if (
                exclude.includes(keys[i]) ||
                (includePattern && !includePattern.test(keys[i])) ||
                (reference === "false" &&
                    ["$storage", "$database", "$array"].includes(key))
            ) {
                if (clone) {
                    renderedNodes.delete(clone.element);
                    clone.element.remove();
                    templateData.clones.delete(clone.element.getAttribute("eid"));
                }
                continue;
            }

            let value = renderData[keys[i]];
            let type = "string";

            if (Array.isArray(value)) type = "array";
            else if (typeof value == "object") type = "object";

            // Nested object templates still need fields from the source record.
            let Data = {
                ...data,
                [renderAs]: { key: keys[i], value, type }
            };

            if (!clone) {
                clone = cloneTemplate(templateData);
            } else {
                if (clone.renderedValue === value) {
                    continue;
                }
            }
            clone.renderedValue = value;

            let renderedKey = key.split(".");
            renderedKey = renderedKey[renderedKey.length - 1];

            const cloneKeyPath = `${templateContext.keyPath}.${renderedKey}`;
            clone.parentKey = renderedKey;
            clone.renderKey = key;
            setRenderContext(clone, {
                key: keys[i],
                keyPath: cloneKeyPath,
                renderData: Data,
                renderAs
            });
            clone.element.setAttribute("renderedKey", keys[i]);
            await renderValues(clone.element, Data, keys[i], renderAs);
            insertElement(templateData, clone.element, index);
            fieldClones.set(keys[i], clone.element);
        }
    } else {
        if (!key && !Array.isArray(renderData)) {
            key = "data";
            renderData = getValueFromObject(renderData, key);
            if (!renderAs) renderAs = key;
        }

        if (!renderData) {
            let clone = cloneTemplate(templateData);
            setRenderContext(clone, {
                key,
                keyPath: templateContext.keyPath,
                renderData: data,
                renderAs
            });
            await renderValues(clone.element, data, key, renderAs);
            insertElement(templateData, clone.element, index);
        } else {
            if (!Array.isArray(renderData)) renderData = [renderData];

            for (let i = 0; i < renderData.length; i++) {
                let clone = cloneTemplate(templateData);

                let test = clone.element.getAttribute("render-as");
                if (test) renderAs = test;

                const cloneKeyPath = `${templateContext.keyPath || ""}[${i}]`;

                let object;
                if (
                    typeof renderData[i] === "object" &&
                    renderData[i] !== null
                ) {
                    object = { ...renderData[i] };
                } else {
                    object = renderData[i];
                }

                for (let j = 0; j < exclude.length; j++)
                    delete object[exclude[j]];

                if (reference === "false") {
                    delete object.$storage;
                    delete object.$database;
                    delete object.$array;
                }

                if (renderAs) {
                    object = { [renderAs]: object };
                    if (renderAs.includes("."))
                        object = dotNotationToObject(object);
                } else object = object;

                let insertIndex;
                if (key !== "data") {
                    insertIndex = isLoadMore
                        ? appendIndex + i
                        : data.filter?.create && index != null
                            ? index + i
                            : i;
                }

                setRenderContext(clone, {
                    key,
                    keyPath: cloneKeyPath,
                    renderData: object,
                    renderAs
                });
                clone.index = insertIndex
                await renderValues(
                    clone.element,
                    object,
                    key,
                    renderAs,
                    null,
                    null,
                    insertIndex
                );
                insertElement(
                    templateData,
                    clone.element,
                    insertIndex,
                    "",
                    data,
                    renderReverse
                );
            }
        }
    }
}

function cloneTemplate(template) {
    let clone = template.element.cloneNode(true);
    let cloneTagName = clone.tagName;

    if (clone.tagName == "TEMPLATE") {
        clone = clone.content.firstElementChild;
        for (let attribute of template.element.attributes) {
            clone.setAttribute(attribute.name, attribute.value || "");
        }
    } else {
        clone.classList?.remove("template");
        clone.removeAttribute("template");
    }

    clone.setAttribute("render-clone", "");

    let renderAs = clone.getAttribute("render-as");
    if (renderAs === "$auto") {
        renderAs = uuid(6);
        clone = clone.outerHTML.replace(/\$auto/g, renderAs);
    }

    if (typeof clone === "string") {
        // TODO: Some elements are only allowed a specific element, need to find these elements and confirm proper rendering.
        let container;
        if (cloneTagName === "TR") container = document.createElement("tbody");
        else container = document.createElement("div");

        container.innerHTML = clone;
        clone = container.firstChild;
        container.remove();
    }

    let renderedNode = { template, element: clone };
    renderedNodes.set(clone, renderedNode);
    return renderedNode;
}

function getCloneIdentity(data, renderAs) {
    const value = renderAs ? getValueFromObject(data, renderAs) : data;
    if (!value || typeof value !== "object") return;

    for (const key of ["_id", "id", "object", "name", "key"]) {
        const identity = value[key];
        if (
            (typeof identity === "string" || typeof identity === "number") &&
            identity !== "" &&
            identity !== "{}" &&
            identity !== "[]"
        ) {
            return String(identity);
        }
    }
}

function insertElement(
    template,
    element,
    index,
    currentIndex,
    data,
    renderReverse
) {
    let eid = element.getAttribute("eid");
    if (!eid) {
        eid = uuid(6);
        element.setAttribute("eid", eid);
    }

    if (index !== null && index >= 0) {
        if (!template.clones) template = template.template;

        let item;
        let isNewClone = false;
        if (!currentIndex && currentIndex !== 0) {
            if (template.clones.has(eid)) return;
            item = [eid, element];
            isNewClone = true;
        }

        const clones = Array.from(template.clones);

        if (currentIndex || currentIndex === 0) {
            item = clones.splice(currentIndex, 1)[0];
        }

        if (data && data.filter && data.filter.startingIndex && !data.filter.loadMore)
            index += data.filter.startingIndex;
        clones.splice(index, 0, item); // Insert item into clones at the specified index

        if (isNewClone) trackRendering(template, element);

        if (renderReverse != null && renderReverse !== false && renderReverse !== "false") {
            // Chat-specific logic: reverse rendering but still inserting based on sorting
            if (clones[index + 1] && clones[index + 1][1] !== element) {
                clones[index + 1][1].insertAdjacentElement("afterend", element);
            } else if (clones[index] && clones[index][1] !== element) {
                clones[index][1].insertAdjacentElement("beforeend", element);
            } else {
                template.element.insertAdjacentElement("afterend", element);
            }
        } else {
            // Non-chat logic: handle ascending or descending order as usual
            if (clones[index + 1] && clones[index + 1][1] !== element) {
                clones[index + 1][1].insertAdjacentElement(
                    "beforebegin",
                    element
                );
            } else if (clones[index] && clones[index][1] !== element) {
                clones[index][1].insertAdjacentElement("afterend", element);
            } else {
                template.element.insertAdjacentElement("beforebegin", element);
            }
        }

        template.clones = new Map(clones);
    } else {
        const isNewClone = !template.clones.has(eid);
        if (isNewClone) trackRendering(template, element);
        template.clones.set(eid, element);
        template.element.insertAdjacentElement("beforebegin", element);
    }
}

function trackRendering(renderedNode, element) {
    element.classList.add("render-pending");
    if (!renderedNode.rendering) renderedNode.rendering = [];
    renderedNode.rendering.push(element);
}

function clearRendering(renderedNode) {
    if (!renderedNode?.rendering) return;

    const elements = renderedNode.rendering;
    delete renderedNode.rendering;

    setTimeout(() => {
        for (const element of elements) {
            element.classList.remove("render-pending");
        }
    }, 300);
}

async function renderValues(node, data, key, renderAs, keyPath, parent, index) {
    if (!data) return;

    let renderedNode = renderedNodes.get(node);
    if (!renderedNode) {
        renderedNode = { element: node };
        renderedNodes.set(node, renderedNode);
    }

    const previousContext = getRenderContext(renderedNode, key);
    if (!key) key = previousContext?.key;
    if (!renderAs) renderAs = previousContext?.renderAs;
    if (!keyPath) keyPath = previousContext?.keyPath;
    setRenderContext(renderedNode, {
        key,
        keyPath,
        renderData: data,
        renderAs
    });

    if (parent) renderedNode.parent = parent;

    if (node.nodeType == 1) {
        if (node.hasAttribute("render-clone")) {
            parent = renderedNode;

            const eid = getCloneIdentity(data, renderAs);
            if (eid) {
                let oldEid = renderedNode.eid;
                let temp = renderedNode.template;
                while (temp && !temp.clones)
                    temp = temp.template || temp.parent;

                if (temp?.clones && oldEid && oldEid !== eid) {
                    temp.clones.delete(oldEid);
                    temp.clones.set(eid, node);
                }

                renderedNode.eid = eid;

                node.setAttribute("eid", eid);
            }
        }

        for (let attr of Array.from(node.attributes)) {
            let name = attr.name;
            let value = attr.value;

            let renderedAttribute = renderedNodes.get(attr);
            if (!renderedAttribute) {
                renderedAttribute = {
                    placeholder: { name, value },
                    key,
                    renderAs,
                    parent: renderedNode
                };
                renderedNodes.set(attr, renderedAttribute);
            }

            let namePlaceholder = renderedAttribute.placeholder.name || name;
            let valuePlaceholder = renderedAttribute.placeholder.value || value;

            name = await renderValue(
                attr,
                data,
                namePlaceholder,
                renderAs,
                renderedAttribute,
                index
            );
            value = await renderValue(
                attr,
                data,
                valuePlaceholder,
                renderAs,
                renderedAttribute,
                index
            );
            if (namePlaceholder.includes("{{") && name && !name.includes("{{")) {
                if (name !== attr.name) {
                    node.removeAttribute(attr.name);
                    renderedNodes.delete(attr);
                }
                node.setAttribute(name, value ?? "");
                renderedNodes.set(node.getAttributeNode(name), renderedAttribute);
            } else if (name === undefined || name === null || name === "") {
                renderedNodes.delete(attr);
                node.removeAttribute(attr.name);
            } else if (
                name &&
                (value || value === "") &&
                (name !== attr.name || value !== attr.value)
            )
                node.setAttribute(name, value);
        }

        if (CoCreate.state) {
            if (node.hasAttribute("[state_id]"))
                CoCreate.state.initElement(node);
        }

        if (node.tagName === "SCRIPT" && node.src) {
            if (
                node.src.includes("CoCreate.js") ||
                node.src.includes("CoCreate.min.js")
            ) {
                node.remove();
                return;
            }
        }

        if (node.tagName === "LINK" && node.href) {
            if (
                node.href.includes("CoCreate.css") ||
                node.href.includes("CoCreate.min.css")
            ) {
                node.remove();
                return;
            }
        }

        // A nested render-query owns its template and descendants. Parent
        // rendering may resolve this controller's attributes, but its own
        // render cycle must populate its target.
        if (
            node.hasAttribute("render-query") &&
            !node.hasAttribute("render-clone")
        ) {
            return;
        }

        if (node.hasAttribute("render") && !node.hasAttribute("render-clone")) {
            let renderKey = node.getAttribute("render") || key
            await renderTemplate(node, data, renderKey);
        } else if (node.childNodes.length > 0) {
            for (let childNode of Array.from(node.childNodes)) {
                if (childNode.parentNode !== node) continue;
                await renderValues(
                    childNode,
                    data,
                    key,
                    renderAs,
                    keyPath,
                    parent,
                    index
                );
            }
        }
    } else if (node.nodeType == 3 || (node.nodeType == 8 && renderedNode.htmlEnd)) {
        let valueType = node.parentElement.getAttribute("value-type");

        let textContent, text;

        if (!renderedNode.placeholder && node.textContent.match(/{{(.*?)}}/))
            renderedNode.placeholder = node.textContent;

        if (!renderedNode.placeholder) return;
        textContent = renderedNode.placeholder || node.textContent;

        text = await renderValue(
            node,
            data,
            textContent,
            renderAs,
            renderedNode,
            index
        );

        if (text || text == "") {
            if (text != renderedNode.text) {
                renderedNode.text = text;

                if (valueType !== "html" && !renderedNode.htmlEnd) {
                    node.textContent = text;
                } else {
                    const content = document.createElement("div");
                    if (valueType === "html") content.innerHTML = text;
                    else content.textContent = text;

                    if (renderedNode.htmlEnd) {
                        // Replace this binding's output while retaining its original template.
                        let child = node.nextSibling;
                        while (child && child !== renderedNode.htmlEnd) {
                            const next = child.nextSibling;
                            child.remove();
                            child = next;
                        }
                        renderedNode.htmlEnd.before(...content.childNodes);
                    } else {
                        const start = document.createComment("render");
                        const end = document.createComment("/render");
                        renderedNodes.set(start, {
                            ...renderedNode,
                            element: start,
                            htmlEnd: end
                        });
                        renderedNodes.delete(node);
                        node.replaceWith(start, ...content.childNodes, end);
                    }
                }

                if (node.childNodes.length > 0) {
                    for (let childNode of node.childNodes) {
                        await renderValues(
                            childNode,
                            data,
                            key,
                            renderAs,
                            keyPath,
                            parent,
                            index
                        );
                    }
                }
            }
        }
    }
}

/**
 * Renders placeholders within a string using asynchronous AST calculations and data context binding.
 *
 * @param {Node} node - The target DOM node (attributes, text nodes, elements).
 * @param {Object} data - The contextual database record or dataset being rendered.
 * @param {string} placeholder - The raw template string containing double curly braces (e.g. "{{ $query('#input').value }}").
 * @param {string} renderAs - Optional alias scope context.
 * @param {HTMLElement} renderedNode - Optional target element where rendering applies.
 * @param {number} index - Optional current iteration index if rendering a list.
 * @returns {Promise<string>} - A promise resolving to the fully processed output string.
 * @public
 * @environment client
 */
async function renderValue(node, data, placeholder, renderAs, renderedNode, index) {
    return renderValueUtility(
        node,
        data,
        placeholder,
        renderAs,
        renderedNode,
        index,
        getRenderValue
    );
}

function getRenderValue(node, data, key, renderAs, renderIndex) {
    let operator;
    if (key.startsWith("$")) {
        let keys = key.split(".");
        operator = keys.shift();
        if (keys.length > 0) {
            key = keys.join(".");
        }
    }

    // Field reads can arrive wrapped under a literal dotted or bracketed key.
    const hasLiteralKey = Object.prototype.hasOwnProperty.call(data, key);
    const rootKey = key.split(/[.\[]/, 1)[0];
    const ownsRootScope =
        hasLiteralKey || Object.prototype.hasOwnProperty.call(data, rootKey);
    let value = hasLiteralKey
        ? data[key]
        : getValueFromObject(data, key);

    // Once the current scope owns a root (for example `object`), a missing
    // descendant must remain missing instead of leaking in from another
    // clone's ancestor/source data.
    if ((value === undefined || value === null) && node && !ownsRootScope) {
        let parentTemplate = node;
        do {
            let parentNode = renderedNodes.get(parentTemplate);
            if (parentNode) {
                if (
                    (value === undefined || value === null) &&
                    (parentNode.parent || parentNode.template)
                ) {
                    let Data,
                        eid,
                        parent = parentNode.parent || parentNode.template;
                    do {
                        const parentNodeContext = getRenderContext(parentNode);
                        const parentContext = getRenderContext(parent);
                        if (key.includes("keyPath")) {
                            value =
                                parentNodeContext?.keyPath ||
                                parentContext?.keyPath;
                        } else if (key.includes("parentKey")) {
                            value =
                                parentNode.parentKey ||
                                parent.parentKey ||
                                parent.parent.parentKey;
                        } else if (key.includes("renderAs")) {
                            value = renderAs;
                        } else if (key === "object" || key === "_id")
                            value = ObjectId().toString();
                        else if (key === "uuid") {
                            value = uuid(6);
                        } else if (parent.source) {
                            Data = parent.source.data;
                        } else if (parent.parent) {
                            parent = parent.parent;
                        } else if (parent.template) {
                            parent = parent.template;
                        } else {
                            parent = undefined;
                        }

                        if (!Data && parent && parent.eid) eid = parent.eid;
                    } while (
                        (value === undefined || value === null) &&
                        parent &&
                        !Data
                    );

                    if ((value === undefined || value === null) && Data) {
                        value = getValueFromObject(Data, key);
                    }
                    if (
                        (value === undefined || value === null) &&
                        key.includes(".")
                    ) {
                        let renderedData = getValueFromObject(
                            Data,
                            key.split(".")[0]
                        );
                        if (renderedData !== undefined && renderedData !== null) {
                            let index = renderIndex;
                            if (
                                index === undefined &&
                                (!parent.clones.size ||
                                    parent.clones.size === 1)
                            ) {
                                index = 0;
                            } else if (index === undefined && eid) {
                                index = Array.from(
                                    parent.clones.keys()
                                ).indexOf(eid);
                            }

                            if (index >= 0) {
                                Data = {
                                    [key.split(".")[0]]: renderedData[index]
                                };
                            }
                            value = getValueFromObject(Data, key);
                        }
                    }
                }
            }

            if (
                (value === undefined || value === null) &&
                parentTemplate.parentElement
            ) {
                parentTemplate =
                    parentTemplate.parentElement.closest("[render]");
            } else {
                parentTemplate = undefined;
            }
        } while ((value === undefined || value === null) && parentTemplate);
    }

    if (operator) {
        if (value) {
            console.log("return processed render value using operator", value);
        } else {
            console.log("return render operator", operator);
        }
    }

    return value;
}

async function renderKey(action) {
    // TODO: custom render-keys
    let element = action.element;
    let form = action.form || document;
    let params = action.params;

    if (!params) {
        params = "render-key";
    }

    let data = {};
    let selector = `[${params}]`;
    let elements = form.querySelectorAll(selector);
    for (let el of elements) {
        let attribute = el.getAttribute(params);
        if (attribute) data[attribute] = await el.getValue();
    }
    data = dotNotationToObject(data);
    let renderData = { data: { [params]: data } };

    let renderSelector = element.getAttribute("render-query");
    if (!renderSelector) return;

    renderData.selector = renderSelector;
    render(renderData);

    action.element.dispatchEvent(
        new CustomEvent("renderKey", {
            detail: { data }
        })
    );
}

Actions.init({
    name: "renderKey",
    callback: (action) => {
        renderKey(action);
    }
});

Actions.init({
    name: "render",
    callback: async (action) => {
        if (!action.form) return;

        let elements;
        if (action.params)
            elements = queryElements({
                element: action.element,
                selector: action.params,
                type: "selector"
            });
        else
            elements = queryElements({
                element: action.element,
                prefix: "render"
            });

        let data = await action.form.getData();
        let array = action.form.getAttribute("array");
        if (array) data = data.find((obj) => obj.array === array);
        for (let i = 0; i < elements.length; i++)
            await render({ source: elements[i], data });

        action.element.dispatchEvent(
            new CustomEvent("render", {
                detail: {}
            })
        );
    }
});

Observer.init({
    name: "render",
    types: ["addedNodes"],
    selector: elementSelector,
    callback: function (mutation) {
        init(mutation.target);
    }
});

Observer.init({
    name: "fileRender",
    types: ["attributes"],
    attributeFilter: ["render-query"],
    callback: async function (mutation) {
        render({
            element: mutation.target,
            data: await mutation.target.getValue()
        });
    }
});

Observer.init({
    name: "render",
    types: ["addedNodes"],
    selector: "[render-element]",
    callback: function (mutation) {
        if (mutation.target.hasAttribute("render-clone")) return;
        let parentElement = mutation.target.parentElement.closest("[render]");
        if (!parentElement) return;

        let renderedNode = renderedNodes.get(parentElement);
        let data;
        if (renderedNode) {
            const renderContext = getRenderContext(renderedNode);
            if (renderContext?.renderData) {
                data = renderContext.renderData;
            }
        } else {
            let sourceElement = mutation.target.parentElement.closest("[render-query]")
            let sourceData = sources.get(sourceElement);
            if (sourceData) {
                data = sourceData.data;
            }
        }
        if (data) {
            render({ element: mutation.target, data });
        }
    }
});

Observer.init({
    name: "renderNodesRemoved",
    types: ["removedNodes"],
    selector: "[render-clone]",
    callback: function (mutation) {
        if (mutation.target.parentElement) return;
        let renderedNode = renderedNodes.get(mutation.target);
        if (!renderedNode) return;
        renderedNode.template.clones.delete(renderedNode.eid);
        renderedNodes.delete(mutation.target);
    }
});

init();

export { render, renderValue, sources, renderedNodes };

/**
 *
 * @name array
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name eid
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name key
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name render
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name render-as
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name render-clone
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name render-data
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name render-exclude
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name render-include
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name render-limit
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name render-query
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name render-reference
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name render-reverse
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name render-type
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name renderedKey
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name template
 * @kind member
 * @attribute
 * @environment client
 */

/**
 *
 * @name value-type
 * @kind member
 * @attribute
 * @environment client
 */

/**
 * A simple render component in vanilla javascript. Easily configured using HTML5 attributes and/or JavaScript API.
 *
 * @module render
 * @environment client
 */

/**
 * Declarative selectors recognized by this module.
 *
 * @name declarative-selectors
 * @kind member
 * @selectors
 * @environment client
 * @example
 * ```json
 * [
 *   "[${params}]",
 *   "[render-element]",
 *   "[render-clone]",
 *   "[render-query]"
 * ]
 * ```
 */

/**
 * Declarative actions supported or registered by this module.
 *
 * @name declarative-actions
 * @kind member
 * @actions
 * @environment client
 * @example
 * ```json
 * [
 *   {
 *     "name": "render"
 *   },
 *   {
 *     "name": "renderKey"
 *   }
 * ]
 * ```
 */
