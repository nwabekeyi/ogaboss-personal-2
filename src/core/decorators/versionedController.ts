import { Controller } from '@nestjs/common';
import { apiTags, apiVersions } from '../../shared';

export function VersionedController(
  pathKey: keyof typeof apiTags | string,  // 👈 allow plain string too
  version: string = apiVersions.v1,
) {
  // if the argument matches a key in apiTags, resolve it
  const path =
    (apiTags as Record<string, string>)[pathKey] ?? pathKey;

  return Controller({ version, path });
}
