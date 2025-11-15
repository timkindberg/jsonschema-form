import type { JSONSchema, FieldNode, GroupNode } from './types';

// JSONSchema can be a boolean in draft-07, but we only work with object schemas
type JSONSchemaObject = Exclude<JSONSchema, boolean>;

// Type guard for object schemas
function isObjectSchema(schema: JSONSchema): schema is JSONSchemaObject {
  return typeof schema === 'object' && schema !== null;
}

export function parseSchema(schema: JSONSchema): GroupNode {
  if (!isObjectSchema(schema)) {
    throw new Error('Boolean schemas are not yet supported');
  }
  
  // Root is just a GroupNode with empty path
  return createGroupNode('', schema, false);
}

function createFieldNode(
  path: string,
  schema: JSONSchemaObject,
  required: boolean
): FieldNode {
  return {
    nodeType: 'field',
    path,
    schema,
    label: schema.title,
    description: schema.description,
    required,
    widget: 'input', // Default for now
    attrs: buildAttrs(schema, required),
  };
}

function createGroupNode(
  path: string,
  schema: JSONSchemaObject,
  required: boolean
): GroupNode {
  const children: Array<FieldNode | GroupNode> = [];
  const requiredFields = schema.required || [];

  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (!isObjectSchema(propSchema)) continue; // Skip boolean schemas
      
      const childPath = path ? `${path}.${key}` : key; // Handle root path
      const isRequired = requiredFields.includes(key);
      
      if (propSchema.type === 'object' && propSchema.properties) {
        children.push(createGroupNode(childPath, propSchema, isRequired));
      } else {
        children.push(createFieldNode(childPath, propSchema, isRequired));
      }
    }
  }

  return {
    nodeType: 'group',
    path,
    schema,
    label: schema.title,
    description: schema.description,
    required,
    widget: 'fieldset',
    children,
    
    getField(targetPath: string): FieldNode | undefined {
      // Search descendants relative to this group
      // If this group has path 'address', searching for 'street' finds 'address.street'
      const fullPath = path ? `${path}.${targetPath}` : targetPath;
      
      for (const child of children) {
        if (child.nodeType === 'field' && child.path === fullPath) {
          return child;
        } else if (child.nodeType === 'group') {
          // Check if target is within this child group
          if (fullPath.startsWith(child.path + '.') || fullPath === child.path) {
            const relativePath = fullPath.substring(child.path.length + 1);
            const found = child.getField(relativePath);
            if (found) return found;
          }
        }
      }
      return undefined;
    },
    
    getAllFields(): FieldNode[] {
      const fields: FieldNode[] = [];
      
      for (const child of children) {
        if (child.nodeType === 'field') {
          fields.push(child);
        } else if (child.nodeType === 'group') {
          fields.push(...child.getAllFields());
        }
      }
      
      return fields;
    },
    
    toJSON() {
      return serializeNode(this);
    },
  };
}

// Helper to serialize nodes without circular references or functions
function serializeNode(node: FieldNode | GroupNode): object {
  if (node.nodeType === 'field') {
    return {
      nodeType: node.nodeType,
      path: node.path,
      title: node.label,
      description: node.description,
      required: node.required,
      widget: node.widget,
      attrs: node.attrs,
      // Omit schema to avoid circular refs
    };
  } else {
    return {
      nodeType: node.nodeType,
      path: node.path,
      title: node.label,
      description: node.description,
      required: node.required,
      widget: node.widget,
      children: node.children.map(child => serializeNode(child)),
      // Omit schema and methods to avoid circular refs
    };
  }
}

function buildAttrs(schema: JSONSchemaObject, required: boolean): Record<string, any> {
  const attrs: Record<string, any> = {};
  
  // HTML input type
  if (schema.type === 'string') {
    if (schema.format === 'email') {
      attrs.type = 'email';
    } else {
      attrs.type = 'text';
    }
  } else if (schema.type === 'number' || schema.type === 'integer') {
    attrs.type = 'number';
  }
  
  // Required
  if (required) {
    attrs.required = true;
  }
  
  // Number constraints
  if (schema.minimum !== undefined) {
    attrs.min = schema.minimum;
  }
  if (schema.maximum !== undefined) {
    attrs.max = schema.maximum;
  }
  
  // String constraints
  if (schema.minLength !== undefined) {
    attrs.minLength = schema.minLength;
  }
  if (schema.maxLength !== undefined) {
    attrs.maxLength = schema.maxLength;
  }
  if (schema.pattern !== undefined) {
    attrs.pattern = schema.pattern;
  }
  
  return attrs;
}

