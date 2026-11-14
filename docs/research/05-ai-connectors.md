# Research 05: connecting Lists to Claude and Grok

Four squads, primary sources only, 2026-11-14. Every load-bearing claim was re-checked by a separate skeptic against the live source; verdicts are listed per section.

## Claude surfaces

The best way to connect Lists to Claude is one remote MCP server that speaks Streamable HTTP over HTTPS on port 443, added as a custom connector. A single server covers claude.ai, Desktop, the mobile apps, Cowork and Claude Code, because they all run on the same connector system. Anthropic's cloud makes the connection, not the user's device. It comes from 160.79.104.0/21, and the IP page also lists 153.61.208.0/20. The hostname needs a public IPv4 A record (connectors are IPv4-only). It must not redirect to a different host, because Claude drops the Authorization header on such a redirect.

**Plans and apps.** Every plan can add custom connectors (Free, Pro, Max, Ultra, Team, Enterprise). Free accounts get one. On Team and Enterprise, only Owners can add them. You add them on the web or Desktop. Mobile can use connectors already added, but installing on mobile is beta.

**Auth.** Claude accepts three options:
- **OAuth.** Claude's client follows the 2025-03-26, 2025-06-18 and 2025-11-25 auth specs. A 401 with `WWW-Authenticate: Bearer resource_metadata=...` is required to start sign-in. You also need RFC 9728 metadata whose `resource` exactly matches the server URL, and RFC 8414 or OIDC discovery. S256 PKCE is always used, and the token endpoint must accept form-urlencoded bodies. Claude registers itself with a Client ID Metadata Document (CIMD, recommended), with Dynamic Client Registration (DCR), or with a client ID/secret you enter. Allow these redirects: `https://claude.ai/api/mcp/auth_callback`, plus loopback `http://localhost` and `http://127.0.0.1` on any port for Claude Code.
- **No auth.** Supported by default.
- **Fixed API key in a request header.** Beta, and only for a limited set of organizations.

**Desktop local option.** Desktop can also run a local stdio server, either through `claude_desktop_config.json` (`mcpServers` → `command`/`args`/`env`) or as a `.mcpb` bundle. The directory no longer accepts MCPB submissions.

**Claude Code.** `claude mcp add --transport http <name> <url> --header "Authorization: Bearer ..."`, with local, project (`.mcp.json`) or user scope.

**Spec and SDK.** The current spec is 2026-07-28. It drops `initialize` and sessions and deprecates DCR in favour of CIMD. Claude's docs only list auth specs up to 2025-11-25, so the server must still accept older ("legacy") clients. The TypeScript SDK v2 does that by default: `@modelcontextprotocol/server` 2.4.0's `createMcpHandler` serves legacy clients statelessly. It depends only on zod and core; add `@modelcontextprotocol/node` to run on Node. v2 checks tokens but does not issue them. For that you need an identity provider or the frozen `server-legacy/auth` helpers. v1 (`@modelcontextprotocol/sdk` 1.32.2) pulls in express, hono, ajv and more.

**Tool rules.** Every tool needs a `title` and `readOnlyHint` or `destructiveHint`. Keep read and write tools separate, names at most 64 characters, results about 150k characters or less, and calls within 240 seconds. Treat list text stored by users as untrusted input that could carry prompt injection, and keep tool descriptions free of instructions to Claude.

### Claims

- Custom connectors via remote MCP are available on Claude, Cowork and Claude Desktop for Free, Pro, Max, Ultra, Team and Enterprise; Free users limited to one custom connector. Team: only Owners/Primary Owners add; Enterprise: Owners, Primary Owners, or custom role with Manage access to Libraries. Pro/Max add at Customize > Connectors > + Add > Add custom connector. — [primary] https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
- Claude connects to the remote MCP server from Anthropic's cloud for every client (claude.ai, Desktop, Cowork, mobile); server must be publicly reachable on standard HTTPS port 443 — URLs with another port (e.g. :8443) cannot connect. To edit auth settings you must remove and re-add the connector. — [primary] https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
- Web connectors are available on Claude, Cowork, Desktop and Claude Mobile (iOS/Android); installing connectors on mobile is currently in beta and Desktop/web remain the primary path for custom connectors. — [primary] https://support.claude.com/en/articles/11176164
- Claude mobile app supports remote connectors; Desktop supports remote plus local desktop extensions; connectors added in claude.ai are available in Claude Code when signed in with a Claude account. — [primary] https://claude.com/docs/connectors/getting-started.md
- Use Streamable HTTP for remote servers; Claude also supports the legacy HTTP+SSE transport, which is being deprecated. Claude follows the 2025-03-26, 2025-06-18 and 2025-11-25 authorization specs. Supports tools, prompts, resources, text and image tool results; does not support resource subscriptions or sampling. Limits: ~150,000 chars tool result and 240 s per tool call on claude.ai/Desktop; Claude Code 25,000 tokens (MAX_MCP_OUTPUT_TOKENS). — [primary] https://claude.com/docs/connectors/building/index.md
- Supported auth types: oauth_dcr (default), oauth_cimd (default), oauth_anthropic_creds (directory portal), custom_connection (contact mcp-review@anthropic.com), static_headers (beta, limited set of orgs), none (authless, supported by default). Standard header names authorization, x-api-key, x-auth-token work; never accept tokens in query string. — [primary] https://claude.com/docs/connectors/building/authentication.md
- Claude requires a 401 to start sign-in (ignores WWW-Authenticate on 200); uses only the first authorization_servers entry; protected resource metadata 'resource' must equal the MCP URL exactly incl. path; falls back to probing /.well-known/oauth-protected-resource/<path> then /.well-known/oauth-protected-resource. CIMD is used only if AS metadata advertises client_id_metadata_document_supported: true AND 'none' in token_endpoint_auth_methods_supported, else falls back to DCR (registration_endpoint). — [primary] https://claude.com/docs/connectors/building/authentication.md
- Redirect URIs: https://claude.ai/api/mcp/auth_callback for web/Desktop/mobile/Cowork; Claude Code uses RFC 8252 loopback on ephemeral port and declares http://localhost/callback and http://127.0.0.1/callback in its CIMD (https://claude.ai/oauth/claude-code-client-metadata) — match port-agnostically. — [primary] https://claude.com/docs/connectors/building/authentication.md
- Claude sends S256 PKCE on every authorization request; AS must advertise code_challenge_methods_supported: ["S256"]. Claude appends offline_access if AS lists it; refreshes reactively on 401 and proactively up to 5 min before expiry; expects invalid_grant for dead refresh tokens; rotate refresh tokens for public clients; /token must accept application/x-www-form-urlencoded; /register uses JSON. Endpoint timeouts: 10 s discovery/registration/token, 30 s refresh. client_credentials grant not supported. — [primary] https://claude.com/docs/connectors/building/authentication.md
- Add-connector dialog: Authentication = Sign in now / Sign in when needed / No sign-in; OAuth client = Use Claude's published identity (CIMD, recommended) / Register automatically (DCR) / Use your own OAuth client (client ID, optional secret). For API keys choose No sign-in and add under Request headers (beta, up to four headers, value sent verbatim so include 'Bearer '). Advanced > Transport; a URL ending in /sse selects SSE. — [primary] https://claude.com/docs/connectors/custom/add-unlisted.md
- Anthropic outbound IPs for MCP tool calls: IPv4 160.79.104.0/21 and 153.61.208.0/20 (the connector auth page cites only 160.79.104.0/21). — [primary] https://platform.claude.com/docs/en/api/ip-addresses
- Connectors are IPv4-only (hostname needs a public A record); every resolved address must be globally routable; a 3xx redirect to another host drops the Authorization header and fails auth; Claude sends RFC 8707 resource = canonical MCP URL and the server should check aud against it. — [primary] https://claude.com/docs/connectors/building/troubleshooting.md
- Claude Desktop local servers are configured in claude_desktop_config.json (macOS ~/Library/Application Support/Claude/, Windows %APPDATA%\Claude\, Linux ~/.config/Claude/) under mcpServers with command/args (and env); open via Settings > Developer > Edit Config; full restart required. — [primary] https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers.md
- MCPB (.mcpb) is a zip with a local stdio server plus manifest.json; built with npm i -g @anthropic-ai/mcpb, mcpb init, mcpb pack; users install by double-click, drag-drop, or Settings > Extensions > Advanced settings > Install Extension; Node.js is bundled with Claude Desktop on macOS/Windows; directory no longer accepts MCPB submissions (ship via plugin instead). — [primary] https://claude.com/docs/connectors/building/mcpb.md
- Local MCP servers in claude_desktop_config.json are not available in claude.ai or cloud Cowork sessions; Advanced research cannot invoke local MCP tools. — [primary] https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
- Claude Code: claude mcp add --transport http <name> <url> [--header "Authorization: Bearer ..."]; -t/-H short forms; scopes local (default, ~/.claude.json per project), project (.mcp.json, needs approval), user (~/.claude.json, all projects); JSON entries need type http (alias streamable-http); SSE deprecated; ${VAR} expansion in .mcp.json headers. — [primary] https://code.claude.com/docs/en/mcp.md
- The current MCP protocol version is 2026-07-28. — [primary] https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning.md
- 2026-07-28 removes Mcp-Session-Id sessions and the initialize handshake (per-request _meta carries version/capabilities), adds mandatory server/discover, requires Mcp-Method/Mcp-Name headers on Streamable HTTP POSTs, reclassifies HTTP+SSE as Deprecated, and deprecates DCR in favor of Client ID Metadata Documents. — [primary] https://modelcontextprotocol.io/specification/2026-07-28/changelog.md
- Authorization is OPTIONAL; HTTP implementations SHOULD conform; MCP servers MUST implement RFC 9728 Protected Resource Metadata; AS MUST implement OAuth 2.1 and provide RFC 8414 or OIDC discovery; clients MUST send RFC 8707 resource; servers MUST validate token audience, return 401 for invalid/expired tokens, MUST NOT accept tokens in query string or pass tokens through. — [primary] https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index.md
- Clients MUST use PKCE S256 and MUST refuse to proceed if code_challenge_methods_supported is absent from AS metadata. — [primary] https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations.md
- ToolAnnotations: title, readOnlyHint (default false), destructiveHint (default true, meaningful only when readOnlyHint false), idempotentHint (default false), openWorldHint (default true); all are hints and untrusted from untrusted servers. Servers MUST validate inputs, implement access controls, rate limit and sanitize outputs. — [primary] https://modelcontextprotocol.io/specification/2026-07-28/schema.md
- Directory review: every tool needs a title and readOnlyHint or destructiveHint (read-only tools can run without per-call confirmation, destructive always prompt); separate read and write tools (no catch-all method param); tool names <=64 chars; descriptions must not contain prompt-injection patterns; actionable errors; no money transfer or AI media generation. — [primary] https://claude.com/docs/connectors/building/review-criteria.md
- Directory submission is via the developer portal claude.ai/directory/manage; any paid plan (Pro, Max, Ultra, Team, Enterprise; Free cannot); connectors are auto-scanned and listed as Community by default, possibly escalated to Verified. — [primary] https://claude.com/docs/directory/publish.md
- Testing is against the real Claude client as a custom connector (no staging). The SDK's createMcpExpressApp DNS-rebinding protection only allows localhost/127.0.0.1/[::1] Host headers and returns 403 'Invalid Host' otherwise; pass allowedHosts with the public hostname (relevant behind a reverse proxy). — [primary] https://claude.com/docs/connectors/building/testing.md
- Claude's quickstart server uses @modelcontextprotocol/sdk (verified 1.30.1) with McpServer, StreamableHTTPServerTransport (sessionIdGenerator undefined = stateless) and createMcpExpressApp; Node 18+. — [primary] https://claude.com/docs/connectors/building/quickstart.md
- npm: @modelcontextprotocol/sdk latest 1.32.2 (2026-10-23), deps include express, hono, @hono/node-server, ajv, ajv-formats, jose, cors, eventsource, cross-spawn, express-rate-limit, zod-to-json-schema etc., unpacked ~4.5 MB; @modelcontextprotocol/server 2.4.0 depends only on zod ^4.2 and @modelcontextprotocol/core; @modelcontextprotocol/node 2.1.2 depends on hono + @hono/node-server. — [primary] https://registry.npmjs.org/@modelcontextprotocol/server
- TypeScript SDK main branch is v2 (@modelcontextprotocol/server/client), stable, implementing spec 2026-07-28; v1.x (@modelcontextprotocol/sdk) gets fixes for at least six months after the v2 release (2026-07-27). — [primary] https://github.com/modelcontextprotocol/typescript-sdk
- SDK v2 createMcpHandler serves legacy (2025-era, initialize-based) clients by default with legacy: 'stateless' (fresh instance per request; legacy GET/DELETE return 405); legacy: 'reject' makes it modern-only. v2 server never serves HTTP+SSE. — [primary] https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/docs/serving/legacy-clients.md
- SDK v2 is resource-server only: requireBearerAuth (401 invalid_token / 403 insufficient_scope with WWW-Authenticate resource_metadata), expectedResource audience check, mcpAuthMetadataRouter serves RFC 9728 metadata; Authorization Server helpers (mcpAuthRouter, ProxyOAuthServerProvider) are frozen in @modelcontextprotocol/server-legacy/auth; use a dedicated identity provider for new servers. — [primary] https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/docs/serving/authorization.md
- MCP security best practices: MCP servers MUST NOT accept tokens not explicitly issued for them (token passthrough anti-pattern); state handles must not be treated as authentication and should be bound to the verified user. — [primary] https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices.md
- Anthropic warns malicious MCP servers may include hidden instructions (prompt injection); users should review tool approvals, only 'Allow always' trusted tools, disable write tools when using Research; Claude Code docs warn servers that fetch external content expose prompt injection risk. — [primary] https://code.claude.com/docs/en/security.md

