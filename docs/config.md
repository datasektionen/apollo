# Apollo configuration

This file documents the environment variables used by Apollo.

## Routing

| Variable | What it does                                                             | Default / behavior                       |
| --- |--------------------------------------------------------------------------|------------------------------------------|
| `WEB_PORT` | Port for the frontend dev server or web container.                       | `3000`                                   |
| `API_PORT` | Port for the backend API server.                                         | `8787`                                   |
| `DB_PORT` | Port for the local PostgreSQL-server if `DATABASE_URL` is not set. | `5432`                                   |
| `OIDC_MOCK_PORT` | Port for the local mock OpenID Connect provider.                         | `9400`                                   |

| Variable | What it does                                                                                                                          | Default / behavior                  |
| --- |---------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------|
| `PUBLIC_BASE_URL` | Public base URL for Apollo, used when the backend needs to generate public-facing URLs.                                               | Derived from the current request    |
| `API_UPSTREAM_ORIGIN` | Full internal backend origin used by the frontend proxy for `/api` and `/ws`. | Defaults to `http://localhost:<API_PORT>` for npm dev and `http://api:<API_PORT>` in Docker |
| `DATABASE_URL` | Full PostgreSQL connection string for the backend.                                                                                    | Derived from local defaults and `DB_PORT`    |
| `OIDC_ISSUER` | OpenID Connect issuer URL. If empty, Apollo uses the local mock issuer on `OIDC_MOCK_PORT`.                                           | `http://localhost:<OIDC_MOCK_PORT>` |
| `OIDC_PUBLIC_ISSUER` | Public issuer URL exposed to browsers if it differs from the backend's internal issuer URL. | `OIDC_ISSUER`                       |
| `ABSOLUTE_MEDIA_ROOT` | Absolute path for uploaded media storage. (Docker will always mount this to `/data/media`)                                            | `server/media`                      |
| `WEB_BIND_HOST` | Bind host for the Vite dev server and Docker port mapping.                                                                            | `0.0.0.0` (lissens everywhere)      |
| `VITE_USE_HTTPS` | Enables HTTPS for local frontend.                                                            | `false`                             |

## Backend server

| Variable | What it does | Default / behavior |
| --- | --- | --- |
| `MAX_UPLOAD_BYTES` | Maximum upload size accepted by the backend. | `524288000` (500 MB) |
| `RECORD_LOCK_TIMEOUT_SECONDS` | How long a record or edit lock is kept before timing out. | `30` |
| `CHECKPOINT_EVERY_OPS` | How many operations Apollo processes before forcing a checkpoint/save boundary. | `100` |
| `CHECKPOINT_EVERY_SECONDS` | Time-based checkpoint interval used together with the operation-based checkpoint limit. | `30` |
| `MEDIA_GC_TTL_HOURS` | How long unused audio blobs stay on disk after the last project stops referencing them. | `168` (7 days) |
| `MEDIA_GC_HOUR` | Local server hour when expired-media cleanup runs once per night. | `4` (04:00) |
| `MEDIA_GC_ATTACH_GRACE_SECONDS` | Delay before a newly uploaded blob with no project reference is marked unused. Avoids quarantining in-flight uploads. | `3600` |

## Sessions

| Variable | What it does | Default / behavior           |
| --- | --- |------------------------------|
| `JWT_ACCESS_SECRET` | Secret used to sign short-lived access tokens. Required for backend startup. | `change-this-access-secret`  |
| `JWT_REFRESH_SECRET` | Secret used to sign refresh tokens. Required for backend startup. | `change-this-refresh-secret` |
| `ACCESS_TOKEN_TTL` | Lifetime for access tokens. | `15m`                        |
| `REFRESH_TOKEN_TTL_DAYS` | Refresh token lifetime in days. | `7`                          |
| `COOKIE_SECURE` | Controls whether auth cookies require HTTPS. Keep `false` in local HTTP dev, set `true` behind HTTPS in production. | `false`                      |

## OpenID Connect

| Variable | What it does | Default / behavior   |
| --- | --- |----------------------|
| `OIDC_CLIENT_ID` | Client ID Apollo uses with the OIDC provider. Required for OIDC startup. | `apollo-dev`         |
| `OIDC_CLIENT_SECRET` | Client secret for the OIDC provider when the provider requires one. | `apollo-dev-secret`  |
| `OIDC_USE_PKCE` | Controls whether Apollo uses PKCE in the authorization code flow. | `true` |
| `OIDC_SCOPES` | Space-separated list of scopes Apollo requests during login. | `openid profile email` |
| `OIDC_FIRST_ADMIN_CLAIM` | Optional bootstrap rule for granting the first Apollo admin based on a claim in the OIDC profile or token. | -                    |
| `OIDC_REDIRECT_URI` | Explicit callback URL override for the OIDC login flow. Leave empty to derive it from the request or `PUBLIC_BASE_URL`. | -                    |
| `OIDC_POST_LOGOUT_REDIRECT_URI` | Explicit logout redirect URL override after provider logout. Leave empty to derive it automatically when possible. | -                    |

Examples:

- `OIDC_FIRST_ADMIN_CLAIM=email=alice@example.com`
- `OIDC_SCOPES=openid profile email permissions`
- `OIDC_FIRST_ADMIN_CLAIM=permissions.id=nyckeln-under-dormattan`

## Notes

- If `DATABASE_URL` & `OIDC_ISSUER` is internal npm-backend and docker-backend interpret them differently and only one at a time can be supported.
- `API_UPSTREAM_ORIGIN` should be an internal URL the frontend proxy can reach. When it is set, Apollo uses it instead of composing a backend address from `API_PORT`.
- `PUBLIC_BASE_URL`, `OIDC_PUBLIC_ISSUER`, `OIDC_REDIRECT_URI`, and `OIDC_POST_LOGOUT_REDIRECT_URI` should be public-facing URLs, not Docker-internal hostnames.
