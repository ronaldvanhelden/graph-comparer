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
        loadJson<Record<string, JsonSchema>>(`schemas/${version}/${bucketOf(name)}.json`).then((bucket) => {
            if (!cancelled) setLoaded({ key: `${version}/${name}`, schema: bucket?.[name] ?? null });
        });
        return () => {
            cancelled = true;
        };
    }, [version, name]);

    const isCurrent = loaded?.key === key;
    return { schema: isCurrent ? loaded.schema : null, isLoading: !isCurrent };
};