### Skeptic verdicts

- **confirmed**: 1. Custom connectors via remote MCP on Claude, Cowork, Desktop for Free/Pro/Max/Ultra/Team/Enterprise; Free limited to one; Team Owners/Primary Owners add; Enterprise also custom role with Manage acce — "available on Claude, Cowork, and Claude Desktop for users on Free, Pro, Max, Ultra, Team, and Enterprise plans. Free users are limited to one"; Owners/Primary Owners (Team) and custom role with Manage access to Libraries (Enterprise); Pro/Max: Customize > Connectors, click "+ Add" then "Add custom 
- **confirmed**: 2. Claude connects from Anthropic's cloud for every client; server must be publicly reachable on port 443, other ports (e.g. :8443) cannot connect; editing auth settings requires remove and re-add. — "Claude connects to your remote MCP server from Anthropic's cloud infrastructure... true across every Claude client"; "must also be reachable on the standard HTTPS port (443). Claude can't connect to a URL that specifies another port (for example, https://example.com:8443/mcp)". The help article als
- **confirmed**: 3. Streamable HTTP recommended; legacy HTTP+SSE supported but being deprecated; Claude follows the 2025-03-26, 2025-06-18 and 2025-11-25 auth specs; supports tools/prompts/resources, text and image re — "Use Streamable HTTP... Claude also supports the legacy HTTP+SSE transport, which is being deprecated"; the spec versions are listed exactly; it does not yet support "Resource subscriptions, Sampling, Advanced or draft capabilities"; limits table: ~150,000 characters and 240 seconds for claude.ai an
- **confirmed**: 4. Auth types oauth_dcr and oauth_cimd (default), oauth_anthropic_creds (portal), custom_connection (contact mcp-review@anthropic.com), static_headers (beta, limited set of orgs), none (default); stan — The table matches: oauth_dcr and oauth_cimd "Supported by default"; oauth_anthropic_creds "Enter the client in the developer portal"; custom_connection "Contact mcp-review@anthropic.com"; static_headers "Beta, for a limited set of organizations"; none "Supported by default". The page says "authoriza
- **confirmed**: 5. 401 required (WWW-Authenticate on 200 is ignored); only the first authorization_servers entry is used; PRM resource must equal the MCP URL exactly; fallback probing /.well-known/oauth-protected-res — "The 401 status is required, because Claude doesn't honor a WWW-Authenticate header on a 200"; "Claude uses the first entry and doesn't fall back"; resource "must equal the URL as the user enters it... including any path"; the probe order matches. CIMD has a nuance: Claude "normally selects CIMD onl
- **confirmed**: 6. Redirect https://claude.ai/api/mcp/auth_callback for web/Desktop/mobile/Cowork; Claude Code uses an RFC 8252 loopback on an ephemeral port and declares http://localhost/callback and http://127.0.0. — "For the hosted Claude apps, which are claude.ai on the web, Desktop, mobile, and Cowork, register exactly this redirect URI: https://claude.ai/api/mcp/auth_callback"; "Claude Code declares http://localhost/callback and http://127.0.0.1/callback in its Client ID Metadata Document... match both with 
- **confirmed**: 7. S256 PKCE on every request; AS must advertise code_challenge_methods_supported [S256]; offline_access appended if listed; reactive refresh on 401 and proactive up to 5 min before expiry; invalid_gr — "includes a PKCE code_challenge with code_challenge_method=S256 on every authorization request"; "appends offline_access when your authorization server metadata lists it"; "refreshes tokens reactively on a 401 response, and proactively up to five minutes before"; "waits up to 10 seconds... and up to
- **confirmed**: 8. Dialog: Sign in now / Sign in when needed / No sign-in; OAuth client: published identity (CIMD, recommended) / Register automatically (DCR) / your own OAuth client (ID, optional secret); API keys v — The options match. "You can add up to four headers"; "Claude sends the value exactly as you enter it. It doesn't add an authentication scheme"; "Change Advanced > Transport only if... A URL ending in /sse selects the older SSE transport"; request headers are "in beta and available to a limited set o
- **confirmed**: 9. Anthropic outbound IPs for MCP tool calls are IPv4 160.79.104.0/21 and 153.61.208.0/20; the connector auth page cites only 160.79.104.0/21. — Outbound IPv4: 160.79.104.0/21 and 153.61.208.0/20 ("for example, when making MCP tool calls to external servers"). Five 34.162.x.x/32 addresses are listed as phased out. The auth page's Network reference says "originates from 160.79.104.0/21" only. Sources: https://platform.claude.com/docs/en/api/i
- **confirmed**: 10. Connectors are IPv4-only (public A record needed); every resolved address must be globally routable; a 3xx to another host drops the Authorization header and fails auth; Claude sends RFC 8707 reso — "Connectors are IPv4-only, so a hostname that only publishes AAAA records can't be reached"; "every returned address must be globally routable"; on a 301/302/307/308 to a different host, "Claude drops the Authorization header"; "Claude sends the RFC 8707 resource parameter... set to the canonical fo
- **confirmed**: 11. The current MCP protocol version is 2026-07-28. — "The current protocol version is 2026-07-28." Source: https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning.md (primary)
- **confirmed**: 12. 2026-07-28 removes Mcp-Session-Id sessions and the initialize handshake (per-request _meta), adds mandatory server/discover, requires Mcp-Method/Mcp-Name headers on Streamable HTTP POSTs, reclassi — Major changes 1-3 cover removing Mcp-Session-Id, removing the initialize handshake (_meta carries protocolVersion and clientCapabilities), and "servers MUST implement" server/discover. Minor change 4: "Require standard MCP request headers (Mcp-Method, Mcp-Name) on Streamable HTTP POST". Deprecated i
- **confirmed**: 13. Authorization OPTIONAL; HTTP implementations SHOULD conform; servers MUST implement RFC 9728; AS MUST implement OAuth 2.1 and RFC 8414 or OIDC discovery; clients MUST send RFC 8707 resource; serve — "Authorization is OPTIONAL"; "HTTP-based transport SHOULD conform"; "MCP servers MUST implement... RFC9728"; "MUST provide at least one of" RFC 8414 or OIDC Discovery; resource "MUST be included in both authorization requests and token requests"; "Invalid or expired tokens MUST receive a HTTP 401"; 
- **confirmed**: 14. Clients MUST use PKCE S256 and MUST refuse to proceed if code_challenge_methods_supported is absent from AS metadata. — "MCP clients MUST use the S256 code challenge method when technically capable"; "If code_challenge_methods_supported is absent... MCP clients MUST refuse to proceed" (applies to both RFC 8414 and OIDC metadata). The S256 rule is qualified by "when technically capable". Source: https://modelcontextpr

