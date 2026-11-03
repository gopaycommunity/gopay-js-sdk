import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { load } from 'js-yaml';
import { expect } from 'vitest';

type Schema = Record<string, unknown>;

/**
 * Responses checked against the spec snapshot the types were generated from, so a field the
 * gateway sends differently from the spec fails here instead of passing as a cast.
 * Formats are not checked and unknown OpenAPI keywords are ignored: the point is the shape.
 */
const spec = load(
    readFileSync(new URL('../../../Payments.yaml', import.meta.url), 'utf8'),
) as {
    components: { schemas: Record<string, Schema> };
};

// Each Event variant types `type` as the whole Event-Type enum, so to JSON Schema alone a
// payments.canceled event is also a valid Payment-Paid-Event and `oneOf` fails. OpenAPI's
// discriminator mapping is what picks the variant; written out as `const`, Ajv can apply it.
for (const schema of Object.values(spec.components.schemas)) {
    const discriminator = schema.discriminator as
        | { propertyName?: string; mapping?: Record<string, string> }
        | undefined;
    if (!discriminator?.propertyName || !discriminator.mapping) {
        continue;
    }
    for (const [value, ref] of Object.entries(discriminator.mapping)) {
        const variant = spec.components.schemas[ref.split('/').pop() ?? ''];
        const properties = variant?.properties as
            | Record<string, Schema>
            | undefined;
        if (properties) {
            properties[discriminator.propertyName] = {
                ...properties[discriminator.propertyName],
                const: value,
            };
        }
    }
}

const ajv = new Ajv2020({
    strict: false,
    validateFormats: false,
    validateSchema: false,
    allErrors: true,
});
ajv.addSchema(spec, 'payments');

export function expectMatchesSpec(schema: string, value: unknown): void {
    const validate = ajv.compile({
        $ref: `payments#/components/schemas/${schema}`,
    });
    const valid = validate(value);
    expect(
        valid ? [] : validate.errors,
        `${schema} does not match the spec`,
    ).toEqual([]);
}
