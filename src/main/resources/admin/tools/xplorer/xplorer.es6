var mustache = require('/lib/xp/mustache');
var portal = require('/lib/xp/portal');
var cacheLib = require('/lib/cache');
var contentLib = require('/lib/xp/content');
var contextLib = require('/lib/xp/context');


const HEX = "[0-9A-Za-z]";
const ID_PATTERN = `${HEX}{8}-${HEX}{4}-${HEX}{4}-${HEX}{4}-${HEX}{12}`;
const ID_RX = new RegExp(ID_PATTERN);
const ID_IN_JSON_RX = new RegExp(`"(${ID_PATTERN})"`, "g");

const LEGAL_BRANCHES = ["Master", "Draft"];
const LEGAL_TREE_ATTRIBUTES = ["id", "name", "type", "path"];

const treeCache = cacheLib.newCache({
   size: 75,
   expire: 1000 * 60 * 10   // 10 minutes
});

exports.get = function (req) {

    var view = resolve('xplorer.html');

    const idOrUrl = ((req.params.idOrUrl || "") + "").trim();

    let branch = ((req.params.branch || "") + "").trim();
    if (branch !== "master" && branch !== "draft") {
        branch = "draft";
        log.warning(`req.params.branch was: ${JSON.stringify(req.params.branch, null, 2)} - resetting to: "draft"`);
    }
    delete req.params.branch;


    const result = idOrUrl ? getContentByUrlOrId(idOrUrl, branch): undefined;
    const name = result ? result.displayName || result._name || "" : "";
    const path = result ?
        result._path :
        idOrUrl ?
            "No results found for path or ID '" + idOrUrl + "'. Try again." :
            "Enter a content path or ID";
    const type = result ? `<p>${result.type.replace(/:(.*)/g, ":<strong>$1</strong>")}</p>` : undefined;

    log.info("req.params (" + typeof req.params + "): " + JSON.stringify(req.params, null, 2));
    let showTree = req.params.showTree || "none";
    const hideData = req.params.hideData != null && req.params.hideData !== false && req.params.hideData !== "false";
    const hideTree = req.params.hideTree != null && req.params.hideTree !== false && req.params.hideTree !== "false";
    log.info("Hide-params: " + JSON.stringify({hideData, hideTree}, null, 2));

    let cutoffTree;
    try {
        cutoffTree = parseInt(req.params.cutoffTree);
        if (isNaN(cutoffTree) || cutoffTree < 0 || cutoffTree > 30) {
            throw Error(`Invalid cutoffTree value (${JSON.stringify(req.params.cutoffTree)}). Must be 0 - 30. Defaulting to 15.`);
        }
    } catch (e) {
        log.warning(e);
        cutoffTree = 15;
    }

    const cacheNamesPathsAndTypesById = {};

    let tree = undefined;
    let htmlResult = undefined;
    if (result) {
        log.info("result._id (" + typeof result._id + "): " + JSON.stringify(result._id, null, 2));
        const resultString = JSON.stringify(result);
        const allIds = [];
        const pattern = new RegExp(`"(${ID_PATTERN})"`, "g");
        var match;
        while (match = pattern.exec(resultString)) {
            const theMatch = match[1];
            if (theMatch !== result._id && allIds.indexOf(theMatch) === -1) {
                allIds.push(theMatch);
            }
        }

        //log.info("allIds (" + typeof allIds + "): " + JSON.stringify(allIds, null, 2));

        if (LEGAL_TREE_ATTRIBUTES.indexOf(showTree) !== -1) {
            const key = result._id + "_" + branch + "_" + cutoffTree;
            tree =
                treeCache.get( showTree + "_" + key, function() {
                    const subItemTree = { [result._id]: buildSubItemTree(result, null, branch, [result._id], cacheNamesPathsAndTypesById, cutoffTree) };
                    return buildTree(subItemTree, [], showTree, cacheNamesPathsAndTypesById);
                });

        } else {
            showTree = "none";
        }

        const makeLink = (match, id) => {
            const node = cacheNamesPathsAndTypesById[id];
            const title = (node) ? `title="${getToolTip(id, node)}" ` : "";

            return `<a ` +
                `class="tree-item" ` +
                `${title}"` +
                `href="javascript:displayContent('${id}')">${id}</a>`;
        };

        if (Object.keys(cacheNamesPathsAndTypesById).length === 0 ) {
            buildSubItemTree(result, null, branch, [result._id], cacheNamesPathsAndTypesById, 1);
        }

        htmlResult = JSON.stringify(result, null, 4)
                .replace(/\n/g, "<br/>")
                .replace(/ /g, "&nbsp;")
                .replace(ID_IN_JSON_RX, makeLink);
    }


    var model = {
        name,
        path,
        type,
        iconWhite: portal.assetUrl({path: 'xplorer_white.svg'}),
        iconBlack: portal.assetUrl({path: 'xplorer_white.svg'}),
        hideData,
        hideTree,
        tableHasRows: false, // Array.isArray(tableRows) && tableRows.length > 0,
        idOrUrl,
        url: req.path,
        branchSelection: LEGAL_BRANCHES
            .map( value => `<option value="${value.toLowerCase()}"${branch === value.toLowerCase() ? " selected" : ""}>${value}</option>\n` )
            .join(""),
        treeSelection: `<option value="none"${showTree === "none" ? " selected" : ""}>None</option>\n` +
            LEGAL_TREE_ATTRIBUTES
                .map( value => `<option value="${value}"${showTree === value ? " selected" : ""}>By ${value}</option>\n` )
                .join(""),
        cutoffTree,
        tree,
        //params: JSON.stringify(req.params),
        result: htmlResult
    };

    //log.info("model (" + typeof model + "): " + JSON.stringify(model, null, 2));
    log.info("----------------\n");

    return {
        contentType: 'text/html',
        body: mustache.render(view, model)
        // TODO: Display:
        //body:
    };
};


