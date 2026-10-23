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

## Drive Browser And Operations

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/drive?folderId=root&sort=name&order=asc&limit=100&offset=0` | One paginated folder page, including folders and active files |
| GET | `/api/v1/drive?q=report` | Global literal, case-insensitive search of this user's active file and folder names |
| GET | `/api/v1/folders/:id` | Owned folder and direct ancestry, including a virtual root breadcrumb |
| POST | `/api/v1/operations` | Mixed-selection rename, move, copy, or file trash |

The browser/session mirrors are `GET /api/drive`, `GET /api/folders/:id`, and `POST /api/drive/operations`. They use the existing signed session cookie and Origin protection; they return the data directly, without the v1 `{ok:true,data:...}` envelope.

Drive data is `{folders,files,breadcrumbs,nextOffset,total}`. A folder is `{id,name,parentId,path,modified}`. Files use the browser's `toApiFile` representation: `id`, `name`, `type`, `extension`, `mime`, `size`, `sizeBytes`, `folderId`, `sha256`, `status`, `source`, `sourceUrl`, media dimensions/duration, thumbnail/star/pin/trash flags, and millisecond timestamps. This new representation intentionally differs from legacy `/api/v1/files` metadata. Search results carry file `folderId` and folder `parentId`/`path`; retrieve the parent ancestry with `/api/v1/folders/:id` when needed.

`folderId` defaults to `root`; non-root values must belong to the authenticated user. `sort` is `name|modified|size`, `order` is `asc|desc`, `limit` is 1-500 (default 100), and `offset` is nonnegative. Folders precede files; the requested sort applies within each type, with stable ID tie breaks. Folder size sorts as zero. Pagination and `total` cover the combined entries, not separate folder/file pages. `q`, when present (including an empty string), searches globally; omission lists only the requested folder. `%`, `_`, and backslash in search are literal, not SQL wildcards. Listings include processing/error files, but exclude trashed files. Offset pages are not snapshot tokens; concurrent edits can change counts or page boundaries.

```json
{
  "action": "move",
  "items": [{"type":"folder","id":"fld_example"},{"type":"file","id":"fil_example"}],
  "destinationId": null
}
```

`items` contains 1-100 `{type:"file"|"folder",id}` entries. `rename` requires exactly one item and `name` (1-200 characters); `name` is not accepted for other actions. `move` and `copy` require `destinationId`, including explicit `null` for root. Destination and item ownership are checked independently. Root cannot be modified. Folder moves/copies into the source or any descendant are rejected.

Each executed item has its own metadata transaction. A mixed batch is explicitly **partially successful**, not all-or-nothing:

```json
{"ok":true,"data":{"results":[
  {"type":"file","id":"fil_example","ok":true,"item":{"id":"fil_example","name":"Notes (1).txt"}},
  {"type":"folder","id":"fld_missing","ok":false,"error":{"code":"NotFound","message":"Folder not found."}}
]}}
```

The example item is abbreviated; real items include their complete file/folder representation. Result `id` always identifies the source selection; a copy's new ID is in `item.id`. Redundant descendants in a move/copy batch are not executed twice: they return `ok:true,coveredBy:<ancestor-id>` if that selected ancestor succeeds, otherwise `ANCESTOR_OPERATION_FAILED`. Exact duplicate selections return `DUPLICATE_SELECTION` after the first result. Results retain input order. Clients must inspect every `ok`, not just HTTP 200. Invalid request schemas return HTTP 422 before any mutation.

Names are sanitized consistently and never overwrite existing active files or folders. Collisions in the shared file/folder namespace receive ` (1)`, ` (2)`, etc., preserving short file extensions and the 200-character name limit. Renaming an item to its current name is a no-op unless another conflicting item already exists. Folder move/rename updates all descendant paths transactionally using an escaped prefix; path lengths are checked before mutation. Existing file PATCH and folder PATCH use this shared rename/move logic; browser folder PATCH also accepts `parentId`.

Copies include the full active folder hierarchy and all active **ready** files, up to 10,000 subtree entries per selected item. Oversize subtrees or processing/error content fail explicitly rather than creating an incomplete copy. Configured maximum file size and workspace storage quota are checked before staging and rechecked under the per-user metadata lock; quota counts processing/pending/error and trashed rows, not only ready files. Insufficient capacity returns per-item `QUOTA_EXCEEDED`. Every copied file is streamed into independent chunk keys before a short metadata transaction; copied content never shares deletable storage/Telegram references. Copy resets stars/pins and omits thumbnails, which can be regenerated separately. On Telegram backends copies report `processing` until the transactionally queued flush completes. Source changes during staging cause an explicit conflict/retry; failed metadata transactions remove staged objects best-effort. A process crash during staging can leave unreferenced objects requiring storage cleanup.

File `trash` is undoable through existing restore endpoints. Folder `trash` returns `FOLDER_TRASH_UNSUPPORTED` and changes neither hierarchy nor contained files because this schema cannot restore a folder tree safely. **Do not substitute legacy folder DELETE for trash in a normal file-manager UI.** Legacy cookie folder DELETE permanently removes hierarchy and rehomes files to root; legacy v1/DAV folder DELETE removes hierarchy after trashing enumerated files. Those legacy deletes are not folder restore.

Upload initialization validates destination ownership before reuse and rejects reused `clientKey` values with different sanitized name, size, folder, or fingerprint. Aborted sessions require a fresh key. WebDAV ingestion now schedules Telegram flushing rather than leaving successful writes cache-only.

## Legacy Files

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

WebDAV is mounted at `/dav/` for clients that implement standard WebDAV. Client compatibility depends on each client's protocol behavior and configuration; this is not a native Google Drive, OneDrive, or Office integration, and universal third-party compatibility is not guaranteed.

**Authentication.** Two equivalent options:

```http
Authorization: Basic base64(username:password)   # your Tdrive account
Authorization: Basic base64(any:tdk_…)           # an API key as the password
```

`Authorization: Bearer` and `X-API-Key` are also accepted. Only HTTPS should be used in production.

**Supported methods:** `OPTIONS`, `PROPFIND` (Depth `0`, `1`, `infinity`), `PROPPATCH`, `MKCOL`, `GET`, `HEAD`, `PUT` (including large files), `DELETE`, `MOVE`, `COPY`, `LOCK`, and `UNLOCK`. Responses include `ETag`, `Last-Modified`, `Content-Length`, `resourcetype`, `quota-used-bytes`, and `quota-available-bytes`. `If-Match` / `If-None-Match` are honored on `PUT` (`412` on mismatch); write locks return `423` unless the token is sent in `If`/`Lock-Token`. Cross-origin `Destination` headers and moves/copies into the source directory itself are rejected. `DELETE` moves files to Tdrive trash.

Any file type syncs unchanged — notes, images, e-books, bookmarks exports, highlights, and large archives — with Unicode/Arabic names and nested folders. Point your sync client at `https://<host>/dav/` (or a subfolder such as `/dav/Notes`).

