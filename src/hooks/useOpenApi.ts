import { useEffect, useState } from 'react';
import type { Permission } from './usePermissions';

// Reads the files produced by scripts/build-schemas.mjs (public/data/openapi).
// Everything here degrades to "no schema available" when those files are missing.

const SCHEMA_BUCKETS = 64; // keep in sync with scripts/build-schemas.mjs
const BASE_URL = `${import.meta.env.BASE_URL}data/openapi/`;
const SCHEMA_REF_PREFIX = '#/components/schemas/';

export type JsonSchema = Record<string, unknown>;
export type GraphVersion = 'v1.0' | 'beta';

export interface BodyInfo {
    contentType?: string;
    schema?: JsonSchema | null;
}

export interface EndpointInfo {
    version: GraphVersion;
    /** Path as written in the OpenAPI description, with named placeholders. */
    path: string;
    summary?: string;
    docs?: string;
    request?: BodyInfo;
    response?: BodyInfo & { status: string; description?: string };
}

type SegmentFile = Record<string, Record<string, EndpointInfo>>;
export type EndpointLookup = (path: string, method: string) => EndpointInfo | undefined;

const cache = new Map<string, Promise<unknown>>();

const loadJson = <T>(file: string): Promise<T | null> => {
    let pending = cache.get(file);
    if (!pending) {
        pending = fetch(BASE_URL + file)
            .then((response) => (response.ok ? response.json() : null))
            .catch(() => null);
        cache.set(file, pending);
    }
    return pending as Promise<T | null>;
};