const getContentByUrlOrId = (urlOrId, branch) => {
    if (!ID_RX.test(urlOrId)) {
        // ID, not URL, presumably a path following the ID pattern will not occur (8


        if (!urlOrId.startsWith('/')) {
            urlOrId = `/${urlOrId}`;
        }
    }
    const query = {
        key: urlOrId,
        branch
    };

    log.info("getContentByUrlOrId: " + urlOrId);

    const result = contentLib.get(query);
    //log.info("result (" + typeof result + "): " + JSON.stringify(result, null, 2));

    return result;
};

function getNodeAndSubNodes(result, alreadyVisited, cacheNamesPathsAndTypesById) {
    //log.info("result._id (" + typeof result._id + "): " + JSON.stringify(result._id, null, 2));
    //log.info("displayName (" + typeof result.displayName + "): " + JSON.stringify(result.displayName, null, 2));
    //log.info("type (" + typeof result.type + "): " + JSON.stringify(result.type, null, 2));
    const resultString = JSON.stringify(result);
    const subItems = [];
    const ignored = [];
    const pattern = new RegExp(`"(${ID_PATTERN})"`, "g");
    var match;
    while (match = pattern.exec(resultString)) {
        const theMatch = match[1];
        const isNew = alreadyVisited.indexOf(theMatch) === -1;
        if (theMatch !== result._id && isNew) {
            subItems.push(theMatch);
        } else if (theMatch !== result._id && !isNew) {
            ignored.push(theMatch);
        }
    }
    //log.info("subItems (" + typeof subItems + "): " + JSON.stringify(subItems, null, 2));

    cacheNamesPathsAndTypesById[result._id] = {
        name: result.displayName,
        type: result.type,
        path: result._path,
        hasSubItems: !!(subItems && subItems.length > 0)
    };

    return {
        name: result.displayName,
        type: result.type,
        path: result._path,
        subItems,
        ignored: ignored.length > 0 ? ignored : undefined
    };
}

function buildSubItemTree(result, id, branch, alreadyVisited, cacheNamesPathsAndTypesById, depth) {
    if (depth <= 0) {
        return "-- TRUNCATED: max tree depth --";
    }

    if (!result) {
        result = getContentByUrlOrId(id, branch);
    }

    const nodeAndSubNodes = getNodeAndSubNodes(result, alreadyVisited, cacheNamesPathsAndTypesById);
    if (
        (nodeAndSubNodes.subItems && nodeAndSubNodes.subItems.length > 0) ||
        ((nodeAndSubNodes.ignored || []).length > 0)
    ) log.info("nodeAndSubNodes (" + typeof nodeAndSubNodes + "): " + JSON.stringify(nodeAndSubNodes, null, 2));

    alreadyVisited.push(...nodeAndSubNodes.subItems);
    if (alreadyVisited && alreadyVisited.length > 0) log.info("alreadyVisited (" + typeof alreadyVisited + "): " + JSON.stringify(alreadyVisited, null, 2) + "\n\n---\n\n");

    const subItems = {};
    nodeAndSubNodes.subItems.forEach( subId => {
        subItems[subId] = buildSubItemTree(null, subId, branch, alreadyVisited, cacheNamesPathsAndTypesById, depth - 1);
    });
    nodeAndSubNodes.subItems = (Object.keys(subItems).length > 0) ? subItems : undefined;

    return nodeAndSubNodes;
}

function getNodeText(id, node, showTree) {
    return (showTree === "id") ?
        id :
        (typeof node === "string") ?
            node :
            node[showTree];
}
function getToolTip(id, node) {
    return `ID: ${id}&#10;Name: ${node.name}&#10;Path: ${node.path}&#10;Type: ${node.type}`;
}
function buildTree(subItemTree, ignored, showTree, cacheNamesPathsAndTypesById) {
    const nodes = Object.keys(subItemTree).map( id => {
        const node = subItemTree[id];
        const nodeLink = "<a " +
            `class="tree-item" ` +
            `id="tree-item-${id}" ` +
            `data-id="${id}" ` +
            `href="javascript:displayContent('${id}')" ` +
            `title="${getToolTip(id, node)}">` +
            `${getNodeText(id, node, showTree)}` +
            `</a>`;

        return "<li>" +
            (!node.subItems ?
                nodeLink :
                ("<div>\n" + nodeLink + buildTree(node.subItems, node.ignored, showTree, cacheNamesPathsAndTypesById) + "</div>\n")
            ) +
            "</li>\n";
    });

    if (ignored && ignored.length > 0) {
        nodes.push(...ignored.map( id => {
            const node = cacheNamesPathsAndTypesById[id];
            return "<li><a " +
                `class="tree-item duplicate-tree-item duplicate-${id}" ` +
                `href="javascript:displayContent('${id}')" ` +
                `data-id="${id}" ` +
                `title="DUPLICATE: seen elsewhere in the tree, usually at a higher level.&#10;${node.hasSubItems ? "AT LEAST ONE SUBITEM IS NOT DISPLAYED... Follow the link or see the non-duplicate original to see the subitem(s).&#10;" : ""}&#10;${getToolTip(id, node)}">` +
                `<span class='dupe-tag'>DUPLICATE: </span>${getNodeText(id, node, showTree)}${node.hasSubItems ? "&nbsp;&#8230;" : ""}` +
                `</a></li>`;
        }));
    }

    return "<ul>\n" + nodes.join("") + "</ul>\n";
}
