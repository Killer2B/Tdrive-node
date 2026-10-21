# Tdrive Developer API v1

Base URL: `https://<your-tdrive-host>/api/v1`

The JSON API uses API keys; create and revoke them in **Account → Developer API keys**. A key is shown only once and is stored server-side as a SHA-256 hash. Account username/password also works via HTTP Basic (useful for WebDAV-style clients), and a key may be supplied as the Basic password with any username.

```http
Authorization: Bearer tdk_<64 lowercase hex characters>
```

```http
X-API-Key: tdk_<64 lowercase hex characters>
```

```http
Authorization: Basic base64(username:password)
```

Every JSON success uses `{ "ok": true, "data": ... }`. Errors use `{ "ok": false, "error": { "code": "...", "message": "..." } }`. Content downloads are byte streams (not JSON) and include `ETag`, `Accept-Ranges`, and `Content-Range` where applicable. JSON responses are not cached and include `X-Request-Id`.

## API index and identity

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1` | API version, chunk size, limits, capabilities |
| GET | `/api/v1/me` | User identity and storage usage |
| GET | `/api/v1/openapi.json` | OpenAPI 3.1 description |

## Files

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/files?path=/&sort=newest&limit=100&offset=0` | List child folders and files |
| POST | `/api/v1/files?name=notes.txt&path=/` | One-shot upload of raw bytes, limited to one configured upload chunk |
| GET | `/api/v1/files/:id` | File metadata |
| GET/HEAD | `/api/v1/files/:id/content` | Download with HTTP Range and `?download=1` |
| GET | `/api/v1/files/:id/chunks` | Chunk manifest with offsets and SHA-256 checksums |
| POST | `/api/v1/files/:id/delta` | Compare `{ "checksums": ["..."] }` against the current chunk manifest |
| PATCH | `/api/v1/files/:id` | Update `{ "name", "path", "favorite" }` metadata |
| DELETE | `/api/v1/files/:id` | Move to trash; `?permanent=1` permanently deletes |
| POST | `/api/v1/files/:id/shares` | Create a view/download share |
| GET | `/api/v1/files/:id/shares` | List shares for a file |

One-shot uploads require `Content-Length`, `Content-Type: application/octet-stream`, and a filename in `?name=` or `X-Filename`. `Idempotency-Key` makes retries reuse the upload session.

Sort values: `newest`, `oldest`, `name`, `name_desc`, `largest`, `smallest`. `limit` is 1–500. Paths are virtual folder paths beginning at `/`.

## Folders

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/folders?path=/` | List child folders |
| POST | `/api/v1/folders` | Create `{ "name": "Documents", "path": "/" }` |
| PATCH | `/api/v1/folders` | Rename `{ "path": "/", "name": "Documents", "newName": "Docs" }` |
| DELETE | `/api/v1/folders?path=/&name=Documents` | Move contained files to trash and remove the folder tree |

## Resumable uploads

1. `POST /api/v1/uploads` with `{ "name", "path", "size", "fingerprint?", "clientKey?" }`.
2. `PUT /api/v1/uploads/:id/parts/:idx` with raw bytes and optional `X-Content-SHA256`.
3. `GET /api/v1/uploads/:id` to inspect received/missing chunks.
4. `POST /api/v1/uploads/:id/complete` to finalize; use `DELETE /api/v1/uploads/:id` to abort.

Each chunk is hashed on the server. The configured chunk size and maximum file size are reported by `GET /api/v1`.

## Chunk lookup, views, trash, and shares

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/chunks/lookup` | Find existing chunk checksums in `{ "checksums": [...] }` |
| GET | `/api/v1/recent` | Recently modified files; accepts `limit` and `offset` |
| GET | `/api/v1/favorites` | Favorite files; accepts `limit` and `offset` |
| GET | `/api/v1/search?q=...` | Search file names |
| GET | `/api/v1/trash` | List trashed files |
| POST | `/api/v1/trash/:id/restore` | Restore one file |
| POST | `/api/v1/trash/empty` | Permanently empty the trash |
| GET | `/api/v1/shares` | List shares |
| DELETE | `/api/v1/shares/:token` | Revoke a share |

Create a share with `{ "permission": "view"|"download", "expiresInHours": 24, "maxDownloads": 10, "password": "..." }`. A view-only share rejects direct download requests.

## WebDAV

WebDAV is mounted at `/dav/` and exposes the whole drive to any WebDAV client (Obsidian/Remotely Save, Finder, Windows Explorer, rclone, Office, …).

**Authentication.** Two equivalent options:

```http
Authorization: Basic base64(username:password)   # your Tdrive account
Authorization: Basic base64(any:tdk_…)           # an API key as the password
```

`Authorization: Bearer` and `X-API-Key` are also accepted. Only HTTPS should be used in production.

**Supported methods:** `OPTIONS`, `PROPFIND` (Depth `0`, `1`, `infinity`), `PROPPATCH`, `MKCOL`, `GET`, `HEAD`, `PUT` (including large files), `DELETE`, `MOVE`, `COPY`, `LOCK`, and `UNLOCK`. Responses include `ETag`, `Last-Modified`, `Content-Length`, `resourcetype`, `quota-used-bytes`, and `quota-available-bytes`. `If-Match` / `If-None-Match` are honored on `PUT` (`412` on mismatch); write locks return `423` unless the token is sent in `If`/`Lock-Token`. Cross-origin `Destination` headers and moves/copies into the source directory itself are rejected. `DELETE` moves files to Tdrive trash.

Any file type syncs unchanged — notes, images, e-books, bookmarks exports, highlights, and large archives — with Unicode/Arabic names and nested folders. Point your sync client at `https://<host>/dav/` (or a subfolder such as `/dav/Notes`).

## Compatibility notes

This Node application currently supports the routes listed above. Archived file versions, content revisions/delta uploads, content-defined chunking, and per-key quota/rate-limit settings are not implemented yet; the API index reports the versioning and CDC capabilities as disabled. Unlike the reference API, folder deletion removes the folder tree after moving its files to trash.

The data layer runs on **Supabase (Postgres)** only — there is no local database at runtime. The application connects with `SUPABASE_DB_URL`, keeps all state in the `tdrive` schema (provisioned through Supabase MCP), and every repository call is asynchronous. `npm run db:migrate` verifies that the schema, tables and row-level-security policies are present. See [`supabase/README.md`](./supabase/README.md).
