import { Card, Empty, Spin, Tag, Typography } from 'antd';
import { CloseOutlined, LinkOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { JsonView } from './JsonView';
import { collectSchemaRefs, useSchema } from '../hooks/useOpenApi';
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

const BodySection = ({ title, body, note, onOpen }: { title: string; body: BodyInfo; note?: string; onOpen: (name: string) => void }) => (
    <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <Text strong>{title}</Text>
            {body.contentType && <Tag style={{ margin: 0 }}>{body.contentType}</Tag>}
            {note && <Text type='secondary'>{note}</Text>}
        </div>
        {body.schema ? (
            <>
                <ModelTags schema={body.schema} onOpen={onOpen} />
                <JsonView value={body.schema} onRefClick={onOpen} />
            </>
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
                <>
                    <ModelTags schema={schema} onOpen={onOpen} />
                    <JsonView value={schema} onRefClick={onOpen} />
                </>
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

            {request && <BodySection title='Request body' body={request} onOpen={openModel} />}
            {response ? (
                <BodySection title='Response body' body={response} note={responseNote} onOpen={openModel} />
            ) : (
                <Text type='secondary'>No response described.</Text>
            )}

            {openModels.map((name) => (
                <ModelCard key={name} version={info.version} name={name} onOpen={openModel} onClose={() => closeModel(name)} />
            ))}
        </div>
    );
};
