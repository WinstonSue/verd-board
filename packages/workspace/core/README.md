# VerdBoard Workspace SDK

Shared native file models, host contracts, sessions, conditional commits, references, resources, validation and common Git support. Product applications and the Node Agent use the same implementation. This package does not depend on product app/ui packages.

```sh
pnpm add @sue/verd-board-workspace
```

```ts
import { createMemoryWorkspaceHost, openWorkspaceSession } from '@sue/verd-board-workspace';

const host = createMemoryWorkspaceHost();
const handle = await host.openWorkspace({});
if (!handle) throw new Error('Workspace was not opened');
const session = await openWorkspaceSession(host, handle);
await session.flush();
await host.closeWorkspace(handle);
```

Implement `WorkspaceHost` to connect another storage backend. Writes retain expected-version checks, unified history and explicit conflict handling. Browser, Service and Desktop hosts remain available from `@sue/verd-board-app`; its root and `/headless` entries continue forwarding compatible shared APIs.

The package reuses `@sue/board-react-text/schema` for validation against the actual editor schema. It is not a separate schema implementation. Default Skill metadata comes from the standalone patterns package; user recommendations do not become Agent instructions.

For Node filesystem access and authoring operations, use `@sue/verd-board-agent` and its `/node` entry. Native architecture and package documentation are maintained in the repository root `workspace/`.