const segmentOf = (path: string) =>
    (path.split('/')[1] || 'root')
        .toLowerCase()
        .replace(/\(.*$/, '')
        .replace(/[^a-z0-9$._-]/g, '_') || 'root';

const bucketOf = (name: string) => {
    let sum = 0;
    for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
    return sum % SCHEMA_BUCKETS;
};

export const schemaNameFromRef = (ref: unknown): string | null =>
    typeof ref === 'string' && ref.startsWith(SCHEMA_REF_PREFIX) ? ref.slice(SCHEMA_REF_PREFIX.length) : null;

/** Model names referenced anywhere inside a schema, in order of appearance. */
export const collectSchemaRefs = (schema: unknown): string[] => {
    const names = new Set<string>();
    const walk = (node: unknown) => {
        if (Array.isArray(node)) {
            node.forEach(walk);
        } else if (node && typeof node === 'object') {
            for (const [key, value] of Object.entries(node)) {
                const name = key === '$ref' ? schemaNameFromRef(value) : null;
                if (name) names.add(name);
                else walk(value);
            }
        }
    };
    walk(schema);
    return [...names];
};

/** Request/response body information for the endpoints of one permission. */
export const useEndpointLookup = (permission: Permission | null): EndpointLookup => {
    const [segments, setSegments] = useState<Record<string, SegmentFile | null>>({});

    const wanted = new Set<string>();
    permission?.pathSets.forEach((pathSet) => Object.keys(pathSet.paths).forEach((path) => wanted.add(segmentOf(path))));
    const wantedKey = [...wanted].sort().join('|');

    useEffect(() => {
        if (!wantedKey) return;
        let cancelled = false;
        wantedKey.split('|').forEach((segment) => {
            loadJson<SegmentFile>(`paths/${segment}.json`).then((file) => {
                if (!cancelled) setSegments((current) => (segment in current ? current : { ...current, [segment]: file }));
            });
        });
        return () => {
            cancelled = true;
        };
    }, [wantedKey]);

    return (path, method) => segments[segmentOf(path)]?.[path]?.[method.toUpperCase()];
};

/** Loads a single model schema, e.g. "microsoft.graph.user"; null when it is unknown. */
export const loadSchema = async (version: GraphVersion, name: string): Promise<JsonSchema | null> => {
    const bucket = await loadJson<Record<string, JsonSchema>>(`schemas/${version}/${bucketOf(name)}.json`);
    return bucket?.[name] ?? null;
};

// Navigation properties are only returned on $expand; nesting stops at this depth.
const MAX_EXAMPLE_DEPTH = 6;

/** What the schema says about one field of an example body; mirrors the shape of the example. */
export interface FieldDoc {
    description?: string;
    /** Type label, e.g. "string (date-time)" or a model name such as "microsoft.graph.user". */
    type?: string;
    enum?: unknown[];
    nullable?: boolean;
    /** Docs of the properties, when the field is an object. */
    fields?: Record<string, FieldDoc>;
    /** Docs of the elements, when the field is an array. */
    items?: FieldDoc;
}

interface Built {
    value: unknown;
    doc: FieldDoc;
}

const exampleString = (schema: JsonSchema): string => {
    switch (schema.format) {
        case 'date-time':
            return '2026-01-01T00:00:00Z';
        case 'date':
            return '2026-01-01';
        case 'time':
            return '12:00:00';
        case 'duration':
            return 'PT1H';
        case 'uuid':
            return '00000000-0000-0000-0000-000000000000';
        case 'base64url':
            return 'base64-encoded-value';
        default:
            return 'string';
    }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Builds the JSON body a schema describes, with placeholder values and every model reference
 * resolved, plus the documentation of each field in it. Navigation properties are left out and
 * recursive models are cut off with {}.
 */
export const buildExample = async (version: GraphVersion, schema: unknown): Promise<Built> => {
    const build = async (node: unknown, stack: string[]): Promise<Built> => {
        if (!node || typeof node !== 'object') return { value: null, doc: {} };
        const s = node as JsonSchema;
        // What this node itself states; a wrapper (property) wins over what it points to.
        const own: FieldDoc = {};
        if (typeof s.description === 'string') own.description = s.description;
        if (s.nullable === true) own.nullable = true;
        const inherit = (inner: FieldDoc): FieldDoc => ({ ...inner, ...own });

        const refName = schemaNameFromRef(s.$ref);
        if (refName) {
            if (stack.includes(refName) || stack.length >= MAX_EXAMPLE_DEPTH) return { value: {}, doc: { ...own, type: refName } };
            const target = await build(await loadSchema(version, refName), [...stack, refName]);
            return { value: target.value, doc: inherit({ ...target.doc, type: refName }) };
        }

        const format = typeof s.format === 'string' ? ` (${s.format})` : '';
        const type = typeof s.type === 'string' ? s.type + format : undefined;

        if (s.default !== undefined) return { value: s.default, doc: { ...own, type } };
        if (Array.isArray(s.enum) && s.enum.length > 0) return { value: s.enum[0], doc: { ...own, type, enum: s.enum } };

        if (Array.isArray(s.allOf)) {
            const parts = await Promise.all([...s.allOf, { ...s, allOf: undefined, description: undefined }].map((part) => build(part, stack)));
            const objects = parts.filter((part) => isPlainObject(part.value));
            if (objects.length === 0) {
                const first = parts.find((part) => part.value !== null);
                return first ? { value: first.value, doc: inherit(first.doc) } : { value: null, doc: own };
            }
            return {
                value: Object.assign({}, ...objects.map((part) => part.value)),
                doc: { type: 'object', ...own, fields: Object.assign({}, ...objects.map((part) => part.doc.fields)) }
            };
        }
        // Graph writes nullable references as anyOf [ref, nullable object] and numbers as oneOf [number, string, ref].
        const alternatives = (s.anyOf ?? s.oneOf) as JsonSchema[] | undefined;
        if (Array.isArray(alternatives) && alternatives.length > 0) {
            const first = await build(alternatives[0], stack);
            if (alternatives.some((alternative) => alternative?.nullable === true)) own.nullable = true;
            return { value: first.value, doc: inherit(first.doc) };
        }

        if (isPlainObject(s.properties)) {
            const value: Record<string, unknown> = {};
            const fields: Record<string, FieldDoc> = {};
            for (const [name, property] of Object.entries(s.properties as Record<string, JsonSchema>)) {
                if (property?.['x-ms-navigationProperty']) continue;
                const built = await build(property, stack);
                value[name] = built.value;
                fields[name] = built.doc;
            }
            return { value, doc: { ...own, type: 'object', fields } };
        }

        switch (s.type) {
            case 'array': {
                if (!s.items) return { value: [], doc: { ...own, type } };
                const item = await build(s.items, stack);
                return { value: [item.value], doc: { ...own, type: item.doc.type ? `array of ${item.doc.type}` : 'array', items: item.doc } };
            }
            case 'string':
                return { value: exampleString(s), doc: { ...own, type } };
            case 'integer':
            case 'number':
                return { value: 0, doc: { ...own, type } };
            case 'boolean':
                return { value: true, doc: { ...own, type } };
            case 'object':
                return { value: {}, doc: { ...own, type } };
            default:
                return { value: null, doc: own };
        }
    };
    return build(schema, []);
};

export interface ExampleState {
    example: unknown;
    /** Field documentation for `example`, used for hover descriptions. */
    doc: FieldDoc | undefined;
    isLoading: boolean;
}

/** The example body for a schema; resolving its model references is asynchronous. */
export const useExample = (version: GraphVersion, schema: unknown): ExampleState => {
    const [built, setBuilt] = useState<{ schema: unknown; result: Built } | null>(null);

    useEffect(() => {
        let cancelled = false;
        buildExample(version, schema).then((result) => {
            if (!cancelled) setBuilt({ schema, result });
        });
        return () => {
            cancelled = true;
        };
    }, [version, schema]);

    const current = built && built.schema === schema ? built.result : null;
    return { example: current ? current.value : null, doc: current?.doc, isLoading: !current };
};

export interface SchemaState {
    schema: JsonSchema | null;
    isLoading: boolean;
}

/** A single model schema, e.g. "microsoft.graph.user". */
export const useSchema = (version: GraphVersion, name: string): SchemaState => {
    const key = `${version}/${name}`;
    const [loaded, setLoaded] = useState<{ key: string; schema: JsonSchema | null } | null>(null);

    useEffect(() => {
        let cancelled = false;
        loadSchema(version, name).then((schema) => {
            if (!cancelled) setLoaded({ key: `${version}/${name}`, schema });
        });
        return () => {
            cancelled = true;
        };
    }, [version, name]);

    const isCurrent = loaded?.key === key;
    return { schema: isCurrent ? loaded.schema : null, isLoading: !isCurrent };
};
