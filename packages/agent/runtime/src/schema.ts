/** This catalog drives both input validation and describe output. */
const fields: Record<string, { required: string[]; optional?: string[] }> = {
  'pattern.instantiate': {
    required: ['patternId'],
    optional: ['parameters', 'dir'],
  },
  'file.create': {
    required: ['kind', 'title', 'path'],
    optional: ['id', 'anchorId', 'mode'],
  },
  'file.import': { required: ['file', 'path'] },
  'file.replace': { required: ['fileId', 'file'] },
  'mermaid.import': {
    required: ['scene', 'source', 'path'],
    optional: ['title'],
  },
  'file.move': { required: ['fileId', 'path'] },
  'file.copy': { required: ['fileId'], optional: ['dir'] },
  'file.remove': { required: ['fileId'] },
  'document.set': { required: ['fileId'], optional: ['markdown', 'content'] },
  'document.splice': {
    required: ['fileId', 'index', 'blocks'],
    optional: ['deleteCount'],
  },
  'node.upsert': {
    required: ['fileId', 'kind'],
    optional: [
      'id',
      'label',
      'parentId',
      'geometry',
      'data',
      'appearance',
      'points',
    ],
  },
  'edge.upsert': {
    required: ['fileId', 'sourceId', 'targetId'],
    optional: [
      'id',
      'label',
      'relation',
      'messageKind',
      'sourcePort',
      'targetPort',
    ],
  },
  'relation.move': {
    required: ['fileId', 'id', 'parentId'],
    optional: ['index'],
  },
  'architecture.reorder': { required: ['fileId', 'ids'] },
  'sequence.move': {
    required: ['fileId', 'id', 'index'],
    optional: ['operandId'],
  },
  'sequence.reorder': { required: ['fileId', 'ids'] },
  'sequence.activation': {
    required: ['fileId', 'participantId', 'startId', 'endId'],
  },
  'table.set': { required: ['fileId', 'id', 'values'] },
  'table.track': {
    required: ['fileId', 'id', 'action', 'axis', 'index'],
    optional: ['size'],
  },
  'table.merge': { required: ['fileId', 'id', 'range'] },
  'table.split': { required: ['fileId', 'id', 'entryId'] },
  'reference.upsert': {
    required: ['fileId', 'targetId', 'targetKind'],
    optional: ['id', 'geometry'],
  },
  'group.set': { required: ['fileId', 'ids'], optional: ['id'] },
  'element.remove': { required: ['fileId', 'ids'] },
  'elements.move': {
    required: ['fileId', 'targetFileId', 'ids'],
    optional: ['parentId'],
  },
  'cell.set': { required: ['fileId', 'cell'] },
  'layout.apply': { required: ['fileId', 'style'], optional: ['ids'] },
};
export interface ValueSchema {
  type?: string;
  const?: string;
  enum?: string[];
  minimum?: number;
  minLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: ValueSchema;
  properties?: Record<string, ValueSchema>;
  required?: string[];
  additionalProperties?: boolean;
}
const property = (field: string, operation: string): ValueSchema => {
  if (['index', 'deleteCount', 'size'].includes(field))
    return { type: 'integer', minimum: 0 };
  if (field === 'ids')
    return { type: 'array', items: { type: 'string', minLength: 1 } };
  if (field === 'blocks') return { type: 'array', items: { type: 'object' } };
  if (field === 'points')
    return {
      type: 'array',
      minItems: 1,
      items: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: { type: 'number' },
      },
    };
  if (field === 'values')
    return {
      type: 'array',
      items: { type: 'array', items: { type: 'string' } },
    };
  if (field === 'parameters')
    return {
      type: 'object',
      additionalProperties: false,
      properties: { title: { type: 'string', minLength: 1 } },
    };
  if (field === 'range')
    return {
      type: 'object',
      additionalProperties: false,
      required: ['top', 'left', 'bottom', 'right'],
      properties: Object.fromEntries(
        ['top', 'left', 'bottom', 'right'].map((k) => [
          k,
          { type: 'integer', minimum: 0 },
        ]),
      ),
    };
  if (
    ['file', 'cell', 'content', 'geometry', 'data', 'appearance'].includes(
      field,
    )
  )
    return { type: 'object' };
  const enums: Record<string, string[]> = {
    mode: ['dag', 'process'],
    scene: ['workflow', 'architecture', 'uml-class', 'uml-sequence'],
    targetKind: ['document', 'frame'],
    axis: ['row', 'column'],
    action: ['insert', 'remove', 'resize'],
  };
  if (field === 'kind' && operation === 'file.create')
    return {
      type: 'string',
      enum: [
        'document',
        'whiteboard',
        'mind',
        'workflow',
        'architecture',
        'uml-class',
        'uml-sequence',
      ],
    };
  if (enums[field]) return { type: 'string', enum: enums[field] };
  return {
    type: 'string',
    ...([
      'id',
      'anchorId',
      'fileId',
      'path',
      'parentId',
      'targetId',
      'sourceId',
      'targetFileId',
      'patternId',
    ].includes(field)
      ? { minLength: 1 }
      : {}),
  };
};
export const authoringOperationSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'AuthoringOperation',
  oneOf: Object.entries(fields).map(([type, definition]): ValueSchema => ({
    type: 'object',
    additionalProperties: false,
    required: ['type', ...definition.required],
    properties: Object.fromEntries([
      ['type', { const: type }],
      ...[...definition.required, ...(definition.optional ?? [])].map(
        (field) => [field, property(field, type)],
      ),
    ]),
  })),
};
function validateValue(
  value: unknown,
  schema: ValueSchema,
  pointer: string,
): void {
  const fail = () => {
    throw new Error('Invalid operation value at ' + pointer);
  };
  const actual = Array.isArray(value)
    ? 'array'
    : value === null
      ? 'null'
      : typeof value;
  if (
    schema.type &&
    (schema.type === 'integer'
      ? !Number.isInteger(value)
      : actual !== schema.type)
  )
    fail();
  if (
    (schema.const !== undefined && value !== schema.const) ||
    (schema.enum && !schema.enum.includes(value as string))
  )
    fail();
  if (
    typeof value === 'number' &&
    (!Number.isFinite(value) ||
      (schema.minimum !== undefined && value < schema.minimum))
  )
    fail();
  if (
    typeof value === 'string' &&
    schema.minLength !== undefined &&
    value.length < schema.minLength
  )
    fail();
  if (Array.isArray(value)) {
    if (
      (schema.minItems !== undefined && value.length < schema.minItems) ||
      (schema.maxItems !== undefined && value.length > schema.maxItems)
    )
      fail();
    if (schema.items)
      value.forEach((v, i) =>
        validateValue(v, schema.items!, pointer + '/' + i),
      );
  } else if (value && typeof value === 'object' && schema.properties) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in record)) fail();
    for (const [key, v] of Object.entries(record)) {
      if (!schema.properties[key]) {
        if (schema.additionalProperties === false) fail();
      } else validateValue(v, schema.properties[key], pointer + '/' + key);
    }
  }
}
export function parseOperations(
  value: unknown,
): import('./types').AuthoringOperation[] {
  if (!Array.isArray(value)) throw new Error('Operations must be an array');
  value.forEach((op, index) => {
    const schema = authoringOperationSchema.oneOf.find(
      (s) => s.properties?.['type']?.const === op?.type,
    );
    if (!schema) throw new Error('Unknown operation at ' + index);
    validateValue(op, schema, '/' + index);
    if (
      op.type === 'document.set' &&
      (op.markdown === undefined) === (op.content === undefined)
    )
      throw new Error('Choose exactly one of markdown/content');
  });
  return value;
}
