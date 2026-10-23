const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const array = (name: string) => ({ type: 'array', items: ref(name) });
const nullableString = { type: ['string', 'null'] };
const error = { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } };
const envelope = (data: unknown) => ({ type: 'object', required: ['ok', 'data'], properties: { ok: { const: true }, data } });
export const driveSchemas = {
  ApiFolder: {
    type: 'object', required: ['id', 'name', 'parentId', 'path', 'modified'],
    properties: { id: { type: 'string' }, name: { type: 'string' }, parentId: nullableString, path: { type: 'string' }, modified: { type: 'number', description: 'Unix milliseconds' } },
  },
  ApiFile: {
    type: 'object', required: ['id', 'name', 'type', 'folderId', 'size', 'sizeBytes', 'status', 'modified', 'created', 'isDeleted'],
    properties: {
      id: { type: 'string' }, name: { type: 'string' }, type: { type: 'string', enum: ['video', 'design', 'code', 'doc', 'archive', 'bin', 'folder'] },
      extension: nullableString, mime: nullableString, folderId: nullableString, size: { type: 'number' }, sizeBytes: { type: 'number' },
      sha256: nullableString, status: { enum: ['pending', 'processing', 'ready', 'error'] }, source: { enum: ['upload', 'url', 'ytdlp'] },
      sourceUrl: nullableString, duration: { type: ['number', 'null'] }, width: { type: ['number', 'null'] }, height: { type: ['number', 'null'] },
      hasThumbnail: { type: 'boolean' }, isStarred: { type: 'boolean' }, isPinned: { type: 'boolean' }, isDeleted: { type: 'boolean' },
      trashedAt: { type: ['number', 'null'] }, modified: { type: 'number' }, created: { type: 'number' },
    },
  },
  DrivePage: { type: 'object', required: ['folders', 'files', 'breadcrumbs', 'total', 'nextOffset'], properties: { folders: array('ApiFolder'), files: array('ApiFile'), breadcrumbs: array('ApiFolder'), total: { type: 'integer', minimum: 0 }, nextOffset: { type: ['integer', 'null'], minimum: 0 } } },
  FolderDetails: { type: 'object', required: ['folder', 'breadcrumbs'], properties: { folder: ref('ApiFolder'), breadcrumbs: array('ApiFolder') } },
  DriveSelection: { type: 'object', additionalProperties: false, required: ['type', 'id'], properties: { type: { enum: ['file', 'folder'] }, id: { type: 'string', minLength: 1, maxLength: 200 } } },
  DriveOperation: {
    type: 'object', additionalProperties: false, required: ['action', 'items'],
    properties: { action: { enum: ['rename', 'move', 'copy', 'trash'] }, items: { ...array('DriveSelection'), minItems: 1, maxItems: 100 }, name: { type: 'string', minLength: 1, maxLength: 200 }, destinationId: { type: ['string', 'null'], minLength: 1, maxLength: 200 } },
    allOf: [
      { if: { properties: { action: { const: 'rename' } } }, then: { required: ['name'], properties: { items: { maxItems: 1 } }, not: { required: ['destinationId'] } }, else: { not: { required: ['name'] } } },
      { if: { properties: { action: { enum: ['move', 'copy'] } } }, then: { required: ['destinationId'] }, else: { not: { required: ['destinationId'] } } },
    ],
  },
  DriveResult: { oneOf: [
    { type: 'object', required: ['type', 'id', 'ok'], properties: { type: { enum: ['file', 'folder'] }, id: { type: 'string' }, ok: { const: true }, item: { oneOf: [ref('ApiFile'), ref('ApiFolder')] }, coveredBy: { type: 'string', description: 'Redundant selection handled by this successful ancestor folder' } } },
    { type: 'object', required: ['type', 'id', 'ok', 'error'], properties: { type: { enum: ['file', 'folder'] }, id: { type: 'string' }, ok: { const: false }, error } },
  ] },
  DriveResults: { type: 'object', required: ['results'], properties: { results: array('DriveResult') } },
  ApiError: { type: 'object', required: ['ok', 'error'], properties: { ok: { const: false }, error } },
};

export function driveResponses(schema: string): Record<string, unknown> {
  return {
    '200': { description: 'Success. Batch results may contain per-item failures.', content: { 'application/json': { schema: envelope(ref(schema)) } } },
    '400': { description: 'Invalid bounds or request shape', content: { 'application/json': { schema: ref('ApiError') } } },
    '422': { description: 'Request validation failed', content: { 'application/json': { schema: ref('ApiError') } } },
    '401': { description: 'Missing or invalid credentials', content: { 'application/json': { schema: ref('ApiError') } } },
    '404': { description: 'Owned folder not found', content: { 'application/json': { schema: ref('ApiError') } } },
    '500': { description: 'Server error', content: { 'application/json': { schema: ref('ApiError') } } },
  };
}

export const drivePaths = {
  '/api/v1/drive': { get: {
    summary: 'Paginated folder contents or global active-name search',
    description: 'Folder-first ordering with stable id tie breaks. Offset and total cover both types. q presence searches globally, including an empty q. Files include folderId and folders include parentId/path.',
    parameters: [
      { name: 'folderId', in: 'query', schema: { type: 'string', default: 'root' }, description: 'root or owned folder id' },
      { name: 'q', in: 'query', schema: { type: 'string', maxLength: 256 }, description: 'Literal case-insensitive substring across the user\'s active drive' },
      { name: 'sort', in: 'query', schema: { enum: ['name', 'modified', 'size'], default: 'name' } },
      { name: 'order', in: 'query', schema: { enum: ['asc', 'desc'], default: 'asc' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
      { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, default: 0 } },
    ], responses: driveResponses('DrivePage'),
  } },
  '/api/v1/operations': { post: {
    summary: 'Rename, move, copy, or trash a mixed selection',
    description: '1-100 items. Each item is atomic; the batch permits partial failure. File trash can be restored; folder trash returns FOLDER_TRASH_UNSUPPORTED without any mutation. Redundant descendants return ok:true,coveredBy when their ancestor succeeds, otherwise ANCESTOR_OPERATION_FAILED. Duplicate exact selections return DUPLICATE_SELECTION. Copies have independent storage keys and omit thumbnails/stars/pins; active ready content only, max10000 subtree entries per item. Collision suffixes never overwrite.',
    requestBody: { required: true, content: { 'application/json': { schema: ref('DriveOperation') } } },
    responses: driveResponses('DriveResults'),
  } },
  '/api/v1/folders/{id}': { get: { summary: 'Owned folder and direct ancestry, including root', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: driveResponses('FolderDetails') } },
};

/** Keep legacy summary-only operations structurally valid without inventing response bodies. */
export function documentedPaths(paths: Record<string, Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(paths).map(([path, operations]) => [path, Object.fromEntries(
    Object.entries(operations).map(([method, value]) => {
      const operation = value as { parameters?: { name: string; in: string }[]; responses?: unknown };
      const parameters = [...operation.parameters ?? []];
      for (const name of [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])) {
        if (!parameters.some((p) => p.in === 'path' && p.name === name)) parameters.push({ name, in: 'path', required: true, schema: { type: 'string' } } as typeof parameters[number]);
      }
      return [method, { ...operation, ...(parameters.length ? { parameters } : {}), responses: operation.responses ?? {
        '200': { description: 'Successful response. See the developer reference for the legacy response representation.' },
        default: { description: 'Error response', content: { 'application/json': { schema: ref('ApiError') } } },
      } }];
    }),
  )]));
}
