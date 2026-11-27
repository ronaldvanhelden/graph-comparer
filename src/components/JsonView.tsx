import type { ReactNode } from 'react';
import { schemaNameFromRef } from '../hooks/useOpenApi';

const COLORS = {
    key: '#9CDCFE',
    string: '#CE9178',
    number: '#B5CEA8',
    literal: '#569CD6',
    punctuation: '#8C8C8C',
    link: '#50AF5BFF'
};

// A string (optionally followed by ":", which makes it a key), a literal, or a number.
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

interface JsonViewProps {
    value: unknown;
    /** Called with the model name when a "$ref" to a model schema is clicked. */
    onRefClick?: (schemaName: string) => void;
    maxHeight?: number;
}

/** Pretty-printed JSON with syntax highlighting. */
export const JsonView = ({ value, onRefClick, maxHeight = 420 }: JsonViewProps) => {
    const text = JSON.stringify(value, null, 2) ?? 'undefined';
    const nodes: ReactNode[] = [];
    let last = 0;

    for (const match of text.matchAll(TOKEN)) {
        const index = match.index;
        if (index > last) nodes.push(text.slice(last, index));
        const [token, quoted, colon, literal] = match;

        if (quoted && colon) {
            nodes.push(
                <span key={index} style={{ color: COLORS.key }}>
                    {quoted}
                </span>,
                colon
            );
        } else if (quoted) {
            const schemaName = onRefClick ? schemaNameFromRef(JSON.parse(quoted)) : null;
            nodes.push(
                schemaName ? (
                    <a
                        key={index}
                        role='button'
                        title={`Show model ${schemaName}`}
                        onClick={() => onRefClick?.(schemaName)}
                        style={{ color: COLORS.link, textDecoration: 'underline', cursor: 'pointer' }}
                    >
                        {quoted}
                    </a>
                ) : (
                    <span key={index} style={{ color: COLORS.string }}>
                        {quoted}
                    </span>
                )
            );
        } else {
            nodes.push(
                <span key={index} style={{ color: literal ? COLORS.literal : COLORS.number }}>
                    {token}
                </span>
            );
        }
        last = index + token.length;
    }
    if (last < text.length) nodes.push(text.slice(last));

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
            <code>{nodes}</code>
        </pre>
    );
};
