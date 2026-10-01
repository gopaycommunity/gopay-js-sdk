// Routed through the package root, not '@gopay-internal/core/types/generated.js':
// the subpath is only declared in core's `exports` map, which dts bundlers do not
// read, so it survived into the published declarations as an unresolvable import.
export type {
    $defs,
    components,
    operations,
    paths,
    webhooks,
} from '@gopay-internal/core';
