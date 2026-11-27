// Builds the request/response body schema index used by the endpoint details view.
//
// Source: the official Microsoft Graph OpenAPI descriptions (v1.0 and beta) from
// microsoftgraph/msgraph-metadata. Those files are 45-70 MB each, far too large for
// the browser, so this script cuts them into small files under public/data/openapi:
//
//   paths/<segment>.json            permission path -> METHOD -> request/response schema
//   schemas/<version>/<bucket>.json model schemas, spread over SCHEMA_BUCKETS files
//
// Usage: node scripts/build-schemas.mjs [--cache <dir>]
//   --cache <dir>  keep/reuse the downloaded OpenAPI files in <dir>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const SCHEMA_BUCKETS = 64; // keep in sync with src/hooks/useOpenApi.ts
const PERMISSIONS_URL =
    'https://raw.githubusercontent.com/microsoftgraph/microsoft-graph-devx-content/refs/heads/master/permissions/new/permissions.json';
const OPENAPI_URL = (version) => `https://raw.githubusercontent.com/microsoftgraph/msgraph-metadata/master/openapi/${version}/openapi.yaml`;
// v1.0 wins when a path exists in both.
const VERSIONS = ['v1.0', 'beta'];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'data', 'openapi');
const cacheArg = process.argv.indexOf('--cache');
const cacheDir = cacheArg > -1 ? path.resolve(process.argv[cacheArg + 1]) : null;

const fetchText = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
    return response.text();
};

const loadOpenApi = async (version) => {
    const cached = cacheDir && path.join(cacheDir, `openapi-${version}.yaml`);
    let text;
    if (cached && fs.existsSync(cached)) {
        text = fs.readFileSync(cached, 'utf8');
    } else {
        console.log(`Downloading ${version} OpenAPI description...`);
        text = await fetchText(OPENAPI_URL(version));
        if (cached) {
            fs.mkdirSync(cacheDir, { recursive: true });
            fs.writeFileSync(cached, text);
        }
    }
    return yaml.load(text, { schema: yaml.JSON_SCHEMA });
};

// Permission paths are lowercased with anonymous placeholders ("/users/{id}/getmembergroups"),
// OpenAPI paths are not ("/users/{user-id}/getMemberGroups"). Reduce both to one shape.
const normalize = (p) =>
    p
        .toLowerCase()
        .replace(/microsoft\.graph\./g, '')
        .replace(/'?\{[^}]*\}'?/g, '{}')
        .replace(/\(\)/g, '');

// The permissions file addresses drives through their owner, OpenAPI only through /drives.
const candidates = (permissionPath) => {
    const n = normalize(permissionPath);
    const list = [n];
    const viaDrives = n.replace(/^\/(me|users\/\{\}|groups\/\{\}|sites\/\{\})\/drive\//, '/drives/{}/').replace('/root:/{}:', '/items/{}');
    if (viaDrives !== n) list.push(viaDrives);
    if (n.startsWith('/me/')) list.push('/users/{}' + n.slice(3));
    return list;
};

export const segmentOf = (permissionPath) =>
    (permissionPath.split('/')[1] || 'root')
        .toLowerCase()
        .replace(/\(.*$/, '')
        .replace(/[^a-z0-9$._-]/g, '_') || 'root';

const bucketOf = (name) => {
    let sum = 0;
    for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
    return sum % SCHEMA_BUCKETS;
};

const deref = (doc, node) => {
    let current = node;
    for (let i = 0; i < 5 && current && current.$ref && !current.$ref.startsWith('#/components/schemas/'); i++) {
        current = current.$ref
            .slice(2)
            .split('/')
            .reduce((o, key) => o?.[key], doc);
    }
    return current;
};

const pickContent = (content) => {
    if (!content) return null;
    const type = content['application/json'] ? 'application/json' : Object.keys(content)[0];
    if (!type) return null;
    return { contentType: type, schema: content[type].schema ?? null };
};

const describeOperation = (doc, operation) => {
    const entry = {};
    if (operation.summary) entry.summary = operation.summary;
    if (operation.externalDocs?.url) entry.docs = operation.externalDocs.url;

    const body = deref(doc, operation.requestBody);
    const request = pickContent(body?.content);
    if (request) entry.request = request;

    const status = Object.keys(operation.responses ?? {}).find((code) => /^2/.test(code));
    if (status) {
        const response = deref(doc, operation.responses[status]);
        entry.response = { status, ...(pickContent(response?.content) ?? {}) };
        if (response?.description) entry.response.description = response.description;
    }
    return entry;
};

const main = async () => {
    const permissions = JSON.parse(await fetchText(PERMISSIONS_URL)).permissions;
    const wanted = new Map(); // permission path -> Set<METHOD>
    for (const permission of Object.values(permissions)) {
        for (const pathSet of permission.pathSets ?? []) {
            for (const p of Object.keys(pathSet.paths)) {
                if (!wanted.has(p)) wanted.set(p, new Set());
                pathSet.methods.forEach((m) => wanted.get(p).add(m.toUpperCase()));
            }
        }
    }

    fs.rmSync(outDir, { recursive: true, force: true });
    const segments = {}; // segment -> permission path -> METHOD -> entry
    let matched = 0;
    let total = 0;
    for (const methods of wanted.values()) total += methods.size;

    for (const version of VERSIONS) {
        const doc = await loadOpenApi(version);
        const index = new Map();
        for (const p of Object.keys(doc.paths)) {
            const n = normalize(p);
            if (!index.has(n)) index.set(n, p);
        }

        for (const [permissionPath, methods] of wanted) {
            const openApiPath = candidates(permissionPath)
                .map((c) => index.get(c))
                .find(Boolean);
            if (!openApiPath) continue;
            for (const method of methods) {
                const operation = doc.paths[openApiPath][method.toLowerCase()];
                const bySegment = (segments[segmentOf(permissionPath)] ??= {});
                if (!operation || bySegment[permissionPath]?.[method]) continue;
                (bySegment[permissionPath] ??= {})[method] = { version, path: openApiPath, ...describeOperation(doc, operation) };
                matched++;
            }
        }

        const buckets = Array.from({ length: SCHEMA_BUCKETS }, () => ({}));
        for (const [name, schema] of Object.entries(doc.components.schemas)) buckets[bucketOf(name)][name] = schema;
        const schemaDir = path.join(outDir, 'schemas', version);
        fs.mkdirSync(schemaDir, { recursive: true });
        buckets.forEach((bucket, i) => fs.writeFileSync(path.join(schemaDir, `${i}.json`), JSON.stringify(bucket)));
        console.log(`${version}: ${Object.keys(doc.components.schemas).length} schemas`);
    }

    const pathsDir = path.join(outDir, 'paths');
    fs.mkdirSync(pathsDir, { recursive: true });
    for (const [segment, entries] of Object.entries(segments)) {
        fs.writeFileSync(path.join(pathsDir, `${segment}.json`), JSON.stringify(entries));
    }
    fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({ segments: Object.keys(segments).sort() }));
    console.log(`Matched ${matched} of ${total} permission endpoints (${Math.round((matched / total) * 100)}%) in ${Object.keys(segments).length} files`);
};

await main();
