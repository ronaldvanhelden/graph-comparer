import { Card, Empty, Segmented, Spin, Tag, Typography } from 'antd';
import { CloseOutlined, LinkOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { JsonView } from './JsonView';
import { collectSchemaRefs, useExample, useSchema } from '../hooks/useOpenApi';
import type { BodyInfo, EndpointInfo, GraphVersion } from '../hooks/useOpenApi';

const { Text } = Typography;

const ModelTags = ({ schema, onOpen }: { schema: unknown; onOpen: (name: string) => void }) => {
    const refs = collectSchemaRefs(schema);
    if (refs.length === 0) return null;
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
            <Text type='secondary' style={{ fontSize: '12px', marginRight: '4px' }}>
                Model references:
            </Text>
            {refs.map((name) => (
                <Tag key={name} color='green' style={{ cursor: 'pointer', margin: 0 }} onClick={() => onOpen(name)}>
                    {name}
                </Tag>
            ))}
        </div>
    );
};

type BodyView = 'example' | 'schema';

const ExampleView = ({ version, schema }: { version: GraphVersion; schema: unknown }) => {
    const { example, doc, isLoading } = useExample(version, schema);
    return isLoading ? <Spin size='small' /> : <JsonView value={example} doc={doc} />;
};

/** The resulting body by default, with a switch to the schema that describes it. */
const SchemaViewer = ({ version, schema, onOpen }: { version: GraphVersion; schema: unknown; onOpen: (name: string) => void }) => {
    const [view, setView] = useState<BodyView>('example');
    return (
        <>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Segmented<BodyView>
                    size='small'
                    value={view}
                    onChange={setView}
                    options={[
                        { label: 'Body', value: 'example' },
                        { label: 'Schema', value: 'schema' }
                    ]}
                />
                {view === 'example' && (
                    <Text type='secondary' style={{ fontSize: '12px' }}>
                        Example generated from the schema, with placeholder values. Hover a field for its description.
                    </Text>
                )}
            </div>
            <ModelTags schema={schema} onOpen={onOpen} />
            {view === 'example' ? <ExampleView version={version} schema={schema} /> : <JsonView value={schema} onRefClick={onOpen} />}
        </>
    );
};

interface BodySectionProps {
    title: string;
    version: GraphVersion;
    body: BodyInfo;
    note?: string;
    onOpen: (name: string) => void;
}

const BodySection = ({ title, version, body, note, onOpen }: BodySectionProps) => (
    <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <Text strong>{title}</Text>
            {body.contentType && <Tag style={{ margin: 0 }}>{body.contentType}</Tag>}
            {note && <Text type='secondary'>{note}</Text>}
        </div>
        {body.schema ? (
            <SchemaViewer version={version} schema={body.schema} onOpen={onOpen} />
        ) : (
            <Text type='secondary'>{body.contentType ? 'No schema described for this content type.' : 'No body.'}</Text>
        )}
    </div>
);

const ModelCard = ({ version, name, onOpen, onClose }: { version: GraphVersion; name: string; onOpen: (name: string) => void; onClose: () => void }) => {
    const { schema, isLoading } = useSchema(version, name);
    return (
        <Card
            size='small'
            style={{ marginBottom: '12px' }}
            title={
                <span>
                    <Text type='secondary'>Model </Text>
                    <Text code>{name}</Text>
                </span>
            }
            extra={<CloseOutlined title='Close model' onClick={onClose} style={{ cursor: 'pointer' }} />}
        >
            {isLoading ? (
                <Spin size='small' />
            ) : schema ? (
                <SchemaViewer version={version} schema={schema} onOpen={onOpen} />
            ) : (
                <Empty description='Schema not found' image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
        </Card>
    );
};

/** Request and response body schemas of one endpoint, with the models they reference. */
export const EndpointSchema = ({ info }: { info: EndpointInfo }) => {
    const [openModels, setOpenModels] = useState<string[]>([]);

    // Most recently opened model goes first, directly below the bodies.
    const openModel = (name: string) => setOpenModels((current) => [name, ...current.filter((n) => n !== name)]);
    const closeModel = (name: string) => setOpenModels((current) => current.filter((n) => n !== name));

    const { request, response } = info;
    const responseNote = response ? [response.status, response.description].filter(Boolean).join(' · ') : undefined;

    return (
        <div style={{ padding: '4px 8px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <Tag color={info.version === 'beta' ? 'orange' : 'blue'} style={{ margin: 0 }}>
                    {info.version}
                </Tag>
                <Text code style={{ fontSize: '12px' }}>
                    {info.path}
                </Text>
                {info.summary && <Text type='secondary'>{info.summary}</Text>}
                {info.docs && (
                    <a href={info.docs} target='_blank' rel='noreferrer'>
                        <LinkOutlined /> Docs
                    </a>
                )}
            </div>

            {request && <BodySection title='Request body' version={info.version} body={request} onOpen={openModel} />}
            {response ? (
                <BodySection title='Response body' version={info.version} body={response} note={responseNote} onOpen={openModel} />
            ) : (
                <Text type='secondary'>No response described.</Text>
            )}

            {openModels.map((name) => (
                <ModelCard key={name} version={info.version} name={name} onOpen={openModel} onClose={() => closeModel(name)} />
            ))}
        </div>
    );
};
