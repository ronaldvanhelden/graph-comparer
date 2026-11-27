import { createFileRoute } from '@tanstack/react-router';

// The selected permission lives in the URL (/permissions/User.Read.All) so it can be
// linked to and survives a refresh. AppLayout reads the param and renders the details.
export const Route = createFileRoute('/permissions/$name')({
    component: () => null
});
