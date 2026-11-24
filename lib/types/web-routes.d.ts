import type { IncomingMessage, ServerResponse } from 'node:http';
/** Public WebServer route surface used by the plugin. */
export interface WebRouteHost {
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}
/**
 * rc.3 admission face. `HostConnectionService.admit` re-enters cordis's traced
 * service proxy and demands the caller inject `connection.authentication`,
 * which this plugin cannot hard-require (headless profiles mount no web stack).
 * The nested credential registry answers the same verdict without the inject
 * demand; the Host/Origin fence itself moved to the webserver's centralized
 * `webserver/authorize` step in rc.3. Declared structurally so the plugin
 * typechecks against any 0.2.x peer resolution.
 */
export interface BrowserRequestGate {
    authenticate(request: IncomingMessage): BrowserRequestVerdict;
}
/**
 * Released 0.2.x face. npm `dsh-client-connection` (through 0.2.2-rc.5) ships
 * no `connection.authentication` registry; its `HostConnectionService` answers
 * with the bare rejection status (401 | 403 | undefined) through
 * `requestRejection`. The fork's source deployment mounts the rc.3 registry
 * and matches the primary face above.
 */
export interface LegacyBrowserRequestGate {
    requestRejection(request: IncomingMessage): 401 | 403 | undefined;
}
/**
 * 0.2.2-rc.5 face. `HostConnectionService.admit` applies the source policy and
 * answers a `PeerAdmission`: `{ peer }` admits, `{ rejection }` denies with the
 * HTTP status.
 */
export interface AdmitBrowserRequestGate {
    admit(request: IncomingMessage): {
        peer?: unknown;
    } | {
        rejection: 401 | 403 | 503;
    };
}
/** Adapts either live Connection face to the primary gate. */
export declare function normalizeBrowserRequestGate(service: unknown): BrowserRequestGate | undefined;
/** Credential verdict: a live peer serves; anything else is a refusal. */
export type BrowserRequestVerdict = {
    peer: unknown;
} | {
    rejection: 401 | 403 | 503;
};
export declare class RequestBodyError extends Error {
    readonly status: 400 | 413;
    constructor(message: string, status: 400 | 413);
}
/** Bound memory while draining oversized requests so the route can return 413. */
export declare function readJsonRequest(req: IncomingMessage, maxBytes?: number): Promise<Record<string, unknown>>;
/** Revalidate a current JSON representation across both identity and gzip delivery. */
export declare function writeJsonWithEtag(req: IncomingMessage, res: ServerResponse, body: string): void;
/** Raw WebServer routes do not inherit Connection's authentication fence. */
export declare function authenticatedWebRoutes(server: WebRouteHost, connection: () => BrowserRequestGate | undefined): WebRouteHost;