### Open questions

- The user also asked for a Lists to Grok bot connection. This brief covered Claude only, so xAI/Grok MCP or tool-calling support (remote MCP in the xAI API, auth, transports) still needs separate research.
- Claude's connector docs list auth specs only up to 2025-11-25. It is not confirmed whether the claude.ai connector client speaks the 2026-07-28 protocol, so the server should accept both protocol versions (the SDK v2 default) until that is verified.
- The request-headers (API key) option is beta for a limited set of organizations. Check in the Add custom connector dialog whether the user's account has it. If not, the choices are OAuth (CIMD/DCR) or no auth.
- Which authorization server should Lists use? The SDK v2 only checks tokens and does not issue them. Options: an external identity provider that supports CIMD or DCR and S256 PKCE, a small self-built OAuth 2.1 server, or the frozen v1 mcpAuthRouter in @modelcontextprotocol/server-legacy/auth.
- Node and npm are not installed on the VM host (aarch64), so actual installed sizes of SDK v1 and v2 could not be measured. Only npm registry unpacked sizes and dependency lists were checked. Confirm the runtime (likely a Docker container behind Caddy) before choosing.
- The VM's public hostname needs an IPv4 A record and must serve on 443 with no cross-host redirect. Confirm Caddy forwards the WWW-Authenticate header and /.well-known/* paths unchanged, and that allowedHosts or Host validation accepts the public hostname.
- Whether the Messages API MCP connector (the API surface) is in scope was not researched.

## Grok (xAI)

Key finding: "Grok Bot" is a real SpaceXSI (xAI) product (docs.x.ai/grok-bot, released August per the release notes), so the user most likely means it, not a Telegram bot someone builds. One MCP server for Lists can feed all three Grok routes and Claude as well. The server must be public HTTPS, use Streamable HTTP (SSE also works), and require bearer or OAuth auth. Tunnels like ngrok exist only for servers running on your own machine; Lists already runs on a VM behind Caddy.

The three routes, best fit first:

1. **Grok Bot.** A desktop app for macOS, Windows and Linux, plus iOS (18+) and Android (9+) companion apps. It runs on a persistent cloud computer and signs in with a Cursor account. In the desktop app, go to Connect apps → "Add a custom connector" and pick one of two types:
   - **Remote HTTPS:** Server URL, optional HTTP headers, optional OAuth Client ID and Secret.
   - **Command:** a command and its arguments.
   
   You can also just ask a Bot to add an MCP server by URL. Routines can start from a webhook call, Slack, an email to the Bot's own address, or a schedule. Bots are reachable from the apps, X Chat, and by tagging @bot on X. It is included on X Subscription Premium ($30/mo), Super ($100) and Ultra ($200), but not Plus. A linked SuperGrok, SuperGrok Plus, SuperGrok Heavy or X Premium+ plan also works. There is no model picker.

2. **Grok consumer app (grok.com).** Connectors are "available to all Grok users". Go to grok.com/connectors → New Connector → Custom, enter the MCP server URL, then complete auth. Grok rejects localhost and private-network IP addresses. On Business and Enterprise plans an admin must first add it in console.x.ai.

