import { Tooltip } from 'antd';
import type { ReactNode } from 'react';
import { schemaNameFromRef } from '../hooks/useOpenApi';
import type { FieldDoc } from '../hooks/useOpenApi';

const COLORS = {
    key: '#9CDCFE',
    string: '#CE9178',
    number: '#B5CEA8',
    literal: '#569CD6',
    punctuation: '#8C8C8C',
    link: '#50AF5BFF'
};

const INDENT = '  ';

interface JsonViewProps {
    value: unknown;
    /** Documentation matching the shape of `value`; documented fields show it on hover. */
    doc?: FieldDoc;
    /** Called with the model name when a "$ref" to a model schema is clicked. */
    onRefClick?: (schemaName: string) => void;
    maxHeight?: number;
}

const FieldTooltip = ({ name, doc }: { name: string; doc: FieldDoc }) => (
    <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
        <div>
            <strong>{name}</strong>
            {doc.type && <span style={{ color: COLORS.key }}> {doc.type}</span>}
            {doc.nullable && <span style={{ color: COLORS.punctuation }}> · nullable</span>}
        </div>
        {doc.description && <div style={{ marginTop: '4px', whiteSpace: 'pre-wrap' }}>{doc.description}</div>}
        {doc.enum && (
            <div style={{ marginTop: '4px' }}>
                <span style={{ color: COLORS.punctuation }}>One of: </span>
                {doc.enum.map(String).join(', ')}
            </div>
        )}
    </div>
);

const hasDocs = (doc: FieldDoc | undefined): doc is FieldDoc => Boolean(doc && (doc.description || doc.type || doc.enum));

/** Pretty-printed JSON with syntax highlighting and optional per-field documentation. */
export const JsonView = ({ value, doc, onRefClick, maxHeight = 420 }: JsonViewProps) => {
    const renderKey = (name: string, path: string, fieldDoc: FieldDoc | undefined) => {
        const label = JSON.stringify(name);
        if (!hasDocs(fieldDoc)) return <span style={{ color: COLORS.key }}>{label}</span>;
        return (
            <Tooltip key={path} title={<FieldTooltip name={name} doc={fieldDoc} />} placement='topLeft' mouseEnterDelay={0.15} styles={{ root: { maxWidth: 480 } }}>
                <span
                    style={{
                        color: COLORS.key,
                        cursor: 'help',
                        // Only fields that carry an actual description are marked
                        borderBottom: fieldDoc.description ? `1px dotted ${COLORS.punctuation}` : undefined
                    }}
                >
                    {label}
                </span>
            </Tooltip>
        );
    };

    const render = (node: unknown, indent: string, path: string, nodeDoc: FieldDoc | undefined, parentKey?: string): ReactNode => {
        if (node === null || node === undefined || typeof node === 'boolean') {
            return <span style={{ color: COLORS.literal }}>{String(node ?? null)}</span>;
        }
        if (typeof node === 'number') return <span style={{ color: COLORS.number }}>{node}</span>;
        if (typeof node === 'string') {
            const text = JSON.stringify(node);
            const schemaName = onRefClick && parentKey === '$ref' ? schemaNameFromRef(node) : null;
            return schemaName ? (
                <a
                    role='button'
                    title={`Show model ${schemaName}`}
                    onClick={() => onRefClick?.(schemaName)}
                    style={{ color: COLORS.link, textDecoration: 'underline', cursor: 'pointer' }}
                >
                    {text}
                </a>
            ) : (
                <span style={{ color: COLORS.string }}>{text}</span>
            );
        }

        const inner = indent + INDENT;
        if (Array.isArray(node)) {
            if (node.length === 0) return '[]';
            return (
                <>
                    {'[\n'}
                    {node.map((item, i) => (
                        <span key={i}>
                            {inner}
                            {render(item, inner, `${path}/${i}`, nodeDoc?.items)}
                            {i < node.length - 1 ? ',\n' : '\n'}
                        </span>
                    ))}
                    {indent + ']'}
                </>
            );
        }

        const entries = Object.entries(node as Record<string, unknown>).filter(([, v]) => v !== undefined);
        if (entries.length === 0) return '{}';
        return (
            <>
                {'{\n'}
                {entries.map(([name, child], i) => {
                    const childPath = `${path}/${name}`;
                    const childDoc = nodeDoc?.fields?.[name];
                    return (
                        <span key={name}>
                            {inner}
                            {renderKey(name, childPath, childDoc)}
                            {': '}
                            {render(child, inner, childPath, childDoc, name)}
                            {i < entries.length - 1 ? ',\n' : '\n'}
                        </span>
                    );
                })}
                {indent + '}'}
            </>
        );
    };

    return (
        <pre
            style={{
                margin: 0,
                padding: '12px',
                maxHeight,
                overflow: 'auto',
                fontSize: '12px',
                lineHeight: 1.5,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
                color: COLORS.punctuation,
                backgroundColor: '#141414',
                border: '1px solid #303030',
                borderRadius: '6px'
            }}
        >
            <code>{render(value, '', '', doc)}</code>
        </pre>
    );
};
