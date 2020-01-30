import { Schema, TypeSchema, FieldSchema } from '.'

export function newSchemaDefinition(
  oldSchema: Schema,
  newSchema: Schema
): Schema {
  console.log('OLD SCHEMA:', oldSchema)
  if (!oldSchema) {
    if (!newSchema.languages) {
      newSchema.languages = []
    }

    if (!newSchema.types) {
      newSchema.types = {}
    }

    return newSchema
  }

  const schema: Schema = {
    sha: oldSchema.sha,
    languages: newLanguages(
      oldSchema.languages || [],
      newSchema.languages || []
    ),
    types: {}
  }
  console.log(`CURRENT SCHEMA ${schema.sha}`)

  for (const typeName in oldSchema.types) {
    console.log(`OLD SCHEMA TYPE ${typeName}`)
    if (newSchema.types[typeName]) {
      console.log(`newTypeDefinition() ${typeName}`)
      schema.types[typeName] = newTypeDefinition(
        typeName,
        oldSchema.types[typeName],
        newSchema.types[typeName]
      )
    } else {
      console.log(`OLD TYPE ASSIGNED ${typeName}`)
      schema.types[typeName] = oldSchema.types[typeName]
    }
  }

  for (const typeName in newSchema.types) {
    if (!oldSchema.types[typeName]) {
      schema.types[typeName] = newSchema.types[typeName]
    }
  }
  return schema
}

function newLanguages(oldLangs: string[], newLangs: string[]): string[] {
  const langs: Set<string> = new Set()
  for (const lang of oldLangs) {
    langs.add(lang)
  }

  for (const lang of newLangs) {
    langs.add(lang)
  }

  return [...langs.values()]
}

function newTypeDefinition(
  typeName: string,
  oldType: TypeSchema,
  newType: TypeSchema
): TypeSchema {
  const typeDef: TypeSchema = {
    fields: {},
    prefix: (oldType && oldType.prefix) || (newType && newType.prefix),
    hierarchy: (newType && newType.hierarchy) || (oldType && oldType.hierarchy)
  }

  if (!oldType) {
    return newType
  } else if (!newType) {
    return oldType
  }

  if (oldType.prefix && newType.prefix && oldType.prefix !== newType.prefix) {
    throw new Error(
      `Type ${typeName} has a changed prefix from ${oldType.prefix} to ${newType.prefix}`
    )
  }

  for (const fieldName in oldType.fields) {
    if (newType.fields[fieldName]) {
      console.log(`Both have field for type ${typeName}: ${fieldName}`)
      typeDef.fields[fieldName] = newFieldDefinition(
        `${typeName}.${fieldName}`,
        oldType.fields[fieldName],
        newType.fields[fieldName]
      )
    } else {
      console.log(`Only old type has field ${fieldName} for type ${typeName}`)
      typeDef.fields[fieldName] = oldType.fields[fieldName]
    }
  }

  for (const fieldName in newType.fields) {
    if (!oldType.fields[fieldName]) {
      console.log(`Only new type has field ${fieldName} for type ${typeName}`)
      typeDef.fields[fieldName] = newType.fields[fieldName]
    }
  }

  return typeDef
}

function newFieldDefinition(
  fieldPath: string,
  oldField: FieldSchema,
  newField: FieldSchema
): FieldSchema {
  if (oldField.type !== newField.type) {
    throw new Error(
      `Path ${fieldPath} has mismatching types, trying to change ${oldField.type} to ${newField.type}`
    )
  }

  if (
    oldField.type === 'object' ||
    (oldField.type === 'json' && oldField.properties)
  ) {
    const props = {}
    for (const fieldName in oldField.properties) {
      if ((<any>newField).properties[fieldName]) {
        props[fieldName] = newFieldDefinition(
          `${fieldPath}.${fieldName}`,
          oldField.properties[fieldName],
          (<any>newField).properties[fieldName]
        )
      } else {
        props[fieldName] = oldField.properties[fieldName]
      }
    }

    for (const fieldName in (<any>newField).properties) {
      if (!oldField.properties[fieldName]) {
        props[fieldName] = (<any>newField).properties[fieldName]
      }
    }

    return <any>{
      type: newField.type,
      properties: props
    }
  } else if (
    (oldField.type === 'set' || oldField.type === 'array') &&
    oldField.items.type !== (<any>newField).items.type
  ) {
    throw new Error(
      `Path ${fieldPath} has mismatching types, trying to change collection with type ${
        oldField.items.type
      } to type ${(<any>newField).items.type}`
    )
  }

  if (!(<any>newField).search) {
    if (oldField.search) {
      ;(<any>newField).search = oldField.search
    }
  }

  return newField
}