3. **xAI API.**
   - **Remote MCP:** a `{"type":"mcp"}` tool on the Responses API (POST https://api.x.ai/v1/responses) and in the xai-sdk.
     - Required: `server_url`, `server_label`.
     - Optional: `server_description`, `allowed_tools`, `authorization`, `headers`. The SDK calls the last two of these differently: `allowed_tool_names` and `extra_headers`.
     - `require_approval` and `connector_id` are not supported.
     - MCP calls themselves are free; you pay only for tokens.
   - **Function calling:** the OpenAI-compatible alternative, for when your own code runs the Lists API.
   - **Current flagship:** grok-4.7 costs $2 input, $0.50 cached and $6 output per 1M tokens under 200k prompt tokens, and double above that. grok-4.3 costs $1.25 / $0.20 / $2.50. API keys come from console.x.ai and use prepaid credits.
   - **Rate limits:** Tier 0 starts at $0 of spend, and grok-4.7 gets 150 requests/second and 50M tokens/minute there.

A do-it-yourself Telegram or Discord bot would need an xAI API key, a bot token and a hosted process. xAI's docs show no Telegram or Discord example; the cookbook has a Twilio phone agent. Recommendation: build one remote MCP server with OAuth, then register it in Claude, grok.com and Grok Bot. The API route stays available for a custom bot later.

### Claims

- xAI API supports Remote MCP tools via a tool of type 'mcp' with required server_url and server_label, optional server_description, allowed_tools (SDK: allowed_tool_names), authorization (set as Authorization header to the MCP server), headers (SDK: extra_headers). — [primary] https://docs.x.ai/developers/tools/remote-mcp.md
- Remote MCP only supports Streaming HTTP and SSE transports; supported in xAI native SDK, OpenAI-compatible Responses API, and Speech to Speech API; require_approval and connector_id are not supported. Examples use grok-4.7 at https://api.x.ai/v1/responses. — [primary] https://docs.x.ai/developers/tools/remote-mcp.md
- Remote MCP tool invocations are not charged; only tokens are billed. — [primary] https://docs.x.ai/developers/pricing.md
- Function calling: define tools with name/description/JSON schema; model returns function_call, you execute and return function_call_output with previous_response_id (OpenAI SDK, base_url https://api.x.ai/v1) or tool_result in xai-sdk. — [primary] https://docs.x.ai/developers/tools/function-calling.md
- Server-side and client-side tools can be mixed; server-side tools run automatically by xAI, client-side calls pause for your code. — [primary] https://docs.x.ai/developers/tools/advanced-usage.md
- Grok consumer connectors are available to all Grok users; custom MCP connectors are added at grok.com/connectors -> New Connector -> Custom by entering the MCP server URL and completing authentication; server must be reachable on the public internet. — [primary] https://docs.x.ai/grok/connectors.md
- Grok rejects localhost/private-network MCP URLs; tunnels (ngrok, Cloudflare) can be used; Cloudflare quick tunnels don't support SSE; OAuth/API-key auth on the MCP server is still completed in Grok. — [primary] https://docs.x.ai/grok/connectors/custom-mcp-tunneling.md
- On Grok Business/Enterprise a team admin must add the connector (including custom MCP via Other) in console.x.ai before members can use it. — [primary] https://docs.x.ai/grok/connector-management.md
- Grok Bot is a distinct SpaceXSI product: AI teammates on a persistent cloud computer that support custom tooling via any MCP or API. — [primary] https://docs.x.ai/grok-bot/overview.md
- In Grok Bot desktop app, 'Add a custom connector' at bottom of Connect apps: Remote HTTPS type takes Server URL, optional HTTP headers, optional OAuth Client ID/Secret; Command type takes command and arguments. A Bot can also add an MCP server by URL on request. OAuth tokens are held on Cursor's connector backend. — [primary] https://docs.x.ai/grok-bot/computer-and-apps.md
- Grok Bot routines can be triggered by Slack, GitHub/Linear/Sentry/PagerDuty events, email to the Bot's address, or a webhook call. — [primary] https://docs.x.ai/grok-bot/skills-routines-and-automations.md
- Grok Bot runs as desktop app (macOS, Windows, Linux) plus iOS 18+/Android 9+ companion; signs in with a Cursor account; included with X Subscription Premium/Super/Ultra or linked SuperGrok/SuperGrok Plus/Heavy/X Premium+. — [primary] https://docs.x.ai/grok-bot/get-started.md
- Grok Bot is a different app from Grok; reachable via desktop, mobile, X Chat, tagging @bot on X, and Team Bots in Slack; no model picker. — [primary] https://docs.x.ai/grok-bot/faq.md
- X Subscription prices: Free $0, Plus $8/mo, Premium $30/mo, Super $100/mo, Ultra $200/mo; Grok Bot included on Premium, Super, Ultra only. — [primary] https://docs.x.ai/x-subscription/pricing.md
- Tagging @bot on X hands a post to your Grok Bot; requires Grok account with X connected and Grok Bot access. — [primary] https://docs.x.ai/grok-bot/tag-on-x.md
- Text API pricing per 1M tokens: grok-4.7 $2.00 input / $0.50 cached / $6.00 output (<200k prompt), $4/$1/$12 above; grok-4.3 $1.25/$0.20/$2.50 with 1M context. Grok 4.7 is the recommended model. — [primary] https://docs.x.ai/developers/models.md
- API access: sign up at console.x.ai, load credits, create API key, set XAI_API_KEY; SDKs: pip install openai or xai-sdk. — [primary] https://docs.x.ai/developers/quickstart.md
- Rate limit tiers by cumulative spend (Tier 0 at $0 ... Tier 4 at $5,000); grok-4.7 Tier 0 is 150 RPS / 50M TPM. — [primary] https://docs.x.ai/developers/rate-limits.md
- Grok Bot became available in August (release notes); Remote MCP Tools were added to the API in an earlier release (before October 2025 section). — [primary] https://docs.x.ai/developers/release-notes.md
- A Telegram bot uses a unique authentication token and receives updates via getUpdates or setWebhook (webhook ports 443, 80, 88, 8443). — [primary] https://core.telegram.org/bots/api

### Skeptic verdicts

- **confirmed**: xAI API supports Remote MCP tools via a tool of type 'mcp' with required server_url and server_label, optional server_description, allowed_tools (SDK: allowed_tool_names), authorization (Authorization — Config table (read at https://docs.x.ai/developers/tools/remote-mcp.md, primary=true): server_url Yes, server_label Yes; server_description, allowed_tools ('xAI native SDK uses the parameter name allowed_tool_names'), authorization ('set in the Authorization header'), headers ('SDK uses extra_header
- **confirmed**: Remote MCP only supports Streaming HTTP and SSE transports; supported in xAI native SDK, OpenAI-compatible Responses API, and Speech to Speech API; require_approval and connector_id not supported. Exa — https://docs.x.ai/developers/tools/remote-mcp.md (primary=true): 'Only Streaming HTTP and SSE transports are supported.' 'The require_approval and connector_id parameters... are not currently supported.' The curl and requests examples use model grok-4.7 at https://api.x.ai/v1/responses.
- **confirmed**: Grok consumer connectors are available to all Grok users; custom MCP connectors are added at grok.com/connectors -> New Connector -> Custom with MCP server URL + authentication; server must be reachab — https://docs.x.ai/grok/connectors.md (primary=true): 'Connectors are available to all Grok users'; 'Click New Connector, then select Custom. Enter the MCP server URL'; 'must be reachable over the public internet.' (correction: One caveat: on Grok Business and Enterprise, a team admin must first set up the connector in the cloud console before members can use it. For a local server, the docs say to use a tunneling service (/grok/connectors/custom-mcp-tunneling).)
- **confirmed**: Grok Bot is a distinct SpaceXSI product: AI teammates on a persistent cloud computer that support custom tooling via any MCP or API. — https://docs.x.ai/grok-bot/overview.md (primary=true): 'Grok Bot supports custom tooling, so it can interact with any MCP or API.' 'your Bots share a persistent cloud computer with a browser, filesystem, and terminal'. (correction: The overview page never uses the word 'SpaceXSI'; that brand name comes from other docs.x.ai pages. Grok Bot runs on Cursor's infrastructure: it uses a Cursor account, links to the Cursor marketplace for apps and stores connector OAuth tokens on Cursor's backend. It is not a separate xAI API surface.)
- **confirmed**: In Grok Bot desktop app, 'Add a custom connector' at bottom of Connect apps: Remote HTTPS takes Server URL, optional HTTP headers, optional OAuth Client ID/Secret; Command takes command and arguments. — https://docs.x.ai/grok-bot/computer-and-apps.md (primary=true): 'Remote HTTPS takes a Server URL, with optional HTTP headers and an OAuth Client ID'; 'OAuth tokens are held on Cursor's connector backend'. (correction: Extra details from the page: you also enter a Name. The Client Secret field only appears after you enter a Client ID. You save with 'Add plugin'. A team admin's MCP policy can block saving. A Bot can also add a server by a command that runs on its computer. Adding a server on a private network, or one that uses a private certificate authority, asks for your approval first.)
- **confirmed**: Grok Bot runs as desktop app (macOS, Windows, Linux) plus iOS 18+/Android 9+ companion; signs in with a Cursor account; included with X Subscription Premium/Super/Ultra or linked SuperGrok/SuperGrok P — https://docs.x.ai/grok-bot/get-started.md (primary=true): 'runs on macOS..., Windows..., and Linux'; 'Grok Bot uses your Cursor account'; 'iPhone app needs iOS 18 or later... Android 9 or later'. (correction: The access list is longer than the claim says. Legacy Cursor paid individual plans and self-serve Cursor Teams also include Grok Bot, and so does a seat on a self-serve Grok Business plan (that seat signs in with 'Sign in with Grok'). Accounts on Privacy Mode (Legacy) must switch to Privacy Mode.)
- **confirmed**: X Subscription prices: Free $0, Plus $8/mo, Premium $30/mo, Super $100/mo, Ultra $200/mo; Grok Bot included on Premium, Super, Ultra only. — https://docs.x.ai/x-subscription/pricing.md (primary=true): table lists Free $0, Plus $8/mo, Premium $30/mo, Super $100/mo, Ultra $200/mo; 'Grok Bot is included on Premium, Super, and Ultra. Plus does not include Grok Bot.' (correction: The doc points to x.ai/pricing for current prices. That page renders with JavaScript, so curl could not cross-check it. Annual prices: $80, $300, $1000 and $2000 per year. Team seats cost $30, $100 and $200; Plus is not available for teams. Bot usage comes out of the seat's shared weekly usage pool.)

### Open questions

- Which 'Grok bot' does the user mean: the official Grok Bot product (Cursor-account desktop/mobile app), the grok.com chat app's connectors, or a self-built Telegram/Discord bot? Does the user have a Premium+ X Subscription or a linkable SuperGrok/X Premium+ plan, which Grok Bot requires?
- The OAuth flow Grok expects from custom MCP servers is undocumented: dynamic client registration versus a pre-registered client. Grok Bot exposes Client ID/Secret fields; grok.com only says 'complete any required authentication'. Static bearer auth through a custom header may be the simplest route on Grok Bot.
- Docs say only the Grok Bot desktop app offers 'Add a custom connector'; it is unconfirmed whether the mobile apps can add one. grok.com documents connector setup on the web only, not the iOS/Android Grok app.
- Whether Remote MCP works on the legacy Chat Completions endpoint is not stated; docs list only the Responses API, xai-sdk and Speech to Speech.
- No list of models that support Remote MCP is published; examples use grok-4.7.

## How the greats expose tasks to AI

Leading apps converge on one design: a hosted remote MCP server over Streamable HTTP with OAuth 2.1, plus a token fallback. Todoist (ai.todoist.net/mcp), Linear (mcp.linear.app/mcp), Notion (mcp.notion.com/mcp), Asana (mcp.asana.com/v2/mcp) and TickTick (mcp.ticktick.com) all follow it. Linear also offers a /mcp/readonly endpoint and a read-only OAuth scope. TickTick documents setup for both Claude and Grok, using the same URL with OAuth or a Bearer token. Google Tasks has no official MCP server. Things has only a URL scheme (auth-token for updates, 250 items per 10 s) and community stdio servers.

Common tool design:
- Batch, workflow-shaped tools rather than one tool per endpoint (Todoist's own guidelines): add-tasks, complete-tasks, plus a single delete-object.
- Annotations on every tool (readOnlyHint, destructiveHint, idempotentHint). Claude's directory requires them.
- "Delete" means move to Trash in TickTick and Notion.
- Bulk caps, for example TickTick allows 20 completions per call.
- Nobody uses server-side confirmations. Confirmation comes from the client's approval prompts, which the MCP spec says SHOULD exist.

One OAuth server can serve both of your targets:
- **Claude:** remote HTTPS on port 443, reachable from 160.79.104.0/21. It needs a 401 response with WWW-Authenticate pointing to resource metadata, PKCE S256, CIMD or DCR, and the redirect URI https://claude.ai/api/mcp/auth_callback.
- **Grok:** grok.com Connectors > Custom takes a public URL and rejects localhost and private IPs. The xAI API's mcp tool takes server_url, server_label, authorization, headers and allowed_tools.

E2EE and local-first data:
- **Key on a local stdio server:** Standard Notes community MCP keeps keys in the OS keychain; Bitwarden goes through bw CLI with BW_SESSION and is local-only. This works only with local clients.
- **Bridge device plus tunnel:** reachable by web clients, but that device must be online.
- **Scoped, expiring, logged, revocable delegated token:** Proton Pass works this way.
- **Never exposing secrets:** 1Password's position.

In every case decrypted text reaches the model provider.

Prompt injection: task titles and notes are untrusted. Follow Anthropic's guidance and OWASP LLM01: JSON-encode user text, state where it came from, don't put your own instructions in tool results, apply least privilege, require human approval for high-risk actions, and screen outputs. The MCP spec requires servers to validate inputs, rate-limit, sanitize outputs and never pass tokens through.

Recommended tool set for your app (openWorldHint:false on all, ids everywhere, max 50 items per call, every write returns undo_token):
- **Read-only:** get_overview, list_items {view: inbox|today|upcoming|logbook|trash|list, list_id?, parent_id?, depth?, days?, cursor}, search_items, get_item {id, include_children}.
- **Additive:** add_items (nested via parent_id, after_id, due, repeat, notes), create_list.
- **Idempotent:** update_items (notes_mode append|replace), move_items, complete_items (a repeating item spawns its next occurrence), reopen_items, restore_items.
- **Destructive:** trash_items (soft delete that cascades to children), undo {undo_token}.

Leave permanent delete and emptying Trash out of MCP entirely. Offer separate lists:read and lists:write scopes, plus a read-only endpoint.

### Claims

- Todoist hosts a remote MCP server at https://ai.todoist.net/mcp (Streamable HTTP, OAuth; local/library use takes TODOIST_API_KEY). Claude Code: claude mcp add --transport http todoist https://ai.todoist.net/mcp — [primary] https://github.com/Doist/todoist-ai
- Todoist tool set includes find-tasks, find-tasks-by-date, find-completed-tasks, add-tasks, update-tasks, complete-tasks, uncomplete-tasks, reschedule-tasks, reorder-objects, delete-object, get-overview, search, fetch, find-activity, etc. — [primary] https://api.github.com/repos/Doist/todoist-ai/contents/src/tools
- Todoist design philosophy: workflow-centric tools, batch operations (add-tasks takes array), universal delete-object, return structured data plus human text with next steps; anti-pattern is one-to-one API mapping — [primary] https://raw.githubusercontent.com/Doist/todoist-ai/main/docs/tool-design.md
- Todoist delete-object annotations: readOnlyHint false, destructiveHint true, idempotentHint true; complete-tasks takes ids[] and returns completed/failures/successCount (partial-failure batch contract), destructiveHint true — [primary] https://raw.githubusercontent.com/Doist/todoist-ai/main/src/tools/delete-object.ts
- Linear MCP: https://mcp.linear.app/mcp (Streamable HTTP, read-write), https://mcp.linear.app/mcp/readonly (read tools only), SSE deprecated; OAuth 2.1 with dynamic client registration or Authorization: Bearer with OAuth token/API key; read-only OAuth scope yields read-only access — [primary] https://linear.app/docs/mcp
- Linear official MCP uses unified save_issue (create or update) and list_issues tools — [secondary] https://glama.ai/mcp/servers/adelaidasofia/linear-mcp/tools/save_issue
- Notion MCP: https://mcp.notion.com/mcp Streamable HTTP; SSE retired Feb 23 2027; OAuth standard; MCP bearer tokens on Business/Enterprise; guests cannot connect; acts with the user's permissions — [primary] https://developers.notion.com/docs/get-started-with-mcp
- Notion page tools: notion-create-pages, notion-update-page, notion-move-pages, notion-duplicate-page, notion-delete-pages (moves to Trash), notion-get-async-task — [primary] https://developers.notion.com/guides/mcp/tools-pages
- Asana MCP V2 at https://mcp.asana.com/v2/mcp, Streamable HTTP + OAuth; V1 SSE beta shut down 05/11/2026; tool list via tools/list; Enterprise admins can allow/block MCP clients — [primary] https://developers.asana.com/docs/using-asanas-mcp-server
- TickTick official MCP at https://mcp.ticktick.com, Streamable HTTP, OAuth or Bearer token (Settings > Account & Security > API Token); documents setup for Claude and for Grok (Connectors > New Connector > Custom > enter URL > OAuth) — [primary] https://help.ticktick.com/articles/7438129581631995904
- TickTick tools include search_task, get_task_by_id, list_undone_tasks_by_time_query (today,last24hour,last7day,tomorrow,next24hour,next7day), list_undone_tasks_by_date (max 14 days), filter_tasks, create_task, batch_add_tasks, complete_task, complete_tasks_in_project (max 20 per request), update_task, move_task, batch_update_tasks, delete_task (moves to Trash), list_projects, create_project_group, etc. — [primary] https://help.ticktick.com/articles/7438129581631995904
- Things URL scheme: add, add-project, update, update-project, show, search, version, json; modifying commands need auth-token; limits 250 items per 10 seconds, 100 checklist items, notes 10,000 chars; no AI/MCP mention — [primary] https://culturedcode.com/things/support/articles/2803573/
- Community things-mcp reads via things.py (local DB), writes via URL scheme/AppleScript; tools get-today, get-upcoming, get-logbook, get-trash, add-todo, update-todo, bulk-update-todos; macOS only; stdio default, optional HTTP on 127.0.0.1:8000 — [secondary] https://github.com/hald/things-mcp
- Google Workspace MCP servers (Developer Preview, Streamable HTTP, OAuth user-delegated) exist for Gmail, Drive, Docs, Sheets, Slides, Calendar, Chat, People, Classroom; Google Tasks is not included — [primary] https://developers.google.com/workspace/guides/configure-mcp-servers
- Claude custom connectors by URL work on Free (1 connector), Pro, Max, Ultra, Team, Enterprise; auth options Sign in now / when needed / No sign-in; OAuth client via Claude's published identity (CIMD), DCR, or own client; request headers (beta, limited orgs, max 4); users can set per-tool permission to Blocked and Always allow — [primary] https://claude.com/docs/connectors/custom/remote-mcp
- Claude OAuth requirements: 401 with WWW-Authenticate resource_metadata (ignored on 200); resource must equal server URL; uses first authorization_servers entry; PKCE S256; redirect https://claude.ai/api/mcp/auth_callback; Claude Code loopback http://localhost/callback and 127.0.0.1 any port; CIMD requires client_id_metadata_document_supported true and 'none' auth method; refresh errors invalid_grant; rotate refresh tokens; 10s endpoint timeout; egress 160.79.104.0/21; no client_credentials grant — [primary] https://claude.com/docs/connectors/building/authentication
- Claude directory requires every tool to have a title and readOnlyHint or destructiveHint, OAuth 2.0 for authenticated services, and a prompt-injection policy acknowledgment — [primary] https://claude.com/docs/connectors/building/submission
- grok.com custom connectors: grok.com/connectors > New Connector > Custom > MCP server URL + auth; server must be publicly reachable; Business/Enterprise need admin provisioning — [primary] https://docs.x.ai/grok/connectors
- Grok rejects localhost and private addresses (127.0.0.1, 10.x, 172.16.x, 192.168.x); use ngrok or Cloudflare Tunnel; Cloudflare quick tunnels don't support SSE; OAuth/API key flow still completed in Grok — [primary] https://docs.x.ai/grok/connectors/custom-mcp-tunneling
- xAI API remote MCP tool fields: server_url, server_label (required), server_description, allowed_tools, authorization, headers; Streaming HTTP and SSE only; Responses API doesn't support require_approval — [primary] https://docs.x.ai/docs/guides/tools/remote-mcp-tools
- Grok Bot runs on a persistent cloud computer; custom connector via 'Add a custom connector' > Remote HTTPS (URL, optional headers, OAuth client ID) or Command; private-network servers need user approval — [primary] https://docs.x.ai/grok-bot/computer-and-apps
- Grok CLI MCP: grok mcp add; ~/.grok/config.toml [mcp_servers.<name>] with command/args/env/url/headers; OAuth tokens in ~/.grok/mcp_credentials.json — [primary] https://docs.x.ai/build/features/mcp-servers
- MCP ToolAnnotations defaults: readOnlyHint false, destructiveHint true, idempotentHint false, openWorldHint true — [primary] https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2025-11-25/schema.ts
- MCP tools spec: human in the loop SHOULD be able to deny invocations; clients MUST treat annotations as untrusted unless from trusted servers; servers MUST validate inputs, implement access controls, rate limit, sanitize outputs; clients SHOULD confirm sensitive ops; outputSchema requires conforming structuredContent; tool execution errors via isError true — [primary] https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- MCP security best practices: servers MUST NOT accept tokens not issued for them (no token passthrough); MUST NOT treat state handles as auth; progressive least-privilege scopes, avoid wildcard scopes; local HTTP servers should require auth token or use stdio/IPC; proxy servers MUST implement per-client consent — [primary] https://modelcontextprotocol.io/specification/draft/basic/security_best_practices
- Anthropic indirect-injection guidance: put untrusted content only in tool_result blocks, state source/nature in description or result, state untrusted-content policy in system prompt, JSON-encode untrusted strings, don't put your own instructions in tool results, least privilege, screen tool outputs with a small classifier, red-team — [primary] https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks
- OWASP LLM01 mitigations: constrain model behavior, validate output formats, input/output filtering, least privilege, human approval for high-risk actions, segregate/identify external content, adversarial testing — [primary] https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- Obsidian Local REST API binds 127.0.0.1:27124 HTTPS (self-signed CA) / optional 27123 HTTP, Bearer API key, rate-limits bad keys, and ships a built-in Streamable HTTP MCP endpoint at /mcp/ — [secondary] https://github.com/coddingtonbear/obsidian-local-rest-api
- Community Standard Notes MCP decrypts locally (Argon2id + XChaCha20-Poly1305 via libsodium), stores master key/session in OS keychain, stdio only; optional remote-agent bridge via Cloudflare Tunnel + service token — [secondary] https://github.com/lozit/mcp-standardnotes
- Bitwarden MCP server is local-only (never network-exposed), stdio, uses bw CLI with BW_SESSION; unlock via native OS dialog so master password never enters AI context; warns AI can read/modify/delete vault items — [primary] https://github.com/bitwarden/mcp-server
- 1Password will not use MCP to expose raw credentials or secrets, citing prompt injection/exfiltration and no revocation once in context; prefers injecting credentials on agent's behalf, human approval, short-lived scoped credentials — [primary] https://1password.com/blog/where-mcp-fits-and-where-it-doesnt
- Proton Pass access tokens: per-vault scope, expiry 1 hour to 1 year, 'Use for AI agent' logs each access with an agent-supplied reason, immediate irreversible revocation; paid plans only — [primary] https://proton.me/support/pass-access-tokens

### Skeptic verdicts

- **confirmed**: 1. Todoist hosts a remote MCP server at https://ai.todoist.net/mcp (Streamable HTTP, OAuth; local/library use takes TODOIST_API_KEY). Claude Code: claude mcp add --transport http todoist https://ai.to — README: 'Primary URL (Streamable HTTP): https://ai.todoist.net/mcp'; 'complete OAuth authentication'; 'claude mcp add --transport http todoist https://ai.todoist.net/mcp'; library example uses new TodoistApi(process.env.TODOIST_API_KEY). Read https://raw.githubusercontent.com/Doist/todoist-ai/main/R
- **confirmed**: 2. Todoist tool set includes find-tasks, find-tasks-by-date, find-completed-tasks, add-tasks, update-tasks, complete-tasks, uncomplete-tasks, reschedule-tasks, reorder-objects, delete-object, get-over — All 14 named tools are in src/utils/tool-names.ts and have .ts files in src/tools. The full list is about 50 tools, including fetch-object, manage-assignments, add/update/find for projects, sections, comments, reminders, labels and filters, project templates, workspace insights and user status. Read
- **confirmed**: 3. Todoist design philosophy: workflow-centric tools, batch operations (add-tasks takes array), universal delete-object, return structured data plus human text with next steps; anti-pattern is one-to- — 'Batch Operations - Support multiple items when logical (add-tasks takes array)'; 'Always return both structured data AND human-readable text with next steps'; anti-pattern 'One-to-one API mapping without added value'. The doc notes search/fetch are an exception and follow the OpenAI MCP spec, retur
- **confirmed**: 4. Todoist delete-object annotations: readOnlyHint false, destructiveHint true, idempotentHint true; complete-tasks takes ids[] and returns completed/failures/successCount (partial-failure batch contr — delete-object.ts: 'annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }'. complete-tasks.ts takes ids: z.array(...).min(1), returns completed, failures, successCount (also totalRequested, failureCount), with annotations destructiveHint true, idempotentHint false. Read ht (correction: Not wrong, but complete-tasks has idempotentHint false, unlike delete-object.)
- **confirmed**: 5. Linear MCP: https://mcp.linear.app/mcp (Streamable HTTP, read-write), https://mcp.linear.app/mcp/readonly (read tools only), SSE deprecated; OAuth 2.1 with dynamic client registration or Authorizat — 'Our MCP server uses Streamable HTTP as the primary transport'; /mcp/readonly 'only ever exposes read tools'; /sse 'a deprecated fallback'; 'OAuth 2.1 with dynamic client registration'; 'Authorization: Bearer <yourtoken>'; with read scope only, 'the underlying token can't reach write APIs'. Read htt (correction: A third read-only option: an API key created with only the Read permission.)
- **confirmed**: 6. Notion page tools: notion-create-pages, notion-update-page, notion-move-pages, notion-duplicate-page, notion-delete-pages (moves to Trash), notion-get-async-task — The page lists exactly these six tools. notion-delete-pages is described as 'Move pages to Trash'; notion-get-async-task checks whether a create or update has finished. Read https://developers.notion.com/guides/mcp/tools-pages (primary)
- **confirmed**: 7. TickTick official MCP at https://mcp.ticktick.com, Streamable HTTP, OAuth or Bearer token (Settings > Account & Security > API Token); documents setup for Claude and for Grok (Connectors > New Conn — 'TickTick MCP supports the Streamable HTTP transport protocol and supports both OAuth and Bearer Token'; 'Settings > Account & Security > API Token'; Grok: 'select Connectors... Click New Connector... select Custom... Enter the MCP server URL... click Add Connector', then OAuth. Read https://help.ti (correction: For Claude, the page's main path is the directory listing (Customize > search TickTick > Connect), with a separate Cloud MCP custom path. There is also a Claude Code section for OAuth or Bearer Token. In Grok you click 'Add Connector' after entering the URL, then OAuth.)
- **confirmed**: 8. TickTick tools include search_task, get_task_by_id, list_undone_tasks_by_time_query (today,last24hour,last7day,tomorrow,next24hour,next7day), list_undone_tasks_by_date (max 14 days), filter_tasks,  — The tool tables list every named tool. Supported time values: 'today, last24hour, last7day, tomorrow, next24hour, next7day'; 'Maximum date range: 14 days'; complete_tasks_in_project 'Up to 20 tasks per request'; delete_task 'Move a task to the Trash'. Read https://help.ticktick.com/articles/74381295 (correction: Other tools include list_completed_tasks_by_date, complete_checklist_item, get_comment/add_comment, create_project/update_project, update_column, and list/update/delete_project_group.)
- **confirmed**: 9. Claude custom connectors by URL work on Free (1 connector), Pro, Max, Ultra, Team, Enterprise; auth options Sign in now / when needed / No sign-in; OAuth client via Claude's published identity (CIM — 'Free, Pro, Max, Ultra, Team, and Enterprise plans'; 'On the Free plan, you can add one custom connector'; options 'Sign in now / Sign in when needed / No sign-in'; 'Use Claude's published identity / Register automatically / Use your own OAuth client'; 'Request header authentication is in beta and a (correction: The cited URL /docs/connectors/custom/remote-mcp now 308-redirects to https://claude.com/docs/connectors/custom/add-unlisted, so cite the new URL. On Team and Enterprise only Owners (or Enterprise custom roles that manage libraries) add custom connectors; members just connect. On an OAuth connection, Authorization can't be set as a request header.)
- **confirmed**: 10. Claude OAuth requirements: 401 with WWW-Authenticate resource_metadata (ignored on 200); resource must equal server URL; uses first authorization_servers entry; PKCE S256; redirect https://claude. — 'Claude ignores a WWW-Authenticate header on a 200'; 'resource field must equal the URL as the user enters it'; 'Claude uses the first entry'; 'must support S256 PKCE'; 'https://claude.ai/api/mcp/auth_callback'; localhost and 127.0.0.1 matched 'with the port component ignored'; CIMD needs both 'clie (correction: The 10-second limit covers discovery, registration and token endpoints; refresh token requests get up to 30 seconds. The rule is 'rotate or sender-constrain' refresh tokens for public clients. Without a resource_metadata pointer, Claude falls back to probing /.well-known/oauth-protected-resource paths. If private_key_jwt is listed, CIMD can use a confidential-client document.)
- **confirmed**: 11. Claude directory requires every tool to have a title and readOnlyHint or destructiveHint, OAuth 2.0 for authenticated services, and a prompt-injection policy acknowledgment — 'every tool includes a title and the applicable readOnlyHint or destructiveHint'; 'use OAuth 2.0 for authenticated services'; 'Seven policy acknowledgments covering ... prompt injection ... All seven are required.' Read https://claude.com/docs/connectors/building/submission (primary) (correction: Prompt injection is one of seven required acknowledgments. The server must also be remote over HTTPS; local servers go in a plugin.)
- **confirmed**: 12. grok.com custom connectors: grok.com/connectors > New Connector > Custom > MCP server URL + auth; server must be publicly reachable; Business/Enterprise need admin provisioning — 'Go to grok.com/connectors. Click New Connector, then select Custom. Enter the MCP server URL and complete any required authentication.' 'must be reachable over the public internet'; 'For Grok Business and Enterprise users, a team admin must first provision a connector in the cloud console'. Read ht (correction: The docs say connectors are 'available to all Grok users'. Linear and Notion are already in Grok's pre-configured catalog.)
- **confirmed**: 13. Grok rejects localhost and private addresses (127.0.0.1, 10.x, 172.16.x, 192.168.x); use ngrok or Cloudflare Tunnel; Cloudflare quick tunnels don't support SSE; OAuth/API key flow still completed  — '(such as 127.0.0.1, 10.x.x.x, 172.16.x.x, or 192.168.x.x) are not directly reachable, and Grok will reject these URLs'; 'Cloudflare quick tunnels do not support Server-Sent Events (SSE)'; 'you will still complete that flow in Grok after providing the tunnel URL'. Read https://docs.x.ai/grok/connect (correction: Free tunnel URLs usually change on restart, and you must then remove the connector and add it again.)
- **confirmed**: 14. xAI API remote MCP tool fields: server_url, server_label (required), server_description, allowed_tools, authorization, headers; Streaming HTTP and SSE only; Responses API doesn't support require_a — Parameter table: server_url (Yes), server_label (Yes), server_description, allowed_tools, authorization, headers (all No); 'Only Streaming HTTP and SSE transports are supported'; 'The require_approval and connector_id parameters in the OpenAI Responses API are not currently supported.' Read https:// (correction: The cited URL /docs/guides/tools/remote-mcp-tools now 308-redirects to https://docs.x.ai/developers/tools/remote-mcp. connector_id is also unsupported. The native xAI SDK names the fields allowed_tool_names and extra_headers.)

### Open questions

- Is the Lists app data server-readable today, or truly E2EE/local-only? If E2EE, a remote MCP for claude.ai/grok.com needs a bridge device or a delegated key, which weakens the E2EE claim. This decision drives the architecture.
- 'Grok bot' is ambiguous. It could mean grok.com Connectors (custom MCP URL + OAuth), xAI's Grok Bot product (Remote HTTPS connector with optional headers or OAuth client ID), or a self-built bot on the xAI API (mcp tool with server_url plus an authorization header). Each needs different auth. Confirm which one.
- Which OAuth features grok.com requires (DCR vs CIMD vs static client, redirect URI) is undocumented. Test against a real server before committing.
- Claude static request-header auth is beta for a limited set of orgs. Plan on OAuth 2.1 (CIMD and DCR) for personal accounts, with a bearer API token only for the Grok API and CLI.
- Linear's official per-tool names and annotations are not on its docs page. The save_issue/list_issues names come only from secondary aggregators.
- Grok Bot docs state OAuth tokens stay on 'Cursor's connector backend', which is an odd wording. Verify where third-party OAuth tokens are held before trusting Grok Bot with write scopes.

## Lists sync protocol and data model (for a bridge)

Protocol and data-model map for a bridge (Node MCP server holding the pairing code) that reads and writes Lists data without the browser. All paths are relative to /home/ubuntu/sites/lists.remypost.me. I changed no files.

1. RECORD MODEL (src/js/store.js)
- Each node is one flat record {id, f:{field:[value, hlc]}, v}, where v is the newest field stamp (store.js:2, 165, 198). Defaults come from DEF (store.js:89-94): kind 'item', pos null, title '', notes '', done false, doneAt null, when null, evening false, someday false, deadline null, time null, rrule null, repeatFrom 'when', priority 0, heading false, tags null, deleted false, deletedAt null, created 0, color null. There is also an extra `origin` field on repeat logs (actions.js:127).
- kind is one of 'item', 'inbox' or 'log'. A heading is not a kind: it is the boolean `heading` (actions.js:237-240).
- 'root' is virtual and has no record. A list is any node whose pos.parent is 'root' (store.js:3, 6). The Inbox is the record id 'inbox' with {kind:'inbox', title:'Inbox', pos:{parent:'root', key:'a0', prev:null}}, and every device creates it on its first boot (main.js:427-428).
- pos is {parent, key, prev}. key is a fractional index and prev is the previous parent, used for cycle repair (store.js:264-265). A missing pos falls back to {parent:'inbox', key:'a0'} (store.js:99), and a missing or void parent shows the node under the Inbox (store.js:217-223).
- Field types:
  - when and deadline are floating local 'YYYY-MM-DD' strings (parse.js:3, 44).
  - doneAt, deletedAt and created are epoch milliseconds (actions.js:108, 226; ops.js:65).
  - time is 'HH:MM' (parse.js:120). priority is 0-3 (actions.js:281; parse.js:132). tags is a string array or null.
  - rrule is a FREQ/INTERVAL/BYDAY/BYMONTHDAY/BYMONTH string, and UNTIL is honoured (parse.js:111, 161-165). repeatFrom is 'when' or 'done'.
  - someday is cleared when a date is set (actions.js:246). color is in DEF but nothing in the app uses it.
- New ids are 'n' + base36 time + random digits (store.js:151). A create writes created and deleted:false with every other field (ops.js:62-67).
- Today shows open items with when ≤ today or deadline ≤ today. Items with evening set and when ≤ today go in a separate evening group (store.js:311, 456-460).

2. HLC AND MERGE
- Stamp format: ms.toString(36) padded to 9 chars, '.', counter in base36 padded to 4, '.', device id. Plain string comparison orders stamps (store.js:10-18).
- Receiving a stamp moves the local clock forward, but stamps more than a day in the future are ignored (store.js:19-25). Import checks stamps against /^[0-9a-z]{9}\.[0-9a-z]{4}\.[\w-]{1,24}$/ (panels.js:181).
- Merge is last-writer-wins per field: the incoming field wins if its stamp is greater (store.js:188-196).
- A bridge must keep a monotonic clock, observe every pulled stamp, use its own device suffix, stamp every field it writes with one fresh tick, and set v to that tick.

3. ORDERING
- Use keyBetween(a, b) (store.js:70-86). The first key is 'a0'. To append, call keyBetween(lastLiveSiblingKey, null). To insert at an index, use posBetween or posAt (store.js:391-402), which count live siblings only.
- Siblings sort by (key, id) (store.js:100-103). Equal keys are re-keyed locally (store.js:403-410).
- store.js and parse.js have no DOM dependency (the unit tests import store.js). actions.js does not load in Node, because state.js calls matchMedia when it loads (state.js:14).

4. CRYPTO (src/js/sync.js)
- The pairing code is 52 Crockford base32 chars in 13 groups of 4. Decoding ignores case, spaces and dashes, maps O to 0 and I/L to 1, and requires the 4 padding bits to be zero (sync.js:19-34). It decodes to a 32-byte key.
- HKDF-SHA256 with a salt of 32 zero bytes derives two things (sync.js:37-44):
  - info 'lists/auth/v1' gives 256 bits, hex-encoded, used as the Bearer token;
  - info 'lists/enc/v1' gives an AES-GCM-256 key.
- The server finds the vault by SHA-256 of the token (sync_server.py:377, 431).
- Each record is encrypted separately. The plaintext is JSON.stringify(record), with a random 12-byte IV and AAD `${id}|${v}`. The blob is base64url without padding of 0x01 ‖ iv ‖ ciphertext+tag (sync.js:46-55).
- unseal rejects a blob if the id or v inside does not match the row (sync.js:58-65). `b: null` is a purge marker.
- Request bodies over 1 KB are gzipped and sent with Content-Encoding: gzip (sync.js:98-102).
- sync.js itself runs in Node: tests/unit/sync.test.mjs imports createSync, seal, unseal and deriveKeys.

5. HTTP API
- Endpoint: POST /api/sync (via Caddy at https://lists.remypost.me/api/*, caddy.lists.conf:21-31).
- Headers: `authorization: Bearer <64 hex>`, `content-type: application/json`. Content-Length is required and chunked bodies get 411 (sync_server.py:381-385).
- Request body: {dev, since, push:[{id, v, b}], create?:true, pull?:false}.
  - dev must match [A-Za-z0-9_-]{1,64}; the app uses 'd_' + 16 hex.
  - The server allows up to 1000 rows per push; the client sends at most 200 rows or 256 KB.
  - id is at most 128 chars, v at most 64, b at most 90 KiB (sync_server.py:283-299; sync.js:6, 154, 226).
- Response: {rows:[{s, id, v, b}], cursor, more, head} or {reset:true}.
  - Pull returns rows with seq > since from other devices only (`dev<>?`), 500 rows or about 512 KB per page.
  - cursor is the last row returned when more is true, otherwise head. With pull:false the cursor stays at since (sync_server.py:181-197).
  - The client saves res.cursor and loops while more is true (sync.js:145-170).
- Reset: when 0 < since < horizon, or since ≥ next_seq, the client sets its cursor to 0 and re-queues every record (sync.js:159).
- Inserts are idempotent on (vault, rid, ver): pushing the same id+v again does nothing (sync_server.py:163-165).
- Compaction: a non-null push deletes that record's older rows with seq ≤ since. A purge marker deletes every older row (sync_server.py:167-175).
- Joining: a device with no vault on record must not send `create`. An unknown token gets 401. Only a request with "create":true creates a vault (sync_server.py:442-458; sync.js:230-243).
- Limits:
  - 60 requests per minute per vault, shared by all devices;
  - for unknown tokens, 10 failures per IP per 10 minutes and 5 new vaults per IP per hour;
  - 2 body slots, with 503 and Retry-After: 2 when none is free;
  - quota of 50 MB or 100k rows per vault (507 "vault full"), and a 500 MB disk guard (507 "server full") (sync_server.py:493-505; server/README.md:44-56).
- Other endpoints: GET /api/health and DELETE /api/vault. DELETE wipes the vault, so a bridge must never call it.
- Client backoff: 429 and 503 honour Retry-After, 507 waits 6 hours, other failures double from 15 s up to 30 minutes, and 401 stops automatic sync (sync.js:174-176).

6. REPEATS (actions.js:104-139)
Completing an item that has an rrule does not set done on it. Instead:
- The app creates a log record: kind 'log', copying title, notes, evening and deadline; done:true, doneAt:now; when = min(base, today); pos at the end of the same parent; origin = the item's id.
- It moves the original's when to nextOccurrence. In 'when' mode the date keeps moving forward until it is today or later.
- It shifts the deadline by the same offset, or sets it to the next date if the item has only a deadline.
- It clears done on the item's descendants.
- If UNTIL has passed, nextOccurrence returns null, so when becomes null and the item stays open.
The bridge must copy this logic itself, because actions.js cannot load in Node.

7. TRASH AND UNDO
- deleted is false, 'trash' or 'void'.
  - Trash: {deleted:'trash', deletedAt}. Restore: {deleted:false, deletedAt:null} (actions.js:222-231).
  - Delete forever: 'void' and blank title and notes on the node and all descendants (actions.js:232-236). Backspace on an empty row and undo of a create also use 'void' (input.js:132; ops.js:56).
- Children of a void node move to the Inbox (store.js:166-168, 222). The Trash view shows only 'trash' roots (store.js:493-497).
- The design doc's `deleted:[true,h]` and its 30-day purge (04-architecture.md:130-142) are not in the code. grep found no purge emitter, and mergeRemote drops records with f == null (store.js:185).
- Undo lives in memory and works as a fresh write. It skips fields that changed since the step (ops.js:69-82).

8. RISKS OF A SECOND WRITER
- **Compaction (most important).** Always push complete merged records, and only with a `since` you have actually applied. If you push a partial record or use an un-merged since, the server deletes the older full versions. Existing devices keep their copies, but a new or reset device rebuilds a record that is missing fields; for example, pos falls back to the Inbox.
- **Device ids.** Use a unique dev, or the pull filter hides rows from the device you share it with. Use a unique HLC suffix too.
- **Version stamps.** Use a fresh v for every push, or the server silently ignores it as a duplicate.
- **Rate budget.** Do not burn the shared 60-requests-per-minute budget.
- **Clock skew.** A bridge clock that runs fast always wins LWW.
- **Inbox.** Do not recreate 'inbox' if it already exists.
- **Concurrency.** The server serialises each request in one BEGIN IMMEDIATE transaction (sync_server.py:119-127). Web Locks only coordinate tabs inside one browser (sync.js:89-95). The browser does not re-push merged records (main.js:22-26, 150), so concurrent rows sit on the server until the next edit.

### Claims

- Record shape is {id, f:{field:[value,hlc]}, v}; merge is per-field LWW on HLC — [primary] src/js/store.js:2-4
- DEF defaults: kind 'item', pos null, title '', notes '', done false, doneAt null, when null, evening false, someday false, deadline null, time null, rrule null, repeatFrom 'when', priority 0, heading false, tags null, deleted false, deletedAt null, created 0, color null — [primary] src/js/store.js:89-94
- ROOT='root' (virtual), INBOX='inbox'; lists are nodes whose parent is ROOT — [primary] src/js/store.js:3-7
- Inbox record created on first boot with kind 'inbox', title 'Inbox', pos {parent:'root', key:'a0', prev:null} — [primary] src/js/main.js:427-428
- HLC format ms base36 padded 9 '.' counter base36 padded 4 '.' device; string compare orders stamps — [primary] src/js/store.js:10-18
- observe() advances clock from remote stamps, ignoring stamps > now+1 day or counter > 1e6 — [primary] src/js/store.js:19-25
- patch stamps all written fields with one tick and sets r.v to it — [primary] src/js/store.js:154-178
- mergeRemote: incoming field wins iff its stamp > local; v recomputed as max field stamp; records without f are skipped — [primary] src/js/store.js:181-206
- Import validator HLC regex /^[0-9a-z]{9}\.[0-9a-z]{4}\.[\w-]{1,24}$/, id <=64 chars, when/deadline YYYY-MM-DD, pos needs string parent and key — [primary] src/js/panels.js:180-194
- Browser HLC device id is a 6-char random base36 string stored in meta 'device' — [primary] src/js/main.js:416-418
- Missing pos defaults to {parent:inbox,key:'a0'}; siblings sorted by (key, id) — [primary] src/js/store.js:99-103
- Parent that is missing or void makes node display under INBOX — [primary] src/js/store.js:217-223
- Cycle repair uses pos.prev and newest pos stamp loses — [primary] src/js/store.js:244-270
- keyBetween(a,b) fractional index; keyBetween(null,null)='a0' — [primary] src/js/store.js:70-86
- posBetween/posAt compute pos among live children; equal keys trigger rekey — [primary] src/js/store.js:390-410
- newId = 'n' + Date.now base36 + two random uint32 base36 — [primary] src/js/store.js:151
- O.create writes created: Date.now() and deleted:false along with fields — [primary] src/js/ops.js:62-67
- Undo is a fresh write of before-values that skips fields changed since; undo of create sets deleted 'void' — [primary] src/js/ops.js:47-82
- Today = open items with when<=today or deadline<=today; evening split when evening && when<=today — [primary] src/js/store.js:311,456-460
- Dates are floating local YYYY-MM-DD; ymd uses local Date — [primary] src/js/parse.js:3,44
- Priority tokens: ! to !!! -> 1..3, p1->3, p3->1; cyclePriority mod 4 — [primary] src/js/parse.js:132
- rrule strings built as FREQ=...;INTERVAL=n;BYDAY/BYMONTHDAY/BYMONTH; repeatFrom 'done' for every!/after — [primary] src/js/parse.js:98-112
- nextOccurrence(rule, from, repeatFrom, done) honours UNTIL, returns null past it — [primary] src/js/parse.js:161-165
- Completing a repeating item creates a kind:'log' record (title, notes, done true, doneAt, when=min(base,today), evening, deadline, pos at end of same parent, origin=id), rolls original's when forward (to >= today in 'when' mode), shifts deadline by offset, un-dones descendants; original never set done — [primary] src/js/actions.js:104-139
- Log items excluded from outline visibility and open counts but shown in Today-done and Logbook — [primary] src/js/actions.js:15-18
- Trash sets deleted:'trash' + deletedAt; restore sets deleted:false, deletedAt:null — [primary] src/js/actions.js:222-231
- Delete forever sets deleted:'void' and blanks title/notes on node and descendants — [primary] src/js/actions.js:232-236
- Trash view lists only deleted==='trash' records with no deleted ancestor — [primary] src/js/store.js:493-497
- Voiding a node with children re-parents its subtree (rebuild) — [primary] src/js/store.js:166-168
- Architecture doc describes deleted:[true,h] and 30-day purge markers, which the src code does not implement — [primary] docs/research/04-architecture.md:130-142
- Pairing code: 52 Crockford base32 chars, groups of 4; decode ignores case/spaces/dashes, O->0, I/L->1, padding bits zero — [primary] src/js/sync.js:19-34
- HKDF-SHA256, salt 32 zero bytes, info 'lists/auth/v1' -> 256-bit hex bearer token, 'lists/enc/v1' -> AES-GCM-256 key — [primary] src/js/sync.js:37-44
- Per-record AES-GCM with random 12-byte IV, AAD `${id}|${v}`, plaintext JSON.stringify(rec), blob base64url(0x01||iv||ct+tag) unpadded; f==null -> b:null purge marker — [primary] src/js/sync.js:46-55
- unseal rejects key-version != 1 and id/v mismatch inside plaintext — [primary] src/js/sync.js:58-65
- Request body gzipped when >1024 bytes, headers authorization Bearer, content-type application/json, content-encoding gzip — [primary] src/js/sync.js:97-108
- Client batches push to 200 rows / 256 KB, skips blobs >90 KiB; loops while more/outbox/rows, max 100 rounds; reset -> cursor 0 + requeueAll — [primary] src/js/sync.js:139-170
- Backoff: 429/503 Retry-After (default 60s), 507 6 h, else 15s*2^fails capped 30 min; 401 halts auto sync — [primary] src/js/sync.js:171-177
- sync dev id is 'd_' + 16 hex; createVault sets mk=1 which sends create:true until first success; join never sends create — [primary] src/js/sync.js:224-243
- Server validates dev [A-Za-z0-9_-]{1,64}, since int >=0, push <=1000 rows, id<=128, v<=64, b<=90 KiB base64url — [primary] server/sync_server.py:283-299
- Vault looked up by SHA-256(token) before body read; token must be 64 lowercase hex — [primary] server/sync_server.py:371-377
- Unknown token without create:true -> 401; with create creates vault (5/IP/hour) — [primary] server/sync_server.py:442-458
- INSERT OR IGNORE on (vault,rid,ver) makes retries no-ops; same id+v with different blob is silently dropped — [primary] server/sync_server.py:162-165
- Compaction: pushed non-null version deletes same-rid rows with seq<=since; purge marker deletes all older — [primary] server/sync_server.py:167-175
- Quota 507 rolls back a push that grows vault over max rows/bytes — [primary] server/sync_server.py:176-180
- Pull returns seq>since rows where dev<>requesting dev, pages 500 rows/512KB; cursor = last s if more, head if pull, else since; response {rows,cursor,more,head} — [primary] server/sync_server.py:181-197
- Reset returned when 0<since<horizon or since>=next_seq — [primary] server/sync_server.py:158-159
- Device confirmed position recorded as since for GC — [primary] server/sync_server.py:193-196
- Each sync runs in one BEGIN IMMEDIATE transaction under a lock (serialises concurrent writers) — [primary] server/sync_server.py:119-127
- Rate limits: 10 auth failures/IP/10min, 5 new vaults/IP/hour, 60 req/vault/min; 2 body slots — [primary] server/sync_server.py:493-505
- No body slot within 2 s -> 503 Retry-After 2 — [primary] server/sync_server.py:302-307
- Content-Length required (411), body >512KB -> 413, only gzip/identity encodings (415) — [primary] server/sync_server.py:379-406
- DELETE /api/vault wipes the vault; GET /api/health returns {ok:true} — [primary] server/sync_server.py:422-469
- Caddy proxies /api/* to lists-sync:8787 with 2MB body cap and X-Real-IP — [primary] deploy/caddy.lists.conf:21-31
- Browser applyRemote = mergeRemote + flush; persistHook(rec,false) does not add merged records to outbox; local edits go to outbox and trigger maybeSync('edit') — [primary] src/js/main.js:22-26,145-158
- Outbox returns full current records (clone of S.recs entry); ack drops only if v unchanged — [primary] src/js/db.js:127-150
- Web Lock 'lists-sync' coordinates only tabs within a browser — [primary] src/js/sync.js:88-95
- Pairing link is origin + '/#pair=' + code without dashes; joining requeues all local records — [primary] src/js/panels.js:19-27,119
- state.js calls matchMedia at module load, so actions.js (which imports it) cannot run in Node — [primary] src/js/state.js:14-22
- sync.js is importable in Node (unit test imports createSync, seal, unseal, deriveKeys) — [primary] tests/unit/sync.test.mjs:11

### Skeptic verdicts

- **confirmed**: Record shape is {id, f:{field:[value,hlc]}, v}; merge is per-field LWW on HLC — store.js:2,4 'One flat record per node: { id, f: { field: [value, hlc] }, v: hlc }' and 'per-field last-writer-wins on hybrid logical clocks'
- **confirmed**: DEF defaults list (kind 'item' ... color null) — store.js:89-94 DEF matches all 20 keys and values exactly, including repeatFrom:'when', priority:0, created:0
- **confirmed**: ROOT='root' (virtual), INBOX='inbox'; lists are nodes whose parent is ROOT — store.js:6-7 export const ROOT = 'root'; INBOX = 'inbox'; line 3 'Lists are nodes whose parent is ROOT'. rawParent(INBOX) returns ROOT (217-218)
- **confirmed**: Inbox record created on first boot with kind 'inbox', title 'Inbox', pos {parent:'root', key:'a0', prev:null} — main.js:427-428 first = !S.recs.has(S.INBOX); S.patch(S.INBOX,{kind:'inbox',title:'Inbox',pos:{parent:S.ROOT,key:'a0',prev:null}}) (correction: Strictly 'whenever no inbox record exists after hydrate' (also after storage loss/broken storage), not only literal first boot.)
- **confirmed**: HLC format ms base36 padded 9 '.' counter base36 padded 4 '.' device; string compare orders stamps — store.js:10,13 ms.toString(36).padStart(9,'0') + '.' + c.toString(36).padStart(4,'0') + '.' + device
- **confirmed**: observe() advances clock from remote stamps, ignoring stamps > now+1 day or counter > 1e6 — store.js:23 if (!(ms <= Date.now() + 864e5) || !(c >= 0) || c > 1e6) return; (correction: Also ignores non-string, NaN or negative counters. Ignoring only affects the clock; mergeRemote still applies the field value carrying that stamp.)
- **confirmed**: patch stamps all written fields with one tick and sets r.v to it — store.js:156,162,165 const h = tick(); r.f[k] = [fields[k], h]; r.v = h;
- **confirmed**: mergeRemote: incoming field wins iff its stamp > local; v recomputed as max field stamp; records without f are skipped — store.js:185,192,198 '!inc.f) continue'; 'if (!r.f[k] || e[1] > r.f[k][1])'; v = reduce max of field stamps (correction: Nuance: a field missing locally always wins; non-array field entries and records with non-string id are also skipped; an unknown id is inserted into recs even if no field ends up applied.)
- **confirmed**: Missing pos defaults to {parent:inbox,key:'a0'}; siblings sorted by (key, id) — store.js:99-102 posOf ... || { parent: INBOX, key: 'a0' }; cmp compares key then id
- **confirmed**: Parent that is missing or void makes node display under INBOX — store.js:221-222 return pr && !(pr.f.deleted && pr.f.deleted[0] === 'void') ? p : INBOX; (correction: Except parent ROOT, which is returned as-is (line 220).)
- **confirmed**: keyBetween(a,b) fractional index; keyBetween(null,null)='a0' — store.js:70-71 export function keyBetween(a, b) { if (a == null && b == null) return 'a0';
- **confirmed**: posBetween/posAt compute pos among live children; equal keys trigger rekey — store.js:394 'if (a != null && b != null && a >= b) { rekey(parent); ...'; posAt uses children() = live filter (284) (correction: Rekey fires on a >= b (equal or inverted keys), not only equal; rekey re-patches all children incl. deleted (childrenAll). Function lines are 391-410, rekey 403-410.)
- **confirmed**: O.create writes created: Date.now() and deleted:false along with fields — ops.js:62-65 set(id, { created: Date.now(), ...fields, deleted: false }); (correction: Caller-supplied fields.created overrides Date.now() (spread order); deleted:false always forced. fields.id is used as id then removed.)
- **confirmed**: Dates are floating local YYYY-MM-DD; ymd uses local Date — parse.js:3 'Dates are floating local YYYY-MM-DD'; parse.js:44 ymd uses getFullYear/getMonth/getDate (correction: Same comment adds that internally dates are computed as whole UTC day numbers.)

### Open questions

- Which timezone should the bridge use for today() and repeat roll-forward? Dates are floating local, so a bridge in UTC could pick a different day from the user's devices.
- Should the bridge call lists-sync:8787 directly on n8n_default, or go through https://lists.remypost.me/api? The two paths give different IP rate-limit keys and the direct path skips the Caddy body cap.
- Node is not on PATH in this VM shell ('node: command not found'), so where will the bridge's Node runtime come from (nvm, docker)?
- Should the bridge keep a persistent full replica (cursor plus all records), or pull from 0 on every start? Either way it must push only full merged records.
- Is the app's lack of 30-day purge markers intended? It means trashed and voided records stay on the server indefinitely, and the bridge needs to filter them out.
- Should the bridge's writes be undoable in the browser? Browser undo stacks are in memory and local, so bridge edits cannot be undone there.