### Windows File Explorer

Use **Map network drive** with the HTTPS WebDAV UNC path, for example `\\tdrive.cc.cd@SSL\DavWWWRoot\dav`. Select **Connect using different credentials** and enter your Tdrive username and password, or any username with an API key as the password. Alternatively, use **Add a network location** with `https://tdrive.cc.cd/dav/`. The Windows **WebClient** service must be running. This is WebDAV over HTTPS, not an SMB share; `\\tdrive.cc.cd\dav` is not equivalent.

The server answers `OPTIONS /` and `PROPFIND /` discovery probes as well as `/dav/`. Authenticated `GET` on a collection returns a directory listing, and `HEAD` succeeds instead of reporting a missing resource.

When deploying browser changes, rebuild both projects: run `npm run build` in the repository root, then `npm --prefix web run build`. Set the host's `PUBLIC_URL` to its actual HTTPS URL (for example `https://tdrive.cc.cd`), not localhost, so browser writes pass the Origin check behind a reverse proxy. Restart the service after replacing the server and frontend builds. Changing the local `.env` does not update the host environment automatically.

## Compatibility notes

This Node application currently supports the routes listed above. Archived file versions, content revisions/delta uploads, content-defined chunking, folder trash/restore, and per-key quota/rate-limit settings are not implemented yet. The API index reports these capabilities honestly, including native Google Drive/OneDrive integration as false. The new drive endpoints have typed OpenAPI response/request/parameter schemas and Basic/Bearer/X-API-Key authentication; older endpoint descriptions remain less detailed. Legacy folder deletion is destructive to hierarchy and is not equivalent to the new safe `trash` operation.

The data layer runs on **Supabase (Postgres)** only — there is no local database at runtime. The application connects with `SUPABASE_DB_URL`, keeps all state in the `tdrive` schema (provisioned through Supabase MCP), and every repository call is asynchronous. `npm run db:migrate` verifies that the schema, tables and row-level-security policies are present. See [`supabase/README.md`](./supabase/README.md).
