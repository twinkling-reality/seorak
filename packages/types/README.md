# @seorak/types

Publish-safe Seorak wire contracts, view models, and strict runtime validators.
This package is the only shared dependency allowed across the collector, worker,
web, and mobile trust boundaries.

The root entry contains runtime-light shared contracts. Validators with module
scope cost use explicit subpaths:

```ts
import { seorakRoutes, type EventBatch } from "@seorak/types";
import {
  EventBatchEnvelopeSchema,
  parseSessionEvent,
} from "@seorak/types/event-validation";
```

`@seorak/types/push` is the optional runtime mobile-surface integration. A
consumer of that subpath must install the matching
`@mobile-surfaces/surface-contracts@9.0.0` peer. Core consumers, including the
collector CLI (`seorak`), do not install any `@mobile-surfaces`, Expo, or React
Native dependency tree.

The device token wire contract this subpath validates is the same one
`@mobile-surfaces/tokens@7.1.2` publishes at its `/wire` subpath, and it is
defined here rather than imported from there, so consuming `/push` does not
require the token package or the mobile toolchain behind it.

Published artifacts contain compiled ESM and declarations. Node 22.18 or newer
is the supported runtime floor; bundlers may consume the declared ESM subpaths
normally.

Licensed under Apache-2.0.
