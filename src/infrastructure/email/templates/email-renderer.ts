import { render } from 'ejs';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/** Prefer dist (nest build assets); fall back to src when .ejs were not copied (some deploys). */
const resolveViewsDir = (): string => {
  const sentinel = 'base.ejs';
  const candidates = [
    resolve(__dirname, 'views'),
    resolve(process.cwd(), 'dist/infrastructure/email/templates/views'),
    resolve(process.cwd(), 'src/infrastructure/email/templates/views'),
    resolve(process.cwd(), 'infrastructure/email/templates/views'),
  ];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, sentinel))) {
      return dir;
    }
  }
  return candidates[0];
};

const VIEWS_DIR = resolveViewsDir();

const templateCache = new Map<string, string>();

const loadTemplate = (name: string): string => {
  if (templateCache.has(name)) {
    return templateCache.get(name)!;
  }
  const filePath = resolve(VIEWS_DIR, `${name}.ejs`);
  const content = readFileSync(filePath, 'utf-8');
  templateCache.set(name, content);
  return content;
};

export const renderEmail = (
  templateName: string,
  data: Record<string, any>,
): string => {
  const template = loadTemplate(templateName);
  return render(template, data, { rmWhitespace: false });
};
