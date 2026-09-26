import {
  defaultConfigFor,
  templateSectionSchema,
  type TemplateComponentType,
  type TemplateSectionInput,
} from '@dtrace/shared';

/**
 * Local identifiers for the pieces inside a section config (flow nodes, table
 * columns, approval boxes). They only have to be unique within their section,
 * and they never leave the config — the database key is the section's own id.
 */
export function localId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** A section of the given type, fully valid, ready to drop into the list. */
export function makeSection(
  type: TemplateComponentType,
  index: number,
): TemplateSectionInput {
  return templateSectionSchema.parse({
    type,
    title: 'Section Baru',
    key: `section${index + 1}`,
    source: type === 'HEADER' ? 'SYSTEM' : type === 'DATA' ? 'PROJECT' : 'MANUAL',
    binding: null,
    content: type === 'TEXT' ? '' : null,
    editable: true,
    required: false,
    visible: true,
    config: defaultConfigFor(type, localId),
  });
}

/**
 * Switches a section to another component type.
 *
 * The config cannot be carried across — a table's grid means nothing to a flow
 * — so it is replaced with that type's default. Everything else the operator
 * typed (title, key, binding, flags) survives the change.
 */
export function changeSectionType(
  section: TemplateSectionInput,
  type: TemplateComponentType,
): TemplateSectionInput {
  if (section.type === type) return section;

  return templateSectionSchema.parse({
    ...section,
    type,
    config: defaultConfigFor(type, localId),
  });
}

/** Turns a key into something the schema accepts, as the operator types. */
export function normaliseKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '').replace(/^[^a-zA-Z]+/, '');
}
