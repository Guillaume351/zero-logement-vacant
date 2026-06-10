import { parse as parseJSONL } from 'jsonlines';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';
import zlib from 'node:zlib';

import { createLogger } from '~/infra/logger';
import { SourceRepository } from '~/scripts/import-lovac/infra';
import { SourceRs } from '~/scripts/import-rs/source-rs';

const logger = createLogger('sourceRsFileRepository');

function resolveFile(file: string): string {
  if (fs.existsSync(file)) {
    return file;
  }

  const fromWorkspaceRoot = path.join('..', file);
  if (fs.existsSync(fromWorkspaceRoot)) {
    return fromWorkspaceRoot;
  }

  return file;
}

export function createSourceRsFileRepository(
  file: string
): SourceRepository<SourceRs> {
  const resolvedFile = resolveFile(file);

  return {
    stream(): ReadableStream<SourceRs> {
      logger.debug(`Loading ${resolvedFile}...`);
      const source = fs.createReadStream(resolvedFile);
      const input = resolvedFile.endsWith('.gz')
        ? source.pipe(zlib.createGunzip())
        : source;
      return Readable.toWeb(input.pipe(parseJSONL())) as ReadableStream<SourceRs>;
    }
  };
}
